-- Regression tests for migration 0013 (deleting balances and accounts, setting a balance).
-- Run on a fresh database with all migrations applied, as postgres. Every check prints PASS or aborts with FAIL.
-- The deletes and edits run the way the app sends them: as the API role with the user's token.
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
-- every balance equals its opening balance plus all of its transactions
create function pg_temp.consistent() returns boolean language sql as $$
  select not exists (select 1 from public.sub_accounts s where s.balance <> public.balance_as_of(s.id, '9999-12-31')) $$;

-- ---------------------------------------------------------------------------
-- seed: Bank (EGP + USD), Wallet (EGP), Broker (EGP + a Cloud), Card (EGP)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values ('eeeeeeee-0000-0000-0000-000000000013', 'e13@test'), ('eeeeeeee-0000-0000-0000-000000000099', 'other13@test');
select set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-0000-0000-000000000013","role":"authenticated"}', false);

insert into accounts (id, user_id, name, type) values
  ('13a00000-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000013', 'Bank', 'bank'),
  ('13a00000-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000013', 'Wallet', 'cash'),
  ('13a00000-0000-0000-0000-000000000003', 'eeeeeeee-0000-0000-0000-000000000013', 'Broker', 'investment'),
  ('13a00000-0000-0000-0000-000000000004', 'eeeeeeee-0000-0000-0000-000000000013', 'Card', 'credit_card'),
  ('13a00000-0000-0000-0000-000000000099', 'eeeeeeee-0000-0000-0000-000000000099', 'Theirs', 'bank');
insert into sub_accounts (id, user_id, account_id, currency, opening_balance) values
  ('13500000-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000013', '13a00000-0000-0000-0000-000000000001', 'EGP', 50000),
  ('13500000-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000013', '13a00000-0000-0000-0000-000000000001', 'USD', 0),
  ('13500000-0000-0000-0000-000000000003', 'eeeeeeee-0000-0000-0000-000000000013', '13a00000-0000-0000-0000-000000000002', 'EGP', 1000),
  ('13500000-0000-0000-0000-000000000004', 'eeeeeeee-0000-0000-0000-000000000013', '13a00000-0000-0000-0000-000000000003', 'EGP', 0),
  ('13500000-0000-0000-0000-000000000006', 'eeeeeeee-0000-0000-0000-000000000013', '13a00000-0000-0000-0000-000000000004', 'EGP', 0),
  ('13500000-0000-0000-0000-000000000099', 'eeeeeeee-0000-0000-0000-000000000099', '13a00000-0000-0000-0000-000000000099', 'EGP', 777);
insert into sub_accounts (id, user_id, account_id, currency, name, opening_balance, yield_rate, yield_frequency, yield_since) values
  ('13500000-0000-0000-0000-000000000005', 'eeeeeeee-0000-0000-0000-000000000013', '13a00000-0000-0000-0000-000000000003', 'EGP', 'Monthly Cloud', 0, 20, 'monthly', current_date);

