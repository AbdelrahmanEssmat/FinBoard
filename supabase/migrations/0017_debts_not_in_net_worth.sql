-- 0017: debts between people are records, not part of net worth
--
-- The rule (the owner, 4 Oct 2026): money you owe someone is recorded, but it isn't taken off your
-- balances until you repay it; money someone owes you is recorded, but it isn't added until it is
-- repaid to you. So net worth no longer counts open debts. It changes when a repayment moves money
-- into or out of an account (or when the money movement was recorded together with the debt).
-- What is owed both ways is still reported in by_class (receivables, liabilities) for the screens
-- that show it, and by_class.debts_in_total = false says the total leaves it out.
--
-- The saved daily totals are corrected the same way, so the history chart and Reports compare like
-- with like. Safe to run more than once: corrected rows carry debts_in_total = false.

-- ---------------------------------------------------------------------------
-- 1. net worth without what people owe (same as 0008 otherwise)
-- ---------------------------------------------------------------------------
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

  -- what people owe you and what you owe them: reported, not counted (it counts when it is repaid)
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
    'total', round(v_cash + v_clouds + v_cert + v_inv + v_gold + v_cards, 4),
    'by_class', jsonb_build_object(
      'accounts', round(v_cash, 4), 'clouds', round(v_clouds, 4), 'certificates', round(v_cert, 4),
      'investments', round(v_inv, 4), 'gold', round(v_gold, 4), 'receivables', round(v_recv, 4), 'liabilities', round(v_liab, 4),
      'cards', round(-v_cards, 4), 'debts_in_total', false),
    'by_currency', v_by_currency
  );
end $$;

-- ---------------------------------------------------------------------------
-- 2. the saved daily totals, without the debts they counted
-- ---------------------------------------------------------------------------
update public.net_worth_snapshots
   set total = total - coalesce((by_class->>'receivables')::numeric, 0) + coalesce((by_class->>'liabilities')::numeric, 0),
       by_class = by_class || jsonb_build_object('debts_in_total', false)
 where coalesce(by_class->>'debts_in_total', 'true') <> 'false';

-- ---------------------------------------------------------------------------
-- permissions: signed-in users and the scheduler only (see 0011)
-- ---------------------------------------------------------------------------
revoke execute on function public.compute_net_worth(uuid, text, date) from public, anon;
grant execute on function public.compute_net_worth(uuid, text, date) to authenticated, service_role;

notify pgrst, 'reload schema';
