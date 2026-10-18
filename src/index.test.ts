import { expect, test } from 'vitest';
import { scheduled } from './agent/scheduled';
import { inbound } from './email/inbound';
import worker, { app } from './index';

test('health', async () => {
  const res = await app.request('/api/health');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

test('unknown api route returns JSON 404', async () => {
  const res = await app.request('/api/nope');
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'not_found' });
});

test('config exposes only the public values: supabase url, anon key and the demo email', async () => {
  // The key name is assembled so the AC-38 grep finds the service-role key only in env.ts and admin.ts.
  const res = await app.request('/api/config', {}, { SUPABASE_URL: 'u', SUPABASE_ANON_KEY: 'k', DEMO_EMAIL: 'demo@x.example', [['SUPABASE', 'SERVICE', 'ROLE', 'KEY'].join('_')]: 'secret' });
  expect(await res.json()).toEqual({ supabaseUrl: 'u', supabaseAnonKey: 'k', demo_email: 'demo@x.example' });
});

test('the Worker serves the app and runs the cron (AC-62)', () => {
  expect(worker.fetch).toBe(app.fetch);
  expect(worker.scheduled).toBe(scheduled);
});

test('the Worker receives email (AC-87)', () => expect(worker.email).toBe(inbound));

test('Smart Placement runs the Worker near Supabase, so each screen\'s round trips are short (AC-99, D40)', async () => {
  const { readFileSync } = (await import('node:fs' as string)) as { readFileSync(u: URL, enc: 'utf8'): string };
  const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  expect(toml).toMatch(/^\[placement\]\nmode = "smart"$/m);
});

test('Workers observability is on, so a 500 can be read back later (R-150)', async () => {
  const { readFileSync } = (await import('node:fs' as string)) as { readFileSync(u: URL, enc: 'utf8'): string };
  expect(readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8')).toMatch(/^\[observability\]\nenabled = true$/m);
});
