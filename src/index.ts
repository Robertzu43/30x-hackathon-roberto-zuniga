import { Hono } from 'hono';
import { scheduled } from './agent/scheduled';
import { inbound } from './email/inbound';
import type { Env } from './env';
import { agent } from './routes/agent';
import { ask } from './routes/ask';
import { beneficiaries } from './routes/beneficiaries';
import { demo } from './routes/demo';
import { fx } from './routes/fx';
import { invoiceScreen, invoices } from './routes/invoices';
import { period } from './routes/period';
import { company, policy } from './routes/policy';
import { approvals } from './routes/approvals';
import { portalLink } from './routes/portal-link';
import { screen } from './routes/screen';

const app = new Hono<{ Bindings: Env }>();

app.get('/api/health', (c) => c.json({ ok: true }));
// Public values only (anon key is public by design; RLS protects data). Lets the SPA build without env coupling.
app.get('/api/config', (c) => c.json({ supabaseUrl: c.env.SUPABASE_URL, supabaseAnonKey: c.env.SUPABASE_ANON_KEY, demo_email: c.env.DEMO_EMAIL }));
app.route('/api/invoices', invoiceScreen); // Task 42: Detalle's GET /:id in one round trip (AC-98); before `invoices`, whose requireUser it skips
app.route('/api/invoices', invoices);
app.route('/api/policy', policy);
app.route('/api/company', company);
app.route('/api/beneficiaries', beneficiaries);
app.route('/api/period', period);
app.route('/api/agent', agent);
app.route('/api/ask', ask); // Task 23: «Pregúntale a Thesaurus» (AC-67)
app.route('/api/demo', demo); // Task 10: public overview (AC-45) and Reiniciar demo (AC-47)
app.route('/api/portal-link', portalLink); // Task 25: the company's vendor portal URL (AC-86)
app.route('/api/fx', fx); // Task 21: stored market rates (AC-73, AC-76)
app.route('/api/screen', screen); // Task 42: one request per screen (AC-98)
app.route('/api', approvals); // Task 9: approval links and dashboard answers
app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404));
// R-74: anything uncaught is a logged JSON 500, never Hono's plain-text one.
app.onError((e, c) => {
  console.error('api: uncaught', c.req.method, c.req.path, e instanceof Error ? e.message : e);
  return c.json({ error: 'No pude completar la solicitud; intenta de nuevo.' }, 500);
});

export { app };
// The vendor portal's RPC entrypoint (AC-85 item 1), bound by portal/wrangler.toml as MAIN.
export { PortalApi } from './portal-api';
// fetch serves the API and the SPA; scheduled is the 5-minute cron (AC-62) and the daily FX cron (AC-73), wrangler.toml [triggers];
// email is the email intake (AC-87), inert until Email Routing sends a domain here (AC-88).
export default { fetch: app.fetch, scheduled, email: inbound } satisfies ExportedHandler<Env>;
