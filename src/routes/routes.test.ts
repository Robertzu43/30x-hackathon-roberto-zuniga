/// <reference types="vite/client" />
// Route tests for Task 8b: the app from src/index.ts with fake Supabase clients, never the real Supabase.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uid } from './__fixtures__/uid';
import { seedConfidence } from '../engine/__fixtures__/seed';
import sql from '../../supabase/migrations/20261017000300_seed_andina.sql?raw';
import { fakeDb } from '../agent/__fixtures__/fake-db';
import { bogotaDay } from '../engine/checks';
import type { Env } from '../env';
import type { Budget as BudgetT } from '../lib/supabase';

type Row = Record<string, unknown>;
type Db = ReturnType<typeof testDb>;
let db: Db;
// Both clients count on the request's Budget, as the real ones do through Budget.fetch (R-56).
const counting = (budget?: BudgetT) => { if (budget) db.meter.budget = budget; return db; };
vi.mock('../lib/supabase', async (orig) => ({ ...(await orig<typeof import('../lib/supabase')>()),
  userClient: (_e: Env, jwt: string, b?: BudgetT) => ({ ...counting(b), rpc: (name: string, args?: Row) => db.rpc(name, args, jwt) }) }));
vi.mock('../lib/admin', () => ({ adminClient: (_e: Env, b?: BudgetT) => counting(b) }));
vi.mock('../lib/email', async (orig) => ({ ...(await orig<typeof import('../lib/email')>()), sendEmail: vi.fn(async () => ({ sent: true })) }));
const { app } = await import('../index');

const SEED = JSON.parse(sql.match(/\$seed\$([\s\S]*?)\$seed\$/)?.[1] ?? 'null');
const NOW = '2026-10-17T15:00:00Z';
const USERS: Record<string, { id: string; user_metadata: Row }> = {
  'tok-a': { id: 'user-a', user_metadata: {} }, 'tok-en': { id: 'user-en', user_metadata: { lang: 'en' } }, 'tok-d': { id: 'user-d', user_metadata: {} },
};

// What the reader's model "reads" from any uploaded or pasted document: a Laura Méndez retainer that passes all 13 checks.
const READ = { payee_name: 'Laura Méndez', amount: 2500, currency: 'USD', invoice_number: '1050', issue_date: '2026-10-17', due_date: '2026-12-01',
  concept: 'Retainer mensual', bank_account: 'Bancolombia ahorros 0012-3456-4821' };
const ai = { run: vi.fn(async (model: string) => (model === 'v' ? { response: 'texto de la imagen' } // the vision model transcribes
  : { response: { ...READ, subtotal: null, tax: null, confidence: Object.fromEntries(Object.keys(READ).map((k) => [k, 0.95])) } })) };
const env = { AI: ai, APP_URL: 'https://app.test', APPROVAL_HMAC_SECRET: 'secret', WORKERS_AI_MODEL: 'm', WORKERS_AI_VISION_MODEL: 'v' } as unknown as Env;

// fake-db (src/agent) plus what only the routes use: auth, storage, and insert/update returning rows.
function testDb(seed: Record<string, Row[]> = {}) {
  const base = fakeDb({
    company_members: [{ company_id: 'A', user_id: 'user-a' }, { company_id: 'A', user_id: 'user-en' }, { company_id: 'D', user_id: 'user-d' }],
    companies: [
      { id: 'A', name: 'Andina', approver_email: 'juan.perez@a.example', lang: 'es', is_demo: false },
      { id: 'B', name: 'Otra', approver_email: 'b@b.example', lang: 'es', is_demo: false },
      { id: 'D', name: 'Andina Labs Inc.', approver_email: 'roberto@demo.example', lang: 'es', is_demo: true },
    ],
    ...seed,
  });
  const writes: Array<{ table: string; op: 'insert' | 'update'; payload: Row | Row[] }> = [];
  const uploads: Array<{ bucket: string; path: string; contentType?: string; size: number }> = [];
  const conflict = { policies: false };
  // rate_limit_hit of migration 20261017000500, per user (the JWT's) and minute; refuse/fail inject its answers.
  const rateLimit = { hits: new Map<string, number>(), refuse: false, fail: '' };
  async function rpc(name: string, args: Row = {}, jwt?: string) {
    if (name !== 'rate_limit_hit') return base.rpc(name, args);
    base.meter.hit();
    base.rpcs.push({ name, args });
    if (rateLimit.fail === 'throw') throw new TypeError('fetch failed');
    if (rateLimit.fail) return { data: null, error: { message: rateLimit.fail } };
    const key = `${USERS[jwt ?? '']?.id}|${Math.floor(Date.now() / 60000)}`;
    rateLimit.hits.set(key, (rateLimit.hits.get(key) ?? 0) + 1);
    return { data: !rateLimit.refuse && rateLimit.hits.get(key)! <= 60, error: null };
  }
  let n = 0;
  function write(table: string, op: 'insert' | 'update', payload: Row | Row[]) {
    writes.push({ table, op, payload });
    const eqs: Row = {};
    let returning = false;
    let one: false | 'single' | 'maybe' = false;
    const run = () => {
      base.meter.hit();
      const rows = (base.tables[table] ??= []);
      if (op === 'insert' && table === 'policies' && conflict.policies) {
        return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "policies_company_id_version_key"' } };
      }
      let out: Row[];
      if (op === 'insert') {
        const now = new Date().toISOString(); // column defaults of the migrations
        out = [payload].flat().map((p) => ({ id: `${table}-${++n}`, created_at: now, ...(table === 'invoices' ? { received_at: now, archived: false } : {}), ...p,
          // mirrors the policies_assign_version trigger (R-41)
          ...(table === 'policies' ? { version: Math.max(0, ...rows.filter((r) => r.company_id === p.company_id).map((r) => Number(r.version))) + 1 } : {}) }));
        rows.push(...out);
      } else {
        out = rows.filter((r) => Object.entries(eqs).every(([k, v]) => r[k] === v));
        out.forEach((r) => Object.assign(r, payload));
      }
      if (!returning) return { data: null, error: null };
      if (one === 'maybe') return { data: out[0] ?? null, error: null };
      if (one === 'single') return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { message: 'not one row' } };
      return { data: out, error: null };
    };
    const b = {
      eq: (c: string, v: unknown) => { eqs[c] = v; return b; },
      select: () => { returning = true; return b; },
      single: () => { one = 'single'; return b; },
      maybeSingle: () => { one = 'maybe'; return b; },
      then: <A, B>(ok?: (v: ReturnType<typeof run>) => A, ko?: (e: unknown) => B) => Promise.resolve().then(run).then(ok, ko),
    };
    return b;
  }
  return {
    ...base, writes, uploads, conflict, rateLimit, rpc,
    from: (t: string) => Object.assign(base.from(t), { insert: (p: Row | Row[]) => write(t, 'insert', p), update: (p: Row) => write(t, 'update', p) }),
    auth: { getUser: async (jwt: string) => (base.meter.hit(), USERS[jwt] ? { data: { user: USERS[jwt] }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } }) },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, body: ArrayBuffer, o?: { contentType?: string }) => {
          base.meter.hit();
          uploads.push({ bucket, path, contentType: o?.contentType, size: body.byteLength });
          return { data: { path }, error: null };
        },
        createSignedUrl: async (path: string, expiresIn: number) => (base.meter.hit(), { data: { signedUrl: `https://signed.test/${bucket}/${path}?expires=${expiresIn}` }, error: null }),
      }),
    },
  };
}

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
interface SeedRow { nn: string; source: string; expected_outcome: string; prev_month?: boolean; issue: number | null; due: number | null; raw_text: string | null; fields: object }
// The seed SQL's rows and date rule (as in loop.test.ts) as invoices of company `id`.
function seedInvoices(id: string, only?: string[]) {
  const start = Date.parse(`${bogotaDay(NOW).slice(0, 7)}-01T00:00:00-05:00`);
  return (SEED.invoices as SeedRow[]).filter((r) => !only || only.includes(r.nn)).map((r) => {
    const received_at = new Date(r.prev_month ? start - 5 * 864e5 : start + ((Date.parse(NOW) - start) * Number(r.nn)) / 30).toISOString();
    const day = bogotaDay(received_at);
    return {
      id: uid(`${id}-${r.nn}`), company_id: id, source: r.source, raw_text: r.raw_text, archived: false, expected_outcome: r.expected_outcome, received_at,
      file_path: r.source === 'pdf' ? `/demo/invoices/${r.nn}.pdf` : r.source === 'image' ? `/demo/invoices/${r.nn}.png` : null,
      fields: { ...r.fields, issue_date: r.issue === null ? null : addDays(day, r.issue), due_date: r.due === null ? null : addDays(day, r.due), confidence: seedConfidence(r.fields) },
    };
  });
}
const workspace = (only?: string[]) => ({
  policies: [{ id: 'p1', company_id: 'A', version: 1, name: 'Política general', rules: SEED.rules, created_at: '2026-10-01T00:00:00Z' }],
  beneficiaries: SEED.beneficiaries.map((b: object, i: number) => ({ ...b, id: uid(`A-b${i}`), company_id: 'A', archived: false })),
  invoices: [...seedInvoices('A', only), ...seedInvoices('B', ['01'])],
});

function call(method: string, path: string, body?: unknown, token: string | null = 'tok-a', e: Env = env) {
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const payload = body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body);
  return app.request(path, { method, headers, body: payload }, e);
}
const json = async <T = Row & Row[]>(r: Response) => (await r.json()) as T;
const decisionsOf = (id: string) => db.tables.decisions!.filter((d) => d.invoice_id === id);
const upload = (bytes: Uint8Array, name: string, type: string) => {
  const fd = new FormData();
  fd.append('file', new File([bytes as BlobPart], name, { type }));
  return fd;
};
const pdfFixture = async () => {
  const { readFile } = (await import('node:fs/promises' as string)) as { readFile(u: URL): Promise<Uint8Array> };
  return new Uint8Array(await readFile(new URL('../lib/__fixtures__/simple.pdf', import.meta.url)));
};
// The browser's call loop (R-60): the first endpoint, then the continuation with the cursor until it is null.
async function runAll(first = '/api/invoices/run', next = first) {
  const sum = { PAGAR: 0, FRENAR: 0, ESCALAR: 0, errors: 0, calls: 0 };
  let cursor: string | null = null;
  do {
    const r = await call('POST', sum.calls ? next : first, sum.calls ? { cursor } : undefined);
    expect(r.status).toBe(200);
    const out = await json<typeof sum & { cursor: string | null }>(r);
    for (const k of ['PAGAR', 'FRENAR', 'ESCALAR', 'errors'] as const) sum[k] += out[k];
    sum.calls++;
    cursor = out.cursor;
  } while (cursor && sum.calls < 20);
  return sum;
}
const FORMAT = 'Formato no admitido: sube un PDF, PNG o JPG de hasta 10 MB';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  ai.run.mockClear();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('auth (AC-38)', () => {
  it('answers 401 without a token or with a bad one, and changes nothing', async () => {
    db = testDb(workspace(['01']));
    expect((await call('GET', '/api/invoices', undefined, null)).status).toBe(401);
    const bad = await call('POST', '/api/invoices/run', undefined, 'forged');
    expect(bad.status).toBe(401);
    expect(await bad.json()).toEqual({ error: 'No autorizado' });
    expect(db.rpcs).toEqual([]);
  });

  it('keeps /api/config and /api/health public', async () => {
    db = testDb();
    expect((await call('GET', '/api/health', undefined, null)).status).toBe(200);
    expect((await call('GET', '/api/config', undefined, null)).status).toBe(200);
  });
});

