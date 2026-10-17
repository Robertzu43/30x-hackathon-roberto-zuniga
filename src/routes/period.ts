// Periodo (AC-44, D17, R-01, R-63): the month's money and per-beneficiary table, the policy, and the agent's honesty figures.
import { directorio, politica } from '../agent/tools';
import { recordedFields } from '../agent/trace';
import { bogotaDay, findBeneficiary, nameKey } from '../engine/checks';
import type { Check, InvoiceFields, Outcome } from '../engine/types';
import { round2 } from '../lib/money';
import { must } from '../lib/supabase';
import { memberRoutes } from './agent';

interface Seeded { id: string; expected_outcome: Outcome }
interface Row { invoice_id: string; outcome: Outcome; actor: 'agent' | 'human'; checks: Check[] | null }
interface Current { id: string; received_at: string; fields: InvoiceFields | null; outcome: Outcome | null; amount_usd: number | string | null }
type Group = { beneficiary: string | null; paid_usd: number; committed_usd: number; count: number };

export const period = memberRoutes().get('/', async (c) => {
  const { db, companyId } = c.var;
  const month = c.req.query('month') ?? bogotaDay(new Date().toISOString()).slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return c.json({ error: 'Mes no válido: usa AAAA-MM' }, 400);
  // ponytail: reads every decision and invoice of the company; a seeded workspace has ~30. Aggregate in SQL if one grows to thousands.
  const [current, directory, policy, seeded, decisions]: [Current[], Awaited<ReturnType<typeof directorio>>, Awaited<ReturnType<typeof politica>>, Seeded[], Row[]] = await Promise.all([
    db.from('invoice_current').select('id, received_at, fields, outcome, amount_usd').eq('company_id', companyId).order('received_at').order('id').then(must),
    directorio(db, companyId),
    politica(db, companyId),
    db.from('invoices').select('id, expected_outcome').eq('company_id', companyId).eq('archived', false).not('expected_outcome', 'is', null).then(must),
    db.from('decisions').select('invoice_id, seq, outcome, actor, checks').eq('company_id', companyId).order('seq').then(must),
  ]);
  // R-01: each seeded invoice's FIRST agent decision, so a later human answer or a policy change never moves the figures.
  const first = new Map<string, Outcome>();
  for (const d of decisions) if (d.actor === 'agent' && !first.has(d.invoice_id)) first.set(d.invoice_id, d.outcome);
  const lastChecks = new Map(decisions.map((d) => [d.invoice_id, d.checks])); // seq order: the latest wins
  const n = seeded.filter((i) => first.get(i.id) !== 'ESCALAR' && first.get(i.id) === i.expected_outcome).length;
  // The month's money (D5, R-45) and the per-beneficiary table (R-63) from the same rows: non-archived invoices that arrived in
  // the Bogotá month. Rows group by the engine's AC-19 name rule, labelled with the directory name or else the oldest invoice's
  // payee; an unread payee is the one row with beneficiary null ("Beneficiario no leído"). Pending and FRENAR add 0 to money.
  const rows = current.filter((r) => bogotaDay(r.received_at).slice(0, 7) === month);
  const usdOf = (r: Current, o: Outcome[]) => (r.outcome && o.includes(r.outcome) ? Number(r.amount_usd ?? 0) : 0);
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
  return c.json({
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
    violations: seeded.filter((i) => first.get(i.id) === 'PAGAR' && i.expected_outcome !== 'PAGAR').length,
    explained_pct: decisions.length ? Math.round((100 * decisions.filter((d) => d.checks?.length).length) / decisions.length) : 100,
  });
});
