-- Regression tests for migration 0019 (Cloud interest like Thndr). Run on a fresh database with all migrations applied, as postgres.
\set ON_ERROR_STOP on

create function pg_temp.ok(label text, cond boolean) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create function pg_temp.bal(p uuid) returns numeric language sql as $$ select balance from public.sub_accounts where id = p $$;

insert into auth.users (id, email) values ('19191919-0000-0000-0000-000000000001', 'a19@test');
insert into accounts (id, user_id, name, type) values
  ('19a00000-0000-0000-0000-000000000001', '19191919-0000-0000-0000-000000000001', 'Thndr', 'investment');

\echo '--- 1. the shown rate hides a lower simple rate (Thndr: 17.30% keeps 16.1% if you withdraw monthly)'
select pg_temp.ok('17.30% → 16.063% simple', round(yield_simple_rate(17.30), 3) = 16.063);
select pg_temp.ok('20.26% → 18.591% simple', round(yield_simple_rate(20.26), 3) = 18.591);
select pg_temp.ok('a year of 250,000 at the simple rate is what Thndr quotes for withdrawing (40,158 / 46,478)',
  round(250000 * yield_simple_rate(17.30) / 100) = 40158 and round(250000 * yield_simple_rate(20.26) / 100) = 46478);

\echo '--- 2. Instant Cloud: 250,000 at 17.30% from 1 Aug, like the Thndr calculator'
-- created as if on 31 Jul with its balance, so every day from 1 Aug is posted
insert into sub_accounts (id, user_id, account_id, currency, name, opening_balance, yield_rate, yield_frequency, yield_since) values
  ('19500000-0000-0000-0000-000000000001', '19191919-0000-0000-0000-000000000001', '19a00000-0000-0000-0000-000000000001', 'EGP', 'Instant', 250000, 17.30, 'daily', '2026-07-31');
update sub_accounts set yield_accrued_through = '2026-07-31' where id = '19500000-0000-0000-0000-000000000001';
select accrue_yield('19191919-0000-0000-0000-000000000001');
create temp table inst as select date, amount from transactions where sub_account_id = '19500000-0000-0000-0000-000000000001' and source = 'yield' order by date;
select pg_temp.ok('every day of August earns the same 110.02 (no compounding inside the month)',
  (select count(distinct amount) from inst where date between '2026-08-01' and '2026-08-31') = 1
  and (select round(min(amount), 2) from inst where date between '2026-08-01' and '2026-08-31') = 110.02);
select pg_temp.ok('August adds up to 3,411 like the calculator''s 31-day month', (select round(sum(amount)) from inst where date between '2026-08-01' and '2026-08-31') = 3411);
select pg_temp.ok('from 1 September the August gains earn too: 111.52 a day', (select round(amount, 2) from inst where date = '2026-09-01') = 111.52);
select pg_temp.ok('September adds up to 3,345 (30 days) like the calculator, give or take a pound of rounding', (select round(sum(amount)) from inst where date between '2026-09-01' and '2026-09-30') between 3345 and 3346);
select pg_temp.ok('the balance is the deposit plus every posting', pg_temp.bal('19500000-0000-0000-0000-000000000001') = 250000 + (select sum(amount) from inst));

\echo '--- 3. Monthly Cloud: 250,000 at 20.26% from 1 Aug'
insert into sub_accounts (id, user_id, account_id, currency, name, opening_balance, yield_rate, yield_frequency, yield_since) values
  ('19500000-0000-0000-0000-000000000002', '19191919-0000-0000-0000-000000000001', '19a00000-0000-0000-0000-000000000001', 'EGP', 'Monthly', 250000, 20.26, 'monthly', '2026-08-01');
update sub_accounts set yield_accrued_through = '2026-08-01' where id = '19500000-0000-0000-0000-000000000002';
select accrue_yield('19191919-0000-0000-0000-000000000001');
create temp table mon as select date, amount from transactions where sub_account_id = '19500000-0000-0000-0000-000000000002' and source = 'yield' order by date;
select pg_temp.ok('the first payout on 1 Sep is August''s 31 days: 3,948, give or take a pound of rounding', (select round(amount) from mon where date = '2026-09-01') between 3947 and 3948);
select pg_temp.ok('the second (30 days, on the bigger balance) is about 3,881', (select round(amount) from mon where date = '2026-10-01') between 3880 and 3882);

\echo '--- 4. past postings are recalculated with the same rule'
-- an old posting made the old way (the shown rate per day, compounding daily) on a 100,000 Cloud
insert into sub_accounts (id, user_id, account_id, currency, name, opening_balance, yield_rate, yield_frequency, yield_since) values
  ('19500000-0000-0000-0000-000000000003', '19191919-0000-0000-0000-000000000001', '19a00000-0000-0000-0000-000000000001', 'EGP', 'Old', 100000, 17.31, 'daily', '2026-09-01');
insert into transactions (user_id, type, date, amount, currency, sub_account_id, notes, source, source_id) values
  ('19191919-0000-0000-0000-000000000001', 'income', '2026-09-02', 47.4247, 'EGP', '19500000-0000-0000-0000-000000000003', 'Old · Thndr daily yield', 'yield', '19500000-0000-0000-0000-000000000003'),
  ('19191919-0000-0000-0000-000000000001', 'income', '2026-09-03', 47.4471, 'EGP', '19500000-0000-0000-0000-000000000003', 'Old · Thndr daily yield', 'yield', '19500000-0000-0000-0000-000000000003');
select pg_temp.ok('two postings corrected', recompute_yield_postings() = 2);
select pg_temp.ok('both now 44.03 (100,000 × 16.07% / 365)',
  (select array_agg(round(amount, 2) order by date) from transactions where sub_account_id = '19500000-0000-0000-0000-000000000003' and source = 'yield') = array[44.03, 44.03]::numeric[]);
select pg_temp.ok('the balance followed the correction', pg_temp.bal('19500000-0000-0000-0000-000000000003') = 100000 + 2 * (select amount from transactions where sub_account_id = '19500000-0000-0000-0000-000000000003' and source = 'yield' limit 1));
select pg_temp.ok('running the recalculation again changes nothing', recompute_yield_postings() = 0);

\echo '--- 5. the app cannot call the recalculation'
set session authorization authenticator;
set role authenticated;
do $$
begin
  perform public.recompute_yield_postings();
  raise exception 'FAIL: authenticated could run recompute_yield_postings';
exception when insufficient_privilege then
  raise notice 'PASS: the recalculation is not callable from the app';
end $$;
reset role;
reset session authorization;

\echo 'ALL 0019 CHECKS PASSED'
