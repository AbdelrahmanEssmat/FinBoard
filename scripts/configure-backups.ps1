# Turns on FinBoard's weekly encrypted database backup in one go: saves the two secrets the backup
# needs in the GitHub repository and starts the first backup.
#
#   powershell -ExecutionPolicy Bypass -File scripts\configure-backups.ps1
#
# What it does:
#   1. installs the GitHub command-line tool (gh) if it's missing, and makes sure it is signed in as your
#      PERSONAL GitHub account, AbdelrahmanEssmat (never a work / Introspect Capital account)
#   2. asks for the database's connection string (Supabase "Session pooler") and saves it as the
#      repository secret SUPABASE_DB_URL
#   3. makes a strong random passphrase (or takes yours) and saves it as the repository secret
#      BACKUP_PASSPHRASE, then shows it ONCE: every backup is locked with it and can't be opened
#      without it, so it goes straight into your password manager
#   4. starts the first backup (.github/workflows/backup.yml has to be on GitHub's main branch already)
#
# The secrets only live in memory while the script runs and reach gh through its input: they are never
# written to disk or shown, apart from a new passphrase, once. Running it again is safe: it asks before
# replacing anything. How the backups work and how to restore one: docs\backups.md
$ErrorActionPreference = 'Stop'

$Repo = 'AbdelrahmanEssmat/FinBoard'
$Account = 'AbdelrahmanEssmat'
$ProjectRef = 'qddbhmiqsolhnzduvswt'
$Workflow = 'backup.yml'
# hand text to gh as UTF-8 (Windows PowerShell would otherwise send it as ASCII)
$OutputEncoding = New-Object Text.UTF8Encoding $false

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
$done = New-Object Collections.Generic.List[string]
function Ok([string]$text) { Write-Host "[ok]  $text" -ForegroundColor Green; $done.Add($text) }
function Step([string]$text) { Write-Host ''; Write-Host $text -ForegroundColor Cyan }

# Runs gh without showing its output. Returns .Code (exit code), .Out (what it printed) and .Err (its
# messages). -InputText is handed to gh through its input: that is how the secrets reach it.
function Invoke-Gh {
  param([string[]]$GhArgs, [string]$InputText)
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try {
    if ($PSBoundParameters.ContainsKey('InputText')) { $all = $InputText | & $script:gh @GhArgs 2>&1 }
    else { $all = & $script:gh @GhArgs 2>&1 }
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $old }
  $out = @($all | Where-Object { $_ -isnot [Management.Automation.ErrorRecord] } | ForEach-Object { "$_" }) -join "`n"
  $err = @($all | Where-Object { $_ -is [Management.Automation.ErrorRecord] } | ForEach-Object { "$_" }) -join "`n"
  [pscustomobject]@{ Code = $code; Out = $out.Trim(); Err = $err.Trim() }
}

function Find-Gh {
  $cmd = Get-Command gh -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($p in @("$env:ProgramFiles\GitHub CLI\gh.exe", "$env:LOCALAPPDATA\Programs\GitHub CLI\gh.exe")) {
    if (Test-Path $p) { return $p }
  }
  return $null
}

function Get-GhLogin {
  $r = Invoke-Gh @('api', 'user', '--jq', '.login')
  if ($r.Code -eq 0) { return $r.Out } else { return '' }
}

function Connect-Gh {
  Write-Host ''
  Write-Host "Sign in to GitHub as your PERSONAL account: $Account" -ForegroundColor Yellow
  Write-Host '  - Below, gh shows a one-time code. Type it into the GitHub page that opens in your browser'
  Write-Host '    (https://github.com/login/device).'
  Write-Host "  - Before you click Authorize, check that the page says you are signed in as $Account."
  Write-Host '    If it shows a work account (Introspect Capital), switch accounts first (your picture, top right).'
  Read-Host 'Press Enter to open the GitHub page'
  Start-Process 'https://github.com/login/device'
  # With prompts off, gh skips its "Authenticate Git with your GitHub credentials?" question, so your
  # Git sign-in stays exactly as it is (this script only needs gh itself).
  $env:GH_PROMPT_DISABLED = '1'
  try { & $script:gh auth login --hostname github.com --web --git-protocol https }
  finally { Remove-Item Env:GH_PROMPT_DISABLED -ErrorAction SilentlyContinue }
  if ($LASTEXITCODE -ne 0) { throw 'Signing in to GitHub did not finish. Nothing was changed.' }
}

