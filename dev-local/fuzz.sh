#!/usr/bin/env bash
# Build a throwaway database with every migration, then run dev-local/fuzz.sql once per seed.
# Usage: bash dev-local/fuzz.sh [steps] [seed ...]
dev="$(cd "$(dirname "$0")" && pwd)"; root="$(dirname "$dev")"
psql="$dev/bin/pg/pgsql/bin/psql.exe"; export PGPASSWORD=postgres
common=(-h 127.0.0.1 -p 54329 -U postgres)
steps="${1:-2000}"; shift || true; seeds=("${@:-0.42}")
for seed in "${seeds[@]}"; do
  "$psql" "${common[@]}" -q -c "drop database if exists finance_fuzz" -c "create database finance_fuzz" >/dev/null 2>&1
  "$psql" "${common[@]}" -d finance_fuzz -q -v ON_ERROR_STOP=1 -f "$dev/shim.sql" >/dev/null 2>&1
  for m in "$root"/supabase/migrations/*.sql; do
    case "$m" in *cron*) continue;; esac
    "$psql" "${common[@]}" -d finance_fuzz -q -v ON_ERROR_STOP=1 --single-transaction -f "$m" >/dev/null 2>&1 || { echo "migration failed: $m"; exit 1; }
  done
  echo "===== seed $seed, $steps steps"
  "$psql" "${common[@]}" -d finance_fuzz -q -v ON_ERROR_STOP=1 -v seed="$seed" -v steps="$steps" -f "$dev/fuzz.sql" 2>&1 | grep -v '^SET$\|^$\|NOTICE\|WARNING\|^set_config\|^INSERT'
done
"$psql" "${common[@]}" -q -c "drop database if exists finance_fuzz" >/dev/null 2>&1
