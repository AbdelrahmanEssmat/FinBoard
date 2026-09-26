-- =============================================================================
-- Financial Tracker – initial schema
-- Postgres 15+ / Supabase. Run in the SQL editor or via `supabase db push`.
-- Every user table has user_id + Row Level Security so only the owner can
-- read or write. Amounts are NUMERIC (never float).
-- =============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.account_type        as enum ('bank', 'cash', 'investment', 'wallet', 'other');
create type public.transaction_type    as enum ('income', 'expense', 'transfer');
create type public.transaction_source  as enum ('manual', 'recurring', 'certificate', 'debt');
create type public.category_kind       as enum ('income', 'expense');
create type public.payout_frequency    as enum ('monthly', 'quarterly', 'semi_annual', 'annual', 'at_maturity');
create type public.payout_status       as enum ('pending', 'logged', 'skipped');
create type public.gold_type           as enum ('bar', 'coin', 'jewelry');
create type public.debt_direction      as enum ('i_owe', 'owed_to_me');
create type public.debt_status         as enum ('open', 'settled');
create type public.rate_source         as enum ('api', 'manual');
create type public.gold_price_source   as enum ('local', 'global', 'manual');
create type public.recurrence          as enum ('daily', 'weekly', 'monthly', 'yearly');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Currencies (per user, editable list)
-- ---------------------------------------------------------------------------
create table public.currencies (
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  code        text not null check (code ~ '^[A-Z]{3}$'),
  name        text not null,
  symbol      text not null,
  decimals    smallint not null default 2 check (decimals between 0 and 4),
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, code)
);

-- ---------------------------------------------------------------------------
-- Settings (one row per user)
-- ---------------------------------------------------------------------------
create table public.settings (
  user_id        uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  base_currency  text not null default 'EGP',
  defaults       jsonb not null default '{}'::jsonb,   -- last-used account/currency etc.
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Exchange rates. base is always USD. Global rows have user_id NULL (written by
-- the edge function with the service role); manual overrides are per user.
-- ---------------------------------------------------------------------------
create table public.exchange_rates (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  quote       text not null check (quote ~ '^[A-Z]{3}$'),
  rate        numeric(20, 8) not null check (rate > 0),   -- 1 USD = rate QUOTE
  rate_date   date not null default current_date,
  source      public.rate_source not null default 'api',
  fetched_at  timestamptz not null default now(),
  provider    text,
  created_at  timestamptz not null default now(),
  -- one row per (owner, currency, day); NULL owner = global row (Postgres 15+)
  constraint exchange_rates_owner_quote_day unique nulls not distinct (user_id, quote, rate_date)
);
create index exchange_rates_lookup on public.exchange_rates (quote, rate_date desc);

-- ---------------------------------------------------------------------------
-- Accounts + sub-accounts (one sub-account per currency inside an account)
-- ---------------------------------------------------------------------------
create table public.accounts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  type        public.account_type not null default 'bank',
  color       text not null default '#3b82f6',
  icon        text not null default 'landmark',
  notes       text,
  is_archived boolean not null default false,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index accounts_user on public.accounts (user_id);

create table public.sub_accounts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account_id       uuid not null references public.accounts(id) on delete cascade,
  currency         text not null,
  name             text,                                   -- optional label, e.g. "Savings"
  opening_balance  numeric(20, 4) not null default 0,
  balance          numeric(20, 4) not null default 0,      -- maintained by trigger
  is_archived      boolean not null default false,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index sub_accounts_account on public.sub_accounts (account_id);
create index sub_accounts_user on public.sub_accounts (user_id);

-- ---------------------------------------------------------------------------
-- Categories, tags
-- ---------------------------------------------------------------------------
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  parent_id   uuid references public.categories(id) on delete cascade,
  kind        public.category_kind not null,
  name        text not null,
  icon        text not null default 'tag',
  color       text not null default '#64748b',
  is_archived boolean not null default false,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index categories_user on public.categories (user_id);

create table public.tags (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  color       text not null default '#64748b',
  created_at  timestamptz not null default now(),
  unique (user_id, name)
);

-- ---------------------------------------------------------------------------
-- Transactions
-- ---------------------------------------------------------------------------
create table public.transactions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type               public.transaction_type not null,
  date               date not null default current_date,
  amount             numeric(20, 4) not null check (amount >= 0),
  currency           text not null,
  sub_account_id     uuid not null references public.sub_accounts(id) on delete cascade,
  category_id        uuid references public.categories(id) on delete set null,
  tags               text[] not null default '{}',
  notes              text,
  payee              text,
  -- transfer target
  to_sub_account_id  uuid references public.sub_accounts(id) on delete cascade,
  to_amount          numeric(20, 4) check (to_amount is null or to_amount >= 0),
  to_currency        text,
  rate_used          numeric(20, 8),
  -- provenance
  source             public.transaction_source not null default 'manual',
  source_id          uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint transfer_fields check (
    (type = 'transfer' and to_sub_account_id is not null and to_amount is not null and to_currency is not null)
    or (type <> 'transfer' and to_sub_account_id is null)
  )
);
create index transactions_user_date on public.transactions (user_id, date desc);
create index transactions_sub_account on public.transactions (sub_account_id);
create index transactions_to_sub_account on public.transactions (to_sub_account_id);
create index transactions_category on public.transactions (category_id);
create index transactions_tags on public.transactions using gin (tags);
-- one posting per recurring rule per day
create unique index transactions_recurring_uniq on public.transactions (source_id, date) where source = 'recurring';

