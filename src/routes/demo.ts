// The demo company (D8, AC-45, AC-47, R-15). No service-role client here (AC-38): the public overview signs in as the
// shared demo user and reads through RLS with that user's JWT, in one function call (AC-98).
import { Hono } from 'hono';
import { runAgent } from '../agent/loop';
import type { Env } from '../env';
import type { Lang } from '../i18n';
import { must, userClient, type Db } from '../lib/supabase';
import { memberRoutes } from './agent';
import { periodOf, thisMonth, type PeriodRows } from './screen';

export const DEMO_PASSWORD = 'andina-demo-2026'; // public by design (D8, AC-46); scripts/seed-demo-user.mjs restores it (R-18)
const UNAVAILABLE = 'La demo no está disponible en este momento. Intenta de nuevo en unos minutos.';
const isDemo = async (db: Db, companyId: string) =>
  must(await db.from('companies').select('is_demo').eq('id', companyId).single<{ is_demo: boolean }>()).is_demo;

// One sign-in per isolate until a minute before the token expires: Supabase rate-limits sign-ins per IP. The token comes
// straight from Supabase Auth, so it is used as is; the headlines follow the demo user's stored language, as before.
let cached: { token: string; lang: Lang; until: number } | undefined;
async function demoSession(env: Env) {
  if (cached && cached.until > Date.now()) return cached;
  const { data } = await userClient(env, env.SUPABASE_ANON_KEY).auth
    .signInWithPassword({ email: env.DEMO_EMAIL, password: DEMO_PASSWORD }).catch(() => ({ data: { session: null } }));
  if (!data.session) return null;
  const lang: Lang = data.session.user?.user_metadata?.lang === 'en' ? 'en' : 'es';
  cached = { token: data.session.access_token, lang, until: Date.now() + (data.session.expires_in - 60) * 1000 };
  return cached;
}

export const demo = new Hono<{ Bindings: Env }>()
  // AC-98, R-122: one function as the demo user (null unless its company is the demo company, so never another company's
  // data), cached at the edge for 60 s. The only cached API answer with company data, and that data is public (D8, AC-45).
  .get('/overview', async (c) => {
    const edge = (caches as unknown as { default: Cache }).default; // workers-types' caches.default; the DOM lib in tsconfig hides it
    const key = new Request(new URL('/api/demo/overview', c.req.url));
    const hit = await edge.match(key);
    if (hit) return hit;
    const s = await demoSession(c.env);
    const r = s && await userClient(c.env, s.token).rpc('screen_demo_overview', { p_lang: s.lang });
    if (r?.error) {
      cached = undefined; // a revoked or expired token: sign in again on the next visit
      console.error('demo: overview not read', r.error.message);
    }
    const d = r?.data as { invoices: unknown[]; period: PeriodRows } | null | undefined;
    if (!d) return c.json({ error: UNAVAILABLE }, 503, { 'Cache-Control': 'no-store' });
    const res = c.json({ invoices: d.invoices, period: periodOf(thisMonth(), d.period) }, 200, { 'Cache-Control': 'public, max-age=60' });
    await edge.put(key, res.clone());
    return res;
  })
  // "Reiniciar demo": only a member of the demo company; the RPC re-checks it in the database (42501 NOT_DEMO).
  .route('/reset', memberRoutes().post('/', async (c) => {
    const { db, companyId } = c.var;
    if (!(await isDemo(db, companyId))) return c.json({ error: 'Solo los miembros de la empresa demo pueden reiniciarla' }, 403);
    const { error } = await db.rpc('reset_demo_company');
    if (error) {
      console.error('demo: reset failed', error.message);
      return c.json({ error: 'No pude reiniciar la demo; intenta de nuevo.' }, 503);
    }
    // The first chunk only (AC-70): the browser continues with POST /api/invoices/run {cursor} (R-60).
    try {
      return c.json(await runAgent({ db, env: c.env, budget: c.var.budget }, companyId, 'pending', 'reset'));
    } catch (e) {
      console.error('demo: agent not started after reset', e instanceof Error ? e.message : e);
      return c.json({ error: 'La demo se reinició, pero el agente no pudo decidir las facturas ahora. Pulsa «Ejecutar agente» o espera la revisión automática (cada 5 minutos).' }, 503);
    }
  }));
