# Applies FinBoard's sign-in settings and email templates to the Supabase project in one go.
#
#   powershell -ExecutionPolicy Bypass -File scripts\configure-supabase-auth.ps1
#
# You need a Supabase personal access token: https://supabase.com/dashboard/account/tokens
# ("Generate new token"). It is only kept in memory while the script runs. Delete the token on
# that page when you're done.
#
# What it sets:
#   - Site URL + allowed redirect URLs = the live app, so email links open FinBoard (not localhost)
#   - email + password sign-in, sign-ups open, email confirmation ON (when an email service is set)
#   - password rules: 8+ characters with lowercase, uppercase and a number (same as the app)
#   - secure password / email change, one-hour one-time links, refresh-token rotation
#   - the 8 FinBoard email templates + subjects (supabase/templates, built by build.mjs), and the
#     "your password / email was changed" security notifications
#   - optionally your email service (SMTP): without one, Supabase only emails the project's own team,
#     so friends would never get their confirmation or reset emails
#
# -DryRun writes the settings (without any secret) to scripts\auth-config.preview.json instead.
param([switch]$DryRun)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$ProjectRef = 'qddbhmiqsolhnzduvswt'
$SiteUrl = 'https://finboard-alpha-beryl.vercel.app'
$root = Split-Path -Parent $PSScriptRoot
$templates = Join-Path $root 'supabase\templates'
$api = "https://api.supabase.com/v1/projects/$ProjectRef/config/auth"

function Plain([Security.SecureString]$s) {
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}
function Ask([string]$q, [string]$default) {
  $a = Read-Host "$q$(if ($default) { " [$default]" })"
  if ([string]::IsNullOrWhiteSpace($a)) { return $default } else { return $a.Trim() }
}
function YesNo([string]$q, [bool]$default) {
  $d = if ($default) { 'Y/n' } else { 'y/N' }
  $a = Read-Host "$q ($d)"
  if ([string]::IsNullOrWhiteSpace($a)) { return $default }
  return $a.Trim().ToLower().StartsWith('y')
}

# ---------------------------------------------------------------- settings
$subjects = Get-Content (Join-Path $templates 'subjects.json') -Raw -Encoding UTF8 | ConvertFrom-Json
function Tpl([string]$name) { [IO.File]::ReadAllText((Join-Path $templates "$name.html"), [Text.Encoding]::UTF8) }

$body = [ordered]@{
  site_url                                        = $SiteUrl
  uri_allow_list                                  = "$SiteUrl/**"
  external_email_enabled                          = $true
  disable_signup                                  = $false
  external_anonymous_users_enabled                = $false
  mailer_secure_email_change_enabled              = $true
  mailer_otp_exp                                  = 3600
  password_min_length                             = 8
  password_required_characters                    = 'abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789'
  security_update_password_require_reauthentication = $true
  refresh_token_rotation_enabled                  = $true
  security_refresh_token_reuse_interval           = 10
  mailer_notifications_password_changed_enabled   = $true
  mailer_notifications_email_changed_enabled      = $true
}
foreach ($t in 'confirmation', 'recovery', 'magic_link', 'email_change', 'invite', 'reauthentication') {
  $body["mailer_subjects_$t"] = $subjects.$t
  $body["mailer_templates_${t}_content"] = Tpl $t
}
foreach ($t in 'password_changed', 'email_changed') {
  $body["mailer_subjects_${t}_notification"] = $subjects."${t}_notification"
  $body["mailer_templates_${t}_notification_content"] = Tpl "${t}_notification"
}

if ($DryRun) {
  $body['mailer_autoconfirm'] = $false
  $out = Join-Path $PSScriptRoot 'auth-config.preview.json'
  [IO.File]::WriteAllText($out, ($body | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding $false))
  Write-Host "Dry run: settings written to $out ($($body.Count) fields). Nothing was sent."
  exit 0
}

# ---------------------------------------------------------------- token + current state
Write-Host ''
Write-Host 'FinBoard - Supabase sign-in setup' -ForegroundColor Cyan
Write-Host 'Create a personal access token at https://supabase.com/dashboard/account/tokens and paste it below.'
$token = Plain (Read-Host 'Access token (hidden)' -AsSecureString)
if (-not $token) { throw 'No token given.' }
$headers = @{ Authorization = "Bearer $token" }
try {
  $current = Invoke-RestMethod -Method Get -Uri $api -Headers $headers
} catch {
  throw "Couldn't read the project's settings (is the token right, and does it belong to the account that owns the project?): $($_.Exception.Message)"
}
$hasSmtp = -not [string]::IsNullOrWhiteSpace($current.smtp_host)
Write-Host ''
if ($hasSmtp) { Write-Host "Email service: $($current.smtp_host) (sender $($current.smtp_admin_email))" -ForegroundColor Green }
else { Write-Host 'Email service: none. Supabase will only email your own team, so friends get no confirmation or reset emails.' -ForegroundColor Yellow }

