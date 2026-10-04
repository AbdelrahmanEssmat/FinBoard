-- Regression tests for migration 0018. Run on a fresh database with all migrations applied, as postgres.
\set ON_ERROR_STOP on

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
create function pg_temp.bal(p uuid) returns numeric language sql as $$ select balance from public.sub_accounts where id = p $$;
create function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, false);
end $$;

insert into auth.users (id, email) values
  ('18181818-0000-0000-0000-000000000001', 'a18@test'),
  ('18181818-0000-0000-0000-000000000002', 'b18@test');
insert into accounts (id, user_id, name, type) values
  ('18a00000-0000-0000-0000-000000000001', '18181818-0000-0000-0000-000000000001', 'Bank', 'bank');
insert into sub_accounts (id, user_id, account_id, currency, opening_balance) values
  ('18500000-0000-0000-0000-000000000001', '18181818-0000-0000-0000-000000000001', '18a00000-0000-0000-0000-000000000001', 'EGP', 10000),
  ('18500000-0000-0000-0000-000000000002', '18181818-0000-0000-0000-000000000001', '18a00000-0000-0000-0000-000000000001', 'USD', 100);

-- the way the app calls it: the API role with the person's token
set session authorization authenticator;
set role authenticated;
select pg_temp.as_user('18181818-0000-0000-0000-000000000001');
insert into contacts (id, name) values ('18c00000-0000-0000-0000-000000000001', 'Brother'), ('18c00000-0000-0000-0000-000000000002', 'Friend');

\echo '--- 1. borrowing every month: the money comes in, a debt to repay is recorded'
-- started a little over two months ago, so three dates are due (0, 1 and 2 months after the start)
insert into recurring_debts (id, contact_id, direction, amount, currency, sub_account_id, start_date, next_date, reason)
values ('18e00000-0000-0000-0000-000000000001', '18c00000-0000-0000-0000-000000000001', 'i_owe', 2000, 'EGP',
        '18500000-0000-0000-0000-000000000001', (app_today() - interval '2 months')::date - 3, (app_today() - interval '2 months')::date - 3, 'Car');
select pg_temp.ok('three dates were due and three debts are added', post_due_recurring_debts() = 3);
select pg_temp.ok('each one is an ordinary "I owe" debt of 2,000 linked to its money movement',
  (select count(*) from debts d join transactions t on t.id = d.transaction_id
    where d.recurring_debt_id = '18e00000-0000-0000-0000-000000000001' and d.direction = 'i_owe' and d.amount = 2000
      and d.reason = 'Car' and t.type = 'income' and t.source = 'debt' and t.notes = 'Borrowed from Brother'
      and d.sub_account_id = '18500000-0000-0000-0000-000000000001') = 3);
select pg_temp.ok('the money came into the bank each time', pg_temp.bal('18500000-0000-0000-0000-000000000001') = 16000);
select pg_temp.ok('the next date is next month', (select next_date > app_today() from recurring_debts where id = '18e00000-0000-0000-0000-000000000001'));
select pg_temp.ok('running it again adds nothing', post_due_recurring_debts() = 0
  and (select count(*) from debts where recurring_debt_id = '18e00000-0000-0000-0000-000000000001') = 3);
select pg_temp.ok('net worth counts the money in the bank, not the debts (0017)',
  (compute_net_worth('18181818-0000-0000-0000-000000000001', 'EGP') ->> 'total')::numeric = 16000
  and (compute_net_worth('18181818-0000-0000-0000-000000000001', 'EGP') -> 'by_class' ->> 'liabilities')::numeric = 6000);

\echo '--- 2. repaying works as for any debt'
select record_debt_payment((select id from debts where recurring_debt_id = '18e00000-0000-0000-0000-000000000001' order by date limit 1),
                           2000, app_today(), '18500000-0000-0000-0000-000000000001');
select pg_temp.ok('the oldest one is settled and the money left the bank',
  pg_temp.bal('18500000-0000-0000-0000-000000000001') = 14000
  and (select count(*) from debts where recurring_debt_id = '18e00000-0000-0000-0000-000000000001' and status = 'settled') = 1);

