-- Regression tests for migration 0007 (Concert income category). Run on a fresh database with all
-- migrations applied, as postgres. Every check prints PASS or aborts with FAIL.
\set ON_ERROR_STOP on

create function pg_temp.ok(label text, cond boolean) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;

-- a user created after 0007 gets Concert from the starter set
insert into auth.users (id, email) values ('dddddddd-0000-0000-0000-000000000007', 'd7@test');
select pg_temp.ok('a new user gets exactly one Concert income category',
  (select count(*) from categories where user_id = 'dddddddd-0000-0000-0000-000000000007' and kind = 'income' and name = 'Concert') = 1);
select pg_temp.ok('with the music icon',
  (select icon from categories where user_id = 'dddddddd-0000-0000-0000-000000000007' and name = 'Concert') = 'music');
select pg_temp.ok('the rest of the starter set is still created (7 income, 15 expense, 2 accounts)',
  (select count(*) filter (where kind = 'income') = 7 and count(*) filter (where kind = 'expense') = 15 from categories where user_id = 'dddddddd-0000-0000-0000-000000000007')
  and (select count(*) from accounts where user_id = 'dddddddd-0000-0000-0000-000000000007') = 2);

-- a user who existed before 0007 (no Concert yet) gets one when the migration runs, once
insert into auth.users (id, email) values ('dddddddd-0000-0000-0000-000000000008', 'd8@test');
delete from categories where user_id = 'dddddddd-0000-0000-0000-000000000008' and name = 'Concert';
insert into public.categories (user_id, kind, name, icon, color, sort_order)
select u.id, 'income', 'Concert', 'music', '#f97316', 1 from auth.users u
where not exists (select 1 from public.categories c where c.user_id = u.id and c.kind = 'income' and lower(c.name) = 'concert');
insert into public.categories (user_id, kind, name, icon, color, sort_order)
select u.id, 'income', 'Concert', 'music', '#f97316', 1 from auth.users u
where not exists (select 1 from public.categories c where c.user_id = u.id and c.kind = 'income' and lower(c.name) = 'concert');
select pg_temp.ok('an existing user gets Concert once, even when the migration runs twice',
  (select count(*) from categories where user_id = 'dddddddd-0000-0000-0000-000000000008' and kind = 'income' and lower(name) = 'concert') = 1);
select pg_temp.ok('no user anywhere has two Concert categories',
  not exists (select 1 from categories where kind = 'income' and lower(name) = 'concert' group by user_id having count(*) > 1));
\echo 'ALL 0007 CHECKS PASSED'
