# FinBoard – Architecture

Personal finance tracker: one PWA used on Windows (Chrome/Edge) and iPhone (Safari), sharing
one Supabase project in real time.

## Stack

| Layer | Choice | Why |
|---|---|---|
| UI | React 19 + TypeScript + Vite 8 | Fast, typed, small |
| Styling | Tailwind CSS v4 | Design tokens in CSS, dark mode via `prefers-color-scheme` |
| PWA | vite-plugin-pwa (Workbox) | App-shell precache, network-first cache of Supabase reads |
| Routing | react-router v7 | Bottom tabs (mobile) / sidebar (desktop) share routes |
| Server state | TanStack Query + IndexedDB persister | Cached queries survive reloads and work offline |
| Offline writes | Dexie outbox | Mutations queue while offline, replay in order when online |
| UI state | zustand | Privacy blur, display currency, last-used defaults |
| Money maths | decimal.js | No floating point. Postgres `numeric`, wire format string |
| Backend | Supabase: Postgres, Auth, RLS, Realtime, Edge Functions, pg_cron | Single user, email login |
| Charts | Recharts | Donut + line charts |
| Tests | Vitest | Pure domain calculations |

## Folder structure

Layers, top to bottom. A layer may import from the layers below it, never above.

```
src/
  app/                 Composition root: App (providers), router, AuthGate, providers/AuthProvider
  layout/              The responsive frame: AppShell, Sidebar, TopBar, TabBar, OfflineBanner,
                       QuickAddSheet, CurrencyToggle, nav.ts (single source of nav items)
  features/<area>/     One folder per screen area. Pages live at the top level of the folder
                       (XxxPage.tsx, default export, lazily routed); feature-only components in
                       components/; feature hooks as useXxx.ts.
                         accounts, transactions, debts, certificates, investments, gold, budgets,
                         reports, dashboard, categories, settings, search, auth, more
  components/shared/   Composite blocks used by several features, may read app state:
                       Amount (privacy-aware money), PageHeader, BackButton, Section/SectionTitle,
                       ListRow, EmptyState, StatCard
  components/ui/       Dumb primitives, one per file: Button, Input, Select, Textarea, Field/FormStack,
                       AmountInput, Segmented, Toggle, Sheet, ConfirmDialog, Card/Divider, Pill,
                       ProgressBar, Skeleton, ColorPicker, IconPicker, Toaster
  hooks/               App-wide React hooks: useMoney (display currency, rates, conversion,
                       formatting), useGoldPrices, useNetWorth, useConnectivity, useRealtimeSync,
                       useDailyJobs
  api/                 Everything that talks to Supabase: supabase client, database.types,
                       queries (TanStack Query hooks per table), mutations (optimistic + outbox),
                       queryClient, ratesProvider (client-side rate fetch), backup (export/import)
  offline/             Dexie outbox, mutate() (execute-or-queue, flush), IndexedDB persister
  store/               zustand stores: prefs (theme, privacy, last-used), toasts (incl. undo)
  domain/              PURE calculations, no React, unit tested:
                         money, format, currency, certificates, installments, recurring,
                         gold, networth, insights (report analytics)
  utils/               cn, collections, dates (local-date safe), files (download/CSV), icons, ids
  styles/index.css     Tailwind v4 theme tokens (light + dark), base styles, motion
supabase/
  migrations/          0001_init.sql (schema + RLS + triggers + functions), 0002_cron.sql
  functions/           fetch-rates, fetch-gold (Deno edge functions)
dev-local/             Optional Windows stand-in for Supabase (Postgres + PostgREST + fake auth)
```

Conventions: absolute imports via `@/…`; pages are the only default exports; money is `Decimal`
everywhere except at the Supabase boundary (strings out, numbers in); no feature imports another
feature's components except through its public hooks (e.g. `useDebtViews`).

## Data model (Postgres, every user table has `user_id` + RLS `user_id = auth.uid()`)

