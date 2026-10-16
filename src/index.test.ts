import { expect, test } from 'vitest';
import app from './index';

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
  const res = await app.request('/api/config', {}, { SUPABASE_URL: 'u', SUPABASE_ANON_KEY: 'k', SUPABASE_SERVICE_ROLE_KEY: 'secret' });
  expect(await res.json()).toEqual({ supabaseUrl: 'u', supabaseAnonKey: 'k' });
});
