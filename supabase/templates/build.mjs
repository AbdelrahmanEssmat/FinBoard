// Builds the FinBoard auth emails (one shared layout) into supabase/templates/*.html + subjects.json.
//   node supabase/templates/build.mjs
// scripts/configure-supabase-auth.ps1 uploads them to Supabase; dev-local/server.mjs renders them locally.
//
// Links point to {{ .SiteURL }}/auth/confirm?token_hash=…&type=… (src/features/auth/ConfirmPage.tsx):
// they work on any device and aren't used up by mail scanners that open links ahead of time.
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
// public address of the app, for the logo and the links in notification emails (those have no {{ .SiteURL }})
const APP = 'https://finboard-alpha-beryl.vercel.app'

const C = {
  bg: '#f4f5f8', card: '#ffffff', text: '#111827', muted: '#667085', faint: '#98a2b3', border: '#e5e8ee',
  accent: '#2f6bff', accentDark: '#1f4fd1', soft: '#e9efff', warnBg: '#fdf1df', warn: '#8a4b00',
}
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

const p = (html, extra = '') => `<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:${C.muted};${extra}">${html}</p>`
const strong = (s) => `<strong style="color:${C.text};font-weight:600;">${s}</strong>`

/** A button that renders in every client (Outlook included). */
function button(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
  <tr><td align="center" bgcolor="${C.accent}" style="border-radius:12px;background:${C.accent};background-image:linear-gradient(180deg,${C.accent},${C.accentDark});">
    <a href="${href}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:16px;font-weight:600;line-height:20px;color:#ffffff;text-decoration:none;border-radius:12px;">${label}</a>
  </td></tr>
</table>`
}

/** "Button not working?" with the raw link. */
const fallback = (href) =>
  `<p style="margin:0 0 20px;font-size:13px;line-height:20px;color:${C.faint};">Button not working? Copy and paste this link into your browser:<br><a href="${href}" style="color:${C.accent};word-break:break-all;text-decoration:underline;">${href}</a></p>`

const note = (html) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 0;"><tr><td style="padding:14px 16px;border-radius:12px;background:${C.bg};font-size:13px;line-height:20px;color:${C.muted};">${html}</td></tr></table>`

const warnNote = (html) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 0;"><tr><td style="padding:14px 16px;border-radius:12px;background:${C.warnBg};font-size:13px;line-height:20px;color:${C.warn};">${html}</td></tr></table>`

function layout({ preheader, heading, body }) {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${heading}</title>
</head>
<body style="margin:0;padding:0;background:${C.bg};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.bg}" style="background:${C.bg};">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;font-family:${FONT};">
      <tr><td align="center" style="padding:0 0 24px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="padding-right:10px;vertical-align:middle;"><img src="${APP}/pwa-192x192.png" width="40" height="40" alt="" style="display:block;border:0;border-radius:10px;"></td>
          <td style="vertical-align:middle;font-size:24px;font-weight:800;letter-spacing:-0.5px;color:${C.text};">Fin<span style="color:${C.accent};">Board</span></td>
        </tr></table>
      </td></tr>
      <tr><td bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.border};border-radius:20px;padding:36px 32px 28px;">
        <h1 style="margin:0 0 16px;font-size:22px;line-height:30px;font-weight:700;color:${C.text};">${heading}</h1>
        ${body}
      </td></tr>
      <tr><td align="center" style="padding:24px 16px 0;font-size:12px;line-height:18px;color:${C.faint};">
        FinBoard · All your money, one board<br>
        You're receiving this because of an action on your FinBoard account.<br>
        <a href="${APP}" style="color:${C.faint};text-decoration:underline;">Open FinBoard</a>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>
`
}

const link = (type) => `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=${type}`

const TEMPLATES = {
  confirmation: {
    subject: 'Confirm your email for FinBoard',
    preheader: 'One tap to activate your FinBoard account.',
    heading: 'Welcome to FinBoard',
    body: () =>
      p(`Thanks for signing up with ${strong('{{ .Email }}')}. Confirm your email address to activate your account and start tracking your money.`) +
      button(link('email'), 'Confirm my email') +
      fallback(link('email')) +
      note(`This link expires in 1 hour and works once. If you didn't create a FinBoard account, ignore this email: nothing will be activated.`),
  },
  recovery: {
    subject: 'Reset your FinBoard password',
    preheader: 'Choose a new password for your FinBoard account.',
    heading: 'Reset your password',
    body: () =>
      p(`Someone (hopefully you) asked to reset the password for ${strong('{{ .Email }}')}. Tap the button to choose a new one.`) +
      button(link('recovery'), 'Choose a new password') +
      fallback(link('recovery')) +
      note(`This link expires in 1 hour and works once. If you didn't ask for this, ignore this email: your password stays the same. Never share this link with anyone.`),
  },
  magic_link: {
    subject: 'Your FinBoard sign-in link',
    preheader: 'Tap to sign in to FinBoard.',
    heading: 'Sign in to FinBoard',
    body: () =>
      p(`Tap the button to sign in as ${strong('{{ .Email }}')}.`) +
      button(link('email'), 'Sign in') +
      fallback(link('email')) +
      note(`This link expires in 1 hour and works once. If you didn't try to sign in, ignore this email.`),
  },
  email_change: {
    subject: 'Confirm your new email for FinBoard',
    preheader: 'Confirm the change of your FinBoard email address.',
    heading: 'Confirm your new email',
    body: () =>
      p(`You asked to change your FinBoard email from ${strong('{{ .Email }}')} to ${strong('{{ .NewEmail }}')}. Confirm to finish the change.`) +
      button(link('email_change'), 'Confirm new email') +
      fallback(link('email_change')) +
      note(`This link expires in 1 hour. If you didn't ask for this, ignore this email and consider changing your password.`),
  },
  invite: {
    subject: "You're invited to FinBoard",
    preheader: 'Accept your invitation and choose a password.',
    heading: "You're invited to FinBoard",
    body: () =>
      p(`You've been invited to track your money with FinBoard, your own private board for accounts, spending, investments and more.`) +
      button(link('invite'), 'Accept invitation') +
      fallback(link('invite')) +
      note(`You'll choose your password next. This invitation link works once.`),
  },
  reauthentication: {
    subject: 'Your FinBoard verification code: {{ .Token }}',
    preheader: 'Your FinBoard verification code is {{ .Token }}.',
    heading: 'Your verification code',
    body: () =>
      p('Enter this code in FinBoard to confirm it’s you:') +
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 24px;"><tr><td style="padding:14px 22px;border-radius:12px;background:${C.soft};font-family:'SF Mono',Menlo,Consolas,monospace;font-size:28px;font-weight:700;letter-spacing:6px;color:${C.text};">{{ .Token }}</td></tr></table>` +
      note(`The code expires soon. If you didn't request it, someone may know your password: change it right away.`),
  },
  password_changed_notification: {
    subject: 'Your FinBoard password was changed',
    preheader: 'The password for your FinBoard account was just changed.',
    heading: 'Your password was changed',
    body: () =>
      p('The password for your FinBoard account was just changed, and your other devices were signed out.') +
      p(`If this was you, there's nothing else to do.`) +
      warnNote(`${strong('Wasn’t you?')} Reset your password now from the sign-in page (“Forgot your password?”): <a href="${APP}/login" style="color:${C.warn};font-weight:600;">${APP.replace('https://', '')}/login</a>`),
  },
  email_changed_notification: {
    subject: 'Your FinBoard email was changed',
    preheader: 'The email address on your FinBoard account was changed.',
    heading: 'Your email address was changed',
    body: () =>
      p(`The email address for your FinBoard account was changed from ${strong('{{ .OldEmail }}')} to ${strong('{{ .Email }}')}.`) +
      warnNote(`${strong('Wasn’t you?')} Someone may have access to your account. Reset your password right away from <a href="${APP}/login" style="color:${C.warn};font-weight:600;">${APP.replace('https://', '')}/login</a>.`),
  },
}

const subjects = {}
for (const [name, t] of Object.entries(TEMPLATES)) {
  writeFileSync(join(HERE, `${name}.html`), layout({ preheader: t.preheader, heading: t.heading, body: t.body() }))
  subjects[name] = t.subject
}
writeFileSync(join(HERE, 'subjects.json'), JSON.stringify(subjects, null, 2) + '\n')
console.log(`built ${Object.keys(TEMPLATES).length} templates`)
