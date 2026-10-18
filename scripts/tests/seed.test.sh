#!/usr/bin/env bash
# Task 3 seed (AC-03, AC-07, AC-09, AC-10, AC-47, R-05, R-07, R-08, R-09; Task 21: AC-75, R-86). Part 1 reads the seed JSON
# of the latest migration that replaces andina_seed (000600: market rates, no pinned rate),
# DATASET.md and the generated documents. Part 2, when a local Postgres exists, applies every migration over the
# Supabase stubs of schema.test.sh, signs up two users, replays the seed through a reference model of PLAN Task 4's
# checks, and runs reset_demo_company twice. Never a delete statement here (CLAUDE.md).
set -u
cd "$(dirname "$0")/../.." || exit 1
fail(){ echo "FAIL: $1"; exit 1; }
SEED3=supabase/migrations/20261017000300_seed_andina.sql MIG=supabase/migrations/20261017000600_fx_rates.sql DS=docs/demo/DATASET.md
[ -f "$SEED3" ] && [ -f "$MIG" ] && [ -f "$DS" ] || fail "missing $SEED3, $MIG or $DS"
code=$(sed 's/--.*$//' "$SEED3" "$MIG")
echo "$code" | grep -qiE '\b(drop|truncate)\b|delete[[:space:]]+from' && fail "destructive SQL in the seed (AC-07)"
grep -q 'create or replace function public.seed_company(p_company uuid)' "$SEED3" || fail "seed_company not replaced"
grep -q 'create or replace function public.andina_seed(p_company uuid, p_reset boolean)' "$MIG" || fail "000600 does not replace andina_seed (AC-75)"
grep -q "publicDir: 'web/public'" vite.config.ts || fail "vite.config.ts must serve web/public, or /demo/invoices/* is not deployed (AC-09, R-40)"

# ---- Part 1: the seed JSON, DATASET.md and the documents agree (R-08) ----
node --input-type=module - "$MIG" "$DS" <<'JS' || exit 1
import { readFileSync, existsSync } from 'node:fs';
const [mig, ds] = process.argv.slice(2);
const die = (m) => { console.log('FAIL: ' + m); process.exit(1); };
const m = readFileSync(mig, 'utf8').match(/\$seed\$([\s\S]*?)\$seed\$/);
if (!m) die('no $seed$ JSON in the migration');
const seed = JSON.parse(m[1]);
const inv = seed.invoices, count = (o) => inv.filter((i) => i.expected_outcome === o).length;
if (inv.length !== 29 || count('PAGAR') !== 15 || count('FRENAR') !== 3 || count('ESCALAR') !== 11)
  die(`expected 29 invoices 15/3/11, got ${inv.length} ${count('PAGAR')}/${count('FRENAR')}/${count('ESCALAR')}`);
if (seed.beneficiaries.length !== 8) die('expected 8 beneficiaries');
const r = seed.rules;
if (r.period_budget_usd !== 42000 || r.account_balance_usd !== 23000) die('R-35: policy v1 budget 42000, balance 23000 (below budget, R-08)');
if (JSON.stringify(r.fx_rates) !== '{}') die('AC-75: the seed policy pins no rate (fx_rates {}), so the demo uses market rates');
const f28 = inv.find((i) => i.nn === '28');
if (f28.fields.amount !== 4950 || f28.fields.currency !== 'USD' || f28.also.join() !== 'umbral_aprobacion') die('R-35, R-86: #28 Forma Studio 4.950 USD, also [umbral_aprobacion]');
const kinds = ['duplicado exacto', 'duplicado con otro número', 'beneficiario nuevo', 'cuenta cambiada', 'sobre el límite por pago',
  'sobre el umbral de aprobación', 'no cuadra con el retainer', 'COP sobre el límite por pago', 'agota el presupuesto del mes',
  'supera el saldo de la cuenta', 'ilegible', 'vencida', 'fuera del periodo'];
