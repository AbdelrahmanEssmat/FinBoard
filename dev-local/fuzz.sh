#!/usr/bin/env bash
# Build a throwaway database with every migration, then run dev-local/fuzz.sql once per seed (a fresh
# database for each seed). Prints one line per seed and exits 1 if any seed broke a rule ("BROKEN after
# step ..."), hit an error that isn't one of the app's own checks (the UNEXPECTED list), or didn't finish.
# Usage: bash dev-local/fuzz.sh [steps] [seed ...]          (default: 2000 steps, seed 0.42)
# Settings (environment variables, all optional):
#   PSQL           the psql to use (default: dev-local/bin/pg/pgsql/bin/psql.exe if it exists, else psql)
#   PGHOST PGPORT PGUSER PGPASSWORD   the server (default 127.0.0.1, 54329, postgres, postgres)
#   FUZZ_DB        the throwaway database, dropped and re-created for each seed (default finance_fuzz)
#   MAX_MIGRATION  e.g. 0014: skip migrations numbered above it (handy while one is still being written)
#   FUZZ_VERBOSE=1 also print each seed's full report (last actions, counts per action, refusals)
set -u

dev="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(dirname "$dev")"
if [ -z "${PSQL:-}" ]; then
  if [ -f "$dev/bin/pg/pgsql/bin/psql.exe" ]; then PSQL="$dev/bin/pg/pgsql/bin/psql.exe"; else PSQL=psql; fi
fi
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-54329}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}"
db="${FUZZ_DB:-finance_fuzz}"
max="${MAX_MIGRATION:-}"
steps="${1:-2000}"; shift || true; seeds=("${@:-0.42}")

if ! [[ $steps =~ ^[1-9][0-9]*$ ]]; then echo "steps must be a whole number above 0, got '$steps'"; exit 1; fi
for seed in "${seeds[@]}"; do
  if ! [[ $seed =~ ^-?[0-9]*\.?[0-9]+$ ]]; then echo "each seed must be a number from -1 to 1 (like 0.42), got '$seed'"; exit 1; fi
done
if ! [[ $db =~ ^[a-z_][a-z0-9_]*$ ]]; then echo "FUZZ_DB must be a plain lower-case name (letters, digits, _), got '$db'"; exit 1; fi
case "$db" in postgres | template0 | template1 | finance) echo "FUZZ_DB=$db is a real database, not a throwaway one: pick another name"; exit 1 ;; esac
if [ -n "$max" ] && ! [[ $max =~ ^[0-9]+$ ]]; then echo "MAX_MIGRATION must be a number like 0014, got '$max'"; exit 1; fi
if ! command -v "$PSQL" >/dev/null 2>&1; then echo "psql not found: $PSQL (set PSQL to its path)"; exit 1; fi

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

# psql without ~/.psqlrc: prints stdout + stderr without Windows line endings, returns psql's exit code
run() { local out code; out=$("$PSQL" -X "$@" 2>&1); code=$?; printf '%s\n' "${out//$'\r'/}"; return $code; }
errors() { printf '%s\n' "$1" | grep -i 'ERROR'; }
drop_db() { "$PSQL" -X -d postgres -q -c "drop database if exists $db with (force)" >/dev/null 2>&1; }
build_db() {
  local out m
  if ! out=$(run -d postgres -q -v ON_ERROR_STOP=1 -c "drop database if exists $db with (force)" -c "create database $db"); then
    echo "could not create the database $db on $PGHOST:$PGPORT as $PGUSER:"; errors "$out"; return 1
  fi
  if ! out=$(run -d "$db" -q -v ON_ERROR_STOP=1 -f "$dev/shim.sql"); then echo 'shim.sql failed:'; errors "$out"; return 1; fi
  for m in "${migrations[@]}"; do
    if ! out=$(run -d "$db" -q -v ON_ERROR_STOP=1 --single-transaction -f "$m"); then
      echo "migration failed: ${m##*/}"; errors "$out"; return 1
    fi
  done
}
# the lines of one section of the report: everything after the line starting with "--- <name>" up to
# the next line starting with "---", blank lines left out
section() { printf '%s\n' "$report" | awk -v h="--- $1" 'index($0, h) == 1 { f = 1; next } /^---/ { f = 0 } f && NF'; }

tmp="$(mktemp -d)" || exit 1
trap 'rm -rf "$tmp"' EXIT
trap 'echo; echo "interrupted"; drop_db; exit 130' INT TERM

failed_seeds=()
for seed in "${seeds[@]}"; do
  printf 'seed %s, %s steps ... ' "$seed" "$steps"
  if ! msg=$(build_db); then
    echo 'FAILED: could not build the database'; printf '%s\n' "$msg" | sed 's/^/    /'
    drop_db; echo 'FUZZ FAILED'; exit 1
  fi
  report=$("$PSQL" -X -d "$db" -q -v ON_ERROR_STOP=1 -v seed="$seed" -v steps="$steps" -f "$dev/fuzz.sql" 2>"$tmp/stderr"); code=$?
  report="${report//$'\r'/}"
  result=$(printf '%s\n' "$report" | grep -m1 -E '^(ALL [0-9]+ STEPS OK|BROKEN after step )')
  unexpected=$(section 'UNEXPECTED errors')
  refused=$(section 'actions' | awk '{ n = split($0, w, " ") } n > 1 && w[n] == "refused" { s += w[n - 1] } END { print s + 0 }')

  if [ "$code" -ne 0 ] || [ -z "$result" ]; then
    if [ "$code" -ne 0 ]; then echo "FAILED: the run stopped with an error (psql exit code $code)"
    else echo 'FAILED: the report has no "ALL ... STEPS OK" or "BROKEN after step" line'; fi
    tr -d '\r' <"$tmp/stderr" | grep -iE 'error|fatal' | head -n 20 | sed 's/^/    /'
    failed_seeds+=("$seed")
  elif [[ $result == BROKEN* ]] || [ -n "$unexpected" ]; then
    if [[ $result == BROKEN* ]]; then echo "FAILED: $result"; else echo "FAILED: $result, but some actions hit unexpected errors"; fi
    if [ -n "$unexpected" ]; then echo '    unexpected errors (not an app check):'; printf '%s\n' "$unexpected" | sed 's/^/      /'; fi
    echo '    last actions:'; section 'last actions' | sed 's/^/      /'
    failed_seeds+=("$seed")
  else
    echo "ok: $result ($refused refused by the app's own checks)"
  fi
  if [ "${FUZZ_VERBOSE:-}" = 1 ]; then
    printf '%s\n' "$report" | awk '/^(ALL [0-9]+ STEPS OK|BROKEN after step )/ { p = 1; next } p' | sed 's/^/    /'
  fi
done

drop_db
if [ ${#failed_seeds[@]} -gt 0 ]; then
  echo "FUZZ FAILED for seed ${failed_seeds[*]} (re-run one with: bash dev-local/fuzz.sh $steps ${failed_seeds[0]})"
  exit 1
fi
echo "FUZZ PASSED (${#seeds[@]} seed(s), $steps steps each)"
