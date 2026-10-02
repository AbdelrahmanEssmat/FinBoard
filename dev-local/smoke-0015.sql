-- Regression tests for migration 0015. Run on a fresh database with all migrations applied, as postgres.
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
create function pg_temp.as_user(u uuid, aal text default 'aal1', amr_age_seconds integer default 0) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'aal', aal,
    'amr', json_build_array(json_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint - amr_age_seconds)))::text, false);
end $$;

insert into auth.users (id, email) values
  ('15151515-0000-0000-0000-000000000001', 'a15@test'),
  ('15151515-0000-0000-0000-000000000002', 'b15@test');
insert into accounts (id, user_id, name, type) values
  ('15a00000-0000-0000-0000-000000000001', '15151515-0000-0000-0000-000000000001', 'Bank', 'bank'),
  ('15a00000-0000-0000-0000-000000000002', '15151515-0000-0000-0000-000000000001', 'Card', 'credit_card'),
  ('15a00000-0000-0000-0000-000000000003', '15151515-0000-0000-0000-000000000001', 'Broker', 'investment');
insert into sub_accounts (id, user_id, account_id, currency, opening_balance) values
  ('15500000-0000-0000-0000-000000000001', '15151515-0000-0000-0000-000000000001', '15a00000-0000-0000-0000-000000000001', 'EGP', 50000),
  ('15500000-0000-0000-0000-000000000002', '15151515-0000-0000-0000-000000000001', '15a00000-0000-0000-0000-000000000002', 'EGP', 0),
  ('15500000-0000-0000-0000-000000000003', '15151515-0000-0000-0000-000000000001', '15a00000-0000-0000-0000-000000000001', 'EGP', 0);

\echo '--- 1. each person''s own date'
update settings set timezone = 'Pacific/Kiritimati' where user_id = '15151515-0000-0000-0000-000000000001';
update settings set timezone = 'Pacific/Pago_Pago' where user_id = '15151515-0000-0000-0000-000000000002';
select pg_temp.fails('an unknown time zone is refused',
  $q$update settings set timezone = 'Mars/Olympus' where user_id = '15151515-0000-0000-0000-000000000001'$q$, '%Unknown time zone%');
select pg_temp.as_user('15151515-0000-0000-0000-000000000001');
select pg_temp.ok('today follows the person''s time zone (UTC+14)', app_today() = (now() at time zone 'Pacific/Kiritimati')::date);
select pg_temp.as_user('15151515-0000-0000-0000-000000000002');
select pg_temp.ok('and another person''s (UTC-11)', app_today() = (now() at time zone 'Pacific/Pago_Pago')::date);
select set_config('request.jwt.claims', '', false);
select pg_temp.ok('without a person it is Cairo', app_today() = (now() at time zone 'Africa/Cairo')::date);

\echo '--- 2. the daily jobs run per person, each on their own date'
select run_daily_jobs();
select pg_temp.ok('each person gets today''s snapshot dated in their own time zone',
  exists (select 1 from net_worth_snapshots where user_id = '15151515-0000-0000-0000-000000000001' and snapshot_date = (now() at time zone 'Pacific/Kiritimati')::date)
  and exists (select 1 from net_worth_snapshots where user_id = '15151515-0000-0000-0000-000000000002' and snapshot_date = (now() at time zone 'Pacific/Pago_Pago')::date));
select pg_temp.ok('the jobs leave no identity behind', auth.uid() is null);
update settings set timezone = 'Africa/Cairo' where user_id in ('15151515-0000-0000-0000-000000000001', '15151515-0000-0000-0000-000000000002');

\echo '--- 3. a Cloud''s new rate counts from the day it is set'
select pg_temp.as_user('15151515-0000-0000-0000-000000000001');
insert into sub_accounts (id, user_id, account_id, currency, name, opening_balance, yield_rate, yield_frequency, yield_since) values
  ('15500000-0000-0000-0000-0000000000c1', '15151515-0000-0000-0000-000000000001', '15a00000-0000-0000-0000-000000000003', 'EGP', 'Cloud', 10000, 12, 'monthly', app_today() - 40);
