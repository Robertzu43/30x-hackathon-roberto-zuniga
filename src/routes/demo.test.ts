// Task 10 (AC-45, AC-46, AC-47, R-15, R-18): the public demo overview, "Reiniciar demo" and scripts/seed-demo-user.mjs,
// all with fake clients, never the real Supabase.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDb } from '../agent/__fixtures__/fake-db';
import type { Env } from '../env';

type Row = Record<string, unknown>;
const { runAgent } = vi.hoisted(() => ({ runAgent: vi.fn(async (...args: unknown[]) => args && ({ PAGAR: 1, FRENAR: 0, ESCALAR: 0, errors: 0 })) }));
let db: ReturnType<typeof testDb>;
// userClient(env, anonKey) is the sign-in client; userClient(env, jwt) the user's RLS client.
vi.mock('../lib/supabase', async (orig) => ({ ...(await orig<typeof import('../lib/supabase')>()), userClient: () => db }));
vi.mock('../agent/loop', () => ({ runAgent }));

const PASSWORD = 'andina-demo-2026';
const USERS: Record<string, string> = { 'tok-demo': 'user-demo', 'tok-a': 'user-a' };
const LOGINS: Record<string, string> = { 'demo@andina-labs.example': 'tok-demo', 'a@a.example': 'tok-a' };
const env = { SUPABASE_URL: 'https://sb.test', SUPABASE_ANON_KEY: 'anon', DEMO_EMAIL: 'demo@andina-labs.example' } as Env;

function testDb() {
  const inv = (id: string, company_id: string): Row => ({ id, company_id, source: 'chat', archived: false, received_at: '2026-10-10T15:00:00Z', expected_outcome: 'PAGAR', fields: {} });
  const base = fakeDb({
    company_members: [{ company_id: 'D', user_id: 'user-demo' }, { company_id: 'A', user_id: 'user-a' }],
    companies: [{ id: 'A', name: 'Otra', is_demo: false }, { id: 'D', name: 'Andina Labs Inc.', is_demo: true }],
    invoices: [inv('D-1', 'D'), inv('D-2', 'D'), inv('A-1', 'A')],
    decisions: [{ id: 'd1', invoice_id: 'D-1', company_id: 'D', seq: 1, outcome: 'PAGAR', actor: 'agent', amount_usd: 100, checks: [{}], headline_es: 'PAGAR · 100 USD', headline_en: 'PAY · 100 USD' }],
    policies: [{ company_id: 'D', version: 1, name: 'Política general', rules: { period_budget_usd: 42000, account_balance_usd: 23000 } }],
  });
  const calls: string[] = [];
  const signIns: string[] = [];
  return {
    ...base, calls, signIns,
    rpc: async (name: string, args: Row = {}) => {
      if (name !== 'reset_demo_company') return base.rpc(name, args);
      calls.push('reset_demo_company');
      return { data: 'D', error: null };
    },
    auth: {
      getUser: async (jwt: string) => (USERS[jwt] ? { data: { user: { id: USERS[jwt], user_metadata: {} } }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } }),
      signInWithPassword: async ({ email, password }: { email: string; password: string }) => {
        signIns.push(email);
        return LOGINS[email] && password === PASSWORD
          ? { data: { session: { access_token: LOGINS[email], expires_in: 3600 } }, error: null }
          : { data: { session: null }, error: { message: 'Invalid login credentials' } };
      },
    },
  };
}

let app: (typeof import('../index'))['app'];
beforeEach(async () => {
  vi.resetModules(); // a fresh isolate: the demo token cache starts empty
  ({ app } = await import('../index'));
  db = testDb();
  runAgent.mockClear();
  runAgent.mockImplementation(async () => { db.calls.push('runAgent'); return { PAGAR: 1, FRENAR: 0, ESCALAR: 0, errors: 0 }; });
});
const get = (e: Env = env) => app.request('/api/demo/overview', {}, e);
const reset = (token?: string) => app.request('/api/demo/reset', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {} }, env);

