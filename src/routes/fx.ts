// GET /api/fx (AC-73, AC-76): the newest stored market rate per currency, read with the user's JWT (RLS: members read,
// nobody writes). Never fetches: the cron and the agent do (R-85.6).
import { tasas } from '../agent/tools';
import { FRESH_MS } from '../engine/checks';
import { usdPerUnit } from '../lib/fx';
import { memberRoutes } from './agent';

const utcDay = (iso: string) => new Date(iso).toISOString().slice(0, 10); // the stored day: rows are keyed by fetched_at's UTC day

export const fx = memberRoutes().get('/', async (c) => {
  const now = Date.now();
  const rates = Object.values(await tasas(c.var.db)).sort((a, b) => a.currency.localeCompare(b.currency)).map((r) => ({
    currency: r.currency, day: utcDay(r.fetched_at), usd_per_unit: r.usd_per_unit, units_per_usd: usdPerUnit(r.usd_per_unit), source: r.source,
    fetched_at: r.fetched_at, stale: now - Date.parse(r.fetched_at) > FRESH_MS,
  }));
  return c.json({ provider: c.env.FX_PROVIDER === 'er-api' ? 'er-api' : 'yahoo', rates });
});