describe('invoices (AC-11, AC-29)', () => {
  it('GET /api/invoices lists only the company invoices, with the headline in the user language', async () => {
    db = testDb(workspace(['01', '11']));
    await call('POST', '/api/invoices/run');
    const es = await json(await call('GET', '/api/invoices'));
    expect(es.map((r) => r.id).sort()).toEqual([uid('A-01'), uid('A-11')]);
    expect(es.find((r) => r.id === uid('A-01'))!.headline).toMatch(/^PAGAR · 2\.500 USD a Laura Méndez/);
    const en = await json(await call('GET', '/api/invoices', undefined, 'tok-en'));
    expect(en.find((r) => r.id === uid('A-11'))!.headline).toMatch(/^ESCALATE · 4,200 USD to Nube Sur LLC/);
  });

  it('POST /api/invoices/run decides every pending invoice (trigger manual) and returns the counts', async () => {
    db = testDb(workspace(['01', '04', '11']));
    const r = await call('POST', '/api/invoices/run');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ PAGAR: 1, FRENAR: 1, ESCALAR: 1, errors: 0, remaining: 0, cursor: null });
    expect(db.tables.agent_runs!.map((x) => [x.company_id, x.trigger])).toEqual([['A', 'manual']]);
    expect(decisionsOf(uid('B-01'))).toEqual([]);
  });

  it('POST /api/invoices with pasted email text: stores the read fields, runs the agent (ingest) and returns the decision', async () => {
    db = testDb(workspace([]));
    const text = 'De: Laura Méndez\nFactura 1050, USD 2.500, Bancolombia ahorros 0012-3456-4821';
    const r = await call('POST', '/api/invoices', { source: 'email', text });
    expect(r.status).toBe(201);
    const { invoice, decision } = (await r.json()) as { invoice: Row; decision: Row };
    const stored = db.tables.invoices!.find((i) => i.id === invoice.id)!;
    expect(stored).toMatchObject({ company_id: 'A', source: 'email', raw_text: text, file_path: null, fields: { payee_name: 'Laura Méndez', amount: 2500 } });
    expect(decision).toMatchObject({ outcome: 'PAGAR', actor: 'agent', invoice_id: invoice.id });
    expect(invoice).toMatchObject({ outcome: 'PAGAR' });
    expect(db.tables.agent_runs!.map((x) => x.trigger)).toEqual(['ingest']);
    expect(db.uploads).toEqual([]);
  });

  it('POST /api/invoices with a PDF upload stores it under files/<company_id>/<invoice_id>.pdf and sets source pdf', async () => {
    db = testDb(workspace([]));
    const r = await call('POST', '/api/invoices', upload(await pdfFixture(), 'factura.pdf', 'application/pdf'));
    expect(r.status).toBe(201);
    const { invoice } = (await r.json()) as { invoice: Row };
    expect(db.uploads).toEqual([{ bucket: 'files', path: `A/${invoice.id}.pdf`, contentType: 'application/pdf', size: expect.any(Number) }]);
    expect(db.tables.invoices!.find((i) => i.id === invoice.id)).toMatchObject({ source: 'pdf', file_path: `A/${invoice.id}.pdf` });
    expect(ai.run).toHaveBeenCalled();
  });

  it('POST /api/invoices with a PNG upload sets source image', async () => {
    db = testDb(workspace([]));
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const r = await call('POST', '/api/invoices', upload(png, 'f.png', 'image/png'));
    expect(r.status).toBe(201);
    const { invoice } = (await r.json()) as { invoice: Row };
    expect(invoice).toMatchObject({ source: 'image', file_path: `A/${invoice.id}.png` });
  });

  it.each([
    ['a .docx file', () => upload(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]), 'f.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')],
    ['a .docx renamed to .pdf', () => upload(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]), 'f.pdf', 'application/pdf')],
    ['an 11 MB PDF', () => upload(new Uint8Array(11 * 1024 * 1024).fill(0x25, 0, 1).fill(0x50, 1, 2).fill(0x44, 2, 3).fill(0x46, 3, 4), 'big.pdf', 'application/pdf')],
    ['an empty file', () => upload(new Uint8Array(0), 'f.pdf', 'application/pdf')],
    ['a 1-byte file', () => upload(new Uint8Array([0x25]), 'f.pdf', 'application/pdf')],
    ['a 2-byte file', () => upload(new Uint8Array([0x25, 0x50]), 'f.pdf', 'application/pdf')],
    ['a 3-byte file', () => upload(new Uint8Array([0x25, 0x50, 0x44]), 'f.pdf', 'application/pdf')],
    ['no file field', () => new FormData()],
    ['a JSON source that is not email or chat', () => ({ source: 'pdf', text: 'hola' })],
    ['a body that is not JSON', () => 'not json'],
  ])('POST /api/invoices refuses %s with 400 and stores nothing (AC-15)', async (_, body) => {
    db = testDb(workspace([]));
    const before = db.tables.invoices!.length;
    const r = await call('POST', '/api/invoices', body());
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: FORMAT });
    expect(db.tables.invoices!.length).toBe(before);
    expect(db.uploads).toEqual([]);
    expect(ai.run).not.toHaveBeenCalled();
  });

  it.each([
    ['missing text', () => ({ source: 'chat' })],
    ['text that is not a string', () => ({ source: 'chat', text: 42 })],
    ['blank pasted text', () => ({ source: 'chat', text: '   ' })],
    ['pasted text over 20.000 characters', () => ({ source: 'email', text: 'x'.repeat(20001) })],
  ])('POST /api/invoices refuses %s with 400 and its own message, storing nothing (AC-15, R-84)', async (_, body) => {
    db = testDb(workspace([]));
    const before = db.tables.invoices!.length;
    const r = await call('POST', '/api/invoices', body());
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: 'Pega un texto de 1 a 20.000 caracteres.' });
    expect(db.tables.invoices!.length).toBe(before);
    expect(ai.run).not.toHaveBeenCalled();
  });

  it('accepts pasted text of exactly 20.000 characters', async () => {
    db = testDb(workspace([]));
    expect((await call('POST', '/api/invoices', { source: 'chat', text: 'x'.repeat(20000) })).status).toBe(201);
  });
});

