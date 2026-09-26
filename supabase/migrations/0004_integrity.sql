-- =============================================================================
-- 0004 – correctness and security fixes from the calculation audit.
-- Run AFTER 0001_init.sql and 0003_clouds.sql. Safe to run as one transaction
-- (Supabase SQL Editor) and safe to re-run.
--
--  * Cairo "today" everywhere on the server (Supabase runs in UTC)
--  * every RPC checks the caller owns the data; anon can no longer call functions
--  * transactions must use their account's currency and owner
--  * Cloud interest never back-posts on today's balance (per-day historical balance)
--  * monthly Cloud payouts and recurring items keep their day of month (no drift to the 28th)
--  * reminder-only recurring items roll forward
--  * deleting a debt removes its original borrow/lend transaction
--  * deleting an account/balance that other records depend on is refused (archive instead)
--  * editing a debt's amount re-evaluates settled/open and updates its linked transaction
--  * editing a certificate never duplicates payouts that were already logged
--  * deleting an auto-logged payout marks it skipped (it is not re-logged behind your back)
--  * a manual gold price wins for 24 hours
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.app_today()
returns date language sql stable as $$
  select (now() at time zone 'Africa/Cairo')::date;
$$;

-- Callers may only act on their own rows. Server-side jobs (pg_cron / SQL editor run as
-- postgres) and the service role are allowed.
create or replace function public.assert_owner(p_owner uuid)
returns void language plpgsql stable as $$
begin
  if p_owner is null then raise exception 'not allowed'; end if;
  if auth.uid() is distinct from p_owner
     and session_user not in ('postgres', 'supabase_admin')
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not allowed';
  end if;
end $$;

-- Closing balance of a sub-account at the end of a day.
create or replace function public.balance_as_of(p_sub_account_id uuid, p_date date)
returns numeric language sql stable as $$
  select s.opening_balance
    + coalesce((select sum(case when t.type = 'income' then t.amount when t.type = 'expense' then -t.amount else -t.amount end)
                from public.transactions t where t.sub_account_id = s.id and t.date <= p_date), 0)
    + coalesce((select sum(t.to_amount) from public.transactions t
                where t.to_sub_account_id = s.id and t.type = 'transfer' and t.date <= p_date), 0)
  from public.sub_accounts s where s.id = p_sub_account_id;
$$;

-- ---------------------------------------------------------------------------
-- Transactions must belong to the same user as their accounts and use their currencies.
-- ---------------------------------------------------------------------------
create or replace function public.transactions_validate_trigger()
returns trigger language plpgsql as $$
declare s_user uuid; s_cur text;
begin
  select user_id, currency into s_user, s_cur from public.sub_accounts where id = new.sub_account_id;
  if s_user is distinct from new.user_id then raise exception 'That account does not belong to you'; end if;
  if s_cur <> new.currency then
    raise exception 'Amount is in % but the account holds %', new.currency, s_cur;
  end if;
  if new.type = 'transfer' then
    select user_id, currency into s_user, s_cur from public.sub_accounts where id = new.to_sub_account_id;
    if s_user is distinct from new.user_id then raise exception 'That account does not belong to you'; end if;
    if s_cur <> new.to_currency then
      raise exception 'Received amount is in % but the account holds %', new.to_currency, s_cur;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists transactions_validate on public.transactions;
create trigger transactions_validate before insert or update on public.transactions
for each row execute function public.transactions_validate_trigger();

