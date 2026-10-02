-- Minimal Supabase-compatible shim for a plain local Postgres (dev only).
-- Provides the roles, the auth schema and auth.uid() that the migrations expect.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login password 'authenticator' noinherit;
  end if;
end $$;
grant anon, authenticated, service_role to authenticator;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text unique,
  encrypted_password text,
  created_at timestamptz default now()
);

-- same as Supabase's own definitions: an empty setting means nobody is signed in
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
-- all claims of the caller's token (Supabase: auth.jwt())
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

-- second sign-in steps (Supabase Auth keeps these; dev-local/server.mjs mirrors its own here)
create table if not exists auth.mfa_factors (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  friendly_name text,
  factor_type text not null default 'totp',
  status text not null default 'unverified',
  secret text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to service_role;