describe('GET /api/invoices/:id (AC-26, AC-08, AC-64, AC-65)', () => {
  it('returns the timeline, beneficiary, explanations, fixes, policy, trace and the stored question of an ESCALAR', async () => {
    db = testDb(workspace(['11']));
    await call('POST', '/api/invoices/run');
    const r = await call('GET', `/api/invoices/${uid('A-11')}`);
    expect(r.status).toBe(200);
    const d = (await r.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(d.invoice).toMatchObject({ id: uid('A-11'), outcome: 'ESCALAR' });
    expect(d.headline).toMatch(/^ESCALAR · 4\.200 USD a Nube Sur LLC/);
    expect(d.decisions.map((x: Row) => [x.seq, x.outcome, x.actor])).toEqual([[1, 'ESCALAR', 'agent']]);
    expect(d.beneficiary).toMatchObject({ name: 'Nube Sur LLC' });
    expect(d.explanations).toHaveLength(13);
    expect(d.fixes.length).toBeGreaterThan(0);
    expect(d.policy).toMatchObject({ name: 'Política general', version: 1 });
    expect(d.trace.map((s: Row) => s.stage)).toEqual(['lee', 'consulta', 'consulta', 'decide', 'actua']);
    expect(d.trace[4].text).toMatch(/^Le envié a juan\.perez@a\.example la pregunta/);
    expect(d.question).toMatch(/^Juan, la factura #2044 de Nube Sur LLC por 4\.200 USD supera tu umbral de aprobación de 2\.500 USD/);
    expect(d.file_url).toBe('/demo/invoices/11.pdf'); // public demo document: returned as is, never signed
  });

  it('writes the stored decision policy version into the currency line (R-49) and answers in English for an en user', async () => {
    db = testDb(workspace(['21']));
    await call('POST', '/api/invoices/run');
    const es = await json<{ explanations: string[]; question: unknown }>(await call('GET', `/api/invoices/${uid('A-21')}`));
    expect(es.explanations.some((x) => x.includes('v1'))).toBe(true);
    expect(es.question).toBeNull();
    const en = await json<{ trace: Row[]; headline: string }>(await call('GET', `/api/invoices/${uid('A-21')}`, undefined, 'tok-en'));
    expect(en.headline).toMatch(/^PAY ·/);
    expect(en.trace[0]!.text).toMatch(/^I read/);
  });

  // R-98 (AC-28 Clarified): the tab's language travels on the request (X-Lang) and wins over the stored one, then es.
  it('answers in the request language (X-Lang) over the stored one: list headline, detail headline, trace and question', async () => {
    db = testDb(workspace(['11']));
    await call('POST', '/api/invoices/run');
    const asEn = (path: string) => app.request(path, { headers: { Authorization: 'Bearer tok-a', 'X-Lang': 'en' } }, env); // tok-a stored es
    const list = await json(await asEn('/api/invoices'));
    expect(list[0]!.headline).toMatch(/^ESCALATE · 4,200 USD to Nube Sur LLC/);
    const d = await json<{ headline: string; trace: Row[]; question: string; explanations: string[]; fixes: string[] }>(await asEn(`/api/invoices/${uid('A-11')}`));
    expect(d.headline).toMatch(/^ESCALATE ·/);
    expect(d.trace[0]!.text).toMatch(/^I read/);
    expect(d.question).toMatch(/^Juan, invoice #2044/);
    expect(d.explanations.join(' ')).not.toMatch(/ cumple| no cumple/);
    const bad = await json(await app.request('/api/invoices', { headers: { Authorization: 'Bearer tok-en', 'X-Lang': 'fr' } }, env));
    expect(bad[0]!.headline).toMatch(/^ESCALATE ·/); // an unknown value falls back to the stored language
  });

  it('signs a stored file for 5 minutes (AC-08)', async () => {
    db = testDb(workspace([]));
    const { invoice } = (await (await call('POST', '/api/invoices', upload(await pdfFixture(), 'f.pdf', 'application/pdf'))).json()) as { invoice: Row };
    const d = await json(await call('GET', `/api/invoices/${invoice.id}`));
    expect(d.file_url).toBe(`https://signed.test/files/A/${invoice.id}.pdf?expires=300`);
  });

  // R-31, AC-08: members can insert any file_path through REST; only the seed's static documents and the company's own Storage keys resolve.
  it.each([
    ['a protocol-relative URL', '//attacker.example/factura.pdf'],
    ['an absolute URL', 'https://evil.example/x.pdf'],
    ['a server path', '/etc/passwd'],
    ['a traversal out of the demo folder', '/demo/invoices/../../x'],
    ['another company Storage key', 'B/x.pdf'],
    ['a Storage key with traversal', 'A/../B/x.pdf'],
  ])('returns file_url null for %s', async (_, file_path) => {
    db = testDb(workspace(['13']));
    db.tables.invoices!.find((i) => i.id === uid('A-13'))!.file_path = file_path;
    expect((await json(await call('GET', `/api/invoices/${uid('A-13')}`))).file_url).toBeNull();
  });

  it('returns a seeded demo document as is and a Storage key under the company folder signed', async () => {
    db = testDb(workspace(['13', '14']));
    db.tables.invoices!.find((i) => i.id === uid('A-13'))!.file_path = '/demo/invoices/01.png';
    db.tables.invoices!.find((i) => i.id === uid('A-14'))!.file_path = 'A/abc.jpg';
    expect((await json(await call('GET', `/api/invoices/${uid('A-13')}`))).file_url).toBe('/demo/invoices/01.png');
    expect((await json(await call('GET', `/api/invoices/${uid('A-14')}`))).file_url).toBe('https://signed.test/files/A/abc.jpg?expires=300');
  });

  it('"Lo que leí" shows a field the engine cannot trust as unknown (null), confidence kept (R-71)', async () => {
    db = testDb(workspace(['13']));
    Object.assign(db.tables.invoices!.find((i) => i.id === uid('A-13'))!.fields as Row, { due_date: 'not-a-date', amount: '2400' });
    const d = await json<{ invoice: { fields: Row } }>(await call('GET', `/api/invoices/${uid('A-13')}`));
    expect(d.invoice.fields).toMatchObject({ due_date: null, amount: null, payee_name: 'Pixel Lab', confidence: { amount: 0.97 } });
  });
  it('a pending invoice has no trace, no question and no explanations', async () => {
    db = testDb(workspace(['13']));
    const d = await json(await call('GET', `/api/invoices/${uid('A-13')}`));
    expect(d).toMatchObject({ decisions: [], trace: [], question: null, explanations: [], fixes: [], policy: null, file_url: null });
  });

  it("answers 404 for another company's invoice", async () => {
    db = testDb(workspace(['01']));
    const r = await call('GET', `/api/invoices/${uid('B-01')}`);
    expect(r.status).toBe(404);
  });
});

// AC-77, R-88: who read the invoice (recorded at read time) and, per field, the line of the stored text where code found it.
describe('"Leído por IA" reading (AC-77)', () => {
  type Reading = { provider: string; fields: Array<{ name: string; value: unknown; confidence: number | null; snippet: string | null; match: [number, number] | null }> };
  const detail = async (id: unknown, e: Env = env) =>
    json<{ reading: Reading | null; reading_status: string }>(await call('GET', `/api/invoices/${id}`, undefined, 'tok-a', e));
  const printed = (f: Reading['fields'][number]) => (f.snippet && f.match ? f.snippet.slice(...f.match) : null);

  it('an ingested invoice returns the provider and each field with its value, confidence, snippet and highlight span', async () => {
    db = testDb(workspace([]));
    const text = 'De: Laura Méndez\nFactura 1050, USD 2.500, Bancolombia ahorros 0012-3456-4821';
    const { invoice } = await json<{ invoice: Row }>(await call('POST', '/api/invoices', { source: 'email', text }));
    const { reading, reading_status } = await detail(invoice.id);
    expect(reading_status).toBe('ai');
    expect(reading!.provider).toBe('Workers AI · m');
    expect(reading!.fields.map((f) => f.name)).toEqual(['payee_name', 'amount', 'currency', 'invoice_number', 'issue_date', 'due_date', 'concept', 'bank_account']);
    const by = Object.fromEntries(reading!.fields.map((f) => [f.name, f]));
    expect(by.payee_name).toEqual({ name: 'payee_name', value: 'Laura Méndez', confidence: 0.95, snippet: 'De: Laura Méndez', match: [4, 16] });
    expect(printed(by.amount!)).toBe('2.500');
    expect(by.amount!.snippet).toBe('Factura 1050, USD 2.500, Bancolombia ahorros 0012-3456-4821');
    expect(printed(by.invoice_number!)).toBe('1050');
    expect(printed(by.currency!)).toBe('USD');
    expect(printed(by.bank_account!)).toBe('Bancolombia ahorros 0012-3456-4821');
    expect(by.due_date).toMatchObject({ value: '2026-12-01', snippet: null, match: null }); // not printed: never invented
  });

  it('the provider is the one recorded at read time, not the current model var', async () => {
    db = testDb(workspace([]));
    const { invoice } = await json<{ invoice: Row }>(await call('POST', '/api/invoices', { source: 'chat', text: 'Laura Méndez 1050' }));
    expect((await detail(invoice.id, { ...env, WORKERS_AI_MODEL: 'otro' } as Env)).reading!.provider).toBe('Workers AI · m');
  });

  it('a file ingest stores its document text in raw_text, capped at 20.000 characters, and finds snippets in it', async () => {
    db = testDb(workspace([]));
    const r = await call('POST', '/api/invoices', upload(await pdfFixture(), 'factura.pdf', 'application/pdf'));
    const { invoice } = await json<{ invoice: Row }>(r);
    expect(String(db.tables.invoices!.find((i) => i.id === invoice.id)!.raw_text)).toContain('Laura Méndez');
    expect(printed((await detail(invoice.id)).reading!.fields[0]!)).toBe('Laura Méndez');
    ai.run.mockImplementationOnce(async () => ({ response: `Laura Méndez ${'x'.repeat(25000)}` })); // the vision transcription
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const { invoice: img } = await json<{ invoice: Row }>(await call('POST', '/api/invoices', upload(png, 'f.png', 'image/png')));
    expect(String(db.tables.invoices!.find((i) => i.id === img.id)!.raw_text)).toHaveLength(20000);
  });

  it('a seeded invoice and one inserted with fields are preloaded, an unread one none; all with reading null', async () => {
    db = testDb(workspace(['01', '13', '18']));
    db.tables.invoices!.push({ id: uid('A-x'), company_id: 'A', source: 'chat', raw_text: 'Factura 1050', archived: false, received_at: NOW, fields: null });
    db.tables.invoices!.push({ id: uid('A-f'), company_id: 'A', source: 'chat', raw_text: 'Factura 1050', archived: false, received_at: NOW,
      fields: { ...READ, confidence: {} } });
    expect(await detail(uid('A-01'))).toMatchObject({ reading: null, reading_status: 'preloaded' });
    expect(await detail(uid('A-13'))).toMatchObject({ reading: null, reading_status: 'preloaded' });
    expect(await detail(uid('A-18'))).toMatchObject({ reading: null, reading_status: 'preloaded' }); // seeded «ilegible», no text stored
    expect(await detail(uid('A-f'))).toMatchObject({ reading: null, reading_status: 'preloaded' });
    expect(await detail(uid('A-x'))).toMatchObject({ reading: null, reading_status: 'none' });
  });

  it('a model that answers invalid JSON is ai: the «ilegible» read names the provider that answered (R-97)', async () => {
    db = testDb(workspace([]));
    ai.run.mockImplementationOnce(async () => ({ response: 'lo siento, no puedo' }));
    const { invoice } = await json<{ invoice: Row }>(await call('POST', '/api/invoices', { source: 'chat', text: 'una foto borrosa' }));
    const { reading, reading_status } = await detail(invoice.id);
    expect(reading_status).toBe('ai');
    expect(reading!.provider).toBe('Workers AI · m');
    expect(reading!.fields.every((f) => f.confidence === null)).toBe(true); // nothing it answered was usable
  });

  it('a corrupt PDF with no text is an «ilegible» with no model call: none, not preloaded (R-97)', async () => {
    db = testDb(workspace([]));
    const r = await call('POST', '/api/invoices', upload(new TextEncoder().encode('%PDF-roto'), 'f.pdf', 'application/pdf'));
    const { invoice } = await json<{ invoice: Row }>(r);
    expect(ai.run).not.toHaveBeenCalled();
    expect(db.tables.invoices!.find((i) => i.id === invoice.id)!.fields).toMatchObject({ concept: 'ilegible' });
    expect(await detail(invoice.id)).toMatchObject({ reading: null, reading_status: 'none' });
  });

  // R-97: who read it is decided by the read, not by where the invoice came from.
  const restInsert = (raw_text: string | null) => {
    db = testDb(workspace([]));
    db.tables.invoices!.push({ id: uid('A-r'), company_id: 'A', source: 'email', raw_text, archived: false, received_at: NOW, fields: null });
  };
  const lecturaOf = () => (decisionsOf(uid('A-r'))[0]!.checks as Row[]).find((c) => c.id === 'lectura')!;

  it('a REST-inserted invoice with fields null that a run reads is ai: provider and confidences from its decision, snippets over raw_text', async () => {
    restInsert('De: Laura Méndez\nFactura 1050, USD 2.500');
    ai.run.mockImplementationOnce(async () => ({ response: { ...READ, subtotal: null, tax: null,
      confidence: { ...Object.fromEntries(Object.keys(READ).map((k) => [k, 0.95])), payee_name: 0.92 } } }));
    expect(await json(await call('POST', '/api/invoices/run'))).toMatchObject({ errors: 0 });
    expect(db.tables.invoices!.find((i) => i.id === uid('A-r'))!.fields).toBeNull(); // AC-38 not amended
    ai.run.mockClear();
    const { reading, reading_status } = await detail(uid('A-r'), { ...env, WORKERS_AI_MODEL: 'otro' } as Env);
    expect(ai.run).not.toHaveBeenCalled();
    expect(reading_status).toBe('ai');
    expect(reading!.provider).toBe('Workers AI · m');
    const by = Object.fromEntries(reading!.fields.map((f) => [f.name, f]));
    expect(by.payee_name).toEqual({ name: 'payee_name', value: 'Laura Méndez', confidence: 0.92, snippet: 'De: Laura Méndez', match: [4, 16] });
    expect(by.amount).toMatchObject({ value: 2500, confidence: 0.95, snippet: 'Factura 1050, USD 2.500', match: [18, 23] });
  });

  it('a run read with no stored text gives every field snippet null and match null', async () => {
    restInsert('Factura 1050');
    ai.run.mockImplementationOnce(async () => ({ response: { ...READ, subtotal: null, tax: null, confidence: Object.fromEntries(Object.keys(READ).map((k) => [k, 0.95])) } }));
    await call('POST', '/api/invoices/run');
    db.tables.invoices!.find((i) => i.id === uid('A-r'))!.raw_text = null;
    const { reading, reading_status } = await detail(uid('A-r'));
    expect(reading_status).toBe('ai');
    expect(reading!.fields.every((f) => f.snippet === null && f.match === null)).toBe(true);
    expect(reading!.fields.find((f) => f.name === 'payee_name')).toMatchObject({ value: 'Laura Méndez', confidence: 0.95 });
  });

  it('the reader unavailable is unavailable, at ingest (fields) and in a run (the first decision\'s Lectura reason)', async () => {
    const QUOTA = () => Promise.reject(new Error('4006: you have used up your daily free allocation of 10,000 neurons'));
    db = testDb(workspace([]));
    ai.run.mockImplementationOnce(QUOTA);
    const { invoice } = await json<{ invoice: Row }>(await call('POST', '/api/invoices', { source: 'chat', text: 'Laura Méndez 1050' }));
    expect(await detail(invoice.id)).toMatchObject({ reading: null, reading_status: 'unavailable' });
    restInsert('Factura 1050');
    ai.run.mockImplementationOnce(QUOTA);
    await call('POST', '/api/invoices/run');
    expect(lecturaOf()).toMatchObject({ values: { reason: 'lector_no_disponible' } });
    expect(lecturaOf()).not.toHaveProperty('read_by');
    expect(await detail(uid('A-r'))).toMatchObject({ reading: null, reading_status: 'unavailable' });
  });

  it('an «ilegible» run read with no model call (empty text) and a decision written before R-97 are none', async () => {
    restInsert('');
    await call('POST', '/api/invoices/run');
    expect(ai.run).not.toHaveBeenCalled();
    expect(decisionsOf(uid('A-r'))).toHaveLength(1);
    expect(await detail(uid('A-r'))).toMatchObject({ reading: null, reading_status: 'none' });
    restInsert('Factura 1050');
    ai.run.mockImplementationOnce(async () => ({ response: { ...READ, subtotal: null, tax: null, confidence: Object.fromEntries(Object.keys(READ).map((k) => [k, 0.95])) } }));
    await call('POST', '/api/invoices/run');
    const { read_by: _, confidence: __, ...old } = lecturaOf(); // eslint-disable-line @typescript-eslint/no-unused-vars
    decisionsOf(uid('A-r'))[0]!.checks = (decisionsOf(uid('A-r'))[0]!.checks as Row[]).map((c) => (c.id === 'lectura' ? old : c));
    expect(await detail(uid('A-r'))).toMatchObject({ reading: null, reading_status: 'none' });
  });
});

// 7c live regression: an invoice inserted through REST with `fields` null is read by the loop at `lee`, which never writes
// `invoices` (AC-38). Every view then shows what the decision's stored checks recorded, never a 500 or "not read".
describe('an invoice inserted without fields, then decided (AC-26, AC-31, AC-44, AC-64)', () => {
  const unread = (rules: object = SEED.rules) => {
    db = testDb({ ...workspace(['01']), policies: [{ id: 'p1', company_id: 'A', version: 1, name: 'Política general', rules, created_at: '2026-10-01T00:00:00Z' }] });
    Object.assign(db.tables.invoices!.find((i) => i.id === uid('A-01'))!, { fields: null, source: 'email', raw_text: 'Factura 1050 de Laura Méndez por 2.500 USD' });
  };

  it('GET /api/invoices/:id answers 200 with the fields the decision read, and the invoice row keeps fields null', async () => {
    unread();
    await call('POST', '/api/invoices/run');
    const r = await call('GET', `/api/invoices/${uid('A-01')}`);
    expect(r.status).toBe(200);
    const d = (await r.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(d.invoice.fields).toMatchObject({ payee_name: 'Laura Méndez', amount: 2500, currency: 'USD', invoice_number: '1050' });
    expect(d.beneficiary).toMatchObject({ name: 'Laura Méndez' });
    expect(d.trace[0].text).toMatch(/Laura Méndez/);
    expect(db.tables.invoices!.find((i) => i.id === uid('A-01'))!.fields).toBeNull();
  });

  it('GET /api/invoices/:id answers 200 with every field unknown when the decision recorded no checks', async () => {
    unread();
    db.tables.decisions!.push({ id: 'd1', invoice_id: uid('A-01'), company_id: 'A', seq: 1, outcome: 'ESCALAR', actor: 'agent', checks: [], created_at: NOW });
    const r = await call('GET', `/api/invoices/${uid('A-01')}`);
    expect(r.status).toBe(200);
    expect((await json<{ invoice: { fields: Row } }>(r)).invoice.fields).toMatchObject({ payee_name: null, amount: null, invoice_number: null });
  });

  it('GET /api/period groups it under the payee the decision read, not "Beneficiario no leído"', async () => {
    unread();
    await call('POST', '/api/invoices/run');
    const p = await json<{ by_beneficiary: Row[] }>(await call('GET', '/api/period'));
    expect(p.by_beneficiary).toEqual([expect.objectContaining({ beneficiary: 'Laura Méndez', count: 1 })]);
  });

  it('PUT /api/policy simulates a decided one from its reading; only a never-decided one is "not read yet"', async () => {
    unread({ ...SEED.rules, approval_threshold_usd: 1000 });
    await call('POST', '/api/invoices/run');
    expect(decisionsOf(uid('A-01')).map((d) => d.outcome)).toEqual(['ESCALAR']);
    const out = await json<{ would_change: Row[]; unread_pending: number }>(await call('PUT', '/api/policy', { rules: SEED.rules }));
    expect(out.unread_pending).toBe(0);
    expect(out.would_change.map((w) => [w.invoice_id, w.from, w.to])).toEqual([[uid('A-01'), 'ESCALAR', 'PAGAR']]);
  });
});

describe('company (AC-32, R-34, R-31)', () => {
  it('GET /api/company returns the member company with is_demo', async () => {
    db = testDb();
    expect(await json(await call('GET', '/api/company'))).toMatchObject({ id: 'A', name: 'Andina', is_demo: false });
    expect(await json(await call('GET', '/api/company', undefined, 'tok-d'))).toMatchObject({ id: 'D', is_demo: true });
  });

  it.each([
    [{ name: '' }, 'El nombre de la empresa no puede estar vacío'],
    [{ name: '   ' }, 'El nombre de la empresa no puede estar vacío'],
    [{ approver_email: 'no-es-correo' }, 'El correo del aprobador no es válido'],
    [{ lang: 'fr' }, 'El idioma debe ser es o en'],
  ])('PUT /api/company %j -> 400 with a Spanish message and changes nothing', async (body, error) => {
    db = testDb();
    const r = await call('PUT', '/api/company', body);
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error });
    expect(db.writes).toEqual([]);
  });

  it('PUT /api/company on the demo company -> 403 and changes nothing', async () => {
    db = testDb();
    const r = await call('PUT', '/api/company', { approver_email: 'x@example.com' }, 'tok-d');
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: 'La empresa demo es de solo lectura' });
    expect(db.writes).toEqual([]);
  });

  it('PUT /api/company saves name, approver email and language of a non-demo company', async () => {
    db = testDb();
    const r = await call('PUT', '/api/company', { name: ' Andina SAS ', approver_email: 'ana@andina.example', lang: 'en', is_demo: true });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ id: 'A', name: 'Andina SAS', approver_email: 'ana@andina.example', lang: 'en', is_demo: false });
    expect(db.writes).toEqual([{ table: 'companies', op: 'update', payload: { name: 'Andina SAS', approver_email: 'ana@andina.example', lang: 'en' } }]);
  });
});

