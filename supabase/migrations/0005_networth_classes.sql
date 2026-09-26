-- =============================================================================
-- 0005 – clearer net-worth classes (same totals, clearer breakdown).
--   accounts     = every cash/bank balance, including uninvested cash on a platform like Thndr
--   clouds       = yield-bearing balances (new class)
--   investments  = holdings only
-- Matches computeNetWorth in src/domain/networth.ts. Safe to run as one transaction and to re-run.
-- =============================================================================
create or replace function public.compute_net_worth(p_user uuid, p_base text, p_date date default current_date)
returns jsonb language plpgsql stable as $$
declare
  v_cash numeric := 0; v_clouds numeric := 0; v_cert numeric := 0; v_inv numeric := 0; v_gold numeric := 0;
  v_recv numeric := 0; v_liab numeric := 0;
  v_by_currency jsonb := '{}'::jsonb;
  r record; v numeric;
begin
  for r in
    select s.currency, (s.yield_rate is not null) as is_cloud, sum(s.balance) as amt
    from public.sub_accounts s join public.accounts a on a.id = s.account_id
    where s.user_id = p_user and not s.is_archived and not a.is_archived
    group by s.currency, (s.yield_rate is not null)
  loop
    v := coalesce(public.convert_amount(p_user, r.amt, r.currency, p_base, p_date), 0);
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
    'total', round(v_cash + v_clouds + v_cert + v_inv + v_gold + v_recv - v_liab, 4),
    'by_class', jsonb_build_object(
      'accounts', round(v_cash, 4), 'clouds', round(v_clouds, 4), 'certificates', round(v_cert, 4),
      'investments', round(v_inv, 4), 'gold', round(v_gold, 4), 'receivables', round(v_recv, 4), 'liabilities', round(v_liab, 4)),
    'by_currency', v_by_currency
  );
end $$;
