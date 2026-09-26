$dev = $PSScriptRoot
Get-Process postgrest -ErrorAction SilentlyContinue | Stop-Process -Force
Get-CimInstance Win32_Process -Filter "name = 'node.exe'" | Where-Object { $_.CommandLine -like '*dev-local*server.mjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
& "$dev\bin\pg\pgsql\bin\pg_ctl.exe" -D "$dev\data" stop -m fast
