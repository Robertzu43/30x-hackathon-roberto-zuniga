// One request per screen (D40, AC-98): the JWT check (requireAuth, no membership read), then one RPC to the screen's
// function (migration 20261017001000), which finds the company from auth.uid() under RLS. From its rows the Worker computes
// exactly what the old endpoints answer; those endpoints stay for their tests and callers.
import { Hono, type Context } from 'hono';
import { bogotaDay, FRESH_MS, findBeneficiary, nameKey, validFields } from '../engine/checks';
import type { Beneficiary, Check, InvoiceFields, Outcome, PolicyRules } from '../engine/types';
import type { Env } from '../env';
import { recordedFields } from '../agent/trace';
import { requireAuth, type AuthEnv } from '../lib/auth';
import { usdPerUnit } from '../lib/fx';
import { round2 } from '../lib/money';
import { isUuid, must } from '../lib/supabase';

// screen_period's rows: the five reads of GET /api/period.
type Row = { id: string; received_at: string; fields: InvoiceFields | null; outcome: Outcome | null; amount_usd: number | string | null };
export interface PeriodRows {
  current: Row[];
  directory: Array<Beneficiary & { country?: string | null }>;
  policy: { version: number; rules: PolicyRules } | null;
  seeded: Array<{ id: string; expected_outcome: Outcome }>;
  decisions: Array<{ invoice_id: string; outcome: Outcome; actor: 'agent' | 'human'; checks: Check[] | null }>;
  // Since migration 20261018000200 «Decisiones explicadas» is counted in SQL over every decision: `decisions` then carries only
  // non-archived invoices' ones, with checks only where the invoice has no stored fields (R-150).
  explained?: { n: number; m: number };
}
// screen_period's rows since migration 001100: each decision with its time (AC-103's trend).
type TimedRows = PeriodRows & { decisions: Array<PeriodRows['decisions'][number] & { created_at: string }> };
// screen_inbox's invoice rows (invoice_current), as far as AC-101 reads them.
type InboxRow = Row & { decided_at: string | null; question_es: string | null; question_en: string | null; headline: string | null;
  origin?: string; sender?: string | null };
// R-150 lever 1: a row as Bandeja's table draws it (web/dashboard/InvoiceTable.tsx); Detalle loads the long texts itself.
const drawn = ({ id, outcome, headline, received_at, amount_usd, origin, sender, fields: f }: InboxRow) => ({ id, outcome, headline, received_at, amount_usd,
  origin, sender, fields: f && { payee_name: f.payee_name, invoice_number: f.invoice_number, concept: f.concept } });
type Group = { beneficiary: string | null; paid_usd: number; committed_usd: number; count: number };
type FxRow = { currency: string; usd_per_unit: number | string; source: string; fetched_at: string };

const today = () => bogotaDay(new Date().toISOString());
export const thisMonth = () => today().slice(0, 7);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const usd = (r: Row) => Number(r.amount_usd ?? 0);
const total = (rows: Row[]) => round2(rows.reduce((s, r) => s + usd(r), 0));
// AC-44's two counts of a seeded invoice's first agent decision (R-01); Autonomía and its trend use the same ones.
const solo = (first: Outcome | undefined, expected: Outcome) => first !== 'ESCALAR' && first === expected;
const violation = (first: Outcome | undefined, expected: Outcome) => first === 'PAGAR' && expected !== 'PAGAR';
// Per row: the read fields as recorded (`read`, what the AC-19 name rule groups by, as Periodo does) and as every check saw
// them (`shown`, R-71: an untrusted field is unknown), the latest decision's checks standing in for fields never stored.
function fieldsOf(decisions: PeriodRows['decisions']) {
  const lastChecks = new Map(decisions.map((d) => [d.invoice_id, d.checks])); // seq order: the latest wins
  const read = (r: Row) => recordedFields(r.fields, lastChecks.get(r.id));
  return { read, shown: (r: Row) => ((f) => f && validFields(f))(read(r)) };
}

