# Local dev stack (optional, Windows): portable Postgres + PostgREST + fake auth.
# Lets you run the app end-to-end without a Supabase project. See dev-local/README.md.
# Usage:  powershell -File dev-local\start.ps1 [-Reset]
param([switch]$Reset)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dev = $PSScriptRoot
$pg = "$dev\bin\pg\pgsql\bin"
$data = "$dev\data"
$env:Path = "$pg;" + $env:Path
$env:PGPASSWORD = 'postgres'

if (-not (Test-Path "$pg\postgres.exe")) { throw "PostgreSQL binaries missing: unzip the EDB Windows binaries into dev-local\bin\pg\pgsql" }
if (-not (Test-Path "$dev\bin\postgrest\postgrest.exe")) { throw "PostgREST missing: unzip the Windows release into dev-local\bin\postgrest" }

if (-not (Test-Path "$data\PG_VERSION")) {
  'postgres' | Out-File -Encoding ascii "$env:TEMP\pgpw.txt"
  & "$pg\initdb.exe" -D $data -U postgres --pwfile="$env:TEMP\pgpw.txt" -E UTF8 --locale=C | Out-Null
}
$status = & "$pg\pg_ctl.exe" -D $data status 2>&1
if ($LASTEXITCODE -ne 0) {
  Start-Process -FilePath "$pg\pg_ctl.exe" -ArgumentList @('-D', "`"$data`"", '-o', '"-p 54329 -c listen_addresses=127.0.0.1"', '-l', "`"$dev\pg.log`"", 'start') -WindowStyle Hidden
  Start-Sleep -Seconds 3
}

$exists = & "$pg\psql.exe" -h 127.0.0.1 -p 54329 -U postgres -tAc "select 1 from pg_database where datname='finance'"
if ($Reset -and $exists) {
  & "$pg\psql.exe" -h 127.0.0.1 -p 54329 -U postgres -q -c "drop database finance"
  $exists = $null
}
if (-not $exists) {
  & "$pg\psql.exe" -h 127.0.0.1 -p 54329 -U postgres -q -c "create database finance"
  & "$pg\psql.exe" -h 127.0.0.1 -p 54329 -U postgres -d finance -v ON_ERROR_STOP=1 -q -f "$dev\shim.sql"
  Get-ChildItem "$root\supabase\migrations\*.sql" | Sort-Object Name | ForEach-Object {
    if ($_.Name -notlike '*cron*') { & "$pg\psql.exe" -h 127.0.0.1 -p 54329 -U postgres -d finance -v ON_ERROR_STOP=1 -q -f $_.FullName }
  }
  & "$pg\psql.exe" -h 127.0.0.1 -p 54329 -U postgres -d finance -q -c "insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'test@local.test') on conflict do nothing"
}

if (-not (Get-Process postgrest -ErrorAction SilentlyContinue)) {
  Start-Process -FilePath "$dev\bin\postgrest\postgrest.exe" -ArgumentList "`"$dev\postgrest.conf`"" -WorkingDirectory $dev -WindowStyle Hidden -RedirectStandardOutput "$dev\postgrest.log" -RedirectStandardError "$dev\postgrest.err.log"
}
$proxy = Get-CimInstance Win32_Process -Filter "name = 'node.exe'" | Where-Object { $_.CommandLine -like '*dev-local*server.mjs*' }
if (-not $proxy) {
  Start-Process -FilePath "node" -ArgumentList "`"$dev\server.mjs`"" -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput "$dev\proxy.log" -RedirectStandardError "$dev\proxy.err.log"
}
Start-Sleep -Seconds 2
Write-Host "Local stack ready: http://127.0.0.1:54321  (login with test@local.test / any password)"
Write-Host "Put in .env:  SUPABASE_URL=http://127.0.0.1:54321  SUPABASE_ANON_KEY=local"
