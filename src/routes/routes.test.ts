/// <reference types="vite/client" />
// Route tests for Task 8b: the app from src/index.ts with fake Supabase clients, never the real Supabase.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sql from '../../supabase/migrations/20261017000300_seed_andina.sql?raw';
import { fakeDb } from '../agent/__fixtures__/fake-db';
import { bogotaDay } from '../engine/checks';
import type { Env } from '../env';

type Row = Record<string, unknown>;
type Db = ReturnType<typeof testDb>;
let db: Db;
vi.mock('../lib/supabase', async (orig) => ({ ...(await orig<typeof import('../lib/supabase')>()), userClient: () => db }));
vi.mock('../lib/admin', () => ({ adminClient: () => db }));
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
  let n = 0;
  function write(table: string, op: 'insert' | 'update', payload: Row | Row[]) {
    writes.push({ table, op, payload });
    const eqs: Row = {};
    let returning = false;
    let one: false | 'single' | 'maybe' = false;
    const run = () => {
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
    ...base, writes, uploads, conflict,
    from: (t: string) => Object.assign(base.from(t), { insert: (p: Row | Row[]) => write(t, 'insert', p), update: (p: Row) => write(t, 'update', p) }),
    auth: { getUser: async (jwt: string) => (USERS[jwt] ? { data: { user: USERS[jwt] }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } }) },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, body: ArrayBuffer, o?: { contentType?: string }) => {
          uploads.push({ bucket, path, contentType: o?.contentType, size: body.byteLength });
          return { data: { path }, error: null };
        },
        createSignedUrl: async (path: string, expiresIn: number) => ({ data: { signedUrl: `https://signed.test/${bucket}/${path}?expires=${expiresIn}` }, error: null }),
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
      id: `${id}-${r.nn}`, company_id: id, source: r.source, raw_text: r.raw_text, archived: false, expected_outcome: r.expected_outcome, received_at,
      file_path: r.source === 'pdf' ? `/demo/invoices/${r.nn}.pdf` : r.source === 'image' ? `/demo/invoices/${r.nn}.png` : null,
      fields: { ...r.fields, issue_date: r.issue === null ? null : addDays(day, r.issue), due_date: r.due === null ? null : addDays(day, r.due), confidence: {} },
    };
  });
}
const workspace = (only?: string[]) => ({
  policies: [{ id: 'p1', company_id: 'A', version: 1, name: 'Política general', rules: SEED.rules, created_at: '2026-10-01T00:00:00Z' }],
  beneficiaries: SEED.beneficiaries.map((b: object, i: number) => ({ ...b, id: `A-b${i}`, company_id: 'A', archived: false })),
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
    expect(es.map((r) => r.id).sort()).toEqual(['A-01', 'A-11']);
    expect(es.find((r) => r.id === 'A-01')!.headline).toMatch(/^PAGAR · 2\.500 USD a Laura Méndez/);
    const en = await json(await call('GET', '/api/invoices', undefined, 'tok-en'));
    expect(en.find((r) => r.id === 'A-11')!.headline).toMatch(/^ESCALATE · 4,200 USD to Nube Sur LLC/);
  });

  it('POST /api/invoices/run decides every pending invoice (trigger manual) and returns the counts', async () => {
    db = testDb(workspace(['01', '04', '11']));
    const r = await call('POST', '/api/invoices/run');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ PAGAR: 1, FRENAR: 1, ESCALAR: 1, errors: 0 });
    expect(db.tables.agent_runs!.map((x) => [x.company_id, x.trigger])).toEqual([['A', 'manual']]);
    expect(decisionsOf('B-01')).toEqual([]);
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
    ['empty pasted text', () => ({ source: 'chat', text: '   ' })],
    ['pasted text over 20.000 characters', () => ({ source: 'email', text: 'x'.repeat(20001) })],
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

  it('accepts pasted text of exactly 20.000 characters', async () => {
    db = testDb(workspace([]));
    expect((await call('POST', '/api/invoices', { source: 'chat', text: 'x'.repeat(20000) })).status).toBe(201);
  });
});

