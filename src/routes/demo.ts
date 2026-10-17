// The demo company (D8, AC-45, AC-47, R-15). No service-role client here (AC-38): the public overview signs in as the
// shared demo user and reads through RLS with that user's JWT, reusing the Bandeja and Periodo routes as they are.
import { Hono } from 'hono';
import { runAgent } from '../agent/loop';
import type { Env } from '../env';
import { must, userClient, type Db } from '../lib/supabase';
import { memberRoutes } from './agent';
import { invoices } from './invoices';
import { period } from './period';

export const DEMO_PASSWORD = 'andina-demo-2026'; // public by design (D8, AC-46); scripts/seed-demo-user.mjs restores it (R-18)
const UNAVAILABLE = 'La demo no está disponible en este momento. Intenta de nuevo en unos minutos.';
const isDemo = async (db: Db, companyId: string) =>
  must(await db.from('companies').select('is_demo').eq('id', companyId).single<{ is_demo: boolean }>()).is_demo;

// One sign-in per isolate until a minute before the token expires: Supabase rate-limits sign-ins per IP.
let cached: { token: string; until: number } | undefined;
async function demoToken(env: Env): Promise<string | null> {
  if (cached && cached.until > Date.now()) return cached.token;
  const { data } = await userClient(env, env.SUPABASE_ANON_KEY).auth
    .signInWithPassword({ email: env.DEMO_EMAIL, password: DEMO_PASSWORD }).catch(() => ({ data: { session: null } }));
  if (!data.session) return null;
  cached = { token: data.session.access_token, until: Date.now() + (data.session.expires_in - 60) * 1000 };
  return cached.token;
}

// Runs as the demo user: its company must be the demo company, or nothing is shown (never another company's data).
const view = memberRoutes().get('/', async (c) => {
  if (!(await isDemo(c.var.db, c.var.companyId))) return c.json({ error: UNAVAILABLE }, 503);
  const as = { headers: { Authorization: c.req.header('Authorization')! } };
  const [inv, per] = await Promise.all([invoices.request('/', as, c.env), period.request('/', as, c.env)]);
  if (!inv.ok || !per.ok) throw new Error(`demo overview: invoices ${inv.status}, period ${per.status}`);
  return c.json({ invoices: await inv.json(), period: await per.json() });
});

export const demo = new Hono<{ Bindings: Env }>()
  .get('/overview', async (c) => {
    const token = await demoToken(c.env);
    const res = token ? await view.request('/', { headers: { Authorization: `Bearer ${token}` } }, c.env) : null;
    if (res?.status === 401) cached = undefined; // a revoked token: sign in again on the next visit
    if (!res?.ok) return c.json({ error: UNAVAILABLE }, 503, { 'Cache-Control': 'no-store' });
    return c.json(await res.json(), 200, { 'Cache-Control': 'public, max-age=60' });
  })
  // "Reiniciar demo": only a member of the demo company; the RPC re-checks it in the database (42501 NOT_DEMO).
  .route('/reset', memberRoutes().post('/', async (c) => {
    const { db, companyId } = c.var;
    if (!(await isDemo(db, companyId))) return c.json({ error: 'Solo los miembros de la empresa demo pueden reiniciarla' }, 403);
    must(await db.rpc('reset_demo_company'));
    return c.json(await runAgent({ db, env: c.env }, companyId, 'pending', 'reset'));
  }));