describe('policy (AC-30, AC-31, R-14, R-41)', () => {
  const rules = { ...SEED.rules, per_payment_limit_usd: 1000 };
  // A-01 pending, A-11 ESCALAR, A-04 FRENAR: lowering the limit to 1.000 changes A-01 and A-11 only.
  const decided = () => {
    db = testDb(workspace(['01', '04', '11']));
    db.tables.decisions!.push(
      { id: 'd4', invoice_id: uid('A-04'), company_id: 'A', seq: 1, outcome: 'FRENAR', actor: 'agent', amount_usd: 9800, checks: [] },
      { id: 'd11', invoice_id: uid('A-11'), company_id: 'A', seq: 1, outcome: 'ESCALAR', actor: 'agent', amount_usd: 4200, checks: [], headline_es: 'ESCALAR · 4.200 USD a Nube Sur LLC' },
    );
  };

  it('GET /api/policy lists every version, newest first', async () => {
    db = testDb(workspace([]));
    db.tables.policies!.push({ id: 'p2', company_id: 'A', version: 2, name: 'Más estricta', rules, created_at: '2026-10-10T00:00:00Z' },
      { id: 'pb', company_id: 'B', version: 7, name: 'Otra', rules, created_at: '2026-10-10T00:00:00Z' });
    expect((await json(await call('GET', '/api/policy'))).map((p) => p.version)).toEqual([2, 1]);
  });

  it.each([
    ['a negative limit', { rules: { per_payment_limit_usd: -5 } }, 'per_payment_limit_usd'],
    ['a non-number', { rules: { period_budget_usd: 'mucho' } }, 'period_budget_usd'],
    ['a rate of 0', { rules: { fx_rates: { COP: 0 } } }, 'fx_rates'],
    ['a fractional day count', { rules: { due_grace_days: 1.5 } }, 'due_grace_days'],
    ['no rules', { name: 'x' }, 'rules'],
  ])('PUT /api/policy with %s -> 400 naming the field, no version created', async (_, body, field) => {
    db = testDb(workspace([]));
    const r = await call('PUT', '/api/policy', body);
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: 'Valor no válido: los montos y los días deben ser números mayores o iguales a 0, y las tasas mayores que 0', field });
    expect(db.tables.policies).toHaveLength(1);
  });

  it('PUT /api/policy stores the version the database assigns, ignores a body version, and lists what would change without deciding', async () => {
    decided();
    const r = await call('PUT', '/api/policy', { name: 'Límite 1.000', version: 999, rules });
    expect(r.status).toBe(200);
    const out = (await r.json()) as { policy: Row; would_change: Row[] };
    expect(out.policy).toMatchObject({ company_id: 'A', version: 2, name: 'Límite 1.000', rules });
    expect(db.writes.map((w) => w.payload)).toEqual([{ company_id: 'A', name: 'Límite 1.000', rules }]); // no version sent (R-41)
    expect(out.would_change.map((w) => [w.invoice_id, w.from, w.to])).toEqual([[uid('A-01'), null, 'FRENAR'], [uid('A-11'), 'ESCALAR', 'FRENAR']]); // a pending row's from is null (R-68)
    expect(String(out.would_change[0]!.headline)).toMatch(/^FRENAR · 2\.500 USD a Laura Méndez/);
    expect(db.tables.decisions).toHaveLength(2);
    expect(db.rpcs.filter((x) => x.name === 'insert_decision')).toEqual([]);
  });

  it('PUT /api/policy keeps the previous name when none is given', async () => {
    db = testDb(workspace([]));
    const out = await json<{ policy: Row }>(await call('PUT', '/api/policy', { rules }));
    expect(out.policy).toMatchObject({ name: 'Política general', version: 2 });
  });

  it('PUT /api/policy that loses a version race -> 409 with the Spanish message', async () => {
    db = testDb(workspace([]));
    db.conflict.policies = true;
    const r = await call('PUT', '/api/policy', { rules });
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: 'Otra versión se guardó al mismo tiempo; recarga y vuelve a intentar' });
  });

  it('POST /api/policy/reevaluate re-runs pending and ESCALAR invoices only (trigger reevaluate)', async () => {
    decided();
    await call('PUT', '/api/policy', { rules });
    const r = await call('POST', '/api/policy/reevaluate');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ PAGAR: 0, FRENAR: 2, ESCALAR: 0, errors: 0, remaining: 0, cursor: null });
    expect(decisionsOf(uid('A-01')).map((d) => d.outcome)).toEqual(['FRENAR']);
    expect(decisionsOf(uid('A-11')).map((d) => d.outcome)).toEqual(['ESCALAR', 'FRENAR']);
    expect(decisionsOf(uid('A-04'))).toHaveLength(1);
    expect(db.tables.agent_runs!.map((x) => [x.company_id, x.trigger])).toEqual([['A', 'reevaluate']]);
  });
});

// AC-73, AC-74, R-85.6: the preview uses the stored market rates and never fetches (R-61: it equals "Reevaluar").
describe('policy preview on market rates (AC-74, R-85)', () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each([
    ['a row from today', 'PAGAR', [{ day: '2026-10-17', currency: 'COP', usd_per_unit: 0.000245, source: 'Yahoo Finance', fetched_at: '2026-10-17T11:00:00Z' }]],
    ['no row', 'ESCALAR', []],
  ])('with %s, a pending COP invoice would be %s; nothing fetched', async (_, to, rates) => {
    const net = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', net);
    db = testDb({ ...workspace(['07']), fx_latest: rates });
    const out = await json<{ would_change: Row[] }>(await call('PUT', '/api/policy', { rules: { ...SEED.rules, fx_rates: {} } }));
    expect(out.would_change.map((w) => [w.invoice_id, w.to])).toEqual([[uid('A-07'), to]]);
    expect(net).not.toHaveBeenCalled();
  });
});

