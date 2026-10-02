-- 0015: the daily jobs run on the server, sign-in gets a second step, reminders and crash
-- reports have somewhere to live, and the remaining small gaps are closed.
--   1. "today" follows each person's own time zone (settings.timezone), not always Cairo
--   2. the daily jobs run every hour on the server (pg_cron), per person, one failure never
--      stopping the rest; they also tidy old crash reports and reminders
--   3. Cloud rates have a history: a new rate counts from the day it is set
--   4. certificate payouts know the period they cover, so changing the payout frequency after
--      some were logged neither drops nor doubles interest
--   5. one-step saves for a new debt (with its money movement) and an installment purchase
--   6. reminders: the devices that receive them and what to send on which day
--   7. crash reports from the app
--   8. sign-in security: a second step (authenticator code) enforced on every table once a person
--      turns it on, and deleting your own account with all its data
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. each person's time zone
-- ---------------------------------------------------------------------------
alter table public.settings add column if not exists timezone text not null default 'Africa/Cairo';

create or replace function public.settings_timezone_validate()
returns trigger language plpgsql set search_path = public as $$
begin
  begin
    perform now() at time zone new.timezone;
  exception when others then
    raise exception 'Unknown time zone %', new.timezone;
  end;
  return new;
end $$;
drop trigger if exists settings_timezone_validate on public.settings;
create trigger settings_timezone_validate before insert or update of timezone on public.settings
  for each row execute function public.settings_timezone_validate();

-- today's date for the signed-in person (or the person a job is acting for), in their time zone
create or replace function public.app_today()
returns date language sql stable set search_path = public as $$
  select (now() at time zone coalesce((select s.timezone from public.settings s where s.user_id = auth.uid()), 'Africa/Cairo'))::date;
$$;

-- ---------------------------------------------------------------------------
-- 2. the daily jobs, per person
-- ---------------------------------------------------------------------------
create or replace function public.run_daily_jobs()
returns void language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  delete from public.app_errors where created_at < now() - interval '90 days';
  delete from public.reminders where remind_on < current_date - 30;
  for u in select user_id from public.settings loop
    begin
      -- act as that person, so "today" below is their own date
      perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
      perform public.post_due_recurring(u);
      perform public.process_certificate_payouts(u);
      perform public.accrue_yield(u);
      perform public.snapshot_net_worth(u, public.app_today());
    exception when others then
      raise warning 'daily jobs for % failed: %', u, sqlerrm;
    end;
  end loop;
  perform set_config('request.jwt.claims', '{}', true);
end $$;

-- ---------------------------------------------------------------------------
-- 3. Cloud rate history
-- ---------------------------------------------------------------------------
create table if not exists public.yield_rates (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  sub_account_id  uuid not null references public.sub_accounts(id) on delete cascade,
  effective_from  date not null,
  rate            numeric(8, 4) not null,
  created_at      timestamptz not null default now(),
  unique (sub_account_id, effective_from)
);
alter table public.yield_rates enable row level security;
drop policy if exists "owner_all" on public.yield_rates;
create policy "owner_all" on public.yield_rates for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- every Cloud has its rate from the beginning; a change counts from the day it is made
insert into public.yield_rates (user_id, sub_account_id, effective_from, rate)
select user_id, id, date '1900-01-01', yield_rate from public.sub_accounts where yield_rate is not null
on conflict (sub_account_id, effective_from) do nothing;

create or replace function public.sub_accounts_rate_history()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.yield_rate is null then return null; end if;
  if tg_op = 'INSERT' or old.yield_rate is null then
    insert into public.yield_rates (user_id, sub_account_id, effective_from, rate)
    values (new.user_id, new.id, date '1900-01-01', new.yield_rate)
    on conflict (sub_account_id, effective_from) do update set rate = excluded.rate;
  elsif new.yield_rate is distinct from old.yield_rate then
    insert into public.yield_rates (user_id, sub_account_id, effective_from, rate)
    values (new.user_id, new.id, public.app_today(), new.yield_rate)
    on conflict (sub_account_id, effective_from) do update set rate = excluded.rate;
  end if;
  return null;
