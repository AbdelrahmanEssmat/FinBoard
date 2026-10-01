-- Regression tests for migration 0014 (fixes found by the brute-force test and the area reviews).
-- Run on a fresh database with all migrations applied, as postgres. Every check prints PASS or aborts with FAIL.
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

insert into auth.users (id, email) values ('14141414-0000-0000-0000-000000000014', 'u14@test');
select set_config('request.jwt.claims', '{"sub":"14141414-0000-0000-0000-000000000014","role":"authenticated"}', false);
insert into accounts (id, user_id, name, type) values
  ('14a00000-0000-0000-0000-000000000001', '14141414-0000-0000-0000-000000000014', 'Bank', 'bank'),
  ('14a00000-0000-0000-0000-000000000002', '14141414-0000-0000-0000-000000000014', 'Broker', 'investment'),
  ('14a00000-0000-0000-0000-000000000003', '14141414-0000-0000-0000-000000000014', 'Card', 'credit_card');
insert into sub_accounts (id, user_id, account_id, currency, opening_balance) values
  ('14500000-0000-0000-0000-000000000001', '14141414-0000-0000-0000-000000000014', '14a00000-0000-0000-0000-000000000001', 'EGP', 50000),
  ('14500000-0000-0000-0000-000000000002', '14141414-0000-0000-0000-000000000014', '14a00000-0000-0000-0000-000000000001', 'USD', 0),
  ('14500000-0000-0000-0000-000000000003', '14141414-0000-0000-0000-000000000014', '14a00000-0000-0000-0000-000000000003', 'EGP', 0);

\echo '--- 1. a currency is fixed once money is recorded in it'
insert into transactions (user_id, type, date, amount, currency, sub_account_id) values ('14141414-0000-0000-0000-000000000014', 'expense', current_date, 10, 'EGP', '14500000-0000-0000-0000-000000000001');
select pg_temp.fails('a balance with transactions keeps its currency',
  $q$update sub_accounts set currency = 'USD' where id = '14500000-0000-0000-0000-000000000001'$q$, '%can''t change%');
update sub_accounts set currency = 'EUR' where id = '14500000-0000-0000-0000-000000000002';
select pg_temp.ok('an empty balance can still change currency', (select currency from sub_accounts where id = '14500000-0000-0000-0000-000000000002') = 'EUR');
update sub_accounts set currency = 'USD' where id = '14500000-0000-0000-0000-000000000002';

\echo '--- 2. undoing a sale restores the price and the cost'
insert into holdings (id, user_id, account_id, name, units, avg_cost, current_price, currency, bought_at, price_updated_at) values
  ('14b00000-0000-0000-0000-000000000001', '14141414-0000-0000-0000-000000000014', '14a00000-0000-0000-0000-000000000002', 'Fund', 100, 10, 12, 'EGP', '2026-01-01', now() - interval '2 days');
select sell_holding('14b00000-0000-0000-0000-000000000001', 40, 150, current_date, 0, null, null, '14c00000-0000-0000-0000-000000000001');
select pg_temp.ok('a sale at a typo price sets that price', (select current_price from holdings where id = '14b00000-0000-0000-0000-000000000001') = 150);
delete from holding_sales where id = '14c00000-0000-0000-0000-000000000001';
select pg_temp.ok('undoing it brings back 100 units at the old price 12',
  (select units = 100 and current_price = 12 and price_updated_at < now() - interval '1 day' from holdings where id = '14b00000-0000-0000-0000-000000000001'));
select sell_holding('14b00000-0000-0000-0000-000000000001', 100, 11, current_date, 0, null, null, '14c00000-0000-0000-0000-000000000002');
update holdings set units = 50, avg_cost = 20 where id = '14b00000-0000-0000-0000-000000000001';
update holdings set current_price = 21, price_updated_at = now() + interval '1 second' where id = '14b00000-0000-0000-0000-000000000001';
delete from holding_sales where id = '14c00000-0000-0000-0000-000000000002';
select pg_temp.ok('units sold at cost 10 come back at cost 10 (150 units, average 13.33)',
  (select units = 150 and avg_cost = 13.333333 from holdings where id = '14b00000-0000-0000-0000-000000000001'));
