-- 0014: fixes found by the brute-force test (dev-local/fuzz.sql) and the area reviews of 2 Oct 2026.
--   1. a currency can't change once money is recorded in it (balances, holdings, certificates)
--   2. undoing a sale puts back the holding's price and average cost
--   3. correcting a Cloud's balance is a dated adjustment (interest for past days stays right)
--   4. Cloud interest: future start dates, monthly <-> daily switches, no day paid twice
--   5. editing a certificate never drops due payouts (logged/skipped rows matched by date)
--   6. categories: deleting a sub-category moves its spending to the parent; deleting a parent
--      keeps its sub-categories; no third level
--   7. the nightly job doesn't pay certificate interest into archived balances
--   8. moving a recurring transaction onto a date its rule already used is allowed
-- Safe to re-run.

alter type public.transaction_source add value if not exists 'adjustment';

-- ---------------------------------------------------------------------------
-- 1. currency guards (the edit forms already lock these fields)
-- ---------------------------------------------------------------------------
create or replace function public.sub_accounts_currency_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.currency is distinct from old.currency and (
       exists (select 1 from public.transactions where sub_account_id = old.id or to_sub_account_id = old.id)
    or exists (select 1 from public.recurring_transactions where sub_account_id = old.id or to_sub_account_id = old.id)
    or exists (select 1 from public.card_installment_plans where sub_account_id = old.id)) then
    raise exception 'This balance already has transactions in %, so its currency can''t change. Add another currency balance instead.', old.currency;
  end if;
  return new;
end $$;
drop trigger if exists sub_accounts_currency_guard on public.sub_accounts;
create trigger sub_accounts_currency_guard before update of currency on public.sub_accounts
  for each row execute function public.sub_accounts_currency_guard();

create or replace function public.holdings_currency_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.currency is distinct from old.currency and exists (select 1 from public.holding_sales where holding_id = old.id) then
    raise exception 'This holding has sales in %, so its currency can''t change.', old.currency;
  end if;
  return new;
end $$;
drop trigger if exists holdings_currency_guard on public.holdings;
create trigger holdings_currency_guard before update of currency on public.holdings
  for each row execute function public.holdings_currency_guard();

create or replace function public.certificates_currency_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.currency is distinct from old.currency
     and exists (select 1 from public.certificate_payouts where certificate_id = old.id and status = 'logged') then
    raise exception 'Interest from this certificate is already logged in %, so its currency can''t change.', old.currency;
  end if;
  return new;
end $$;
drop trigger if exists certificates_currency_guard on public.certificates;
create trigger certificates_currency_guard before update of currency on public.certificates
  for each row execute function public.certificates_currency_guard();

-- ---------------------------------------------------------------------------
-- 2. a sale remembers the price it replaced, so undoing it restores the price and the cost
-- ---------------------------------------------------------------------------
alter table public.holding_sales add column if not exists prev_price numeric(20, 6);
alter table public.holding_sales add column if not exists prev_price_at timestamptz;
alter table public.holding_sales add column if not exists set_price_at timestamptz;

create or replace function public.sell_holding(
  p_holding_id uuid, p_units numeric, p_price numeric, p_date date, p_fees numeric default 0,
  p_sub_account_id uuid default null, p_notes text default null,
  p_sale_id uuid default gen_random_uuid(), p_transaction_id uuid default gen_random_uuid())
returns uuid language plpgsql security definer set search_path = public as $$
declare
  h public.holdings%rowtype; s public.sub_accounts%rowtype;
  v_cost numeric; v_proceeds numeric; v_left numeric; tx uuid := null; v_reprice boolean;