# Asks for the Session pooler connection string (and the password, if the string still has the
# [YOUR-PASSWORD] placeholder) and checks it looks right. Returns it; nothing is saved here.
function Read-DbUrl {
  $u = (Plain (Read-Host 'Connection string (hidden)' -AsSecureString)).Trim().Trim('"', "'")
  if (-not $u) { throw 'No connection string given. Nothing was changed.' }
  if ($u -notmatch '^postgres(ql)?://') { throw 'That is not a connection string (it should start with postgresql://). Nothing was changed.' }
  if ($u.Contains('[YOUR-PASSWORD]')) {
    $pw = Plain (Read-Host 'Database password (hidden)' -AsSecureString)
    if (-not $pw) { throw 'No password given. Nothing was changed.' }
    $u = $u.Replace('[YOUR-PASSWORD]', [Uri]::EscapeDataString($pw))
    $pw = $null
  }
  $m = [regex]::Match($u, '^postgres(?:ql)?://(?<user>[^:@/]+):(?<pass>[^@/]+)@(?<host>[^:/?#@]+)(?::(?<port>\d+))?/')
  if (-not $m.Success) {
    throw ('The connection string is not in the form postgresql://user:password@host:5432/postgres. If your ' +
      'password has characters like @ / : # ? or %, paste the string with [YOUR-PASSWORD] still in it and type ' +
      'the password when asked: the script encodes it for you. Nothing was changed.')
  }
  $problems = @()
  if ($m.Groups['host'].Value -like 'db.*.supabase.co') { $problems += 'this is the "Direct connection", which GitHub''s servers can''t reach: use the "Session pooler" one' }
  if ($m.Groups['port'].Value -eq '6543') { $problems += 'this is the "Transaction pooler" (port 6543): backups need the "Session pooler" (port 5432)' }
  if ($u -notlike "*$ProjectRef*") { $problems += "this is not FinBoard's Supabase project ($ProjectRef)" }
  foreach ($p in $problems) { Write-Host "  Careful: $p." -ForegroundColor Yellow }
  if ($problems.Count -gt 0 -and -not (YesNo 'Use it anyway?' $false)) { throw 'Nothing was changed. Run the script again with the Session pooler connection string.' }
  return $u
}

# 32 characters from the system's cryptographic random generator, in groups of 4 so it's easy to read;
# no look-alike characters (0/O, 1/l/I). About 186 bits of randomness.
function New-Passphrase {
  $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  $limit = 256 - (256 % $alphabet.Length)   # bytes above this are skipped so every character is equally likely
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  $chars = New-Object Collections.Generic.List[char]
  $byte = New-Object byte[] 1
  try {
    while ($chars.Count -lt 32) {
      $rng.GetBytes($byte)
      if ($byte[0] -lt $limit) { $chars.Add($alphabet[$byte[0] % $alphabet.Length]) }
    }
  } finally { $rng.Dispose() }
  $groups = for ($i = 0; $i -lt 32; $i += 4) { -join $chars.GetRange($i, 4) }
  return ($groups -join '-')
}

Write-Host ''
Write-Host 'FinBoard - weekly encrypted database backups' -ForegroundColor Cyan

# ---------------------------------------------------------------- 1. gh, signed in as the personal account
Step 'Step 1 of 4: the GitHub command-line tool (gh)'
$gh = Find-Gh
if (-not $gh) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw 'The GitHub command-line tool (gh) is not installed, and winget is not available to install it. Install it from https://cli.github.com, then run this script again.'
  }
  Write-Host 'gh is not installed yet. Installing it with winget (Windows may ask you to allow it)...'
  & winget install --id GitHub.cli -e --source winget
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  $gh = Find-Gh
  if (-not $gh) { throw 'gh still cannot be found after installing it. Open a new PowerShell window and run this script again.' }
}
Ok "GitHub command-line tool found ($gh)"

