// Periodo (AC-44, D17, R-01, R-63): the month's money and per-beneficiary table, the policy, and the agent's honesty figures.
// The figures are periodOf's (src/routes/screen.ts), the one copy GET /api/screen/period also uses (R-132).
import { directorio, politica } from '../agent/tools';
import { must } from '../lib/supabase';
import { memberRoutes } from './agent';
import { periodOf, thisMonth, type PeriodRows } from './screen';

export const period = memberRoutes().get('/', async (c) => {
  const { db, companyId } = c.var;
  const month = c.req.query('month') ?? thisMonth();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return c.json({ error: 'Mes no válido: usa AAAA-MM' }, 400);
  // ponytail: reads every decision and invoice of the company; a seeded workspace has ~30. Aggregate in SQL if one grows to thousands.
  const [current, directory, policy, seeded, decisions]: [PeriodRows['current'], PeriodRows['directory'], PeriodRows['policy'], PeriodRows['seeded'], PeriodRows['decisions']] = await Promise.all([
    db.from('invoice_current').select('id, received_at, fields, outcome, amount_usd').eq('company_id', companyId).order('received_at').order('id').then(must),
    directorio(db, companyId),
    politica(db, companyId),
    db.from('invoices').select('id, expected_outcome').eq('company_id', companyId).eq('archived', false).not('expected_outcome', 'is', null).then(must),
    db.from('decisions').select('invoice_id, seq, outcome, actor, checks').eq('company_id', companyId).order('seq').then(must),
  ]);
  return c.json(periodOf(month, { current, directory, policy, seeded, decisions }));
});