insert into transactions (id, user_id, type, date, amount, currency, sub_account_id, to_sub_account_id, to_amount, to_currency, notes) values
  ('13700000-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000013', 'income',   '2026-09-01', 10000, 'EGP', '13500000-0000-0000-0000-000000000001', null, null, null, 'Salary'),
  ('13700000-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000013', 'transfer', '2026-09-02', 2000,  'EGP', '13500000-0000-0000-0000-000000000001', '13500000-0000-0000-0000-000000000003', 2000, 'EGP', 'ATM'),
  ('13700000-0000-0000-0000-000000000003', 'eeeeeeee-0000-0000-0000-000000000013', 'transfer', '2026-09-03', 500,   'EGP', '13500000-0000-0000-0000-000000000003', '13500000-0000-0000-0000-000000000001', 500, 'EGP', null),
  ('13700000-0000-0000-0000-000000000004', 'eeeeeeee-0000-0000-0000-000000000013', 'transfer', '2026-09-04', 5000,  'EGP', '13500000-0000-0000-0000-000000000001', '13500000-0000-0000-0000-000000000002', 100, 'USD', null),
  ('13700000-0000-0000-0000-000000000005', 'eeeeeeee-0000-0000-0000-000000000013', 'expense',  '2026-09-05', 300,   'EGP', '13500000-0000-0000-0000-000000000003', null, null, null, null),
  ('13700000-0000-0000-0000-000000000006', 'eeeeeeee-0000-0000-0000-000000000013', 'transfer', '2026-09-06', 3000,  'EGP', '13500000-0000-0000-0000-000000000001', '13500000-0000-0000-0000-000000000005', 3000, 'EGP', null),
  ('13700000-0000-0000-0000-000000000007', 'eeeeeeee-0000-0000-0000-000000000013', 'income',   '2026-09-07', 4000,  'EGP', '13500000-0000-0000-0000-000000000004', null, null, null, null),
  ('13700000-0000-0000-0000-000000000008', 'eeeeeeee-0000-0000-0000-000000000013', 'transfer', '2026-09-08', 1000,  'EGP', '13500000-0000-0000-0000-000000000004', '13500000-0000-0000-0000-000000000005', 1000, 'EGP', null),
  ('13700000-0000-0000-0000-000000000009', 'eeeeeeee-0000-0000-0000-000000000013', 'expense',  '2026-09-09', 700,   'EGP', '13500000-0000-0000-0000-000000000006', null, null, null, null),
  ('13700000-0000-0000-0000-000000000010', 'eeeeeeee-0000-0000-0000-000000000013', 'transfer', '2026-09-10', 400,   'EGP', '13500000-0000-0000-0000-000000000001', '13500000-0000-0000-0000-000000000006', 400, 'EGP', 'Card payment');

-- a loan of 1000 from the wallet, fully repaid into the wallet
insert into contacts (id, user_id, name) values ('13c00000-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000013', 'Omar');
insert into transactions (id, user_id, type, date, amount, currency, sub_account_id, source, source_id) values
  ('13700000-0000-0000-0000-000000000011', 'eeeeeeee-0000-0000-0000-000000000013', 'expense', '2026-09-11', 1000, 'EGP', '13500000-0000-0000-0000-000000000003', 'debt', '13d00000-0000-0000-0000-000000000001');
insert into debts (id, user_id, contact_id, direction, amount, currency, date, sub_account_id, transaction_id) values
  ('13d00000-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000013', '13c00000-0000-0000-0000-000000000001', 'owed_to_me', 1000, 'EGP', '2026-09-11',
   '13500000-0000-0000-0000-000000000003', '13700000-0000-0000-0000-000000000011');
select record_debt_payment('13d00000-0000-0000-0000-000000000001', 1000, '2026-09-12', '13500000-0000-0000-0000-000000000003');

-- a fund in the broker, 40 of 100 units sold with the money paid into the wallet
insert into holdings (id, user_id, account_id, name, units, avg_cost, current_price, currency, bought_at) values
  ('13b00000-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000013', '13a00000-0000-0000-0000-000000000003', 'Fund', 100, 10, 12, 'EGP', '2026-01-01');
select sell_holding('13b00000-0000-0000-0000-000000000001', 40, 12, '2026-09-13', 0, '13500000-0000-0000-0000-000000000003');

-- a certificate held at the bank that pays its interest into the wallet; one payout logged
insert into certificates (id, user_id, account_id, name, principal, currency, interest_rate, payout_frequency, start_date, maturity_date, payout_sub_account_id, auto_log_income)
values ('13e00000-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000013', '13a00000-0000-0000-0000-000000000001', 'CD', 120000, 'EGP', 20, 'monthly',
        current_date - 45, current_date + 1000, '13500000-0000-0000-0000-000000000003', true);
create temp table payout as select id, amount from certificate_payouts where certificate_id = '13e00000-0000-0000-0000-000000000001' order by due_date limit 1;
select public.log_certificate_payout((select id from payout));
grant select on payout to authenticated;

