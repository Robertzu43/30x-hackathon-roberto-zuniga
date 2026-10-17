/// <reference types="vite/client" />
// «Pregúntale a Thesaurus» (AC-67, AC-38, R-87): the app from src/index.ts with a fake db and a fake provider. No test reaches
// a real model or the network (R-94).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sql from '../../supabase/migrations/20261017000300_seed_andina.sql?raw';
import { fakeDb } from '../agent/__fixtures__/fake-db';
import { seedConfidence } from '../engine/__fixtures__/seed';
import type { Env } from '../env';
import { en, es } from '../i18n/features/ask';
import { ASK_SYSTEM } from '../prompts/ask';
import { uid } from './__fixtures__/uid';

type Row = Record<string, unknown>;
const SEED = JSON.parse(sql.match(/\$seed\$([\s\S]*?)\$seed\$/)?.[1] ?? 'null');
const NOW = '2026-10-17T15:00:00Z';
const DEMO = 'demo@andina-labs.example';
const USERS: Record<string, { id: string; email: string; user_metadata: Row }> = {
  'tok-a': { id: 'user-a', email: 'juan@andina.co', user_metadata: {} },
  'tok-d': { id: 'user-d', email: 'Demo@Andina-Labs.example', user_metadata: {} },
  'tok-en': { id: 'user-en', email: 'ana@andina.co', user_metadata: { lang: 'en' } },
};

// take_question of migration 20261017000700: 10 per key and day, 500 for the deployment (scripts/tests/schema.test.sh runs the SQL).
const quota = { keys: new Map<string, number>(), global: 0, fail: false };
function takeQuestion(key: string) {
  if (quota.fail) return { data: null, error: { message: 'connection refused' } };
  const n = quota.keys.get(key) ?? 0;
  if (n >= 10) return { data: { reason: 'user_cap' }, error: null };
  if (quota.global >= 500) return { data: { reason: 'ai_quota' }, error: null };
  quota.keys.set(key, n + 1);
  quota.global++;
  return { data: { remaining: 9 - n }, error: null };
}

let db: ReturnType<typeof testDb>;
// Every call the service-role client makes, by name: the ask route may make take_question only (AC-38).
const adminCalls: string[] = [];
function testDb() {
  const base = fakeDb({
    company_members: [{ company_id: 'A', user_id: 'user-a' }, { company_id: 'A', user_id: 'user-d' }, { company_id: 'A', user_id: 'user-en' }],
    companies: [{ id: 'A', name: 'Andina', approver_email: 'juan@andina.co', lang: 'es', is_demo: false }, { id: 'B', name: 'Otra', is_demo: false }],
    policies: [{ id: 'p1', company_id: 'A', version: 1, name: 'Política general', rules: SEED.rules, created_at: '2026-10-01T00:00:00Z' }],
    beneficiaries: SEED.beneficiaries.map((b: object, i: number) => ({ ...b, id: uid(`b${i}`), company_id: 'A', archived: false })),
    invoices: [['A', '04'], ['A', '11'], ['A', '02'], ['B', '05']].map(([company, nn], i) => {
      const r = (SEED.invoices as Array<{ nn: string; source: string; raw_text: string | null; fields: { amount?: unknown } }>).find((x) => x.nn === nn)!;
      return { id: uid(`${company}-${nn}`), company_id: company, source: r.source, raw_text: r.raw_text, archived: false, file_path: null,
        received_at: new Date(Date.parse(NOW) - (i + 1) * 36e5).toISOString(),
        fields: { ...r.fields, issue_date: '2026-10-17', due_date: '2026-12-01', confidence: seedConfidence(r.fields) } };
    }),
  });
  return {
    ...base,
    rpc: async (name: string, args: Row = {}, uid?: string) => {
      if (name !== 'rate_limit_hit') return base.rpc(name, args, uid);
      base.rpcs.push({ name, args });
      return { data: true, error: null };
    },
    auth: { getUser: async (jwt: string) => (USERS[jwt] ? { data: { user: USERS[jwt] }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } }) },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) },
  };
}
// The user client runs RPCs as the JWT's user (auth.uid()), as PostgREST does.
vi.mock('../lib/supabase', async (orig) => ({ ...(await orig<typeof import('../lib/supabase')>()),
  userClient: (_e: Env, jwt: string) => ({ ...db, rpc: (name: string, args?: Row) => db.rpc(name, args, USERS[jwt]?.id) }) }));
