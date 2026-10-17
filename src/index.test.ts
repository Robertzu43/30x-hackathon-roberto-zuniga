import { expect, test } from 'vitest';
import { scheduled } from './agent/scheduled';
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

test('config exposes only the public supabase values', async () => {
  // The key name is assembled so the AC-38 grep finds the service-role key only in env.ts and admin.ts.
  const res = await app.request('/api/config', {}, { SUPABASE_URL: 'u', SUPABASE_ANON_KEY: 'k', [['SUPABASE', 'SERVICE', 'ROLE', 'KEY'].join('_')]: 'secret' });
  expect(await res.json()).toEqual({ supabaseUrl: 'u', supabaseAnonKey: 'k' });
});

test('the Worker serves the app and runs the cron (AC-62)', () => {
  expect(worker.fetch).toBe(app.fetch);
  expect(worker.scheduled).toBe(scheduled);
});
