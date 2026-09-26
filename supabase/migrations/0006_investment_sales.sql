-- =============================================================================
-- 0006 – selling holdings (stocks, funds, …) with realized profit/loss.
-- Run AFTER 0005. Safe to run as one transaction and safe to re-run: the new enum value is
-- only referenced as text or inside function bodies (evaluated later, after commit).
--
--  * holdings get a purchase date (for holding period) and closed_at (fully sold)
--  * holding_sales keeps every sale with its cost basis, proceeds and realized P/L
--  * sell_holding() records a sale atomically: checks units, reduces the holding, and can
--    deposit the proceeds into one of your accounts (same currency)
--  * deleting a sale restores the units and removes its deposit; deleting the deposit
--    transaction removes the sale
--  * sale deposits are money moving from an investment to cash: not income or spending
-- =============================================================================

alter type public.transaction_source add value if not exists 'investment';

alter table public.holdings add column if not exists bought_at date;
alter table public.holdings add column if not exists closed_at date;

create table if not exists public.holding_sales (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  holding_id      uuid not null references public.holdings(id) on delete cascade,
  date            date not null,
  units           numeric(20, 6) not null check (units > 0),
  sell_price      numeric(20, 6) not null check (sell_price >= 0),     -- per unit
  fees            numeric(20, 4) not null default 0 check (fees >= 0),
  avg_cost        numeric(20, 6) not null,                              -- buy price per unit at the time of the sale
  cost_basis      numeric(20, 4) not null,                              -- avg_cost × units
  proceeds        numeric(20, 4) not null,                              -- units × sell_price − fees
  realized        numeric(20, 4) not null,                              -- proceeds − cost_basis
  currency        text not null,
  bought_at       date,                                                 -- for the holding period
  sub_account_id  uuid references public.sub_accounts(id) on delete set null,
  transaction_id  uuid references public.transactions(id) on delete set null,
  notes           text,
  created_at      timestamptz not null default now()
);
create index if not exists holding_sales_user on public.holding_sales (user_id, date desc);
create index if not exists holding_sales_holding on public.holding_sales (holding_id);

alter table public.holding_sales enable row level security;
drop policy if exists "owner_all" on public.holding_sales;
create policy "owner_all" on public.holding_sales for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'holding_sales') then
    execute 'alter publication supabase_realtime add table public.holding_sales';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Sell units of a holding (idempotent by p_sale_id).
-- ---------------------------------------------------------------------------
create or replace function public.sell_holding(
  p_holding_id uuid, p_units numeric, p_price numeric, p_date date,
  p_fees numeric default 0, p_sub_account_id uuid default null, p_notes text default null,
  p_sale_id uuid default gen_random_uuid(), p_transaction_id uuid default gen_random_uuid()
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  h public.holdings%rowtype; s public.sub_accounts%rowtype;
  v_cost numeric; v_proceeds numeric; v_left numeric; tx uuid := null;
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
                                    currency, bought_at, sub_account_id, transaction_id, notes)
  values (p_sale_id, h.user_id, h.id, p_date, p_units, p_price, coalesce(p_fees, 0), h.avg_cost, v_cost, v_proceeds, v_proceeds - v_cost,
          h.currency, h.bought_at, case when tx is null then null else p_sub_account_id end, tx, p_notes);

  update public.holdings
     set units = v_left,
         closed_at = case when v_left = 0 then p_date else null end,
         -- the sale price is the latest market price, unless a newer price was already typed in
         current_price = case when h.price_updated_at is null or p_date >= (h.price_updated_at at time zone 'Africa/Cairo')::date
                              then p_price else current_price end,
         price_updated_at = case when h.price_updated_at is null or p_date >= (h.price_updated_at at time zone 'Africa/Cairo')::date
                                 then now() else price_updated_at end
   where id = h.id;
  return p_sale_id;
end $$;

-- Deleting a sale (undo) puts the units back and removes its deposit. When the whole holding is
-- being deleted the deposit is kept: that money really arrived in the account.
create or replace function public.holding_sales_after_delete_trigger()
returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.holdings where id = old.holding_id) then
    update public.holdings set units = units + old.units, closed_at = null where id = old.holding_id;
    if old.transaction_id is not null
       and coalesce(current_setting('app.deleting_tx', true), '') <> old.transaction_id::text then
      delete from public.transactions where id = old.transaction_id;
    end if;
  end if;
  return null;
end $$;

drop trigger if exists holding_sales_after_delete on public.holding_sales;
create trigger holding_sales_after_delete after delete on public.holding_sales
for each row execute function public.holding_sales_after_delete_trigger();

-- Deleting a sale's deposit from Activity removes the sale too (and restores the units).
create or replace function public.transactions_cleanup_trigger()
returns trigger language plpgsql as $$
begin
  if old.source::text = 'debt' then
    perform set_config('app.deleting_tx', old.id::text, true);
    delete from public.debt_payments where transaction_id = old.id;
    update public.debts set transaction_id = null where transaction_id = old.id;
    perform set_config('app.deleting_tx', '', true);
  elsif old.source::text = 'investment' then
    perform set_config('app.deleting_tx', old.id::text, true);
    delete from public.holding_sales where transaction_id = old.id;
    perform set_config('app.deleting_tx', '', true);
  elsif old.source::text = 'certificate' then
    update public.certificate_payouts set status = 'skipped', transaction_id = null where transaction_id = old.id;
  end if;
  return old;
end $$;

-- A balance that received sale money is linked to your investment history: archive it instead of deleting.
create or replace function public.sub_accounts_delete_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare cascading boolean := pg_trigger_depth() > 1;
begin
  if not exists (select 1 from auth.users where id = old.user_id) then return old; end if;
  if exists (
    select 1 from public.transactions t
    left join public.sub_accounts o on o.id = case when t.sub_account_id = old.id then t.to_sub_account_id else t.sub_account_id end
    where (t.sub_account_id = old.id or t.to_sub_account_id = old.id)
      and (
        t.source::text in ('debt', 'investment')
        or (t.type = 'transfer' and o.id is not null and o.id <> old.id and (not cascading or o.account_id <> old.account_id))
      )
  ) then
    raise exception 'This balance has transfers, debt payments or investment sales linked to other records. Archive it instead so your history stays correct.';
  end if;
  return old;
end $$;

-- same permission model as 0004: signed-in users only, each function checks ownership
revoke execute on function public.sell_holding(uuid, numeric, numeric, date, numeric, uuid, text, uuid, uuid) from public, anon;
grant execute on function public.sell_holding(uuid, numeric, numeric, date, numeric, uuid, text, uuid, uuid) to authenticated, service_role;
revoke execute on function public.holding_sales_after_delete_trigger() from public, anon;
grant execute on function public.holding_sales_after_delete_trigger() to authenticated, service_role;