-- ---------------------------------------------------------------------------
-- Deleting a balance that other records depend on would silently rewrite them
-- (transfers reversed on the other account, debt repayments removed). Refuse it.
-- Transfers between balances of the same account are fine when the whole account goes.
-- ---------------------------------------------------------------------------
create or replace function public.sub_accounts_delete_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare cascading boolean := pg_trigger_depth() > 1;
begin
  -- the whole user is being deleted (their auth row is already gone): nothing left to protect
  if not exists (select 1 from auth.users where id = old.user_id) then return old; end if;
  if exists (
    select 1 from public.transactions t
    left join public.sub_accounts o on o.id = case when t.sub_account_id = old.id then t.to_sub_account_id else t.sub_account_id end
    where (t.sub_account_id = old.id or t.to_sub_account_id = old.id)
      and (
        t.source::text = 'debt'
        or (t.type = 'transfer' and o.id is not null and o.id <> old.id and (not cascading or o.account_id <> old.account_id))
      )
  ) then
    raise exception 'This balance has transfers or debt payments linked to other records. Archive it instead so your history stays correct.';
  end if;
  return old;
end $$;

drop trigger if exists sub_accounts_delete_guard on public.sub_accounts;
create trigger sub_accounts_delete_guard before delete on public.sub_accounts
for each row execute function public.sub_accounts_delete_guard();

-- ---------------------------------------------------------------------------
-- Debts
-- ---------------------------------------------------------------------------
-- Editing the amount re-evaluates settled/open; currency is fixed once money has moved.
create or replace function public.debts_before_update_trigger()
returns trigger language plpgsql as $$
declare v_paid numeric;
begin
  if new.currency <> old.currency
     and (old.transaction_id is not null or exists (select 1 from public.debt_payments where debt_id = old.id)) then
    raise exception 'The currency can''t change after money has moved for this debt';
  end if;
  select coalesce(sum(amount), 0) into v_paid from public.debt_payments where debt_id = new.id;
  new.status := case when v_paid >= new.amount then 'settled' else 'open' end;
  return new;
end $$;

drop trigger if exists debts_before_update on public.debts;
create trigger debts_before_update before update on public.debts
for each row execute function public.debts_before_update_trigger();

-- Keep the original borrow/lend transaction in step with the debt's amount and date.
create or replace function public.debts_sync_transaction_trigger()
returns trigger language plpgsql as $$
begin
  if new.transaction_id is not null and (new.amount <> old.amount or new.date <> old.date) then
    update public.transactions set amount = new.amount, date = new.date where id = new.transaction_id;
  end if;
  return null;
end $$;

drop trigger if exists debts_sync_transaction on public.debts;
create trigger debts_sync_transaction after update of amount, date on public.debts
for each row execute function public.debts_sync_transaction_trigger();

-- Deleting a debt removes its original borrow/lend transaction too (its repayments cascade).
create or replace function public.debts_after_delete_trigger()
returns trigger language plpgsql as $$
begin
  if old.transaction_id is not null then
    delete from public.transactions where id = old.transaction_id;
  end if;
  return null;
end $$;

drop trigger if exists debts_after_delete on public.debts;
create trigger debts_after_delete after delete on public.debts
for each row execute function public.debts_after_delete_trigger();

-- ---------------------------------------------------------------------------
-- Deleting a logged certificate payout marks it skipped instead of re-queuing it,
-- so auto-log does not silently add it back.
-- ---------------------------------------------------------------------------
create or replace function public.transactions_cleanup_trigger()
returns trigger language plpgsql as $$
begin
  if old.source::text = 'debt' then
    perform set_config('app.deleting_tx', old.id::text, true);
    delete from public.debt_payments where transaction_id = old.id;
    update public.debts set transaction_id = null where transaction_id = old.id;
    perform set_config('app.deleting_tx', '', true);
  elsif old.source::text = 'certificate' then
    update public.certificate_payouts set status = 'skipped', transaction_id = null where transaction_id = old.id;
  end if;
  return old;
end $$;

-- ---------------------------------------------------------------------------
-- Certificates: regenerating the schedule keeps the payouts already logged/skipped as the
-- first periods, so changing dates or amounts never creates extra payouts.
-- ---------------------------------------------------------------------------
create or replace function public.generate_certificate_payouts(p_certificate_id uuid)
returns void language plpgsql as $$
declare
  c public.certificates%rowtype; step interval; d date; amt numeric; n integer := 1; done integer;