vi.mock('../lib/admin', () => ({
  adminClient: () => ({
    from: (t: string) => { adminCalls.push(`from:${t}`); return db.from(t); },
    rpc: async (name: string, args: Row) => { adminCalls.push(`rpc:${name}`); return name === 'take_question' ? takeQuestion(String(args.p_key)) : db.rpc(name, args); },
  }),
}));
vi.mock('../lib/email', async (orig) => ({ ...(await orig<typeof import('../lib/email')>()), sendEmail: vi.fn(async () => ({ sent: true })) }));
const { app } = await import('../index');

// Workers AI fake: the reader is never called here (every invoice has fields); the answer model answers `reply`.
let reply: () => Promise<unknown> = async () => ({ response: { answer: 'La frené porque supera el límite por pago.' } });
const ai = { run: vi.fn<(model: string, input: unknown) => Promise<unknown>>(() => reply()) };
const env = { AI: ai, WORKERS_AI_MODEL: 'm', DEMO_EMAIL: DEMO, APP_URL: 'https://app.test', APPROVAL_HMAC_SECRET: 's' } as unknown as Env;
const BEDROCK = { BEDROCK_MODEL_ID: 'amazon.nova-lite-v1:0', BEDROCK_REGION: 'us-east-2', AWS_BEDROCK_ACCESS_KEY_ID: 'AKIDEXAMPLE', AWS_BEDROCK_SECRET_ACCESS_KEY: 'secret' };

const call = (body: unknown, token = 'tok-a', headers: Record<string, string> = {}, e: Env = env) =>
  app.request('/api/ask', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }, e);
const ask = async (body: unknown, ...rest: [string?, Record<string, string>?, Env?]) => {
  const r = await call(body, ...rest);
  return { status: r.status, body: (await r.json()) as Row };
};
const prompt = () => (ai.run.mock.calls.at(-1)![1] as { messages: Array<{ role: string; content: string }> }).messages;
const ON_04 = { question: '¿por qué frenaste esta factura?', lang: 'es', invoice_id: uid('A-04') };

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no network in unit tests'); }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  db = testDb();
  Object.assign(quota, { keys: new Map(), global: 0, fail: false });
  // The record to ask about: the agent decides A-04 (FRENAR), A-11 (ESCALAR) and A-02 (PAGAR), then A-02 is archived.
  expect((await app.request('/api/invoices/run', { method: 'POST', headers: { Authorization: 'Bearer tok-a' } }, env)).status).toBe(200);
  db.tables.invoices!.find((i) => i.id === uid('A-02'))!.archived = true;
  adminCalls.length = 0;
  db.queries.length = 0;
  db.rpcs.length = 0;
  ai.run.mockClear();
  reply = async () => ({ response: { answer: 'La frené porque supera el límite por pago.' } });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const headline = (id: string, lang: 'es' | 'en') => String(db.tables.decisions!.find((d) => d.invoice_id === uid(id))![`headline_${lang}`]);

