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
# AC-73, AC-68 Clarified (R-85.5): fx_rates is RLS-on, members read it, no member write policy or privilege exists
FX=supabase/migrations/20261017000600_fx_rates.sql
[ -f "$FX" ] || fail "missing $FX"
fx=$(sed 's/--.*$//' "$FX")
echo "$fx" | grep -q 'create table public.fx_rates (' || fail "no create table public.fx_rates (AC-73)"
[ "$(echo "$fx" | grep -c 'alter table public.fx_rates enable row level security')" = 1 ] || fail "RLS not enabled once on fx_rates (AC-73)"
echo "$fx" | grep -q 'primary key (day, currency)' || fail "fx_rates key is not (day, currency) (AC-73)"
echo "$fx" | grep -q 'create policy members_select_fx_rates on public.fx_rates for select to authenticated' || fail "no member read policy on fx_rates (AC-73)"
echo "$fx" | grep -qiE 'on public\.fx_rates for (insert|update|all)' && fail "a member write policy on fx_rates (AC-68, R-85.5)"
echo "$fx" | grep -q 'revoke all on public.fx_rates from public, anon, authenticated;' || fail "fx_rates privileges not revoked from members (AC-68)"
# AC-67/AC-68 Clarified (R-87): the question quota, one table with RLS on and no member policy, one service-role function
AI=supabase/migrations/20261017000700_ai_usage.sql
[ -f "$AI" ] || fail "missing $AI"
ai=$(sed 's/--.*$//' "$AI")
for w in 'create table public.ai_usage (' 'primary key (day, key)' 'alter table public.ai_usage enable row level security;' \
  'revoke all on public.ai_usage from public, anon, authenticated;' 'security definer' \
  'revoke execute on function public.take_question(text) from public, anon, authenticated;' \
  'grant execute on function public.take_question(text) to service_role;'; do
  echo "$ai" | grep -qF "$w" || fail "ai_usage migration lacks: $w (AC-67, AC-68)"; done
echo "$ai" | grep -qi 'create policy' && fail "a member policy on ai_usage (AC-68)"

# Task 25 (AC-83..AC-86; AC-07, AC-68 Clarified; R-90): the portal migration's new tables are locked to the service role
PORTAL=supabase/migrations/20261017000800_portal.sql
[ -f "$PORTAL" ] || fail "missing $PORTAL"
portal=$(sed 's/--.*$//' "$PORTAL")
for t in portal_status_tokens intake_rate_limits; do
  echo "$portal" | grep -q "alter table public\.$t enable row level security" || fail "RLS not on for $t (AC-07)"; done
echo "$portal" | grep -qi 'create policy' && fail "a member policy in the portal migration (AC-68 Clarified)"

# Task 39 (AC-92, AC-93, AC-96; R-115, R-117): the trial flag, its sequence, the trigger; anonymous users are never deleted
TRIAL=supabase/migrations/20261017000900_trial_access.sql
[ -f "$TRIAL" ] || fail "missing $TRIAL"
trial=$(sed 's/--.*$//' "$TRIAL")
for w in 'add column is_trial boolean not null default false' 'create sequence public.trial_company_seq' \
  'create or replace function public.handle_new_user()' 'Empresa de prueba '; do
  echo "$trial" | grep -qF "$w" || fail "trial migration lacks: $w (AC-92)"; done
echo "$trial" | grep -qiE 'grant update[^;]*is_trial' && fail "is_trial in a member update grant (AC-93)"
U='User'   # split so this file does not match its own search
grep -rnIE "delete$U|delete[[:space:]]+from[[:space:]]+auth\.users" supabase scripts src web e2e portal 2>/dev/null && fail "an Auth user deletion exists (AC-96, CLAUDE.md)"