begin
  select * into c from public.certificates where id = p_certificate_id;
  if not found then return; end if;

  delete from public.certificate_payouts where certificate_id = c.id and status = 'pending';
  select count(*) into done from public.certificate_payouts where certificate_id = c.id;
  amt := public.certificate_payout_amount(c.principal, c.interest_rate, c.payout_frequency, c.start_date, c.maturity_date);

  if c.payout_frequency = 'at_maturity' then
    if done = 0 then
      insert into public.certificate_payouts (user_id, certificate_id, due_date, amount)
      values (c.user_id, c.id, c.maturity_date, amt)
      on conflict (certificate_id, due_date) do nothing;
    end if;
    return;
  end if;

  step := case c.payout_frequency
    when 'monthly' then interval '1 month' when 'quarterly' then interval '3 months'
    when 'semi_annual' then interval '6 months' when 'annual' then interval '1 year' end;

  loop
    d := (c.start_date + step * n)::date;
    exit when d > c.maturity_date;
    if n > done then
      insert into public.certificate_payouts (user_id, certificate_id, due_date, amount)
      values (c.user_id, c.id, d, amt)
      on conflict (certificate_id, due_date) do nothing;
    end if;
    n := n + 1;
  end loop;
end $$;

create or replace function public.log_certificate_payout(p_payout_id uuid, p_sub_account_id uuid default null, p_transaction_id uuid default gen_random_uuid())
returns uuid language plpgsql security definer set search_path = public as $$
declare
  p public.certificate_payouts%rowtype; c public.certificates%rowtype; s public.sub_accounts%rowtype; cat uuid;
begin
  select * into p from public.certificate_payouts where id = p_payout_id;
  if not found then raise exception 'payout not found'; end if;
  perform public.assert_owner(p.user_id);
  if p.status = 'logged' then return p.transaction_id; end if;
  select * into c from public.certificates where id = p.certificate_id;
  select * into s from public.sub_accounts where id = coalesce(p_sub_account_id, c.payout_sub_account_id);
  if not found then raise exception 'Choose an account to receive the payout'; end if;
  if s.user_id <> p.user_id then raise exception 'That account does not belong to you'; end if;
  if s.currency <> c.currency then raise exception 'The payout is in % but that account holds %', c.currency, s.currency; end if;
  select id into cat from public.categories where user_id = p.user_id and kind = 'income' and lower(name) = 'interest' limit 1;
  insert into public.transactions (id, user_id, type, date, amount, currency, sub_account_id, category_id, notes, source, source_id)
  values (p_transaction_id, p.user_id, 'income', p.due_date, p.amount, c.currency, s.id, cat, c.name || ' payout', 'certificate', p.id)
  on conflict (id) do nothing;
  update public.certificate_payouts set status = 'logged', transaction_id = p_transaction_id where id = p.id;
  return p_transaction_id;
end $$;

create or replace function public.process_certificate_payouts(p_user uuid default auth.uid())
returns integer language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  perform public.assert_owner(p_user);
  for r in select p.id from public.certificate_payouts p join public.certificates c on c.id = p.certificate_id
           where p.user_id = p_user and p.status = 'pending' and p.due_date <= public.app_today()
             and c.auto_log_income and c.payout_sub_account_id is not null and not c.is_closed
  loop
    begin
      perform public.log_certificate_payout(r.id);
      n := n + 1;
    exception when others then
      raise warning 'payout % not logged: %', r.id, sqlerrm;  -- e.g. payout account in another currency
    end;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Debt repayments: the account must be yours and in the debt's currency, and a payment
