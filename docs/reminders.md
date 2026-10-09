# Reminders on your phone and computer

FinBoard can remind you, with a normal phone or desktop notification, when something is coming up:

- a **credit card payment** is due
- a **debt installment** is due (money you owe, or money owed to you)
- a **bill** (a recurring payment) is due
- a **certificate** pays out, or matures
- a **monthly debt** is about to move money out of your account (the day before)

And a few general ones, kept rare on purpose:

- **End of day** ("Anything to add for today?"), in the evening, only on days you recorded nothing
- **Last month's summary is ready**, on the 1st (opens Reports on last month)
- **Your stock prices are out of date**, at most once a week, when a price is more than a week old
- **A budget is almost used** (90%) or **used up**, once each per budget per month

## When they arrive

- Once a day, **around 8 to 9 am Cairo time** (the server's daily run starts in that hour).
- The end-of-day check-in comes in a second run, **around 8 to 9 pm Cairo time** (9 to 10 pm in summer).
- If the server missed a day, the next morning's run sends what was missed (one day back).
- At most **4 notifications a day**. When more are due, the 4th one says "And 3 more due today"
  (or however many) and opens FinBoard.
- Tapping a notification opens FinBoard on the page it is about.
- Every device that turned reminders on gets them: your iPhone and the desktop app.
- "Today" is the date in the time zone in your FinBoard settings (Cairo unless you changed it).

**Amounts are never shown.** A notification says what is due and when ("CIB card payment due
tomorrow"), never how much, so nothing private appears on the lock screen. What is sent is
also encrypted on the way, so the phone companies' push services in between can't read it.

## iPhone: what you need

- **iOS 16.4 or later** (Settings -> General -> About -> iOS Version).
- **FinBoard on your Home Screen.** In Safari open FinBoard, tap Share -> **Add to Home Screen**,
  and from then on open FinBoard from that icon. Notifications don't work in a Safari tab.
- In FinBoard: **Settings -> Reminders**, turn them on, and tap **Allow** when the iPhone asks.
  - If you tapped "Don't Allow": iPhone Settings -> Notifications -> FinBoard -> turn on
    Allow Notifications, then turn reminders off and on again in FinBoard.
- Focus modes and the Scheduled Summary can hold notifications back; allow FinBoard there if
  reminders arrive late or bunched together.

## Desktop app (Windows)

- In FinBoard: **Settings -> Reminders**, turn them on and allow notifications when asked.
- Windows Settings -> System -> Notifications must allow notifications from your browser
  (Chrome or Edge, which runs the installed app).
- The app doesn't need to be open, but the browser has to be running for notifications to show up.
  If it was closed, the reminder arrives when it next starts (the push service keeps it 12 hours).

## One-time setup (the owner, on the Windows laptop)

The server needs a few settings before it can send anything. One script does all of it:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\configure-push.ps1
```

It walks you through it:

1. **Vercel sign-in.** The first time, a browser window opens; sign in with the account that owns
   FinBoard.
2. **Linking the folder** to the Vercel project (only the first time): pick the project that serves
   finboard-alpha-beryl.vercel.app, and answer No if it offers to pull environment variables.
3. **Your Supabase secret key.** Usually nothing to do: the Supabase connection on Vercel already
   added it, and the script uses that one. Only when there is none (or with `-ReplaceSupabaseKey`)
   does it ask: in the Supabase dashboard, Project Settings -> **API Keys** -> Secret keys, copy the
   key that starts with `sb_secret_` (or, on the Legacy API keys tab, the `service_role` key). You
   paste it hidden; the script checks it works before saving.

It then makes the reminder keys and a password for the daily run, saves them in Vercel
(Production, as values nobody can read back), redeploys the live app (the same version that is
live now) and checks it: the app hands out the reminder key and the daily run can read the
database. Nothing secret is written to your computer or shown on screen.

You can run it again any time; it keeps what is already set unless you say otherwise. Replacing
the **reminder keys** means every device has to turn reminders on again. To see what is set up
without changing anything, add `-CheckOnly`.

The reminders tables come with database migration **0015**; it has to be applied to the live
database too (the script warns you if it isn't yet).

## How to test

- On each device: FinBoard -> **Settings -> Reminders -> Send a test**. Within a few seconds a
  notification "FinBoard reminders are on" should appear; tapping it opens Settings.
- To run the daily send right now instead of waiting for the morning (the owner, on the laptop):
  `npx vercel@latest crons run /api/reminders`. Running it extra times is harmless: a reminder is
  never sent twice.
- To see what a daily run did: Vercel dashboard -> the project -> Settings -> **Cron Jobs** ->
  View Logs. Each run reports how many people were checked, reminders sent, notifications
  delivered, devices removed, and any problems.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| "Reminders aren't set up on the server yet" | Run the setup script above and wait for its redeploy to finish. |
| The test says it was sent, but nothing shows on the iPhone | Open FinBoard from the Home Screen icon (not Safari). Check iPhone Settings -> Notifications -> FinBoard, and Focus. Then turn reminders off and on again in FinBoard. |
| The test reached no device | Turn reminders off and on again on that device (its registration may have expired). |
| Tests work, but no morning reminders | Open FinBoard once: the app works out the upcoming reminders and keeps the list up to date when it is open. Then check the Cron Jobs logs (above). |
| Nothing works after re-running the script and replacing the reminder keys | Turn reminders off and on again on every device. |
| New phone, or FinBoard removed and added to the Home Screen again | Turn reminders on again on that device. Old devices are forgotten automatically. |
| Reminders come on the wrong day | Check the time zone in FinBoard's settings. |

## How it works (for whoever maintains FinBoard)

- The app computes the reminders (no amounts in the text) and keeps each person's upcoming rows in
  `public.reminders`; each device that turns reminders on is a row in `public.push_subscriptions`
  (migration 0015).
- **Vercel Cron** calls `GET /api/reminders` daily at 06:00 UTC (`vercel.json` -> `crons`; on the
  Hobby plan Vercel may start it any time within that hour). Vercel sends
  `Authorization: Bearer <CRON_SECRET>`; anything else gets 401.
- For each person with at least one device: their unsent reminders dated yesterday or today (in
  their time zone), oldest first, at most 4 notifications, each sent to every device. A reminder
  is marked sent once at least one device accepted it; a device whose push service answers
  404/410 is deleted. Each push lives 12 hours (TTL), urgency normal.
- `GET /api/push-key` gives the VAPID public key the app subscribes with (501 until set up).
  `POST /api/push-test` (Bearer: the person's access token, optional `{ endpoint }`) sends the
  sample notification and returns `{ sent }`.
- Code: `api/push-key.ts`, `api/push-test.ts`, `api/reminders.ts` (thin wrappers),
  `src/server/push.ts` (all the logic, tested in `src/server/push.test.ts`), `public/push-sw.js`
  (shows the notification and opens the app; loaded into the service worker via workbox
  `importScripts` in `vite.config.ts`).
- In development (`npm run dev` / `npm run dev:local`) the same functions answer `/api/*` and read
  the `.env` files of that mode; put VAPID keys in a git-ignored `.env.local` to try them locally.

Server settings (Vercel -> Production environment variables):

| Name | What it is |
| --- | --- |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | The reminder key pair (`npx web-push generate-vapid-keys`). |
| `VAPID_SUBJECT` | Contact for the push services; defaults to `mailto:finboard.webapp@gmail.com`. |
| `CRON_SECRET` | Random password Vercel sends with the daily run. |
| `SUPABASE_SECRET_KEY` | Supabase secret (service-role) key; the server reads everyone's devices and reminders with it. |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Optional; default to the live project and its publishable key. |