end $$;
drop trigger if exists sub_accounts_rate_history on public.sub_accounts;
create trigger sub_accounts_rate_history after insert or update of yield_rate on public.sub_accounts
  for each row execute function public.sub_accounts_rate_history();

-- the yearly rate a Cloud earned on a day
create or replace function public.yield_rate_on(p_sub uuid, p_day date, p_default numeric)
returns numeric language sql stable set search_path = public as $$
  select coalesce((select r.rate from public.yield_rates r where r.sub_account_id = p_sub and r.effective_from <= p_day
                   order by r.effective_from desc limit 1), p_default);
$$;

create or replace function public.accrue_yield(p_user uuid default auth.uid())
returns integer language plpgsql security definer set search_path = public as $$
declare
  s record; d date; prev date; start_d date; last_d date; k integer; amt numeric; bal numeric; n integer := 0; cat uuid; acc_name text;
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
        amt := round(bal * public.yield_rate_on(s.id, d - 1, s.yield_rate) / 100 / 365, 4);
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
          -- days already paid by daily postings inside this period are not paid again
          select max(date) into last_d from public.transactions
           where sub_account_id = s.id and source = 'yield' and source_id = s.id and date > prev and date < d;
          start_d := greatest(prev, coalesce(last_d, prev));
          -- each day earns at the rate in force that day (a rate change counts from the day it was made)
          select sum(public.balance_as_of(s.id, x::date) * public.yield_rate_on(s.id, x::date, s.yield_rate)) into bal
            from generate_series(start_d, d - 1, interval '1 day') as x;
          amt := round(coalesce(bal, 0) / (d - prev) / 100 / 12, 4);
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

    update public.sub_accounts set yield_accrued_through = today
     where id = s.id and yield_accrued_through is distinct from today and coalesce(yield_accrued_through, today) <= today;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- 4. certificate payouts know the period they cover
-- ---------------------------------------------------------------------------
alter table public.certificate_payouts add column if not exists period_start date;

create or replace function public.payout_step(p_frequency public.payout_frequency)
returns interval language sql immutable as $$
  select case p_frequency when 'monthly' then interval '1 month' when 'quarterly' then interval '3 months'
                          when 'semi_annual' then interval '6 months' when 'annual' then interval '1 year' end;
$$;

-- whole months between two dates (a period of 28-31 days counts as one month)
create or replace function public.months_between_rounded(p_from date, p_to date)
returns integer language sql immutable as $$
  select (extract(year from age(p_to, p_from)) * 12 + extract(month from age(p_to, p_from))
          + case when extract(day from age(p_to, p_from)) >= 15 then 1 else 0 end)::integer;
$$;

-- existing payouts: the period before their due date in the certificate's schedule
update public.certificate_payouts p
   set period_start = coalesce((
         select max((c.start_date + public.payout_step(c.payout_frequency) * g)::date)
           from generate_series(0, 1200) g
          where (c.start_date + public.payout_step(c.payout_frequency) * g)::date < p.due_date), c.start_date)
  from public.certificates c
 where c.id = p.certificate_id and p.period_start is null;

-- Rebuild the pending schedule. Logged and skipped payouts count as months of interest already
-- settled; each becomes usable for the slots that end after its own period began, so
--   * skipping a future payout never cancels earlier ones that are still due,
--   * monthly -> quarterly after two monthly payouts leaves a payout for the missing month,
--   * quarterly -> monthly after a quarterly payout doesn't pay those three months again,
--   * a rate change doesn't re-price periods already logged, and moving the start date keeps
--     the payouts already logged in place.
create or replace function public.generate_certificate_payouts(p_certificate_id uuid)
returns void language plpgsql set search_path = public as $$
declare
  c public.certificates%rowtype; step interval; d date; prev_d date; amt numeric; n integer := 1;
  need integer; credit integer := 0; counted uuid[] := '{}'; p record; short integer;
