#!/usr/bin/env bash
# Builds a throwaway database exactly like the Supabase SQL Editor would (each migration as one
# transaction), runs the SQL regression tests, and drops it. The same checks as test-migrations.ps1,
# for Git Bash, Linux and CI. Usage:
#   bash dev-local/test-migrations.sh
# Settings (environment variables, all optional):
#   PSQL           the psql to use (default: dev-local/bin/pg/pgsql/bin/psql.exe if it exists, else psql)
#   PGHOST PGPORT PGUSER PGPASSWORD   the server (default 127.0.0.1, 54329, postgres, postgres)
#   TEST_DB        the throwaway database, dropped and re-created (default finance_migtest_sh)
#   MAX_MIGRATION  e.g. 0014: skip migrations numbered above it, and their smoke-NNNN.sql tests
#                  (handy while a newer migration is still being written)
# Exits 1 if anything fails.
set -u

dev="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(dirname "$dev")"
if [ -z "${PSQL:-}" ]; then
  if [ -f "$dev/bin/pg/pgsql/bin/psql.exe" ]; then PSQL="$dev/bin/pg/pgsql/bin/psql.exe"; else PSQL=psql; fi
fi
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-54329}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}"
db="${TEST_DB:-finance_migtest_sh}"
max="${MAX_MIGRATION:-}"

if ! [[ $db =~ ^[a-z_][a-z0-9_]*$ ]]; then echo "TEST_DB must be a plain lower-case name (letters, digits, _), got '$db'"; exit 1; fi
case "$db" in postgres | template0 | template1 | finance) echo "TEST_DB=$db is a real database, not a throwaway one: pick another name"; exit 1 ;; esac
if [ -n "$max" ] && ! [[ $max =~ ^[0-9]+$ ]]; then echo "MAX_MIGRATION must be a number like 0014, got '$max'"; exit 1; fi
if ! command -v "$PSQL" >/dev/null 2>&1; then echo "psql not found: $PSQL (set PSQL to its path)"; exit 1; fi

# psql without ~/.psqlrc: prints stdout + stderr without Windows line endings, returns psql's exit code
run() { local out code; out=$("$PSQL" -X "$@" 2>&1); code=$?; printf '%s\n' "${out//$'\r'/}"; return $code; }
errors() { printf '%s\n' "$1" | grep -i 'ERROR'; }
drop_db() { "$PSQL" -X -d postgres -q -c "drop database if exists $db with (force)" >/dev/null 2>&1; }
trap 'echo; echo "interrupted"; drop_db; exit 130' INT TERM

echo "database $db on $PGHOST:$PGPORT ($("$PSQL" --version 2>/dev/null | tr -d '\r'))"
if ! out=$(run -d postgres -q -v ON_ERROR_STOP=1 -c "drop database if exists $db with (force)" -c "create database $db"); then
  echo "could not create the test database $db as $PGUSER:"; errors "$out"; echo 'SQL TESTS FAILED'; exit 1
fi
if ! out=$(run -d "$db" -q -v ON_ERROR_STOP=1 -f "$dev/shim.sql"); then
  echo 'shim.sql FAILED'; errors "$out"; drop_db; echo 'SQL TESTS FAILED'; exit 1
fi

# every migration in name order, except the cron one (pg_cron isn't available outside Supabase)
migrations=()
for m in "$root"/supabase/migrations/*.sql; do
  [ -f "$m" ] || continue
  name="${m##*/}"
  case "${name,,}" in *cron*) continue ;; esac
  if [ -n "$max" ] && [[ $name =~ ^([0-9]{4}) ]] && ((10#${BASH_REMATCH[1]} > 10#$max)); then
    echo "skipped $name (above MAX_MIGRATION=$max)"; continue
  fi
  migrations+=("$m")
done
if [ ${#migrations[@]} -eq 0 ]; then echo "no migrations found in $root/supabase/migrations"; drop_db; echo 'SQL TESTS FAILED'; exit 1; fi

failed=0
for m in "${migrations[@]}"; do
  name="${m##*/}"
  if ! out=$(run -d "$db" -q -v ON_ERROR_STOP=1 --single-transaction -f "$m"); then
    echo "MIGRATION FAILED: $name"; errors "$out"; failed=1; break
  fi
  echo "applied $name (single transaction)"
done

if [ $failed -eq 0 ]; then
  # every migration must also be safe to re-run
  for m in "${migrations[@]}"; do
    name="${m##*/}"
    case "$name" in 0001*) continue ;; esac
    if ! out=$(run -d "$db" -q -v ON_ERROR_STOP=1 --single-transaction -f "$m"); then
      echo "RE-RUN FAILED: $name"; errors "$out"; failed=1
    else
      echo "re-ran $name OK"
    fi
  done
fi

if [ $failed -eq 0 ]; then
  # the original smoke test (runs in a transaction and rolls back) must still pass on the latest schema
  "$PSQL" -X -d "$db" -q -c "insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'test@local.test') on conflict do nothing" >/dev/null
  if ! out=$(run -d "$db" -tA -v ON_ERROR_STOP=1 -f "$dev/smoke.sql"); then
    echo 'smoke.sql FAILED'; errors "$out"; failed=1
  else
    echo 'smoke.sql OK'
  fi
fi

for smoke in "$dev"/smoke-0*.sql; do
  [ $failed -eq 0 ] || break
  [ -f "$smoke" ] || continue
  name="${smoke##*/}"
  if [ -n "$max" ] && [[ $name =~ ^smoke-([0-9]{4}) ]] && ((10#${BASH_REMATCH[1]} > 10#$max)); then
    echo "skipped $name (above MAX_MIGRATION=$max)"; continue
  fi
  out=$(run -d "$db" -v ON_ERROR_STOP=1 -f "$smoke"); code=$?
  # the PASS / FAIL / ERROR lines and the closing "ALL 00NN CHECKS PASSED", without psql's file:line
  # prefix (and without the "fails" column header psql prints for each select pg_temp.fails(...))
  printf '%s\n' "$out" | awk '{ l = tolower($0) } l ~ /^ *fails *$/ { next }
    l ~ /pass|fail|error|all 0/ && match(l, /pass|fail|error|all/) { print substr($0, RSTART) }'
  [ $code -eq 0 ] || failed=1
done

drop_db
if [ $failed -ne 0 ]; then echo 'SQL TESTS FAILED'; exit 1; fi
echo "SQL TESTS PASSED${max:+ (migrations up to $max)}"
