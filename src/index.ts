import { Hono } from 'hono';
import type { Env } from './env';

const app = new Hono<{ Bindings: Env }>();

app.get('/api/health', (c) => c.json({ ok: true }));
// Public values only (anon key is public by design; RLS protects data). Lets the SPA build without env coupling.
app.get('/api/config', (c) => c.json({ supabaseUrl: c.env.SUPABASE_URL, supabaseAnonKey: c.env.SUPABASE_ANON_KEY }));
app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404));

export default app;