// AC-76's contract, served by Task 21: the newest row per currency, sorted, with 1 USD in units and freshness (48 h).
describe('GET /api/fx (AC-73, AC-76)', () => {
  const row = (currency: string, usd_per_unit: number, fetched_at: string, source = 'Yahoo Finance') =>
    ({ day: fetched_at.slice(0, 10), currency, usd_per_unit, source, fetched_at });
  it('answers the provider and the stored rates, newest per currency, sorted by currency, with their UTC day (AC-73 QA)', async () => {
    db = testDb({ fx_latest: [row('MXN', 0.054115482, '2026-10-17T11:00:00Z'), row('COP', 0.00031538976, '2026-10-14T11:00:00Z', 'open.er-api.com')] });
    const r = await call('GET', '/api/fx');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ provider: 'yahoo', rates: [
      { currency: 'COP', day: '2026-10-14', usd_per_unit: 0.00031538976, units_per_usd: 3170.68, source: 'open.er-api.com', fetched_at: '2026-10-14T11:00:00Z', stale: true },
      { currency: 'MXN', day: '2026-10-17', usd_per_unit: 0.054115482, units_per_usd: 18.479, source: 'Yahoo Finance', fetched_at: '2026-10-17T11:00:00Z', stale: false },
    ] });
  });
  it('names er-api when FX_PROVIDER says so; empty table -> no rates; no session -> 401', async () => {
    db = testDb();
    expect(await json(await call('GET', '/api/fx', undefined, 'tok-a', { ...env, FX_PROVIDER: 'er-api' }))).toEqual({ provider: 'er-api', rates: [] });
    expect((await call('GET', '/api/fx', undefined, null)).status).toBe(401);
  });
});

describe('beneficiaries (AC-33)', () => {
  const pixel = { name: 'Pixel Lab', country: 'CO', currency: 'USD', bank_account: 'Banco de Bogotá ahorros 112-45009-8', route: 'Transferencia COP',
    category: 'Diseño', agreement: { type: 'one_off' } };

  it('GET lists the company directory without archived rows, by name', async () => {
    db = testDb(workspace([]));
    db.tables.beneficiaries!.push({ id: 'old', company_id: 'A', name: 'Antiguo', archived: true }, { id: 'b', company_id: 'B', name: 'De otra' });
    const list = await json(await call('GET', '/api/beneficiaries'));
    expect(list).toHaveLength(8);
    expect(list[0]!.name).toBe('Ana Souza');
  });

  it('POST adds a beneficiary for the member company; a new beneficiary changes the next decision', async () => {
    db = testDb(workspace(['13']));
    const r = await call('POST', '/api/beneficiaries', { ...pixel, company_id: 'B' });
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ ...pixel, company_id: 'A' });
    await call('POST', '/api/invoices/run');
    const d = await json(await call('GET', `/api/invoices/${uid('A-13')}`));
    expect((d.explanations as string[]).find((x) => x.startsWith('Beneficiario'))).toMatch(/→ cumple$/);
  });

  it.each([
    [{ ...pixel, name: ' ' }, 'name'],
    [{ ...pixel, currency: 'dólares' }, 'currency'],
    [{ ...pixel, agreement: { type: 'mensual' } }, 'agreement'],
    [{ ...pixel, agreement: { type: 'retainer', amount_usd: -1 } }, 'agreement'],
  ])('POST %j -> 400 naming the field, nothing stored', async (body, field) => {
    db = testDb(workspace([]));
    const r = await call('POST', '/api/beneficiaries', body);
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: 'Revisa el beneficiario: hay un dato no válido', field });
    expect(db.writes).toEqual([]);
  });

  it('PUT /:id edits a beneficiary of the company; another company id answers 404', async () => {
    db = testDb(workspace([]));
    db.tables.beneficiaries!.push({ id: uid('b'), company_id: 'B', name: 'De otra' });
    const r = await call('PUT', `/api/beneficiaries/${uid('A-b0')}`, { ...pixel, name: 'Laura Méndez', bank_account: 'Nequi 300-555-7310' });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ id: uid('A-b0'), bank_account: 'Nequi 300-555-7310', updated_at: NOW.replace('Z', '.000Z') });
    expect((await call('PUT', `/api/beneficiaries/${uid('b')}`, pixel)).status).toBe(404);
    expect(db.tables.beneficiaries!.find((b) => b.id === uid('b'))!.name).toBe('De otra');
  });
});

describe('GET /api/period (AC-44, R-01)', () => {
  it('on the full seed: Violaciones 0, Autonomía = (expected PAGAR + expected FRENAR) / total, explained 100', async () => {
    db = testDb(workspace());
    expect(await runAll()).toMatchObject({ PAGAR: 15, FRENAR: 3, ESCALAR: 11, errors: 0 });
    const p = await json(await call('GET', '/api/period'));
    const all = SEED.invoices as SeedRow[];
    const auto = all.filter((r) => r.expected_outcome !== 'ESCALAR').length;
    expect(p).toMatchObject({ month: '2026-10', violations: 0, autonomy: { n: auto, m: all.length }, autonomy_pct: Math.round((100 * auto) / all.length), explained_pct: 100 });
    expect(p).toMatchObject({ budget_usd: 42000, paid_usd: expect.any(Number), committed_usd: expect.any(Number) });
    expect(p.available_usd).toBeCloseTo(42000 - Number(p.committed_usd), 2);
    expect(p.balance_usd).toBeCloseTo(23000 - Number(p.paid_usd), 2);
  });

  it('only the FIRST agent decision counts: a human approval or a re-evaluation never moves Autonomía or Violaciones', async () => {
    db = testDb(workspace(['01', '04', '11', '13']));
    const d = (invoice: string, seq: number, outcome: string, actor = 'agent') =>
      ({ id: `${invoice}-${seq}`, invoice_id: invoice, company_id: 'A', seq, outcome, actor, checks: [{ id: 'lectura' }] });
    db.tables.decisions!.push(
      d(uid('A-11'), 1, 'PAGAR'), // expected ESCALAR: a violation
      d(uid('A-01'), 1, 'ESCALAR'), d(uid('A-01'), 2, 'PAGAR', 'human'), // expected PAGAR, a person approved it: not autonomous
      d(uid('A-04'), 1, 'ESCALAR'), d(uid('A-04'), 2, 'FRENAR'), // expected FRENAR, reached only after "Reevaluar": not autonomous
      d(uid('A-13'), 1, 'ESCALAR'), d(uid('A-13'), 2, 'PAGAR'), // expected ESCALAR, paid after a policy change: not a violation
    );
    expect(await json(await call('GET', '/api/period'))).toMatchObject({ violations: 1, autonomy: { n: 0, m: 4 }, autonomy_pct: 0 });
  });

  it('R-63: the per-beneficiary table groups by the AC-19 name rule, counts every invoice of the month, and each money column sums to its top figure', async () => {
    const inv = (id: string, payee: string | null, received_at = '2026-10-05T15:00:00Z', archived = false) =>
      ({ id, company_id: 'A', source: 'email', archived, received_at, fields: { payee_name: payee } });
    db = testDb({ ...workspace([]), invoices: [
      inv('c1', 'Contadores Andinos S.A.S.', '2026-10-02T15:00:00Z'), inv('c2', 'Contadores Andinos SAS'), inv('c3', 'contadores andinos'),
      inv('s1', 'Imprenta Sol Ltda.', '2026-10-01T15:00:00Z'), inv('s2', 'IMPRENTA SOL'),
      inv('u1', null), inv('u2', null),
      inv('old', 'Contadores Andinos SAS', '2026-09-20T15:00:00Z'), inv('gone', 'Contadores Andinos SAS', '2026-10-06T15:00:00Z', true),
      { ...inv('b1', 'Contadores Andinos SAS'), company_id: 'B' },
    ] });
    const d = (invoice_id: string, outcome: string, amount_usd: number) => ({ id: `d-${invoice_id}`, invoice_id, company_id: 'A', seq: 1, outcome, actor: 'agent', amount_usd, checks: [{ id: 'lectura' }] });
    db.tables.decisions!.push(d('c1', 'PAGAR', 900), d('c2', 'ESCALAR', 6000), d('c3', 'FRENAR', 100), // c-row: count 3, paid 900, committed 6900
      d('s1', 'ESCALAR', 50.5), // s2 pending
      d('u1', 'PAGAR', 10.25), d('u2', 'ESCALAR', 20), d('old', 'PAGAR', 999), d('gone', 'PAGAR', 999));
    const p = await json<{ paid_usd: number; committed_usd: number; by_beneficiary: Array<{ beneficiary: string | null; paid_usd: number; committed_usd: number; count: number }> }>(
      await call('GET', '/api/period?month=2026-10'));
    expect(p.by_beneficiary).toEqual([
      { beneficiary: 'Contadores Andinos SAS', paid_usd: 900, committed_usd: 6900, count: 3 }, // the directory name
      { beneficiary: 'Imprenta Sol Ltda.', paid_usd: 0, committed_usd: 50.5, count: 2 }, // the oldest invoice's name
      { beneficiary: null, paid_usd: 10.25, committed_usd: 30.25, count: 2 }, // "Beneficiario no leído" / "Payee not read"
    ]);
    expect(p.paid_usd).toBeCloseTo(p.by_beneficiary.reduce((s, b) => s + b.paid_usd, 0), 2);
    expect(p.committed_usd).toBeCloseTo(p.by_beneficiary.reduce((s, b) => s + b.committed_usd, 0), 2);
    expect([p.paid_usd, p.committed_usd]).toEqual([910.25, 6980.75]);
  });

  it('rejects a malformed month with 400', async () => {
    db = testDb(workspace([]));
    const r = await call('GET', '/api/period?month=octubre');
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: 'Mes no válido: usa AAAA-MM' });
  });
});

// R-74: a malformed id is the route's own 404 JSON with no lookup; anything uncaught under /api/* is a JSON 500.
describe('malformed ids and uncaught errors (R-74)', () => {
  const lookups = () => db.queries.filter((q) => q.table !== 'company_members').length + db.writes.length +
    db.rpcs.filter((r) => r.name !== 'rate_limit_hit').length;
  it.each([
    ['GET', '/api/invoices/not-a-uuid', undefined, { error: 'Factura no encontrada' }],
    ['GET', `/api/invoices/${encodeURIComponent("1' or '1'='1")}`, undefined, { error: 'Factura no encontrada' }],
    ['GET', `/api/invoices/${uid('A-11')}x`, undefined, { error: 'Factura no encontrada' }],
    ['POST', '/api/invoices/A-11/approve', { seq: 1 }, { error: 'not_found', message: 'Factura no encontrada' }],
    ['POST', '/api/invoices/123/reject', { seq: 1 }, { error: 'not_found', message: 'Factura no encontrada' }],
    ['PUT', '/api/beneficiaries/A-b0', { name: 'Laura Méndez' }, { error: 'Beneficiario no encontrado' }],
  ])('%s %s -> 404 with the route text, no database lookup', async (method, path, body, answer) => {
    db = testDb(workspace(['11']));
    const before = lookups();
    const r = await call(method, path, body);
    expect([r.status, await r.json()]).toEqual([404, answer]);
    expect(lookups()).toBe(before);
  });
  it.each([123, ['Laura Méndez'], {}, true])('an invoice row whose payee_name is %j never makes GET /api/invoices/:id or PUT /api/policy answer 500', async (payee) => {
    db = testDb(workspace(['01']));
    (db.tables.invoices![0]!.fields as Row).payee_name = payee;
    expect((await call('GET', `/api/invoices/${uid('A-01')}`)).status).toBe(200);
    expect((await call('PUT', '/api/policy', { rules: SEED.rules })).status).toBe(200);
  });
  it('an uncaught error under /api/* -> 500 JSON, logged, never plain text', async () => {
    db = testDb(workspace(['11']));
    db.fail.query = (q) => (q.table === 'invoice_current' ? 'connection reset' : undefined);
    const r = await call('GET', '/api/invoices');
    expect(r.status).toBe(500);
    expect(r.headers.get('Content-Type')).toMatch(/^application\/json/);
    expect(await r.json()).toEqual({ error: 'No pude completar la solicitud; intenta de nuevo.' });
    expect(vi.mocked(console.error)).toHaveBeenCalled();
  });
});

