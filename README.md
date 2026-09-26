# FinBoard

A calm, mobile-first personal finance PWA for Egypt: net worth, accounts in several currencies,
bank certificates, Thndr holdings, gold (Egyptian local prices), debts with installments,
income/spending with budgets and reports. Light, mid and dark themes. One Supabase backend, real-time sync between your
iPhone and your Windows laptop, works offline.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the design and data model.

## 1. Prerequisites

- Node.js 20+ (`node --version`)
- A free [Supabase](https://supabase.com) account
- A free [Vercel](https://vercel.com) (or Netlify) account for hosting
- Optional: a GitHub account so Vercel redeploys on every push

## 2. Create the Supabase project

1. supabase.com → **New project**. Pick a name, a strong database password and the region closest to you (Frankfurt `eu-central-1` is a good choice from Egypt).
2. Wait for it to provision, then open **Project Settings → API** and copy:
   - **Project URL** → `SUPABASE_URL`
   - **anon public** key → `SUPABASE_ANON_KEY`
   - **service_role** key → keep secret; used only by the scheduled jobs (never in the app)
3. **Authentication → Providers → Email**: keep Email enabled. If you want to sign in without confirming an email, turn **Confirm email** off (it is only you). Under **Authentication → URL Configuration**, set *Site URL* to your future app URL (e.g. `https://finance-yourname.vercel.app`) and add it to *Redirect URLs* — needed for magic links.
4. **SQL Editor → New query**: paste the whole of [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) and **Run**. This creates all tables, triggers, functions and Row Level Security policies. It also creates your starter categories, currencies and a Cash + Thndr account the first time you sign in. Then run [`supabase/migrations/0003_clouds.sql`](supabase/migrations/0003_clouds.sql) the same way (Clouds / yield-bearing savings).

## 3. Run locally

```bash
npm install
copy .env.example .env      # then fill in the two values from step 2
npm run dev                 # http://localhost:5173
```

Sign in with your email + a new password: the first sign-in creates the account. Check
**Authentication → Users** in Supabase to see it. Everything you add is visible only to that user (RLS).

Useful scripts:

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Type-check + production build into `dist/` (includes the service worker) |
| `npm run preview` | Serve the production build locally (test PWA install here) |
| `npm test` | Unit tests for the financial calculations (Vitest) |
| `npm run typecheck` | TypeScript only |

Without a Supabase project you can still run everything against a local Postgres with `npm run dev:local` — see [`dev-local/README.md`](dev-local/README.md).

## 4. Scheduled jobs: exchange rates, gold prices, daily snapshots

The app already fetches today's exchange rate itself when it opens (from open.er-api.com) and takes
a net-worth snapshot on open, so it works without this section. The scheduled jobs make it
complete: rates arrive even on days you don't open the app, gold prices refresh every 30 minutes,
and recurring transactions / certificate payouts are posted on time.

1. Install the Supabase CLI (`npm i -g supabase` or `winget install Supabase.CLI`) and log in: `supabase login`.
2. Link the project: `supabase link --project-ref YOUR-REF` (the ref is the first part of your project URL).
3. Deploy both functions:
   ```bash
   supabase functions deploy fetch-rates --no-verify-jwt
   supabase functions deploy fetch-gold --no-verify-jwt
   ```
   (`--no-verify-jwt` because they are called by pg_cron with the service-role key, which they check themselves.)
4. Test once from your terminal (replace the placeholders):
   ```bash
   curl -X POST https://YOUR-REF.supabase.co/functions/v1/fetch-gold -H "Authorization: Bearer YOUR-SERVICE-ROLE-KEY"
   ```
   You should get `{"ok":true,"source":"banklive.net", ...}` and rows in `gold_prices`.
5. In the SQL Editor run, with your values:
   ```sql
   select vault.create_secret('https://YOUR-REF.supabase.co', 'project_url');
   select vault.create_secret('YOUR-SERVICE-ROLE-KEY', 'service_role_key');
   ```
   then paste and run [`supabase/migrations/0002_cron.sql`](supabase/migrations/0002_cron.sql). It enables `pg_cron` + `pg_net` and schedules:
   - `fetch-rates` daily at 06:15 Cairo time
   - `fetch-gold` every 30 minutes
   - `run_daily_jobs()` nightly (post due recurring transactions, auto-log certificate payouts, snapshot net worth)

Gold sources, in order: banklive.net (Egyptian market), gold-price-today.com/egypt (Egyptian market), then global spot
(dahabpulse.com × USD/EGP) clearly labelled **Global spot** in the app. You can override any price manually from the Gold screen.

Exchange rates: [ExchangeRate-API open endpoint](https://www.exchangerate-api.com/docs/free) (free, daily; attribution: *Rates by exchangerate-api.com*).

## 5. Deploy to Vercel (free)

**Option A – from GitHub (recommended, auto-deploys on push)**

1. Create an empty GitHub repository and push this folder:
   ```bash
   git remote add origin https://github.com/YOU/financial-tracker.git
   git push -u origin main
   ```
2. vercel.com → **Add New → Project** → import the repo. Framework preset: **Vite** (detected automatically). Build command `npm run build`, output `dist`.
3. **Environment Variables**: add `SUPABASE_URL` and `SUPABASE_ANON_KEY` (Production + Preview).
4. **Deploy**. Your app is at `https://<project>.vercel.app`. Put that URL into Supabase → Authentication → URL Configuration (Site URL + Redirect URLs).

**Option B – from your laptop**

```bash
npm i -g vercel
vercel login
vercel --prod            # answer the prompts; add the two env vars when asked or in the dashboard
```

`vercel.json` in this repo rewrites every path to `index.html` so deep links and the PWA work.

**Netlify instead?** Drag-and-drop the `dist` folder at app.netlify.com/drop after `npm run build`, or connect the repo (build `npm run build`, publish `dist`). Add the same two environment variables. `netlify.toml` is included.

## 6. Install the app

**iPhone (Safari):** open your app URL → tap **Share** (square with arrow) → **Add to Home Screen** → **Add**. It opens full-screen with its own icon, respects the notch, and keeps you signed in.

**Windows (Chrome or Edge):** open the URL → click the **install icon** at the right end of the address bar (or ⋮ menu → **Install FinBoard**). It gets a Start-menu entry and its own window.

Both installs cache the app shell and your recent data. Changes made offline are queued and synced when you're back online; you'll see a small banner while that happens.

## 7. Everyday use

- **+** button (bottom-right on phone, sidebar on desktop): expense, income, transfer, debt payment — 3 taps or fewer. Forms remember your last account and category.
- **Eye icon**: hide/blur every amount. **EGP ⇄** pill: switch the display currency for all totals.
- **Accounts**: one card per bank; each holds balances in several currencies. Tap a balance to edit its opening amount or archive it.
- **Certificates**: payout schedule is generated automatically; due payouts can be logged as income with one tap, or automatically if you tick *Auto-log*.
- **Debts**: record partial payments any time; add an installment plan for due dates and overdue flags; the People tab shows the net balance per person.
- **Gold**: value uses Egyptian per-gram prices by karat with the source and time shown; override manually if needed.
- **Clouds** (Investments): savings balances that earn a yearly rate paid daily or monthly, like Thndr Clouds. Deposit and withdraw with transfers; interest is posted automatically as income and counted in net worth and reports.
- **Settings → Backup**: export everything as JSON (restore later), or transactions as CSV.

## 8. Security notes

- Only the anon key ships with the app. Every table has Row Level Security so a signed-in user can only read/write rows where `user_id = auth.uid()`.
- Global rate/gold rows (user_id NULL) are readable by any signed-in user and writable only by the service role (edge functions).
- Never commit `.env`; it is git-ignored. Rotate the service-role key if it ever leaks.

## 9. Tests

```bash
npm test
```

Covers currency conversion and rate selection, certificate payout amounts/schedules/accrued interest,
installment allocation and overdue logic, recurring occurrences, gold valuation and full net-worth
aggregation. The SQL layer (balance triggers, payout generation, debt settlement, snapshots, RLS) is
exercised by `dev-local/smoke.sql` against a real Postgres.
