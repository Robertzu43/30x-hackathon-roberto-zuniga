// Periodo (AC-44, D17, R-01): the month's money from period_state and the policy, and the agent's honesty figures.
import { politica } from '../agent/tools';
import { bogotaDay } from '../engine/checks';
import type { Outcome } from '../engine/types';
import { round2 } from '../lib/money';
import { must } from '../lib/supabase';
import { memberRoutes } from './agent';

interface Seeded { id: string; expected_outcome: Outcome }
interface Row { invoice_id: string; outcome: Outcome; actor: 'agent' | 'human'; checks: unknown[] | null }

export const period = memberRoutes().get('/', async (c) => {
  const { db, companyId } = c.var;
  const month = c.req.query('month') ?? bogotaDay(new Date().toISOString()).slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return c.json({ error: 'Mes no válido: usa AAAA-MM' }, 400);
  // ponytail: reads every decision of the company; a seeded workspace has ~30. Aggregate in SQL if one grows to thousands.
  const [state, policy, seeded, decisions]: [Record<string, unknown>, Awaited<ReturnType<typeof politica>>, Seeded[], Row[]] = await Promise.all([
    db.rpc('period_state', { p_company_id: companyId, p_month: `${month}-01` }).then(must),
    politica(db, companyId),
    db.from('invoices').select('id, expected_outcome').eq('company_id', companyId).eq('archived', false).not('expected_outcome', 'is', null).then(must),
    db.from('decisions').select('invoice_id, seq, outcome, actor, checks').eq('company_id', companyId).order('seq').then(must),
  ]);
  // R-01: each seeded invoice's FIRST agent decision, so a later human answer or a policy change never moves the figures.
  const first = new Map<string, Outcome>();
  for (const d of decisions) if (d.actor === 'agent' && !first.has(d.invoice_id)) first.set(d.invoice_id, d.outcome);
  const n = seeded.filter((i) => first.get(i.id) !== 'ESCALAR' && first.get(i.id) === i.expected_outcome).length;
  const paid = Number(state.paid_usd);
  const committed = Number(state.committed_usd);
  const budget = policy?.rules.period_budget_usd ?? null;
  const account = policy?.rules.account_balance_usd ?? null;
  return c.json({
    ...state,
    month,
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