$switched = $false
if ((Invoke-Gh @('auth', 'status', '--hostname', 'github.com')).Code -ne 0) { Connect-Gh }
$login = Get-GhLogin
if ($login -ne $Account) {
  # the personal account may be signed in too, just not the one gh uses right now
  if ((Invoke-Gh @('auth', 'switch', '--hostname', 'github.com', '--user', $Account)).Code -eq 0) { $switched = $true }
  $login = Get-GhLogin
}
if ($login -ne $Account) {
  Write-Host "gh is signed in as '$login', not your personal account $Account." -ForegroundColor Yellow
  if (YesNo "Sign in as $Account now?" $true) { Connect-Gh; $login = Get-GhLogin }
}
if ($login -ne $Account) { throw "gh is signed in as '$login', not your personal account $Account. Nothing was changed." }
Ok "Signed in to GitHub as $Account"
if ($switched) { Write-Host '      (gh now uses this account by default; "gh auth switch" changes it back)' }

$list = Invoke-Gh @('secret', 'list', '--repo', $Repo)
if ($list.Code -ne 0) { throw "Couldn't read the repository's secrets: $($list.Err) Nothing was changed." }
$existing = @($list.Out -split "`n" | ForEach-Object { ($_ -split "`t")[0].Trim() } | Where-Object { $_ })

# ---------------------------------------------------------------- 2. the connection string
Step 'Step 2 of 4: the database connection string'
$setUrl = $true
if ($existing -contains 'SUPABASE_DB_URL') { $setUrl = YesNo 'A connection string is already saved. Replace it?' $false }
if ($setUrl) {
  Write-Host "  1. Open https://supabase.com/dashboard/project/$ProjectRef"
  Write-Host '  2. Click "Connect" in the bar at the top of the page.'
  Write-Host '  3. Under "Session pooler", copy the URI. It looks like this:'
  Write-Host "       postgresql://postgres.${ProjectRef}:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres"
  Write-Host '     (the Session pooler, because GitHub''s servers can''t reach the "Direct connection" address)'
  Write-Host '  4. Paste it below as it is. If it still says [YOUR-PASSWORD], you''ll be asked for the password next.'
  Write-Host '     Forgot the database password? Project Settings > Database > "Reset database password".'
  Write-Host '     FinBoard itself never uses that password, so resetting it is safe.'
  $url = Read-DbUrl
  $r = Invoke-Gh @('secret', 'set', 'SUPABASE_DB_URL', '--repo', $Repo) -InputText $url
  $url = $null
  if ($r.Code -ne 0) { throw "GitHub didn't accept the connection string: $($r.Err)" }
  Ok 'Saved the connection string as the secret SUPABASE_DB_URL (GitHub never shows it again)'
} else {
  Ok 'Kept the saved connection string'
}

# ---------------------------------------------------------------- 3. the passphrase
Step 'Step 3 of 4: the backup passphrase'
$setPass = $true
if ($existing -contains 'BACKUP_PASSPHRASE') {
  Write-Host 'A backup passphrase is already saved. The backups made so far can only be opened with that one.'
  $setPass = YesNo 'Replace it with a new passphrase? (older backups will still need the old one)' $false
}
if ($setPass) {
  $own = YesNo 'Type your own passphrase instead of using a strong random one?' $false
  if ($own) {
    $passphrase = Plain (Read-Host 'Your passphrase, at least 16 characters (hidden)' -AsSecureString)
    $again = Plain (Read-Host 'The same passphrase again (hidden)' -AsSecureString)
    if ($passphrase -cne $again) { throw 'The two passphrases are different, so the passphrase was not saved. Run the script again.' }
    $again = $null
    if ($passphrase.Length -lt 16) { throw 'That passphrase is shorter than 16 characters, so it was not saved. Run the script again.' }
    if ($passphrase -cne $passphrase.Trim()) { throw 'The passphrase starts or ends with a space, which is easy to lose when copying, so it was not saved. Run the script again.' }
  } else {
    $passphrase = New-Passphrase
  }
  $r = Invoke-Gh @('secret', 'set', 'BACKUP_PASSPHRASE', '--repo', $Repo) -InputText $passphrase
  if ($r.Code -ne 0) { $passphrase = $null; throw "GitHub didn't accept the passphrase: $($r.Err)" }
  if ($own) {
    $passphrase = $null
    Ok 'Saved your passphrase as the secret BACKUP_PASSPHRASE'
    Write-Host '      Make sure it is in your password manager: without it no backup can ever be opened.' -ForegroundColor Yellow
  } else {
    Write-Host ''
    Write-Host '  ==========================================================================' -ForegroundColor Yellow
    Write-Host '  YOUR BACKUP PASSPHRASE (shown only this once):' -ForegroundColor Yellow
    Write-Host ''
    Write-Host "      $passphrase"
    Write-Host ''
    Write-Host '  Save it in your password manager NOW, exactly as shown, dashes included.' -ForegroundColor Yellow
    Write-Host '  Every backup is locked with it. Without it no backup can ever be opened:' -ForegroundColor Yellow
    Write-Host '  not by you, not by GitHub, not by anyone. GitHub keeps a sealed copy it never shows again.' -ForegroundColor Yellow
    Write-Host '  ==========================================================================' -ForegroundColor Yellow
    $passphrase = $null
    while (-not (YesNo '  Have you saved it in your password manager?' $false)) {
      Write-Host '  Please save it now: it is still on the screen above.' -ForegroundColor Yellow
    }
    Clear-Host
    Write-Host 'FinBoard - weekly encrypted database backups' -ForegroundColor Cyan
    Write-Host '(the screen was cleared so the passphrase is no longer shown)'
    foreach ($d in $done) { Write-Host "[ok]  $d" -ForegroundColor Green }
    Ok 'Saved the new passphrase as the secret BACKUP_PASSPHRASE (and in your password manager)'
  }
} else {
  Ok 'Kept the saved passphrase'
}