-- Balance maintenance ---------------------------------------------------------
create or replace function public.apply_transaction_delta(t public.transactions, sign integer)
returns void language plpgsql as $$
begin
  if t.type = 'income' then
    update public.sub_accounts set balance = balance + sign * t.amount where id = t.sub_account_id;
  elsif t.type = 'expense' then
    update public.sub_accounts set balance = balance - sign * t.amount where id = t.sub_account_id;
  elsif t.type = 'transfer' then
    update public.sub_accounts set balance = balance - sign * t.amount    where id = t.sub_account_id;
    update public.sub_accounts set balance = balance + sign * t.to_amount where id = t.to_sub_account_id;
  end if;
end $$;

create or replace function public.transactions_balance_trigger()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    perform public.apply_transaction_delta(new, 1);
  elsif tg_op = 'DELETE' then
    perform public.apply_transaction_delta(old, -1);
  elsif tg_op = 'UPDATE' then
    perform public.apply_transaction_delta(old, -1);
    perform public.apply_transaction_delta(new, 1);
  end if;
  return null;
end $$;

create trigger transactions_balance
after insert or update or delete on public.transactions
for each row execute function public.transactions_balance_trigger();

-- Recompute a sub-account from scratch (safety valve, also used when opening balance changes)
create or replace function public.recompute_sub_account_balance(p_sub_account_id uuid)
returns void language sql as $$
  update public.sub_accounts s
  set balance = s.opening_balance
    + coalesce((select sum(case when t.type = 'income' then t.amount else -t.amount end)
                from public.transactions t
                where t.sub_account_id = s.id and t.type <> 'transfer'), 0)
    - coalesce((select sum(t.amount) from public.transactions t
                where t.sub_account_id = s.id and t.type = 'transfer'), 0)
    + coalesce((select sum(t.to_amount) from public.transactions t
                where t.to_sub_account_id = s.id and t.type = 'transfer'), 0)
  where s.id = p_sub_account_id;
$$;

create or replace function public.sub_accounts_opening_trigger()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.balance = new.opening_balance;
  elsif new.opening_balance <> old.opening_balance then
    new.balance = old.balance + (new.opening_balance - old.opening_balance);
  end if;
  return new;
end $$;

create trigger sub_accounts_opening
before insert or update of opening_balance on public.sub_accounts
for each row execute function public.sub_accounts_opening_trigger();

-- ---------------------------------------------------------------------------
-- Recurring transactions
-- ---------------------------------------------------------------------------
create table public.recurring_transactions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name               text not null,
  type               public.transaction_type not null,
  amount             numeric(20, 4) not null check (amount >= 0),
  currency           text not null,
  sub_account_id     uuid not null references public.sub_accounts(id) on delete cascade,
  category_id        uuid references public.categories(id) on delete set null,
  tags               text[] not null default '{}',
  notes              text,
  to_sub_account_id  uuid references public.sub_accounts(id) on delete cascade,
  to_amount          numeric(20, 4),
  to_currency        text,
  frequency          public.recurrence not null default 'monthly',
  interval_count     integer not null default 1 check (interval_count >= 1),
  next_date          date not null,
  end_date           date,
  auto_post          boolean not null default true,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index recurring_user on public.recurring_transactions (user_id, next_date);