select pg_temp.ok('a price entered after the sale is kept', (select current_price from holdings where id = '14b00000-0000-0000-0000-000000000001') = 21);
select pg_temp.fails('a holding with sales keeps its currency', $q$
  do $d$ begin
    perform sell_holding('14b00000-0000-0000-0000-000000000001', 1, 21, current_date);
    update holdings set currency = 'USD' where id = '14b00000-0000-0000-0000-000000000001';
  end $d$ $q$, '%can''t change%');

\echo '--- 3. Clouds'
-- a monthly Cloud with 10,000; correcting its balance is a dated adjustment, the opening balance stays
insert into sub_accounts (id, user_id, account_id, currency, name, opening_balance, yield_rate, yield_frequency, yield_since) values
  ('14500000-0000-0000-0000-0000000000c1', '14141414-0000-0000-0000-000000000014', '14a00000-0000-0000-0000-000000000002', 'EGP', 'Monthly', 10000, 12, 'monthly', current_date - 40);
select set_sub_account_balance('14500000-0000-0000-0000-0000000000c1', 12000);
select pg_temp.ok('a Cloud set to 12,000 holds 12,000', pg_temp.bal('14500000-0000-0000-0000-0000000000c1') = 12000);
select pg_temp.ok('through a 2,000 "Balance correction" dated today, not the opening balance',
  (select opening_balance from sub_accounts where id = '14500000-0000-0000-0000-0000000000c1') = 10000
  and exists (select 1 from transactions where sub_account_id = '14500000-0000-0000-0000-0000000000c1' and source = 'adjustment' and type = 'income' and amount = 2000 and date = app_today()));
select set_sub_account_balance('14500000-0000-0000-0000-0000000000c1', 12000);
select pg_temp.ok('setting the same balance again adds nothing', (select count(*) from transactions where source = 'adjustment') = 1);

-- a daily Cloud starting next week earns nothing before then
insert into sub_accounts (id, user_id, account_id, currency, opening_balance, yield_rate, yield_frequency, yield_since) values
  ('14500000-0000-0000-0000-0000000000c2', '14141414-0000-0000-0000-000000000014', '14a00000-0000-0000-0000-000000000002', 'EGP', 10000, 20, 'daily', app_today() + 5);
select pg_temp.ok('a daily Cloud starting in 5 days is paid from then', (select yield_accrued_through from sub_accounts where id = '14500000-0000-0000-0000-0000000000c2') = app_today() + 5);
select accrue_yield('14141414-0000-0000-0000-000000000014');
select pg_temp.ok('and gets no interest today', not exists (select 1 from transactions where sub_account_id = '14500000-0000-0000-0000-0000000000c2'));

-- monthly -> daily: daily interest picks up where the last monthly payout left off
insert into sub_accounts (id, user_id, account_id, currency, opening_balance, yield_rate, yield_frequency, yield_since) values
  ('14500000-0000-0000-0000-0000000000c3', '14141414-0000-0000-0000-000000000014', '14a00000-0000-0000-0000-000000000002', 'EGP', 10000, 12, 'monthly', app_today() - 40);
update sub_accounts set yield_accrued_through = app_today() - 40 where id = '14500000-0000-0000-0000-0000000000c3';  -- as if created 40 days ago
select accrue_yield('14141414-0000-0000-0000-000000000014');
create temp table c3 as select max(date) as paid_on from transactions where sub_account_id = '14500000-0000-0000-0000-0000000000c3' and source = 'yield';
select pg_temp.ok('the monthly payout was posted', (select paid_on from c3) = ((app_today() - 40) + interval '1 month')::date);
update sub_accounts set yield_frequency = 'daily' where id = '14500000-0000-0000-0000-0000000000c3';
select pg_temp.ok('switching to daily continues from that payout', (select yield_accrued_through from sub_accounts where id = '14500000-0000-0000-0000-0000000000c3') = (select paid_on from c3));
select accrue_yield('14141414-0000-0000-0000-000000000014');
select pg_temp.ok('every day since the payout is paid daily, none twice',
  (select count(*) from transactions where sub_account_id = '14500000-0000-0000-0000-0000000000c3' and source = 'yield' and date > (select paid_on from c3)) = app_today() - (select paid_on from c3));