describe('GET /api/invoices/:id (AC-26, AC-08, AC-64, AC-65)', () => {
  it('returns the timeline, beneficiary, explanations, fixes, policy, trace and the stored question of an ESCALAR', async () => {
    db = testDb(workspace(['11']));
    await call('POST', '/api/invoices/run');
    const r = await call('GET', '/api/invoices/A-11');
    expect(r.status).toBe(200);
    const d = (await r.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(d.invoice).toMatchObject({ id: 'A-11', outcome: 'ESCALAR' });
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
    const es = await json<{ explanations: string[]; question: unknown }>(await call('GET', '/api/invoices/A-21'));
    expect(es.explanations.some((x) => x.includes('v1'))).toBe(true);
    expect(es.question).toBeNull();
    const en = await json<{ trace: Row[]; headline: string }>(await call('GET', '/api/invoices/A-21', undefined, 'tok-en'));
    expect(en.headline).toMatch(/^PAY ·/);
    expect(en.trace[0]!.text).toMatch(/^I read/);
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
    db.tables.invoices!.find((i) => i.id === 'A-13')!.file_path = file_path;
    expect((await json(await call('GET', '/api/invoices/A-13'))).file_url).toBeNull();
  });

  it('returns a seeded demo document as is and a Storage key under the company folder signed', async () => {
    db = testDb(workspace(['13', '14']));
    db.tables.invoices!.find((i) => i.id === 'A-13')!.file_path = '/demo/invoices/01.png';
    db.tables.invoices!.find((i) => i.id === 'A-14')!.file_path = 'A/abc.jpg';
    expect((await json(await call('GET', '/api/invoices/A-13'))).file_url).toBe('/demo/invoices/01.png');
    expect((await json(await call('GET', '/api/invoices/A-14'))).file_url).toBe('https://signed.test/files/A/abc.jpg?expires=300');
  });

  it('a pending invoice has no trace, no question and no explanations', async () => {
    db = testDb(workspace(['13']));
    const d = await json(await call('GET', '/api/invoices/A-13'));
    expect(d).toMatchObject({ decisions: [], trace: [], question: null, explanations: [], fixes: [], policy: null, file_url: null });
  });

  it("answers 404 for another company's invoice", async () => {
    db = testDb(workspace(['01']));
    const r = await call('GET', '/api/invoices/B-01');
    expect(r.status).toBe(404);
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
  // A-01 pending (PAGAR under v1), A-11 ESCALAR, A-04 FRENAR: lowering the limit to 1.000 changes A-01 and A-11 only.
  const decided = () => {
    db = testDb(workspace(['01', '04', '11']));
    db.tables.decisions!.push(
      { id: 'd4', invoice_id: 'A-04', company_id: 'A', seq: 1, outcome: 'FRENAR', actor: 'agent', amount_usd: 9800, checks: [] },
      { id: 'd11', invoice_id: 'A-11', company_id: 'A', seq: 1, outcome: 'ESCALAR', actor: 'agent', amount_usd: 4200, checks: [], headline_es: 'ESCALAR · 4.200 USD a Nube Sur LLC' },
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
    expect(out.would_change.map((w) => [w.invoice_id, w.from, w.to])).toEqual([['A-01', 'PAGAR', 'FRENAR'], ['A-11', 'ESCALAR', 'FRENAR']]);
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
    expect(await r.json()).toEqual({ PAGAR: 0, FRENAR: 2, ESCALAR: 0, errors: 0 });
    expect(decisionsOf('A-01').map((d) => d.outcome)).toEqual(['FRENAR']);
    expect(decisionsOf('A-11').map((d) => d.outcome)).toEqual(['ESCALAR', 'FRENAR']);
    expect(decisionsOf('A-04')).toHaveLength(1);
    expect(db.tables.agent_runs!.map((x) => [x.company_id, x.trigger])).toEqual([['A', 'reevaluate']]);
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
    const d = await json(await call('GET', '/api/invoices/A-13'));
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
    db.tables.beneficiaries!.push({ id: 'b', company_id: 'B', name: 'De otra' });
    const r = await call('PUT', '/api/beneficiaries/A-b0', { ...pixel, name: 'Laura Méndez', bank_account: 'Nequi 300-555-7310' });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ id: 'A-b0', bank_account: 'Nequi 300-555-7310', updated_at: NOW.replace('Z', '.000Z') });
    expect((await call('PUT', '/api/beneficiaries/b', pixel)).status).toBe(404);
    expect(db.tables.beneficiaries!.find((b) => b.id === 'b')!.name).toBe('De otra');
  });
});

describe('GET /api/period (AC-44, R-01)', () => {
  it('on the full seed: Violaciones 0, Autonomía = (expected PAGAR + expected FRENAR) / total, explained 100', async () => {
    db = testDb(workspace());
    await call('POST', '/api/invoices/run');
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
      d('A-11', 1, 'PAGAR'), // expected ESCALAR: a violation
      d('A-01', 1, 'ESCALAR'), d('A-01', 2, 'PAGAR', 'human'), // expected PAGAR, a person approved it: not autonomous
      d('A-04', 1, 'ESCALAR'), d('A-04', 2, 'FRENAR'), // expected FRENAR, reached only after "Reevaluar": not autonomous
      d('A-13', 1, 'ESCALAR'), d('A-13', 2, 'PAGAR'), // expected ESCALAR, paid after a policy change: not a violation
    );
    expect(await json(await call('GET', '/api/period'))).toMatchObject({ violations: 1, autonomy: { n: 0, m: 4 }, autonomy_pct: 0 });
  });

  it('rejects a malformed month with 400', async () => {
    db = testDb(workspace([]));
    const r = await call('GET', '/api/period?month=octubre');
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: 'Mes no válido: usa AAAA-MM' });
  });
});

