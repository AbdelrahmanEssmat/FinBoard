-- =============================================================================
-- 0009 – installment plans for credit card purchases.
--   The purchase is one expense on the card at its full price (so spending reports show what you
--   bought, when you bought it, and the bank blocks the full amount from the limit). The plan
--   spreads what's due over `months` statements: only one installment is billed per statement.
--   Interest / admin fees (if any) are a separate expense on the card and are spread too.
--   Settling early (closed_at) bills whatever is left on the next statement.
--   Deleting the purchase deletes its plan; deleting the plan keeps the purchase (it is then
--   simply a normal card purchase, billed in full).
-- Safe to run as one transaction and to re-run.
-- =============================================================================

create table if not exists public.card_installment_plans (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account_id           uuid not null references public.accounts(id) on delete cascade,
  sub_account_id       uuid not null references public.sub_accounts(id) on delete cascade,
  transaction_id       uuid references public.transactions(id) on delete cascade,
  fees_transaction_id  uuid references public.transactions(id) on delete set null,
  description          text not null,
  currency             text not null,
  principal            numeric(20, 4) not null check (principal > 0),
  fees                 numeric(20, 4) not null default 0 check (fees >= 0),
  months               smallint not null check (months between 2 and 120),
  purchase_date        date not null,
  first_billing_date   date not null,
  closed_at            date,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (first_billing_date >= purchase_date),
  check (closed_at is null or closed_at >= purchase_date)
);
create index if not exists card_installment_plans_user on public.card_installment_plans (user_id);
create index if not exists card_installment_plans_account on public.card_installment_plans (account_id);

alter table public.card_installment_plans enable row level security;
drop policy if exists "owner_all" on public.card_installment_plans;
create policy "owner_all" on public.card_installment_plans for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists card_installment_plans_updated_at on public.card_installment_plans;
create trigger card_installment_plans_updated_at before update on public.card_installment_plans
  for each row execute function public.set_updated_at();

-- A plan must sit on one of your own credit cards, on a balance of that card, in its currency.
create or replace function public.card_installment_plans_validate()
returns trigger language plpgsql as $$
declare s record;
begin
  select sa.user_id, sa.account_id, sa.currency, a.type::text as account_type
    into s
    from public.sub_accounts sa join public.accounts a on a.id = sa.account_id
   where sa.id = new.sub_account_id;
  if s is null or s.user_id <> new.user_id then
    raise exception 'That card balance was not found.';
  end if;
  if s.account_id <> new.account_id then
    raise exception 'The balance does not belong to that card.';
  end if;
  if s.account_type <> 'credit_card' then
    raise exception 'Installment plans are for credit cards only.';
  end if;
  if s.currency <> new.currency then
    raise exception 'The plan must be in the card balance''s currency (%).', s.currency;
  end if;
  return new;
end $$;
drop trigger if exists card_installment_plans_validate on public.card_installment_plans;
create trigger card_installment_plans_validate before insert or update on public.card_installment_plans
  for each row execute function public.card_installment_plans_validate();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'card_installment_plans') then
    execute 'alter publication supabase_realtime add table public.card_installment_plans';
  end if;
end $$;

grant select, insert, update, delete on public.card_installment_plans to authenticated;