describe('GET /api/demo/overview (AC-45)', () => {
  it('needs no account and answers only the demo company rows, its Periodo figures and a public 60 s cache', async () => {
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.headers.get('Cache-Control')).toBe('public, max-age=60');
    const body = (await r.json()) as { invoices: Row[]; period: Row };
    expect(body.invoices.map((i) => i.id).sort()).toEqual(['D-1', 'D-2']);
    expect(body.invoices.find((i) => i.id === 'D-1')).toMatchObject({ outcome: 'PAGAR', headline: 'PAGAR · 100 USD', headline_en: 'PAY · 100 USD' });
    expect(body.period).toMatchObject({ budget_usd: 42000, autonomy: { n: 1, m: 2 }, violations: 0 });
    expect(db.signIns).toEqual(['demo@andina-labs.example']);
  });

  it('signs the demo user in once per isolate, not once per visit', async () => {
    await get();
    await get();
    expect(db.signIns).toHaveLength(1);
  });

  it('answers 503 in Spanish, never cached, when the demo user cannot sign in', async () => {
    const r = await get({ ...env, DEMO_EMAIL: 'nadie@andina-labs.example' });
    expect(r.status).toBe(503);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    expect(await r.json()).toEqual({ error: 'La demo no está disponible en este momento. Intenta de nuevo en unos minutos.' });
  });

  it('answers 503 and shows nothing when the demo user belongs to a company that is not the demo company', async () => {
    const r = await get({ ...env, DEMO_EMAIL: 'a@a.example' });
    expect(r.status).toBe(503);
    expect(JSON.stringify(await r.json())).not.toContain('A-1');
  });
});

describe('POST /api/demo/reset (AC-47, R-15)', () => {
  it('answers 401 without a session', async () => {
    expect((await reset()).status).toBe(401);
    expect(db.calls).toEqual([]);
  });

  it('answers 403 to a member of any other company and resets nothing', async () => {
    const r = await reset('tok-a');
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: 'Solo los miembros de la empresa demo pueden reiniciarla' });
    expect(db.calls).toEqual([]);
  });

  it('resets the demo company, then re-runs the agent on its pending invoices (trigger reset) and returns the counts', async () => {
    const r = await reset('tok-demo');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ PAGAR: 1, FRENAR: 0, ESCALAR: 0, errors: 0 });
    expect(db.calls).toEqual(['reset_demo_company', 'runAgent']);
    expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({ db, env }), 'D', 'pending', 'reset');
  });
});

// scripts/seed-demo-user.mjs (AC-46, R-18): the orchestrator runs it after migrations and deploy; here with fakes.
interface Seed { main(d: Row): Promise<unknown>; DEMO_PASSWORD: string; demoEmailFrom(toml: string): string }
const loadScript = async () => (await import('../../scripts/seed-demo-user.mjs' as string)) as Seed;

function scriptFakes(existing: Array<{ id: string; email: string }>) {
  const log: string[] = [];
  const users = [...existing];
  const companies: Row[] = [{ id: 'C-demo', name: 'demo', is_demo: false, approver_email: 'demo@andina-labs.example' }];
  const builder = (table: string) => {
    const eqs: Row = {};
    let patch: Row | null = null;
    const b = {
      select: () => b, update: (p: Row) => { patch = p; return b; },
      eq: (c: string, v: unknown) => { eqs[c] = v; return b; },
      single: () => b,
      then: (ok: (v: unknown) => unknown) => {
        log.push(`${patch ? 'update' : 'select'} ${table} ${JSON.stringify(eqs)}${patch ? ` ${JSON.stringify(patch)}` : ''}`);
        if (patch) companies.filter((c) => c.id === eqs.id).forEach((c) => Object.assign(c, patch));
        return Promise.resolve(table === 'company_members' ? { data: { company_id: 'C-demo' }, error: null } : { data: null, error: null }).then(ok);
      },
    };
    return b;
  };
  const admin = {
    from: builder,
    auth: { admin: {
      listUsers: async ({ page }: { page: number }) => { log.push(`listUsers ${page}`); return { data: { users: page === 1 ? users : [] }, error: null }; },
      createUser: async (a: Row) => { log.push(`createUser ${JSON.stringify(a)}`); const u = { id: 'u-new', email: String(a.email) }; users.push(u); return { data: { user: u }, error: null }; },
      updateUserById: async (id: string, a: Row) => { log.push(`updateUserById ${id} ${JSON.stringify(a)}`); return { data: { user: { id } }, error: null }; },
    } },
  };
  const anon = { auth: { signInWithPassword: async (a: Row) => { log.push(`signIn ${a.email} ${a.password}`); return { data: { session: { access_token: 'tok-demo' } }, error: null }; } } };
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    log.push(`${init.method} ${url} ${(init.headers as Record<string, string>).Authorization}`);
    return new Response(JSON.stringify({ PAGAR: 15, FRENAR: 3, ESCALAR: 11, errors: 0 }), { status: 200 });
  });
  const deps = { admin, anon, fetch, appUrl: 'https://app.test', demoEmail: 'demo@andina-labs.example', approverEmail: 'roberto@heartbeat.example', log: () => {} };
  return { log, companies, deps };
}

