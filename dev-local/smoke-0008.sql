-- Regression tests for migration 0008 (credit cards). Run on a fresh database with all migrations
-- applied, as postgres. Every check prints PASS or aborts with FAIL.
\set ON_ERROR_STOP on

create function pg_temp.ok(label text, cond boolean) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;

insert into auth.users (id, email) values ('eeeeeeee-0000-0000-0000-000000000008', 'e8@test');
select set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-0000-0000-000000000008","role":"authenticated"}', false);
create temp table k as select
  (select s.id from sub_accounts s join accounts a on a.id = s.account_id where a.user_id = 'eeeeeeee-0000-0000-0000-000000000008' and a.name = 'Cash' and s.currency = 'EGP') as cash;
update sub_accounts set opening_balance = 50000 where id = (select cash from k);

insert into accounts (id, user_id, name, type, credit_limit, statement_day, due_day, min_payment_pct)
values ('88000000-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000008', 'CIB Visa', 'credit_card', 30000, 25, 15, 5);
insert into sub_accounts (id, user_id, account_id, currency) values ('88000000-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000008', '88000000-0000-0000-0000-000000000001', 'EGP');
select pg_temp.ok('a credit card account keeps its limit, statement day, due day and minimum %',
  (select type::text = 'credit_card' and credit_limit = 30000 and statement_day = 25 and due_day = 15 and min_payment_pct = 5 from accounts where id = '88000000-0000-0000-0000-000000000001'));

-- spend 8,000 on the card: its balance goes to -8,000
insert into transactions (user_id, type, date, amount, currency, sub_account_id)
values ('eeeeeeee-0000-0000-0000-000000000008', 'expense', current_date, 8000, 'EGP', '88000000-0000-0000-0000-000000000002');
select pg_temp.ok('spending on the card makes its balance minus what is owed',
  (select balance from sub_accounts where id = '88000000-0000-0000-0000-000000000002') = -8000);

select pg_temp.ok('net worth: card debt is its own class, 8,000 owed',
  (compute_net_worth('eeeeeeee-0000-0000-0000-000000000008', 'EGP') -> 'by_class' ->> 'cards')::numeric = 8000);
select pg_temp.ok('net worth: accounts class is the cash only (the card is not a negative account)',
  (compute_net_worth('eeeeeeee-0000-0000-0000-000000000008', 'EGP') -> 'by_class' ->> 'accounts')::numeric = 50000);
select pg_temp.ok('net worth: total = 50,000 cash − 8,000 card debt',
  (compute_net_worth('eeeeeeee-0000-0000-0000-000000000008', 'EGP') ->> 'total')::numeric = 42000);
select pg_temp.ok('net worth: the card debt is not a negative EGP asset in the currency split',
  (compute_net_worth('eeeeeeee-0000-0000-0000-000000000008', 'EGP') -> 'by_currency' ->> 'EGP')::numeric = 50000);

-- pay 5,000 from cash to the card
insert into transactions (user_id, type, date, amount, currency, sub_account_id, to_sub_account_id, to_amount, to_currency)
values ('eeeeeeee-0000-0000-0000-000000000008', 'transfer', current_date, 5000, 'EGP', (select cash from k), '88000000-0000-0000-0000-000000000002', 5000, 'EGP');
select pg_temp.ok('paying the card from cash: owed drops to 3,000, cash to 45,000',
  (select balance from sub_accounts where id = '88000000-0000-0000-0000-000000000002') = -3000
  and (select balance from sub_accounts where id = (select cash from k)) = 45000);
select pg_temp.ok('paying the card does not change net worth (42,000)',
  (compute_net_worth('eeeeeeee-0000-0000-0000-000000000008', 'EGP') ->> 'total')::numeric = 42000);

create function pg_temp.rejected(stmt text) returns boolean language plpgsql as $$
begin
  execute stmt;
  return false;
exception when check_violation then
  return true;
end $$;
select pg_temp.ok('a statement day of 32 is rejected',
  pg_temp.rejected($q$update accounts set statement_day = 32 where id = '88000000-0000-0000-0000-000000000001'$q$));
select pg_temp.ok('a negative credit limit is rejected',
  pg_temp.rejected($q$update accounts set credit_limit = -1 where id = '88000000-0000-0000-0000-000000000001'$q$));
select pg_temp.ok('a minimum payment over 100% is rejected',
  pg_temp.rejected($q$update accounts set min_payment_pct = 101 where id = '88000000-0000-0000-0000-000000000001'$q$));
select pg_temp.ok('every stored balance equals opening balance + its transactions',
  not exists (select 1 from sub_accounts s where s.balance <> balance_as_of(s.id, '9999-12-31')));
-- deleting a user who has a debt paid through an account (the payment is linked to a transaction)
insert into contacts (id, user_id, name) values ('88000000-0000-0000-0000-000000000010', 'eeeeeeee-0000-0000-0000-000000000008', 'Ahmed');
insert into debts (id, user_id, contact_id, direction, amount, currency, date) values ('88000000-0000-0000-0000-000000000011', 'eeeeeeee-0000-0000-0000-000000000008', '88000000-0000-0000-0000-000000000010', 'owed_to_me', 3000, 'EGP', current_date);
select record_debt_payment('88000000-0000-0000-0000-000000000011', 1000, current_date, (select cash from k));
select pg_temp.ok('the debt payment is linked to a transaction', (select transaction_id is not null from debt_payments where debt_id = '88000000-0000-0000-0000-000000000011'));
select set_config('request.jwt.claims', '', false);
delete from auth.users where id = 'eeeeeeee-0000-0000-0000-000000000008';
select pg_temp.ok('a user with a card, debts and linked debt payments can be deleted completely',
  not exists (select 1 from accounts where user_id = 'eeeeeeee-0000-0000-0000-000000000008')
  and not exists (select 1 from debts where user_id = 'eeeeeeee-0000-0000-0000-000000000008'));
\echo 'ALL 0008 CHECKS PASSED'