// GET /api/period's figures for `month` (AC-44, D17, R-01, R-45, R-63); period.ts answers with this too (R-132: one copy).
export function periodOf(month: string, { current, directory, policy, seeded, decisions, explained }: PeriodRows) {
  // R-01: each seeded invoice's FIRST agent decision, so a later human answer or a policy change never moves the figures.
  const first = new Map<string, Outcome>();
  for (const d of decisions) if (d.actor === 'agent' && !first.has(d.invoice_id)) first.set(d.invoice_id, d.outcome);
  const lastChecks = new Map(decisions.map((d) => [d.invoice_id, d.checks])); // seq order: the latest wins
  const n = seeded.filter((i) => solo(first.get(i.id), i.expected_outcome)).length;
  // The month's money (D5, R-45) and the per-beneficiary table (R-63) from the same rows: non-archived invoices that arrived in
  // the Bogotá month. Rows group by the engine's AC-19 name rule, labelled with the directory name or else the oldest invoice's
  // payee; an unread payee is the one row with beneficiary null ("Beneficiario no leído"). Pending and FRENAR add 0 to money.
  const rows = current.filter((r) => bogotaDay(r.received_at).slice(0, 7) === month);
  const usdOf = (r: PeriodRows['current'][number], o: Outcome[]) => (r.outcome && o.includes(r.outcome) ? Number(r.amount_usd ?? 0) : 0);
  const groups = new Map<string, Group>();
  const count_by_outcome: Record<Outcome, number> = { PAGAR: 0, FRENAR: 0, ESCALAR: 0 };
  for (const r of rows) {
    const payee = recordedFields(r.fields, lastChecks.get(r.id))?.payee_name ?? null; // a decided invoice stored without fields
    const key = nameKey(payee);
    const g = groups.get(key) ?? { beneficiary: key ? findBeneficiary(payee, directory)?.name ?? payee : null, paid_usd: 0, committed_usd: 0, count: 0 };
    groups.set(key, { ...g, paid_usd: g.paid_usd + usdOf(r, ['PAGAR']), committed_usd: g.committed_usd + usdOf(r, ['PAGAR', 'ESCALAR']), count: g.count + 1 });
    if (r.outcome) count_by_outcome[r.outcome]++;
  }
  const by_beneficiary = [...groups.values()].map((g) => ({ ...g, paid_usd: round2(g.paid_usd), committed_usd: round2(g.committed_usd) }))
    .sort((a, b) => (a.beneficiary === null ? 1 : b.beneficiary === null ? -1 : a.beneficiary.localeCompare(b.beneficiary, 'es')));
  const paid = round2(rows.reduce((s, r) => s + usdOf(r, ['PAGAR']), 0));
  const committed = round2(rows.reduce((s, r) => s + usdOf(r, ['PAGAR', 'ESCALAR']), 0));
  const budget = policy?.rules.period_budget_usd ?? null;
  const account = policy?.rules.account_balance_usd ?? null;
  const ex = explained ?? { n: decisions.filter((d) => d.checks?.length).length, m: decisions.length }; // «Decisiones explicadas»
  return {
    month,
    count_by_outcome,
    by_beneficiary,
    paid_usd: paid,
    committed_usd: committed,
    budget_usd: budget,
    balance_usd: account === null ? null : round2(account - paid), // R-45: the policy's balance minus what was paid
    available_usd: budget === null ? null : round2(budget - committed),
    autonomy: { n, m: seeded.length },
    autonomy_pct: seeded.length ? Math.round((100 * n) / seeded.length) : null,
    violations: seeded.filter((i) => violation(first.get(i.id), i.expected_outcome)).length,
    explained_pct: ex.m ? Math.round((100 * ex.n) / ex.m) : 100,
  };
}