for (const k of kinds) if (!inv.some((i) => i.trap === k)) die(`no invoice for trap kind "${k}" (AC-09)`);
for (const s of ['pdf', 'image', 'email', 'chat']) if (!inv.some((i) => i.source === s)) die(`no ${s} invoice`);
for (const c of ['USD', 'COP', 'MXN', 'BRL', 'ARS', 'EUR']) if (!inv.some((i) => i.fields.currency === c)) die(`no ${c} invoice`);
const nube = inv.find((i) => i.fields.payee_name === 'Nube Sur LLC' && i.fields.amount === 4200);
if (!nube || nube.expected_outcome !== 'ESCALAR' || nube.fields.invoice_number !== '2044') die('Nube Sur #2044 4.200 USD ESCALAR missing (R-08, D25)');
const cop = (amt, o) => inv.some((i) => i.fields.currency === 'COP' && i.fields.amount === amt && i.expected_outcome === o);
if (!cop(25000000, 'FRENAR') || !cop(13000000, 'ESCALAR')) die('R-07 COP traps missing');
for (const i of inv) {
  if (!/^\d\d$/.test(i.nn) || !i.reason || !Array.isArray(i.also) || Boolean(i.check) !== (i.expected_outcome !== 'PAGAR')) die(`invoice ${i.nn}: needs nn, reason, also[], and a check iff not PAGAR`);
  if (i.fields.amount !== null && !i.fields.bank_account) die(`invoice ${i.nn} prints no bank account (R-05)`);
  if ((i.source === 'email' || i.source === 'chat') !== Boolean(i.raw_text)) die(`invoice ${i.nn}: raw_text only and always for email/chat`);
  const ext = { pdf: 'pdf', image: 'png' }[i.source];
  if (ext && !existsSync(`web/public/demo/invoices/${i.nn}.${ext}`)) die(`missing web/public/demo/invoices/${i.nn}.${ext} (AC-09)`);
}
// R-96 condition 5: every DATASET.md row is the seed row, column for column, in scripts/gen-invoices.mjs's format.
const money = (n, c) => new Intl.NumberFormat('es-CO', { minimumFractionDigits: c === 'COP' ? 0 : 2, maximumFractionDigits: c === 'COP' ? 0 : 2 }).format(n);
const got = readFileSync(ds, 'utf8').split('\n').filter((l) => /^\| \d\d \|/.test(l)).join('\n');
const want = inv.map((i) => { const f = i.fields, trap = i.check ? `${i.trap} · \`${[i.check, ...i.also].join('`, `')}\`` : i.trap;
  return `| ${i.nn} | ${f.payee_name ?? 'desconocido'} | ${f.amount === null ? 'desconocido' : money(f.amount, f.currency)} | ${f.currency ?? 'desconocida'} | ${i.source} | ${trap} | ${i.expected_outcome} | ${i.reason} |`; }).join('\n');
if (got !== want) die(`DATASET.md rows differ from the seed (R-08, R-96):\n${got}\n---\n${want}`);
const doc = readFileSync(ds, 'utf8');
// R-96 condition 5: the policy line says no pinned rate, and the rates line quotes the fixture rates and their date (AC-75).
if (!doc.includes('sin tasas fijadas por la política (`fx_rates: {}`)')) die('DATASET.md policy line does not say "no pinned rates" (R-96)');
const fix = readFileSync('src/engine/__fixtures__/seed.ts', 'utf8');
const rates = JSON.parse((/FIXTURE_RATES[^=]*= (\{[^}]*\})/.exec(fix)?.[1] ?? '').replace(/(\w+):/g, '"$1":'));
const fxDay = /FX_DAY = '(\d{4})-(\d\d)-(\d\d)'/.exec(fix);
if (!fxDay || Object.keys(rates).join() !== 'COP,MXN,BRL,ARS,EUR') die('cannot read FIXTURE_RATES / FX_DAY from src/engine/__fixtures__/seed.ts');
const per = (c) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 4 }).format(Number((1 / rates[c]).toPrecision(6)));
const line = `tasas del ${Number(fxDay[3])} ${['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][fxDay[2] - 1]} ${fxDay[1]} (1 USD = ${per('COP')} COP, ${per('MXN')} MXN, ${per('BRL')} BRL, ${per('ARS')} ARS y ${per('EUR')} EUR)`;
if (!doc.includes(line)) die(`DATASET.md does not quote the fixture rates and their date: "${line}" (AC-75, R-96)`);
for (const t of ['Rechazar', '#15', 'Aprobar', '#2044', '40.705,36', '22.609,39', '43.205,36']) if (!doc.includes(t)) die(`DATASET.md lacks the R-35 happy path ("${t}")`);
for (const t of ['±20 %', 'Yahoo Finance']) if (!doc.includes(t)) die(`DATASET.md does not explain the market rates ("${t}", AC-75)`);
if (/\b(40|20)\.000\b(?!\.)/.test(doc)) die('DATASET.md still cites the old budget 40.000 or balance 20.000 (R-35)');
JS
echo "seed.test: static checks passed"