describe('scripts/seed-demo-user.mjs (AC-46, R-18)', () => {
  it('creates the demo user when missing, marks its company as the demo company and runs the agent through the app', async () => {
    const { main, DEMO_PASSWORD } = await loadScript();
    expect(DEMO_PASSWORD).toBe(PASSWORD);
    expect((await import('./demo')).DEMO_PASSWORD).toBe(PASSWORD); // the route and the script share one public value
    const { log, companies, deps } = scriptFakes([{ id: 'u-other', email: 'otra@x.example' }]);
    expect(await main(deps)).toEqual({ PAGAR: 15, FRENAR: 3, ESCALAR: 11, errors: 0 });
    expect(log).toEqual([
      'listUsers 1',
      `createUser ${JSON.stringify({ email: 'demo@andina-labs.example', password: PASSWORD, email_confirm: true, user_metadata: { lang: 'es' } })}`,
      `updateUserById u-new ${JSON.stringify({ password: PASSWORD })}`,
      'select company_members {"user_id":"u-new"}',
      'update companies {"id":"C-demo"} {"is_demo":true,"approver_email":"roberto@heartbeat.example","name":"Andina Labs Inc."}',
      `signIn demo@andina-labs.example ${PASSWORD}`,
      'POST https://app.test/api/invoices/run Bearer tok-demo',
    ]);
    expect(companies[0]).toMatchObject({ is_demo: true, approver_email: 'roberto@heartbeat.example', name: 'Andina Labs Inc.' });
  });

  it('on a re-run finds the existing user (any case), never creates or deletes, and resets the password (R-18)', async () => {
    const { main } = await loadScript();
    const { log, deps } = scriptFakes([{ id: 'u-demo', email: 'Demo@Andina-Labs.example' }]);
    await main(deps);
    expect(log.filter((l) => /createUser|delete/i.test(l))).toEqual([]);
    expect(log).toContain(`updateUserById u-demo ${JSON.stringify({ password: PASSWORD })}`);
  });

  it('takes the demo email from wrangler.toml only: a different env.DEMO_EMAIL is ignored (AC-46, same value as the Worker)', async () => {
    const { demoEmailFrom } = await loadScript();
    vi.stubEnv('DEMO_EMAIL', 'otro@x.example');
    const { readFileSync } = (await import('node:fs' as string)) as { readFileSync(u: URL, enc: string): string }; // no @types/node in this project
    expect(demoEmailFrom(readFileSync(new URL('../../wrangler.toml', import.meta.url), 'utf8'))).toBe('demo@andina-labs.example');
    vi.unstubAllEnvs();
  });

  it('throws when wrangler.toml has no DEMO_EMAIL, with no hardcoded fallback', async () => {
    const { demoEmailFrom } = await loadScript();
    expect(() => demoEmailFrom('[vars]\nSUPABASE_URL = "https://sb.test"\n')).toThrow('DEMO_EMAIL');
  });

  it('fails loudly when the app refuses the agent run', async () => {
    const { main } = await loadScript();
    const { deps } = scriptFakes([{ id: 'u-demo', email: 'demo@andina-labs.example' }]);
    deps.fetch.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    await expect(main(deps)).rejects.toThrow('POST /api/invoices/run answered 500');
  });
});