select pg_temp.ok('seed: balances add up', pg_temp.consistent());
select pg_temp.ok('seed: bank 50,100', pg_temp.bal('13500000-0000-0000-0000-000000000001') = 50100);
select pg_temp.ok('seed: wallet 2,680 + interest', pg_temp.bal('13500000-0000-0000-0000-000000000003') = 2680 + (select amount from payout));
select pg_temp.ok('seed: the loan is repaid', (select status from debts where id = '13d00000-0000-0000-0000-000000000001') = 'settled');

-- from here on, act exactly like the app: API role, this user's token
set session authorization authenticator;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-0000-0000-000000000013","role":"authenticated"}', false);

\echo '--- 1. delete one balance (the wallet) that has transfers, a repaid loan, a sale and interest'
delete from sub_accounts where id = '13500000-0000-0000-0000-000000000003';
select pg_temp.ok('the wallet balance is deleted', not exists (select 1 from sub_accounts where id = '13500000-0000-0000-0000-000000000003'));
select pg_temp.ok('its own expense went with it', not exists (select 1 from transactions where id = '13700000-0000-0000-0000-000000000005'));
select pg_temp.ok('the bank balance did not move', pg_temp.bal('13500000-0000-0000-0000-000000000001') = 50100);
select pg_temp.ok('bank -> wallet transfer is now an expense on the bank',
  exists (select 1 from transactions where id = '13700000-0000-0000-0000-000000000002' and type = 'expense' and amount = 2000 and sub_account_id = '13500000-0000-0000-0000-000000000001'
          and to_sub_account_id is null and source = 'detached_transfer' and date = '2026-09-02' and notes like 'ATM%Moved to Wallet (EGP), which was deleted'));
select pg_temp.ok('wallet -> bank transfer is now income on the bank',
  exists (select 1 from transactions where id = '13700000-0000-0000-0000-000000000003' and type = 'income' and amount = 500 and currency = 'EGP'
          and sub_account_id = '13500000-0000-0000-0000-000000000001' and source = 'detached_transfer' and payee = 'Wallet (EGP)'));
select pg_temp.ok('the loan stays repaid, with its repayment kept',
  (select status from debts where id = '13d00000-0000-0000-0000-000000000001') = 'settled'
  and (select count(*) from debt_payments where debt_id = '13d00000-0000-0000-0000-000000000001' and transaction_id is null) = 1);
select pg_temp.ok('the sold units stay sold, and the sale stays recorded',
  (select units from holdings where id = '13b00000-0000-0000-0000-000000000001') = 60
  and exists (select 1 from holding_sales where holding_id = '13b00000-0000-0000-0000-000000000001' and transaction_id is null));
select pg_temp.ok('the certificate payout stays logged', (select status from certificate_payouts where id = (select id from payout)) = 'logged');
select pg_temp.ok('every balance still adds up', pg_temp.consistent());

\echo '--- 2. delete a whole account (the bank) with transfers to the Cloud and the card'
delete from accounts where id = '13a00000-0000-0000-0000-000000000001';
select pg_temp.ok('the account and both its balances are gone',
  not exists (select 1 from accounts where id = '13a00000-0000-0000-0000-000000000001')
  and not exists (select 1 from sub_accounts where account_id = '13a00000-0000-0000-0000-000000000001'));
select pg_temp.ok('the transfer between its own two balances is gone', not exists (select 1 from transactions where id = '13700000-0000-0000-0000-000000000004'));
select pg_temp.ok('the Cloud did not move (4,000)', pg_temp.bal('13500000-0000-0000-0000-000000000005') = 4000);
select pg_temp.ok('the card did not move (-300)', pg_temp.bal('13500000-0000-0000-0000-000000000006') = -300);
select pg_temp.ok('the card payment is now income on the card, named after the bank',
  exists (select 1 from transactions where id = '13700000-0000-0000-0000-000000000010' and type = 'income' and sub_account_id = '13500000-0000-0000-0000-000000000006'
          and source = 'detached_transfer' and payee = 'Bank (EGP)' and notes like 'Card payment%Moved from Bank (EGP)%'));