// AC-101's dashboard (R-124) on `today`'s Bogotá day, from screen_inbox's rows. Money is AC-44's: Autonomía and Pagado come
// from periodOf, so Bandeja and Periodo cannot disagree.
function dashboardOf(rows: InboxRow[], p: PeriodRows, day: string) {
  const month = day.slice(0, 7);
  const { autonomy, autonomy_pct } = periodOf(month, p);
  const { read, shown } = fieldsOf(p.decisions);
  const is = (o: Outcome) => rows.filter((r) => r.outcome === o);
  const toPay = is('PAGAR').filter((r) => r.decided_at && bogotaDay(r.decided_at) === day);
  const paid = is('PAGAR').filter((r) => bogotaDay(r.received_at).slice(0, 7) === month); // AC-44's Pagado
  const split = <K extends string>(k: K, key: (r: Row) => string | null) => {
    const sums = new Map<string | null, number>();
    for (const r of paid) sums.set(key(r), (sums.get(key(r)) ?? 0) + usd(r));
    return [...sums].map(([v, s]) => ({ [k]: v, usd: round2(s) }) as Record<K, string | null> & { usd: number }).sort((a, b) => b.usd - a.usd);
  };
  const days = new Map(Array.from({ length: 30 }, (_, i) => addDays(day, i - 29)).map((d) => [d, { day: d, PAGAR: 0, FRENAR: 0, ESCALAR: 0, pending: 0 }]));
  for (const r of rows) { const c = days.get(bogotaDay(r.received_at)); if (c) c[r.outcome ?? 'pending']++; }
  const brief = (r: Row) => { const f = shown(r); return { invoice_id: r.id, payee: f?.payee_name ?? null, amount: f?.amount ?? null, currency: f?.currency ?? null }; };
  const week = addDays(day, 7);
  const due = rows.flatMap((r) => { const d = shown(r)?.due_date; return r.outcome !== 'FRENAR' && d && d >= day && d <= week ? [{ r, d }] : []; })
    .sort((a, b) => a.d.localeCompare(b.d));
  const asking = is('ESCALAR').sort((a, b) => Date.parse(a.decided_at ?? '') - Date.parse(b.decided_at ?? ''));
  return {
    kpis: { to_pay_today_usd: total(toPay), to_pay_today_count: toPay.length, awaiting_count: asking.length, awaiting_usd: total(asking),
      stopped_month_count: is('FRENAR').filter((r) => bogotaDay(r.received_at).slice(0, 7) === month).length,
      autonomy_pct, autonomy_n: autonomy.n, autonomy_m: autonomy.m },
    by_day: [...days.values()],
    by_currency: split('currency', (r) => read(r)?.currency ?? null),
    // R-124: the directory beneficiary's country by the AC-19 name rule; null = «Sin país en el directorio»
    by_country: split('country', (r) => (findBeneficiary(read(r)?.payee_name ?? null, p.directory) as PeriodRows['directory'][number] | null)?.country ?? null),
    due_soon: due.slice(0, 5).map(({ r, d }) => ({ ...brief(r), amount_usd: r.amount_usd === null ? null : usd(r), due_date: d, outcome: r.outcome })),
    due_soon_total: due.length,
    approvals: asking.slice(0, 3).map((r) => ({ ...brief(r), question_es: r.question_es, question_en: r.question_en, decided_at: r.decided_at })),
    approvals_total: asking.length,
  };
}

// AC-103's charts (R-124) for periodOf's `period` of `month`, nothing drawn after `day` (no projection).
function chartsOf(period: ReturnType<typeof periodOf>, p: TimedRows, day: string) {
  const { month, budget_usd: budget, paid_usd: paid, committed_usd: committed, count_by_outcome } = period;
  const committedOn = new Map<string, number>();
  for (const r of p.current) {
    const d = bogotaDay(r.received_at);
    if (d.startsWith(month) && (r.outcome === 'PAGAR' || r.outcome === 'ESCALAR')) committedOn.set(d, (committedOn.get(d) ?? 0) + usd(r));
  }
  let sum = 0;
  const burn = Array.from({ length: new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate() }, (_, i) => {
    const d = `${month}-${String(i + 1).padStart(2, '0')}`;
    sum += committedOn.get(d) ?? 0;
    return { day: d, available_usd: budget === null || d > day ? null : round2(budget - sum) };
  });
  // The trend: AC-44's figures counting only the first agent decisions made up to each day they happened (Bogotá).
  const first = new Map<string, { outcome: Outcome; day: string }>();
  for (const d of p.decisions) if (d.actor === 'agent' && !first.has(d.invoice_id)) first.set(d.invoice_id, { outcome: d.outcome, day: bogotaDay(d.created_at) });
  const seen = p.seeded.flatMap((i) => ((f) => (f ? [{ ...f, expected: i.expected_outcome }] : []))(first.get(i.id)));
  const trend = [...new Set(seen.map((s) => s.day))].sort().map((d) => {
    const upTo = seen.filter((s) => s.day <= d);
    return { day: d, autonomy_pct: Math.round((100 * upTo.filter((s) => solo(s.outcome, s.expected)).length) / p.seeded.length),
      violations: upTo.filter((s) => violation(s.outcome, s.expected)).length };
  });
  const decided = count_by_outcome.PAGAR + count_by_outcome.FRENAR + count_by_outcome.ESCALAR;
  return {
    budget_usd: budget,
    burn,
    stack: { paid, escalated: round2(committed - paid), available: budget === null ? null : Math.max(0, round2(budget - committed)),
      over: budget === null ? null : Math.max(0, round2(committed - budget)) },
    outcomes: { ...count_by_outcome, pending: period.by_beneficiary.reduce((s, g) => s + g.count, 0) - decided },
    trend,
  };
}