begin
  select * into h from public.holdings where id = p_holding_id for update;
  if not found then raise exception 'holding not found'; end if;
  perform public.assert_owner(h.user_id);
  if exists (select 1 from public.holding_sales where id = p_sale_id) then return p_sale_id; end if;

  if p_units is null or p_units <= 0 then raise exception 'Enter how many units you sold'; end if;
  if p_units > h.units then raise exception 'You only hold % units', trim(to_char(h.units, 'FM999999999990.######')); end if;
  if p_price is null or p_price < 0 then raise exception 'Enter the sell price'; end if;
  if coalesce(p_fees, 0) < 0 then raise exception 'Fees can''t be negative'; end if;

  v_cost := round(h.avg_cost * p_units, 4);
  v_proceeds := round(p_units * p_price - coalesce(p_fees, 0), 4);
  v_left := h.units - p_units;
  -- the sale price is the latest market price, unless a newer price was already typed in
  v_reprice := h.price_updated_at is null or p_date >= (h.price_updated_at at time zone 'Africa/Cairo')::date;

  if p_sub_account_id is not null and v_proceeds > 0 then
    select * into s from public.sub_accounts where id = p_sub_account_id;
    if not found or s.user_id <> h.user_id then raise exception 'That account does not belong to you'; end if;
    if s.currency <> h.currency then raise exception 'The holding is in % but that account holds %', h.currency, s.currency; end if;
    insert into public.transactions (id, user_id, type, date, amount, currency, sub_account_id, notes, payee, source, source_id)
    values (p_transaction_id, h.user_id, 'income', p_date, v_proceeds, h.currency, s.id,
            'Sold ' || trim(to_char(p_units, 'FM999999999990.######')) || ' ' || h.name, h.name, 'investment', h.id)
    on conflict (id) do nothing;
    tx := p_transaction_id;
  end if;

  insert into public.holding_sales (id, user_id, holding_id, date, units, sell_price, fees, avg_cost, cost_basis, proceeds, realized,
                                    currency, bought_at, sub_account_id, transaction_id, notes, prev_price, prev_price_at, set_price_at)
  values (p_sale_id, h.user_id, h.id, p_date, p_units, p_price, coalesce(p_fees, 0), h.avg_cost, v_cost, v_proceeds, v_proceeds - v_cost,
          h.currency, h.bought_at, case when tx is null then null else p_sub_account_id end, tx, p_notes,
          case when v_reprice then h.current_price end, case when v_reprice then h.price_updated_at end, case when v_reprice then now() end);

  update public.holdings
     set units = v_left,
         closed_at = case when v_left = 0 then p_date else null end,
         current_price = case when v_reprice then p_price else current_price end,
         price_updated_at = case when v_reprice then now() else price_updated_at end
   where id = h.id;
  return p_sale_id;
end $$;

create or replace function public.holding_sales_after_delete_trigger()
returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.holdings where id = old.holding_id) then
    update public.holdings h
       set -- the units come back at the cost they were sold at
           avg_cost = case when h.units + old.units > 0
                           then round((h.units * h.avg_cost + old.units * old.avg_cost) / (h.units + old.units), 6) else h.avg_cost end,
           units = h.units + old.units,
           closed_at = null,
           -- and the price the sale set goes back, unless a newer price was entered since
           current_price = case when old.set_price_at is not null and h.price_updated_at = old.set_price_at
                                then coalesce(old.prev_price, h.current_price) else h.current_price end,
           price_updated_at = case when old.set_price_at is not null and h.price_updated_at = old.set_price_at
                                   then old.prev_price_at else h.price_updated_at end
     where h.id = old.holding_id;
    if old.transaction_id is not null
       and coalesce(current_setting('app.deleting_tx', true), '') <> old.transaction_id::text then
      delete from public.transactions where id = old.transaction_id;
    end if;
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- 3. set a balance; on a Cloud the difference is a dated adjustment, so interest already earned
--    on past days isn't recalculated as if the money had always been there (or never had)
-- ---------------------------------------------------------------------------
create or replace function public.set_sub_account_balance(p_sub_account_id uuid, p_balance numeric)
returns numeric language plpgsql set search_path = public as $$
declare s public.sub_accounts%rowtype; diff numeric; v numeric;
begin
  if p_balance is null then raise exception 'Enter a balance'; end if;
  select * into s from public.sub_accounts where id = p_sub_account_id for update;
  if not found then raise exception 'That balance no longer exists'; end if;
  diff := round(p_balance, 4) - s.balance;
  if diff = 0 then return s.balance; end if;
  if s.yield_rate is not null then
    insert into public.transactions (user_id, type, date, amount, currency, sub_account_id, notes, source)
    values (s.user_id, case when diff > 0 then 'income' else 'expense' end::public.transaction_type, public.app_today(), abs(diff),
            s.currency, s.id, 'Balance correction', 'adjustment');
  else
    update public.sub_accounts set opening_balance = opening_balance + diff where id = s.id;
  end if;
  select balance into v from public.sub_accounts where id = s.id;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Cloud interest
