# Database backups

FinBoard backs up its whole database automatically once a week. This page explains what is saved, where
it goes, how to check it worked, and how to get the data back.

## In short

- **What:** the whole database, so every user's data: accounts, balances, transactions, debts,
  certificates, investments, settings, and the sign-in accounts themselves (passwords are stored only as
  scrambled hashes, never in readable form). FinBoard doesn't keep any files in Supabase Storage, so
  nothing is left out.
- **When:** every Sunday at 23:30 UTC, which is early Monday morning in Cairo (01:30 in winter, 02:30 in
  summer). You can also start one any time.
- **Where:** as an encrypted file on the repository's Actions page on GitHub. Each file is kept for 90
  days, so there are always about 13 weekly backups to choose from.
- **Locked with:** your backup passphrase (AES-256 encryption). Without the passphrase the files are
  useless to everyone, you included.
- **Cost:** nothing (see the end of this page).

This is separate from **Settings > Backup** in the app, which lets each person export their own data as a
file whenever they like.

## Why the files are encrypted

The FinBoard repository on GitHub is **public**. Anyone can see its Actions page, and any signed-in
GitHub user can download the files kept there. So each backup is locked with your passphrase on GitHub's
machine before it is uploaded, and only the locked file is uploaded. The logs show no passwords and no
data.

Keep the passphrase in your password manager. Nobody can recover it for you: GitHub keeps a sealed copy
that it never shows again. If you lose it, set a new one with the setup script. New backups will use the
new passphrase, and the older ones stay locked with the old one.

## Setting it up (once)