# ---------------------------------------------------------------- 4. the first backup
Step 'Step 4 of 4: the first backup'
$startedAt = [DateTimeOffset]::UtcNow
$r = Invoke-Gh @('workflow', 'run', $Workflow, '--repo', $Repo)
if ($r.Code -ne 0) {
  if ("$($r.Err) $($r.Out)" -match 'could not find|not find any workflow|404') {
    Write-Host "The backup workflow isn't on GitHub yet: .github/workflows/backup.yml has to be pushed to the main branch first." -ForegroundColor Yellow
  } else {
    Write-Host "GitHub didn't start the backup: $($r.Err)" -ForegroundColor Yellow
  }
  Write-Host 'The secrets are saved, so nothing else needs setting up. Once the workflow is on GitHub, start a backup with'
  Write-Host "  gh workflow run $Workflow --repo $Repo"
  Write-Host "or open https://github.com/$Repo/actions/workflows/$Workflow and click ""Run workflow""."
  Write-Host 'Otherwise the first backup simply runs on Sunday night (23:30 UTC, early Monday in Cairo).'
  exit 0
}
Ok 'The first backup has started'
Write-Host "      Follow it at https://github.com/$Repo/actions/workflows/$Workflow"
Write-Host "      or in this window with: gh run watch --repo $Repo"
if (YesNo 'Wait here until it finishes (usually 2 to 5 minutes)?' $true) {
  $run = $null
  for ($i = 0; $i -lt 20 -and -not $run; $i++) {
    Start-Sleep -Seconds 3   # the new run takes a few seconds to show up
    $r = Invoke-Gh @('run', 'list', '--repo', $Repo, '--workflow', $Workflow, '--event', 'workflow_dispatch', '--limit', '5', '--json', 'databaseId,createdAt')
    if ($r.Code -eq 0 -and $r.Out) {
      $runs = $r.Out | ConvertFrom-Json
      $run = $runs | Where-Object { [DateTimeOffset]($_.createdAt) -ge $startedAt.AddMinutes(-2) } | Select-Object -First 1
    }
  }
  if (-not $run) {
    Write-Host "Couldn't find the new run yet: follow it on the Actions page instead." -ForegroundColor Yellow
  } else {
    & $gh run watch $run.databaseId --repo $Repo --exit-status
    if ($LASTEXITCODE -eq 0) {
      Ok 'The first backup finished. Its encrypted file is under "Artifacts" on the run''s page.'
    } else {
      Write-Host "The backup failed. Open https://github.com/$Repo/actions/runs/$($run.databaseId) to see why." -ForegroundColor Yellow
      Write-Host 'A wrong password in the connection string is the usual cause: run this script again and replace it.' -ForegroundColor Yellow
    }
  }
}
Write-Host ''
Write-Host 'Done. Backups now run every week. How to download, open and restore one: docs\backups.md' -ForegroundColor Cyan