-- daily -> monthly: the first monthly payout doesn't pay again for days already paid daily
insert into sub_accounts (id, user_id, account_id, currency, opening_balance, yield_rate, yield_frequency, yield_since) values
  ('14500000-0000-0000-0000-0000000000c4', '14141414-0000-0000-0000-000000000014', '14a00000-0000-0000-0000-000000000002', 'EGP', 100000, 12, 'daily', app_today() - 40);
update sub_accounts set yield_accrued_through = app_today() - 40 where id = '14500000-0000-0000-0000-0000000000c4';
select accrue_yield('14141414-0000-0000-0000-000000000014');
-- switch to monthly with the payout day today (previous payout day a month ago), as if a day had passed
update sub_accounts set yield_frequency = 'monthly', yield_since = (app_today() - interval '1 month')::date where id = '14500000-0000-0000-0000-0000000000c4';
delete from transactions where sub_account_id = '14500000-0000-0000-0000-0000000000c4' and date = app_today();
update sub_accounts set yield_accrued_through = app_today() - 1 where id = '14500000-0000-0000-0000-0000000000c4';
select accrue_yield('14141414-0000-0000-0000-000000000014');
select pg_temp.ok('the first monthly payout covers only the day not yet paid (about 1/30 of a month)',
  (select amount from transactions where sub_account_id = '14500000-0000-0000-0000-0000000000c4' and date = app_today())
    < pg_temp.bal('14500000-0000-0000-0000-0000000000c4') * 0.12 / 12 / 10);

\echo '--- 4. editing a certificate never drops a due payout'
insert into certificates (id, user_id, account_id, name, principal, currency, interest_rate, payout_frequency, start_date, maturity_date, payout_sub_account_id, auto_log_income)
values ('14d00000-0000-0000-0000-000000000001', '14141414-0000-0000-0000-000000000014', '14a00000-0000-0000-0000-000000000001', 'CD', 120000, 'EGP', 24, 'monthly',
        current_date - 75, current_date + 290, '14500000-0000-0000-0000-000000000001', false);
create temp table before_edit as select count(*) as n from certificate_payouts where certificate_id = '14d00000-0000-0000-0000-000000000001';
update certificate_payouts set status = 'skipped'
 where id = (select id from certificate_payouts where certificate_id = '14d00000-0000-0000-0000-000000000001' and due_date > current_date + 100 order by due_date limit 1);
update certificates set interest_rate = 25 where id = '14d00000-0000-0000-0000-000000000001';
select pg_temp.ok('after skipping a future payout and changing the rate, no payout is lost',
  (select count(*) from certificate_payouts where certificate_id = '14d00000-0000-0000-0000-000000000001') = (select n from before_edit));
select pg_temp.ok('the overdue payouts are still there, at the new rate',
  (select count(*) from certificate_payouts where certificate_id = '14d00000-0000-0000-0000-000000000001' and status = 'pending' and due_date <= current_date and amount = 2500) = 2);

\echo '--- 5. categories'
insert into categories (id, user_id, kind, name) values ('14e00000-0000-0000-0000-000000000001', '14141414-0000-0000-0000-000000000014', 'expense', 'Car');
insert into categories (id, user_id, kind, name, parent_id) values
  ('14e00000-0000-0000-0000-000000000002', '14141414-0000-0000-0000-000000000014', 'expense', 'Fuel', '14e00000-0000-0000-0000-000000000001'),
  ('14e00000-0000-0000-0000-000000000003', '14141414-0000-0000-0000-000000000014', 'expense', 'Service', '14e00000-0000-0000-0000-000000000001');
