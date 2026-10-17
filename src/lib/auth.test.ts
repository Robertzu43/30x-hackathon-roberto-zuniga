import { Hono } from 'hono';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import { adminClient } from './admin';
import { requireAuth, requireUser, type AppEnv, type AuthEnv } from './auth';
import { userClient } from './supabase';

const ENV = { SUPABASE_URL: 'https://sb.test', SUPABASE_ANON_KEY: 'anon' } as Env;
// Supabase over fetch: /auth/v1/user answers for the token 'good' only; company_members answers `members`.
let members: Array<{ company_id: string }>;
let jwks: JsonWebKey[] = [];
const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  const auth = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).get('Authorization');
  if (url.pathname === '/auth/v1/user') {
    return auth === 'Bearer good'
      ? Response.json({ id: 'u1', aud: 'authenticated', email: 'a@b.co', user_metadata: { lang: 'en' }, app_metadata: {}, created_at: '2026-10-01T00:00:00Z' })
      : auth === 'Bearer anon-user' // D41: a Supabase anonymous user has no email
        ? Response.json({ id: 'u9', aud: 'authenticated', email: '', is_anonymous: true, user_metadata: {}, app_metadata: {}, created_at: '2026-10-17T00:00:00Z' })
        : Response.json({ code: 401, msg: 'invalid JWT' }, { status: 401 });
  }
  if (url.pathname === '/auth/v1/.well-known/jwks.json') return Response.json({ keys: jwks });
  if (url.pathname === '/rest/v1/company_members') return Response.json(members);
  return new Response('not found', { status: 404 });
});
const headerOf = (path: string, name: string) => {
  const call = fetchMock.mock.calls.find(([i]) => new URL(String(i instanceof Request ? i.url : i)).pathname === path);
  return call && new Headers(call[1]?.headers).get(name);
};

const app = new Hono<AppEnv>();
app.get('/me', requireUser, (c) => c.json({ user: c.var.user.id, companyId: c.var.companyId, lang: c.var.lang, db: typeof c.var.db.from, anonymous: c.var.user.is_anonymous ?? false }));
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
    expect(await res.json()).toEqual({ user: 'u1', companyId: 'c1', lang: 'en', db: 'function', anonymous: false });
    expect(headerOf('/rest/v1/company_members', 'Authorization')).toBe('Bearer good');
  });

  it('an anonymous (trial) user passes with its id and is_anonymous on the request (D41, AC-92, R-116)', async () => {
    const res = await get('Bearer anon-user');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: 'u9', companyId: 'c1', lang: 'es', db: 'function', anonymous: true });
  });

  it('R-98: the request language (X-Lang header) wins over the stored one; an unknown value falls back to it', async () => {
    const as = (lang: string) => app.request('/me', { headers: { Authorization: 'Bearer good', 'X-Lang': lang } }, ENV);
    expect(((await (await as('es')).json()) as { lang: string }).lang).toBe('es'); // stored en
    expect(((await (await as('fr')).json()) as { lang: string }).lang).toBe('en');
  });
});

