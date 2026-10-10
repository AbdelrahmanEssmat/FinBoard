-- 0019: Cloud interest the way Thndr calculates it.
--
-- The rate shown on a Cloud (17.30%, 20.26%) is the yearly return with the gains kept in. Behind it
-- is a lower "simple" rate (16.06%, 18.59%): gains accrue every day at simple/365 on the balance and
-- are compounded once a month, which is what adds up to the shown rate over a year. Until now the
-- app used the shown rate as the daily rate and compounded daily, so it paid too much.
--
--   simple rate = 12 × ((1 + shown)^(1/12) − 1)        17.30% → 16.063%, 20.26% → 18.591%
--   each day earns balance × simple / 365
--   Instant (daily) Cloud: the day's gain is posted that day, but gains posted this calendar month
--     start earning only from the 1st of next month (compounding is monthly, as on Thndr)
--   Monthly Cloud: the days' gains are added up and posted on the payout day
--
-- Past interest already posted is recalculated with the same rule, on every Cloud of every account,
-- so balances and history agree with Thndr.
-- Safe to run more than once.

create or replace function public.yield_simple_rate(p_shown numeric)
returns numeric language sql immutable set search_path = public as $$
  select case when p_shown is null or p_shown <= -100 then 0 else 12 * (power(1 + p_shown / 100, 1.0 / 12) - 1) * 100 end;
$$;

-- what a Cloud earns on one day: its balance at the start of the day, without the gains posted so
-- far this calendar month (they compound from next month), at that day's rate
create or replace function public.yield_day_amount(p_sub uuid, p_day date, p_default_rate numeric)
returns numeric language sql stable set search_path = public as $$
  select round(
    (public.balance_as_of(p_sub, p_day - 1)
     - coalesce((select sum(t.amount) from public.transactions t
                 where t.sub_account_id = p_sub and t.source = 'yield' and t.source_id = p_sub
                   and t.date >= date_trunc('month', p_day)::date and t.date <= p_day - 1), 0))
    * public.yield_simple_rate(public.yield_rate_on(p_sub, p_day - 1, p_default_rate)) / 100 / 365, 4);
$$;

-- a monthly payout: the gains of every day from p_from (included) to p_to (excluded)
create or replace function public.yield_period_amount(p_sub uuid, p_from date, p_to date, p_default_rate numeric)
returns numeric language sql stable set search_path = public as $$
  select round(coalesce((
    select sum(public.balance_as_of(p_sub, x::date) * public.yield_simple_rate(public.yield_rate_on(p_sub, x::date, p_default_rate)))
    from generate_series(p_from, p_to - 1, interval '1 day') as x), 0) / 100 / 365, 4);
$$;

create or replace function public.accrue_yield(p_user uuid default auth.uid())
returns integer language plpgsql security definer set search_path = public as $$
declare
  s record; d date; prev date; start_d date; last_d date; k integer; amt numeric; n integer := 0; cat uuid; acc_name text;
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
        amt := public.yield_day_amount(s.id, d, s.yield_rate);
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
          amt := public.yield_period_amount(s.id, start_d, d, s.yield_rate);
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

-- Recalculates every interest posting already made, oldest first, so each one is based on the
-- corrected balance before it. Returns how many postings changed. Run by this migration for everyone;
-- running it again changes nothing.
create or replace function public.recompute_yield_postings()
returns integer language plpgsql security definer set search_path = public as $$
declare t record; s record; prev date; last_d date; amt numeric; n integer := 0;
begin
  for t in select x.id, x.sub_account_id, x.date, x.amount, x.notes from public.transactions x
           where x.source = 'yield' and x.source_id = x.sub_account_id
           order by x.sub_account_id, x.date
  loop
    select * into s from public.sub_accounts where id = t.sub_account_id;
    if not found or s.yield_rate is null then continue; end if;
    if t.notes like '% daily yield' or (t.notes not like '% monthly yield' and s.yield_frequency = 'daily') then
      amt := public.yield_day_amount(t.sub_account_id, t.date, s.yield_rate);
    else
      -- the period runs from the previous posting (or a month before this one) to this payout day
      select max(date) into last_d from public.transactions
       where sub_account_id = t.sub_account_id and source = 'yield' and source_id = sub_account_id and date < t.date;
      prev := greatest(coalesce(last_d, (t.date - interval '1 month')::date), coalesce(s.yield_since, (t.date - interval '1 month')::date));
      if prev >= t.date then prev := (t.date - interval '1 month')::date; end if;
      amt := public.yield_period_amount(t.sub_account_id, prev, t.date, s.yield_rate);
    end if;
    if amt > 0 and amt <> t.amount then
      update public.transactions set amount = amt where id = t.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

do $$
declare n integer;
begin
  n := public.recompute_yield_postings();
  raise notice 'Cloud interest recalculated: % posting(s) corrected', n;
end $$;

revoke execute on function public.yield_simple_rate(numeric) from public, anon;
grant execute on function public.yield_simple_rate(numeric) to authenticated, service_role;
revoke execute on function public.yield_day_amount(uuid, date, numeric) from public, anon;
grant execute on function public.yield_day_amount(uuid, date, numeric) to authenticated, service_role;
revoke execute on function public.yield_period_amount(uuid, date, date, numeric) from public, anon;
grant execute on function public.yield_period_amount(uuid, date, date, numeric) to authenticated, service_role;
revoke execute on function public.accrue_yield(uuid) from public, anon;
grant execute on function public.accrue_yield(uuid) to authenticated, service_role;
-- the recalculation is the migration's job, not something the app calls
revoke execute on function public.recompute_yield_postings() from public, anon, authenticated;
grant execute on function public.recompute_yield_postings() to service_role;

notify pgrst, 'reload schema';