begin
  select * into c from public.certificates where id = p_certificate_id;
  if not found then return; end if;

  delete from public.certificate_payouts where certificate_id = c.id and status = 'pending';
  amt := public.certificate_payout_amount(c.principal, c.interest_rate, c.payout_frequency, c.start_date, c.maturity_date);

  if c.payout_frequency = 'at_maturity' then
    need := greatest(public.months_between_rounded(c.start_date, c.maturity_date), 1);
    select coalesce(sum(public.months_between_rounded(coalesce(x.period_start, c.start_date), x.due_date)), 0) into credit
      from public.certificate_payouts x where x.certificate_id = c.id and x.status <> 'pending';
    if credit < need then
      insert into public.certificate_payouts (user_id, certificate_id, due_date, amount, period_start)
      values (c.user_id, c.id, c.maturity_date, round(amt * (need - credit) / need, 4),
              case when credit = 0 then c.start_date else (c.maturity_date - make_interval(months => need - credit))::date end)
      on conflict (certificate_id, due_date) do nothing;
    end if;
    return;
  end if;

  step := public.payout_step(c.payout_frequency);
  need := public.months_between_rounded(c.start_date, (c.start_date + step)::date);
  prev_d := c.start_date;
  loop
    d := (c.start_date + step * n)::date;
    exit when d > c.maturity_date;
    for p in select x.id, public.months_between_rounded(coalesce(x.period_start, c.start_date), x.due_date) as months
               from public.certificate_payouts x
              where x.certificate_id = c.id and x.status <> 'pending' and coalesce(x.period_start, c.start_date) < d
                and not (x.id = any(counted))
    loop
      credit := credit + p.months;
      counted := counted || p.id;
    end loop;
    if credit >= need then
      credit := credit - need;
    else
      short := need - credit;
      credit := 0;
      insert into public.certificate_payouts (user_id, certificate_id, due_date, amount, period_start)
      values (c.user_id, c.id, d, case when short = need then amt else round(amt * short / need, 4) end,
              case when short = need then prev_d else (d - make_interval(months => short))::date end)
      on conflict (certificate_id, due_date) do nothing;
    end if;
    prev_d := d;
    n := n + 1;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. one-step saves
-- ---------------------------------------------------------------------------
-- A new debt: the person (if new), the money movement (if an account is given) and the debt itself,
-- all or nothing. Safe to repeat with the same ids (offline queue, a retried Save).
create or replace function public.create_debt(
  p_id uuid, p_contact_id uuid, p_new_contact_name text, p_direction public.debt_direction,
  p_amount numeric, p_currency text, p_date date,
  p_due_date date default null, p_reason text default null, p_notes text default null,
  p_plan_count integer default null, p_plan_amount numeric default null, p_plan_frequency public.recurrence default null,
  p_plan_start_date date default null, p_sub_account_id uuid default null, p_transaction_id uuid default null)