update sub_accounts set yield_accrued_through = app_today() - 40 where id = '15500000-0000-0000-0000-0000000000c1';
update sub_accounts set yield_rate = 24 where id = '15500000-0000-0000-0000-0000000000c1';
select pg_temp.ok('the rate history has the first rate and today''s change',
  (select count(*) from yield_rates where sub_account_id = '15500000-0000-0000-0000-0000000000c1') = 2
  and (select rate from yield_rates where sub_account_id = '15500000-0000-0000-0000-0000000000c1' and effective_from = app_today()) = 24);
select accrue_yield('15151515-0000-0000-0000-000000000001');
select pg_temp.ok('last month''s payout is at the old 12%, not the new 24% (about 100 on 10,000)',
  (select amount from transactions where sub_account_id = '15500000-0000-0000-0000-0000000000c1' and source = 'yield') between 99 and 101);

\echo '--- 4. changing a certificate''s payout frequency after logging payouts'
insert into certificates (id, user_id, account_id, name, principal, currency, interest_rate, payout_frequency, start_date, maturity_date, payout_sub_account_id, auto_log_income)
values ('15c00000-0000-0000-0000-000000000001', '15151515-0000-0000-0000-000000000001', '15a00000-0000-0000-0000-000000000001', 'Monthly CD', 120000, 'EGP', 24, 'monthly',
        current_date - 75, current_date + 1000, '15500000-0000-0000-0000-000000000003', false);
select log_certificate_payout(id) from certificate_payouts where certificate_id = '15c00000-0000-0000-0000-000000000001' and due_date <= current_date;
select pg_temp.ok('two monthly payouts logged', (select count(*) from certificate_payouts where certificate_id = '15c00000-0000-0000-0000-000000000001' and status = 'logged') = 2);
update certificates set payout_frequency = 'quarterly' where id = '15c00000-0000-0000-0000-000000000001';
select pg_temp.ok('monthly -> quarterly: the first quarter pays only its missing month (a third of 7,200)',
  exists (select 1 from certificate_payouts where certificate_id = '15c00000-0000-0000-0000-000000000001' and status = 'pending'
          and due_date = ((current_date - 75) + interval '3 months')::date and amount = 2400));
select pg_temp.ok('the next quarter pays in full', exists (select 1 from certificate_payouts where certificate_id = '15c00000-0000-0000-0000-000000000001'
  and status = 'pending' and due_date = ((current_date - 75) + interval '6 months')::date and amount = 7200));
insert into certificates (id, user_id, account_id, name, principal, currency, interest_rate, payout_frequency, start_date, maturity_date, payout_sub_account_id, auto_log_income)
values ('15c00000-0000-0000-0000-000000000002', '15151515-0000-0000-0000-000000000001', '15a00000-0000-0000-0000-000000000001', 'Quarterly CD', 120000, 'EGP', 24, 'quarterly',
        current_date - 100, current_date + 1000, '15500000-0000-0000-0000-000000000003', false);
select log_certificate_payout(id) from certificate_payouts where certificate_id = '15c00000-0000-0000-0000-000000000002' and due_date <= current_date;
update certificates set payout_frequency = 'monthly' where id = '15c00000-0000-0000-0000-000000000002';
select pg_temp.ok('quarterly -> monthly: the three months already paid aren''t paid again',
  not exists (select 1 from certificate_payouts where certificate_id = '15c00000-0000-0000-0000-000000000002' and status = 'pending'
              and due_date <= ((current_date - 100) + interval '3 months')::date));
select pg_temp.ok('the fourth month is due as usual', exists (select 1 from certificate_payouts where certificate_id = '15c00000-0000-0000-0000-000000000002'
  and status = 'pending' and due_date = ((current_date - 100) + interval '4 months')::date and amount = 2400));

\echo '--- 5. one-step saves, the way the app sends them'
set session authorization authenticator;
set role authenticated;
select pg_temp.as_user('15151515-0000-0000-0000-000000000001');
select create_debt('15d00000-0000-0000-0000-000000000001', '15e00000-0000-0000-0000-000000000001', 'Omar', 'owed_to_me', 3000, 'EGP', current_date,
                   null, 'Rent share', null, null, null, null, null, '15500000-0000-0000-0000-000000000001', '15f00000-0000-0000-0000-000000000001');
