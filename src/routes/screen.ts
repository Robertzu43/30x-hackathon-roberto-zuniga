// One request per screen (D40, AC-98): the JWT check (requireAuth, no membership read), then one RPC to the screen's
// function (migration 20261017001000), which finds the company from auth.uid() under RLS. From its rows the Worker computes
// exactly what the old endpoints answer; those endpoints stay for their tests and callers.
import { Hono, type Context } from 'hono';
import { bogotaDay, FRESH_MS, findBeneficiary, nameKey } from '../engine/checks';
import type { Beneficiary, Check, InvoiceFields, Outcome, PolicyRules } from '../engine/types';
import type { Env } from '../env';
import { recordedFields } from '../agent/trace';
import { requireAuth, type AuthEnv } from '../lib/auth';
import { usdPerUnit } from '../lib/fx';
import { round2 } from '../lib/money';
import { must } from '../lib/supabase';

// screen_period's rows: the five reads of GET /api/period.
export interface PeriodRows {
  current: Array<{ id: string; received_at: string; fields: InvoiceFields | null; outcome: Outcome | null; amount_usd: number | string | null }>;
  directory: Beneficiary[];
  policy: { version: number; rules: PolicyRules } | null;
  seeded: Array<{ id: string; expected_outcome: Outcome }>;
  decisions: Array<{ invoice_id: string; outcome: Outcome; actor: 'agent' | 'human'; checks: Check[] | null }>;
}
type Group = { beneficiary: string | null; paid_usd: number; committed_usd: number; count: number };
type FxRow = { currency: string; usd_per_unit: number | string; source: string; fetched_at: string };

export const thisMonth = () => bogotaDay(new Date().toISOString()).slice(0, 7);

// GET /api/period's figures for `month` (AC-44, D17, R-01, R-45, R-63), computed as src/routes/period.ts computes them.
// ponytail: a copy of period.ts's body, held equal by the routes test; period.ts imports this once its owner allows the edit.
export function periodOf(month: string, { current, directory, policy, seeded, decisions }: PeriodRows) {
  const first = new Map<string, Outcome>();
  for (const d of decisions) if (d.actor === 'agent' && !first.has(d.invoice_id)) first.set(d.invoice_id, d.outcome);
  const lastChecks = new Map(decisions.map((d) => [d.invoice_id, d.checks]));
  const n = seeded.filter((i) => first.get(i.id) !== 'ESCALAR' && first.get(i.id) === i.expected_outcome).length;
  const rows = current.filter((r) => bogotaDay(r.received_at).slice(0, 7) === month);
  const usdOf = (r: PeriodRows['current'][number], o: Outcome[]) => (r.outcome && o.includes(r.outcome) ? Number(r.amount_usd ?? 0) : 0);
  const groups = new Map<string, Group>();
  const count_by_outcome: Record<Outcome, number> = { PAGAR: 0, FRENAR: 0, ESCALAR: 0 };
  for (const r of rows) {
    const payee = recordedFields(r.fields, lastChecks.get(r.id))?.payee_name ?? null;
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
  return {
    month,
    count_by_outcome,
    by_beneficiary,
    paid_usd: paid,
    committed_usd: committed,
    budget_usd: budget,
    balance_usd: account === null ? null : round2(account - paid),
    available_usd: budget === null ? null : round2(budget - committed),
    autonomy: { n, m: seeded.length },
    autonomy_pct: seeded.length ? Math.round((100 * n) / seeded.length) : null,
    violations: seeded.filter((i) => first.get(i.id) === 'PAGAR' && i.expected_outcome !== 'PAGAR').length,
    explained_pct: decisions.length ? Math.round((100 * decisions.filter((d) => d.checks?.length).length) / decisions.length) : 100,
  };
}

// GET /api/fx's answer (AC-73, AC-76) and GET /api/portal-link's (AC-86, AC-87), as fx.ts and portal-link.ts build them.
const utcDay = (iso: string) => new Date(iso).toISOString().slice(0, 10);
const fxOf = (env: Env, rows: FxRow[]) => ({
  provider: env.FX_PROVIDER === 'er-api' ? 'er-api' : 'yahoo',
  rates: rows.map((r) => ({ ...r, usd_per_unit: Number(r.usd_per_unit) })).sort((a, b) => a.currency.localeCompare(b.currency)).map((r) => ({
    currency: r.currency, day: utcDay(r.fetched_at), usd_per_unit: r.usd_per_unit, units_per_usd: usdPerUnit(r.usd_per_unit), source: r.source,
    fetched_at: r.fetched_at, stale: Date.now() - Date.parse(r.fetched_at) > FRESH_MS,
  })),
});
const portalOf = (env: Env, slug: string) =>
  ({ portal_url: `${env.PORTAL_URL}/${slug}`, email_address: env.INBOUND_EMAIL_DOMAIN ? `facturas+${slug}@${env.INBOUND_EMAIL_DOMAIN}` : null });

// The screen function's jsonb; null when the caller belongs to no company, answered 401 as requireUser does.
const read = async <T>(c: Context<AuthEnv>, fn: string, args: Record<string, unknown> = {}): Promise<T | null> => must(await c.var.db.rpc(fn, args));
const deny = (c: Context<AuthEnv>) => c.json({ error: 'No autorizado' }, 401);
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export const screen = new Hono<AuthEnv>().use('*', requireAuth)
  .get('/inbox', async (c) => {
    const asked = c.req.query('lang');
    const d = await read<{ invoices: unknown[]; last_run: unknown; portal_slug: string }>(c, 'screen_inbox',
      { p_lang: asked === 'es' || asked === 'en' ? asked : c.var.lang });
    return d ? c.json({ invoices: d.invoices, last_run: d.last_run, portal: portalOf(c.env, d.portal_slug), dashboard: null }) : deny(c);
  })
  .get('/period', async (c) => {
    const month = c.req.query('month') ?? thisMonth();
    if (!MONTH.test(month)) return c.json({ error: 'Mes no válido: usa AAAA-MM' }, 400);
    const d = await read<PeriodRows>(c, 'screen_period');
    return d ? c.json({ period: periodOf(month, d), charts: null }) : deny(c);
  })
  .get('/beneficiaries', async (c) => {
    const d = await read<{ beneficiaries: Beneficiary[] }>(c, 'screen_beneficiaries');
    return d ? c.json(d) : deny(c);
  })
  .get('/policy', async (c) => {
    const d = await read<{ versions: unknown[]; company: unknown; fx: FxRow[] }>(c, 'screen_policy');
    return d ? c.json({ policy: d.versions[0] ?? null, versions: d.versions, company: d.company, fx: fxOf(c.env, d.fx) }) : deny(c);
  });
