#!/usr/bin/env bash
# Task 2 schema (AC-03..08, AC-24, AC-25, AC-37, AC-62..65, AC-68, AC-69). Part 1 greps the migrations (AC-07). Part 2, when a local
# Postgres 15+ exists, applies every migration over Supabase stubs in a throwaway socket-only cluster and checks RLS and
# insert_decision for real. Never a delete statement here (CLAUDE.md): the no-DELETE rule is checked through pg_policies.
set -u
cd "$(dirname "$0")/../.." || exit 1
fail(){ echo "FAIL: $1"; exit 1; }
CORE=supabase/migrations/20261017000100_thesaurus_core.sql RPC=supabase/migrations/20261017000200_thesaurus_rpc.sql
LOCK=supabase/migrations/20261017000250_thesaurus_lockdown.sql
[ -f "$CORE" ] && [ -f "$RPC" ] && [ -f "$LOCK" ] || fail "missing $CORE, $RPC or $LOCK"
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
grep -A1 'create policy members_update_companies' "$CORE" | grep -q 'using (not is_demo' || fail "demo company row not locked (AC-32, R-31)"
for w in pg_advisory_xact_lock ALREADY_DECIDED STALE_PERIOD FINAL_DECISION NOT_ESCALATED 'security_invoker = true'; do
  grep -q "$w" "$RPC" || fail "RPC file lacks $w"; done
# AC-68/R-32: members cannot write the decision record; AC-69/R-33: PAGAR only inside the rules
lock=$(sed 's/--.*$//' "$LOCK")
for w in 'revoke insert on public.decisions, public.approval_tokens, public.approval_uses, public.agent_runs from public, anon, authenticated;' \
  'revoke execute on function public.insert_decision(uuid, numeric, jsonb, int) from public, anon, authenticated;' \
  'grant execute on function public.insert_decision(uuid, numeric, jsonb, int) to service_role;' \
  'create or replace function public.decisions_guard()' PAGAR_OUTSIDE_RULES \
  umbral_aprobacion beneficiario_permitido beneficiario_cuenta acuerdo duplicado_probable vencimiento periodo lectura; do
  echo "$lock" | grep -qF "$w" || fail "lockdown migration lacks: $w (AC-68, AC-69)"; done

# Task 25 (AC-83..AC-86; AC-07, AC-68 Clarified; R-90): the portal migration's new tables are locked to the service role
PORTAL=supabase/migrations/20261017000800_portal.sql
[ -f "$PORTAL" ] || fail "missing $PORTAL"
portal=$(sed 's/--.*$//' "$PORTAL")
for t in portal_status_tokens intake_rate_limits; do
  echo "$portal" | grep -q "alter table public\.$t enable row level security" || fail "RLS not on for $t (AC-07)"; done
echo "$portal" | grep -qi 'create policy' && fail "a member policy in the portal migration (AC-68 Clarified)"

