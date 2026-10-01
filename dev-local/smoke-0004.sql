-- Regression tests for migration 0004 (audit fixes). Run on a FRESH database that has
-- shim.sql, 0001, 0003 and 0004 applied, as the postgres superuser:
--   psql -d <db> -v ON_ERROR_STOP=1 -f dev-local/smoke-0004.sql
-- Every check prints PASS or aborts with FAIL.
\set ON_ERROR_STOP on
set client_min_messages = notice;

create function pg_temp.ok(label text, cond boolean) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;

create function pg_temp.fails(label text, stmt text, pattern text default '%') returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL (no error): %', label;
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  if sqlerrm not ilike pattern then raise exception 'FAIL (wrong error "%"): %', sqlerrm, label; end if;
  raise notice 'PASS: %  [%]', label, sqlerrm;
end $$;

-- users A and B (handle_new_user seeds Cash EGP/USD, Thndr EGP, categories, settings)
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@test'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@test');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', false);

create function pg_temp.sub(p_user uuid, p_account text, p_currency text) returns uuid language sql as $$
  select s.id from public.sub_accounts s join public.accounts a on a.id = s.account_id
  where s.user_id = p_user and a.name = p_account and s.currency = p_currency and s.name is null limit 1
$$;
create function pg_temp.bal(p uuid) returns numeric language sql as $$ select balance from public.sub_accounts where id = p $$;
-- the role-switching checks below call these helpers as other roles
do $$ begin execute format('grant usage on schema %I to public', (select nspname from pg_namespace where oid = pg_my_temp_schema())); end $$;