describe('POST /api/ask on a record (AC-67)', () => {
  it('answers with the provider and the questions left, from a prompt holding only that record and the question', async () => {
    const r = await ask(ON_04);
    expect(r).toEqual({ status: 200, body: { answer: 'La frené porque supera el límite por pago.', provider: 'Workers AI · m', remaining: 9 } });
    expect(ai.run).toHaveBeenCalledTimes(1);
    const [system, user] = prompt();
    expect(system).toEqual({ role: 'system', content: ASK_SYSTEM('es') });
    const m = /^<registro>\n([\s\S]*)\n<\/registro>\n<pregunta>\n(.*)\n<\/pregunta>$/.exec(user!.content)!;
    expect(m[2]).toBe(ON_04.question);
    expect(m[1]).toContain(headline('A-04', 'es')); // the record's own headline and timeline
    expect(m[1]).toMatch(/Límite por pago/); // a check sentence
    expect(m[1]).toContain('Nube Sur LLC'); // a read field
    expect(m[1]).not.toContain(headline('A-11', 'es')); // never another invoice of the company
    expect(m[1]).not.toContain('DR-031'); // or another company's
  });

  it('reads with the user JWT only: no insert, update or RPC but the quota function through record.ts (AC-38)', async () => {
    const before = db.tables.decisions!.length;
    expect((await ask({ ...ON_04, question: 'págala' })).status).toBe(200);
    expect(db.queries.filter((q) => q.op !== 'select')).toEqual([]);
    // AC-43's POST limit, as on every member POST, then the record's one read (AC-98): screen_detail is stable, so it cannot write
    expect(db.rpcs.map((x) => x.name)).toEqual(['rate_limit_hit', 'screen_detail']);
    expect(adminCalls).toEqual(['rpc:take_question']);
    expect(quota.keys).toEqual(new Map([['u:user-a', 1]]));
    expect(db.tables.decisions!.length).toBe(before); // «págala» changes nothing
  });

  it('puts every check sentence of the record in the context verbatim', async () => {
    await ask(ON_04);
    const d = (await (await app.request(`/api/invoices/${uid('A-04')}`, { headers: { Authorization: 'Bearer tok-a' } }, env)).json()) as { explanations: string[] };
    expect(d.explanations.length).toBeGreaterThan(0);
    const context = /<registro>\n([\s\S]*)\n<\/registro>/.exec(prompt()[1]!.content)![1]!;
    for (const sentence of d.explanations) expect(context).toContain(sentence);
  });

  it('without lang it answers in the stored language, then Spanish (R-98)', async () => {
    expect((await ask({ question: ON_04.question, invoice_id: ON_04.invoice_id }, 'tok-en')).status).toBe(200);
    expect(prompt()[0]!.content).toBe(ASK_SYSTEM('en'));
    expect(prompt()[1]!.content).toContain(headline('A-04', 'en'));
    expect((await ask({ question: ON_04.question, invoice_id: ON_04.invoice_id })).status).toBe(200);
    expect(prompt()[0]!.content).toBe(ASK_SYSTEM('es'));
  });

  it('answers in English with the English record when lang is en', async () => {
    await ask({ ...ON_04, lang: 'en' });
    const [system, user] = prompt();
    expect(system!.content).toBe(ASK_SYSTEM('en'));
    expect(user!.content).toContain(headline('A-04', 'en'));
  });

  it.each([
    ['another company', uid('B-05')],
    ['no invoice', uid('A-99')],
    ['a malformed id', 'nope'],
  ])('answers 404 for %s, without taking quota or calling the model', async (_, invoice_id) => {
    expect((await ask({ ...ON_04, invoice_id })).status).toBe(404);
    expect(adminCalls).toEqual([]);
    expect(ai.run).not.toHaveBeenCalled();
  });
});

describe('POST /api/ask on Bandeja (AC-67)', () => {
  it('grounds on the period figures and each non-archived invoice outcome and headline', async () => {
    const r = await ask({ question: '¿cuánto queda del presupuesto?', lang: 'es' });
    expect(r.status).toBe(200);
    const context = /<registro>\n([\s\S]*)\n<\/registro>/.exec(prompt()[1]!.content)![1]!;
    expect(context).toContain(headline('A-04', 'es'));
    expect(context).toContain(headline('A-11', 'es'));
    expect(context).not.toContain(headline('A-02', 'es')); // archived
    expect(context).not.toContain('DR-031');
  });
});

