#!/usr/bin/env bash
# AC-43 / R-72 fallback (Task 8g): rate_limits + rate_limit_hit. Part 1 greps the migration; part 2, when a local
# Postgres exists, applies it over Supabase stubs in a throwaway socket-only cluster and counts for real.
set -u
cd "$(dirname "$0")/../.." || exit 1
fail(){ echo "FAIL: $1"; exit 1; }
M=supabase/migrations/20261017000500_rate_limit.sql
[ -f "$M" ] || fail "missing $M"
code=$(sed 's/--.*$//' "$M")
echo "$code" | grep -qiE '\b(drop|truncate)\b|delete[[:space:]]+from' && fail "destructive SQL (AC-07)"
echo "$code" | grep -q 'alter table public.rate_limits enable row level security' || fail "RLS not on for rate_limits"
echo "$code" | grep -qi 'create policy' && fail "a member policy on rate_limits"
echo "$code" | grep -q 'auth.uid()' || fail "not keyed on auth.uid()"

INITDB=$(command -v initdb || ls /usr/lib/postgresql/*/bin/initdb 2>/dev/null | sort -V | tail -1)
[ -x "$INITDB" ] || { echo "rate_limit.test: greps passed; no local Postgres, SQL not executed"; exit 0; }
B=$(dirname "$INITDB"); D=$(mktemp -d); chmod 777 "$D"
pg(){ if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
trap 'pg "$B/pg_ctl" -D "$D/db" -m immediate stop >/dev/null 2>&1; rm -rf "$D"' EXIT
pg "$B/initdb" -D "$D/db" -U postgres -A trust >/dev/null 2>&1 || fail "initdb"
pg "$B/pg_ctl" -D "$D/db" -o "-c listen_addresses='' -k $D" -w start >/dev/null 2>&1 || fail "pg_ctl start"
sql(){ "$B/psql" -h "$D" -U postgres -d postgres -X -q -A -t -v ON_ERROR_STOP=1 "$@" 2>&1; }
as(){ printf "set role %s;\nset request.jwt.claim.sub = '%s';\n%s\n" "$1" "$2" "$3" | sql -f -; }
sql <<'STUBS' >/dev/null || fail "supabase stubs"
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema public, auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
STUBS
out=$(sql -1 -f "$M") || fail "apply $M: $out"
UA=11111111-1111-4111-8111-111111111111 UB=22222222-2222-4222-8222-222222222222
hits=$(as authenticated "$UA" "select string_agg(left(public.rate_limit_hit()::text, 1), '') from generate_series(1, 61);")
[ "$hits" = "$(printf 't%.0s' $(seq 60))f" ] || fail "60 allowed then refused (got $hits)"
[ "$(as authenticated "$UB" "select public.rate_limit_hit()")" = t ] || fail "a second user is limited"
[ "$(sql -c "select n from public.rate_limits where user_id = '$UA'")" = 61 ] || fail "count is not one row per user and minute"
# The previous minute still weighs on this one (sliding window): a flood last minute keeps refusing now.
sql -c "insert into public.rate_limits values ('$UB', floor(extract(epoch from now()) / 60)::bigint - 1, 1000000)" >/dev/null
[ "$(as authenticated "$UB" "select public.rate_limit_hit()")" = f ] || fail "previous minute ignored"
as authenticated "$UA" "select count(*) from public.rate_limits" | grep -qE 'permission denied|^0$' || fail "a member reads rate_limits"
as authenticated "$UA" "insert into public.rate_limits values ('$UA', 0, 0)" | grep -qE 'permission denied|row-level security' || fail "a member writes rate_limits"
as anon "" "select public.rate_limit_hit()" | grep -q 'permission denied' || fail "anon executes rate_limit_hit"
as authenticated "" "select public.rate_limit_hit()" | grep -q 'null value' || fail "no auth.uid() must error (the Worker then lets the request through)"
echo "rate_limit.test: greps and live Postgres checks passed"
