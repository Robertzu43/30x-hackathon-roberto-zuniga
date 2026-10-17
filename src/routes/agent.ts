// The member route chain (AC-38, AC-43) and "when did the agent last run" (AC-63).
import { Hono } from 'hono';
import { requireUser, type AppEnv } from '../lib/auth';
import { must } from '../lib/supabase';

// Every member route: a verified JWT and the user's own company (requireUser), then at most 60 POSTs a minute per user
// (wrangler.toml RATE_LIMIT). No binding (unit tests, local dev) means no limit.
export const memberRoutes = () => new Hono<AppEnv>().use('*', requireUser, async (c, next) => {
  if (c.req.method === 'POST' && c.env.RATE_LIMIT && !(await c.env.RATE_LIMIT.limit({ key: c.var.user.id })).success) {
    return c.json({ error: 'Demasiadas solicitudes, intenta en un minuto' }, 429);
  }
  await next();
});

type Run = { created_at: string; trigger: string } | null;

// Newest run of the member's company or cron tick (company null). Both filters are explicit on top of RLS: never
// another company's run (AC-63).
export const agent = memberRoutes().get('/last-run', async (c) => {
  const runs = () => c.var.db.from('agent_runs').select('created_at, trigger');
  const newest = await Promise.all([runs().eq('company_id', c.var.companyId), runs().is('company_id', null)]
    .map(async (q): Promise<Run> => must(await q.order('created_at', { ascending: false }).limit(1).maybeSingle())));
  const run = newest.filter((r) => r !== null).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  return c.json(run ? { at: run.created_at, trigger: run.trigger } : null);
});