-- ---------------------------------------------------------------------------
-- Budgets (monthly, per category)
-- ---------------------------------------------------------------------------
create table public.budgets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category_id  uuid not null references public.categories(id) on delete cascade,
  amount       numeric(20, 4) not null check (amount >= 0),
  currency     text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, category_id)
);

-- ---------------------------------------------------------------------------
-- Certificates / deposits
-- ---------------------------------------------------------------------------
create table public.certificates (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account_id            uuid not null references public.accounts(id) on delete cascade,
  name                  text not null,
  principal             numeric(20, 4) not null check (principal >= 0),
  currency              text not null,
  interest_rate         numeric(8, 4) not null check (interest_rate >= 0),   -- annual %
  payout_frequency      public.payout_frequency not null default 'monthly',
  start_date            date not null,
  maturity_date         date not null,
  auto_log_income       boolean not null default false,
  payout_sub_account_id uuid references public.sub_accounts(id) on delete set null,
  notes                 text,
  is_closed             boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (maturity_date > start_date)
);
create index certificates_user on public.certificates (user_id);

create table public.certificate_payouts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  certificate_id  uuid not null references public.certificates(id) on delete cascade,
  due_date        date not null,
  amount          numeric(20, 4) not null,
  status          public.payout_status not null default 'pending',
  transaction_id  uuid references public.transactions(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (certificate_id, due_date)
);
create index certificate_payouts_due on public.certificate_payouts (user_id, status, due_date);

-- Payout amount for one period
create or replace function public.certificate_payout_amount(
  p_principal numeric, p_rate numeric, p_frequency public.payout_frequency, p_start date, p_maturity date
) returns numeric language sql immutable as $$
  select round(case p_frequency
    when 'monthly'     then p_principal * p_rate / 100 / 12
    when 'quarterly'   then p_principal * p_rate / 100 / 4
    when 'semi_annual' then p_principal * p_rate / 100 / 2
    when 'annual'      then p_principal * p_rate / 100
    when 'at_maturity' then p_principal * p_rate / 100 * (p_maturity - p_start) / 365.0
  end, 4);
$$;

-- (Re)generate the pending payout schedule for a certificate, keeping logged/skipped rows.
create or replace function public.generate_certificate_payouts(p_certificate_id uuid)
returns void language plpgsql as $$
declare
  c       public.certificates%rowtype;
  step    interval;
  d       date;
  amt     numeric;
  n       integer := 1;
begin
  select * into c from public.certificates where id = p_certificate_id;
  if not found then return; end if;

  delete from public.certificate_payouts where certificate_id = c.id and status = 'pending';

  amt := public.certificate_payout_amount(c.principal, c.interest_rate, c.payout_frequency, c.start_date, c.maturity_date);

  if c.payout_frequency = 'at_maturity' then
    insert into public.certificate_payouts (user_id, certificate_id, due_date, amount)
    values (c.user_id, c.id, c.maturity_date, amt)
    on conflict (certificate_id, due_date) do nothing;
    return;
  end if;

  step := case c.payout_frequency
    when 'monthly' then interval '1 month'
    when 'quarterly' then interval '3 months'
    when 'semi_annual' then interval '6 months'
    when 'annual' then interval '1 year' end;

  loop
    d := (c.start_date + step * n)::date;
    exit when d > c.maturity_date;
    insert into public.certificate_payouts (user_id, certificate_id, due_date, amount)
    values (c.user_id, c.id, d, amt)
    on conflict (certificate_id, due_date) do nothing;
    n := n + 1;
  end loop;
end $$;

create or replace function public.certificates_schedule_trigger()
returns trigger language plpgsql as $$
begin
  perform public.generate_certificate_payouts(new.id);
  return null;
end $$;

create trigger certificates_schedule
after insert or update of principal, interest_rate, payout_frequency, start_date, maturity_date
on public.certificates
for each row execute function public.certificates_schedule_trigger();

-- ---------------------------------------------------------------------------
-- Investments
-- ---------------------------------------------------------------------------
create table public.investment_categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