# ---- Part 2: execute against a real Postgres ----
INITDB=$(command -v initdb || ls /usr/lib/postgresql/*/bin/initdb 2>/dev/null | sort -V | tail -1)
[ -x "$INITDB" ] || { echo "schema.test: greps passed; no local Postgres, SQL not executed"; exit 0; }
B=$(dirname "$INITDB"); D=$(mktemp -d); chmod 777 "$D"
pg(){ if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }   # postgres refuses to run as root
trap 'pg "$B/pg_ctl" -D "$D/db" -m immediate stop >/dev/null 2>&1; rm -rf "$D"' EXIT
pg "$B/initdb" -D "$D/db" -U postgres -A trust >/dev/null 2>&1 || fail "initdb"
pg "$B/pg_ctl" -D "$D/db" -o "-c listen_addresses='' -k $D" -w start >/dev/null 2>&1 || fail "pg_ctl start"
sql(){ "$B/psql" -h "$D" -U postgres -d postgres -X -q -A -t -v ON_ERROR_STOP=1 "$@" 2>&1; }
as(){ if [ "$1" = svc ]; then printf "set role service_role;\n%s\n" "$2"   # the Worker's record.ts / cron / link path
  else printf "set role authenticated;\nset request.jwt.claim.sub = '%s';\n%s\n" "$1" "$2"; fi | sql -f -; }
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
expect "$UA" "insert into public.invoices (id, company_id, source, fields) select ('${I}' || n)::uuid, '$CA', 'chat', '{\"payee_name\":\"Laura\"}' from generate_series(1, 6) n; select count(*) from public.invoice_current where id::text like 'a0000000-%'" '^6$' "A inserts and reads own invoices"
expect "$UB" "select count(*) from public.invoice_current where company_id = '$CA'" '^0$' "B sees A's invoices (AC-04)"
expect "$UA" "update public.invoices set expected_outcome = 'PAGAR' where id = '${I}1'" 'permission denied' "expected_outcome updatable (AC-06)"
expect "$UA" "update public.invoices set archived = false where id = '${I}1' returning archived" '^f$' "archived not updatable (AC-06)"
dec(){ printf "select seq from public.insert_decision('%s', %s, '%s', %s)" "$1" "$2" "$3" "$4"; }
ESC='{"outcome":"ESCALAR","actor":"agent","amount_usd":100,"checks":[],"question_es":"¿La pago?","question_en":"Pay it?"}'
OK=$(printf '{"id":"c%s","verdict":"cumple"},' $(seq 1 13)); OK="[${OK%,}]"          # 13 checks, all cumple
PAY='{"outcome":"PAGAR","actor":"agent","amount_usd":100,"checks":'$OK'}'
HUM='{"outcome":"PAGAR","actor":"human","actor_email":"juan.perez@andina.co","channel":"dashboard","amount_usd":100,"checks":'$OK'}'
expect svc "$(dec "${I}1" 0 "$ESC" 0)" '^1$' "first decision gets seq 1"
expect svc "$(dec "${I}1" 0 "$ESC" 0)" 'ALREADY_DECIDED' "racing first decision (R-25)"
expect svc "$(dec "${I}2" 0 "$PAY" 0)" 'STALE_PERIOD' "stale committed amount (AC-24)"
expect svc "$(dec "${I}2" 100 "$PAY" 0)" '^1$' "fresh committed amount passes"
expect svc "$(dec "${I}2" 100 "$PAY" 1)" 'FINAL_DECISION' "decision after PAGAR (AC-25)"
expect svc "$(dec "${I}3" 200 "$HUM" 0)" 'NOT_ESCALATED' "human answer on a pending invoice (R-03)"
expect svc "$(dec "${I}1" 100 "$HUM" 1)" '^2$' "human answer on ESCALAR, committed excludes itself"
expect svc "$(dec "${I}1" 100 "$HUM" 2)" 'FINAL_DECISION' "second human answer (AC-37)"
expect svc "insert into public.decisions (company_id, invoice_id, seq, outcome, actor) values ('$CA', '${I}2', 9, 'PAGAR', 'agent')" 'FINAL_DECISION' "direct insert bypasses the RPC (AC-25)"
expect svc "$(dec "${I}3" 200 "$PAY" 0)" '^1$' "pending invoice decided"
expect svc "$(dec "${I}4" 300 '{"outcome":"FRENAR","actor":"agent","question_es":"x","checks":[]}' 0)" 'check constraint' "question on non-ESCALAR (R-28)"
expect "$UA" "update public.decisions set outcome = 'FRENAR' returning id" '^$' "decisions updatable (AC-05)"
expect "$UA" "select count(*) from public.decisions where outcome = 'PAGAR'" '^3$' "decisions changed by update (AC-05)"
expect "$UB" "$(dec "${I}4" 0 "$PAY" 0)" 'permission denied' "B decides A's invoice (AC-04, AC-68)"
expect "$UA" "select public.period_state('$CA', current_date)" '"paid_usd": 300' "period_state paid"
expect "$UA" "select public.period_state('$CA', current_date, '${I}3') ->> 'committed_usd'" '^200(\.00)?$' "period_state exclude"
expect "$UA" "select public.period_state('$CA', current_date) -> 'by_beneficiary' -> 0 ->> 'beneficiary'" '^Laura$' "by_beneficiary"
expect "$UB" "select public.period_state('$CA', current_date) ->> 'committed_usd'" '^0$' "B reads A's period (AC-04)"
# AC-24: a concurrent decision waits for the company lock, then sees the committed amount and gets STALE_PERIOD
as svc "begin; $(dec "${I}4" 300 "$PAY" 0); select pg_sleep(1.5); commit;" >"$D/s1" &
sleep 0.5; expect svc "$(dec "${I}5" 300 "$PAY" 0)" 'STALE_PERIOD' "concurrent decision ignored the lock (AC-24)"
wait; grep -q '^1$' "$D/s1" || fail "locked session did not commit: $(cat "$D/s1")"
# AC-69/R-33 through the service role (committed is 400 here; amount 0 keeps it there). Error order is unchanged.
one(){ printf '%s' "${OK%\]}" | sed "s/{\"id\":\"c13\",\"verdict\":\"cumple\"}$/$1]/"; }   # 12 cumple + $1
NC='{"id":"c13","verdict":"no_cumple"}'
OV(){ printf '{"id":"%s","verdict":"no_cumple","overridden":{"by":"juan.perez@andina.co","channel":"dashboard"}}' "$1"; }
AG(){ printf '{"outcome":"PAGAR","actor":"agent","amount_usd":0,"checks":%s}' "$1"; }
HU(){ printf '{"outcome":"PAGAR","actor":"human","actor_email":"juan.perez@andina.co","channel":"dashboard","amount_usd":0,"checks":%s}' "$1"; }
expect svc "$(dec "${I}6" 400 "$(AG "$(one "$NC")")" 0)" 'PAGAR_OUTSIDE_RULES' "agent PAGAR with a no_cumple check (AC-69a)"
expect svc "$(dec "${I}6" 400 "$(AG '[]')" 0)" 'PAGAR_OUTSIDE_RULES' "agent PAGAR with no checks (AC-69d)"
expect svc "$(dec "${I}6" 400 "$(AG "$(one "$(OV acuerdo)")")" 0)" 'PAGAR_OUTSIDE_RULES' "agent PAGAR with an override (AC-69)"
expect svc "$(dec "${I}5" 400 "$(AG "$OK")" 0)" '^1$' "agent PAGAR with 13 cumple (AC-69)"
expect svc "$(dec "${I}6" 400 '{"outcome":"ESCALAR","actor":"agent","amount_usd":0,"checks":['"$NC"']}' 0)" '^1$' "ESCALAR unaffected (AC-69)"
expect svc "$(dec "${I}6" 400 "$(HU "$(one "$(OV limite_pago)")")" 1)" 'PAGAR_OUTSIDE_RULES' "human overrides limite_pago (AC-69b)"
expect svc "$(dec "${I}6" 400 "$(HU "$(one "$NC")")" 1)" 'PAGAR_OUTSIDE_RULES' "human PAGAR, no_cumple not overridden (AC-69)"
expect svc "$(dec "${I}6" 400 "$(HU "$(one "$(OV umbral_aprobacion)")")" 1)" '^2$' "human overrides umbral_aprobacion (AC-69c)"
# AC-68/R-32: a member JWT writes none of the four record tables, directly or through the RPC; other writes still work
expect "$UA" "$(dec "${I}5" 400 "$PAY" 1)" 'permission denied' "member executes insert_decision (AC-68)"
expect "$UA" "insert into public.decisions (company_id, invoice_id, seq, outcome, actor, checks) values ('$CA', '${I}5', 2, 'PAGAR', 'agent', '$OK')" 'permission denied' "member inserts a decision (AC-68)"
expect "$UA" "insert into public.policies (company_id, version, name, rules) values ('$CA', 2, 'p', '{}'); insert into public.beneficiaries (company_id, name) values ('$CA', 'Laura'); select 1" '^1$' "member insert on policies/beneficiaries (AC-68)"
# AC-05/AC-63/AC-08/R-03
sql -c "select count(*) from pg_policies where schemaname = 'public' and cmd in ('DELETE', 'ALL')" | grep -q '^0$' || fail "delete-capable policy (D10)"
D1=$(sql -c "select id from public.decisions where invoice_id = '${I}1' and seq = 1")
expect "$UA" "insert into public.approval_tokens (token_hash, company_id, invoice_id, decision_id, expires_at, email_sent, sent_to) values ('hx', '$CA', '${I}1', '$D1', now(), true, 'x@y.co')" 'permission denied' "member inserts approval_tokens (AC-68)"
expect "$UA" "insert into public.approval_uses (token_hash, company_id, decision_id) values ('hx', '$CA', '$D1')" 'permission denied' "member inserts approval_uses (AC-68)"
expect svc "insert into public.approval_tokens (token_hash, company_id, invoice_id, decision_id, expires_at, email_sent, sent_to) values ('h1', '$CA', '${I}1', '$D1', now(), true, 'x@y.co'), ('h2', '$CA', '${I}1', '$D1', now(), true, 'x@y.co'); insert into public.approval_uses (token_hash, company_id, decision_id) values ('h1', '$CA', '$D1'); select 1" '^1$' "tokens and first use"
expect svc "insert into public.approval_uses (token_hash, company_id, decision_id) values ('h2', '$CA', '$D1')" 'duplicate key' "second link of the pair (R-03)"
expect "$UB" "select count(*) from public.approval_tokens" '^0$' "B reads A's tokens (AC-04)"
sql -c "insert into public.agent_runs (company_id, trigger) values (null, 'cron'), ('$CB', 'manual')" >/dev/null || fail "service insert agent_runs"
as svc "insert into public.agent_runs (company_id, trigger, decided) values ('$CA', 'manual', '{}')" >/dev/null || fail "service insert own run"
expect "$UA" "select count(*) from public.agent_runs" '^2$' "A sees own run and cron tick, not B's (AC-63)"
expect "$UA" "insert into public.agent_runs (company_id, trigger) values (null, 'cron')" 'permission denied' "member writes a cron tick (AC-63, AC-68)"
expect "$UA" "insert into public.agent_runs (company_id, trigger) values ('$CA', 'manual')" 'permission denied' "member writes a run (AC-68)"
sql -c "insert into storage.objects (bucket_id, name) values ('files', '$CA/x.pdf'), ('files', '$CB/y.pdf')" >/dev/null || fail "objects"
expect "$UA" "select string_agg(name, ',') from storage.objects" "^$CA/x.pdf$" "A reads B's file (AC-08)"
expect "$UA" "insert into storage.objects (bucket_id, name) values ('files', '$CB/z.pdf')" 'row-level security' "A writes into B's folder (AC-08)"
expect "$UA" "select public.seed_company('$CA')" 'permission denied' "members can call seed_company"
# AC-32/R-31: the demo company row is read-only to members; a non-demo member still edits all three; nobody flips is_demo
sql -c "update public.companies set is_demo = true where id = '$CB'" >/dev/null || fail "mark B's company demo"
for c in "name = 'X'" "approver_email = 'x@example.com'" "lang = 'en'"; do
  as "$UB" "update public.companies set $c where id = '$CB'" >/dev/null; done
expect "$UB" "select name || '|' || approver_email || '|' || lang from public.companies" '^otra\|otra@b.co\|es$' "demo member changed the demo row (AC-32, R-31)"
expect "$UA" "update public.companies set name = 'Andina', approver_email = 'a@b.co', lang = 'en' where id = '$CA' returning name || '|' || approver_email || '|' || lang" '^Andina\|a@b.co\|en$' "non-demo member cannot edit its company (AC-32)"
expect "$UA" "update public.companies set is_demo = true where id = '$CA'" 'permission denied' "member flips is_demo (R-15, R-31)"
# R-69/R-70 (AC-06, AC-20, AC-23, AC-47): a member archives only a pending invoice, never un-archives, and cannot write
# expected_outcome, received_at or archived on insert. insert_decision refuses an archived invoice (ARCHIVED) under the lock.
V=$'\\set VERBOSITY verbose\n'   # psql prints the SQLSTATE: "ERROR:  42501: <message>"
NOARC='Solo se puede archivar una factura pendiente; una factura con decisión queda en el registro. Para retirar una factura escalada, recházala.'
NOARC_EN='Only a pending invoice can be archived; a decided invoice stays on the record. To withdraw an escalated invoice, reject it.'
refused(){ out=$(as "$UA" "${V}update public.invoices set archived = $2 where id = '$1'")
  echo "$out" | grep -qF "42501: $3" && echo "$out" | grep -qF "HINT:  $4" || fail "$5 (got: $out)"
  is_arch=$(sql -c "select archived from public.invoices where id = '$1'"); [ "$is_arch" = "$([ "$2" = true ] && echo f || echo t)" ] || fail "$5: row changed"; }
inv(){ as "$UA" "insert into public.invoices (company_id, source, fields) values ('$CA', 'chat', '$1') returning id"; }
cur(){ printf "(select (public.period_state('%s', current_date) ->> 'committed_usd')::numeric)" "$CA"; }   # committed now
FRE='{"outcome":"FRENAR","actor":"agent","checks":[]}'
expect "$UA" "insert into public.invoices (company_id, source, expected_outcome, received_at, archived) values ('$CA', 'chat', 'FRENAR', '2026-01-01', true) returning coalesce(expected_outcome, 'null') || '|' || archived || '|' || (abs(extract(epoch from received_at - now())) < 60)" '^null\|false\|true$' "member insert keeps expected_outcome/received_at/archived (R-70)"
expect svc "insert into public.invoices (company_id, source, expected_outcome, received_at) values ('$CA', 'chat', 'FRENAR', '2026-01-01') returning expected_outcome || '|' || received_at::date" '^FRENAR\|2026-01-01$' "service role insert lost its values (R-70)"
NS=$(inv '{"invoice_number":"NS-2219","payee_name":"Nube Sur LLC"}')
expect svc "$(dec "$NS" "$(cur)" "$PAY" 0)" '^1$' "NS-2219 paid"
refused "$NS" true "$NOARC" "$NOARC_EN" "member archives the paid NS-2219 (QA repro, R-69)"
expect "$UA" "select count(*) from public.invoice_current where id = '$NS'" '^1$' "NS-2219 left the record (R-69)"
ES=$(inv '{}'); expect svc "$(dec "$ES" "$(cur)" "$ESC" 0)" '^1$' "escalated"
refused "$ES" true "$NOARC" "$NOARC_EN" "member archives an ESCALAR (R-69)"
FR=$(inv '{}'); expect svc "$(dec "$FR" "$(cur)" "$FRE" 0)" '^1$' "stopped"
refused "$FR" true "$NOARC" "$NOARC_EN" "member archives a FRENAR (R-69)"
P=$(inv '{}')
expect "$UA" "update public.invoices set archived = true where id = '$P' returning archived" '^t$' "member archives a pending invoice (R-69)"
refused "$P" false 'Una factura archivada no se puede restaurar.' 'An archived invoice cannot be restored.' "member un-archives (R-69)"
expect svc "$(dec "$P" 0 "$PAY" 0)" 'ARCHIVED' "insert_decision on an archived invoice (R-69)"
expect svc "$(dec "$P" 0 "$PAY" 7)" 'ARCHIVED' "ARCHIVED before ALREADY_DECIDED (R-69)"
expect svc "$(dec 00000000-0000-4000-8000-000000000000 0 "$PAY" 0)" 'INVOICE_NOT_FOUND' "INVOICE_NOT_FOUND first"
expect svc "update public.invoices set archived = true where id in ('$NS', '$ES', '$FR') returning archived" '^t' "service role archives decided invoices (R-69)"
expect svc "update public.invoices set archived = false where id = '$P' returning archived" '^f$' "service role un-archives (R-69)"
# The archive waits for a decision being written, then sees it and refuses: no PAGAR hides behind an archive (R-69)
Q=$(inv '{}')
as svc "begin; $(dec "$Q" "$(cur)" "$FRE" 0); select pg_sleep(1.5); commit;" >"$D/s2" &
sleep 0.5; refused "$Q" true "$NOARC" "$NOARC_EN" "archive did not wait for the company lock (R-69)"
wait; grep -q '^1$' "$D/s2" || fail "decision session did not commit: $(cat "$D/s2")"
# A decision waits for an archive in flight, then re-reads the invoice and refuses it (R-69)
R=$(inv '{}')
as "$UA" "begin; update public.invoices set archived = true where id = '$R'; select pg_sleep(1.5); commit;" >"$D/s3" &
sleep 0.5; expect svc "$(dec "$R" "$(cur)" "$FRE" 0)" 'ARCHIVED' "insert_decision ignored an archive in flight (R-69)"
wait; expect "$UA" "select archived from public.invoices where id = '$R'" '^t$' "archive session did not commit: $(cat "$D/s3")"
# Task 25 (AC-83..AC-86; AC-63, AC-68 Clarified; R-90): channel columns, the locked slug, status tokens and intake counters
expect "$UA" "select portal_slug from public.companies" '^p-[0-9a-f]{12}$' "random portal slug default (AC-86, R-90)"
[ "$(sql -c "select count(distinct portal_slug) = count(*) from public.companies")" = t ] || fail "portal slugs not unique"
expect "$UA" "update public.companies set portal_slug = 'x' where id = '$CA'" 'permission denied' "member edits portal_slug (AC-68 Clarified)"
expect "$UA" "insert into public.invoices (company_id, source, origin, sender, sender_note) values ('$CA', 'chat', 'portal', 'a@b.co', 'hola') returning origin || '|' || coalesce(sender, 'null') || '|' || coalesce(sender_note, 'null')" '^app\|null\|null$' "member insert not forced to origin app (AC-68 Clarified)"
expect svc "insert into public.invoices (company_id, source, origin, sender_note) values ('$CA', 'pdf', 'portal', 'hola') returning origin || '|' || sender_note" '^portal\|hola$' "service role lost origin portal"
expect svc "insert into public.invoices (company_id, source, origin) values ('$CA', 'chat', 'fax')" 'check constraint' "origin outside app/portal/email"
expect svc "insert into public.invoices (company_id, source, origin, sender_note) values ('$CA', 'pdf', 'portal', repeat('x', 2001))" 'check constraint' "sender_note over 2.000 characters (AC-83)"
expect "$UA" "select count(*) from public.invoice_current where origin = 'portal'" '^1$' "invoice_current lacks origin (AC-86)"
expect svc "insert into public.agent_runs (company_id, trigger, via) values ('$CA', 'ingest', 'portal') returning via" '^portal$' "run via portal (AC-63 Clarified)"
expect svc "insert into public.agent_runs (company_id, trigger, via) values ('$CA', 'ingest', 'fax')" 'check constraint' "via outside portal/email"
for t in portal_status_tokens intake_rate_limits; do
  expect "$UA" "select count(*) from public.$t" 'permission denied' "member reads $t (AC-84, AC-85)"; done
expect "$UA" "insert into public.portal_status_tokens (token_hash, company_id, invoice_id) select 'h', '$CA', id from public.invoices limit 1" 'permission denied' "member writes a status token (AC-68 Clarified)"
expect "$UA" "select public.intake_hit('invoice', '1.2.3.4', '$CA')" 'permission denied' "member executes intake_hit (AC-85)"
printf "set role anon;\nselect public.intake_hit('invoice', '1.2.3.4', '%s');\n" "$CA" | sql -f - | grep -q 'permission denied' || fail "anon executes intake_hit (AC-85)"
expect svc "select string_agg(coalesce(public.intake_hit('invoice', '9.9.9.9', '$CA'), 'ok'), ',') from generate_series(1, 11)" '^(ok,){10}ip$' "11th invoice in an hour from one IP (AC-85)"
expect svc "select coalesce(public.intake_hit('invoice', '8.8.8.8', '$CA'), 'ok')" '^ok$' "another IP is limited by the first"
expect svc "select string_agg(coalesce(public.intake_hit('invoice', 'ip-' || n, '$CB'), 'ok'), ',') from generate_series(1, 101) n" '^(ok,){100}company$' "101st invoice of a company in a UTC day (AC-85)"
expect svc "select string_agg(coalesce(public.intake_hit('status', '9.9.9.9', null), 'ok'), ',') from generate_series(1, 61)" '^(ok,){60}status$' "61st status view in a minute (AC-85)"
expect svc "select coalesce(public.intake_hit('email', null, '$CA'), 'ok')" 'INVALID_KIND' "unknown kind"
[ "$(sql -c "select count(*) from public.intake_rate_limits where key like '%9.9.9.9%'")" = 0 ] || fail "raw IP stored in intake_rate_limits"
echo "schema.test: greps and live Postgres checks passed"
