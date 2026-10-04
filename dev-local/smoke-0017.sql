-- Regression tests for migration 0017. Run on a fresh database with all migrations applied, as postgres.
\set ON_ERROR_STOP on

create function pg_temp.ok(label text, cond boolean) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, false);
end $$;
create function pg_temp.nw() returns jsonb language sql as $$
  select compute_net_worth('17171717-0000-0000-0000-000000000001', 'EGP') $$;

insert into auth.users (id, email) values ('17171717-0000-0000-0000-000000000001', 'a17@test');
insert into accounts (id, user_id, name, type) values
  ('17a00000-0000-0000-0000-000000000001', '17171717-0000-0000-0000-000000000001', 'Bank', 'bank');
insert into sub_accounts (id, user_id, account_id, currency, opening_balance) values
  ('17500000-0000-0000-0000-000000000001', '17171717-0000-0000-0000-000000000001', '17a00000-0000-0000-0000-000000000001', 'EGP', 10000);

-- the way the app calls it: the API role with the person's token
set session authorization authenticator;
set role authenticated;
select pg_temp.as_user('17171717-0000-0000-0000-000000000001');

\echo '--- 1. a debt is a record: it is not in net worth'
select create_debt('17d00000-0000-0000-0000-000000000001', '17c00000-0000-0000-0000-000000000001', 'Ahmed', 'owed_to_me', 3000, 'EGP', current_date);
select create_debt('17d00000-0000-0000-0000-000000000002', '17c00000-0000-0000-0000-000000000002', 'Karim', 'i_owe', 2000, 'EGP', current_date);
select pg_temp.ok('net worth is only what the accounts hold (nothing added for Ahmed, nothing taken for Karim)',
  (pg_temp.nw() ->> 'total')::numeric = 10000);
select pg_temp.ok('what is owed both ways is still reported, marked as left out',
  (pg_temp.nw() -> 'by_class' ->> 'receivables')::numeric = 3000 and (pg_temp.nw() -> 'by_class' ->> 'liabilities')::numeric = 2000
  and pg_temp.nw() -> 'by_class' ->> 'debts_in_total' = 'false');

\echo '--- 2. a repayment counts the moment the money moves'
select record_debt_payment('17d00000-0000-0000-0000-000000000001', 1000, current_date, '17500000-0000-0000-0000-000000000001');
select pg_temp.ok('repaid to you into the bank: +1,000', (pg_temp.nw() ->> 'total')::numeric = 11000
  and (pg_temp.nw() -> 'by_class' ->> 'receivables')::numeric = 2000);
select record_debt_payment('17d00000-0000-0000-0000-000000000002', 500, current_date, '17500000-0000-0000-0000-000000000001');
select pg_temp.ok('you repaid from the bank: -500', (pg_temp.nw() ->> 'total')::numeric = 10500
  and (pg_temp.nw() -> 'by_class' ->> 'liabilities')::numeric = 1500);
select record_debt_payment('17d00000-0000-0000-0000-000000000001', 500, current_date);
select pg_temp.ok('a repayment with no account only lowers what is owed', (pg_temp.nw() ->> 'total')::numeric = 10500
  and (pg_temp.nw() -> 'by_class' ->> 'receivables')::numeric = 1500);

\echo '--- 3. money recorded leaving when the debt was saved'
select create_debt('17d00000-0000-0000-0000-000000000003', '17c00000-0000-0000-0000-000000000001', null, 'owed_to_me', 4000, 'EGP', current_date,
                   null, null, null, null, null, null, null, '17500000-0000-0000-0000-000000000001', '17700000-0000-0000-0000-000000000003');
select pg_temp.ok('lent out of the bank: net worth is lower by it until it is repaid', (pg_temp.nw() ->> 'total')::numeric = 6500);

\echo '--- 4. the daily snapshot follows'
select snapshot_net_worth('17171717-0000-0000-0000-000000000001');
select pg_temp.ok('today''s saved total has no debts in it',
  exists (select 1 from net_worth_snapshots where user_id = '17171717-0000-0000-0000-000000000001'
          and snapshot_date = app_today() and total = 6500 and by_class ->> 'debts_in_total' = 'false'));
reset role;
reset session authorization;

\echo '--- 5. older saved totals are corrected, once'
insert into net_worth_snapshots (user_id, snapshot_date, base_currency, total, by_class, by_currency) values
  ('17171717-0000-0000-0000-000000000001', current_date - 30, 'EGP', 12000, '{"accounts": 10000, "receivables": 3000, "liabilities": 1000}', '{}');
\ir ../supabase/migrations/0017_debts_not_in_net_worth.sql
select pg_temp.ok('a total that counted debts loses them (12,000 - 3,000 owed to you + 1,000 you owed)',
  (select total from net_worth_snapshots where user_id = '17171717-0000-0000-0000-000000000001' and snapshot_date = current_date - 30) = 10000);
\ir ../supabase/migrations/0017_debts_not_in_net_worth.sql
select pg_temp.ok('running it again changes nothing',
  (select total from net_worth_snapshots where user_id = '17171717-0000-0000-0000-000000000001' and snapshot_date = current_date - 30) = 10000
  and (select total from net_worth_snapshots where user_id = '17171717-0000-0000-0000-000000000001' and snapshot_date = app_today()) = 6500);
\echo 'ALL 0017 CHECKS PASSED'
