-- =============================================================================
-- Clouds / yield-bearing savings balances (e.g. Thndr Clouds).
-- A cloud is a sub-account with an annual rate and a payout frequency. Money
-- moves in and out with normal transfers; interest is posted automatically as
-- income transactions (source = 'yield') by accrue_yield(), which runs from the
-- nightly job and whenever the app opens.
-- Run AFTER 0001_init.sql. Safe to run as one transaction (Supabase SQL Editor) and safe to re-run:
-- the new enum value is only referenced as text or inside function bodies, which PostgreSQL
-- evaluates later, after the value has been committed.
-- =============================================================================

alter type public.transaction_source add value if not exists 'yield';

alter table public.sub_accounts
  add column if not exists yield_rate      numeric(8, 4) check (yield_rate is null or yield_rate >= 0),  -- annual %
  add column if not exists yield_frequency public.recurrence check (yield_frequency is null or yield_frequency in ('daily', 'monthly')),
  add column if not exists yield_since     date;

-- one interest posting per cloud per day
-- Yield postings are the only transactions whose source_id is their own sub-account (recurring,
-- debt and certificate rows point source_id at the rule/debt/payout). Keying the index on that
-- avoids referencing the new enum value, which cannot be used until it is committed.
drop index if exists public.transactions_yield_uniq;
create unique index transactions_yield_uniq on public.transactions (sub_account_id, date) where source_id = sub_account_id;

-- ---------------------------------------------------------------------------
-- Post missing interest for every cloud of a user, up to today. Daily clouds
-- compound daily (balance × rate / 365); monthly clouds pay balance × rate / 12
-- on each monthly anniversary of yield_since. Returns number of postings.
-- ---------------------------------------------------------------------------
create or replace function public.accrue_yield(p_user uuid default auth.uid())
returns integer language plpgsql security definer set search_path = public as $$
declare
  s record; d date; last_d date; amt numeric; n integer := 0; cat uuid; bal numeric; acc_name text;
begin
  if p_user is null then return 0; end if;
  if auth.uid() is not null and auth.uid() <> p_user then raise exception 'not allowed'; end if;
  select id into cat from public.categories where user_id = p_user and kind = 'income' and lower(name) = 'interest' limit 1;

  for s in select sa.*, a.name as account_name from public.sub_accounts sa join public.accounts a on a.id = sa.account_id
           where sa.user_id = p_user and sa.yield_rate is not null and sa.yield_frequency is not null and not sa.is_archived and not a.is_archived
           for update of sa
  loop
    acc_name := coalesce(s.name, 'Cloud') || ' · ' || s.account_name;
    select max(date) into last_d from public.transactions where sub_account_id = s.id and source::text = 'yield';
    if s.yield_frequency = 'daily' then
      -- first posting is the day after yield_since (or after the last posting)
      d := coalesce(last_d, coalesce(s.yield_since, current_date)) + 1;
      while d <= current_date loop
        select balance into bal from public.sub_accounts where id = s.id;
        amt := round(bal * s.yield_rate / 100 / 365, 4);
        if amt > 0 then
          insert into public.transactions (user_id, type, date, amount, currency, sub_account_id, category_id, notes, source, source_id)
          values (p_user, 'income', d, amt, s.currency, s.id, cat, acc_name || ' daily yield', 'yield', s.id)
          on conflict (sub_account_id, date) where source_id = sub_account_id do nothing;
          n := n + 1;
        end if;
        d := d + 1;
      end loop;
    else
      -- monthly anniversaries of yield_since
      if s.yield_since is null then continue; end if;
      d := (s.yield_since + interval '1 month')::date;
      while d <= current_date loop
        if last_d is null or d > last_d then
          select balance into bal from public.sub_accounts where id = s.id;
          amt := round(bal * s.yield_rate / 100 / 12, 4);
          if amt > 0 then
            insert into public.transactions (user_id, type, date, amount, currency, sub_account_id, category_id, notes, source, source_id)
            values (p_user, 'income', d, amt, s.currency, s.id, cat, acc_name || ' monthly yield', 'yield', s.id)
            on conflict (sub_account_id, date) where source_id = sub_account_id do nothing;
            n := n + 1;
          end if;
        end if;
        d := (d + interval '1 month')::date;
      end loop;
    end if;
  end loop;
  return n;
end $$;

-- nightly job now also accrues yield
create or replace function public.run_daily_jobs()
returns void language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  for u in select user_id from public.settings loop
    perform public.post_due_recurring(u);
    perform public.process_certificate_payouts(u);
    perform public.accrue_yield(u);
    perform public.snapshot_net_worth(u, current_date);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Net worth: balances held on investment platforms (cash + clouds) count as
-- investments, not as bank/cash accounts.
-- ---------------------------------------------------------------------------
create or replace function public.compute_net_worth(p_user uuid, p_base text, p_date date default current_date)
returns jsonb language plpgsql stable as $$
declare
  v_cash numeric := 0; v_cert numeric := 0; v_inv numeric := 0; v_gold numeric := 0;
  v_recv numeric := 0; v_liab numeric := 0;
  v_by_currency jsonb := '{}'::jsonb;
  r record; v numeric;
begin
  for r in
    select s.currency, a.type, sum(s.balance) as amt
    from public.sub_accounts s join public.accounts a on a.id = s.account_id
    where s.user_id = p_user and not s.is_archived and not a.is_archived
    group by s.currency, a.type
  loop
    v := coalesce(public.convert_amount(p_user, r.amt, r.currency, p_base, p_date), 0);
    if r.type = 'investment' then v_inv := v_inv + v; else v_cash := v_cash + v; end if;
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
    'total', round(v_cash + v_cert + v_inv + v_gold + v_recv - v_liab, 4),
    'by_class', jsonb_build_object(
      'accounts', round(v_cash, 4), 'certificates', round(v_cert, 4), 'investments', round(v_inv, 4),
      'gold', round(v_gold, 4), 'receivables', round(v_recv, 4), 'liabilities', round(v_liab, 4)),
    'by_currency', v_by_currency
  );
end $$;
