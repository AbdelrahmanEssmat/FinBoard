-- Regression tests for migration 0009 (credit card installment plans). Run on a fresh database with
-- all migrations applied, as postgres. Every check prints PASS or aborts with FAIL.
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

insert into auth.users (id, email) values ('ffffffff-0000-0000-0000-000000000009', 'f9@test');
insert into auth.users (id, email) values ('ffffffff-0000-0000-0000-000000000010', 'other@test');
insert into accounts (id, user_id, name, type, credit_limit, statement_day, due_day)
values ('99100000-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000009', 'Visa', 'credit_card', 50000, 25, 15);
insert into sub_accounts (id, user_id, account_id, currency) values ('99100000-0000-0000-0000-000000000002', 'ffffffff-0000-0000-0000-000000000009', '99100000-0000-0000-0000-000000000001', 'EGP');

-- buy a phone for 24,000 over 12 months with 1,200 of fees
insert into transactions (id, user_id, type, date, amount, currency, sub_account_id, payee)
values ('99100000-0000-0000-0000-000000000010', 'ffffffff-0000-0000-0000-000000000009', 'expense', '2026-09-10', 24000, 'EGP', '99100000-0000-0000-0000-000000000002', 'iPhone');
insert into transactions (id, user_id, type, date, amount, currency, sub_account_id, payee)
values ('99100000-0000-0000-0000-000000000011', 'ffffffff-0000-0000-0000-000000000009', 'expense', '2026-09-10', 1200, 'EGP', '99100000-0000-0000-0000-000000000002', 'iPhone · installment fees');
insert into card_installment_plans (id, user_id, account_id, sub_account_id, transaction_id, fees_transaction_id, description, currency, principal, fees, months, purchase_date, first_billing_date)
values ('99100000-0000-0000-0000-000000000020', 'ffffffff-0000-0000-0000-000000000009', '99100000-0000-0000-0000-000000000001', '99100000-0000-0000-0000-000000000002',
        '99100000-0000-0000-0000-000000000010', '99100000-0000-0000-0000-000000000011', 'iPhone', 'EGP', 24000, 1200, 12, '2026-09-10', '2026-09-25');
select pg_temp.ok('a plan is saved on the card', exists (select 1 from card_installment_plans where id = '99100000-0000-0000-0000-000000000020'));
select pg_temp.ok('the card owes the full 25,200 (the bank blocks it all)',
  (select balance from sub_accounts where id = '99100000-0000-0000-0000-000000000002') = -25200);

select pg_temp.fails('a plan on a bank account is rejected',
  $q$insert into card_installment_plans (user_id, account_id, sub_account_id, description, currency, principal, months, purchase_date, first_billing_date)
     select 'ffffffff-0000-0000-0000-000000000009', a.id, s.id, 'x', 'EGP', 100, 3, '2026-09-10', '2026-09-25'
     from sub_accounts s join accounts a on a.id = s.account_id where a.user_id = 'ffffffff-0000-0000-0000-000000000009' and a.name = 'Cash' and s.currency = 'EGP'$q$, '%credit cards only%');
select pg_temp.fails('a plan in another currency is rejected',
  $q$insert into card_installment_plans (user_id, account_id, sub_account_id, description, currency, principal, months, purchase_date, first_billing_date)
     values ('ffffffff-0000-0000-0000-000000000009', '99100000-0000-0000-0000-000000000001', '99100000-0000-0000-0000-000000000002', 'x', 'USD', 100, 3, '2026-09-10', '2026-09-25')$q$, '%currency%');
select pg_temp.fails('a plan on someone else''s card is rejected',
  $q$insert into card_installment_plans (user_id, account_id, sub_account_id, description, currency, principal, months, purchase_date, first_billing_date)
     values ('ffffffff-0000-0000-0000-000000000010', '99100000-0000-0000-0000-000000000001', '99100000-0000-0000-0000-000000000002', 'x', 'EGP', 100, 3, '2026-09-10', '2026-09-25')$q$, '%not found%');
select pg_temp.fails('one month is not a plan',
  $q$update card_installment_plans set months = 1 where id = '99100000-0000-0000-0000-000000000020'$q$, '%check%');
select pg_temp.fails('billing cannot start before the purchase',
  $q$update card_installment_plans set first_billing_date = '2026-09-01' where id = '99100000-0000-0000-0000-000000000020'$q$, '%check%');

-- row level security: the other user can't see the plan
select set_config('request.jwt.claims', '{"sub":"ffffffff-0000-0000-0000-000000000010","role":"authenticated"}', false);
set role authenticated;
select pg_temp.ok('another user cannot see the plan', not exists (select 1 from card_installment_plans));
reset role;
select set_config('request.jwt.claims', '', false);

-- deleting the fees expense keeps the plan; deleting the purchase removes it
delete from transactions where id = '99100000-0000-0000-0000-000000000011';
select pg_temp.ok('deleting the fees expense keeps the plan (link cleared)',
  (select fees_transaction_id is null from card_installment_plans where id = '99100000-0000-0000-0000-000000000020'));
delete from transactions where id = '99100000-0000-0000-0000-000000000010';
select pg_temp.ok('deleting the purchase removes its plan', not exists (select 1 from card_installment_plans where id = '99100000-0000-0000-0000-000000000020'));
select pg_temp.ok('and the card owes nothing again', (select balance from sub_accounts where id = '99100000-0000-0000-0000-000000000002') = 0);
\echo 'ALL 0009 CHECKS PASSED'