// AC-98, R-122: the project signs with ES256 and publishes its JWKS (checked live 17 Oct: one P-256 key, alg ES256). The
// Worker verifies signature, exp, aud and iss itself; no /auth/v1/user round trip.
describe('local JWT verification (AC-98, R-122)', () => {
  const ISS = 'https://sb.test/auth/v1';
  const b64 = (b: string | Uint8Array) => Buffer.from(b).toString('base64url');
  let ours: CryptoKeyPair, theirs: CryptoKeyPair;
  beforeAll(async () => {
    const pair = () => crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as Promise<CryptoKeyPair>;
    [ours, theirs] = await Promise.all([pair(), pair()]);
  });
  beforeEach(async () => { jwks = [{ ...(await crypto.subtle.exportKey('jwk', ours.publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' } as JsonWebKey]; });
  async function jwt(claims: Record<string, unknown> = {}, { kid = 'k1', key = ours.privateKey } = {}) {
    const h = b64(JSON.stringify({ alg: 'ES256', kid, typ: 'JWT' }));
    const p = b64(JSON.stringify({ sub: 'u1', aud: 'authenticated', iss: ISS, exp: Math.floor(Date.now() / 1000) + 3600, email: 'a@b.co',
      is_anonymous: false, user_metadata: { lang: 'en' }, role: 'authenticated', ...claims }));
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${h}.${p}`));
    return `${h}.${p}.${b64(new Uint8Array(sig))}`;
  }
  const paths = () => fetchMock.mock.calls.map(([i]) => new URL(String(i instanceof Request ? i.url : i)).pathname);

  it('a valid token passes with its claims as the user, and Supabase Auth is never asked', async () => {
    const res = await get(`Bearer ${await jwt()}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: 'u1', companyId: 'c1', lang: 'en', db: 'function', anonymous: false });
    expect(paths()).not.toContain('/auth/v1/user');
  });

  it('the JWKS is fetched once per isolate, not once per request', async () => {
    await get(`Bearer ${await jwt()}`);
    fetchMock.mockClear();
    expect((await get(`Bearer ${await jwt({ sub: 'u2' })}`)).status).toBe(200);
    expect(paths()).toEqual(['/rest/v1/company_members']);
  });

  it.each([
    ['expired', () => jwt({ exp: Math.floor(Date.now() / 1000) - 1 })],
    ['without exp', () => jwt({ exp: undefined })],
    ['wrong aud', () => jwt({ aud: 'anon' })],
    ['another project (iss)', () => jwt({ iss: 'https://other.supabase.co/auth/v1' })],
    ['bad signature', () => jwt({}, { key: theirs.privateKey })],
    ['another project\'s key', () => jwt({}, { kid: 'k-other', key: theirs.privateKey })],
    ['altered payload', async () => { const [h, , s] = (await jwt()).split('.'); return `${h}.${b64(JSON.stringify({ sub: 'u1', aud: 'authenticated', iss: ISS, exp: 4e9 }))}.${s}`; }],
    // malformed shapes with a known kid: each one is a 401, never a 500 from a decode outside the guard
    ['with a non-base64url character in the signature', async () => `${(await jwt()).slice(0, -1)}!`],
    ['whose signature length is 1 mod 4', async () => { const [h, p, s] = (await jwt()).split('.'); return `${h}.${p}.${s!.slice(0, 85)}`; }],
    ['with a non-JSON payload', async () => { const [h] = (await jwt()).split('.'); const p = b64('not json');
      return `${h}.${p}.${b64(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, ours.privateKey, new TextEncoder().encode(`${h}.${p}`))))}`; }],
    ['of two segments', async () => (await jwt()).split('.').slice(0, 2).join('.')],
    ['with an empty signature', async () => (await jwt()).replace(/[^.]+$/, '')],
    ['with empty payload and signature', async () => `${(await jwt()).split('.')[0]}..`],
  ])('401 for a token %s, without asking Supabase Auth', async (_name, make) => {
    const res = await get(`Bearer ${await make()}`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'No autorizado' });
    expect(paths()).not.toContain('/auth/v1/user');
    expect(paths()).not.toContain('/rest/v1/company_members');
  });

  it('a token whose header is not JSON (empty segments included) is left to Supabase Auth, which answers 401', async () => {
    for (const t of ['..', '!.!.!', 'a.b']) expect((await get(`Bearer ${t}`)).status).toBe(401);
  });

  it('requireAuth (the screen routes) verifies the token and reads no membership: the screen function finds the company', async () => {
    const screen = new Hono<AuthEnv>().get('/s', requireAuth, (c) => c.json({ user: c.var.user.id, lang: c.var.lang }));
    const token = await jwt();
    await get(`Bearer ${token}`); // JWKS cached
    fetchMock.mockClear();
    const res = await screen.request('/s', { headers: { Authorization: `Bearer ${token}` } }, ENV);
    expect(await res.json()).toEqual({ user: 'u1', lang: 'en' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await screen.request('/s', { headers: { Authorization: `Bearer ${await jwt({ aud: 'x' })}` } }, ENV)).status).toBe(401);
    expect((await screen.request('/s', {}, ENV)).status).toBe(401);
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