-- may not exceed what is left.
-- ---------------------------------------------------------------------------
create or replace function public.record_debt_payment(
  p_debt_id uuid, p_amount numeric, p_date date, p_sub_account_id uuid default null, p_notes text default null,
  p_payment_id uuid default gen_random_uuid(), p_transaction_id uuid default gen_random_uuid()
) returns uuid language plpgsql security definer set search_path = public as $$
declare d public.debts%rowtype; s public.sub_accounts%rowtype; c public.contacts%rowtype; tx uuid := null; v_paid numeric;
begin
  select * into d from public.debts where id = p_debt_id;
  if not found then raise exception 'debt not found'; end if;
  perform public.assert_owner(d.user_id);
  if exists (select 1 from public.debt_payments where id = p_payment_id) then return p_payment_id; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter an amount above zero'; end if;
  select coalesce(sum(amount), 0) into v_paid from public.debt_payments where debt_id = d.id;
  if p_amount > d.amount - v_paid then
    raise exception 'That is more than the % % left on this debt', round(d.amount - v_paid, 2), d.currency;
  end if;
  select * into c from public.contacts where id = d.contact_id;
  if p_sub_account_id is not null then
    select * into s from public.sub_accounts where id = p_sub_account_id;
    if not found or s.user_id <> d.user_id then raise exception 'That account does not belong to you'; end if;
    if s.currency <> d.currency then raise exception 'The debt is in % but that account holds %', d.currency, s.currency; end if;
    insert into public.transactions (id, user_id, type, date, amount, currency, sub_account_id, notes, payee, source, source_id)
    values (p_transaction_id, d.user_id, case when d.direction = 'owed_to_me' then 'income' else 'expense' end::public.transaction_type,
            p_date, p_amount, d.currency, s.id,
            case when d.direction = 'owed_to_me' then 'Repayment from ' else 'Repayment to ' end || c.name, c.name, 'debt', d.id)
    on conflict (id) do nothing;
    tx := p_transaction_id;
  end if;
  insert into public.debt_payments (id, user_id, debt_id, amount, date, sub_account_id, transaction_id, notes)
  values (p_payment_id, d.user_id, p_debt_id, p_amount, p_date, p_sub_account_id, tx, p_notes);
  return p_payment_id;
end $$;

-- ---------------------------------------------------------------------------
-- Recurring: occurrences are computed from a fixed anchor date (anchor + k × step), so a
-- rule on the 31st goes 31 Jan → 28 Feb → 31 Mar, never drifting to the 28th.
-- Reminder-only rules roll forward once their day has passed.
-- ---------------------------------------------------------------------------
alter table public.recurring_transactions add column if not exists anchor_date date;
update public.recurring_transactions set anchor_date = next_date where anchor_date is null;

create or replace function public.recurring_anchor_trigger()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.anchor_date := coalesce(new.anchor_date, new.next_date);
  elsif coalesce(current_setting('app.posting_recurring', true), '') <> 'on'
        and (new.next_date is distinct from old.next_date or new.frequency is distinct from old.frequency
             or new.interval_count is distinct from old.interval_count) then
    -- the user moved the schedule: the new next date becomes the anchor
    new.anchor_date := new.next_date;
  end if;
  return new;
end $$;

drop trigger if exists recurring_anchor on public.recurring_transactions;
create trigger recurring_anchor before insert or update on public.recurring_transactions
for each row execute function public.recurring_anchor_trigger();

create or replace function public.post_due_recurring(p_user uuid default auth.uid())
returns integer language plpgsql security definer set search_path = public as $$
declare
  r record; n integer := 0; d date; k integer; unit interval; anchor date; today date := public.app_today();
