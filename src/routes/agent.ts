// The member route chain (AC-38, AC-43) and "when did the agent last run" (AC-63).
import { Hono } from 'hono';
import { requireUser, type AppEnv } from '../lib/auth';
import { must } from '../lib/supabase';

// Every member route: a verified JWT and the user's own company (requireUser), then at most 60 POSTs a minute per user
// (AC-43, R-72): the database counter rate_limit_hit, keyed on the JWT's auth.uid(), one counted subrequest (R-56). The
// Workers ratelimit binding refused nothing live, so it is gone. A failing counter lets the request through, logged.
export const memberRoutes = () => new Hono<AppEnv>().use('*', requireUser, async (c, next) => {
  if (c.req.method === 'POST') {
    const r = await c.var.db.rpc('rate_limit_hit').then((x) => x, (e: unknown) => ({ data: null, error: e }));
    if (r.error) console.error('rate limit: counter failed, request allowed', r.error);
    else if (r.data === false) return c.json({ error: 'Demasiadas solicitudes, intenta en un minuto' }, 429);
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