-- ---------------------------------------------------------------------------
create or replace function public.sub_accounts_yield_trigger()
returns trigger language plpgsql set search_path = public as $$
declare today date := public.app_today(); last_paid date;
begin
  if new.yield_rate is null then
    new.yield_accrued_through := null;
  elsif tg_op = 'INSERT' then
    -- the balance entered today already includes interest earned before today; a start date in
    -- the future means nothing is earned until then
    new.yield_accrued_through := coalesce(new.yield_accrued_through, greatest(today, coalesce(new.yield_since, today)));
  elsif old.yield_rate is null or new.yield_since is distinct from old.yield_since then
    new.yield_accrued_through := greatest(today, coalesce(new.yield_since, today));
  elsif new.yield_frequency is distinct from old.yield_frequency then
    if new.yield_frequency = 'daily' then
      -- from monthly: daily interest picks up where the last monthly payout (or the start) left off
      select max(date) into last_paid from public.transactions where sub_account_id = new.id and source = 'yield';
      new.yield_accrued_through := least(today, coalesce(greatest(last_paid, new.yield_since), last_paid, new.yield_since, today));
    else
      -- to monthly: the first monthly payout only counts the days after the last daily posting (accrue_yield)
      new.yield_accrued_through := today;
    end if;
  end if;
  return new;
end $$;

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
          -- days already paid by daily postings inside this period (the Cloud was daily until
          -- recently) are not paid again: count only the days from the last posting on
          select max(date) into last_d from public.transactions
           where sub_account_id = s.id and source = 'yield' and source_id = s.id and date > prev and date < d;
          start_d := greatest(prev, coalesce(last_d, prev));
          select sum(public.balance_as_of(s.id, x::date)) into bal
            from generate_series(start_d, d - 1, interval '1 day') as x;
          amt := round(coalesce(bal, 0) / (d - prev) * s.yield_rate / 100 / 12, 4);
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
-- 5. certificate schedule: a logged or skipped payout fills the slot its date falls in
--    (counting them assumed they were always the earliest ones, which dropped due payouts)
-- ---------------------------------------------------------------------------
create or replace function public.generate_certificate_payouts(p_certificate_id uuid)
returns void language plpgsql as $$
declare
  c public.certificates%rowtype; step interval; d date; prev_d date; amt numeric; n integer := 1;
begin
  select * into c from public.certificates where id = p_certificate_id;
  if not found then return; end if;

  delete from public.certificate_payouts where certificate_id = c.id and status = 'pending';
  amt := public.certificate_payout_amount(c.principal, c.interest_rate, c.payout_frequency, c.start_date, c.maturity_date);

  if c.payout_frequency = 'at_maturity' then
    if not exists (select 1 from public.certificate_payouts where certificate_id = c.id) then
      insert into public.certificate_payouts (user_id, certificate_id, due_date, amount)
      values (c.user_id, c.id, c.maturity_date, amt)
      on conflict (certificate_id, due_date) do nothing;
    end if;
    return;
  end if;

  step := case c.payout_frequency
    when 'monthly' then interval '1 month' when 'quarterly' then interval '3 months'
    when 'semi_annual' then interval '6 months' when 'annual' then interval '1 year' end;

  prev_d := c.start_date;
  loop
    d := (c.start_date + step * n)::date;
    exit when d > c.maturity_date;
    if not exists (select 1 from public.certificate_payouts
                   where certificate_id = c.id and due_date > prev_d and due_date <= d) then
      insert into public.certificate_payouts (user_id, certificate_id, due_date, amount)
      values (c.user_id, c.id, d, amt)
      on conflict (certificate_id, due_date) do nothing;
    end if;
    prev_d := d;
    n := n + 1;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 6. categories