// QA defect (AC-67): asked «¿cuánto queda del presupuesto?», the model quoted the Saldo. Each Periodo figure is now one line,
// "<label Periodo shows>: <value as Periodo prints it>", with what it means, so no figure can pass for another.
describe('Bandeja context: the Periodo figures as Periodo shows them (AC-67, AC-44)', () => {
  const contextIn = async (lang?: 'es' | 'en') => {
    expect((await ask({ question: '¿cuánto queda del presupuesto?', ...(lang && { lang }) })).status).toBe(200);
    return /<registro>\n([\s\S]*)\n<\/registro>/.exec(prompt()[1]!.content)![1]!.split('\n');
  };
  const periodo = async () => (await (await app.request('/api/period', { headers: { Authorization: 'Bearer tok-a' } }, env)).json()) as Record<string, number>;
  // Periodo's own format (web/pages/Period.tsx): currency USD, code display, the tab's locale.
  const usd = (n: number, locale: string) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', currencyDisplay: 'code' }).format(n).replace(/[.]/g, '\\.');

  it('es: Presupuesto, Comprometido, Disponible, Pagado and Saldo each on its own line with the value Periodo returns', async () => {
    const lines = await contextIn('es');
    const p = await periodo();
    expect(p.available_usd).toBe(Math.round((p.budget_usd! - p.committed_usd!) * 100) / 100);
    for (const [label, key] of [['Presupuesto', 'budget_usd'], ['Comprometido', 'committed_usd'], ['Disponible', 'available_usd'], ['Pagado', 'paid_usd'], ['Saldo', 'balance_usd']] as const) {
      expect(lines.filter((l) => l.startsWith(`${label}: `))).toEqual([expect.stringMatching(new RegExp(`^${label}: ${usd(p[key]!, 'es-CO')}( |$)`))]);
    }
    expect(lines.find((l) => l.startsWith('Disponible: '))).toMatch(/presupuesto del periodo menos lo comprometido/);
    expect(lines.find((l) => l.startsWith('Saldo: '))).toMatch(/no es lo que queda del presupuesto/);
    expect(prompt()[0]!.content).toMatch(/quote a figure only with its label.*never compute a figure or rename one/i);
  });

  it('en: the English labels and the en-US format, without lang falling back to the stored language', async () => {
    expect((await ask({ question: 'how much budget is left?' }, 'tok-en')).status).toBe(200);
    const lines = /<registro>\n([\s\S]*)\n<\/registro>/.exec(prompt()[1]!.content)![1]!.split('\n');
    const p = await periodo();
    expect(lines).toContainEqual(expect.stringMatching(new RegExp(`^Available: ${usd(p.available_usd!, 'en-US')}( |$)`)));
    expect(lines).toContainEqual(expect.stringMatching(new RegExp(`^Balance: ${usd(p.balance_usd!, 'en-US')}( |$)`)));
  });
});