begin
  perform public.assert_owner(p_user);
  perform set_config('app.posting_recurring', 'on', true);
  for r in select * from public.recurring_transactions
           where user_id = p_user and is_active
             and ((auto_post and next_date <= today) or (not auto_post and next_date < today))
           for update
  loop
    anchor := coalesce(r.anchor_date, r.next_date);
    unit := case r.frequency when 'daily' then interval '1 day' when 'weekly' then interval '1 week'
                             when 'monthly' then interval '1 month' when 'yearly' then interval '1 year' end;
    k := 0;
    loop
      d := (anchor + unit * (k * r.interval_count))::date;
      exit when r.end_date is not null and d > r.end_date;
      exit when (r.auto_post and d > today) or (not r.auto_post and d >= today);
      if r.auto_post and d >= r.next_date then
        begin
          insert into public.transactions (user_id, type, date, amount, currency, sub_account_id, category_id, tags, notes,
            to_sub_account_id, to_amount, to_currency, source, source_id)
          values (r.user_id, r.type, d, r.amount, r.currency, r.sub_account_id, r.category_id, r.tags, coalesce(r.notes, r.name),
            r.to_sub_account_id, r.to_amount, r.to_currency, 'recurring', r.id)
          on conflict (source_id, date) where source = 'recurring' do nothing;
          n := n + 1;
        exception when others then
          raise warning 'recurring % on % not posted: %', r.id, d, sqlerrm;
        end;
      end if;
      k := k + 1;
    end loop;
    update public.recurring_transactions
      set next_date = d, anchor_date = anchor, is_active = (r.end_date is null or d <= r.end_date)
      where id = r.id;
  end loop;
  perform set_config('app.posting_recurring', '', true);
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Clouds: accrue only from the day the Cloud was set up (or last accrued), each day's
-- interest on that day's opening balance. Monthly payouts use the average daily balance of
-- the period and land on the same day of month as the start date.
-- ---------------------------------------------------------------------------
alter table public.sub_accounts add column if not exists yield_accrued_through date;

update public.sub_accounts s
   set yield_accrued_through = coalesce(
         (select max(t.date) from public.transactions t where t.sub_account_id = s.id and t.source_id = s.id),
         public.app_today())
 where s.yield_rate is not null and s.yield_accrued_through is null;

create or replace function public.sub_accounts_yield_trigger()
returns trigger language plpgsql as $$
begin
  if new.yield_rate is null then
    new.yield_accrued_through := null;
  elsif tg_op = 'INSERT' then
    -- the balance entered today already includes any interest earned before today
    new.yield_accrued_through := coalesce(new.yield_accrued_through, public.app_today());
  elsif old.yield_rate is null or new.yield_frequency is distinct from old.yield_frequency
        or new.yield_since is distinct from old.yield_since then
    new.yield_accrued_through := public.app_today();
  end if;
  return new;
end $$;

drop trigger if exists sub_accounts_yield on public.sub_accounts;
create trigger sub_accounts_yield before insert or update on public.sub_accounts
for each row execute function public.sub_accounts_yield_trigger();

create or replace function public.accrue_yield(p_user uuid default auth.uid())
returns integer language plpgsql security definer set search_path = public as $$
declare
  s record; d date; prev date; k integer; amt numeric; bal numeric; n integer := 0; cat uuid; acc_name text;
  today date := public.app_today(); through date;
