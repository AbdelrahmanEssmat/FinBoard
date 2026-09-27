-- =============================================================================
-- 0008 – credit cards.
--   * New account type 'credit_card'. A card's balance goes below zero by what you owe: spending on
--     it is an expense on the card, paying it is a transfer from a bank into the card.
--   * Card settings on the account: credit limit (in the card's main currency), statement day,
--     payment due day and minimum payment %.
--   * Net worth: card balances form their own class, 'cards' = what you owe on cards (positive),
--     subtracted from the total and kept out of 'accounts' and the per-currency asset split.
--     Matches computeNetWorth in src/domain/networth.ts.
-- Safe to run as one transaction (the new enum value is only compared as text below) and to re-run.
-- =============================================================================

alter type public.account_type add value if not exists 'credit_card';

alter table public.accounts add column if not exists credit_limit numeric(20, 4) check (credit_limit is null or credit_limit >= 0);
alter table public.accounts add column if not exists statement_day smallint check (statement_day is null or statement_day between 1 and 31);
alter table public.accounts add column if not exists due_day smallint check (due_day is null or due_day between 1 and 31);
alter table public.accounts add column if not exists min_payment_pct numeric(6, 3) check (min_payment_pct is null or min_payment_pct between 0 and 100);

create or replace function public.compute_net_worth(p_user uuid, p_base text, p_date date default current_date)
returns jsonb language plpgsql stable as $$
declare
  v_cash numeric := 0; v_clouds numeric := 0; v_cert numeric := 0; v_inv numeric := 0; v_gold numeric := 0;
  v_recv numeric := 0; v_liab numeric := 0; v_cards numeric := 0;
  v_by_currency jsonb := '{}'::jsonb;
  r record; v numeric;
begin
  for r in
    select s.currency, (s.yield_rate is not null) as is_cloud, (a.type::text = 'credit_card') as is_card, sum(s.balance) as amt
    from public.sub_accounts s join public.accounts a on a.id = s.account_id
    where s.user_id = p_user and not s.is_archived and not a.is_archived
    group by s.currency, (s.yield_rate is not null), (a.type::text = 'credit_card')
  loop
    v := coalesce(public.convert_amount(p_user, r.amt, r.currency, p_base, p_date), 0);
    if r.is_card then
      -- a card balance is minus what you owe; it is debt, not an asset in that currency
      v_cards := v_cards + v;
      continue;
    end if;
    if r.is_cloud then v_clouds := v_clouds + v; else v_cash := v_cash + v; end if;
    v_by_currency := v_by_currency || jsonb_build_object(r.currency, coalesce((v_by_currency->>r.currency)::numeric, 0) + v);
  end loop;

  for r in select currency, sum(principal) as amt from public.certificates where user_id = p_user and not is_closed group by currency loop
    v := coalesce(public.convert_amount(p_user, r.amt, r.currency, p_base, p_date), 0);
    v_cert := v_cert + v;
    v_by_currency := v_by_currency || jsonb_build_object(r.currency, coalesce((v_by_currency->>r.currency)::numeric, 0) + v);
  end loop;

  for r in select currency, sum(units * current_price) as amt from public.holdings where user_id = p_user group by currency loop
    v := coalesce(public.convert_amount(p_user, r.amt, r.currency, p_base, p_date), 0);
    v_inv := v_inv + v;
    v_by_currency := v_by_currency || jsonb_build_object(r.currency, coalesce((v_by_currency->>r.currency)::numeric, 0) + v);
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
    v := coalesce(public.convert_amount(p_user, r.amt, r.currency, p_base, p_date), 0);
    if r.direction = 'owed_to_me' then v_recv := v_recv + v; else v_liab := v_liab + v; end if;
  end loop;

  return jsonb_build_object(
    'total', round(v_cash + v_clouds + v_cert + v_inv + v_gold + v_recv - v_liab + v_cards, 4),
    'by_class', jsonb_build_object(
      'accounts', round(v_cash, 4), 'clouds', round(v_clouds, 4), 'certificates', round(v_cert, 4),
      'investments', round(v_inv, 4), 'gold', round(v_gold, 4), 'receivables', round(v_recv, 4), 'liabilities', round(v_liab, 4),
      'cards', round(-v_cards, 4)),
    'by_currency', v_by_currency
  );
end $$;

-- -----------------------------------------------------------------------------
-- Fix (found while testing this migration): deleting a whole user failed when they had a debt
-- payment linked to an account. Deleting the user removes their transactions, which removes the
-- linked payments, which re-computes the debt's status: an update on a debt whose user row is
-- already gone, so the foreign key rejects it. A status change never alters a key, so that error
-- can only mean the user is being deleted: skip the update then.
-- -----------------------------------------------------------------------------
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
    begin
      update public.debts set status = case when v_paid >= v_amount then 'settled' else 'open' end::public.debt_status
      where id = v_debt_id;
    exception when foreign_key_violation then
      null; -- the owner is being deleted; the debt itself is about to go too
    end;
  end if;
  return null;
end $$;
