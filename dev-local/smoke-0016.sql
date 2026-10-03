-- Regression tests for migration 0016. Run on a fresh database with all migrations applied, as postgres.
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
  ('16161616-0000-0000-0000-000000000001', 'a16@test'),
  ('16161616-0000-0000-0000-000000000002', 'b16@test');
insert into accounts (id, user_id, name, type) values
  ('16a00000-0000-0000-0000-000000000001', '16161616-0000-0000-0000-000000000001', 'Bank', 'bank'),
  ('16a00000-0000-0000-0000-000000000002', '16161616-0000-0000-0000-000000000001', 'Cash', 'cash');
insert into sub_accounts (id, user_id, account_id, currency, opening_balance) values
  ('16500000-0000-0000-0000-000000000001', '16161616-0000-0000-0000-000000000001', '16a00000-0000-0000-0000-000000000001', 'EGP', 50000),
  ('16500000-0000-0000-0000-000000000002', '16161616-0000-0000-0000-000000000001', '16a00000-0000-0000-0000-000000000002', 'EGP', 1000),
  ('16500000-0000-0000-0000-000000000003', '16161616-0000-0000-0000-000000000001', '16a00000-0000-0000-0000-000000000001', 'USD', 100);

-- the way the app calls it: the API role with the person's token
set session authorization authenticator;
set role authenticated;
select pg_temp.as_user('16161616-0000-0000-0000-000000000001');

\echo '--- 1. a debt saved without its money movement, linked afterwards'
select create_debt('16d00000-0000-0000-0000-000000000001', '16c00000-0000-0000-0000-000000000001', 'Ahmed', 'owed_to_me',
                   10000, 'EGP', current_date - 10);
select pg_temp.ok('saved without moving money: no balance changed',
  pg_temp.bal('16500000-0000-0000-0000-000000000001') = 50000 and pg_temp.bal('16500000-0000-0000-0000-000000000002') = 1000
  and (select transaction_id is null and sub_account_id is null from debts where id = '16d00000-0000-0000-0000-000000000001'));
select pg_temp.ok('linking returns the new money movement',
  set_debt_account('16d00000-0000-0000-0000-000000000001', '16500000-0000-0000-0000-000000000001', '16700000-0000-0000-0000-000000000001')
  = '16700000-0000-0000-0000-000000000001');
select pg_temp.ok('the lent money left the bank', pg_temp.bal('16500000-0000-0000-0000-000000000001') = 40000);
select pg_temp.ok('as a debt movement dated with the debt (not income or spending)',
  exists (select 1 from transactions where id = '16700000-0000-0000-0000-000000000001' and type = 'expense' and source = 'debt'
          and source_id = '16d00000-0000-0000-0000-000000000001' and amount = 10000 and date = current_date - 10
          and payee = 'Ahmed' and notes = 'Lent to Ahmed'));
select pg_temp.ok('and the debt points at it',
  (select transaction_id = '16700000-0000-0000-0000-000000000001' and sub_account_id = '16500000-0000-0000-0000-000000000001'
     from debts where id = '16d00000-0000-0000-0000-000000000001'));
select set_debt_account('16d00000-0000-0000-0000-000000000001', '16500000-0000-0000-0000-000000000001', '16700000-0000-0000-0000-000000000009');
select pg_temp.ok('sending it again (a retry) changes nothing',
  pg_temp.bal('16500000-0000-0000-0000-000000000001') = 40000
  and (select count(*) from transactions where source = 'debt' and source_id = '16d00000-0000-0000-0000-000000000001') = 1);

\echo '--- 2. moving it to another balance, and refusing another currency'
select set_debt_account('16d00000-0000-0000-0000-000000000001', '16500000-0000-0000-0000-000000000002');
select pg_temp.ok('moved: the bank is whole again and the cash paid',
  pg_temp.bal('16500000-0000-0000-0000-000000000001') = 50000 and pg_temp.bal('16500000-0000-0000-0000-000000000002') = -9000
  and (select sub_account_id from transactions where id = '16700000-0000-0000-0000-000000000001') = '16500000-0000-0000-0000-000000000002'
  and (select sub_account_id from debts where id = '16d00000-0000-0000-0000-000000000001') = '16500000-0000-0000-0000-000000000002');