select pg_temp.ok('the certificate held there went with it', not exists (select 1 from certificates where id = '13e00000-0000-0000-0000-000000000001'));
select pg_temp.ok('every balance still adds up', pg_temp.consistent());

\echo '--- 3. delete a Cloud funded by a transfer'
delete from sub_accounts where id = '13500000-0000-0000-0000-000000000005';
select pg_temp.ok('the Cloud is deleted', not exists (select 1 from sub_accounts where id = '13500000-0000-0000-0000-000000000005'));
select pg_temp.ok('the broker cash did not move (3,000)', pg_temp.bal('13500000-0000-0000-0000-000000000004') = 3000);
select pg_temp.ok('broker -> Cloud transfer is now an expense on the broker',
  exists (select 1 from transactions where id = '13700000-0000-0000-0000-000000000008' and type = 'expense' and sub_account_id = '13500000-0000-0000-0000-000000000004'
          and payee = 'Broker · Monthly Cloud (EGP)'));
select pg_temp.ok('every balance still adds up', pg_temp.consistent());

\echo '--- 4. set a balance to what it really is'
select pg_temp.ok('the card is set to exactly -1,234.50',
  public.set_sub_account_balance('13500000-0000-0000-0000-000000000006', -1234.5) = -1234.5 and pg_temp.bal('13500000-0000-0000-0000-000000000006') = -1234.5);
select pg_temp.ok('its transactions are untouched', (select count(*) from transactions where sub_account_id = '13500000-0000-0000-0000-000000000006') = 2);
select pg_temp.ok('and it still adds up (the difference went into the opening balance)', pg_temp.consistent()
  and (select opening_balance from sub_accounts where id = '13500000-0000-0000-0000-000000000006') = -934.5);
select pg_temp.ok('setting the same value again changes nothing (safe to replay offline)',
  public.set_sub_account_balance('13500000-0000-0000-0000-000000000006', -1234.5) = -1234.5
  and (select opening_balance from sub_accounts where id = '13500000-0000-0000-0000-000000000006') = -934.5);
insert into transactions (user_id, type, date, amount, currency, sub_account_id) values
  ('eeeeeeee-0000-0000-0000-000000000013', 'expense', '2026-09-20', 66, 'EGP', '13500000-0000-0000-0000-000000000006');
select pg_temp.ok('later transactions move it from the new value', pg_temp.bal('13500000-0000-0000-0000-000000000006') = -1300.5);
select pg_temp.fails('someone else''s balance can''t be set',
  $q$select public.set_sub_account_balance('13500000-0000-0000-0000-000000000099', 0)$q$, '%no longer exists%');
select pg_temp.fails('the internal helper is not callable from the app',
  $q$select public.detach_sub_account('13500000-0000-0000-0000-000000000004')$q$, '%permission denied%');
delete from sub_accounts where id = '13500000-0000-0000-0000-000000000099';
delete from accounts where id = '13a00000-0000-0000-0000-000000000099';

\echo '--- 5. everything else deletes cleanly'
delete from holding_sales;
select pg_temp.ok('deleting a sale gives the units back', (select units from holdings where id = '13b00000-0000-0000-0000-000000000001') = 100);
delete from holdings;
delete from debts;
select pg_temp.ok('deleting a repaid loan keeps balances consistent', pg_temp.consistent());
delete from contacts;
delete from recurring_transactions;
delete from budgets;
delete from categories;
delete from accounts;
select pg_temp.ok('all accounts, balances and transactions are gone',
  not exists (select 1 from accounts) and not exists (select 1 from sub_accounts) and not exists (select 1 from transactions));

reset role;
reset session authorization;
select pg_temp.ok('someone else''s data was not touched', pg_temp.bal('13500000-0000-0000-0000-000000000099') = 777);
delete from auth.users where id in ('eeeeeeee-0000-0000-0000-000000000013', 'eeeeeeee-0000-0000-0000-000000000099');
select pg_temp.ok('deleting a user still removes everything', not exists (select 1 from sub_accounts where user_id = 'eeeeeeee-0000-0000-0000-000000000099'));
\echo 'ALL 0013 CHECKS PASSED'
