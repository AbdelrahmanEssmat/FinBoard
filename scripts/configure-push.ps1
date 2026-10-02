# Turns on FinBoard's phone and desktop reminders (Web Push) on the live server, in one go.
#
#   powershell -ExecutionPolicy Bypass -File scripts\configure-push.ps1
#
# Run it once. It:
#   1. checks that the Vercel command-line tool works (it runs through npx, nothing to install) and
#      that you are signed in to Vercel; the first time, a browser window opens so you can sign in
#   2. links this folder to the FinBoard project on Vercel if it isn't yet (the project that serves
#      https://finboard-alpha-beryl.vercel.app)
#   3. creates the reminder keys (a VAPID key pair): the server signs every notification with them,
#      so your devices know it really comes from FinBoard
#   4. creates CRON_SECRET, a long random password that only Vercel's daily reminder run knows
#   5. uses the Supabase secret key that is already on Vercel (the Supabase connection adds it), so
#      the server can read who gets which reminder; only when there is none does it ask for the key,
#      and it checks the key works before saving it
#   6. saves VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT and CRON_SECRET (and the Supabase key
#      when it asked for one) in the project's Production settings on Vercel, as sensitive values
#      nobody can read back
#   7. redeploys the live app (the same version that is live now) so the new settings take effect
#   8. checks the live app: it hands out the reminder key, and the daily run can read the database
#
# Nothing secret is written to disk or shown on screen. Safe to run again: anything already set is
# kept unless you say to replace it. Replacing the reminder keys means every device has to turn
# reminders on again (Settings -> Reminders).
#
#   -CheckOnly            only show what is set up (on Vercel and on the live app); changes nothing
#   -ReplaceSupabaseKey   ask for the Supabase secret key even though Vercel already has one
#
# Afterwards, on each device: open FinBoard -> Settings -> Reminders, turn them on, Send a test.
# More in docs\reminders.md.
param([switch]$CheckOnly, [switch]$ReplaceSupabaseKey)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$SiteUrl = 'https://finboard-alpha-beryl.vercel.app'
$SupabaseUrl = 'https://qddbhmiqsolhnzduvswt.supabase.co'
$VapidSubject = 'mailto:finboard.webapp@gmail.com'
$root = Split-Path -Parent $PSScriptRoot

function Plain([Security.SecureString]$s) {
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}
function YesNo([string]$q, [bool]$default) {
  $d = if ($default) { 'Y/n' } else { 'y/N' }
  $a = Read-Host "$q ($d)"
  if ([string]::IsNullOrWhiteSpace($a)) { return $default }
  return $a.Trim().ToLower().StartsWith('y')
}
function Step([string]$text) { Write-Host ''; Write-Host $text -ForegroundColor Cyan }
function Ok([string]$text) { Write-Host "[ok]  $text" -ForegroundColor Green }
function Warn([string]$text) { Write-Host "[!!]  $text" -ForegroundColor Yellow }

# Runs a Vercel command that asks nothing and returns what it printed. cmd.exe merges the tool's
# progress messages into its output, so Windows PowerShell doesn't mistake them for errors.
function VercelOutput([string]$arguments) {
  $text = (cmd.exe /d /c "npx.cmd --yes vercel@latest $arguments 2>&1") | Out-String
  return [pscustomobject]@{ Text = $text; Code = $LASTEXITCODE }
}

# True when "vercel env ls" printed a variable with exactly this name.
function Listed([string]$list, [string]$name) {
  return [regex]::IsMatch($list, "(?m)^\s*$([regex]::Escape($name))\s")
}