begin
  perform public.assert_owner(p_user);
  select id into cat from public.categories where user_id = p_user and kind = 'income' and lower(name) = 'interest' limit 1;

  for s in select sa.*, a.name as account_name from public.sub_accounts sa join public.accounts a on a.id = sa.account_id
           where sa.user_id = p_user and sa.yield_rate is not null and sa.yield_frequency is not null
             and not sa.is_archived and not a.is_archived
           for update of sa
  loop
    acc_name := coalesce(s.name, 'Cloud') || ' · ' || s.account_name;
    through := coalesce(s.yield_accrued_through, today);

    if s.yield_frequency = 'daily' then
      d := through + 1;
      while d <= today loop
        bal := public.balance_as_of(s.id, d - 1);            -- opening balance of day d (compounds past postings)
        amt := round(bal * s.yield_rate / 100 / 365, 4);
        if amt > 0 then
          insert into public.transactions (user_id, type, date, amount, currency, sub_account_id, category_id, notes, source, source_id)
          values (p_user, 'income', d, amt, s.currency, s.id, cat, acc_name || ' daily yield', 'yield', s.id)
          on conflict (sub_account_id, date) where source_id = sub_account_id do nothing;
          n := n + 1;
        end if;
        d := d + 1;
      end loop;
    elsif s.yield_since is not null then
      k := 1;
      loop
        d := (s.yield_since + make_interval(months => k))::date;
        exit when d > today;
        if d > through then
          prev := (s.yield_since + make_interval(months => k - 1))::date;
          select avg(public.balance_as_of(s.id, x::date)) into bal
            from generate_series(prev, d - 1, interval '1 day') as x;
          amt := round(coalesce(bal, 0) * s.yield_rate / 100 / 12, 4);
          if amt > 0 then
            insert into public.transactions (user_id, type, date, amount, currency, sub_account_id, category_id, notes, source, source_id)
            values (p_user, 'income', d, amt, s.currency, s.id, cat, acc_name || ' monthly yield', 'yield', s.id)
            on conflict (sub_account_id, date) where source_id = sub_account_id do nothing;
            n := n + 1;
          end if;
        end if;
        k := k + 1;
      end loop;
    end if;

    update public.sub_accounts set yield_accrued_through = today where id = s.id and yield_accrued_through is distinct from today;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Manual gold prices win for 24 hours after they are set; after that the newest price wins.
-- ---------------------------------------------------------------------------
create or replace function public.gold_price_per_gram(p_user uuid, p_karat smallint, p_at timestamptz default now())
returns numeric language sql stable as $$
  select g.price_per_gram from public.gold_prices g
  where g.karat = p_karat and g.price_at <= p_at and (g.user_id is null or g.user_id = p_user)
  order by (g.user_id is not null and g.price_at > p_at - interval '24 hours') desc, g.price_at desc
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Snapshots and daily jobs use Cairo's date.
-- ---------------------------------------------------------------------------
create or replace function public.snapshot_net_worth(p_user uuid default auth.uid(), p_date date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_base text; v jsonb; v_date date := coalesce(p_date, public.app_today());
begin
  perform public.assert_owner(p_user);
  select base_currency into v_base from public.settings where user_id = p_user;
  v_base := coalesce(v_base, 'EGP');
  v := public.compute_net_worth(p_user, v_base, v_date);
  insert into public.net_worth_snapshots (user_id, snapshot_date, base_currency, total, by_class, by_currency)
  values (p_user, v_date, v_base, (v->>'total')::numeric, v->'by_class', v->'by_currency')
  on conflict (user_id, snapshot_date) do update
    set base_currency = excluded.base_currency, total = excluded.total,
        by_class = excluded.by_class, by_currency = excluded.by_currency;
  return v;
end $$;

create or replace function public.snapshot_all_users()
returns void language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  for u in select user_id from public.settings loop
    perform public.snapshot_net_worth(u, public.app_today());
  end loop;
end $$;

create or replace function public.run_daily_jobs()
returns void language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  for u in select user_id from public.settings loop
    perform public.post_due_recurring(u);
    perform public.process_certificate_payouts(u);
    perform public.accrue_yield(u);
    perform public.snapshot_net_worth(u, public.app_today());
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Permissions: nobody signed-out may call any function; signed-in users get the RPCs
-- (each one checks ownership itself); admin jobs are server-only.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
revoke execute on function public.snapshot_all_users() from authenticated;
revoke execute on function public.run_daily_jobs() from authenticated;
do $$
begin
  if to_regprocedure('public.prune_gold_prices()') is not null then
    execute 'revoke execute on function public.prune_gold_prices() from authenticated';
  end if;
  if to_regprocedure('public.call_edge_function(text)') is not null then
    execute 'revoke execute on function public.call_edge_function(text) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute 'grant execute on function public.handle_new_user() to supabase_auth_admin';
  end if;
end $$;
alter default privileges in schema public revoke execute on functions from public;