// AC-104's profile: the invoices the AC-19 name rule matches to `b` (R-63, as Periodo groups them), oldest first in p.current.
function beneficiaryOf(b: Beneficiary, p: PeriodRows, month: string) {
  const { read, shown } = fieldsOf(p.decisions);
  const key = nameKey(b.name);
  const mine = p.current.filter((r) => key && nameKey(read(r)?.payee_name ?? null) === key);
  const paid = mine.filter((r) => r.outcome === 'PAGAR');
  return {
    beneficiary: b,
    totals: { paid_month_usd: total(paid.filter((r) => bogotaDay(r.received_at).startsWith(month))), paid_total_usd: total(paid), invoices: mine.length },
    history: paid.slice(-12).map((r) => ({ received_at: r.received_at, amount_usd: usd(r) })), // R-124: per invoice, arrival order
    last: mine.slice(-5).reverse().map((r) => ({ invoice_id: r.id, received_at: r.received_at, amount: shown(r)?.amount ?? null, currency: shown(r)?.currency ?? null,
      outcome: r.outcome })),
  };
}

// GET /api/fx's answer (AC-73, AC-76) and GET /api/portal-link's (AC-86, AC-87); fx.ts and portal-link.ts use these (R-132).
const utcDay = (iso: string) => new Date(iso).toISOString().slice(0, 10);
export const fxOf = (env: Env, rows: FxRow[]) => ({
  provider: env.FX_PROVIDER === 'er-api' ? 'er-api' : 'yahoo',
  rates: rows.map((r) => ({ ...r, usd_per_unit: Number(r.usd_per_unit) })).sort((a, b) => a.currency.localeCompare(b.currency)).map((r) => ({
    currency: r.currency, day: utcDay(r.fetched_at), usd_per_unit: r.usd_per_unit, units_per_usd: usdPerUnit(r.usd_per_unit), source: r.source,
    fetched_at: r.fetched_at, stale: Date.now() - Date.parse(r.fetched_at) > FRESH_MS,
  })),
});
export const portalOf = (env: Env, slug: string) =>
  ({ portal_url: `${env.PORTAL_URL}/${slug}`, email_address: env.INBOUND_EMAIL_DOMAIN ? `facturas+${slug}@${env.INBOUND_EMAIL_DOMAIN}` : null });

// The screen function's jsonb; null when the caller belongs to no company, answered 401 as requireUser does.
const read = async <T>(c: Context<AuthEnv>, fn: string, args: Record<string, unknown> = {}): Promise<T | null> => must(await c.var.db.rpc(fn, args));
const deny = (c: Context<AuthEnv>) => c.json({ error: 'No autorizado' }, 401);
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export const screen = new Hono<AuthEnv>()
  .use('*', async (c, next) => { // R-150: the server's own time on each screen's request, perf.mjs's INFO column
    const t0 = Date.now();
    await next();
    c.header('Server-Timing', `app;dur=${Date.now() - t0}`);
  })
  .use('*', requireAuth)
  .get('/inbox', async (c) => {
    const asked = c.req.query('lang');
    const d = await read<{ invoices: InboxRow[]; last_run: unknown; portal_slug: string; beneficiaries: Array<{ id: string; name: string }>; period: PeriodRows }>(
      c, 'screen_inbox', { p_lang: asked === 'es' || asked === 'en' ? asked : c.var.lang });
    return d ? c.json({ invoices: d.invoices.map(drawn), last_run: d.last_run, portal: portalOf(c.env, d.portal_slug), beneficiaries: d.beneficiaries,
      dashboard: dashboardOf(d.invoices, d.period, today()) }) : deny(c);
  })
  .get('/period', async (c) => {
    const month = c.req.query('month') ?? thisMonth();
    if (!MONTH.test(month)) return c.json({ error: 'Mes no válido: usa AAAA-MM' }, 400);
    const d = await read<TimedRows>(c, 'screen_period');
    if (!d) return deny(c);
    const period = periodOf(month, d);
    return c.json({ period, charts: chartsOf(period, d, today()) });
  })
  .get('/beneficiaries', async (c) => {
    const d = await read<{ beneficiaries: Beneficiary[] }>(c, 'screen_beneficiaries');
    return d ? c.json(d) : deny(c);
  })
  // AC-104: null for another company's, an archived or an unknown id (and for a caller of no company): all 404.
  .get('/beneficiary/:id', async (c) => {
    const id = c.req.param('id');
    const d = isUuid(id) ? await read<{ beneficiary: Beneficiary; period: PeriodRows }>(c, 'screen_beneficiary', { p_id: id }) : null;
    return d ? c.json(beneficiaryOf(d.beneficiary, d.period, thisMonth())) : c.json({ error: 'Beneficiario no encontrado' }, 404);
  })
  .get('/policy', async (c) => {
    const d = await read<{ versions: unknown[]; company: unknown; fx: FxRow[] }>(c, 'screen_policy');
    return d ? c.json({ policy: d.versions[0] ?? null, versions: d.versions, company: d.company, fx: fxOf(c.env, d.fx) }) : deny(c);
  });