create table public.holdings (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account_id        uuid not null references public.accounts(id) on delete cascade,
  category_id       uuid references public.investment_categories(id) on delete set null,
  name              text not null,
  ticker            text,
  units             numeric(20, 6) not null default 0 check (units >= 0),
  avg_cost          numeric(20, 6) not null default 0 check (avg_cost >= 0),
  current_price     numeric(20, 6) not null default 0 check (current_price >= 0),
  currency          text not null,
  price_updated_at  timestamptz,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index holdings_user on public.holdings (user_id);

-- ---------------------------------------------------------------------------
-- Gold
-- ---------------------------------------------------------------------------
create table public.gold_items (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name               text,
  karat              smallint not null check (karat in (24, 22, 21, 18)),
  weight_grams       numeric(12, 4) not null check (weight_grams > 0),
  type               public.gold_type not null default 'bar',
  purchase_price     numeric(20, 4) not null default 0,   -- total paid for the metal
  purchase_currency  text not null default 'EGP',
  workmanship_cost   numeric(20, 4) not null default 0,   -- masna'ya, jewelry only
  purchase_date      date,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index gold_items_user on public.gold_items (user_id);

-- EGP price per gram by karat. Global rows: user_id NULL. Manual per user.
create table public.gold_prices (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users(id) on delete cascade,
  karat           smallint not null check (karat in (24, 22, 21, 18)),
  price_per_gram  numeric(20, 4) not null check (price_per_gram > 0),
  currency        text not null default 'EGP',
  source          public.gold_price_source not null default 'local',
  source_name     text,
  price_at        timestamptz not null default now(),
  created_at      timestamptz not null default now()
);
create index gold_prices_lookup on public.gold_prices (karat, price_at desc);

-- ---------------------------------------------------------------------------
-- Debts and people
-- ---------------------------------------------------------------------------
create table public.contacts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  phone       text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.debts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  contact_id       uuid not null references public.contacts(id) on delete cascade,
  direction        public.debt_direction not null,
  amount           numeric(20, 4) not null check (amount >= 0),
  currency         text not null,
  date             date not null default current_date,
  due_date         date,
  reason           text,
  notes            text,
  -- optional installment plan
  plan_count       integer check (plan_count is null or plan_count >= 1),
  plan_amount      numeric(20, 4),
  plan_frequency   public.recurrence,
  plan_start_date  date,
  status           public.debt_status not null default 'open',
  -- if set, the original loan moved money in/out of this sub-account
  sub_account_id   uuid references public.sub_accounts(id) on delete set null,
  transaction_id   uuid references public.transactions(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index debts_user on public.debts (user_id, status);

create table public.debt_payments (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  debt_id         uuid not null references public.debts(id) on delete cascade,
  amount          numeric(20, 4) not null check (amount > 0),
  date            date not null default current_date,
  sub_account_id  uuid references public.sub_accounts(id) on delete set null,
  transaction_id  uuid references public.transactions(id) on delete set null,
  notes           text,
  created_at      timestamptz not null default now()
);
create index debt_payments_debt on public.debt_payments (debt_id);

-- When a payment is deleted, remove its linked transaction (and vice versa).
-- A session setting guards against the two triggers deleting each other's row twice.
create or replace function public.debt_payments_cleanup_trigger()
returns trigger language plpgsql as $$
begin
  if old.transaction_id is not null
     and coalesce(current_setting('app.deleting_tx', true), '') <> old.transaction_id::text then
    delete from public.transactions where id = old.transaction_id;
  end if;
  return old;
end $$;
create trigger debt_payments_cleanup after delete on public.debt_payments
for each row execute function public.debt_payments_cleanup_trigger();

-- BEFORE delete so the linked rows are still pointing at this transaction
-- (the FK "on delete set null" actions run before AFTER triggers).
create or replace function public.transactions_cleanup_trigger()
returns trigger language plpgsql as $$
begin
  if old.source = 'debt' then
    perform set_config('app.deleting_tx', old.id::text, true);
    delete from public.debt_payments where transaction_id = old.id;
    update public.debts set transaction_id = null where transaction_id = old.id;
    perform set_config('app.deleting_tx', '', true);
  elsif old.source = 'certificate' then
    update public.certificate_payouts set status = 'pending', transaction_id = null where transaction_id = old.id;
  end if;
  return old;
end $$;
create trigger transactions_cleanup before delete on public.transactions
for each row execute function public.transactions_cleanup_trigger();

-- Auto-settle a debt when fully paid; reopen if a payment is removed.
create or replace function public.debts_settle_trigger()
returns trigger language plpgsql as $$
declare
  v_debt_id uuid := coalesce(new.debt_id, old.debt_id);
  v_paid numeric;
  v_amount numeric;
begin
  select coalesce(sum(amount), 0) into v_paid from public.debt_payments where debt_id = v_debt_id;
  select amount into v_amount from public.debts where id = v_debt_id;
  if v_amount is not null then
    update public.debts set status = case when v_paid >= v_amount then 'settled' else 'open' end::public.debt_status
    where id = v_debt_id;
  end if;
  return null;
end $$;
create trigger debts_settle after insert or update or delete on public.debt_payments
for each row execute function public.debts_settle_trigger();

-- ---------------------------------------------------------------------------
-- Net worth snapshots
-- ---------------------------------------------------------------------------
create table public.net_worth_snapshots (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  snapshot_date  date not null,
  base_currency  text not null,
  total          numeric(20, 4) not null,
  by_class       jsonb not null default '{}'::jsonb,
  by_currency    jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  unique (user_id, snapshot_date)
);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['currencies','settings','accounts','sub_accounts','categories','transactions',
    'recurring_transactions','budgets','certificates','certificate_payouts','holdings','gold_items','contacts','debts']
  loop
    execute format('create trigger %I_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Rate helpers (usable from SQL functions and via RPC)
-- ---------------------------------------------------------------------------
-- 1 USD = ? p_currency on/before p_date for the given user (manual wins on the same date).
create or replace function public.usd_rate(p_user uuid, p_currency text, p_date date)
returns numeric language sql stable as $$
  select case when p_currency = 'USD' then 1::numeric else (
    select r.rate from public.exchange_rates r
    where r.quote = p_currency and r.rate_date <= p_date
      and (r.user_id is null or r.user_id = p_user)
    order by r.rate_date desc, (r.user_id is not null) desc, r.fetched_at desc
    limit 1) end;
$$;

create or replace function public.convert_amount(p_user uuid, p_amount numeric, p_from text, p_to text, p_date date)
returns numeric language plpgsql stable as $$
declare
  rf numeric; rt numeric;
begin
  if p_from = p_to then return p_amount; end if;
  rf := public.usd_rate(p_user, p_from, p_date);
  rt := public.usd_rate(p_user, p_to, p_date);
  if rf is null or rt is null then return null; end if;
  return p_amount / rf * rt;
end $$;

-- Latest EGP gold price per gram for a karat (manual wins when newer or same time).
create or replace function public.gold_price_per_gram(p_user uuid, p_karat smallint, p_at timestamptz default now())
returns numeric language sql stable as $$
  select g.price_per_gram from public.gold_prices g
  where g.karat = p_karat and g.price_at <= p_at and (g.user_id is null or g.user_id = p_user)
  order by g.price_at desc, (g.user_id is not null) desc
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Net worth calculation + snapshot
-- ---------------------------------------------------------------------------
create or replace function public.compute_net_worth(p_user uuid, p_base text, p_date date default current_date)
returns jsonb language plpgsql stable as $$
declare
  v_cash numeric := 0; v_cert numeric := 0; v_inv numeric := 0; v_gold numeric := 0;
  v_recv numeric := 0; v_liab numeric := 0;
  v_by_currency jsonb := '{}'::jsonb;
  r record;
begin
  -- accounts (all non-archived sub-accounts)
  for r in
    select s.currency, sum(s.balance) as amt
    from public.sub_accounts s join public.accounts a on a.id = s.account_id
    where s.user_id = p_user and not s.is_archived and not a.is_archived
    group by s.currency
  loop
    v_cash := v_cash + coalesce(public.convert_amount(p_user, r.amt, r.currency, p_base, p_date), 0);
    v_by_currency := v_by_currency || jsonb_build_object(r.currency,
      coalesce((v_by_currency->>r.currency)::numeric, 0) + coalesce(public.convert_amount(p_user, r.amt, r.currency, p_base, p_date), 0));
  end loop;

  for r in select currency, sum(principal) as amt from public.certificates where user_id = p_user and not is_closed group by currency loop
    v_cert := v_cert + coalesce(public.convert_amount(p_user, r.amt, r.currency, p_base, p_date), 0);
    v_by_currency := v_by_currency || jsonb_build_object(r.currency,
      coalesce((v_by_currency->>r.currency)::numeric, 0) + coalesce(public.convert_amount(p_user, r.amt, r.currency, p_base, p_date), 0));
  end loop;

  for r in select currency, sum(units * current_price) as amt from public.holdings where user_id = p_user group by currency loop
    v_inv := v_inv + coalesce(public.convert_amount(p_user, r.amt, r.currency, p_base, p_date), 0);
    v_by_currency := v_by_currency || jsonb_build_object(r.currency,
      coalesce((v_by_currency->>r.currency)::numeric, 0) + coalesce(public.convert_amount(p_user, r.amt, r.currency, p_base, p_date), 0));
  end loop;

  for r in select karat, sum(weight_grams) as grams from public.gold_items where user_id = p_user group by karat loop
    v_gold := v_gold + coalesce(public.convert_amount(p_user,
      r.grams * coalesce(public.gold_price_per_gram(p_user, r.karat, (p_date + 1)::timestamptz), 0), 'EGP', p_base, p_date), 0);
  end loop;
  if v_gold <> 0 then
    v_by_currency := v_by_currency || jsonb_build_object('EGP', coalesce((v_by_currency->>'EGP')::numeric, 0) + v_gold);
  end if;

  for r in
    select d.direction, d.currency,
           sum(d.amount - coalesce((select sum(p.amount) from public.debt_payments p where p.debt_id = d.id), 0)) as amt
    from public.debts d where d.user_id = p_user and d.status = 'open'
    group by d.direction, d.currency
  loop
    if r.direction = 'owed_to_me' then
      v_recv := v_recv + coalesce(public.convert_amount(p_user, r.amt, r.currency, p_base, p_date), 0);
    else
      v_liab := v_liab + coalesce(public.convert_amount(p_user, r.amt, r.currency, p_base, p_date), 0);
    end if;
  end loop;

  return jsonb_build_object(
    'total', round(v_cash + v_cert + v_inv + v_gold + v_recv - v_liab, 4),
    'by_class', jsonb_build_object(
      'accounts', round(v_cash, 4), 'certificates', round(v_cert, 4), 'investments', round(v_inv, 4),
      'gold', round(v_gold, 4), 'receivables', round(v_recv, 4), 'liabilities', round(v_liab, 4)),
    'by_currency', v_by_currency
  );
end $$;

-- Upsert today's snapshot for one user. Called by the app on open and by pg_cron nightly.
create or replace function public.snapshot_net_worth(p_user uuid default auth.uid(), p_date date default current_date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_base text; v jsonb;
begin
  if p_user is null then return null; end if;
  -- callers other than cron may only snapshot themselves
  if auth.uid() is not null and auth.uid() <> p_user then
    raise exception 'not allowed';
  end if;
  select base_currency into v_base from public.settings where user_id = p_user;
  v_base := coalesce(v_base, 'EGP');
  v := public.compute_net_worth(p_user, v_base, p_date);
  insert into public.net_worth_snapshots (user_id, snapshot_date, base_currency, total, by_class, by_currency)
  values (p_user, p_date, v_base, (v->>'total')::numeric, v->'by_class', v->'by_currency')
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
    perform public.snapshot_net_worth(u, current_date);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Scheduled jobs (run by pg_cron + the app on open): recurring + certificate payouts
-- ---------------------------------------------------------------------------
create or replace function public.post_due_recurring(p_user uuid default auth.uid())
returns integer language plpgsql security definer set search_path = public as $$
declare
  r record; n integer := 0; d date; step interval;
begin
  if p_user is null then return 0; end if;
  if auth.uid() is not null and auth.uid() <> p_user then raise exception 'not allowed'; end if;
  for r in select * from public.recurring_transactions
           where user_id = p_user and is_active and auto_post and next_date <= current_date
           for update
  loop
    step := case r.frequency
      when 'daily' then interval '1 day' when 'weekly' then interval '1 week'
      when 'monthly' then interval '1 month' when 'yearly' then interval '1 year' end * r.interval_count;
    d := r.next_date;
    while d <= current_date and (r.end_date is null or d <= r.end_date) loop
      insert into public.transactions (user_id, type, date, amount, currency, sub_account_id, category_id, tags, notes,
        to_sub_account_id, to_amount, to_currency, source, source_id)
      values (r.user_id, r.type, d, r.amount, r.currency, r.sub_account_id, r.category_id, r.tags, coalesce(r.notes, r.name),
        r.to_sub_account_id, r.to_amount, r.to_currency, 'recurring', r.id)
      on conflict (source_id, date) where source = 'recurring' do nothing;
      n := n + 1;
      d := (d + step)::date;
    end loop;
    update public.recurring_transactions
      set next_date = d, is_active = (r.end_date is null or d <= r.end_date)
      where id = r.id;
  end loop;
  return n;
end $$;

create or replace function public.log_certificate_payout(p_payout_id uuid, p_sub_account_id uuid default null, p_transaction_id uuid default gen_random_uuid())
returns uuid language plpgsql security definer set search_path = public as $$
declare
  p public.certificate_payouts%rowtype; c public.certificates%rowtype; s public.sub_accounts%rowtype; cat uuid;
begin
  select * into p from public.certificate_payouts where id = p_payout_id;
  if not found then raise exception 'payout not found'; end if;
  if auth.uid() is not null and auth.uid() <> p.user_id then raise exception 'not allowed'; end if;
  if p.status = 'logged' then return p.transaction_id; end if;
  select * into c from public.certificates where id = p.certificate_id;
  select * into s from public.sub_accounts where id = coalesce(p_sub_account_id, c.payout_sub_account_id);
  if not found then raise exception 'choose an account to receive the payout'; end if;
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
  if p_user is null then return 0; end if;
  if auth.uid() is not null and auth.uid() <> p_user then raise exception 'not allowed'; end if;
  for r in select p.id from public.certificate_payouts p join public.certificates c on c.id = p.certificate_id
           where p.user_id = p_user and p.status = 'pending' and p.due_date <= current_date
             and c.auto_log_income and c.payout_sub_account_id is not null and not c.is_closed
  loop
    perform public.log_certificate_payout(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.run_daily_jobs()
returns void language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  for u in select user_id from public.settings loop
    perform public.post_due_recurring(u);
    perform public.process_certificate_payouts(u);
    perform public.snapshot_net_worth(u, current_date);
  end loop;
end $$;

-- Record a debt payment + linked account transaction atomically (idempotent by ids).
create or replace function public.record_debt_payment(
  p_debt_id uuid, p_amount numeric, p_date date, p_sub_account_id uuid default null, p_notes text default null,
  p_payment_id uuid default gen_random_uuid(), p_transaction_id uuid default gen_random_uuid()
) returns uuid language plpgsql security definer set search_path = public as $$
declare d public.debts%rowtype; s public.sub_accounts%rowtype; c public.contacts%rowtype; tx uuid := null;
begin
  select * into d from public.debts where id = p_debt_id;
  if not found then raise exception 'debt not found'; end if;
  if auth.uid() is not null and auth.uid() <> d.user_id then raise exception 'not allowed'; end if;
  if exists (select 1 from public.debt_payments where id = p_payment_id) then return p_payment_id; end if;
  select * into c from public.contacts where id = d.contact_id;
  if p_sub_account_id is not null then
    select * into s from public.sub_accounts where id = p_sub_account_id;
    if found then
      insert into public.transactions (id, user_id, type, date, amount, currency, sub_account_id, notes, payee, source, source_id)
      values (p_transaction_id, d.user_id, case when d.direction = 'owed_to_me' then 'income' else 'expense' end::public.transaction_type,
              p_date, p_amount, d.currency, s.id,
              case when d.direction = 'owed_to_me' then 'Repayment from ' else 'Repayment to ' end || c.name, c.name, 'debt', d.id)
      on conflict (id) do nothing;
      tx := p_transaction_id;
    end if;
  end if;
  insert into public.debt_payments (id, user_id, debt_id, amount, date, sub_account_id, transaction_id, notes)
  values (p_payment_id, d.user_id, p_debt_id, p_amount, p_date, p_sub_account_id, tx, p_notes);
  return p_payment_id;
end $$;

-- ---------------------------------------------------------------------------
-- New user bootstrap: settings, currencies, categories, starter accounts
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  cash_id uuid; thndr_id uuid; c uuid;
begin
  insert into public.settings (user_id) values (new.id) on conflict do nothing;

  insert into public.currencies (user_id, code, name, symbol, decimals, is_active, sort_order) values
    (new.id, 'EGP', 'Egyptian Pound', 'E£', 2, true, 0),
    (new.id, 'USD', 'US Dollar', '$', 2, true, 1),
    (new.id, 'EUR', 'Euro', '€', 2, false, 2),
    (new.id, 'SAR', 'Saudi Riyal', 'SR', 2, false, 3),
    (new.id, 'AED', 'UAE Dirham', 'AED', 2, false, 4),
    (new.id, 'GBP', 'British Pound', '£', 2, false, 5)
  on conflict do nothing;

  -- expense categories
  insert into public.categories (user_id, kind, name, icon, color, sort_order) values
    (new.id, 'expense', 'Food & Groceries', 'shopping-basket', '#22c55e', 0),
    (new.id, 'expense', 'Restaurants & Cafés', 'coffee', '#f97316', 1),
    (new.id, 'expense', 'Transport & Fuel', 'car', '#3b82f6', 2),
    (new.id, 'expense', 'Housing & Rent', 'home', '#8b5cf6', 3),
    (new.id, 'expense', 'Utilities', 'zap', '#eab308', 4),
    (new.id, 'expense', 'Mobile & Internet', 'smartphone', '#06b6d4', 5),
    (new.id, 'expense', 'Health', 'heart-pulse', '#ef4444', 6),
    (new.id, 'expense', 'Shopping', 'shopping-bag', '#ec4899', 7),
    (new.id, 'expense', 'Entertainment', 'clapperboard', '#a855f7', 8),
    (new.id, 'expense', 'Subscriptions', 'repeat', '#14b8a6', 9),
    (new.id, 'expense', 'Education', 'graduation-cap', '#0ea5e9', 10),
    (new.id, 'expense', 'Family & Gifts', 'gift', '#f43f5e', 11),
    (new.id, 'expense', 'Travel', 'plane', '#6366f1', 12),
    (new.id, 'expense', 'Fees & Charges', 'receipt', '#64748b', 13),
    (new.id, 'expense', 'Other', 'circle-ellipsis', '#94a3b8', 14);
  -- income categories
  insert into public.categories (user_id, kind, name, icon, color, sort_order) values
    (new.id, 'income', 'Salary', 'briefcase', '#22c55e', 0),
    (new.id, 'income', 'Freelance', 'laptop', '#3b82f6', 1),
    (new.id, 'income', 'Interest', 'percent', '#eab308', 2),
    (new.id, 'income', 'Investment Returns', 'trending-up', '#8b5cf6', 3),
    (new.id, 'income', 'Gifts', 'gift', '#ec4899', 4),
    (new.id, 'income', 'Other', 'circle-ellipsis', '#94a3b8', 5);

  insert into public.investment_categories (user_id, name, sort_order) values
    (new.id, 'Stocks', 0), (new.id, 'Mutual funds', 1), (new.id, 'Gold funds', 2), (new.id, 'Other', 3);

  insert into public.accounts (user_id, name, type, color, icon, sort_order)
  values (new.id, 'Cash', 'cash', '#22c55e', 'wallet', 0) returning id into cash_id;
  insert into public.sub_accounts (user_id, account_id, currency) values (new.id, cash_id, 'EGP'), (new.id, cash_id, 'USD');

  insert into public.accounts (user_id, name, type, color, icon, sort_order)
  values (new.id, 'Thndr', 'investment', '#8b5cf6', 'trending-up', 1) returning id into thndr_id;
  insert into public.sub_accounts (user_id, account_id, currency, name) values (new.id, thndr_id, 'EGP', 'Cash balance');

  return new;
end $$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['currencies','settings','accounts','sub_accounts','categories','tags','transactions',
    'recurring_transactions','budgets','certificates','certificate_payouts','investment_categories','holdings',
    'gold_items','contacts','debts','debt_payments','net_worth_snapshots']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "owner_all" on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

alter table public.exchange_rates enable row level security;
create policy "read_global_or_own" on public.exchange_rates for select to authenticated
  using (user_id is null or user_id = auth.uid());
create policy "write_own" on public.exchange_rates for insert to authenticated with check (user_id = auth.uid());
create policy "update_own" on public.exchange_rates for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete_own" on public.exchange_rates for delete to authenticated using (user_id = auth.uid());

alter table public.gold_prices enable row level security;
create policy "read_global_or_own" on public.gold_prices for select to authenticated
  using (user_id is null or user_id = auth.uid());
create policy "write_own" on public.gold_prices for insert to authenticated with check (user_id = auth.uid());
create policy "delete_own" on public.gold_prices for delete to authenticated using (user_id = auth.uid());

-- Only the owner may call RPCs on their data (functions check auth.uid() themselves)
revoke execute on function public.snapshot_all_users() from public, anon, authenticated;
revoke execute on function public.run_daily_jobs() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: publish all user tables
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['currencies','settings','accounts','sub_accounts','categories','tags','transactions',
      'recurring_transactions','budgets','certificates','certificate_payouts','investment_categories','holdings',
      'gold_items','gold_prices','exchange_rates','contacts','debts','debt_payments','net_worth_snapshots']
    loop
      execute format('alter publication supabase_realtime add table public.%I', t);
    end loop;
  end if;
end $$;
