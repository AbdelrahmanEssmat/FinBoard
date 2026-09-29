-- Regression tests for migration 0012 (row locks, certificate schedule trigger, installment fees).
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

insert into auth.users (id, email) values ('dddddddd-0000-0000-0000-000000000012', 'd12@test');
select set_config('request.jwt.claims', '{"sub":"dddddddd-0000-0000-0000-000000000012","role":"authenticated"}', false);
create temp table ids as
  select (select s.id from sub_accounts s join accounts a on a.id = s.account_id where a.user_id = 'dddddddd-0000-0000-0000-000000000012' and a.name = 'Cash' and s.currency = 'EGP') as cash,
         (select id from accounts where user_id = 'dddddddd-0000-0000-0000-000000000012' and name = 'Cash') as cash_account;

-- the functions lock their rows
select pg_temp.ok('logging a payout locks the payout row', pg_get_functiondef('public.log_certificate_payout(uuid, uuid, uuid)'::regprocedure) ilike '%for update%');
select pg_temp.ok('recording a repayment locks the debt row', pg_get_functiondef('public.record_debt_payment(uuid, numeric, date, uuid, text, uuid, uuid)'::regprocedure) ilike '%for update%');
select pg_temp.ok('the nightly job logs payouts in a fixed order', pg_get_functiondef('public.process_certificate_payouts(uuid)'::regprocedure) ilike '%order by p.due_date%');

-- 1. one income per payout
insert into certificates (id, user_id, account_id, name, principal, currency, interest_rate, payout_frequency, start_date, maturity_date, payout_sub_account_id, auto_log_income)
values ('c1200000-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000012', (select cash_account from ids), 'CIB 3y', 120000, 'EGP', 20, 'monthly',
        current_date - 75, current_date + 1000, (select cash from ids), true);
create temp table first_payout as select id, amount from certificate_payouts where certificate_id = 'c1200000-0000-0000-0000-000000000001' order by due_date limit 1;
select pg_temp.ok('logging the same payout twice returns the same transaction',
  public.log_certificate_payout((select id from first_payout)) = public.log_certificate_payout((select id from first_payout)));
select pg_temp.ok('and books exactly one income', (select count(*) from transactions where source = 'certificate' and source_id = (select id from first_payout)) = 1);
select pg_temp.ok('for the payout amount', (select balance from sub_accounts where id = (select cash from ids)) = (select amount from first_payout));
select pg_temp.fails('a second income for the same payout is refused',
  format($q$insert into transactions (user_id, type, date, amount, currency, sub_account_id, source, source_id)
            values ('dddddddd-0000-0000-0000-000000000012', 'income', current_date, 1, 'EGP', '%s', 'certificate', '%s')$q$, (select cash from ids), (select id from first_payout)),
  '%unique%');

-- 3. the schedule survives a harmless edit, and is rebuilt when the terms change
create temp table pending_before as select array_agg(id order by due_date) as ids, sum(amount) as total from certificate_payouts where certificate_id = 'c1200000-0000-0000-0000-000000000001' and status = 'pending';
update certificates set notes = 'moved to the new branch', principal = principal, interest_rate = interest_rate where id = 'c1200000-0000-0000-0000-000000000001';
select pg_temp.ok('a notes-only save keeps every pending payout (same ids)',
  (select array_agg(id order by due_date) from certificate_payouts where certificate_id = 'c1200000-0000-0000-0000-000000000001' and status = 'pending') = (select ids from pending_before));
update certificates set principal = 240000 where id = 'c1200000-0000-0000-0000-000000000001';
select pg_temp.ok('doubling the principal rebuilds the pending payouts',
  (select array_agg(id order by due_date) from certificate_payouts where certificate_id = 'c1200000-0000-0000-0000-000000000001' and status = 'pending') <> (select ids from pending_before));
select pg_temp.ok('with doubled amounts',
  (select sum(amount) from certificate_payouts where certificate_id = 'c1200000-0000-0000-0000-000000000001' and status = 'pending') = 2 * (select total from pending_before));
select pg_temp.ok('and leaves the logged payout alone',
  (select status = 'logged' and amount = (select amount from first_payout) from certificate_payouts where id = (select id from first_payout)));

-- 2. repayments still cannot exceed what is left
insert into contacts (id, user_id, name) values ('c1200000-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000012', 'Omar');
insert into debts (id, user_id, contact_id, direction, amount, currency, date)
values ('c1200000-0000-0000-0000-000000000003', 'dddddddd-0000-0000-0000-000000000012', 'c1200000-0000-0000-0000-000000000002', 'owed_to_me', 2000, 'EGP', current_date - 10);
select public.record_debt_payment('c1200000-0000-0000-0000-000000000003', 1500, current_date, (select cash from ids));
select pg_temp.fails('a repayment above what is left is refused',
  format($q$select public.record_debt_payment('c1200000-0000-0000-0000-000000000003', 600, current_date, '%s')$q$, (select cash from ids)), '%more than%');
select pg_temp.ok('the debt shows 1,500 paid', (select coalesce(sum(amount), 0) from debt_payments where debt_id = 'c1200000-0000-0000-0000-000000000003') = 1500);

-- 4. deleting a plan's fee expense zeroes the fee
insert into accounts (id, user_id, name, type, credit_limit, statement_day, due_day)
values ('c1200000-0000-0000-0000-000000000004', 'dddddddd-0000-0000-0000-000000000012', 'Visa', 'credit_card', 50000, 25, 15);
insert into sub_accounts (id, user_id, account_id, currency) values ('c1200000-0000-0000-0000-000000000005', 'dddddddd-0000-0000-0000-000000000012', 'c1200000-0000-0000-0000-000000000004', 'EGP');
insert into transactions (id, user_id, type, date, amount, currency, sub_account_id, payee)
values ('c1200000-0000-0000-0000-000000000006', 'dddddddd-0000-0000-0000-000000000012', 'expense', current_date, 24000, 'EGP', 'c1200000-0000-0000-0000-000000000005', 'TV');
insert into transactions (id, user_id, type, date, amount, currency, sub_account_id, payee)
values ('c1200000-0000-0000-0000-000000000007', 'dddddddd-0000-0000-0000-000000000012', 'expense', current_date, 1200, 'EGP', 'c1200000-0000-0000-0000-000000000005', 'TV · fees');
insert into card_installment_plans (id, user_id, account_id, sub_account_id, transaction_id, fees_transaction_id, description, currency, principal, fees, months, purchase_date, first_billing_date)
values ('c1200000-0000-0000-0000-000000000008', 'dddddddd-0000-0000-0000-000000000012', 'c1200000-0000-0000-0000-000000000004', 'c1200000-0000-0000-0000-000000000005',
        'c1200000-0000-0000-0000-000000000006', 'c1200000-0000-0000-0000-000000000007', 'TV', 'EGP', 24000, 1200, 12, current_date, current_date + 5);
delete from transactions where id = 'c1200000-0000-0000-0000-000000000007';
select pg_temp.ok('deleting the fee expense clears the link and the fee',
  (select fees_transaction_id is null and fees = 0 from card_installment_plans where id = 'c1200000-0000-0000-0000-000000000008'));
select pg_temp.ok('the plan itself and its purchase stay', exists (select 1 from card_installment_plans p join transactions t on t.id = p.transaction_id where p.id = 'c1200000-0000-0000-0000-000000000008'));

select set_config('request.jwt.claims', '', false);
\echo 'ALL 0012 CHECKS PASSED'
