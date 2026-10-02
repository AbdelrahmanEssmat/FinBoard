-- Regression tests for migration 0011 (security hardening) and the overall security posture.
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

-- the whole schema
select pg_temp.ok('every table has row level security',
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity));
select pg_temp.ok('every table has at least one policy',
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'
    and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)));
select pg_temp.ok('policies only apply to signed-in users',
  not exists (select 1 from pg_policies where schemaname = 'public' and not (roles <@ array['authenticated']::name[])));
-- (restrictive policies, like the second sign-in step from 0015, can only narrow access further)
select pg_temp.ok('every policy that grants access is scoped to the signed-in user',
  not exists (select 1 from pg_policies where schemaname = 'public' and permissive = 'PERMISSIVE' and coalesce(qual, '') || coalesce(with_check, '') not like '%auth.uid()%'));
select pg_temp.ok('every table requires the second sign-in step when it is on',
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
    and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname and p.permissive = 'RESTRICTIVE' and p.qual like '%mfa_satisfied%')));
select pg_temp.ok('every security definer function pins its search_path',
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')));
select pg_temp.ok('signed-out visitors can''t read or write any table',
  not exists (select 1 from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'));
select pg_temp.ok('signed-out visitors can''t run any function',
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')));
select pg_temp.ok('signed-in users can''t truncate (it would skip row level security)',
  not exists (select 1 from information_schema.role_table_grants where grantee = 'authenticated' and table_schema = 'public' and privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES')));
select pg_temp.ok('maintenance jobs are not callable from the app',
  not has_function_privilege('authenticated', 'public.run_daily_jobs()', 'execute') and not has_function_privilege('authenticated', 'public.snapshot_all_users()', 'execute'));
select pg_temp.ok('the app''s functions still work for signed-in users',
  has_function_privilege('authenticated', 'public.snapshot_net_worth(uuid, date)', 'execute')
  and has_function_privilege('authenticated', 'public.record_debt_payment(uuid, numeric, date, uuid, text, uuid, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.convert_amount(uuid, numeric, text, text, date)', 'execute'));

-- as the roles the API really uses
insert into auth.users (id, email) values ('abababab-0000-0000-0000-000000000110', 'sec@test');
set role anon;
select pg_temp.fails('anon: select is refused', 'select count(*) from public.accounts', '%permission denied%');
select pg_temp.fails('anon: insert is refused', $q$insert into public.tags (user_id, name) values ('abababab-0000-0000-0000-000000000110', 'x')$q$, '%permission denied%');
select pg_temp.fails('anon: functions are refused', $q$select public.snapshot_net_worth('abababab-0000-0000-0000-000000000110', current_date)$q$, '%permission denied%');
reset role;
set role authenticated;
select pg_temp.fails('signed-in: truncate is refused', 'truncate public.transactions', '%permission denied%');
reset role;
-- connect the way the API does (as authenticator, switched to authenticated, with someone else's token)
set session authorization authenticator;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"abababab-0000-0000-0000-000000000999","role":"authenticated"}', false);
do $$
begin
  perform public.snapshot_net_worth('abababab-0000-0000-0000-000000000110', current_date);
  raise exception 'FAIL (no error): signed-in: another user''s snapshot is refused';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  if sqlerrm not ilike '%not allowed%' then raise exception 'FAIL (wrong error "%"): another user''s snapshot', sqlerrm; end if;
  raise notice 'PASS: signed-in: another user''s snapshot is refused  [%]', sqlerrm;
end $$;
select pg_temp.ok('signed-in: another user''s rows are invisible', (select count(*) = 0 from public.accounts where user_id = 'abababab-0000-0000-0000-000000000110'));
reset role;
reset session authorization;
select set_config('request.jwt.claims', '', false);

-- objects created by later migrations inherit the rules
create table public.zz_later (id int);
create function public.zz_later_fn() returns int language sql as 'select 1';
select pg_temp.ok('a later table is closed to signed-out visitors', not has_table_privilege('anon', 'public.zz_later', 'select'));
select pg_temp.ok('a later table can''t be truncated by signed-in users', not has_table_privilege('authenticated', 'public.zz_later', 'truncate'));
select pg_temp.ok('a later function still works for signed-in users', has_function_privilege('authenticated', 'public.zz_later_fn()', 'execute'));
drop table public.zz_later;
drop function public.zz_later_fn();
\echo 'ALL 0011 CHECKS PASSED'
