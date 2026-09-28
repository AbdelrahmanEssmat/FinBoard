# Local stand-in for Supabase (optional, Windows)

Lets you run the whole app on your laptop **without** a Supabase project or Docker:

- Portable PostgreSQL 17 (EDB binaries) on port 54329
- PostgREST (the same REST layer Supabase uses) on port 3001
- `server.mjs` on port 54321: an auth server that behaves like Supabase Auth for everything
  FinBoard uses, plus a proxy to PostgREST
  - real accounts (kept in `auth-users.json`), the production password rules, email confirmation,
    one-time links that expire after an hour, password reset, sign out here / others / everywhere
  - `test@local.test` always signs in with any password (tests and quick local use rely on that)
  - emails aren't sent: they're rendered from `supabase/templates` (exactly what Supabase sends)
    and listed at **http://127.0.0.1:54321/__mail**; open one and click its button to follow the link

Realtime is not available locally; everything else (RLS, triggers, RPCs) is the real Postgres code.

## One-time setup

1. Download and unzip into `dev-local/bin`:
   - PostgreSQL Windows x86-64 **binaries** zip from https://www.enterprisedb.com/download-postgresql-binaries → `dev-local/bin/pg/pgsql/...`
   - PostgREST Windows release zip from https://github.com/PostgREST/postgrest/releases → `dev-local/bin/postgrest/postgrest.exe`
2. Nothing else: `.env.localstack` already points the app at this stack when you run `npm run dev:local`.

## Every day

```powershell
powershell -File dev-local\start.ps1     # starts Postgres, PostgREST and the auth server; creates the DB on first run
npm run dev:local                        # sign in with test@local.test and any password, or create an account
powershell -File dev-local\stop.ps1      # stop everything
powershell -File dev-local\reset-db.ps1  # wipe and re-create the DB from supabase/migrations
```

Email links point at `http://localhost:5174` (set `LOCAL_SITE_URL` before starting `server.mjs` to change it).

## Tests

```powershell
powershell -File dev-local\test-migrations.ps1                         # every migration + all smoke-*.sql (incl. the security checks in smoke-0011.sql)
npx vitest run --config dev-local/vitest.integration.config.ts        # backup/restore against the local stack
```

Binaries, data, accounts and logs in this folder are git-ignored.