insert into transactions (id, user_id, type, date, amount, currency, sub_account_id, category_id) values
  ('14f00000-0000-0000-0000-000000000001', '14141414-0000-0000-0000-000000000014', 'expense', current_date, 800, 'EGP', '14500000-0000-0000-0000-000000000001', '14e00000-0000-0000-0000-000000000002');
delete from categories where id = '14e00000-0000-0000-0000-000000000002';
select pg_temp.ok('deleting a sub-category moves its spending to the parent',
  (select category_id from transactions where id = '14f00000-0000-0000-0000-000000000001') = '14e00000-0000-0000-0000-000000000001');
select pg_temp.fails('no third level', $q$insert into categories (user_id, kind, name, parent_id) values ('14141414-0000-0000-0000-000000000014', 'expense', 'Oil', '14e00000-0000-0000-0000-000000000003')$q$, '%their own sub-categories%');
insert into categories (id, user_id, kind, name) values ('14e00000-0000-0000-0000-000000000004', '14141414-0000-0000-0000-000000000014', 'expense', 'Home');
select pg_temp.fails('a category with sub-categories can''t move under another',
  $q$update categories set parent_id = '14e00000-0000-0000-0000-000000000004' where id = '14e00000-0000-0000-0000-000000000001'$q$, '%has sub-categories%');
select pg_temp.fails('a parent must be the same kind',
  $q$insert into categories (user_id, kind, name, parent_id) values ('14141414-0000-0000-0000-000000000014', 'income', 'Bonus', '14e00000-0000-0000-0000-000000000004')$q$, '%income category%');
delete from categories where id = '14e00000-0000-0000-0000-000000000001';
select pg_temp.ok('deleting a parent keeps its sub-categories, now top level',
  (select parent_id is null from categories where id = '14e00000-0000-0000-0000-000000000003'));

\echo '--- 6. the nightly job skips archived payout balances'
insert into sub_accounts (id, user_id, account_id, currency, opening_balance, is_archived) values
  ('14500000-0000-0000-0000-0000000000a1', '14141414-0000-0000-0000-000000000014', '14a00000-0000-0000-0000-000000000001', 'EGP', 0, true);
insert into certificates (id, user_id, account_id, name, principal, currency, interest_rate, payout_frequency, start_date, maturity_date, payout_sub_account_id, auto_log_income)
values ('14d00000-0000-0000-0000-000000000002', '14141414-0000-0000-0000-000000000014', '14a00000-0000-0000-0000-000000000001', 'Old CD', 120000, 'EGP', 24, 'monthly',
        current_date - 75, current_date + 290, '14500000-0000-0000-0000-0000000000a1', true);
select process_certificate_payouts('14141414-0000-0000-0000-000000000014');
select pg_temp.ok('no interest is paid into an archived balance', pg_temp.bal('14500000-0000-0000-0000-0000000000a1') = 0);

\echo '--- 7. recurring rules'
select pg_temp.fails('a rule must use its balance''s currency',
  $q$insert into recurring_transactions (user_id, name, type, amount, currency, sub_account_id, frequency, next_date) values ('14141414-0000-0000-0000-000000000014', 'X', 'expense', 10, 'USD', '14500000-0000-0000-0000-000000000001', 'monthly', current_date)$q$, '%account holds EGP%');
-- the 31st survives a change of interval
insert into recurring_transactions (id, user_id, name, type, amount, currency, sub_account_id, frequency, next_date, auto_post) values
  ('14700000-0000-0000-0000-000000000001', '14141414-0000-0000-0000-000000000014', 'Rent', 'expense', 100, 'EGP', '14500000-0000-0000-0000-000000000001', 'monthly', '2027-01-31', true);
