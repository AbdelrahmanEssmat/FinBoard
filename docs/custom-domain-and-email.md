# Your own web address and a proper email service

Today FinBoard lives at `finboard-alpha-beryl.vercel.app` and its emails (confirm your email, reset
your password, change your email) are sent from the Gmail address `finboard.webapp@gmail.com`.
That works, but Gmail-sent app emails often land in spam, and the web address is hard to share.

Moving to your own domain (for example `finboard.app` or `myfinboard.com`) fixes both. It costs
about US$10–15 a year for the domain; the email service below is free for FinBoard's volume.

Nothing in your data changes. Plan 30–45 minutes; most of it is waiting for DNS.

## 1. Buy a domain

Any registrar works. Cloudflare Registrar and Namecheap sell at cost and make DNS easy. Pick a
`.com` or `.app` name you like.

## 2. Point the domain at FinBoard (Vercel)

1. Vercel → the FinBoard project → **Settings → Domains → Add**, type your domain.
2. Vercel shows one or two DNS records (an `A` record and/or a `CNAME`). Add exactly those at your
   registrar's DNS page.
3. Wait until Vercel shows **Valid configuration** (minutes to a few hours). HTTPS is automatic.

## 3. Set up the email service (Resend)

1. Create a free account at <https://resend.com>.
2. **Domains → Add domain**: use a subdomain such as `mail.yourdomain.com`.
3. Resend lists DNS records (SPF, DKIM, and optionally DMARC). Add them at your registrar, then click
   **Verify** in Resend.
4. **API Keys → Create API key** with "Sending access". Copy it (it starts with `re_`).

## 4. Tell Supabase about the new address and email service

In this project's folder on your computer run (with a Supabase access token ready, the script
explains where to get one):

```bash
powershell -ExecutionPolicy Bypass -File scripts\configure-supabase-auth.ps1 -SiteUrl https://yourdomain.com
```

- When it asks about the email service, choose **3 (Resend)**, enter a sender such as
  `no-reply@mail.yourdomain.com`, and paste the API key as the password.
- The script points sign-in links and email buttons at the new address and keeps the old address
  working too. Delete the access token afterwards, as the script reminds you.

## 5. Move your devices to the new address

These live in the browser and are tied to the web address, so each device sets them up again once:

- **iPhone / desktop app:** open the new address in Safari / Chrome and add it to the Home Screen
  (or install it) again; remove the old icon.
- **Sign in** once on the new address.
- **Reminders:** Settings → Reminders → turn on again on each device.
- **App lock:** Settings → Security → App lock → set up again on each device.

Your accounts, transactions and everything else are on the server and appear as soon as you sign in.

## If something goes wrong

- **Emails don't arrive:** in Resend, check **Logs**. "Domain not verified" means the DNS records
  aren't in place yet. Run the script again after fixing them.
- **"redirect URL not allowed" after clicking an email link:** run the script again with the exact
  `-SiteUrl` you open FinBoard at (with `https://`, no trailing slash).
