-- =============================================================================
-- 0011: security hardening for several people using FinBoard. Safe to re-run.
--
-- Row level security already limits every signed-in person to their own rows. This adds
-- defence in depth around it:
--  1. Signed-out visitors (the anon role) can't touch any table or function at all: the app
--     always requires signing in.
--  2. Signed-in users keep read/write on their rows but lose TRUNCATE / TRIGGER / REFERENCES,
--     which the app never uses (TRUNCATE ignores row level security).
--  3. Maintenance functions (daily jobs, snapshots of every user, edge-function calls, gold
--     price pruning) can only run from the scheduler / service role, never from the app.
--  4. The same rules apply to tables and functions created by later migrations.
-- =============================================================================

-- 1. signed-out visitors: nothing
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from public, anon;

-- 2. signed-in users: rows only (row level security decides which)
revoke truncate, trigger, references on all tables in schema public from authenticated;
grant execute on all functions in schema public to authenticated, service_role;

-- 3. maintenance functions: scheduler / service role only
revoke execute on function public.snapshot_all_users() from authenticated;
revoke execute on function public.run_daily_jobs() from authenticated;
do $$
begin
  -- these two exist only where 0002_cron.sql was run
  if to_regprocedure('public.call_edge_function(text)') is not null then
    revoke execute on function public.call_edge_function(text) from authenticated;
  end if;
  if to_regprocedure('public.prune_gold_prices()') is not null then
    revoke execute on function public.prune_gold_prices() from authenticated;
  end if;
end $$;

-- 4. later migrations
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from public, anon;
-- (new functions are still executable by PUBLIC through PostgreSQL's global default, so every
-- migration that adds one must end with the revoke/grant pair above; dev-local/smoke-0011.sql fails
-- if a function is left callable by signed-out visitors)
alter default privileges in schema public revoke truncate, trigger, references on tables from authenticated;