select pg_temp.ok('a new debt with a new person and money moved is saved in one go',
  exists (select 1 from contacts where id = '15e00000-0000-0000-0000-000000000001' and name = 'Omar')
  and exists (select 1 from debts where id = '15d00000-0000-0000-0000-000000000001' and transaction_id = '15f00000-0000-0000-0000-000000000001')
  and exists (select 1 from transactions where id = '15f00000-0000-0000-0000-000000000001' and type = 'expense' and amount = 3000 and source = 'debt'
              and source_id = '15d00000-0000-0000-0000-000000000001' and notes = 'Lent to Omar')
  and pg_temp.bal('15500000-0000-0000-0000-000000000001') = 47000);
select create_debt('15d00000-0000-0000-0000-000000000001', '15e00000-0000-0000-0000-000000000001', 'Omar', 'owed_to_me', 3000, 'EGP', current_date,
                   null, 'Rent share', null, null, null, null, null, '15500000-0000-0000-0000-000000000001', '15f00000-0000-0000-0000-000000000001');
select pg_temp.ok('sending it again (offline queue, a second tap) changes nothing',
  (select count(*) from debts where contact_id = '15e00000-0000-0000-0000-000000000001') = 1
  and (select count(*) from contacts where name = 'Omar') = 1 and pg_temp.bal('15500000-0000-0000-0000-000000000001') = 47000);
select pg_temp.fails('a transaction id already in use is refused, never linked to the new debt', $q$
  select create_debt('15d00000-0000-0000-0000-000000000004', '15e00000-0000-0000-0000-000000000001', null, 'i_owe', 10, 'EGP', current_date,
                     null, null, null, null, null, null, null, '15500000-0000-0000-0000-000000000001', '15f00000-0000-0000-0000-000000000001')$q$, '%duplicate key%');
select create_debt('15d00000-0000-0000-0000-000000000002', '15e00000-0000-0000-0000-000000000001', null, 'i_owe', 500, 'USD', current_date);
select pg_temp.ok('a debt without an account moves no money', (select transaction_id is null and sub_account_id is null from debts where id = '15d00000-0000-0000-0000-000000000002'));
select pg_temp.fails('an account in another currency is refused', $q$
  select create_debt('15d00000-0000-0000-0000-000000000003', '15e00000-0000-0000-0000-000000000001', null, 'i_owe', 500, 'USD', current_date,
                     null, null, null, null, null, null, null, '15500000-0000-0000-0000-000000000001', null)$q$, '%holds EGP%');
select create_installment_purchase('15900000-0000-0000-0000-000000000001', '15f00000-0000-0000-0000-0000000000a1', '15f00000-0000-0000-0000-0000000000b1',
  '15500000-0000-0000-0000-000000000002', 'TV', null, null, 12000, 1200, 12, current_date, current_date + 5, '12 installments of 1,100.00 EGP');
select pg_temp.ok('an installment purchase saves the purchase, the fee and the plan together',
  exists (select 1 from card_installment_plans where id = '15900000-0000-0000-0000-000000000001' and transaction_id = '15f00000-0000-0000-0000-0000000000a1' and fees_transaction_id = '15f00000-0000-0000-0000-0000000000b1')
  and pg_temp.bal('15500000-0000-0000-0000-000000000002') = -13200);
select create_installment_purchase('15900000-0000-0000-0000-000000000001', '15f00000-0000-0000-0000-0000000000a1', '15f00000-0000-0000-0000-0000000000b1',
  '15500000-0000-0000-0000-000000000002', 'TV', null, null, 12000, 1200, 12, current_date, current_date + 5, '12 installments of 1,100.00 EGP');
select pg_temp.ok('and sending it again changes nothing', pg_temp.bal('15500000-0000-0000-0000-000000000002') = -13200
  and (select count(*) from card_installment_plans where id = '15900000-0000-0000-0000-000000000001') = 1);

\echo '--- 6. reminders'
select replace_reminders(jsonb_build_array(
  jsonb_build_object('key', 'card:1', 'remind_on', current_date + 2, 'title', 'Card payment due tomorrow', 'body', 'Card'),
  jsonb_build_object('key', 'card:1', 'remind_on', current_date + 3, 'title', 'Card payment due today', 'body', 'Card'),
  jsonb_build_object('key', 'old', 'remind_on', current_date - 5, 'title', 'Old', 'body', 'x')));