# ---------------------------------------------------------------- email service (SMTP)
$setSmtp = YesNo $(if ($hasSmtp) { 'Change the email service settings?' } else { 'Set up an email service now? (recommended)' }) (-not $hasSmtp)
if ($setSmtp) {
  Write-Host ''
  Write-Host '  1) Gmail            free, ~500 emails/day. Needs 2-Step Verification + an App password:'
  Write-Host '                      https://myaccount.google.com/apppasswords'
  Write-Host '  2) Brevo            free, 300 emails/day, no domain needed (verify your sender email in Brevo)'
  Write-Host '  3) Resend           free, 3000/month, best delivery, needs your own domain verified in Resend'
  Write-Host '  4) Other SMTP'
  $choice = Ask 'Choose 1-4' '1'
  switch ($choice) {
    '1' { $smtpHost = 'smtp.gmail.com'; $port = '465'; $user = Ask 'Your Gmail address' ''; $sender = $user }
    '2' { $smtpHost = 'smtp-relay.brevo.com'; $port = '587'; $user = Ask 'Brevo SMTP login (looks like 1234ab@smtp-brevo.com)' ''; $sender = Ask 'Sender email (verified in Brevo)' '' }
    '3' { $smtpHost = 'smtp.resend.com'; $port = '465'; $user = 'resend'; $sender = Ask 'Sender email on your verified domain (e.g. no-reply@yourdomain.com)' '' }
    default { $smtpHost = Ask 'SMTP host' ''; $port = Ask 'SMTP port' '587'; $user = Ask 'SMTP username' ''; $sender = Ask 'Sender email' '' }
  }
  $pass = Plain (Read-Host $(if ($choice -eq '1') { 'Gmail App password (16 letters, hidden)' } elseif ($choice -eq '3') { 'Resend API key (hidden)' } else { 'SMTP password / key (hidden)' }) -AsSecureString)
  if (-not $smtpHost -or -not $user -or -not $sender -or -not $pass) { throw 'Missing email service details; nothing was changed.' }
  $body['smtp_host'] = $smtpHost
  $body['smtp_port'] = $port
  $body['smtp_user'] = $user
  $body['smtp_pass'] = ($pass -replace '\s', '')
  $body['smtp_admin_email'] = $sender
  $body['smtp_sender_name'] = 'FinBoard'
  $body['rate_limit_email_sent'] = 100
  $hasSmtp = $true
}

# confirmation emails need an email service; without one, sign-ups would be stuck
if ($hasSmtp) {
  $body['mailer_autoconfirm'] = $false
} else {
  Write-Host ''
  $off = YesNo 'Without an email service friends can''t confirm their email. Let new accounts in without confirming for now?' $true
  $body['mailer_autoconfirm'] = [bool]$off
}

# ---------------------------------------------------------------- apply + verify
$json = $body | ConvertTo-Json -Depth 4 -Compress
try {
  Invoke-RestMethod -Method Patch -Uri $api -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($json)) | Out-Null
} catch {
  $detail = ''
  try { $detail = (New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd() } catch {}
  throw "Supabase refused the settings: $($_.Exception.Message) $detail"
}
$after = Invoke-RestMethod -Method Get -Uri $api -Headers $headers
$token = $null; $headers = $null; $pass = $null; $body = $null

function Show([string]$label, [bool]$ok, [string]$value) {
  $mark = if ($ok) { '[ok]  ' } else { '[!!]  ' }
  $color = if ($ok) { 'Green' } else { 'Yellow' }
  Write-Host "$mark$label$(if ($value) { ": $value" })" -ForegroundColor $color
}
Write-Host ''
Show 'Site URL' ($after.site_url -eq $SiteUrl) $after.site_url
Show 'Redirect URLs' ($after.uri_allow_list -like "*$SiteUrl*") $after.uri_allow_list
Show 'Email confirmation' (-not $after.mailer_autoconfirm) $(if ($after.mailer_autoconfirm) { 'OFF (turn on once an email service is set)' } else { 'ON' })
Show 'Email service' (-not [string]::IsNullOrWhiteSpace($after.smtp_host)) $(if ($after.smtp_host) { "$($after.smtp_host) as $($after.smtp_admin_email)" } else { 'none' })
Show 'Password rules' ($after.password_min_length -ge 8) "$($after.password_min_length)+ characters, upper/lower/number"
Show 'FinBoard email templates' ($after.mailer_templates_confirmation_content -like '*auth/confirm*') ''
Show 'Security notifications' ([bool]$after.mailer_notifications_password_changed_enabled) 'password / email changed'
Write-Host ''
Write-Host 'Done. Now delete the access token at https://supabase.com/dashboard/account/tokens' -ForegroundColor Cyan
