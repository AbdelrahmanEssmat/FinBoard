# Local stand-in for Supabase (optional, Windows)

Lets you run the whole app on your laptop **without** a Supabase project or Docker:

- Portable PostgreSQL 17 (EDB binaries) on port 54329
- PostgREST (the same REST layer Supabase uses) on port 3001
- `server.mjs`: a tiny fake auth server + proxy on port 54321 that speaks enough of the Supabase
  API for `@supabase/supabase-js` (sign-in always succeeds as `test@local.test`)

Realtime is not available locally; everything else (RLS, triggers, RPCs) is the real Postgres code.

## One-time setup

1. Download and unzip into `dev-local/bin`:
   - PostgreSQL Windows x86-64 **binaries** zip from https://www.enterprisedb.com/download-postgresql-binaries → `dev-local/bin/pg/pgsql/...`
   - PostgREST Windows release zip from https://github.com/PostgREST/postgrest/releases → `dev-local/bin/postgrest/postgrest.exe`
2. Nothing else: `.env.localstack` already points the app at this stack when you run `npm run dev:local`.

## Every day

```powershell
powershell -File dev-local\start.ps1     # starts Postgres, PostgREST and the proxy; creates the DB on first run
npm run dev:local                        # http://localhost:5173 — sign in with test@local.test and any password
powershell -File dev-local\stop.ps1      # stop everything
powershell -File dev-local\reset-db.ps1  # wipe and re-create the DB from supabase/migrations
```

`smoke.sql` is a SQL-level test of the triggers, RPCs and RLS. Run it with:

```powershell
dev-local\bin\pg\pgsql\bin\psql.exe -h 127.0.0.1 -p 54329 -U postgres -d finance -f dev-local\smoke.sql
```

Binaries, data and logs in this folder are git-ignored.