-- ---------------------------------------------------------------------------
alter table public.categories drop constraint if exists categories_parent_id_fkey;
alter table public.categories add constraint categories_parent_id_fkey
  foreign key (parent_id) references public.categories(id) on delete set null;

-- deleting a sub-category: its spending and rules move to the parent instead of losing their category
create or replace function public.categories_before_delete()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.parent_id is not null then
    update public.transactions set category_id = old.parent_id where category_id = old.id;
    update public.recurring_transactions set category_id = old.parent_id where category_id = old.id;
  end if;
  return old;
end $$;
drop trigger if exists categories_before_delete on public.categories;
create trigger categories_before_delete before delete on public.categories
  for each row execute function public.categories_before_delete();

-- two levels only: a parent can't have a parent, a category with sub-categories can't move under another
create or replace function public.categories_parent_validate()
returns trigger language plpgsql set search_path = public as $$
declare p public.categories%rowtype;
begin
  if new.parent_id is null then return new; end if;
  if new.parent_id = new.id then raise exception 'A category can''t be inside itself'; end if;
  select * into p from public.categories where id = new.parent_id;
  if not found then raise exception 'That parent category no longer exists'; end if;
  if p.parent_id is not null then raise exception 'Sub-categories can''t have their own sub-categories'; end if;
  if p.kind <> new.kind then raise exception 'The parent must also be an % category', new.kind; end if;
  if tg_op = 'UPDATE' and exists (select 1 from public.categories where parent_id = new.id) then
    raise exception 'This category has sub-categories, so it can''t move under another one';
  end if;
  return new;
end $$;
drop trigger if exists categories_parent_validate on public.categories;
create trigger categories_parent_validate before insert or update of parent_id, kind on public.categories
  for each row execute function public.categories_parent_validate();

-- ---------------------------------------------------------------------------
-- 7. the nightly job skips payout balances that are archived (net worth ignores them)
-- ---------------------------------------------------------------------------
create or replace function public.process_certificate_payouts(p_user uuid default auth.uid())
returns integer language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  perform public.assert_owner(p_user);
  -- always in the same order, so two callers never wait on each other's locks
  for r in select p.id from public.certificate_payouts p
             join public.certificates c on c.id = p.certificate_id
             join public.sub_accounts s on s.id = c.payout_sub_account_id
             join public.accounts a on a.id = s.account_id
           where p.user_id = p_user and p.status = 'pending' and p.due_date <= public.app_today()
             and c.auto_log_income and not c.is_closed and not s.is_archived and not a.is_archived
           order by p.due_date, p.id
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
-- 8. a posted recurring transaction whose date the user changes becomes a normal transaction.
--    The rule's one-posting-per-date index treats the date as the occurrence: a moved posting
--    either clashed with another posting (raw error) or silently blocked a later one.
-- ---------------------------------------------------------------------------
create or replace function public.transactions_recurring_moved()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.source = 'recurring' and new.date is distinct from old.date
     and coalesce(current_setting('app.posting_recurring', true), '') <> 'on' then
    new.source := 'manual';
    new.source_id := null;
  end if;
  return new;
end $$;
drop trigger if exists transactions_recurring_moved on public.transactions;
create trigger transactions_recurring_moved before update of date on public.transactions
  for each row execute function public.transactions_recurring_moved();

-- ---------------------------------------------------------------------------
-- 9. recurring rules: resuming continues from today, the original day (e.g. the 31st) survives
--    frequency edits, a rule uses its balances' currencies, a failed posting is retried
-- ---------------------------------------------------------------------------
-- does a schedule starting at p_anchor land on p_target?
create or replace function public.recurring_hits(p_anchor date, p_frequency public.recurrence, p_interval integer, p_target date)
returns boolean language plpgsql immutable set search_path = public as $$
declare unit interval; k integer := 0; d date;
begin
  if p_anchor is null or p_target is null or p_target < p_anchor then return false; end if;
  unit := case p_frequency when 'daily' then interval '1 day' when 'weekly' then interval '1 week'
                           when 'monthly' then interval '1 month' when 'yearly' then interval '1 year' end;
  loop
    d := (p_anchor + unit * (k * greatest(p_interval, 1)))::date;
    if d >= p_target then return d = p_target; end if;
    k := k + 1;
    if k > 100000 then return false; end if;
  end loop;