describe('GET /api/agent/last-run (AC-63)', () => {
  it('returns the newest run of the own company or a cron tick, never another company run', async () => {
    db = testDb({ agent_runs: [
      { company_id: null, trigger: 'cron', created_at: '2026-10-17T14:58:00Z' },
      { company_id: 'A', trigger: 'manual', created_at: '2026-10-17T14:50:00Z' },
      { company_id: 'B', trigger: 'manual', created_at: '2026-10-17T14:59:00Z' },
    ] });
    expect(await json(await call('GET', '/api/agent/last-run'))).toEqual({ at: '2026-10-17T14:58:00Z', trigger: 'cron', via: null });
    db.tables.agent_runs!.push({ company_id: 'A', trigger: 'ingest', created_at: '2026-10-17T14:59:30Z' });
    expect(await json(await call('GET', '/api/agent/last-run'))).toEqual({ at: '2026-10-17T14:59:30Z', trigger: 'ingest', via: null });
  });

  it('carries via for a run started by the vendor portal or the email intake (AC-63 Clarified, R-90)', async () => {
    db = testDb({ agent_runs: [{ company_id: 'A', trigger: 'ingest', via: 'portal', created_at: '2026-10-17T14:59:00Z' }] });
    expect(await json(await call('GET', '/api/agent/last-run'))).toEqual({ at: '2026-10-17T14:59:00Z', trigger: 'ingest', via: 'portal' });
  });

  it('returns null when nothing has run', async () => {
    db = testDb();
    expect(await (await call('GET', '/api/agent/last-run')).json()).toBeNull();
  });
});

// AC-78, R-89: the activity panel replays the recorded decisions; no AI call, at most 3 subrequests, own company only.
describe('GET /api/agent/activity (AC-78)', () => {
  const IDS = ['lectura', 'beneficiario_permitido', 'beneficiario_cuenta', 'acuerdo', 'moneda', 'duplicado_exacto', 'duplicado_probable',
    'vencimiento', 'limite_factura', 'presupuesto', 'umbral', 'periodo', 'monto_coherente'];
  const checks = (lectura: Row = {}, payee = 'Laura Méndez') => IDS.map((id) => ({ id, verdict: 'cumple',
    ...(id === 'lectura' ? lectura : {}), values: id === 'beneficiario_permitido' ? { payee_name: payee } : {} }));
  // One invoice_current row (decided_at is the view's column) and its stored decision.
  function decided(company: string, id: string, at: string, o: { outcome?: string; actor?: string; fields?: Row | null; lectura?: Row; seq?: number } = {}) {
    const actor = o.actor ?? 'agent';
    db.tables.invoices!.push({ id, company_id: company, source: 'pdf', origin: 'app', received_at: at, decided_at: at,
      fields: o.fields === undefined ? { payee_name: `Proveedor ${id}` } : o.fields });
    db.tables.decisions!.push({ id: `d-${id}`, invoice_id: id, company_id: company, seq: o.seq ?? 1, outcome: o.outcome ?? 'PAGAR', actor,
      ...(actor === 'human' ? { actor_email: 'ana@a.example', channel: 'dashboard' } : {}), checks: checks(o.lectura, `Proveedor ${id}`), created_at: at });
  }
  const at = (m: number) => new Date(Date.parse(NOW) + m * 60_000).toISOString();
  type Item = { invoice_id: string; payee: string; outcome: string; decided_at: string; actor: string; read_by_ai: boolean; steps: Array<{ stage: string; text: string }> };
  const activity = async (q = '', token = 'tok-a') => (await json<{ items: Item[] }>(await call('GET', `/api/agent/activity${q}`, undefined, token))).items;

  it('replays what the agent decided from the record: AI read on ingest, stored data on a seeded invoice', async () => {
    db = testDb(workspace(['01']));
    await call('POST', '/api/invoices/run');
    const r = await call('POST', '/api/invoices', { source: 'email', text: 'De: Laura Méndez\nFactura 1050, USD 2.500' });
    const { invoice } = (await r.json()) as { invoice: Row };
    const items = await activity();
    const ingested = items.find((i) => i.invoice_id === invoice.id)!;
    expect(ingested).toMatchObject({ payee: 'Laura Méndez', outcome: 'PAGAR', actor: 'agent', read_by_ai: true });
    expect(ingested.steps).toEqual([
      { stage: 'lee', text: 'Leyendo la factura de Laura Méndez con IA…' },
      { stage: 'consulta', text: 'Consultando el directorio…' },
      { stage: 'consulta', text: 'Verificando 13 reglas…' },
      { stage: 'decide', text: 'Decidí PAGAR' },
    ]);
    const seeded = items.find((i) => i.invoice_id === uid('A-01'))!;
    const payee = (db.tables.invoices!.find((i) => i.id === uid('A-01'))!.fields as Row).payee_name;
    expect(seeded.read_by_ai).toBe(false);
    expect(seeded.steps[0]).toEqual({ stage: 'lee', text: `Tomando los datos ya leídos de la factura de ${payee}…` });
    expect(items.map((i) => i.invoice_id)).not.toContain(uid('B-01'));
    expect(ai.run.mock.calls.length).toBe(1); // the ingest read only; the activity route makes no AI call
  });

  it('own company only, agent decisions only, newest first, at most 10, with at most 3 subrequests', async () => {
    db = testDb();
    for (let i = 0; i < 12; i++) decided('A', `a${i}`, at(i));
    decided('B', 'b1', at(30));
    decided('A', 'h1', at(31), { actor: 'human', seq: 2 });
    const before = db.meter.calls;
    const items = await activity();
    expect(db.meter.calls - before).toBeLessThanOrEqual(3);
    expect(items.map((i) => i.invoice_id)).toEqual(['a11', 'a10', 'a9', 'a8', 'a7', 'a6', 'a5', 'a4', 'a3', 'a2']);
    expect(items[0]).toMatchObject({ payee: 'Proveedor a11', decided_at: at(11), actor: 'agent' });
  });

  it('?since=<ISO> returns only decisions at or after it; a bad since is 400', async () => {
    db = testDb();
    decided('A', 'old', at(0));
    decided('A', 'new', at(5));
    expect((await activity(`?since=${encodeURIComponent(at(1))}`)).map((i) => i.invoice_id)).toEqual(['new']);
    const r = await call('GET', '/api/agent/activity?since=ayer');
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: 'Fecha no válida' });
  });

  it('a REST-inserted invoice read by the run: AI step and the payee as the checks recorded it (R-97); a later re-evaluation read nothing', async () => {
    db = testDb();
    decided('A', 'rest', at(0), { fields: null, lectura: { read_by: { provider: 'Amazon Nova Lite (AWS Bedrock)' } } });
    decided('A', 'again', at(1), { fields: { payee_name: 'Kodex Labs', read_by: { provider: 'Workers AI · m' } }, seq: 2, outcome: 'ESCALAR' });
    const items = await activity();
    expect(items.find((i) => i.invoice_id === 'rest')).toMatchObject({ payee: 'Proveedor rest', read_by_ai: true });
    expect(items.find((i) => i.invoice_id === 'again')).toMatchObject({ read_by_ai: false });
  });

  it('steps in English with the R-46 outcome words', async () => {
    db = testDb();
    decided('A', 'x', at(0), { outcome: 'FRENAR' });
    expect((await activity('', 'tok-en'))[0]!.steps.map((s) => s.text)).toEqual([
      "Taking the already-read data from Proveedor x's invoice…", 'Checking the directory…', 'Checking 13 rules…', 'I decided STOP',
    ]);
  });

  it('needs a JWT', async () => {
    db = testDb();
    expect((await call('GET', '/api/agent/activity', undefined, null)).status).toBe(401);
  });
});

// R-72: the limit is the database counter rate_limit_hit (migration 20261017000500), called with the user's own JWT.
describe('rate limit (AC-43, R-72)', () => {
  const limitCalls = () => db.rpcs.filter((r) => r.name === 'rate_limit_hit');
  it('one user: POSTs 1-60 pass, the 61st answers 429 with the exact body; GET and a second user are not limited', async () => {
    db = testDb(workspace([]));
    for (let i = 0; i < 60; i++) expect((await call('POST', '/api/invoices/run')).status).toBe(200);
    const r = await call('POST', '/api/invoices/run');
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ error: 'Demasiadas solicitudes, intenta en un minuto' });
    expect(limitCalls().at(-1)?.args).toEqual({}); // no caller-chosen limit: 60 is in the SQL
    expect((await call('GET', '/api/invoices')).status).toBe(200);
    expect((await call('POST', '/api/invoices/run', undefined, 'tok-en')).status).toBe(200);
    expect(limitCalls()).toHaveLength(62); // one counted call per member POST, none per GET
  });
  it('the dashboard Aprobar / Rechazar POSTs count too: the 61st answers 429 (AC-43 covers every member POST)', async () => {
    db = testDb(workspace(['11']));
    for (let i = 0; i < 60; i++) expect((await call('POST', `/api/invoices/${uid('A-11')}/approve`, { seq: 9 }, 'tok-d')).status).not.toBe(429);
    expect((await call('POST', `/api/invoices/${uid('A-11')}/reject`, { seq: 9 }, 'tok-d')).status).toBe(429);
  });
  it('a refused POST does nothing else: no agent run, no write', async () => {
    db = testDb(workspace(['01']));
    db.rateLimit.refuse = true;
    expect((await call('POST', '/api/invoices/run')).status).toBe(429);
    expect(decisionsOf(uid('A-01'))).toHaveLength(0);
    expect(db.tables.agent_runs ?? []).toHaveLength(0);
  });
  it.each([['answers an error', 'boom'], ['throws', 'throw']])('the counter %s -> the request goes through and the error is logged', async (_, how) => {
    db = testDb(workspace(['01']));
    db.rateLimit.fail = how;
    const r = await call('POST', '/api/invoices/run');
    expect(r.status).toBe(200);
    expect(decisionsOf(uid('A-01'))).toHaveLength(1);
    expect(vi.mocked(console.error)).toHaveBeenCalledWith('rate limit: counter failed, request allowed', expect.anything());
  });
});

const { runAgent } = await import('../agent/loop');
const { Budget } = await import('../lib/supabase');
const send = vi.mocked((await import('../lib/email')).sendEmail);

