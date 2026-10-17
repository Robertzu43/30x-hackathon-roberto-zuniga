// PortalApi, the vendor portal's only door into the main Worker (AC-85 item 1, R-56): RPC methods, no HTTP route.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from './env';
import type { Budget } from './lib/supabase';

const used: number[] = []; // each call's budget as it reaches intake.ts
const spy = (out: unknown) => vi.fn(async (_e: Env, b: Budget) => { used.push(b.used); return out; });
vi.mock('./agent/intake', () => ({
  intake: spy({ ok: true, reply: { es: [], en: [] }, status_path: '/estado/x' }),
  portalStatus: spy({ ok: false, error: 'invalid' }),
  portalCompany: spy({ name: 'Andina Labs Inc.' }),
}));
const intakeMod = await import('./agent/intake');
const { PortalApi } = await import('./portal-api');
const { app } = await import('./index');

const env = { PORTAL_URL: 'https://facturas.test' } as Env;
const api = new PortalApi({} as ExecutionContext, env);

beforeEach(() => { used.length = 0; vi.clearAllMocks(); });

describe('PortalApi (AC-85 item 1)', () => {
  it('passes each call to intake.ts with the env and a fresh budget that already counts the binding call (R-56)', async () => {
    const input = { slug: 'andina-labs', text: 'factura', ip: '203.0.113.7' };
    expect(await api.intake(input)).toEqual({ ok: true, reply: { es: [], en: [] }, status_path: '/estado/x' });
    expect(await api.status('tok', '203.0.113.7')).toEqual({ ok: false, error: 'invalid' });
    expect(await api.company('andina-labs')).toEqual({ name: 'Andina Labs Inc.' });
    expect(vi.mocked(intakeMod.intake).mock.calls[0]).toEqual([env, expect.anything(), input]);
    expect(vi.mocked(intakeMod.portalStatus).mock.calls[0]).toEqual([env, expect.anything(), 'tok', '203.0.113.7']);
    expect(vi.mocked(intakeMod.portalCompany).mock.calls[0]).toEqual([env, expect.anything(), 'andina-labs']);
    expect(used).toEqual([1, 1, 1]);
  });

  it('the main Worker has no public intake route: POST /api/portal/andina-labs is the JSON 404', async () => {
    const res = await app.request('/api/portal/andina-labs', { method: 'POST', body: 'text=factura' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
    expect(intakeMod.intake).toHaveBeenCalledTimes(0);
  });

  it('src/index.ts exports PortalApi as the named entrypoint the facturas binding names', async () => {
    expect((await import('./index')).PortalApi).toBe(PortalApi);
  });
});
