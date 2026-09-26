-- =============================================================================
-- Scheduled jobs (Supabase hosted only). Run AFTER 0001_init.sql and AFTER
-- deploying the edge functions. Requires the pg_cron and pg_net extensions
-- (Database → Extensions in the dashboard, or the statements below).
--
-- Before running, store two secrets in Vault (Database → Vault, or SQL):
--   select vault.create_secret('https://YOUR-REF.supabase.co', 'project_url');
--   select vault.create_secret('YOUR-SERVICE-ROLE-KEY', 'service_role_key');
-- =============================================================================

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Helper that calls one of our edge functions with the service-role key.
create or replace function public.call_edge_function(p_name text)
returns bigint language plpgsql security definer set search_path = public, extensions, vault as $$
declare
  v_url text;
  v_key text;
  v_id bigint;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url' limit 1;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  if v_url is null or v_key is null then
    raise exception 'Vault secrets project_url / service_role_key are missing';
  end if;
  select net.http_post(
    url := v_url || '/functions/v1/' || p_name,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) into v_id;
  return v_id;
end $$;
revoke execute on function public.call_edge_function(text) from public, anon, authenticated;

-- Keep gold_prices compact: for rows older than 7 days keep only the first row per karat per day.
create or replace function public.prune_gold_prices()
returns void language sql security definer set search_path = public as $$
  delete from public.gold_prices g
  using (
    select id, row_number() over (partition by karat, user_id, date_trunc('day', price_at) order by price_at) as rn
    from public.gold_prices
    where price_at < now() - interval '7 days'
  ) d
  where g.id = d.id and d.rn > 1;
$$;

-- Schedules (UTC). Cairo is UTC+2/+3.
select cron.unschedule(jobname) from cron.job where jobname in ('fetch-rates-daily', 'fetch-gold-30min', 'daily-jobs');
select cron.schedule('fetch-rates-daily', '15 4 * * *',  $$select public.call_edge_function('fetch-rates')$$);   -- 06:15 Cairo
select cron.schedule('fetch-gold-30min',  '*/30 * * * *', $$select public.call_edge_function('fetch-gold')$$);
select cron.schedule('daily-jobs',        '5 21 * * *',  $$select public.run_daily_jobs()$$);                    -- 23:05 Cairo: post recurring, log payouts, snapshot net worth