returns uuid language plpgsql set search_path = public as $$
declare v_user uuid := auth.uid(); v_name text; s public.sub_accounts%rowtype; v_tx uuid := null;
begin
  if v_user is null then raise exception 'not allowed'; end if;
  if exists (select 1 from public.debts where id = p_id) then return p_id; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter an amount above zero'; end if;
  if p_contact_id is null then raise exception 'Choose who this debt is with'; end if;
  if nullif(btrim(p_new_contact_name), '') is not null then
    insert into public.contacts (id, user_id, name) values (p_contact_id, v_user, btrim(p_new_contact_name))
    on conflict (id) do nothing;
  end if;
  select name into v_name from public.contacts where id = p_contact_id;
  if v_name is null then raise exception 'Choose who this debt is with'; end if;
  if p_sub_account_id is not null then
    select * into s from public.sub_accounts where id = p_sub_account_id;
    if not found then raise exception 'That account no longer exists'; end if;
    if s.currency <> p_currency then raise exception 'The debt is in % but that account holds %', p_currency, s.currency; end if;
    v_tx := coalesce(p_transaction_id, gen_random_uuid());
    insert into public.transactions (id, user_id, type, date, amount, currency, sub_account_id, notes, payee, source, source_id)
    values (v_tx, v_user, case when p_direction = 'i_owe' then 'income' else 'expense' end::public.transaction_type,
            p_date, p_amount, p_currency, s.id,
            case when p_direction = 'i_owe' then 'Borrowed from ' else 'Lent to ' end || v_name, v_name, 'debt', p_id);
    -- (no "on conflict": a repeat returns above, so an id that is already taken is an error, never a
    -- silent link to someone else's transaction)
  end if;
  insert into public.debts (id, user_id, contact_id, direction, amount, currency, date, due_date, reason, notes,
                            plan_count, plan_amount, plan_frequency, plan_start_date, sub_account_id, transaction_id)
  values (p_id, v_user, p_contact_id, p_direction, p_amount, p_currency, p_date, p_due_date, nullif(btrim(p_reason), ''), nullif(btrim(p_notes), ''),
          p_plan_count, p_plan_amount, p_plan_frequency, p_plan_start_date, case when v_tx is null then null else s.id end, v_tx);
  return p_id;
end $$;

-- An installment purchase on a card: the purchase, its interest / fees (if any) and the plan,
-- all or nothing. Safe to repeat with the same ids.
create or replace function public.create_installment_purchase(
  p_plan_id uuid, p_purchase_tx_id uuid, p_fee_tx_id uuid, p_sub_account_id uuid, p_description text,
  p_category_id uuid, p_fee_category_id uuid, p_principal numeric, p_fees numeric, p_months integer,
  p_purchase_date date, p_first_billing_date date, p_purchase_notes text default null)
returns uuid language plpgsql set search_path = public as $$
declare v_user uuid := auth.uid(); s public.sub_accounts%rowtype; v_fee uuid := null; v_desc text := btrim(p_description);
begin
  if v_user is null then raise exception 'not allowed'; end if;
  if exists (select 1 from public.card_installment_plans where id = p_plan_id) then return p_plan_id; end if;
  if v_desc is null or v_desc = '' then raise exception 'Describe the purchase'; end if;
  if p_principal is null or p_principal <= 0 then raise exception 'Enter the price above zero'; end if;
  if coalesce(p_fees, 0) < 0 then raise exception 'Fees can''t be negative'; end if;
  select * into s from public.sub_accounts where id = p_sub_account_id;
  if not found then raise exception 'That card balance was not found.'; end if;
  insert into public.transactions (id, user_id, type, date, amount, currency, sub_account_id, category_id, payee, notes, source)
  values (p_purchase_tx_id, v_user, 'expense', p_purchase_date, p_principal, s.currency, s.id, p_category_id, v_desc, p_purchase_notes, 'manual');
  if coalesce(p_fees, 0) > 0 then
    v_fee := coalesce(p_fee_tx_id, gen_random_uuid());
    insert into public.transactions (id, user_id, type, date, amount, currency, sub_account_id, category_id, payee, source)
    values (v_fee, v_user, 'expense', p_purchase_date, p_fees, s.currency, s.id, p_fee_category_id, v_desc || ' · installment interest & fees', 'manual');
  end if;
  insert into public.card_installment_plans (id, user_id, account_id, sub_account_id, transaction_id, fees_transaction_id, description, currency,
                                             principal, fees, months, purchase_date, first_billing_date)
  values (p_plan_id, v_user, s.account_id, s.id, p_purchase_tx_id, v_fee, v_desc, s.currency,
          p_principal, coalesce(p_fees, 0), p_months, p_purchase_date, p_first_billing_date);
  return p_plan_id;
end $$;

-- ---------------------------------------------------------------------------
-- 6. reminders
-- ---------------------------------------------------------------------------
-- devices that receive reminders (one row per browser / installed app that turned them on)
create table if not exists public.push_subscriptions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint         text not null unique check (char_length(endpoint) <= 1000),
  p256dh           text not null check (char_length(p256dh) <= 200),
  auth             text not null check (char_length(auth) <= 100),
  user_agent       text check (char_length(user_agent) <= 500),
  created_at       timestamptz not null default now(),
  last_success_at  timestamptz
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "owner_all" on public.push_subscriptions;
create policy "owner_all" on public.push_subscriptions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- what to send on which day; the app works these out (no amounts in the text), the server sends them
create table if not exists public.reminders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  key         text not null check (char_length(key) <= 200),
  remind_on   date not null,
  title       text not null check (char_length(title) <= 120),
  body        text not null check (char_length(body) <= 300),
  url         text not null default '/' check (char_length(url) <= 300),
  sent_at     timestamptz,
  created_at  timestamptz not null default now(),
  unique (user_id, key, remind_on)
);
create index if not exists reminders_due on public.reminders (remind_on) where sent_at is null;
alter table public.reminders enable row level security;
drop policy if exists "owner_all" on public.reminders;
create policy "owner_all" on public.reminders for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- this device receives reminders for the signed-in person (a device used by someone else before
-- is moved over to them)
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not allowed'; end if;
  if not public.mfa_satisfied() then raise exception 'Enter your sign-in code first'; end if;
  if coalesce(p_endpoint, '') !~ '^https://' then raise exception 'That is not a push address'; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (v_user, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 500))
  on conflict (endpoint) do update set user_id = v_user, p256dh = excluded.p256dh, auth = excluded.auth,
                                     user_agent = excluded.user_agent, created_at = now();