select pg_temp.fails('a balance in another currency is refused',
  $q$select set_debt_account('16d00000-0000-0000-0000-000000000001', '16500000-0000-0000-0000-000000000003')$q$, '%holds USD%');

\echo '--- 3. repayments and edits keep working on a linked debt'
select record_debt_payment('16d00000-0000-0000-0000-000000000001', 4000, current_date, '16500000-0000-0000-0000-000000000001');
select pg_temp.ok('a repayment into the bank', pg_temp.bal('16500000-0000-0000-0000-000000000001') = 54000);
update debts set amount = 12000 where id = '16d00000-0000-0000-0000-000000000001';
select pg_temp.ok('raising the debt moves 2,000 more out of the cash', pg_temp.bal('16500000-0000-0000-0000-000000000002') = -11000);

\echo '--- 4. taking the money movement off again'
select pg_temp.ok('unlinking returns nothing', set_debt_account('16d00000-0000-0000-0000-000000000001', null) is null);
select pg_temp.ok('the cash goes back; the repayment stays in the bank',
  pg_temp.bal('16500000-0000-0000-0000-000000000002') = 1000 and pg_temp.bal('16500000-0000-0000-0000-000000000001') = 54000
  and not exists (select 1 from transactions where id = '16700000-0000-0000-0000-000000000001')
  and (select count(*) from debt_payments where debt_id = '16d00000-0000-0000-0000-000000000001') = 1);
select pg_temp.ok('the debt points at nothing and is still open with 8,000 left',
  (select transaction_id is null and sub_account_id is null and status = 'open' from debts where id = '16d00000-0000-0000-0000-000000000001'));
select set_debt_account('16d00000-0000-0000-0000-000000000001', null);
select pg_temp.ok('unlinking twice is harmless', pg_temp.bal('16500000-0000-0000-0000-000000000002') = 1000);

\echo '--- 5. borrowing: the money comes in'
select create_debt('16d00000-0000-0000-0000-000000000002', '16c00000-0000-0000-0000-000000000002', 'Karim', 'i_owe', 5000, 'EGP', current_date);
select set_debt_account('16d00000-0000-0000-0000-000000000002', '16500000-0000-0000-0000-000000000001');
select pg_temp.ok('borrowed money came into the bank as a debt movement',
  pg_temp.bal('16500000-0000-0000-0000-000000000001') = 59000
  and exists (select 1 from transactions where source_id = '16d00000-0000-0000-0000-000000000002' and type = 'income' and source = 'debt' and notes = 'Borrowed from Karim'));

\echo '--- 6. deleting the money movement from the activity list unlinks it fully'
delete from transactions where id = (select transaction_id from debts where id = '16d00000-0000-0000-0000-000000000002');
select pg_temp.ok('the debt stays, with no transaction and no balance named',
  (select transaction_id is null and sub_account_id is null from debts where id = '16d00000-0000-0000-0000-000000000002')
  and pg_temp.bal('16500000-0000-0000-0000-000000000001') = 54000);

\echo '--- 7. only your own debts'
select pg_temp.as_user('16161616-0000-0000-0000-000000000002');
select pg_temp.fails('someone else can''t link your debt',
  $q$select set_debt_account('16d00000-0000-0000-0000-000000000001', '16500000-0000-0000-0000-000000000001')$q$, '%no longer exists%');
select pg_temp.fails('nor unlink it', $q$select set_debt_account('16d00000-0000-0000-0000-000000000002', null)$q$, '%no longer exists%');
select set_config('request.jwt.claims', '', false);
select pg_temp.fails('and without signing in, nothing', $q$select set_debt_account('16d00000-0000-0000-0000-000000000001', null)$q$, '%not allowed%');
reset role;
reset session authorization;

select pg_temp.ok('every balance still adds up', not exists (select 1 from sub_accounts s where s.balance <> balance_as_of(s.id, '9999-12-31')));
select pg_temp.ok('a debt names a balance only when its money moved there',
  not exists (select 1 from debts d left join transactions t on t.id = d.transaction_id
              where d.user_id = '16161616-0000-0000-0000-000000000001' and d.sub_account_id is distinct from t.sub_account_id));
\echo 'ALL 0016 CHECKS PASSED'