describe('budgeted, resumable runs over HTTP (AC-70, R-56, R-57, R-59, R-60)', () => {
  // Every subrequest of one request: Supabase calls (fake db, the rate-limit counter included), Workers AI and emails.
  const usage = () => db.meter.calls + ai.run.mock.calls.length + send.mock.calls.length;
  async function counted(method: string, path: string, body?: unknown) {
    const before = usage();
    const r = await call(method, path, body, 'tok-a');
    return { r, n: usage() - before };
  }
  // The browser's call loop with each call's count.
  async function countedLoop(path: string) {
    const per: number[] = [];
    let cursor: string | null = null;
    do {
      const { r, n } = await counted('POST', path, per.length ? { cursor } : undefined);
      expect(r.status).toBe(200);
      per.push(n);
      ({ cursor } = await json<{ cursor: string | null }>(r));
    } while (cursor && per.length < 20);
    return per;
  }
  const outcomes = () => Object.fromEntries(db.tables.invoices!.filter((i) => i.company_id === 'A')
    .map((i) => [i.id, decisionsOf(String(i.id)).map((d) => d.outcome)]));
  const NOT_RUN = 'No pude ejecutar el agente ahora. Las facturas siguen pendientes; lo intentaré solo en la próxima revisión automática (cada 5 minutos).';

  it('29 seeded pending invoices, every escalation mailed: every call <= 40 counted subrequests, the cursor loop decides all 29 as one unbounded run would, every ESCALAR has its token pair', async () => {
    db = testDb(workspace());
    await runAgent({ db: db as never, env, budget: new Budget(Infinity) }, 'A', 'pending', 'manual');
    const reference = outcomes();
    db = testDb(workspace());
    const mailed = send.mock.calls.length;
    const per = await countedLoop('/api/invoices/run');
    expect(Math.max(...per)).toBeLessThanOrEqual(40);
    expect(per.length).toBe(6); // 4 mailed escalations fit in one call
    expect(outcomes()).toEqual(reference);
    expect(Object.values(reference).flat()).toHaveLength(29);
    const escalated = db.tables.decisions!.filter((d) => d.outcome === 'ESCALAR').map((d) => d.invoice_id);
    expect(escalated).toHaveLength(11);
    for (const id of escalated) expect(db.tables.approval_tokens!.filter((t) => t.invoice_id === id)).toHaveLength(2);
    expect(send.mock.calls.length - mailed).toBe(11);
    expect(db.tables.agent_runs!.filter((x) => x.company_id === 'A')).toHaveLength(6); // one row per call (AC-63)
  });

  it('a forced "Too many subrequests" mid-run answers 200 with what was done, never 500 (R-57)', async () => {
    db = testDb(workspace(['01', '03', '05']));
    db.fail.period_state = (a) => (a.p_exclude_invoice === uid('A-03') ? 'TypeError: Too many subrequests by single Worker invocation.' : undefined);
    const r = await call('POST', '/api/invoices/run');
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ PAGAR: 1, errors: 0, remaining: 2, cursor: expect.any(String) });
  });

  it('"Reevaluar" with the cursor re-decides every pending and ESCALAR invoice exactly once, each call <= 40', async () => {
    db = testDb(workspace());
    await runAll();
    const open = db.tables.decisions!.filter((d) => d.outcome === 'ESCALAR').map((d) => String(d.invoice_id)).sort();
    const before = db.rpcs.length;
    const per = await countedLoop('/api/policy/reevaluate');
    expect(per.length).toBeGreaterThan(1);
    expect(Math.max(...per)).toBeLessThanOrEqual(40);
    const again = db.rpcs.slice(before).filter((x) => x.name === 'insert_decision').map((x) => String(x.args.p_invoice_id)).sort();
    expect(again).toEqual(open);
    expect(db.tables.agent_runs!.filter((x) => x.trigger === 'reevaluate')).toHaveLength(per.length);
  });

  it.each(['/api/invoices/run', '/api/policy/reevaluate'])('%s with a bad cursor -> 400 "Cursor no válido", nothing decided', async (path) => {
    db = testDb(workspace(['01']));
    for (const cursor of ['nope', 42, btoa('[1]')]) {
      const r = await call('POST', path, { cursor });
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ error: 'Cursor no válido' });
    }
    expect(db.rpcs.filter((r) => r.name !== 'rate_limit_hit')).toEqual([]); // only the rate-limit counter ran
    expect(db.tables.agent_runs).toEqual([]);
  });

  it.each(['/api/invoices/run', '/api/policy/reevaluate'])('%s that cannot read the policy before the first invoice -> 503 with the R-57 text, nothing written', async (path) => {
    db = testDb(workspace(['01']));
    db.fail.query = (q) => (q.table === 'policies' ? 'down' : undefined);
    const r = await call('POST', path);
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: NOT_RUN });
    expect(db.tables.decisions).toEqual([]);
    expect(db.tables.agent_runs).toEqual([]);
  });

  it('POST /api/invoices answers 201 with decision null when the agent cannot run; a PNG ingest stays <= 40 (R-57, R-60)', async () => {
    db = testDb(workspace([]));
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const { r: ok, n } = await counted('POST', '/api/invoices', upload(png, 'f.png', 'image/png'));
    expect(ok.status).toBe(201);
    expect(n).toBeLessThanOrEqual(40);
    db.fail.query = (q) => (q.table === 'companies' ? 'down' : undefined);
    const r = await call('POST', '/api/invoices', { source: 'email', text: 'De: Laura Méndez\nFactura 1051, USD 2.500' });
    expect(r.status).toBe(201);
    const { invoice, decision } = await json<{ invoice: Row; decision: Row | null }>(r);
    expect(decision).toBeNull();
    expect(invoice).toMatchObject({ outcome: null });
  });

  it('R-61 acceptance: the PUT /api/policy preview equals the change set of a reevaluate run on the same data, ESCALAR -> PAGAR from freed budget included, 30+ invoices in <= 40 counted', async () => {
    db = testDb(workspace());
    // The seed plus 20 copies under new invoice numbers, all decided: the month's budget runs out, so many escalate.
    db.tables.invoices!.push(...seedInvoices('A').slice(0, 20).map((i) => ({ ...i, id: `${i.id}-n`,
      fields: { ...i.fields, invoice_number: `${(i.fields as { invoice_number?: string }).invoice_number}-n` } })));
    await runAgent({ db: db as never, env, budget: new Budget(Infinity) }, 'A', 'pending', 'manual');
    const latest = () => new Map(db.tables.invoices!.filter((i) => i.company_id === 'A')
      .map((i) => [String(i.id), decisionsOf(String(i.id)).sort((a, b) => Number(a.seq) - Number(b.seq)).at(-1)?.outcome]));
    const before = latest();
    expect([...before.values()].filter((o) => o === 'ESCALAR').length).toBeGreaterThanOrEqual(30);

    const rules = { ...SEED.rules, per_payment_limit_usd: 1000 };
    const { r, n } = await counted('PUT', '/api/policy', { rules });
    expect(r.status).toBe(200);
    expect(n).toBeLessThanOrEqual(40);
    const out = await json<{ will_pay: number; would_change: Array<{ invoice_id: string; from: string; to: string }> }>(r);

    await runAgent({ db: db as never, env, budget: new Budget(Infinity) }, 'A', 'pending', 'reevaluate');
    const after = latest();
    const changed = [...after].filter(([id, o]) => before.get(id) !== o).map(([id, o]) => [id, before.get(id), o]);
    const listed = out.would_change.map((w) => [w.invoice_id, w.from, w.to]);
    expect(listed.sort()).toEqual(changed.sort());
    expect(listed.filter((x) => x[1] === 'ESCALAR' && x[2] === 'FRENAR').length).toBeGreaterThan(1);
    expect(listed.filter((x) => x[1] === 'ESCALAR' && x[2] === 'PAGAR').length).toBeGreaterThan(0); // unlocked by the freed budget
    expect(out.will_pay).toBe(listed.filter((x) => x[2] === 'PAGAR').length);
  });

  // R-68: the preview of a policy save, and what a reevaluate run then really does on the same data.
  const previewAndReevaluate = async () => {
    const latest = () => new Map(db.tables.invoices!.filter((i) => i.company_id === 'A').map((i) => [String(i.id),
      decisionsOf(String(i.id)).sort((a, b) => Number(a.seq) - Number(b.seq)).at(-1)?.outcome ?? null]));
    const before = latest();
    const r = await call('PUT', '/api/policy', { rules: { ...SEED.rules, per_payment_limit_usd: 1000 } });
    expect(r.status).toBe(200);
    const out = await json<{ will_pay: number; unread_pending?: number; would_change: Array<{ invoice_id: string; from: string | null; to: string | null }> }>(r);
    await runAgent({ db: db as never, env, budget: new Budget(Infinity) }, 'A', 'pending', 'reevaluate');
    return { before, after: latest(), out, listed: out.would_change.map((w) => [w.invoice_id, w.from, w.to]) };
  };

  it('R-68 acceptance: with only pending invoices the preview lists every one with from null, and will_pay is what a reevaluate run pays', async () => {
    db = testDb(workspace());
    const { after, out, listed } = await previewAndReevaluate();
    const mine = [...after].filter(([id]) => id.startsWith(uid('A-00').slice(0, -4)));
    expect(listed.sort()).toEqual(mine.map(([id, o]) => [id, null, o]).sort());
    expect(listed).toHaveLength(29);
    expect(out.will_pay).toBe(mine.filter(([, o]) => o === 'PAGAR').length);
    expect(out.will_pay).toBeGreaterThan(0);
    expect(out.unread_pending ?? 0).toBe(0);
  });

  it('R-68 acceptance: pending and ESCALAR mixed, freed budget included: pending rows all listed, ESCALAR only when it changes', async () => {
    db = testDb(workspace());
    db.tables.invoices!.push(...seedInvoices('A').slice(0, 20).map((i) => ({ ...i, id: `${i.id}-n`, received_at: NOW, // later than the decided ones
      fields: { ...i.fields, invoice_number: `${(i.fields as { invoice_number?: string }).invoice_number}-n` } })));
    const decide = db.tables.invoices!.filter((i) => i.company_id === 'A' && !String(i.id).endsWith('-n'));
    const pending = db.tables.invoices!.filter((i) => String(i.id).endsWith('-n'));
    db.tables.invoices = db.tables.invoices!.filter((i) => !pending.includes(i));
    await runAgent({ db: db as never, env, budget: new Budget(Infinity) }, 'A', 'pending', 'manual');
    expect(decide.length).toBeGreaterThan(0);
    db.tables.invoices.push(...pending);
    const { before, after, listed } = await previewAndReevaluate();
    const mine = [...after].filter(([id, o]) => id.startsWith(uid('A-00').slice(0, -4)) && (before.get(id) === null || before.get(id) !== o));
    expect(listed.sort()).toEqual(mine.map(([id, o]) => [id, before.get(id), o]).sort());
    expect([...before.values()].filter((o) => o === 'ESCALAR').length).toBeGreaterThan(0);
    expect(listed.some((x) => x[1] === null)).toBe(true);
    expect(listed.some((x) => x[1] === 'ESCALAR')).toBe(true);
    expect(listed.some((x) => x[1] === 'ESCALAR' && x[2] === 'ESCALAR')).toBe(false);
  });

  it('R-68: a pending invoice with no read fields is listed with to null, counted in unread_pending and not in will_pay', async () => {
    db = testDb(workspace(['01', '04']));
    db.tables.invoices!.find((i) => i.id === uid('A-04'))!.fields = null;
    const r = await call('PUT', '/api/policy', { rules: { ...SEED.rules, per_payment_limit_usd: 1000 } });
    const out = await json<{ will_pay: number; unread_pending: number; would_change: Array<{ invoice_id: string; from: unknown; to: unknown }> }>(r);
    expect(out.would_change.map((w) => [w.invoice_id, w.from, w.to])).toEqual([[uid('A-01'), null, 'FRENAR'], [uid('A-04'), null, null]]);
    expect(out.unread_pending).toBe(1);
    expect(out.will_pay).toBe(0);
  });
});