# AC-10 / R-08: replay the seeded rows in arrival order through a reference model of PLAN Task 4's checks.
REPLAY=$(cat <<'JS'
import { readFileSync } from 'node:fs';
const seed = JSON.parse(readFileSync(process.argv[1], 'utf8').match(/\$seed\$([\s\S]*?)\$seed\$/)[1]);
const db = JSON.parse(readFileSync(0, 'utf8'));
// AC-75: a pinned rate wins; otherwise the 17 Oct market rate (src/engine/__fixtures__/seed.ts FIXTURE_RATES).
const MARKET = { USD: 1, COP: 0.00031538976, MXN: 0.054115482, BRL: 0.19726589, ARS: 0.00065897858, EUR: 1.1242271 };
const ymd = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
const month = (t) => ymd(t).slice(0, 7), today = ymd(db.now);
const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\b(sas|ltda|inc|llc)\b/g, '').replace(/\s+/g, ' ').trim();
const R = db.rules, done = [];
let bad = 0;
for (const inv of db.invoices) {
  const f = inv.fields, rate = R.fx_rates?.[f.currency] ?? MARKET[f.currency];
  const usd = f.amount == null || rate == null ? null : Math.round(f.amount * rate * 100) / 100;
  const ben = f.payee_name == null ? null : db.beneficiaries.find((b) => norm(b.name) === norm(f.payee_name)) ?? null;
  const cur = done.filter((d) => month(d.received_at) === month(db.now));
  const committed = cur.filter((d) => d.outcome !== 'FRENAR').reduce((s, d) => s + (d.usd ?? 0), 0);
  const paid = cur.filter((d) => d.outcome === 'PAGAR').reduce((s, d) => s + (d.usd ?? 0), 0);
  const v = (ok, known = true) => (!known ? 'no_verificado' : ok ? 'cumple' : 'no_cumple');
  const a = ben?.agreement, sameBen = (d) => ben && d.ben === ben.name;
  const hourly = done.filter((d) => sameBen(d) && month(d.received_at) === month(inv.received_at)).reduce((s, d) => s + (d.usd ?? 0), usd ?? 0);
  const c = {
    lectura: v(true, f.amount != null && f.payee_name != null && f.currency != null),
    beneficiario_permitido: v(ben != null, f.payee_name != null),
    beneficiario_cuenta: v(ben?.bank_account === f.bank_account, ben != null && f.bank_account != null),
    acuerdo: v(a?.type === 'one_off' || (a?.type === 'hourly' ? hourly <= a.cap_usd : Math.abs(usd - a?.amount_usd) <= a?.amount_usd * R.agreement_tolerance_pct / 100), ben != null && usd != null),
    duplicado_exacto: v(!done.some((d) => sameBen(d) && d.number === f.invoice_number && Date.parse(inv.received_at) - Date.parse(d.received_at) <= R.duplicate_window_days * 864e5), f.invoice_number != null && f.payee_name != null),
    duplicado_probable: v(!done.some((d) => sameBen(d) && d.number !== f.invoice_number && norm(d.concept) === norm(f.concept) && month(d.received_at) === month(inv.received_at)), f.concept != null && f.payee_name != null && f.amount != null),
    limite_pago: v(usd <= R.per_payment_limit_usd, usd != null),
    umbral_aprobacion: v(usd <= R.approval_threshold_usd, usd != null),
    presupuesto_periodo: v(committed + usd <= R.period_budget_usd, usd != null),
    saldo_cuenta: v(paid + usd <= R.account_balance_usd, usd != null),
    vencimiento: v(f.due_date >= today, f.due_date != null),
    periodo: v(month(inv.received_at) === month(db.now)),
    moneda: v(rate != null, f.currency != null),
  };
  const failing = Object.keys(c).filter((k) => c[k] !== 'cumple');
  const outcome = c.duplicado_exacto === 'no_cumple' || c.limite_pago === 'no_cumple' ? 'FRENAR' : failing.length ? 'ESCALAR' : 'PAGAR';
  const s = seed.invoices.find((x) => x.fields.invoice_number === f.invoice_number && x.fields.concept === f.concept && x.fields.amount === f.amount && x.source === inv.source);
  const want = s.check ? [s.check, ...s.also].sort().join(',') : '';
  if (outcome !== inv.expected_outcome || failing.sort().join(',') !== want) {
    bad++; console.log(`#${s.nn} ${f.payee_name}: ${outcome} [${failing}] want ${inv.expected_outcome} [${want}]`);
  }
  done.push({ received_at: inv.received_at, ben: ben?.name, number: f.invoice_number, concept: f.concept, usd, outcome });
}
console.log(bad ? `replay: ${bad} mismatches` : `replay: ${db.invoices.length} ok`);
// R-35 happy path on the month's final state: approving Nube Sur #2044 overrides only umbral_aprobacion (its sole failing
// check, asserted above), so budget and balance re-run with the period state minus the invoice itself.
const cents = (x) => Math.round(x * 100) / 100;
const approve = (state) => {
  const nube = state.find((d) => d.number === '2044'), rest = state.filter((d) => d !== nube);
  const c = cents(rest.filter((d) => d.outcome !== 'FRENAR').reduce((s, d) => s + (d.usd ?? 0), nube.usd));
  const p = cents(rest.filter((d) => d.outcome === 'PAGAR').reduce((s, d) => s + (d.usd ?? 0), nube.usd));
  return `${c <= R.period_budget_usd && p <= R.account_balance_usd ? 'PAGAR' : 'ESCALAR'} ${c} ${p}`;
};
const month0 = done.filter((d) => month(d.received_at) === month(db.now));
console.log(`happy: direct ${approve(month0)}; after rejecting #15 ${approve(month0.map((d) => (d.number === '1043' ? { ...d, outcome: 'FRENAR' } : d)))}`);
JS
)
HAPPY='happy: direct ESCALAR 43205.36 22609.39; after rejecting #15 PAGAR 40705.36 22609.39'
# R-36 + R-35 without Postgres: the same reference model over rows built from the seed JSON with the migration's date rule.
SYNTH=$(cat <<'JS'
import { readFileSync } from 'node:fs';
const seed = JSON.parse(readFileSync(process.argv[1], 'utf8').match(/\$seed\$([\s\S]*?)\$seed\$/)[1]);
const now = Date.now(), bog = (t) => new Date(t - 5 * 36e5).toISOString(); // America/Bogota is UTC-5, no DST
const start = Date.parse(bog(now).slice(0, 7) + '-01T05:00:00Z');
const plus = (day, n) => (n == null ? null : new Date(Date.parse(day) + n * 864e5).toISOString().slice(0, 10));
const invoices = seed.invoices.map((s) => {
  const at = s.prev_month ? start - 5 * 864e5 : start + ((now - start) * Number(s.nn)) / 30, day = bog(at).slice(0, 10);
  return { source: s.source, expected_outcome: s.expected_outcome, received_at: new Date(at).toISOString(),
    fields: { ...s.fields, issue_date: plus(day, s.issue), due_date: plus(day, s.due) } };
}).sort((a, b) => a.received_at.localeCompare(b.received_at));
console.log(JSON.stringify({ now: new Date(now).toISOString(), rules: seed.rules, beneficiaries: seed.beneficiaries, invoices }));
JS
)
replayed(){ echo "$1" | grep -q '^replay: 29 ok$' && echo "$1" | grep -qxF "$HAPPY"; }
out=$(node --input-type=module -e "$SYNTH" "$MIG" | node --input-type=module -e "$REPLAY" "$MIG" 2>&1)
replayed "$out" || fail "reference replay of the seed JSON (AC-10, R-35, R-36): $out"
echo "seed.test: reference replay passed (every row's non-cumple set = check + also; R-35 happy path)"