describe('quotas (AC-67, R-87)', () => {
  it("a user's 11th question of the day is user_cap, with 0 model calls", async () => {
    for (let i = 0; i < 10; i++) expect((await ask(ON_04)).body.remaining).toBe(9 - i);
    ai.run.mockClear();
    expect(await ask(ON_04)).toEqual({ status: 200, body: { answer: null, reason: 'user_cap', message: es['ask.reason.user_cap'] } });
    expect(ai.run).not.toHaveBeenCalled();
  });

  it("the day's 501st question is ai_quota, with 0 model calls", async () => {
    quota.global = 500;
    expect(await ask({ ...ON_04, lang: 'en' })).toEqual({ status: 200, body: { answer: null, reason: 'ai_quota', message: en['ask.reason.ai_quota'] } });
    expect(ai.run).not.toHaveBeenCalled();
  });

  it('the shared demo user is counted per user and client IP', async () => {
    for (let i = 0; i < 10; i++) await ask(ON_04, 'tok-d', { 'CF-Connecting-IP': '203.0.113.1' });
    expect((await ask(ON_04, 'tok-d', { 'CF-Connecting-IP': '203.0.113.1' })).body.reason).toBe('user_cap');
    expect((await ask(ON_04, 'tok-d', { 'CF-Connecting-IP': '198.51.100.2' })).body).toMatchObject({ remaining: 9 });
    expect([...quota.keys.keys()]).toEqual(['u:user-d:203.0.113.1', 'u:user-d:198.51.100.2']);
  });

  it('a member who is not the demo user is counted per user whatever the IP', async () => {
    await ask(ON_04, 'tok-a', { 'CF-Connecting-IP': '203.0.113.1' });
    await ask(ON_04, 'tok-a', { 'CF-Connecting-IP': '198.51.100.2' });
    expect(quota.keys).toEqual(new Map([['u:user-a', 2]]));
  });

  it('a quota counter that fails is failed, with 0 model calls', async () => {
    quota.fail = true;
    expect((await ask(ON_04)).body).toEqual({ answer: null, reason: 'failed', message: es['ask.reason.failed'] });
    expect(ai.run).not.toHaveBeenCalled();
  });
});

describe('non-answers are 200 with a reason (AC-67)', () => {
  it('both providers throttled: ai_quota', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"message":"Too many requests"}', { status: 429, headers: { 'x-amzn-ErrorType': 'ThrottlingException' } })));
    reply = async () => { throw new Error('4006: you have used up your daily free allocation of 10,000 neurons'); };
    expect(await ask(ON_04, 'tok-a', {}, { ...env, ...BEDROCK } as Env)).toEqual({ status: 200, body: { answer: null, reason: 'ai_quota', message: es['ask.reason.ai_quota'] } });
  });

  it.each([
    ['a throw', async () => { throw new Error('boom'); }],
    ['invalid JSON', async () => ({ response: 'claro que sí' })],
    ['an answer over 1.200 characters', async () => ({ response: { answer: 'a'.repeat(1201) } })],
  ])('%s: failed, never a guess', async (_, r) => {
    reply = r;
    expect(await ask({ ...ON_04, lang: 'en' })).toEqual({ status: 200, body: { answer: null, reason: 'failed', message: en['ask.reason.failed'] } });
  });

  it('a timeout: failed', async () => {
    vi.useFakeTimers();
    reply = () => new Promise(() => {});
    const p = ask(ON_04);
    await vi.advanceTimersByTimeAsync(25_000);
    expect((await p).body).toMatchObject({ answer: null, reason: 'failed' });
  });
});

describe('validation (AC-67)', () => {
  it.each([
    ['an empty question', { ...ON_04, question: '' }],
    ['a blank question', { ...ON_04, question: '   ' }],
    ['501 characters', { ...ON_04, question: 'a'.repeat(501) }],
    ['no question', { lang: 'es' }],
  ])('%s: 400, no quota taken, no model call', async (_, body) => {
    expect(await ask(body)).toEqual({ status: 400, body: { error: 'Escribe una pregunta de 1 a 500 caracteres.' } });
    expect(adminCalls).toEqual([]);
    expect(ai.run).not.toHaveBeenCalled();
  });

  it('a language that is not es or en falls back to the stored language: the 400 is for a bad question only', async () => {
    expect((await ask({ ...ON_04, lang: 'fr' }, 'tok-en')).status).toBe(200);
    expect(prompt()[0]!.content).toBe(ASK_SYSTEM('en'));
  });

  it('500 characters is answered', async () => {
    expect((await ask({ ...ON_04, question: 'a'.repeat(500) })).status).toBe(200);
  });

  it('answers 401 without a valid token', async () => {
    expect((await call(ON_04, 'forged')).status).toBe(401);
    expect(adminCalls).toEqual([]);
  });
});