# Task 42 (AC-98, R-122): one read function per screen; none is security definer
SCREEN=supabase/migrations/20261017001000_screen_functions.sql
[ -f "$SCREEN" ] || fail "missing $SCREEN"
screen=$(sed 's/--.*$//' "$SCREEN")
echo "$screen" | grep -qi 'security definer' && fail "a screen function is security definer (AC-98, R-122)"
for f in screen_company screen_inbox screen_period screen_beneficiaries screen_policy screen_detail screen_demo_overview; do
  echo "$screen" | grep -q "create function public\.$f(" || fail "no function public.$f (AC-98)"; done

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
create table auth.users (id uuid primary key, email text, is_anonymous boolean not null default false);
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
# AC-73, AC-68 Clarified: members read fx_rates and fx_latest, write neither; only the service role upserts
FXROW="('2026-10-16', 'COP', 0.0003, 'Yahoo Finance', '2026-10-16T11:00:00Z'), ('2026-10-17', 'COP', 0.00031538976, 'Yahoo Finance', '2026-10-17T11:00:00Z')"
expect svc "insert into public.fx_rates (day, currency, usd_per_unit, source, fetched_at) values $FXROW; select count(*) from public.fx_rates" '^2$' "service role writes fx_rates (record.ts)"
expect svc "insert into public.fx_rates values ('2026-10-17', 'COP', 0.000315, 'open.er-api.com', now()) on conflict (day, currency) do update set usd_per_unit = excluded.usd_per_unit, source = excluded.source returning source" '^open.er-api.com$' "service role upserts by (day, currency) (AC-73)"
expect "$UA" "select day || '|' || currency || '|' || usd_per_unit || '|' || source from public.fx_latest" '^2026-10-17\|COP\|0.000315\|open.er-api.com$' "member reads the newest rate per currency (AC-73)"
expect "$UA" "select count(*) from public.fx_rates" '^2$' "member reads fx_rates (AC-73)"
expect "$UA" "insert into public.fx_rates values ('2026-10-18', 'COP', 1, 'x', now())" 'permission denied' "member inserts fx_rates (AC-68)"
expect "$UA" "update public.fx_rates set usd_per_unit = 1" 'permission denied' "member updates fx_rates (AC-68)"
expect "$UA" "insert into public.fx_latest values ('2026-10-18', 'COP', 1, 'x', now())" 'permission denied|cannot insert' "member inserts through fx_latest (AC-68)"
expect 33333333-3333-4333-8333-333333333333 "select count(*) from public.fx_latest" '^0$' "a signed-in non-member reads fx rates (AC-73)"
out=$(printf "set role anon;\nselect count(*) from public.fx_rates;\n" | sql -f -); echo "$out" | grep -q 'permission denied' || fail "anon reads fx_rates (got: $out)"
expect svc "insert into public.fx_rates values ('2026-10-18', 'COP', 0, 'x', now())" 'check constraint' "a rate <= 0 is refused (R-85)"
is_rows=$(sql -c "select count(*) from public.fx_rates"); [ "$is_rows" = 2 ] || fail "member writes changed fx_rates (got $is_rows rows)"
# AC-67 (R-87): 10 questions per key and UTC day, 500 for the deployment, counted before the model call; members cannot count
take(){ as svc "select public.take_question('$1')"; }
expect "$UA" "select public.take_question('u:x')" 'permission denied' "member executes take_question (AC-68)"
expect "$UA" "insert into public.ai_usage values (current_date, 'global', 0)" 'permission denied' "member writes ai_usage (AC-68)"
expect "$UA" "select count(*) from public.ai_usage" 'permission denied' "member reads ai_usage (AC-68)"
printf "set role anon;\nselect public.take_question('u:x');\n" | sql -f - | grep -q 'permission denied' || fail "anon executes take_question (AC-68)"
got=$(for i in $(seq 1 11); do take u:a; done | tr '\n' ' ')
[ "$got" = '{"remaining": 9} {"remaining": 8} {"remaining": 7} {"remaining": 6} {"remaining": 5} {"remaining": 4} {"remaining": 3} {"remaining": 2} {"remaining": 1} {"remaining": 0} {"reason": "user_cap"} ' ] || fail "10 per user then user_cap (got: $got)"
[ "$(take u:b)" = '{"remaining": 9}' ] || fail "a second key is counted apart"
expect svc "select n from public.ai_usage where key = 'global' and day = (now() at time zone 'utc')::date" '^11$' "global counts every taken question, not user_cap ones"
expect svc "select public.take_question('global')" 'BAD_KEY' "a caller key may not be the global row"
sql -c "update public.ai_usage set n = 500 where key = 'global'" >/dev/null || fail "fill the global cap"
[ "$(take u:c)" = '{"reason": "ai_quota"}' ] || fail "the 501st question of the day is ai_quota"
expect svc "select count(*) from public.ai_usage where key = 'u:c'" '^0$' "an ai_quota question still counted for its user"
expect svc "select n from public.ai_usage where key = 'global'" '^500$' "global went past 500"
sql -c "insert into public.ai_usage values ((now() at time zone 'utc')::date - 1, 'u:d', 10)" >/dev/null
sql -c "update public.ai_usage set n = 0 where key = 'global'" >/dev/null
[ "$(take u:d)" = '{"remaining": 9}' ] || fail "yesterday's count carried into today (UTC day)"
# AC-92, AC-93, R-115: an anonymous user gets its own trial company «Empresa de prueba <n>», seeded, never mailed; members
# cannot flip is_trial. AC-96, R-117: ingest keys count 30 per UTC day apart from the question caps.
T1=44444444-4444-4444-8444-444444444444 T2=55555555-5555-4555-8555-555555555555
sql -c "insert into auth.users (id, is_anonymous) values ('$T1', true), ('$T2', true)" >/dev/null || fail "anonymous signup"
expect "$T1" "select name || '|' || is_trial || '|' || coalesce(approver_email, 'null') from public.companies" '^Empresa de prueba [0-9]+\|true\|null$' "anonymous company (AC-92)"
expect "$T1" "select count(*) from public.beneficiaries" '^8$' "trial company seeded with the 8 beneficiaries (AC-92)"
expect "$T1" "select count(*) > 0 from public.invoices" '^t$' "trial company seeded with the invoices (AC-92)"
n1=$(as "$T1" "select name from public.companies"); n2=$(as "$T2" "select name from public.companies")
[ "$n1" != "$n2" ] || fail "two trials share a name: $n1"
[ "$(sql -c "select count(distinct company_id) from public.company_members where user_id in ('$T1', '$T2')")" = 2 ] || fail "two trials share a company (AC-93)"
expect "$UA" "select is_trial from public.companies" '^f$' "an email signup became a trial (AC-03)"
expect "$T1" "update public.companies set is_trial = false" 'permission denied' "member flips is_trial (AC-93)"
expect "$T1" "update public.companies set name = 'Mía' returning name" '^Mía$' "trial member cannot rename its company"
expect "$T1" "select nextval('public.trial_company_seq')" 'permission denied' "member draws from trial_company_seq"
got=$(for i in $(seq 1 31); do take "qa:ingest:t39"; done | tail -2 | tr '\n' ' ')
[ "$got" = '{"remaining": 0} {"reason": "user_cap"} ' ] || fail "30 ingests then user_cap (got: $got) (AC-96)"
[ "$(take "ingest:$T1")" = '{"remaining": 29}' ] || fail "ingest:<user id> key not counted apart (AC-96)"
expect svc "select n from public.ai_usage where key = 'global' and day = (now() at time zone 'utc')::date" '^1$' "ingests counted on the question cap (AC-96)"
expect svc "select public.take_question('ingest')" 'BAD_KEY' "a bare ingest key"
# AC-98, R-122: every screen_* function is security invoker, stable (read-only), executable by authenticated only; each
# finds the company from auth.uid()'s membership, so RLS and the member's own company decide every row
scr="pronamespace = 'public'::regnamespace and proname like 'screen\\_%'"
[ "$(sql -c "select count(*) from pg_proc where $scr")" = 7 ] || fail "expected 7 screen_* functions (AC-98)"
bad=$(sql -c "select string_agg(proname, ',') from pg_proc where $scr and (prosecdef or provolatile <> 's' or has_function_privilege('anon', oid, 'execute')
  or has_function_privilege('service_role', oid, 'execute') or not has_function_privilege('authenticated', oid, 'execute'))")