describe('GET /api/agent/last-run (AC-63)', () => {
  it('returns the newest run of the own company or a cron tick, never another company run', async () => {
    db = testDb({ agent_runs: [
      { company_id: null, trigger: 'cron', created_at: '2026-10-17T14:58:00Z' },
      { company_id: 'A', trigger: 'manual', created_at: '2026-10-17T14:50:00Z' },
      { company_id: 'B', trigger: 'manual', created_at: '2026-10-17T14:59:00Z' },
    ] });
    expect(await json(await call('GET', '/api/agent/last-run'))).toEqual({ at: '2026-10-17T14:58:00Z', trigger: 'cron' });
    db.tables.agent_runs!.push({ company_id: 'A', trigger: 'ingest', created_at: '2026-10-17T14:59:30Z' });
    expect(await json(await call('GET', '/api/agent/last-run'))).toEqual({ at: '2026-10-17T14:59:30Z', trigger: 'ingest' });
  });

  it('returns null when nothing has run', async () => {
    db = testDb();
    expect(await (await call('GET', '/api/agent/last-run')).json()).toBeNull();
  });
});

describe('rate limit (AC-43)', () => {
  it('the 61st POST of one user within a minute answers 429; GET is not limited', async () => {
    db = testDb(workspace([]));
    const hits = new Map<string, number>();
    const limit = vi.fn(async ({ key }: { key: string }) => { hits.set(key, (hits.get(key) ?? 0) + 1); return { success: hits.get(key)! <= 60 }; });
    const limited = { ...env, RATE_LIMIT: { limit } } as unknown as Env;
    for (let i = 0; i < 60; i++) expect((await call('POST', '/api/invoices/run', undefined, 'tok-a', limited)).status).toBe(200);
    const r = await call('POST', '/api/invoices/run', undefined, 'tok-a', limited);
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ error: 'Demasiadas solicitudes, intenta en un minuto' });
    expect(limit).toHaveBeenLastCalledWith({ key: 'user-a' });
    expect((await call('GET', '/api/invoices', undefined, 'tok-a', limited)).status).toBe(200);
    expect((await call('POST', '/api/invoices/run', undefined, 'tok-en', limited)).status).toBe(200);
  });
});