end $$;

-- the first date of a schedule on or after p_from
create or replace function public.recurring_next_on_or_after(p_anchor date, p_frequency public.recurrence, p_interval integer, p_from date)
returns date language plpgsql immutable set search_path = public as $$
declare unit interval; k integer := 0; d date;
begin
  unit := case p_frequency when 'daily' then interval '1 day' when 'weekly' then interval '1 week'
                           when 'monthly' then interval '1 month' when 'yearly' then interval '1 year' end;
  loop
    d := (p_anchor + unit * (k * greatest(p_interval, 1)))::date;
    exit when d >= p_from or k > 100000;
    k := k + 1;
  end loop;
  return d;
end $$;

create or replace function public.recurring_anchor_trigger()
returns trigger language plpgsql set search_path = public as $$
declare anchor date;
begin
  if tg_op = 'INSERT' then
    new.anchor_date := coalesce(new.anchor_date, new.next_date);
    return new;
  end if;
  if coalesce(current_setting('app.posting_recurring', true), '') = 'on' then return new; end if;
  anchor := coalesce(old.anchor_date, old.next_date);
  -- turned back on after a pause: carry on from today instead of posting every missed period
  if new.is_active and not old.is_active and new.next_date = old.next_date and old.next_date < public.app_today() then
    new.next_date := public.recurring_next_on_or_after(anchor, new.frequency, new.interval_count, public.app_today());
  end if;
  if new.next_date is distinct from old.next_date or new.frequency is distinct from old.frequency
     or new.interval_count is distinct from old.interval_count then
    -- keep the original day while the schedule still lands on the next date; otherwise the user
    -- moved the schedule and the new next date becomes the anchor
    if public.recurring_hits(anchor, new.frequency, new.interval_count, new.next_date) then
      new.anchor_date := anchor;
    else
      new.anchor_date := new.next_date;
    end if;
  end if;
  return new;
end $$;

-- a rule must use its balances' currencies (like transactions), so its postings can't fail later
create or replace function public.recurring_validate_trigger()
returns trigger language plpgsql set search_path = public as $$
declare s_user uuid; s_cur text;
begin
  select user_id, currency into s_user, s_cur from public.sub_accounts where id = new.sub_account_id;
  if s_user is distinct from new.user_id then raise exception 'That account does not belong to you'; end if;
  if s_cur <> new.currency then raise exception 'Amount is in % but the account holds %', new.currency, s_cur; end if;
  if new.type = 'transfer' then
    select user_id, currency into s_user, s_cur from public.sub_accounts where id = new.to_sub_account_id;
    if s_user is distinct from new.user_id then raise exception 'That account does not belong to you'; end if;
    if s_cur <> new.to_currency then raise exception 'Received amount is in % but the account holds %', new.to_currency, s_cur; end if;
  end if;
  return new;
end $$;
drop trigger if exists recurring_validate on public.recurring_transactions;
create trigger recurring_validate before insert or update of type, amount, currency, sub_account_id, to_sub_account_id, to_amount, to_currency
  on public.recurring_transactions for each row execute function public.recurring_validate_trigger();

create or replace function public.post_due_recurring(p_user uuid default auth.uid())
returns integer language plpgsql security definer set search_path = public as $$
declare
  r record; n integer := 0; d date; k integer; unit interval; anchor date; today date := public.app_today(); failed boolean;
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
    failed := false;
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
          if found then n := n + 1; end if;
        exception when others then
          -- e.g. the account was archived: stop here and try this date again next time
          raise warning 'recurring % on % not posted: %', r.id, d, sqlerrm;
          failed := true;
        end;
        exit when failed;
      end if;
      k := k + 1;
    end loop;
    update public.recurring_transactions
       set next_date = d, anchor_date = anchor, is_active = failed or r.end_date is null or d <= r.end_date
     where id = r.id;
  end loop;
  perform set_config('app.posting_recurring', '', true);
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- 10. deleting an installment purchase takes its interest/fee expense with it
--     (deleting only the plan keeps both, by design)
-- ---------------------------------------------------------------------------
create or replace function public.card_installment_plans_after_delete()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.fees_transaction_id is not null and old.transaction_id is not null
     and not exists (select 1 from public.transactions where id = old.transaction_id) then
    delete from public.transactions where id = old.fees_transaction_id;
  end if;
  return null;