begin;
select set_config('app.posting_recurring', 'on', true);
update recurring_transactions set next_date = '2027-11-30' where id = '14700000-0000-0000-0000-000000000001';
commit;
update recurring_transactions set interval_count = 2 where id = '14700000-0000-0000-0000-000000000001';
select pg_temp.ok('a rule on the 31st keeps its day when the interval changes', (select anchor_date from recurring_transactions where id = '14700000-0000-0000-0000-000000000001') = '2027-01-31');
-- resuming after a pause doesn't post every missed month
insert into recurring_transactions (id, user_id, name, type, amount, currency, sub_account_id, frequency, next_date, auto_post, is_active) values
  ('14700000-0000-0000-0000-000000000002', '14141414-0000-0000-0000-000000000014', 'Gym', 'expense', 100, 'EGP', '14500000-0000-0000-0000-000000000001', 'monthly', current_date - 95, true, false);
update recurring_transactions set is_active = true where id = '14700000-0000-0000-0000-000000000002';
select post_due_recurring('14141414-0000-0000-0000-000000000014');
select pg_temp.ok('resuming a rule paused 3 months ago posts at most the current one',
  (select count(*) from transactions where source = 'recurring' and source_id = '14700000-0000-0000-0000-000000000002') <= 1);
-- a posting moved to another date becomes a normal transaction, and the rule's own posting still happens
insert into recurring_transactions (id, user_id, name, type, amount, currency, sub_account_id, frequency, next_date, auto_post) values
  ('14700000-0000-0000-0000-000000000003', '14141414-0000-0000-0000-000000000014', 'Coffee', 'expense', 5, 'EGP', '14500000-0000-0000-0000-000000000001', 'daily', current_date - 2, true);
select post_due_recurring('14141414-0000-0000-0000-000000000014');
update transactions set date = current_date where source_id = '14700000-0000-0000-0000-000000000003' and date = current_date - 2;
select pg_temp.ok('the moved posting is now a normal transaction',
  exists (select 1 from transactions where source = 'manual' and date = current_date and amount = 5 and notes = 'Coffee'));
select pg_temp.ok('and the rule''s posting for that date is still there',
  exists (select 1 from transactions where source = 'recurring' and source_id = '14700000-0000-0000-0000-000000000003' and date = current_date));

\echo '--- 8. deleting an installment purchase takes its fee with it'
insert into transactions (id, user_id, type, date, amount, currency, sub_account_id) values
  ('14f00000-0000-0000-0000-0000000000a1', '14141414-0000-0000-0000-000000000014', 'expense', current_date, 12000, 'EGP', '14500000-0000-0000-0000-000000000003'),
  ('14f00000-0000-0000-0000-0000000000b1', '14141414-0000-0000-0000-000000000014', 'expense', current_date, 1200, 'EGP', '14500000-0000-0000-0000-000000000003');
insert into card_installment_plans (user_id, account_id, sub_account_id, transaction_id, fees_transaction_id, description, currency, principal, fees, months, purchase_date, first_billing_date)
values ('14141414-0000-0000-0000-000000000014', '14a00000-0000-0000-0000-000000000003', '14500000-0000-0000-0000-000000000003',
        '14f00000-0000-0000-0000-0000000000a1', '14f00000-0000-0000-0000-0000000000b1', 'TV', 'EGP', 12000, 1200, 12, current_date, current_date + 5);
delete from transactions where id = '14f00000-0000-0000-0000-0000000000a1';
select pg_temp.ok('the plan and its fee are gone with the purchase, and the card owes nothing',
  not exists (select 1 from card_installment_plans where user_id = '14141414-0000-0000-0000-000000000014') and not exists (select 1 from transactions where id = '14f00000-0000-0000-0000-0000000000b1')
  and pg_temp.bal('14500000-0000-0000-0000-000000000003') = 0);

select pg_temp.ok('every balance equals opening balance + its transactions',
  not exists (select 1 from sub_accounts s where s.balance <> balance_as_of(s.id, '9999-12-31')));
\echo 'ALL 0014 CHECKS PASSED'
