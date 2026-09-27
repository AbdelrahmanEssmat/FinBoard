-- Regression tests for migration 0010 (credit card ↔ issuing bank). Run on a fresh database with all
-- migrations applied, as postgres. Every check prints PASS or aborts with FAIL.
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

insert into auth.users (id, email) values ('abababab-0000-0000-0000-000000000010', 'g10@test'), ('abababab-0000-0000-0000-000000000011', 'h10@test');
insert into accounts (id, user_id, name, type) values
  ('a1000000-0000-0000-0000-000000000001', 'abababab-0000-0000-0000-000000000010', 'NBE', 'bank'),
  ('a1000000-0000-0000-0000-000000000002', 'abababab-0000-0000-0000-000000000010', 'Wallet', 'wallet'),
  ('a1000000-0000-0000-0000-000000000003', 'abababab-0000-0000-0000-000000000011', 'Other''s bank', 'bank');
insert into accounts (id, user_id, name, type, bank_account_id) values
  ('a1000000-0000-0000-0000-000000000010', 'abababab-0000-0000-0000-000000000010', 'NBE Visa', 'credit_card', 'a1000000-0000-0000-0000-000000000001');
select pg_temp.ok('a card is linked to its bank', (select bank_account_id = 'a1000000-0000-0000-0000-000000000001' from accounts where id = 'a1000000-0000-0000-0000-000000000010'));

select pg_temp.fails('a card cannot be linked to a wallet',
  $q$update accounts set bank_account_id = 'a1000000-0000-0000-0000-000000000002' where id = 'a1000000-0000-0000-0000-000000000010'$q$, '%only be linked to a bank%');
select pg_temp.fails('a card cannot be linked to someone else''s bank',
  $q$update accounts set bank_account_id = 'a1000000-0000-0000-0000-000000000003' where id = 'a1000000-0000-0000-0000-000000000010'$q$, '%not found%');
update accounts set bank_account_id = 'a1000000-0000-0000-0000-000000000001' where id = 'a1000000-0000-0000-0000-000000000002';
select pg_temp.ok('a link on anything but a card is dropped', (select bank_account_id is null from accounts where id = 'a1000000-0000-0000-0000-000000000002'));
delete from accounts where id = 'a1000000-0000-0000-0000-000000000001';
select pg_temp.ok('deleting the bank keeps the card and clears the link',
  (select bank_account_id is null from accounts where id = 'a1000000-0000-0000-0000-000000000010'));
\echo 'ALL 0010 CHECKS PASSED'