# Saves one Production variable on Vercel. The value goes in through the tool's standard input (no
# file, not on the command line) and is never printed.
function SaveVariable([string]$name, [string]$value, [bool]$exists) {
  if ($exists) {
    $rm = VercelOutput "env rm $name production --yes"
    if ($rm.Code -ne 0) { throw "Couldn't remove the old $name on Vercel:`n$($rm.Text)" }
  }
  $psi = New-Object Diagnostics.ProcessStartInfo
  $psi.FileName = $env:ComSpec
  $psi.Arguments = "/d /c npx.cmd --yes vercel@latest env add $name production 2>&1"
  $psi.WorkingDirectory = $root
  $psi.UseShellExecute = $false
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  # The tool's input is written in the console's input encoding; when that is UTF-8 with a byte-order
  # mark, the mark would end up in front of the value. Use UTF-8 without one while starting the tool.
  $consoleEncoding = $null
  try { $consoleEncoding = [Console]::InputEncoding; [Console]::InputEncoding = New-Object Text.UTF8Encoding $false } catch {}
  try { $p = [Diagnostics.Process]::Start($psi) } finally { if ($consoleEncoding) { try { [Console]::InputEncoding = $consoleEncoding } catch {} } }
  $stdin = $p.StandardInput.BaseStream
  $bytes = [Text.Encoding]::ASCII.GetBytes($value)
  $stdin.Write($bytes, 0, $bytes.Length)
  $stdin.Close()
  $out = $p.StandardOutput.ReadToEnd()
  $p.WaitForExit()
  if ($p.ExitCode -ne 0) { throw "Vercel didn't save ${name}:`n$($out.Replace($value, '<hidden>'))" }
  Ok "$name saved"
}

