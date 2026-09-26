# Drop and recreate the local database from the migrations (keeps Postgres running).
$dev = $PSScriptRoot
$root = Split-Path -Parent $dev
$pg = "$dev\bin\pg\pgsql\bin"
$env:PGPASSWORD = 'postgres'
$psql = "$pg\psql.exe"
& $psql -h 127.0.0.1 -p 54329 -U postgres -q -c "select pg_terminate_backend(pid) from pg_stat_activity where datname='finance' and pid <> pg_backend_pid()" | Out-Null
& $psql -h 127.0.0.1 -p 54329 -U postgres -q -c "drop database if exists finance" -c "create database finance"
& $psql -h 127.0.0.1 -p 54329 -U postgres -d finance -v ON_ERROR_STOP=1 -q -f "$dev\shim.sql" 2>&1 | Where-Object { $_ -notmatch 'NOTICE' }
Get-ChildItem "$root\supabase\migrations\*.sql" | Sort-Object Name | Where-Object { $_.Name -notlike '*cron*' } | ForEach-Object {
  & $psql -h 127.0.0.1 -p 54329 -U postgres -d finance -v ON_ERROR_STOP=1 -q -f $_.FullName
}
& $psql -h 127.0.0.1 -p 54329 -U postgres -d finance -q -c "insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'test@local.test') on conflict do nothing"
# PostgREST caches the schema; poke it to reload
Get-Process postgrest -ErrorAction SilentlyContinue | ForEach-Object { $_.Kill() }
$env:Path = "$pg;" + $env:Path
Start-Process -FilePath "$dev\bin\postgrest\postgrest.exe" -ArgumentList "`"$dev\postgrest.conf`"" -WorkingDirectory $dev -WindowStyle Hidden -RedirectStandardOutput "$dev\postgrest.log" -RedirectStandardError "$dev\postgrest.err.log"
Start-Sleep -Seconds 2
Write-Host "Local DB reset."