1. The file `.github/workflows/backup.yml` has to be on GitHub (pushed to the `main` branch).
2. In PowerShell, in the FinBoard folder, run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\configure-backups.ps1
   ```

   The script installs GitHub's command-line tool if needed, signs you in as **AbdelrahmanEssmat** (your
   personal account, never a work one), asks for the database connection string, creates the passphrase
   and shows it **once** so you can save it, and starts the first backup.

Run the script again whenever you need to change something, for example after resetting the database
password. It asks before replacing anything.

## Checking that it ran

- Open <https://github.com/AbdelrahmanEssmat/FinBoard/actions/workflows/backup.yml>. Each run shows a
  green tick (it worked) or a red cross (it failed).
- If a backup fails, GitHub emails you. (For scheduled jobs the email goes to whoever last changed the
  schedule line in the workflow file, which is you.) The usual cause is a changed database password: run
  the setup script again and paste the new connection string.
- In public repositories GitHub pauses scheduled jobs when the repository has had no new commit for 60
  days (any commit resets that clock). If the page above says the workflow is disabled, click
  **Enable workflow** to switch the weekly backup back on.

## Making a backup right now

On the page above, click **Run workflow**, then the green **Run workflow** button. Or in a terminal:

```
gh workflow run backup.yml --repo AbdelrahmanEssmat/FinBoard
```

## Downloading a backup

1. Open the page above and click the run you want (the newest one is at the top).
2. At the bottom of the run's page, under **Artifacts**, click `finboard-backup-YYYY-MM-DD`. A `.zip`
   file downloads.
3. Unzip it. Inside is `finboard-backup-YYYY-MM-DD.tar.gz.gpg`, the locked backup.

Or in a terminal (this downloads and unzips into the current folder):

```
gh run download --repo AbdelrahmanEssmat/FinBoard --name finboard-backup-2026-10-05
```

## Opening (decrypting) a backup

You need `gpg`, which comes with Git for Windows. Open **Git Bash** in the folder that holds the file and
run (with your file's date):

```bash
gpg --output finboard-backup-2026-10-05.tar.gz --decrypt finboard-backup-2026-10-05.tar.gz.gpg
tar -xzf finboard-backup-2026-10-05.tar.gz
```

The first command opens a small window asking for the passphrase; paste it from your password manager.
The second unpacks a folder with three plain-text files:

| File         | What's in it                                                              |
| ------------ | ------------------------------------------------------------------------- |
| `roles.sql`  | database roles (almost empty for FinBoard)                                |
| `schema.sql` | the structure: tables, rules, functions                                   |
| `data.sql`   | all the rows: every user's data and their sign-in accounts                |

You can open `data.sql` in a text editor to see what's in a backup. **Treat these files like the
passphrase**: they hold everyone's financial data and email addresses. Delete them when you're done
(Shift+Delete skips the Recycle Bin).

## Restoring into a new Supabase project

Do this if the Supabase project is ever lost or badly damaged. It builds a complete copy in a **new**
project; it doesn't merge into an existing one. It follows Supabase's own guide:
<https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore> (its end lists the
errors you might meet and how to get past them).

1. Create a new project at <https://supabase.com/dashboard>, ideally in the same region, and note its
   database password.
2. In the new project, turn on the extensions the old one used (**Database > Extensions**): for FinBoard
   that's `pg_cron` if the hourly server jobs were set up. The others are on by default.
3. Copy the new project's connection string: **Connect** (top bar) > **Session pooler**, with the
   database password filled in.
4. In the unpacked backup folder, run `psql`, PostgreSQL's command-line tool. On this laptop it is
   `dev-local/bin/pg/pgsql/bin/psql.exe` in the FinBoard folder; anywhere else, install the PostgreSQL 17
   client tools. In Git Bash:

   ```bash
   psql --single-transaction --variable ON_ERROR_STOP=1 \
     --file roles.sql --file schema.sql \
     --command 'SET session_replication_role = replica' \
     --file data.sql \
     --dbname 'postgresql://postgres.NEWPROJECT:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres'
   ```

   It restores everything in one go. If any part fails, nothing is changed, and the message says what
   went wrong.
5. Re-create the one piece a backup leaves out: the rule that gives each new sign-up its starter
   categories and accounts. It lives in Supabase's own sign-in area, which backups skip. In the new
   project's **SQL Editor**, run:

   ```sql
   create trigger on_auth_user_created after insert on auth.users
   for each row execute function public.handle_new_user();
   ```

6. Point the app at the new project: put the new project's URL and publishable key in Vercel's
   environment variables `SUPABASE_URL` and `SUPABASE_ANON_KEY` (or in the `PRODUCTION` values in
   `src/api/supabase.ts`), and replace the old project address in the Content-Security-Policy in
   `vercel.json`. Then change `$ProjectRef` in `scripts/configure-supabase-auth.ps1` to the new project
   and run that script to set up sign-in and the emails again. Push to deploy.
7. Everyone signs in again with their usual password: the accounts and password hashes come back with
   the data, only the old sign-in sessions don't.

Finally, run the backup setup script again with the new project's connection string, so the weekly
backups follow the new project.

## What it costs

Nothing. GitHub doesn't charge for Actions minutes or artifact storage in public repositories, and a
backup run takes a few minutes once a week. On the Supabase side it is a read of a few megabytes a week,
far inside the free plan's limits.

## How it works (for the curious)

Every week, GitHub starts a fresh Linux machine and runs `.github/workflows/backup.yml`:

1. It checks that the two repository secrets exist: `SUPABASE_DB_URL` (the Session pooler connection
   string) and `BACKUP_PASSPHRASE`. GitHub stores them encrypted (**Settings > Secrets and variables >
   Actions**) and blanks them out of the logs.
2. Supabase's command-line tool dumps the roles, the structure and the data (Supabase's documented
   backup commands).
3. The three files are packed into `finboard-backup-DATE.tar.gz` and encrypted with `gpg` (AES-256)
   using the passphrase. The plain files are deleted.
4. The encrypted file is decrypted once as a test, so a backup that can't be opened never counts as a
   success.
5. Only the encrypted `.gpg` file is uploaded, kept for 90 days.