end $$;

-- replace the person's upcoming (not yet sent) reminders with the app's current list
create or replace function public.replace_reminders(p_items jsonb)
returns integer language plpgsql set search_path = public as $$
declare v_user uuid := auth.uid(); n integer; today date := public.app_today();
begin
  if v_user is null then raise exception 'not allowed'; end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 300 then
    raise exception 'Too many reminders';
  end if;
  delete from public.reminders where user_id = v_user and remind_on >= today and sent_at is null;
  insert into public.reminders (user_id, key, remind_on, title, body, url)
  select v_user, left(x->>'key', 200), (x->>'remind_on')::date, left(x->>'title', 120), left(x->>'body', 300),
         coalesce(nullif(left(x->>'url', 300), ''), '/')
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
   where (x->>'remind_on')::date >= today and coalesce(x->>'key', '') <> '' and coalesce(x->>'title', '') <> ''
  on conflict (user_id, key, remind_on) do nothing;   -- one already sent today stays sent
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- 7. crash reports from the app (the owner reads them in the Supabase dashboard)
-- ---------------------------------------------------------------------------
create table if not exists public.app_errors (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  kind         text not null default 'error' check (char_length(kind) <= 40),
  message      text not null check (char_length(message) <= 2000),
  stack        text check (char_length(stack) <= 8000),
  url          text check (char_length(url) <= 500),
  app_version  text check (char_length(app_version) <= 40),
  user_agent   text check (char_length(user_agent) <= 500)
);
create index if not exists app_errors_recent on public.app_errors (created_at desc);
alter table public.app_errors enable row level security;
-- people can only send reports, never read them (not even their own)
drop policy if exists "insert_own" on public.app_errors;
create policy "insert_own" on public.app_errors for insert to authenticated with check (user_id = auth.uid());

-- at most 100 reports per person per day: the rest are dropped quietly
create or replace function public.app_errors_limit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.app_errors where user_id = new.user_id and created_at > now() - interval '1 day') >= 100 then
    return null;
  end if;
  return new;
end $$;
drop trigger if exists app_errors_limit on public.app_errors;
create trigger app_errors_limit before insert on public.app_errors for each row execute function public.app_errors_limit();

-- ---------------------------------------------------------------------------
-- 8. sign-in security
-- ---------------------------------------------------------------------------
-- true unless the person turned on a second sign-in step and this session hasn't passed it
create or replace function public.mfa_satisfied()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status::text = 'verified');
$$;