end $$;
drop trigger if exists card_installment_plans_after_delete on public.card_installment_plans;
create trigger card_installment_plans_after_delete after delete on public.card_installment_plans
  for each row execute function public.card_installment_plans_after_delete();

-- ---------------------------------------------------------------------------
-- permissions (see 0011)
-- ---------------------------------------------------------------------------
revoke execute on function public.recurring_hits(date, public.recurrence, integer, date) from public, anon;
grant execute on function public.recurring_hits(date, public.recurrence, integer, date) to authenticated, service_role;
revoke execute on function public.recurring_next_on_or_after(date, public.recurrence, integer, date) from public, anon;
grant execute on function public.recurring_next_on_or_after(date, public.recurrence, integer, date) to authenticated, service_role;
revoke execute on function public.recurring_anchor_trigger() from public, anon;
grant execute on function public.recurring_anchor_trigger() to authenticated, service_role;
revoke execute on function public.recurring_validate_trigger() from public, anon;
grant execute on function public.recurring_validate_trigger() to authenticated, service_role;
revoke execute on function public.post_due_recurring(uuid) from public, anon;
grant execute on function public.post_due_recurring(uuid) to authenticated, service_role;
revoke execute on function public.card_installment_plans_after_delete() from public, anon;
grant execute on function public.card_installment_plans_after_delete() to authenticated, service_role;
revoke execute on function public.sub_accounts_currency_guard() from public, anon;
grant execute on function public.sub_accounts_currency_guard() to authenticated, service_role;
revoke execute on function public.holdings_currency_guard() from public, anon;
grant execute on function public.holdings_currency_guard() to authenticated, service_role;
revoke execute on function public.certificates_currency_guard() from public, anon;
grant execute on function public.certificates_currency_guard() to authenticated, service_role;
revoke execute on function public.sell_holding(uuid, numeric, numeric, date, numeric, uuid, text, uuid, uuid) from public, anon;
grant execute on function public.sell_holding(uuid, numeric, numeric, date, numeric, uuid, text, uuid, uuid) to authenticated, service_role;
revoke execute on function public.holding_sales_after_delete_trigger() from public, anon;
grant execute on function public.holding_sales_after_delete_trigger() to authenticated, service_role;
revoke execute on function public.set_sub_account_balance(uuid, numeric) from public, anon;
grant execute on function public.set_sub_account_balance(uuid, numeric) to authenticated, service_role;
revoke execute on function public.sub_accounts_yield_trigger() from public, anon;
grant execute on function public.sub_accounts_yield_trigger() to authenticated, service_role;
revoke execute on function public.accrue_yield(uuid) from public, anon;
grant execute on function public.accrue_yield(uuid) to authenticated, service_role;
revoke execute on function public.generate_certificate_payouts(uuid) from public, anon;
grant execute on function public.generate_certificate_payouts(uuid) to authenticated, service_role;
revoke execute on function public.categories_before_delete() from public, anon;
grant execute on function public.categories_before_delete() to authenticated, service_role;
revoke execute on function public.categories_parent_validate() from public, anon;
grant execute on function public.categories_parent_validate() to authenticated, service_role;
revoke execute on function public.process_certificate_payouts(uuid) from public, anon;
grant execute on function public.process_certificate_payouts(uuid) to authenticated, service_role;
revoke execute on function public.transactions_recurring_moved() from public, anon;
grant execute on function public.transactions_recurring_moved() to authenticated, service_role;

notify pgrst, 'reload schema';