- **currencies** (code, symbol, name, decimals, is_active) – editable list, EGP/USD seeded.
- **settings** (user_id PK, base_currency, defaults jsonb) – base display currency + last-used form defaults.
- **exchange_rates** (base='USD', quote, rate, rate_date, source api|manual). Global rows (user_id NULL) come from the edge function; manual overrides are per-user and win for their date. Historical net worth uses the latest rate on or before each date.
- **accounts** (name, type bank|cash|investment|wallet|other, color, icon, notes, is_archived).
- **sub_accounts** (account_id, currency, name, opening_balance, balance) – one per currency inside a bank. `balance` is maintained by a trigger on transactions, so it is always right server-side and cheap to read.
- **transactions** (type income|expense|transfer, date, amount, currency, sub_account_id, category_id, tags text[], notes, to_sub_account_id, to_amount, to_currency, rate_used, source manual|recurring|certificate|debt, source_id).
- **categories** (parent_id, kind income|expense, name, icon, color) – two levels.
- **tags** (name, color).
- **recurring_transactions** (template fields, frequency daily|weekly|monthly|yearly, interval, next_date, end_date, is_active). Posted by the client when due, deduplicated by (recurring_id, date).
- **budgets** (category_id, amount, currency, period_start_day).
- **certificates** (account_id, name, principal, currency, interest_rate, payout_frequency, start_date, maturity_date, auto_log_income, payout_sub_account_id, notes, is_closed).
- **certificate_payouts** (certificate_id, due_date, amount, status pending|logged|skipped, transaction_id) – logged payouts link to the income transaction.
- **investment_categories** (name) – stocks, mutual funds, gold funds, other, editable.
- **holdings** (account_id, category_id, name, ticker, units, avg_cost, current_price, currency, price_updated_at).
- **gold_items** (karat 24|21|18, weight_grams, type bar|coin|jewelry, purchase_price, purchase_currency, workmanship_cost, purchase_date, notes).
- **gold_prices** (price_at, karat, price_per_gram EGP, source local|global|manual, source_name). Global rows from the edge function; manual per-user rows win.
- **contacts** (name, notes).
- **debts** (contact_id, direction i_owe|owed_to_me, amount, currency, date, due_date, reason, notes, plan_count, plan_amount, plan_frequency, plan_start_date, status open|settled).
- **debt_payments** (debt_id, amount, date, sub_account_id, transaction_id, notes) – each creates a linked transaction so the account balance updates automatically.
- **net_worth_snapshots** (snapshot_date, base_currency, total, by_class jsonb, by_currency jsonb) – daily via pg_cron, plus "on app open" upsert.

## Key behaviours

- **Balances**: trigger on `transactions` (insert/update/delete) adjusts `sub_accounts.balance`. Client applies the same delta optimistically so offline edits look right immediately.
- **Net worth** = Σ sub_account balances + Σ certificate principal + accrued interest + Σ holdings units×price + Σ gold grams×karat price + Σ owed_to_me remaining − Σ i_owe remaining, all converted to the display currency using the rate table.
- **Realtime**: one Supabase channel subscribed to `postgres_changes` for the user; any change invalidates the relevant TanStack queries, so both devices stay in sync.
- **Offline**: app shell precached; Supabase GET responses cached network-first; mutations go through `lib/offline/mutate()` which enqueues to the Dexie outbox on network failure and replays (in order, idempotent upserts by client-generated UUID) when `online` fires.
- **Undo**: deletions are deferred 6 seconds with an undo toast, then executed.
- **Rates**: `fetch-rates` edge function (daily 06:00 Cairo) pulls open.er-api.com (USD base, 160+ currencies, no key) into `exchange_rates`.
- **Gold**: `fetch-gold` edge function (every 30 min) scrapes Egyptian local prices (banklive.net JSON-LD first, gold-price-today.com/egypt JSON-LD second), and falls back to global spot (dahabpulse.com/api/widget-prices, XAU × USD/EGP) labelled "Global spot". A manual price wins for 24 hours after it is set (same rule in the app and in `gold_price_per_gram`).
- **Snapshots**: `snapshot_net_worth()` SQL function computes today's net worth per user; pg_cron runs it nightly; the client also calls it on app open.
