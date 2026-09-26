# Builds a throwaway database exactly like the Supabase SQL Editor would (each migration as one
# transaction), runs the SQL regression tests, and drops it. Usage:
#   powershell -File dev-local\test-migrations.ps1
$ErrorActionPreference = 'Continue'
$dev = $PSScriptRoot
$root = Split-Path -Parent $dev
$psql = "$dev\bin\pg\pgsql\bin\psql.exe"
$env:PGPASSWORD = 'postgres'
$db = 'finance_migtest'
$common = @('-h', '127.0.0.1', '-p', '54329', '-U', 'postgres')

& $psql @common -q -c "drop database if exists $db" -c "create database $db" 2>$null | Out-Null
& $psql @common -d $db -q -v ON_ERROR_STOP=1 -f "$dev\shim.sql" 2>&1 | Out-Null
$failed = $false
foreach ($m in Get-ChildItem "$root\supabase\migrations\*.sql" | Sort-Object Name | Where-Object { $_.Name -notlike '*cron*' }) {
  $out = & $psql @common -d $db -q -v ON_ERROR_STOP=1 --single-transaction -f $m.FullName 2>&1
  if ($LASTEXITCODE -ne 0) { Write-Host "MIGRATION FAILED: $($m.Name)"; $out | Select-String 'ERROR' | Write-Host; $failed = $true; break }
  Write-Host "applied $($m.Name) (single transaction)"
}
if (-not $failed) {
  # every migration must also be safe to re-run
  foreach ($m in Get-ChildItem "$root\supabase\migrations\*.sql" | Sort-Object Name | Where-Object { $_.Name -notlike '*cron*' -and $_.Name -notlike '0001*' }) {
    $out = & $psql @common -d $db -q -v ON_ERROR_STOP=1 --single-transaction -f $m.FullName 2>&1
    if ($LASTEXITCODE -ne 0) { Write-Host "RE-RUN FAILED: $($m.Name)"; $out | Select-String 'ERROR' | Write-Host; $failed = $true }
    else { Write-Host "re-ran $($m.Name) OK" }
  }
}
if (-not $failed) {
  # the original smoke test (runs in a transaction and rolls back) must still pass on the latest schema
  & $psql @common -d $db -q -c "insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'test@local.test') on conflict do nothing" | Out-Null
  $old = & $psql @common -d $db -tA -v ON_ERROR_STOP=1 -f "$dev\smoke.sql" 2>&1
  if ($LASTEXITCODE -ne 0) { Write-Host 'smoke.sql FAILED'; $old | Select-String 'ERROR' | Write-Host; $failed = $true } else { Write-Host 'smoke.sql OK' }
}
if (-not $failed) {
  $out = & $psql @common -d $db -v ON_ERROR_STOP=1 -f "$dev\smoke-0004.sql" 2>&1
  $out | ForEach-Object { "$_" } | Select-String -Pattern 'PASS|FAIL|ERROR|ALL 0004' | ForEach-Object { $_.Line -replace '^.*?(PASS|FAIL|ERROR|ALL)', '$1' }
  if ($LASTEXITCODE -ne 0) { $failed = $true }
}
& $psql @common -q -c "drop database if exists $db" 2>$null | Out-Null
if ($failed) { Write-Host 'SQL TESTS FAILED'; exit 1 } else { Write-Host 'SQL TESTS PASSED' }