\echo '--- 3. lending every month, with an end'
insert into recurring_debts (id, contact_id, direction, amount, currency, sub_account_id, start_date, next_date, end_date)
values ('18e00000-0000-0000-0000-000000000002', '18c00000-0000-0000-0000-000000000002', 'owed_to_me', 500, 'EGP',
        '18500000-0000-0000-0000-000000000001', (app_today() - interval '3 months')::date, (app_today() - interval '3 months')::date,
        (app_today() - interval '1 month')::date);
select post_due_recurring_debts();
select pg_temp.ok('only the dates up to the end are added (three), out of the bank',
  (select count(*) from debts where recurring_debt_id = '18e00000-0000-0000-0000-000000000002' and direction = 'owed_to_me') = 3
  and pg_temp.bal('18500000-0000-0000-0000-000000000001') = 12500);
select pg_temp.ok('after its end the rule stops', (select not is_active from recurring_debts where id = '18e00000-0000-0000-0000-000000000002'));

\echo '--- 4. checks on the rule'
select pg_temp.fails('a balance in another currency is refused',
  $q$insert into recurring_debts (contact_id, direction, amount, currency, sub_account_id, start_date, next_date)
     values ('18c00000-0000-0000-0000-000000000001', 'i_owe', 10, 'EGP', '18500000-0000-0000-0000-000000000002', current_date, current_date)$q$, '%holds USD%');
select pg_temp.fails('the first date can''t move',
  $q$update recurring_debts set start_date = start_date + 1 where id = '18e00000-0000-0000-0000-000000000001'$q$, '%first date%');
select pg_temp.fails('an end before the start is refused',
  $q$insert into recurring_debts (contact_id, direction, amount, currency, sub_account_id, start_date, next_date, end_date)
     values ('18c00000-0000-0000-0000-000000000001', 'i_owe', 10, 'EGP', '18500000-0000-0000-0000-000000000001', current_date, current_date, current_date - 1)$q$, '%before the first%');
update recurring_debts set is_active = false where id = '18e00000-0000-0000-0000-000000000001';
update recurring_debts set next_date = app_today() - 1 where id = '18e00000-0000-0000-0000-000000000001';
select pg_temp.ok('a paused rule adds nothing', post_due_recurring_debts() = 0);

\echo '--- 5. deleting a rule keeps the debts it added'
delete from recurring_debts where id = '18e00000-0000-0000-0000-000000000001';
select pg_temp.ok('the debts stay, no longer pointing at it',
  (select count(*) from debts where reason = 'Car' and recurring_debt_id is null) = 3);

\echo '--- 6. only your own'
select pg_temp.as_user('18181818-0000-0000-0000-000000000002');
select pg_temp.ok('someone else sees none of it', (select count(*) from recurring_debts) = 0);
select pg_temp.fails('nor can add one with your person and balance',
  $q$insert into recurring_debts (contact_id, direction, amount, currency, sub_account_id, start_date, next_date)
     values ('18c00000-0000-0000-0000-000000000001', 'i_owe', 10, 'EGP', '18500000-0000-0000-0000-000000000001', current_date, current_date)$q$, '%does not belong%');
select pg_temp.fails('nor add another person''s debts', $q$select post_due_recurring_debts('18181818-0000-0000-0000-000000000001')$q$, '%not allowed%');
reset role;
reset session authorization;

\echo '--- 7. the daily jobs add them'
insert into recurring_debts (id, user_id, contact_id, direction, amount, currency, sub_account_id, start_date, next_date)
values ('18e00000-0000-0000-0000-000000000003', '18181818-0000-0000-0000-000000000001', '18c00000-0000-0000-0000-000000000002', 'owed_to_me', 100, 'EGP',
        '18500000-0000-0000-0000-000000000001', current_date - 1, current_date - 1);
select run_daily_jobs();
select pg_temp.ok('the scheduled run added the due one', (select count(*) from debts where recurring_debt_id = '18e00000-0000-0000-0000-000000000003') >= 1);
select pg_temp.ok('every balance still adds up', not exists (select 1 from sub_accounts s where s.balance <> balance_as_of(s.id, '9999-12-31')));
\echo 'ALL 0018 CHECKS PASSED'