\echo '--- Clouds (C1, H6)'
insert into accounts (id, user_id, name, type) values ('10000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Platform', 'investment');
insert into sub_accounts (id, user_id, account_id, currency, name, opening_balance, yield_rate, yield_frequency, yield_since)
values ('20000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'EGP', 'Daily', 100000, 17.31, 'daily', app_today() - 10);
select pg_temp.ok('a new Cloud starts accruing today', (select yield_accrued_through from sub_accounts where id = '20000000-0000-0000-0000-000000000001') = app_today());
select pg_temp.ok('no back-posted interest when a Cloud is created', accrue_yield('aaaaaaaa-0000-0000-0000-000000000001') = 0);
update sub_accounts set yield_accrued_through = app_today() - 3 where id = '20000000-0000-0000-0000-000000000001';
select pg_temp.ok('3 missed days are posted', accrue_yield('aaaaaaaa-0000-0000-0000-000000000001') = 3);
select pg_temp.ok('daily interest compounds on each day''s opening balance',
  (select array_agg(amount order by date) from transactions where sub_account_id = '20000000-0000-0000-0000-000000000001' and source_id = sub_account_id)
  = array[47.4247, 47.4471, 47.4697]::numeric[]);
select pg_temp.ok('running again posts nothing', accrue_yield('aaaaaaaa-0000-0000-0000-000000000001') = 0);

-- money that arrives today earns nothing for past days
insert into sub_accounts (id, user_id, account_id, currency, name, opening_balance, yield_rate, yield_frequency, yield_since)
values ('20000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'EGP', 'Empty', 0, 17.31, 'daily', app_today() - 25);
update sub_accounts set yield_accrued_through = app_today() - 25 where id = '20000000-0000-0000-0000-000000000002';
insert into transactions (user_id, type, date, amount, currency, sub_account_id, to_sub_account_id, to_amount, to_currency)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'transfer', app_today(), 100000, 'EGP', pg_temp.sub('aaaaaaaa-0000-0000-0000-000000000001', 'Cash', 'EGP'),
        '20000000-0000-0000-0000-000000000002', 100000, 'EGP');
select accrue_yield('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.ok('a deposit made today earns no interest for earlier days',
  not exists (select 1 from transactions where sub_account_id = '20000000-0000-0000-0000-000000000002' and source_id = sub_account_id));
select pg_temp.ok('balance is exactly the deposit', pg_temp.bal('20000000-0000-0000-0000-000000000002') = 100000);

-- monthly Cloud anchored on the 31st: keeps month-end dates and compounds monthly
insert into sub_accounts (id, user_id, account_id, currency, name, opening_balance, yield_rate, yield_frequency, yield_since)
values ('20000000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'EGP', 'Monthly', 60000, 24, 'monthly', '2026-01-31');
update sub_accounts set yield_accrued_through = '2026-01-31' where id = '20000000-0000-0000-0000-000000000003';
select accrue_yield('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.ok('monthly payouts land on month ends, not the 28th',
  not exists (select 1 from transactions where sub_account_id = '20000000-0000-0000-0000-000000000003' and source_id = sub_account_id
              and date <> (date_trunc('month', date) + interval '1 month - 1 day')::date));
select pg_temp.ok('one payout per elapsed month',
  (select count(*) from transactions where sub_account_id = '20000000-0000-0000-0000-000000000003' and source_id = sub_account_id)
  = (select count(*) from generate_series(1, 40) k where ('2026-01-31'::date + make_interval(months => k))::date <= app_today()));
select pg_temp.ok('first two monthly payouts: 1200.00 then 1224.00 (compounded)',
  (select array_agg(amount order by date) from (select amount, date from transactions where sub_account_id = '20000000-0000-0000-0000-000000000003'
     and source_id = sub_account_id order by date limit 2) x) = array[1200, 1224]::numeric[]);

-- monthly payout on a mid-period deposit uses the average daily balance
insert into sub_accounts (id, user_id, account_id, currency, name, opening_balance, yield_rate, yield_frequency, yield_since)
values ('20000000-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'EGP', 'Monthly2', 0, 12, 'monthly', (app_today() - interval '1 month')::date);
update sub_accounts set yield_accrued_through = (app_today() - interval '1 month')::date where id = '20000000-0000-0000-0000-000000000004';
insert into transactions (user_id, type, date, amount, currency, sub_account_id, to_sub_account_id, to_amount, to_currency)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'transfer', (app_today() - interval '1 month')::date + 15, 30000, 'EGP',
        pg_temp.sub('aaaaaaaa-0000-0000-0000-000000000001', 'Cash', 'EGP'), '20000000-0000-0000-0000-000000000004', 30000, 'EGP');
select accrue_yield('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.ok('mid-period deposit earns a pro-rated payout',
  (select amount from transactions where sub_account_id = '20000000-0000-0000-0000-000000000004' and source_id = sub_account_id)
  = round(30000 * (app_today() - ((app_today() - interval '1 month')::date + 15))::numeric
          / (app_today() - (app_today() - interval '1 month')::date) * 0.12 / 12, 4));

\echo '--- Currency and ownership (C2, C5)'
insert into contacts (id, user_id, name) values ('30000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Ahmed');
insert into debts (id, user_id, contact_id, direction, amount, currency, date)
values ('40000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'owed_to_me', 2000, 'EGP', app_today());
select pg_temp.fails('an EGP repayment cannot land in a USD account',
  format('select record_debt_payment(%L, 2000, app_today(), %L)', '40000000-0000-0000-0000-000000000001', pg_temp.sub('aaaaaaaa-0000-0000-0000-000000000001', 'Cash', 'USD')),
  '%holds USD%');
select pg_temp.ok('the USD balance is untouched', pg_temp.bal(pg_temp.sub('aaaaaaaa-0000-0000-0000-000000000001', 'Cash', 'USD')) = 0);
select pg_temp.fails('a transaction must use its account''s currency',
  format($q$insert into transactions (user_id, type, amount, currency, sub_account_id) values ('aaaaaaaa-0000-0000-0000-000000000001', 'expense', 10, 'EGP', %L)$q$,
         pg_temp.sub('aaaaaaaa-0000-0000-0000-000000000001', 'Cash', 'USD')), '%holds USD%');
select pg_temp.fails('a transaction cannot use another user''s account',
  format($q$insert into transactions (user_id, type, amount, currency, sub_account_id) values ('aaaaaaaa-0000-0000-0000-000000000001', 'expense', 10, 'EGP', %L)$q$,
         pg_temp.sub('bbbbbbbb-0000-0000-0000-000000000002', 'Cash', 'EGP')), '%does not belong%');
select pg_temp.fails('a repayment cannot exceed what is left',
  format('select record_debt_payment(%L, 2500, app_today(), null)', '40000000-0000-0000-0000-000000000001'), '%more than%');

set session authorization authenticator;
set role anon;
select pg_temp.fails('signed-out callers cannot run functions',
  format('select public.record_debt_payment(%L, 10, public.app_today(), null)', '40000000-0000-0000-0000-000000000001'), '%permission denied%');
reset role;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}', false);
select pg_temp.fails('user B cannot record a payment on user A''s debt',
  format('select public.record_debt_payment(%L, 10, public.app_today(), null)', '40000000-0000-0000-0000-000000000001'), '%not allowed%');
select pg_temp.fails('user B cannot run user A''s jobs', $q$select public.post_due_recurring('aaaaaaaa-0000-0000-0000-000000000001')$q$, '%not allowed%');
select pg_temp.fails('signed-in users cannot run the all-users job', 'select public.run_daily_jobs()', '%permission denied%');
reset role;
reset session authorization;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', false);

\echo '--- Debts (C3, C6)'
-- borrow 10,000 into Cash, repay 10,000, then delete the debt: Cash is back where it started
create temp table t_before as select pg_temp.bal(pg_temp.sub('aaaaaaaa-0000-0000-0000-000000000001', 'Cash', 'EGP')) as v;
insert into transactions (id, user_id, type, date, amount, currency, sub_account_id, source, source_id)
values ('50000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'income', app_today(), 10000, 'EGP',
        pg_temp.sub('aaaaaaaa-0000-0000-0000-000000000001', 'Cash', 'EGP'), 'debt', '40000000-0000-0000-0000-000000000002');
insert into debts (id, user_id, contact_id, direction, amount, currency, date, transaction_id)
values ('40000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'i_owe', 10000, 'EGP', app_today(), '50000000-0000-0000-0000-000000000001');
select record_debt_payment('40000000-0000-0000-0000-000000000002', 10000, app_today(), pg_temp.sub('aaaaaaaa-0000-0000-0000-000000000001', 'Cash', 'EGP'));
select pg_temp.ok('the debt is settled', (select status from debts where id = '40000000-0000-0000-0000-000000000002') = 'settled');
delete from debts where id = '40000000-0000-0000-0000-000000000002';
select pg_temp.ok('deleting the debt leaves no phantom money', pg_temp.bal(pg_temp.sub('aaaaaaaa-0000-0000-0000-000000000001', 'Cash', 'EGP')) = (select v from t_before));

-- settled debt whose amount is raised reopens, and its borrow transaction follows
insert into transactions (id, user_id, type, date, amount, currency, sub_account_id, source, source_id)
values ('50000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'income', app_today(), 1000, 'EGP',
        pg_temp.sub('aaaaaaaa-0000-0000-0000-000000000001', 'Cash', 'EGP'), 'debt', '40000000-0000-0000-0000-000000000003');
insert into debts (id, user_id, contact_id, direction, amount, currency, date, transaction_id)
values ('40000000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'i_owe', 1000, 'EGP', app_today(), '50000000-0000-0000-0000-000000000002');
select record_debt_payment('40000000-0000-0000-0000-000000000003', 1000, app_today(), null);
update debts set amount = 1500 where id = '40000000-0000-0000-0000-000000000003';
select pg_temp.ok('raising a settled debt reopens it', (select status from debts where id = '40000000-0000-0000-0000-000000000003') = 'open');
select pg_temp.ok('the borrow transaction follows the new amount', (select amount from transactions where id = '50000000-0000-0000-0000-000000000002') = 1500);
select pg_temp.fails('currency cannot change once money moved',
  $q$update debts set currency = 'USD' where id = '40000000-0000-0000-0000-000000000003'$q$, '%currency%');

\echo '--- Deleting accounts (C4)'
insert into accounts (id, user_id, name, type) values ('10000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'OldBank', 'bank');
insert into sub_accounts (id, user_id, account_id, currency) values ('20000000-0000-0000-0000-000000000010', 'aaaaaaaa-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'EGP');
insert into transactions (user_id, type, date, amount, currency, sub_account_id, to_sub_account_id, to_amount, to_currency)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'transfer', app_today(), 3000, 'EGP', pg_temp.sub('aaaaaaaa-0000-0000-0000-000000000001', 'Cash', 'EGP'),
        '20000000-0000-0000-0000-000000000010', 3000, 'EGP');
-- since 0013 an account with transfers to other accounts can be deleted (see smoke-0013); this one is used below
insert into accounts (id, user_id, name, type) values ('10000000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'TwoCur', 'bank');
insert into sub_accounts (id, user_id, account_id, currency) values
  ('20000000-0000-0000-0000-000000000011', 'aaaaaaaa-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'EGP'),
  ('20000000-0000-0000-0000-000000000012', 'aaaaaaaa-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'USD');
insert into transactions (user_id, type, date, amount, currency, sub_account_id, to_sub_account_id, to_amount, to_currency)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'transfer', app_today(), 5000, 'EGP', '20000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000012', 100, 'USD');
delete from sub_accounts where id = '20000000-0000-0000-0000-000000000012';
select pg_temp.ok('one balance of an internal transfer can be deleted on its own (0013); the other side keeps its money movement',
  (select type = 'expense' and amount = 5000 from transactions where sub_account_id = '20000000-0000-0000-0000-000000000011')
  and (select balance from sub_accounts where id = '20000000-0000-0000-0000-000000000011') = -5000);
delete from accounts where id = '10000000-0000-0000-0000-000000000003';
select pg_temp.ok('a whole account with only internal transfers can be deleted', not exists (select 1 from accounts where id = '10000000-0000-0000-0000-000000000003'));

\echo '--- Certificates (C7, M2)'
insert into certificates (id, user_id, account_id, name, principal, currency, interest_rate, payout_frequency, start_date, maturity_date, payout_sub_account_id)
values ('60000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'CD', 100000, 'EGP', 27, 'monthly',
        (app_today() - interval '75 days')::date, (app_today() + interval '290 days')::date, '20000000-0000-0000-0000-000000000010');
select log_certificate_payout(id) from certificate_payouts where certificate_id = '60000000-0000-0000-0000-000000000001' and due_date <= app_today();
select pg_temp.ok('two payouts logged', (select count(*) from certificate_payouts where certificate_id = '60000000-0000-0000-0000-000000000001' and status = 'logged') = 2);
update certificates set start_date = start_date + 14 where id = '60000000-0000-0000-0000-000000000001';
select pg_temp.ok('moving the start date adds no extra past-due payouts',
  not exists (select 1 from certificate_payouts where certificate_id = '60000000-0000-0000-0000-000000000001' and status = 'pending' and due_date <= app_today()));
select pg_temp.fails('a USD account cannot receive an EGP payout',
  format('select log_certificate_payout(%L, %L)',
         (select id from certificate_payouts where certificate_id = '60000000-0000-0000-0000-000000000001' and status = 'pending' order by due_date limit 1),
         pg_temp.sub('aaaaaaaa-0000-0000-0000-000000000001', 'Cash', 'USD')), '%holds USD%');
update certificates set auto_log_income = true where id = '60000000-0000-0000-0000-000000000001';
delete from transactions where id = (select transaction_id from certificate_payouts where certificate_id = '60000000-0000-0000-0000-000000000001' and status = 'logged' order by due_date limit 1);
select pg_temp.ok('deleting a logged payout marks it skipped',
  (select count(*) from certificate_payouts where certificate_id = '60000000-0000-0000-0000-000000000001' and status = 'skipped') = 1);
select process_certificate_payouts('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.ok('auto-log does not add it back', (select count(*) from certificate_payouts where certificate_id = '60000000-0000-0000-0000-000000000001' and status = 'logged') = 1);

\echo '--- Recurring (H5)'
insert into recurring_transactions (id, user_id, name, type, amount, currency, sub_account_id, frequency, next_date)
values ('70000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Month-end', 'expense', 100, 'EGP',
        pg_temp.sub('aaaaaaaa-0000-0000-0000-000000000001', 'Cash', 'EGP'), 'monthly', '2026-01-31');
select post_due_recurring('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.ok('recurring on the 31st keeps month ends',
  not exists (select 1 from transactions where source_id = '70000000-0000-0000-0000-000000000001'
              and date <> (date_trunc('month', date) + interval '1 month - 1 day')::date));
select pg_temp.ok('next date is the next month end',
  (select next_date from recurring_transactions where id = '70000000-0000-0000-0000-000000000001')
  = (select min(d) from (select ('2026-01-31'::date + make_interval(months => k))::date d from generate_series(0, 40) k) x where d > app_today()));
insert into recurring_transactions (id, user_id, name, type, amount, currency, sub_account_id, frequency, next_date, auto_post)
values ('70000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Reminder', 'expense', 50, 'EGP',
        pg_temp.sub('aaaaaaaa-0000-0000-0000-000000000001', 'Cash', 'EGP'), 'weekly', app_today() - 5, false);
select post_due_recurring('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.ok('a past reminder rolls forward without posting',
  (select next_date from recurring_transactions where id = '70000000-0000-0000-0000-000000000002') = app_today() + 2
  and not exists (select 1 from transactions where source_id = '70000000-0000-0000-0000-000000000002'));

\echo '--- Gold (M7) and dates (M8)'
insert into gold_prices (user_id, karat, price_per_gram, source, price_at) values
  (null, 21, 4000, 'local', now() - interval '10 minutes'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 21, 5000, 'manual', now() - interval '1 hour');
select pg_temp.ok('a manual price set an hour ago beats a newer automatic one', gold_price_per_gram('aaaaaaaa-0000-0000-0000-000000000001', 21::smallint) = 5000);
update gold_prices set price_at = now() - interval '25 hours' where user_id is not null;
select pg_temp.ok('after 24 hours the newest automatic price wins again', gold_price_per_gram('aaaaaaaa-0000-0000-0000-000000000001', 21::smallint) = 4000);
select snapshot_net_worth('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.ok('snapshots are dated in Cairo time',
  exists (select 1 from net_worth_snapshots where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and snapshot_date = (now() at time zone 'Africa/Cairo')::date));

\echo '--- Balances stay consistent'
select pg_temp.ok('every stored balance equals opening balance + its transactions',
  not exists (select 1 from sub_accounts s where s.balance <> balance_as_of(s.id, '9999-12-31')));

\echo '--- Net worth classes (0005)'
delete from holdings where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
select pg_temp.ok('with no holdings, investments is zero even though a platform holds Clouds',
  (compute_net_worth('aaaaaaaa-0000-0000-0000-000000000001', 'EGP') -> 'by_class' ->> 'investments')::numeric = 0);
select pg_temp.ok('Clouds are their own class',
  (compute_net_worth('aaaaaaaa-0000-0000-0000-000000000001', 'EGP') -> 'by_class' ->> 'clouds')::numeric
  = (select sum(balance) from sub_accounts where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and yield_rate is not null));
select pg_temp.ok('the classes add up to the total',
  (select (b->>'accounts')::numeric + (b->>'clouds')::numeric + (b->>'certificates')::numeric + (b->>'investments')::numeric
          + (b->>'gold')::numeric + (b->>'receivables')::numeric - (b->>'liabilities')::numeric
   from (select compute_net_worth('aaaaaaaa-0000-0000-0000-000000000001', 'EGP') -> 'by_class' as b) x)
  = (compute_net_worth('aaaaaaaa-0000-0000-0000-000000000001', 'EGP') ->> 'total')::numeric);

\echo '--- Deleting a whole user'
delete from auth.users where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select pg_temp.ok('deleting a user removes all their data (the delete guard steps aside)',
  not exists (select 1 from accounts where user_id = 'aaaaaaaa-0000-0000-0000-000000000001')
  and not exists (select 1 from transactions where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'));
select pg_temp.ok('the other user is untouched', exists (select 1 from accounts where user_id = 'bbbbbbbb-0000-0000-0000-000000000002'));
\echo 'ALL 0004 CHECKS PASSED'