# ---- Part 2: execute against a real Postgres (same stubs as schema.test.sh) ----
INITDB=$(command -v initdb || ls /usr/lib/postgresql/*/bin/initdb 2>/dev/null | sort -V | tail -1)
[ -x "$INITDB" ] || { echo "seed.test: static checks passed; no local Postgres, SQL not executed"; exit 0; }
B=$(dirname "$INITDB"); D=$(mktemp -d); chmod 777 "$D"
pg(){ if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
trap 'pg "$B/pg_ctl" -D "$D/db" -m immediate stop >/dev/null 2>&1; rm -rf "$D"' EXIT
pg "$B/initdb" -D "$D/db" -U postgres -A trust >/dev/null 2>&1 || fail "initdb"
pg "$B/pg_ctl" -D "$D/db" -o "-c listen_addresses='' -k $D" -w start >/dev/null 2>&1 || fail "pg_ctl start"
sql(){ "$B/psql" -h "$D" -U postgres -d postgres -X -q -A -t -v ON_ERROR_STOP=1 "$@" 2>&1; }
as(){ printf "set role authenticated;\nset request.jwt.claim.sub = '%s';\n%s\n" "$1" "$2" | sql -f -; }
expect(){ out=$(as "$1" "$2"); echo "$out" | grep -qE "$3" || fail "$4 (got: $out)"; }
is(){ out=$(sql -c "$1"); [ "$out" = "$2" ] || fail "$3 (got: $out, want: $2)"; }
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
sql -c "insert into auth.users values ('$UA', 'juan.perez@andina.co'), ('$UB', 'otra@b.co')" >/dev/null || fail "signup (AC-03)"
CA=$(sql -c "select company_id from public.company_members where user_id = '$UA'")
CB=$(sql -c "select company_id from public.company_members where user_id = '$UB'")
for c in "$CA" "$CB"; do
  is "select count(*) || ' ' || count(*) filter (where expected_outcome = 'PAGAR') || ' ' || count(*) filter (where expected_outcome = 'FRENAR') || ' ' || count(*) filter (where expected_outcome = 'ESCALAR') from public.invoices where company_id = '$c' and not archived" "29 15 3 11" "signup seeds 29 invoices 15/3/11 (AC-03)"
  is "select count(*) from public.beneficiaries where company_id = '$c'" 8 "signup seeds 8 beneficiaries (AC-03)"
  is "select version || ' ' || name from public.policies where company_id = '$c'" "1 Política general" "signup seeds policy v1 (AC-03)"
  is "select count(*) from public.invoices where company_id = '$c' and id = md5('$c' || '01')::uuid" 1 "seed id = md5(company || NN)"
  is "select count(*) from public.decisions where company_id = '$c'" 0 "the seed stores no decision (AC-10)"
done
is "select count(*) from public.invoices where company_id = '$CA' and date_trunc('month', received_at at time zone 'America/Bogota') <> date_trunc('month', now() at time zone 'America/Bogota')" 1 "exactly one invoice outside the period (R-09)"
is "select count(*) from public.invoices where company_id = '$CA' and received_at > now()" 0 "no invoice received in the future (R-09)"
expect "$UA" "select count(*) from public.invoices" '^29$' "member reads own seed through RLS (AC-03)"
expect "$UA" "select public.andina_seed('$CA', true)" 'permission denied' "members can call the internal seed helper"

replay(){ sql -c "select json_build_object('now', now(), 'rules', (select rules from public.policies where company_id = '$1' order by version desc limit 1),
  'beneficiaries', (select json_agg(b) from public.beneficiaries b where company_id = '$1' and not archived),
  'invoices', (select json_agg(i order by i.received_at, i.id) from public.invoices i where company_id = '$1' and not archived))" |
  node --input-type=module -e "$REPLAY" "$MIG" 2>&1; }
out=$(replay "$CA"); replayed "$out" || fail "seed replay (AC-10, R-08, R-35, R-36): $out"

# AC-47: reset only for the caller's own demo company, archive + re-insert, never delete
expect "$UA" "select public.reset_demo_company()" 'NOT_DEMO' "reset on a non-demo company (AC-47)"
sql -c "update public.companies set is_demo = true where id = '$CA'" >/dev/null || fail "mark A demo"
expect "$UB" "select public.reset_demo_company()" 'NOT_DEMO' "B's member resets A's demo company (AC-47)"
expect "" "select public.reset_demo_company()" 'NOT_DEMO' "reset without a user"
out=$(printf "set role anon;\nselect public.reset_demo_company();\n" | sql -f -); echo "$out" | grep -q 'permission denied' || fail "anon executes reset (got: $out)"
is "select count(*) from public.invoices where archived" 0 "a refused reset archived something"
sql -c "update public.companies set is_demo = true where id = '$CB'" >/dev/null || fail "mark B demo"
as "$UA" "insert into public.beneficiaries (company_id, name, bank_account) values ('$CA', 'Pixel Lab', 'x'); update public.beneficiaries set bank_account = 'otra' where name = 'Laura Méndez'; insert into public.policies (company_id, version, name, rules) values ('$CA', 2, 'Juez', '{\"per_payment_limit_usd\": 1000}')" >/dev/null || fail "judge edits"
# R-69: decisions present (PAGAR, ESCALAR, FRENAR); the reset (security definer) still archives every one of them
IDS='lectura beneficiario_permitido beneficiario_cuenta acuerdo duplicado_exacto duplicado_probable limite_pago umbral_aprobacion presupuesto_periodo saldo_cuenta vencimiento periodo moneda'
OK=$(for id in $IDS; do printf '{"id":"%s","verdict":"cumple"},' "$id"; done); OK="[${OK%,}]"
for o in "01 PAGAR $OK" "02 ESCALAR []" "03 FRENAR []"; do set -- $o
  sql -c "select public.insert_decision(md5('$CA' || '$1')::uuid, (public.period_state('$CA', current_date, md5('$CA' || '$1')::uuid) ->> 'committed_usd')::numeric, '{\"outcome\":\"$2\",\"actor\":\"agent\",\"amount_usd\":0,\"checks\":$3}', 0)" >/dev/null || fail "seed decision $2"; done
is "select count(distinct invoice_id) from public.decisions where company_id = '$CA'" 3 "three decided seed invoices"
expect "$UA" "select public.reset_demo_company()" "^$CA$" "first reset returns the company"
expect "$UA" "select public.reset_demo_company()" "^$CA$" "second reset"
is "select count(*) filter (where archived) || ' ' || count(*) filter (where not archived) from public.invoices where company_id = '$CA'" "58 29" "reset archives old invoices and re-inserts 29 (AC-47)"
is "select count(*) from public.invoices where company_id = '$CA' and not archived and id = md5('$CA' || '01')::uuid" 0 "re-inserted invoices get new ids"
is "select count(*) from public.invoices i where company_id = '$CA' and archived and exists (select 1 from public.decisions d where d.invoice_id = i.id)" 3 "reset archives decided invoices (R-69, AC-47)"
is "select string_agg(version::text, ',' order by version) from public.policies where company_id = '$CA'" "1,2,3,4" "reset appends policy max+1 each time (AC-47)"
is "select (select rules from public.policies where company_id = '$CA' order by version desc limit 1) = (select rules from public.policies where company_id = '$CA' and version = 1)" t "latest policy = seed rules"
is "select count(*) || ' ' || count(*) filter (where archived) from public.beneficiaries where company_id = '$CA'" "9 1" "8 seed beneficiaries, judge's Pixel Lab archived, none duplicated"
is "select bank_account from public.beneficiaries where company_id = '$CA' and name = 'Laura Méndez'" "Bancolombia ahorros 0012-3456-4821" "reset restores Laura's account"
is "select count(*) from public.invoices where company_id = '$CB' and archived" 0 "A's reset archived B's invoices"
is "select count(*) || ' ' || max(version) from public.policies where company_id = '$CB'" "1 1" "A's reset touched B's policy"
out=$(replay "$CA"); replayed "$out" || fail "replay after reset (AC-47): $out"
# R-41: the database assigns the policy version; a member-sent 2147483647 must not poison reset
expect "$UA" "insert into public.policies (company_id, version, name, rules) values ('$CA', 2147483647, 'Juez', '{}') returning version" '^5$' "member-sent policy version is ignored, stored as max+1 (R-41)"
expect "$UA" "select public.reset_demo_company()" "^$CA$" "reset after a member inserted version 2147483647 (R-41, AC-47)"
is "select (select rules from public.policies where company_id = '$CA' order by version desc limit 1) = (select rules from public.policies where company_id = '$CA' and version = 1)" t "latest policy = seed rules after the huge-version insert (R-41)"
echo "seed.test: static checks, seed replay and reset passed"