# Checks the Supabase secret key by reading the devices table (the gateway refuses wrong keys, and
# the publishable key may not read it).
function CheckSupabaseKey([string]$key) {
  # new sb_secret_ keys go in the apikey header only; a legacy service_role key (a JWT) also as Bearer
  $headers = @{ apikey = $key }
  if ($key.StartsWith('eyJ')) { $headers['Authorization'] = "Bearer $key" }
  try {
    Invoke-WebRequest -UseBasicParsing -Method Get -Uri "$SupabaseUrl/rest/v1/push_subscriptions?select=id&limit=1" `
      -Headers $headers -UserAgent 'FinBoard-setup' -TimeoutSec 30 | Out-Null
    return 'ok'
  } catch {
    $status = 0
    try { $status = [int]$_.Exception.Response.StatusCode } catch {}
    $detail = ''
    try { $detail = (New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd() } catch {}
    if ($status -eq 401 -or $status -eq 403) { return 'wrong' }
    if ($status -eq 404 -or $detail -match 'PGRST205|does not exist') { return 'no-table' }
    return "unknown: $status $($_.Exception.Message)"
  }
}

# The Vercel project this folder is linked to, or $null. Older Vercel tools write .vercel\project.json;
# newer ones, for a project connected to GitHub, write .vercel\repo.json (the projects in this
# repository, each with its folder) instead.
function LinkedProject {
  $projectFile = Join-Path $root '.vercel\project.json'
  if (Test-Path $projectFile) {
    $p = Get-Content $projectFile -Raw | ConvertFrom-Json
    if ($p.projectId) { return [pscustomobject]@{ Id = $p.projectId; Name = $p.projectName } }
  }
  $repoFile = Join-Path $root '.vercel\repo.json'
  if (Test-Path $repoFile) {
    $r = Get-Content $repoFile -Raw | ConvertFrom-Json
    $p = @($r.projects | Where-Object { -not $_.directory -or $_.directory -eq '.' }) | Select-Object -First 1
    if ($p -and $p.id) { return [pscustomobject]@{ Id = $p.id; Name = $p.name } }
  }
  return $null
}

# The reminder key the live app hands out, or $null while reminders aren't set up there.
function LivePushKey {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri "$SiteUrl/api/push-key" -UserAgent 'FinBoard-setup' -TimeoutSec 30
    return ($r.Content | ConvertFrom-Json).publicKey
  } catch {
    return $null
  }
}

# Runs the daily reminder job once on the live app, the way Vercel's scheduler does (with CRON_SECRET),
# to check the server can read the database. Like the scheduled run, it only sends reminders due today.
function LiveReminderRun([string]$secret) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri "$SiteUrl/api/reminders" -Headers @{ Authorization = "Bearer $secret" } `
      -UserAgent 'FinBoard-setup' -TimeoutSec 90
    return [pscustomobject]@{ Status = [int]$r.StatusCode; Body = $r.Content }
  } catch {
    $status = 0
    try { $status = [int]$_.Exception.Response.StatusCode } catch {}
    $body = ''
    try { $body = (New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd() } catch {}
    if (-not $body) { $body = $_.Exception.Message }
    return [pscustomobject]@{ Status = $status; Body = $body }
  }
}

Write-Host ''
Write-Host 'FinBoard - turn on reminders on the server' -ForegroundColor Cyan

# ---------------------------------------------------------------- Node.js (npx)
if (-not (Get-Command npx.cmd -ErrorAction SilentlyContinue)) {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
if (-not (Get-Command npx.cmd -ErrorAction SilentlyContinue) -and (Test-Path 'C:\Program Files\nodejs\npx.cmd')) {
  $env:Path = 'C:\Program Files\nodejs;' + $env:Path
}
if (-not (Get-Command npx.cmd -ErrorAction SilentlyContinue)) {
  throw 'Node.js is not installed (npx was not found). Install it from https://nodejs.org, open a new PowerShell window and run this again.'
}

$ready = $false
Push-Location $root
try {
  # -------------------------------------------------------------- 1. Vercel sign-in
  Step '1. Vercel sign-in'
  Write-Host 'Checking the Vercel tool (the first run downloads it, which can take a minute)...'
  if ($CheckOnly) {
    if ((VercelOutput 'whoami').Code -ne 0) { throw 'Not signed in to Vercel. Run this without -CheckOnly to sign in.' }
  } else {
    & npx.cmd --yes vercel@latest whoami
    if ($LASTEXITCODE -ne 0) {
      Write-Host 'Not signed in to Vercel yet. Follow the steps below (a browser window opens).'
      & npx.cmd --yes vercel@latest login
      if ($LASTEXITCODE -ne 0) { throw 'Signing in to Vercel did not finish, so nothing was changed.' }
      & npx.cmd --yes vercel@latest whoami
      if ($LASTEXITCODE -ne 0) { throw 'Still not signed in to Vercel, so nothing was changed.' }
    }
  }
  Ok 'Signed in to Vercel'

  # -------------------------------------------------------------- 2. link the project
  Step '2. The FinBoard project on Vercel'
  $project = LinkedProject
  if (-not $project) {
    if ($CheckOnly) { throw 'This folder is not linked to the Vercel project yet. Run this without -CheckOnly to link it.' }
    Write-Host 'This folder is not linked to the Vercel project yet. If the Vercel tool asks, answer like this:'
    Write-Host '  - Set up / link this folder?          Yes'
    Write-Host '  - Which scope / team?                 the account that owns FinBoard'
    Write-Host '  - Which project?                      the one that serves finboard-alpha-beryl.vercel.app'
    Write-Host '                                        (called "finboard")'
    Write-Host '  - Pull environment variables now?     No (not needed)'
    & npx.cmd --yes vercel@latest link
    $linked = $LASTEXITCODE -eq 0
    $project = LinkedProject
    if (-not $linked -or -not $project) { throw 'The folder was not linked, so nothing was changed.' }
  }
  $projectName = if ($project.Name) { $project.Name } else { $project.Id }
  $inspect = VercelOutput "inspect $SiteUrl"
  $liveName = [regex]::Match($inspect.Text, '(?m)^\s*name\s+(\S+)\s*$').Groups[1].Value
  if ($inspect.Code -eq 0 -and $liveName -and $project.Name -and $liveName -ne $project.Name) {
    Warn "This folder is linked to the Vercel project '$projectName', but $SiteUrl is served by '$liveName'."
    Warn 'Delete the .vercel folder in the FinBoard folder and run this again to link the right one.'
    throw 'Linked to a different project, so nothing was changed.'
  }
  Ok "Vercel project: $projectName"

  $list = VercelOutput 'env ls production'
  if ($list.Code -ne 0) { throw "Couldn't read the project's settings on Vercel:`n$($list.Text)" }
  $has = @{}
  foreach ($n in 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'CRON_SECRET', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY') { $has[$n] = Listed $list.Text $n }
  # the server takes either name; the Supabase connection on Vercel adds both
  $haveSupabaseKey = $has['SUPABASE_SECRET_KEY'] -or $has['SUPABASE_SERVICE_ROLE_KEY']

  if ($CheckOnly) {
    Step 'Settings on Vercel (Production)'
    foreach ($n in 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'CRON_SECRET') {
      if ($has[$n]) { Ok "$n is set" } else { Warn "$n is not set yet" }
    }
    if ($haveSupabaseKey) { Ok 'A Supabase secret key is set' } else { Warn 'No Supabase secret key yet' }
    Step 'The live app'
    if (LivePushKey) { Ok 'It hands out the reminder key, so reminders are set up on the server' }
    else { Warn "Reminders aren't set up on the live app yet" }
    Write-Host ''
    Write-Host 'Nothing was changed (-CheckOnly).'
    return
  }

  # -------------------------------------------------------------- 3. reminder keys (VAPID)
  Step '3. Reminder keys'
  $vapid = $null
  if ($has['VAPID_PUBLIC_KEY'] -and $has['VAPID_PRIVATE_KEY']) {
    Write-Host 'Reminder keys are already set. Replacing them means every device has to turn reminders on again.'
    if (YesNo 'Replace the reminder keys?' $false) { $vapid = 'new' }
  } else {
    $vapid = 'new'
  }
  if ($vapid -eq 'new') {
    $json = (& npx.cmd --yes web-push generate-vapid-keys --json) | Out-String
    $vapid = $json | ConvertFrom-Json
    if (-not $vapid.publicKey -or -not $vapid.privateKey) { throw "Couldn't create the reminder keys." }
    Ok 'New reminder keys created'
  } else {
    Ok 'Keeping the reminder keys that are set'
  }

  # -------------------------------------------------------------- 4. CRON_SECRET
  Step '4. Password for the daily reminder run'
  $cronSecret = $null
  if (-not $has['CRON_SECRET'] -or (YesNo 'CRON_SECRET is already set. Replace it?' $false)) {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $rng.Dispose()
    $cronSecret = -join ($bytes | ForEach-Object { $_.ToString('x2') })
    Ok 'New CRON_SECRET created'
  } else {
    Ok 'Keeping the CRON_SECRET that is set'
  }

  # -------------------------------------------------------------- 5. Supabase secret key
  Step '5. Supabase secret key'
  $secretKey = $null
  if (-not $haveSupabaseKey -or $ReplaceSupabaseKey) {
    Write-Host 'Find it in the Supabase dashboard: Project Settings -> API Keys -> Secret keys. Copy the key that'
    Write-Host 'starts with sb_secret_ (or, on the Legacy API keys tab, the service_role key). It is pasted hidden.'
    for ($try = 1; -not $secretKey; $try++) {
      $candidate = (Plain (Read-Host 'Supabase secret key (hidden)' -AsSecureString)).Trim()
      if (-not $candidate) { throw 'No key given, so nothing was changed.' }
      $jwtRole = ''
      if ($candidate.StartsWith('eyJ')) {
        # a legacy key is a JWT; its middle part says which role it is for (anon or service_role)
        try {
          $part = $candidate.Split('.')[1].Replace('-', '+').Replace('_', '/')
          $part = $part + ('=' * ((4 - $part.Length % 4) % 4))
          $jwtRole = ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($part)) | ConvertFrom-Json).role
        } catch { $jwtRole = 'unreadable' }
      }
      if ($candidate.StartsWith('sb_publishable_')) {
        Warn 'That is the publishable key (it is public). The server needs the secret one.'
      } elseif ($jwtRole -and $jwtRole -ne 'service_role') {
        Warn "That is the legacy '$jwtRole' key. The server needs the service_role key (or a new sb_secret_ key)."
      } else {
        $check = CheckSupabaseKey $candidate
        if ($check -eq 'ok') { $secretKey = $candidate; Ok 'The key works' }
        elseif ($check -eq 'no-table') {
          $secretKey = $candidate
          Warn "The key works, but the reminders tables aren't in the database yet (migration 0015)."
          Warn 'Reminders start working once that migration has been applied.'
        }
        elseif ($check -eq 'wrong') { Warn 'Supabase refused that key. Check you copied the whole secret key.' }
        else {
          Warn "Couldn't check the key ($check)."
          if (YesNo 'Save it anyway?' $false) { $secretKey = $candidate }
        }
      }
      if (-not $secretKey -and $try -ge 3) { throw 'No working key after three tries, so nothing was changed.' }
    }
  } else {
    Ok 'Already on Vercel (the Supabase connection added it), nothing to paste'
  }

  # -------------------------------------------------------------- 6. save on Vercel
  Step '6. Saving the settings on Vercel (Production)'
  $changed = $false
  if ($vapid) {
    SaveVariable 'VAPID_PUBLIC_KEY' $vapid.publicKey $has['VAPID_PUBLIC_KEY']
    SaveVariable 'VAPID_PRIVATE_KEY' $vapid.privateKey $has['VAPID_PRIVATE_KEY']
    $changed = $true
  }
  if (-not $has['VAPID_SUBJECT']) { SaveVariable 'VAPID_SUBJECT' $VapidSubject $false; $changed = $true }
  else { Ok 'VAPID_SUBJECT already set' }
  if ($cronSecret) { SaveVariable 'CRON_SECRET' $cronSecret $has['CRON_SECRET']; $changed = $true }
  if ($secretKey) { SaveVariable 'SUPABASE_SECRET_KEY' $secretKey $has['SUPABASE_SECRET_KEY']; $changed = $true }
  # kept for the check at the end: the new public key, and the new CRON_SECRET to start one daily run
  $newPublicKey = if ($vapid) { $vapid.publicKey } else { $null }
  $cronCheck = $cronSecret
  $vapid = $null; $cronSecret = $null; $secretKey = $null; $candidate = $null

  # -------------------------------------------------------------- 7. redeploy
  Step '7. Redeploying the live app'
  $deployed = $false
  if ($changed -or (YesNo 'Nothing changed. Redeploy anyway?' $false)) {
    Write-Host 'Rebuilding the version that is live now with the new settings (takes a minute or two)...'
    & npx.cmd --yes vercel@latest redeploy $SiteUrl --target production
    if ($LASTEXITCODE -ne 0) {
      Warn "Couldn't redeploy automatically. In the Vercel dashboard open the project -> Deployments, pick the"
      Warn 'newest Production deployment -> (...) menu -> Redeploy. (Pushing any change to main works too.)'
    } else {
      Ok 'Redeployed'
      $deployed = $true
    }
  }

  # -------------------------------------------------------------- 8. check the live app
  Step '8. Checking the live app'
  # right after a redeploy the address can serve the previous version for a moment, so wait up to 2 minutes
  $liveKey = $null
  $tries = if ($deployed) { 24 } else { 1 }
  for ($i = 0; $i -lt $tries; $i++) {
    if ($i -gt 0) { Start-Sleep -Seconds 5 }
    $liveKey = LivePushKey
    if ($liveKey -and (-not $newPublicKey -or $liveKey -eq $newPublicKey)) { break }
  }
  if (-not $liveKey -or ($newPublicKey -and $liveKey -ne $newPublicKey)) {
    Warn "The live app doesn't have the new settings yet. Give it a few minutes; this shows how far it got:"
    Warn '  powershell -ExecutionPolicy Bypass -File scripts\configure-push.ps1 -CheckOnly'
  } else {
    Ok 'The live app hands out the reminder key'
    $ready = $true
    if ($cronCheck) {
      $run = LiveReminderRun $cronCheck
      $message = ''
      try { $message = [string]($run.Body | ConvertFrom-Json).message } catch {}
      if (-not $message) { $message = [string]$run.Body }
      if ($run.Status -eq 200) {
        Ok 'The daily reminder run works (it can read the database)'
      } elseif ($message -match 'schema cache|does not exist|Could not find the table') {
        Warn "The reminders tables aren't in the database yet. Run migration 0015 in the Supabase SQL Editor;"
        Warn 'nothing else to do here afterwards.'
      } elseif ($message -match 'API key|JWT') {
        Warn "Supabase refused the server's key. Run this again with -ReplaceSupabaseKey and paste the secret key."
        $ready = $false
      } else {
        Warn "The daily reminder run answered $($run.Status): $message"
      }
    }
  }
} finally {
  $cronCheck = $null
  Pop-Location
}

Write-Host ''
if ($ready) {
  Write-Host 'Done. Reminders are set up on the server; they go out once a day around 8-9 am Cairo time.' -ForegroundColor Cyan
  Write-Host 'Now on each device (your iPhone and the desktop app): open FinBoard -> Settings -> Reminders,'
  Write-Host 'turn them on, allow notifications when asked, then tap "Send a test".'
  Write-Host 'On iPhone, FinBoard must be opened from its Home Screen icon (not in Safari) for this to work.'
} else {
  Write-Host 'The settings are saved on Vercel. Once the check above passes, turn reminders on in each device:' -ForegroundColor Cyan
  Write-Host 'open FinBoard -> Settings -> Reminders, turn them on, allow notifications, then tap "Send a test".'
}
