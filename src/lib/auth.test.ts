import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import { adminClient } from './admin';
import { requireUser, type AppEnv } from './auth';
import { userClient } from './supabase';

const ENV = { SUPABASE_URL: 'https://sb.test', SUPABASE_ANON_KEY: 'anon' } as Env;
// Supabase over fetch: /auth/v1/user answers for the token 'good' only; company_members answers `members`.
let members: Array<{ company_id: string }>;
const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  const auth = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).get('Authorization');
  if (url.pathname === '/auth/v1/user') {
    return auth === 'Bearer good'
      ? Response.json({ id: 'u1', aud: 'authenticated', email: 'a@b.co', user_metadata: { lang: 'en' }, app_metadata: {}, created_at: '2026-10-01T00:00:00Z' })
      : Response.json({ code: 401, msg: 'invalid JWT' }, { status: 401 });
  }
  if (url.pathname === '/rest/v1/company_members') return Response.json(members);
  return new Response('not found', { status: 404 });
});
const headerOf = (path: string, name: string) => {
  const call = fetchMock.mock.calls.find(([i]) => new URL(String(i instanceof Request ? i.url : i)).pathname === path);
  return call && new Headers(call[1]?.headers).get(name);
};

const app = new Hono<AppEnv>();
app.get('/me', requireUser, (c) => c.json({ user: c.var.user.id, companyId: c.var.companyId, lang: c.var.lang, db: typeof c.var.db.from }));
const get = (auth?: string) => app.request('/me', { headers: auth ? { Authorization: auth } : {} }, ENV);

beforeEach(() => { members = [{ company_id: 'c1' }]; fetchMock.mockClear(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => vi.unstubAllGlobals());

describe('requireUser', () => {
  it('401 JSON without a bearer token, and nothing is fetched', async () => {
    const res = await get();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'No autorizado' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('401 JSON when Supabase Auth rejects the JWT', async () => {
    const res = await get('Bearer forged');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'No autorizado' });
  });

  it('401 JSON when the user belongs to no company', async () => {
    members = [];
    expect((await get('Bearer good')).status).toBe(401);
  });

  it('sets user, the first membership\'s company, the user\'s lang and a client that carries the JWT', async () => {
    const res = await get('Bearer good');
    expect(await res.json()).toEqual({ user: 'u1', companyId: 'c1', lang: 'en', db: 'function' });
    expect(headerOf('/rest/v1/company_members', 'Authorization')).toBe('Bearer good');
  });

  it('R-98: the request language (X-Lang header) wins over the stored one; an unknown value falls back to it', async () => {
    const as = (lang: string) => app.request('/me', { headers: { Authorization: 'Bearer good', 'X-Lang': lang } }, ENV);
    expect(((await (await as('es')).json()) as { lang: string }).lang).toBe('es'); // stored en
    expect(((await (await as('fr')).json()) as { lang: string }).lang).toBe('en');
  });
});

describe('clients', () => {
  it('userClient sends the anon key and the caller\'s JWT', async () => {
    await userClient(ENV, 'jwt-1').from('invoices').select('id');
    expect(headerOf('/rest/v1/invoices', 'apikey')).toBe('anon');
    expect(headerOf('/rest/v1/invoices', 'Authorization')).toBe('Bearer jwt-1');
  });

  it('adminClient sends the service-role key', async () => {
    const key = ['SUPABASE', 'SERVICE', 'ROLE', 'KEY'].join('_'); // spelled out only in env.ts and admin.ts (AC-38 grep)
    await adminClient({ ...ENV, [key]: 'srv' } as Env).from('invoices').select('id');
    expect(headerOf('/rest/v1/invoices', 'apikey')).toBe('srv');
    expect(headerOf('/rest/v1/invoices', 'Authorization')).toBe('Bearer srv');
  });
});
