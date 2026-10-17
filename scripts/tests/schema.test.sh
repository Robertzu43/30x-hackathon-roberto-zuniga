#!/usr/bin/env bash
# Task 2 schema (AC-03..08, AC-24, AC-25, AC-37, AC-62..65). Part 1 greps the migrations (AC-07). Part 2, when a local
# Postgres 15+ exists, applies every migration over Supabase stubs in a throwaway socket-only cluster and checks RLS and
# insert_decision for real. Never a delete statement here (CLAUDE.md): the no-DELETE rule is checked through pg_policies.
set -u
cd "$(dirname "$0")/../.." || exit 1
fail(){ echo "FAIL: $1"; exit 1; }
CORE=supabase/migrations/20261017000100_thesaurus_core.sql RPC=supabase/migrations/20261017000200_thesaurus_rpc.sql
[ -f "$CORE" ] && [ -f "$RPC" ] || fail "missing $CORE or $RPC"
code=$(sed 's/--.*$//' supabase/migrations/*.sql)   # executable SQL only: comments stripped
echo "$code" | grep -qiE '\b(drop|truncate)\b|delete[[:space:]]+from' && fail "destructive SQL in a migration (AC-07)"
echo "$code" | grep -qiE 'create table (public\.)?(profiles|deliveries)\b' && fail "reuses an earlier run's table (AC-07)"
echo "$code" | grep -qiE 'for delete' && fail "a delete policy exists (D10)"
[ "$(grep -c 'enable row level security' "$CORE")" = 9 ] || fail "expected 9 'enable row level security' lines"
for t in companies company_members policies beneficiaries invoices decisions approval_tokens approval_uses agent_runs; do
  grep -q "create table public\.$t (" "$CORE" || fail "no create table public.$t"
  [ "$(grep -c "alter table public\.$t enable row level security" "$CORE")" = 1 ] || fail "RLS not enabled once on $t"
  grep -q "create policy members_select_$t on public\.$t" "$CORE" || fail "no members_select_$t"
done
for t in policies beneficiaries invoices decisions approval_tokens approval_uses agent_runs; do
  grep -q "create policy members_insert_$t on public\.$t" "$CORE" || fail "no members_insert_$t"; done
for t in companies beneficiaries invoices; do
  grep -q "create policy members_update_$t on public\.$t" "$CORE" || fail "no members_update_$t"; done
for t in policies decisions approval_tokens approval_uses agent_runs; do
  grep -q "members_update_$t" "$CORE" && fail "append-only $t has an update policy (D10)"; done
grep -q 'grant update (archived) on public.invoices to authenticated' "$CORE" || fail "no column grant on archived (R-12)"
grep -q 'on_auth_user_created' "$CORE" || fail "no signup trigger (AC-03)"
for w in pg_advisory_xact_lock ALREADY_DECIDED STALE_PERIOD FINAL_DECISION NOT_ESCALATED 'security_invoker = true'; do
  grep -q "$w" "$RPC" || fail "RPC file lacks $w"; done

# ---- Part 2: execute against a real Postgres ----
INITDB=$(command -v initdb || ls /usr/lib/postgresql/*/bin/initdb 2>/dev/null | sort -V | tail -1)
[ -x "$INITDB" ] || { echo "schema.test: greps passed; no local Postgres, SQL not executed"; exit 0; }
B=$(dirname "$INITDB"); D=$(mktemp -d); chmod 777 "$D"
pg(){ if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }   # postgres refuses to run as root
trap 'pg "$B/pg_ctl" -D "$D/db" -m immediate stop >/dev/null 2>&1; rm -rf "$D"' EXIT
pg "$B/initdb" -D "$D/db" -U postgres -A trust >/dev/null 2>&1 || fail "initdb"
pg "$B/pg_ctl" -D "$D/db" -o "-c listen_addresses='' -k $D" -w start >/dev/null 2>&1 || fail "pg_ctl start"
sql(){ "$B/psql" -h "$D" -U postgres -d postgres -X -q -A -t -v ON_ERROR_STOP=1 "$@" 2>&1; }
as(){ printf "set role authenticated;\nset request.jwt.claim.sub = '%s';\n%s\n" "$1" "$2" | sql -f -; }
expect(){ out=$(as "$1" "$2"); echo "$out" | grep -qE "$3" || fail "$4 (got: $out)"; }
sql <<'STUBS' >/dev/null || fail "supabase stubs"
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create schema storage;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant usage on schema public, auth, storage to anon, authenticated, service_role;
grant all on storage.objects to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
STUBS
for f in supabase/migrations/*.sql; do out=$(sql -1 -f "$f") || fail "apply $f: $out"; done

UA=11111111-1111-4111-8111-111111111111 UB=22222222-2222-4222-8222-222222222222
sql -c "insert into auth.users values ('$UA', 'juan.perez@andina.co'), ('$UB', 'otra@b.co')" >/dev/null || fail "signup"
CA=$(sql -c "select company_id from public.company_members where user_id = '$UA'")
CB=$(sql -c "select company_id from public.company_members where user_id = '$UB'")
[ -n "$CA" ] && [ -n "$CB" ] || fail "trigger made no membership (AC-03)"
expect "$UA" "select name || '|' || approver_email || '|' || lang from public.companies" '^juan.perez\|juan.perez@andina.co\|es$' "own company from email (AC-03)"
expect "$UA" "select count(*) from public.companies where id = '$CB'" '^0$' "A reads B's company (AC-04)"
expect "$UA" "insert into public.invoices (company_id, source) values ('$CB', 'chat')" 'row-level security' "A inserts into B (AC-04)"
I="a0000000-0000-4000-8000-00000000000"
expect "$UA" "insert into public.invoices (id, company_id, source, fields) select ('${I}' || n)::uuid, '$CA', 'chat', '{\"payee_name\":\"Laura\"}' from generate_series(1, 6) n; select count(*) from public.invoice_current" '^6$' "A inserts and reads own invoices"
expect "$UB" "select count(*) from public.invoice_current" '^0$' "B sees A's invoices (AC-04)"
expect "$UA" "update public.invoices set expected_outcome = 'PAGAR' where id = '${I}1'" 'permission denied' "expected_outcome updatable (AC-06)"
expect "$UA" "update public.invoices set archived = false where id = '${I}1' returning archived" '^f$' "archived not updatable (AC-06)"
dec(){ printf "select seq from public.insert_decision('%s', %s, '%s', %s)" "$1" "$2" "$3" "$4"; }
ESC='{"outcome":"ESCALAR","actor":"agent","amount_usd":100,"checks":[],"question_es":"¿La pago?","question_en":"Pay it?"}'
PAY='{"outcome":"PAGAR","actor":"agent","amount_usd":100,"checks":[]}'
HUM='{"outcome":"PAGAR","actor":"human","actor_email":"juan.perez@andina.co","channel":"dashboard","amount_usd":100,"checks":[]}'
expect "$UA" "$(dec "${I}1" 0 "$ESC" 0)" '^1$' "first decision gets seq 1"
expect "$UA" "$(dec "${I}1" 0 "$ESC" 0)" 'ALREADY_DECIDED' "racing first decision (R-25)"
expect "$UA" "$(dec "${I}2" 0 "$PAY" 0)" 'STALE_PERIOD' "stale committed amount (AC-24)"
expect "$UA" "$(dec "${I}2" 100 "$PAY" 0)" '^1$' "fresh committed amount passes"
expect "$UA" "$(dec "${I}2" 100 "$PAY" 1)" 'FINAL_DECISION' "decision after PAGAR (AC-25)"
expect "$UA" "$(dec "${I}3" 200 "$HUM" 0)" 'NOT_ESCALATED' "human answer on a pending invoice (R-03)"
expect "$UA" "$(dec "${I}1" 100 "$HUM" 1)" '^2$' "human answer on ESCALAR, committed excludes itself"
expect "$UA" "$(dec "${I}1" 100 "$HUM" 2)" 'FINAL_DECISION' "second human answer (AC-37)"
expect "$UA" "insert into public.decisions (company_id, invoice_id, seq, outcome, actor) values ('$CA', '${I}2', 9, 'PAGAR', 'agent')" 'FINAL_DECISION' "direct insert bypasses the RPC (AC-25)"
expect "$UA" "$(dec "${I}3" 200 "$PAY" 0)" '^1$' "pending invoice decided"
expect "$UA" "$(dec "${I}4" 300 '{"outcome":"FRENAR","actor":"agent","question_es":"x","checks":[]}' 0)" 'check constraint' "question on non-ESCALAR (R-28)"
expect "$UA" "update public.decisions set outcome = 'FRENAR' returning id" '^$' "decisions updatable (AC-05)"
expect "$UA" "select count(*) from public.decisions where outcome = 'PAGAR'" '^3$' "decisions changed by update (AC-05)"
expect "$UB" "$(dec "${I}4" 0 "$PAY" 0)" 'INVOICE_NOT_FOUND' "B decides A's invoice (AC-04)"
expect "$UA" "select public.period_state('$CA', current_date)" '"paid_usd": 300' "period_state paid"
expect "$UA" "select public.period_state('$CA', current_date, '${I}3') ->> 'committed_usd'" '^200(\.00)?$' "period_state exclude"
expect "$UA" "select public.period_state('$CA', current_date) -> 'by_beneficiary' -> 0 ->> 'beneficiary'" '^Laura$' "by_beneficiary"
expect "$UB" "select public.period_state('$CA', current_date) ->> 'committed_usd'" '^0$' "B reads A's period (AC-04)"
# AC-24: a concurrent decision waits for the company lock, then sees the committed amount and gets STALE_PERIOD
as "$UA" "begin; $(dec "${I}4" 300 "$PAY" 0); select pg_sleep(1.5); commit;" >"$D/s1" &
sleep 0.5; expect "$UA" "$(dec "${I}5" 300 "$PAY" 0)" 'STALE_PERIOD' "concurrent decision ignored the lock (AC-24)"
wait; grep -q '^1$' "$D/s1" || fail "locked session did not commit: $(cat "$D/s1")"
# AC-05/AC-63/AC-08/R-03
sql -c "select count(*) from pg_policies where schemaname = 'public' and cmd in ('DELETE', 'ALL')" | grep -q '^0$' || fail "delete-capable policy (D10)"
D1=$(sql -c "select id from public.decisions where invoice_id = '${I}1' and seq = 1")
expect "$UA" "insert into public.approval_tokens (token_hash, company_id, invoice_id, decision_id, expires_at, email_sent, sent_to) values ('h1', '$CA', '${I}1', '$D1', now(), true, 'x@y.co'), ('h2', '$CA', '${I}1', '$D1', now(), true, 'x@y.co'); insert into public.approval_uses (token_hash, company_id, decision_id) values ('h1', '$CA', '$D1'); select 1" '^1$' "tokens and first use"
expect "$UA" "insert into public.approval_uses (token_hash, company_id, decision_id) values ('h2', '$CA', '$D1')" 'duplicate key' "second link of the pair (R-03)"
expect "$UB" "select count(*) from public.approval_tokens" '^0$' "B reads A's tokens (AC-04)"
sql -c "insert into public.agent_runs (company_id, trigger) values (null, 'cron'), ('$CB', 'manual')" >/dev/null || fail "service insert agent_runs"
expect "$UA" "insert into public.agent_runs (company_id, trigger, decided) values ('$CA', 'manual', '{}'); select count(*) from public.agent_runs" '^2$' "A sees own run and cron tick, not B's (AC-63)"
expect "$UA" "insert into public.agent_runs (company_id, trigger) values (null, 'cron')" 'row-level security' "member writes a cron tick (AC-63)"
sql -c "insert into storage.objects (bucket_id, name) values ('files', '$CA/x.pdf'), ('files', '$CB/y.pdf')" >/dev/null || fail "objects"
expect "$UA" "select string_agg(name, ',') from storage.objects" "^$CA/x.pdf$" "A reads B's file (AC-08)"
expect "$UA" "insert into storage.objects (bucket_id, name) values ('files', '$CB/z.pdf')" 'row-level security' "A writes into B's folder (AC-08)"
expect "$UA" "select public.seed_company('$CA')" 'permission denied' "members can call seed_company"
echo "schema.test: greps and live Postgres checks passed"
