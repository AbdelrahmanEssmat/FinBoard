-- SQL smoke test for triggers, RLS helpers and net worth. Run as postgres on the local DB.
\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'test@local.test') on conflict do nothing;

-- impersonate the user like PostgREST would
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;

select 'settings rows' as check, count(*) from settings;
select 'currencies' as check, count(*) from currencies;
select 'categories' as check, count(*) from categories;
select 'accounts' as check, count(*) from accounts;

-- rates
insert into exchange_rates (user_id, quote, rate, rate_date, source) values (auth.uid(), 'EGP', 50, current_date, 'manual');

-- balance trigger
with s as (select id from sub_accounts where currency = 'EGP' limit 1)
insert into transactions (type, date, amount, currency, sub_account_id) select 'income', current_date, 1000, 'EGP', id from s;
with s as (select id from sub_accounts where currency = 'EGP' limit 1)
insert into transactions (type, date, amount, currency, sub_account_id) select 'expense', current_date, 250, 'EGP', id from s;
select 'balance after income/expense (expect 750)' as check, balance from sub_accounts where currency = 'EGP' order by created_at limit 1;

-- transfer with conversion EGP -> USD
insert into transactions (type, date, amount, currency, sub_account_id, to_sub_account_id, to_amount, to_currency, rate_used)
select 'transfer', current_date, 500, 'EGP', e.id, u.id, 10, 'USD', 50
from (select id from sub_accounts where currency = 'EGP' order by created_at limit 1) e,
     (select id from sub_accounts where currency = 'USD' limit 1) u;
select 'EGP after transfer (expect 250)' as check, balance from sub_accounts where currency = 'EGP' order by created_at limit 1;
select 'USD after transfer (expect 10)' as check, balance from sub_accounts where currency = 'USD' limit 1;

-- update amount adjusts balance
update transactions set amount = 300 where type = 'expense';
select 'EGP after update (expect 200)' as check, balance from sub_accounts where currency = 'EGP' order by created_at limit 1;
-- delete adjusts balance
delete from transactions where type = 'expense';
select 'EGP after delete (expect 500)' as check, balance from sub_accounts where currency = 'EGP' order by created_at limit 1;

-- opening balance change
update sub_accounts set opening_balance = 100 where currency = 'EGP' and account_id = (select id from accounts where name = 'Cash');
select 'EGP after opening +100 (expect 600)' as check, balance from sub_accounts where currency = 'EGP' order by created_at limit 1;

-- certificate schedule
insert into accounts (name, type) values ('Test Bank', 'bank');
insert into sub_accounts (account_id, currency) select id, 'EGP' from accounts where name = 'Test Bank';
insert into certificates (account_id, name, principal, currency, interest_rate, payout_frequency, start_date, maturity_date, auto_log_income, payout_sub_account_id)
select a.id, 'CD 27%', 100000, 'EGP', 27, 'monthly', current_date - 100, current_date + 265, true, s.id
from accounts a join sub_accounts s on s.account_id = a.id where a.name = 'Test Bank';
select 'payout rows (expect 12)' as check, count(*) from certificate_payouts;
select 'payout amount (expect 2250)' as check, amount from certificate_payouts limit 1;
select 'due payouts (expect 3)' as check, count(*) from certificate_payouts where due_date <= current_date;
select 'auto-logged (expect 3)' as check, process_certificate_payouts();
select 'bank balance (expect 6750)' as check, balance from sub_accounts where account_id = (select id from accounts where name = 'Test Bank');
select 'logged status' as check, count(*) from certificate_payouts where status = 'logged';
-- deleting a logged transaction resets the payout
delete from transactions where source = 'certificate' and id = (select transaction_id from certificate_payouts where status = 'logged' limit 1);
select 'logged after delete (expect 2)' as check, count(*) from certificate_payouts where status = 'logged';
select 'bank balance (expect 4500)' as check, balance from sub_accounts where account_id = (select id from accounts where name = 'Test Bank');

-- debts
insert into contacts (name) values ('Ahmed');
insert into debts (contact_id, direction, amount, currency, date) select id, 'owed_to_me', 3000, 'EGP', current_date from contacts;
select record_debt_payment((select id from debts), 1000, current_date, (select id from sub_accounts where currency = 'EGP' order by created_at limit 1), 'first');
select 'EGP after repayment (expect 1600)' as check, balance from sub_accounts where currency = 'EGP' order by created_at limit 1;
select 'debt status (expect open)' as check, status from debts;
select record_debt_payment((select id from debts), 2000, current_date, null, 'rest');
select 'debt status (expect settled)' as check, status from debts;
delete from debt_payments where notes = 'rest';
select 'debt reopened (expect open)' as check, status from debts;
delete from debt_payments where notes = 'first';
select 'linked tx removed (expect 0)' as check, count(*) from transactions where source = 'debt';
select 'EGP after payment delete (expect 600)' as check, balance from sub_accounts where currency = 'EGP' order by created_at limit 1;

-- recurring
insert into recurring_transactions (name, type, amount, currency, sub_account_id, frequency, next_date)
select 'Rent', 'expense', 100, 'EGP', id, 'monthly', current_date - interval '2 months' from sub_accounts where currency = 'EGP' order by created_at limit 1;
select 'posted recurring (expect 3)' as check, post_due_recurring();
select 'posted again (expect 0)' as check, post_due_recurring();
select 'next_date in future' as check, next_date > current_date from recurring_transactions;
select 'EGP after rent (expect 300)' as check, balance from sub_accounts where currency = 'EGP' order by created_at limit 1;

-- gold + net worth
insert into gold_prices (user_id, karat, price_per_gram, source) values (auth.uid(), 21, 6000, 'manual');
insert into gold_items (karat, weight_grams, type, purchase_price) values (21, 10, 'bar', 50000);
insert into holdings (account_id, name, units, avg_cost, current_price, currency) select id, 'COMI', 10, 80, 100, 'EGP' from accounts where name = 'Thndr';
select 'net worth' as check, snapshot_net_worth();
-- expected: accounts 300 + 10 USD*50=500 + bank 4500 = 5300; cert 100000; inv 1000; gold 60000; recv 3000 → 169300
select 'snapshot total (expect 169300)' as check, total from net_worth_snapshots;
select 'convert 100 USD→EGP (expect 5000)' as check, convert_amount(auth.uid(), 100, 'USD', 'EGP', current_date);

-- RLS: another user sees nothing
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select 'other user accounts (expect 0)' as check, count(*) from accounts;
select 'other user rates sees global only (expect 0 manual)' as check, count(*) from exchange_rates;
rollback;