[ -z "$bad" ] || fail "not security invoker, stable and authenticated-only: $bad (AC-98, R-122)"
out=$(printf "set role anon;\nselect public.screen_inbox('es');\n" | sql -f -); echo "$out" | grep -q 'permission denied' || fail "anon executes screen_inbox (got: $out)"
expect "$UA" "select count(*) from jsonb_array_elements(public.screen_inbox('es') -> 'invoices') e where e ->> 'company_id' = '$CA'" "^$(as "$UA" "select count(*) from public.invoice_current where company_id = '$CA'")$" "screen_inbox misses A's invoices (AC-98)"
expect "$UA" "select count(*) from jsonb_array_elements(public.screen_inbox('es') -> 'invoices') e where e ->> 'company_id' <> '$CA'" '^0$' "screen_inbox shows another company's rows (AC-98)"
expect "$UB" "select count(*) from jsonb_array_elements(public.screen_inbox('es') -> 'invoices') e where e ->> 'company_id' = '$CA'" '^0$' "B's screen_inbox shows A's rows (AC-04, AC-98)"
expect "$UA" "select (public.screen_inbox('en') -> 'invoices' -> 0) ? 'headline'" '^t$' "screen_inbox rows lack the headline (AC-98)"
expect "$UA" "select public.screen_inbox('es') ->> 'portal_slug' = portal_slug from public.companies where id = '$CA'" '^t$' "screen_inbox portal_slug (AC-98)"
expect "$UA" "select (public.screen_inbox('es') -> 'last_run' ->> 'at')::timestamptz = max(created_at) from public.agent_runs" '^t$' "screen_inbox last_run is not A's or the cron's newest (AC-63, AC-98)"
expect "$UA" "select public.screen_detail('${I}1') -> 'invoice' ->> 'id'" "^${I}1$" "screen_detail of an own invoice (AC-98)"
expect "$UA" "select jsonb_array_length(public.screen_detail('${I}1') -> 'decisions')" '^2$' "screen_detail decisions (AC-98)"
expect "$UB" "select public.screen_detail('${I}1') is null" '^t$' "B reads A's detail (AC-04, AC-98)"
expect "$UA" "select jsonb_array_length(public.screen_period() -> 'current') = (select count(*) from public.invoice_current where company_id = '$CA')" '^t$' "screen_period rows (AC-98)"
expect "$UA" "select count(*) from jsonb_array_elements(public.screen_period() -> 'decisions') e where e ->> 'invoice_id' not like 'a0000000-%' and e ->> 'invoice_id' not in (select id::text from public.invoices where company_id = '$CA')" '^0$' "screen_period decisions of another company (AC-98)"
expect "$UA" "select jsonb_array_length(public.screen_beneficiaries() -> 'beneficiaries') = (select count(*) from public.beneficiaries where company_id = '$CA' and not archived)" '^t$' "screen_beneficiaries (AC-98)"
expect "$UA" "select (public.screen_policy() -> 'company' ->> 'id') || '|' || jsonb_array_length(public.screen_policy() -> 'versions')" "^$CA\\|$(as "$UA" "select count(*) from public.policies where company_id = '$CA'")$" "screen_policy (AC-98)"
expect "$UA" "select jsonb_typeof(public.screen_policy() -> 'fx')" '^array$' "screen_policy fx (AC-98)"
expect "$UA" "select public.screen_demo_overview('es') is null" '^t$' "screen_demo_overview answers a non-demo company (AC-45)"
expect "$UB" "select jsonb_array_length(public.screen_demo_overview('es') -> 'invoices') > 0 and public.screen_demo_overview('es') ? 'period'" '^t$' "screen_demo_overview of the demo company (AC-45, AC-98)"
NM=66666666-6666-4666-8666-666666666666   # signed in, member of no company
expect "$NM" "select coalesce(public.screen_inbox('es'), public.screen_period(), public.screen_beneficiaries(), public.screen_policy(), public.screen_detail('${I}1'), public.screen_demo_overview('es')) is null" '^t$' "a non-member reads a screen (AC-98)"
# R-132: screen_inbox's top-level beneficiaries is GET /api/beneficiaries' directory as { id, name }: non-archived, ordered by
# name, the caller's company only (RLS), never null
sql -c "insert into public.beneficiaries (company_id, name, archived) values ('$CA', 'Zz Archivado', true)" >/dev/null || fail "archived beneficiary fixture"
ben="public.screen_inbox('es') -> 'beneficiaries'"
expect "$UA" "select $ben = (select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) order by b.name) from public.beneficiaries b where b.company_id = '$CA' and not b.archived)" '^t$' "screen_inbox beneficiaries are not A's non-archived directory by name (R-132)"
expect "$UA" "select count(*) from jsonb_array_elements($ben) e where e ->> 'name' = 'Zz Archivado' or (select array_agg(k order by k) from jsonb_object_keys(e) k) <> '{id,name}'" '^0$' "screen_inbox beneficiaries carry an archived row or a field beyond id and name (R-132)"
expect "$UA" "select jsonb_array_length($ben) > 1" '^t$' "screen_inbox beneficiaries empty for A (R-132)"
expect "$UB" "select count(*) from jsonb_array_elements($ben) e where (e ->> 'id')::uuid in (select id from public.beneficiaries where company_id = '$CA')" '^0$' "B's screen_inbox shows A's beneficiaries (AC-04, R-132)"
out=$(printf "begin;\nupdate public.beneficiaries set archived = true where company_id = '$CA';\nset role authenticated;\nset request.jwt.claim.sub = '$UA';\nselect $ben;\nrollback;\n" | sql -f -)
[ "$out" = '[]' ] || fail "screen_inbox beneficiaries of a company with no directory is not [] (got: $out) (R-132)"
echo "schema.test: greps and live Postgres checks passed"