select pg_temp.ok('future reminders are saved, past ones ignored', (select count(*) from reminders) = 2);
reset role;
reset session authorization;
update reminders set sent_at = now(), remind_on = app_today() where key = 'card:1' and remind_on = current_date + 2;
set session authorization authenticator;
set role authenticated;
select replace_reminders(jsonb_build_array(jsonb_build_object('key', 'debt:9', 'remind_on', current_date + 1, 'title', 'Instalment due', 'body', 'Omar')));
select pg_temp.ok('replacing keeps what was already sent and swaps the rest',
  (select count(*) from reminders) = 2 and exists (select 1 from reminders where sent_at is not null) and exists (select 1 from reminders where key = 'debt:9'));
select save_push_subscription('https://push.example/abc', 'p256', 'authkey', 'Test');
select pg_temp.ok('a device is registered for reminders', (select count(*) from push_subscriptions) = 1);
select pg_temp.as_user('15151515-0000-0000-0000-000000000002');
select pg_temp.ok('nobody else sees them', (select count(*) from reminders) = 0 and (select count(*) from push_subscriptions) = 0);
select save_push_subscription('https://push.example/abc', 'p256', 'authkey', 'Test');
select pg_temp.ok('a device used by someone else moves over to the new person', (select count(*) from push_subscriptions) = 1);
select pg_temp.fails('only real push addresses', $q$select save_push_subscription('javascript:alert(1)', 'a', 'b')$q$, '%push address%');

\echo '--- 7. crash reports'
insert into app_errors (message, url) values ('TypeError: x is undefined', '/accounts');
select pg_temp.ok('people can send crash reports but not read them', (select count(*) from app_errors) = 0);
insert into app_errors (message) select 'spam ' || g from generate_series(1, 120) g;
reset role;
reset session authorization;
select pg_temp.ok('and at most 100 a day are kept per person', (select count(*) from app_errors where user_id = '15151515-0000-0000-0000-000000000002') = 100);

\echo '--- 8. the second sign-in step'
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status) values
  ('15aa0000-0000-0000-0000-000000000001', '15151515-0000-0000-0000-000000000001', 'Phone', 'totp', 'verified');
set session authorization authenticator;
set role authenticated;
select pg_temp.as_user('15151515-0000-0000-0000-000000000001', 'aal1');
select pg_temp.ok('with a second step on, a password alone shows nothing', (select count(*) from accounts) = 0 and (select count(*) from transactions) = 0);
select pg_temp.fails('and can change nothing', $q$insert into contacts (name) values ('Sneaky')$q$, '%row-level security%');
select pg_temp.fails('nor delete the account', $q$select delete_my_account()$q$, '%sign-in code%');
select pg_temp.as_user('15151515-0000-0000-0000-000000000001', 'aal2');
select pg_temp.ok('after the code everything is there again', exists (select 1 from accounts where id = '15a00000-0000-0000-0000-000000000001') and (select count(*) from transactions) > 0);
select pg_temp.as_user('15151515-0000-0000-0000-000000000002', 'aal1');
select pg_temp.ok('someone without a second step is unaffected', (select count(*) from settings) = 1);

\echo '--- 9. deleting your own account'
select pg_temp.as_user('15151515-0000-0000-0000-000000000001', 'aal2', 3600);
select pg_temp.fails('a password typed an hour ago isn''t enough', $q$select delete_my_account()$q$, '%password again%');
select pg_temp.as_user('15151515-0000-0000-0000-000000000001', 'aal2', 30);
select delete_my_account();
reset role;
reset session authorization;
select pg_temp.ok('the account and every row of it are gone',
  not exists (select 1 from auth.users where id = '15151515-0000-0000-0000-000000000001')
  and not exists (select 1 from accounts where user_id = '15151515-0000-0000-0000-000000000001')
  and not exists (select 1 from transactions where user_id = '15151515-0000-0000-0000-000000000001')
  and not exists (select 1 from certificates where user_id = '15151515-0000-0000-0000-000000000001')
  and not exists (select 1 from reminders where user_id = '15151515-0000-0000-0000-000000000001'));
select pg_temp.ok('the other person''s data is untouched', exists (select 1 from settings where user_id = '15151515-0000-0000-0000-000000000002'));
select pg_temp.ok('every remaining balance still adds up', not exists (select 1 from sub_accounts s where s.balance <> balance_as_of(s.id, '9999-12-31')));
\echo 'ALL 0015 CHECKS PASSED'