// R-75 (AC-13 Clarified): the reader gave no answer -> stored as sent, 201 with ESCALAR «sin leer»; an answer with nothing
// usable stays «ilegible». No test calls the real model (R-76): every AI.run here is a fake.
describe('ingest when the reader is unavailable (AC-13 Clarified, R-75)', () => {
  const QUOTA = () => Promise.reject(new Error('4006: you have used up your daily free allocation of 10,000 neurons'));
  const HEADLINE = 'ESCALAR · factura sin leer: el lector de facturas no estaba disponible; vuelve a ingresarla más tarde';
  const UNAVAILABLE = { payee_name: null, amount: null, currency: null, invoice_number: null, issue_date: null, due_date: null,
    concept: null, bank_account: null, confidence: {}, read_error: 'lector_no_disponible' };
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  async function ingest(body: unknown) {
    const r = await call('POST', '/api/invoices', body);
    expect(r.status).toBe(201);
    const { invoice, decision } = await json<{ invoice: Row; decision: Row }>(r);
    return { invoice, decision, stored: db.tables.invoices!.find((i) => i.id === invoice.id)! };
  }

  it.each([
    ['a pasted email, the text model out of quota', { source: 'email', text: 'Factura 1050 de Laura Méndez' }, () => ai.run.mockImplementationOnce(QUOTA), 1],
    ['an image, the vision model out of quota', 'png', () => ai.run.mockImplementationOnce(QUOTA), 1],
    ['an image, the vision model answering and the text model out of quota', 'png',
      () => ai.run.mockImplementationOnce(async () => ({ response: 'texto de la imagen' })).mockImplementationOnce(QUOTA), 2],
  ])('%s: stores the fields as sent, ESCALAR with the «sin leer» texts, never PAGAR', async (_, body, arrange, calls) => {
    db = testDb(workspace([]));
    arrange();
    const { invoice, decision, stored } = await ingest(body === 'png' ? upload(png, 'f.png', 'image/png') : body);
    expect(stored.fields).toEqual(UNAVAILABLE);
    expect(ai.run).toHaveBeenCalledTimes(calls); // no automatic retry, no second read
    expect(decision).toMatchObject({ outcome: 'ESCALAR', headline_es: HEADLINE });
    expect((decision.checks as Array<{ id: string; values: Row }>).find((c) => c.id === 'lectura')!.values.reason).toBe('lector_no_disponible');
    const detail = await json<{ invoice: { fields: Row }; explanations: string[]; fixes: string[]; trace: Array<{ text: string }>; question: string }>(await call('GET', `/api/invoices/${invoice.id}`));
    expect(detail.explanations[0]).toBe('Lectura: el lector de facturas no estaba disponible cuando llegó (límite diario del servicio o falla temporal); no se leyó ningún dato → no se pudo verificar');
    expect(detail.fixes[0]).toBe('Que vuelvas a ingresar la factura cuando el lector esté disponible y rechaces esta copia sin leer');
    expect(detail.trace[0]!.text).toMatch(/^Intenté leer (el correo|la imagen), pero el lector de facturas no estaba disponible; no inventé ningún dato\.$/);
    expect(detail.trace[3]!.text).toBe('Decidí ESCALAR: el lector de facturas no estaba disponible.');
    expect(detail.invoice.fields.read_error).toBe('lector_no_disponible'); // the «Lo que leí» notice (AC-13 item 7) keys on it
    expect(detail.question).toMatch(/^Juan, no pude leer una factura que llegó (por correo|en imagen): el lector de facturas no estaba disponible\./);
  });

  it('an invoice stored without fields and read by "Ejecutar agente" keeps fields null; the detail shows read_error from its decision', async () => {
    db = testDb(workspace([]));
    const id = uid('A-rest');
    db.tables.invoices!.push({ id, company_id: 'A', source: 'chat', raw_text: 'Factura 1050', archived: false, received_at: NOW, fields: null });
    ai.run.mockImplementationOnce(QUOTA);
    expect(await json(await call('POST', '/api/invoices/run'))).toMatchObject({ ESCALAR: 1, errors: 0 });
    expect(db.tables.invoices!.find((i) => i.id === id)!.fields).toBeNull(); // AC-38: record.ts never writes invoices
    const detail = await json<{ invoice: { fields: Row }; headline: string; trace: Array<{ text: string }> }>(await call('GET', `/api/invoices/${id}`));
    expect(detail.invoice.fields).toMatchObject({ read_error: 'lector_no_disponible', payee_name: null, amount: null });
    expect(detail.headline).toBe(HEADLINE);
    expect(detail.trace[0]!.text).toBe('Intenté leer el chat, pero el lector de facturas no estaba disponible; no inventé ningún dato.');
  });

  it('the model answering invalid JSON keeps the «ilegible» texts and no read_error', async () => {
    db = testDb(workspace([]));
    ai.run.mockImplementationOnce(async () => ({ response: 'lo siento, no puedo' }));
    const { decision, stored } = await ingest({ source: 'chat', text: 'una foto borrosa' });
    expect(stored.fields).toMatchObject({ concept: 'ilegible' });
    expect(stored.fields).not.toHaveProperty('read_error');
    expect(decision.outcome).toBe('ESCALAR');
    expect(decision.headline_es).toMatch(/^ESCALAR · monto desconocido a beneficiario desconocido: ilegible y \d+ motivos más$/);
  });
});

// R-80 (AC-14 Clarified): QA live with zero quota, as a route test. Each pasted text is ESCALAR with the guard's texts,
// not «factura sin leer»; the guard runs on the text before and independently of the model.
describe('ingest: the amount guard with the reader unavailable (AC-14 Clarified, R-80)', () => {
  const QUOTA = () => Promise.reject(new Error('4006: you have used up your daily free allocation of 10,000 neurons'));
  const NONE = 'un beneficiario que no pude leer';
  const cuadra = (s: string, t: string, sum: string, x: string) => [`ESCALAR · el total de la factura de ${NONE} no cuadra: ${s} + ${t} = ${sum}, pero el total dice ${x}`,
    `Lectura: subtotal ${s} + impuestos ${t} = ${sum}, total impreso ${x} → no cuadra, no se pudo verificar`,
    `Leí el correo y encontré a ${NONE}, factura sin número, pero el total no cuadra (${s} + ${t} = ${sum}, pero el total dice ${x}); no tomé ningún monto.`,
    'Decidí ESCALAR: el total no cuadra.', 'Que el proveedor envíe la factura con un total que cuadre; rechaza esta'];
  const nota = (signal: string) => [`ESCALAR · la factura de ${NONE} parece una nota crédito: dice «${signal}»; no es un cobro y no la pago`,
    `Lectura: el documento dice «${signal}»; no tomo su monto como un cobro → no se pudo verificar`,
    `Leí el correo y encontré a ${NONE}, factura sin número; el documento dice «${signal}», así que no tomé su monto como un cobro.`,
    'Decidí ESCALAR: parece una nota crédito, no un cobro.',
    'Que no se pague: una nota crédito se descuenta de una factura, no se paga. Recházala; si de verdad es un cobro, que el proveedor envíe una factura sin esa señal'];
  it.each([
    ['Subtotal: USD 100.00 / IVA: USD 19.00 / Total: USD 150.00', 'total_no_cuadra', cuadra('100,00', '19,00', '119,00', '150,00')],
    ['Subtotal 200 + impuesto 20 = Total 100', 'total_no_cuadra', cuadra('200,00', '20,00', '220,00', '100,00')],
    ['Subtotal 1000 / Impuestos 190 / Total 1400', 'total_no_cuadra', cuadra('1.000,00', '190,00', '1.190,00', '1.400,00')],
    ['Subtotal 100 / VAT 19 / Total 300', 'total_no_cuadra', cuadra('100,00', '19,00', '119,00', '300,00')],
    ['Total: (USD 500,00) nota credito', 'nota_credito', nota('Total: (USD 500,00)')],
    ['Total: USD 200.00 CR (saldo a favor del cliente, no cobrar)', 'nota_credito', nota('Total: USD 200.00 CR')],
    ['Total: -500 USD', 'nota_credito', nota('Total: -500 USD')],
    ['Nota de crédito NC-12 Total USD 80', 'nota_credito', nota('Nota de crédito')],
  ])('«%s»', async (text, code, [headline, row, step1, step4, fix]) => {
    db = testDb(workspace([]));
    ai.run.mockImplementationOnce(QUOTA);
    const r = await call('POST', '/api/invoices', { source: 'email', text });
    expect(r.status).toBe(201);
    const { invoice, decision } = await json<{ invoice: Row; decision: Row }>(r);
    expect(db.tables.invoices!.find((i) => i.id === invoice.id)!.fields).toMatchObject({ amount: null, read_error: code });
    expect(decision).toMatchObject({ outcome: 'ESCALAR', headline_es: headline, amount_usd: null });
    const detail = await json<{ invoice: { fields: Row }; explanations: string[]; fixes: string[]; trace: Array<{ text: string }>; question: string }>(await call('GET', `/api/invoices/${invoice.id}`));
    expect([detail.explanations[0], detail.trace[0]!.text, detail.trace[3]!.text, detail.fixes[0]]).toEqual([row, step1, step4, fix]);
    expect(detail.question).toMatch(/^Juan, la factura sin número de un beneficiario que no pude leer (parece una nota crédito|no cuadra): .+ ¿la rechazo\?$/);
  });
  it('an image whose vision transcription says «nota crédito» is flagged', async () => {
    db = testDb(workspace([]));
    ai.run.mockImplementationOnce(async () => ({ response: 'NOTA CRÉDITO NC-7 · Total USD 300.00' })).mockImplementationOnce(QUOTA);
    const r = await call('POST', '/api/invoices', upload(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]), 'f.png', 'image/png'));
    const { decision } = await json<{ decision: Row }>(r);
    expect(decision).toMatchObject({ outcome: 'ESCALAR', headline_es: `ESCALAR · la factura de ${NONE} parece una nota crédito: dice «NOTA CRÉDITO»; no es un cobro y no la pago` });
  });
  it('AC-11: a consistent «Subtotal / IVA / Total» email is not flagged', async () => {
    db = testDb(workspace([]));
    const r = await call('POST', '/api/invoices', { source: 'email', text: 'Factura 1050 de Laura Méndez\nSubtotal: USD 2,100.84\nIVA 19 %: USD 399.16\nTotal: USD 2,500.00' });
    const { invoice } = await json<{ invoice: Row }>(r);
    expect(db.tables.invoices!.find((i) => i.id === invoice.id)!.fields).toMatchObject({ amount: 2500 });
    expect(db.tables.invoices!.find((i) => i.id === invoice.id)!.fields).not.toHaveProperty('read_error');
  });
});