-- every table: with a second step turned on, a password alone opens nothing
do $$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  loop
    execute format('drop policy if exists "require_second_step" on public.%I', t.relname);
    execute format('create policy "require_second_step" on public.%I as restrictive for all to authenticated '
                   'using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()))', t.relname);
  end loop;
end $$;

-- delete your own account and everything in it. Needs a password typed in the last 10 minutes
-- (the app asks for it again) and the second step if it is on.
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_signed_in numeric;
begin
  if v_user is null then raise exception 'not allowed'; end if;
  if not public.mfa_satisfied() then raise exception 'Enter your sign-in code first'; end if;
  select max(case when (e->>'timestamp')::numeric > 100000000000 then (e->>'timestamp')::numeric / 1000 else (e->>'timestamp')::numeric end)
    into v_signed_in
    from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) e
   where e ? 'timestamp';
  if v_signed_in is null or v_signed_in < extract(epoch from now()) - 600 then
    raise exception 'For your safety, enter your password again first';
  end if;
  delete from auth.users where id = v_user;   -- every table removes the person's rows with it
end $$;

-- ---------------------------------------------------------------------------
-- 9. run the daily jobs on the server every hour (Supabase; skipped where pg_cron isn't available)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.unschedule(jobid) from cron.job where jobname = 'daily-jobs';
    perform cron.schedule('finboard-daily-jobs', '7 * * * *', 'select public.run_daily_jobs()');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- permissions (see 0011). Internal helpers aren't callable from the app.
-- ---------------------------------------------------------------------------
revoke execute on function public.settings_timezone_validate() from public, anon;
grant execute on function public.settings_timezone_validate() to authenticated, service_role;
revoke execute on function public.app_today() from public, anon;
grant execute on function public.app_today() to authenticated, service_role;
revoke execute on function public.run_daily_jobs() from public, anon, authenticated;
grant execute on function public.run_daily_jobs() to service_role;
revoke execute on function public.sub_accounts_rate_history() from public, anon;
grant execute on function public.sub_accounts_rate_history() to authenticated, service_role;
revoke execute on function public.yield_rate_on(uuid, date, numeric) from public, anon;
grant execute on function public.yield_rate_on(uuid, date, numeric) to authenticated, service_role;
revoke execute on function public.accrue_yield(uuid) from public, anon;
grant execute on function public.accrue_yield(uuid) to authenticated, service_role;
revoke execute on function public.payout_step(public.payout_frequency) from public, anon;
grant execute on function public.payout_step(public.payout_frequency) to authenticated, service_role;
revoke execute on function public.months_between_rounded(date, date) from public, anon;
grant execute on function public.months_between_rounded(date, date) to authenticated, service_role;
revoke execute on function public.generate_certificate_payouts(uuid) from public, anon;
grant execute on function public.generate_certificate_payouts(uuid) to authenticated, service_role;
revoke execute on function public.create_debt(uuid, uuid, text, public.debt_direction, numeric, text, date, date, text, text, integer, numeric, public.recurrence, date, uuid, uuid) from public, anon;
grant execute on function public.create_debt(uuid, uuid, text, public.debt_direction, numeric, text, date, date, text, text, integer, numeric, public.recurrence, date, uuid, uuid) to authenticated, service_role;
revoke execute on function public.create_installment_purchase(uuid, uuid, uuid, uuid, text, uuid, uuid, numeric, numeric, integer, date, date, text) from public, anon;
grant execute on function public.create_installment_purchase(uuid, uuid, uuid, uuid, text, uuid, uuid, numeric, numeric, integer, date, date, text) to authenticated, service_role;
revoke execute on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated, service_role;
revoke execute on function public.replace_reminders(jsonb) from public, anon;
grant execute on function public.replace_reminders(jsonb) to authenticated, service_role;
revoke execute on function public.app_errors_limit() from public, anon;
grant execute on function public.app_errors_limit() to authenticated, service_role;
revoke execute on function public.mfa_satisfied() from public, anon;
grant execute on function public.mfa_satisfied() to authenticated, service_role;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated, service_role;

notify pgrst, 'reload schema';
