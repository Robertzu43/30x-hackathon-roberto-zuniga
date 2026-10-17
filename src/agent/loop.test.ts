/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedConfidence } from '../engine/__fixtures__/seed';
import sql from '../../supabase/migrations/20261017000300_seed_andina.sql?raw';
import { bogotaDay } from '../engine/checks';
import type { Env } from '../env';
import { sendEmail } from '../lib/email';
import { Budget, type Db } from '../lib/supabase';
import { hashToken } from '../lib/tokens';
import { fakeDb, type FakeDb } from './__fixtures__/fake-db';

let db: FakeDb;
vi.mock('../lib/admin', () => ({ adminClient: () => db }));
vi.mock('../lib/email', async (orig) => ({ ...(await orig<typeof import('../lib/email')>()), sendEmail: vi.fn(async () => ({ sent: true })) }));
const { runAgent, decodeCursor } = await import('./loop');

const SEED = JSON.parse(sql.match(/\$seed\$([\s\S]*?)\$seed\$/)?.[1] ?? 'null');
const NOW = '2026-10-17T15:00:00Z';
const ai = { run: vi.fn(async () => { throw new Error('Workers AI unavailable'); }) };
const env = { AI: ai, APP_URL: 'https://app.test', APPROVAL_HMAC_SECRET: 'secret' } as unknown as Env;
// Unbounded unless a test passes a budget; the fake db counts every call on it, as the real clients do through Budget.fetch.
const deps = (budget = new Budget(Infinity)) => { db.meter.budget = budget; return { db: db as unknown as Db, env, budget }; };
const send = vi.mocked(sendEmail);

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
interface SeedRow { nn: string; source: string; expected_outcome: string; prev_month?: boolean; issue: number | null; due: number | null; raw_text: string | null; fields: object }
// The seed SQL's rows and date rule (see decide.test.ts), as `invoices` rows of company `companyId`.
function seedInvoices(companyId: string, only?: string[]) {
  const start = Date.parse(`${bogotaDay(NOW).slice(0, 7)}-01T00:00:00-05:00`);
  return (SEED.invoices as SeedRow[]).filter((r) => !only || only.includes(r.nn)).map((r) => {
    const received_at = new Date(r.prev_month ? start - 5 * 864e5 : start + ((Date.parse(NOW) - start) * Number(r.nn)) / 30).toISOString();
    const day = bogotaDay(received_at);
    return {
      id: `${companyId}-${r.nn}`, company_id: companyId, source: r.source, file_path: null, raw_text: r.raw_text, archived: false,
      expected_outcome: r.expected_outcome, received_at,
      fields: { ...r.fields, issue_date: r.issue === null ? null : addDays(day, r.issue), due_date: r.due === null ? null : addDays(day, r.due), confidence: seedConfidence(r.fields) },
    };
  });
}
const company = (id: string, is_demo = false) => [
  { id, approver_email: `juan.perez@${id}.example`, is_demo },
];
const workspace = (id: string, opts: { demo?: boolean; only?: string[] } = {}) => ({
  companies: company(id, opts.demo),
  policies: [{ company_id: id, version: 1, name: 'Política general', rules: SEED.rules }],
  beneficiaries: SEED.beneficiaries.map((b: object, n: number) => ({ ...b, id: `${id}-b${n}`, company_id: id })),
  invoices: seedInvoices(id, opts.only),
});
const decisionsOf = (invoiceId: string) => db.tables.decisions!.filter((d) => d.invoice_id === invoiceId);
const insertCalls = () => db.rpcs.filter((r) => r.name === 'insert_decision');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  send.mockClear();
  ai.run.mockClear();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('runAgent (D22, AC-61)', () => {
  it('an archived beneficiary is not in the directory: its payee escalates with beneficiario_permitido no_cumple (AC-47)', async () => {
    const w = workspace('A', { only: ['01'] });
    db = fakeDb(w);
    await runAgent(deps(), 'A', 'pending', 'manual');
    expect(decisionsOf('A-01')[0]).toMatchObject({ outcome: 'PAGAR' }); // live directory: allowed

    db = fakeDb(workspace('A', { only: ['01'] }));
    const payee = (db.tables.invoices![0]!.fields as { payee_name: string }).payee_name;
    for (const b of db.tables.beneficiaries!) if (b.name === payee) b.archived = true;
    await runAgent(deps(), 'A', 'pending', 'manual');
    const d = decisionsOf('A-01')[0]!;
    expect(d.outcome).toBe('ESCALAR');
    expect(d.checks).toContainEqual(expect.objectContaining({ id: 'beneficiario_permitido', verdict: 'no_cumple' }));
  });

  it('the fake invoice_current exposes the latest decision view columns', async () => {
    db = fakeDb(workspace('A', { only: ['01'] }));
    await runAgent(deps(), 'A', 'pending', 'manual');
    const row = (await db.from('invoice_current').select('headline_es, question_en, policy_version').eq('id', 'A-01').single()).data as Record<string, unknown>;
    expect(row.headline_es).toEqual(expect.any(String));
    expect(row.policy_version).toBe(1);
  });

  it('runs the stages percibe, lee, consulta, decide, actua, rindeCuentas in that order for one invoice', async () => {
    db = fakeDb(workspace('A', { only: ['01'] }));
    await runAgent(deps(), 'A', 'pending', 'manual');
    const stages = vi.mocked(console.log).mock.calls.map((c) => String(c[0])).filter((s) => s.startsWith('agent ')).map((s) => s.slice(6));
    expect(stages).toEqual(['percibe', 'lee', 'consulta', 'decide', 'actua', 'rindeCuentas']);
  });

  it('three seed invoices: expected outcomes, committed amount and seq passed to insert_decision', async () => {
    db = fakeDb(workspace('A', { only: ['01', '04', '11'] }));
    const counts = await runAgent(deps(), 'A', 'pending', 'manual');
    expect(counts).toEqual({ PAGAR: 1, FRENAR: 1, ESCALAR: 1, errors: 0, remaining: 0, cursor: null });
    expect(insertCalls().map((c) => [c.args.p_invoice_id, c.args.p_expected_committed_usd, c.args.p_expected_seq]))
      .toEqual([['A-01', 0, 0], ['A-04', 2500, 0], ['A-11', 2500, 0]]);
    expect(['A-01', 'A-04', 'A-11'].map((id) => decisionsOf(id).map((d) => d.outcome))).toEqual([['PAGAR'], ['FRENAR'], ['ESCALAR']]);
    const pagar = decisionsOf('A-01')[0]!;
    expect(pagar).toMatchObject({ actor: 'agent', policy_version: 1, amount_usd: 2500, question_es: null,
      payment: { beneficiary: 'Laura Méndez', route: 'COP · transferencia', currency: 'USD', amount: 2500 } });
    expect(pagar.headline_es).toMatch(/^PAGAR · 2\.500 USD a Laura Méndez/);
    expect(pagar.headline_en).toMatch(/^PAY · 2,500 USD to Laura Méndez/);
  });

  it('reads every query of the company with an explicit company filter', async () => {
    db = fakeDb(workspace('A', { only: ['01', '11'] }));
    await runAgent(deps(), 'A', 'pending', 'manual');
    for (const q of db.queries.filter((q) => q.op === 'select' && q.table !== 'invoices')) {
      expect(q.eq.company_id ?? (q.table === 'companies' && q.eq.id), q.table).toBe('A');
    }
    expect(db.rpcs.filter((r) => r.name === 'period_state').every((r) => r.args.p_company_id === 'A')).toBe(true);
  });

  it('decides all 29 seeded invoices as expected with Workers AI down (AC-10 through the loop)', async () => {
    db = fakeDb(workspace('A', { demo: true }));
    const counts = await runAgent(deps(), 'A', 'pending', 'login');
    expect(counts).toEqual({ PAGAR: 15, FRENAR: 3, ESCALAR: 11, errors: 0, remaining: 0, cursor: null });
    for (const inv of db.tables.invoices!) expect([inv.id, decisionsOf(String(inv.id)).map((d) => d.outcome)]).toEqual([inv.id, [inv.expected_outcome]]);
    expect(insertCalls()).toHaveLength(29); // every committed amount was right first time: no STALE_PERIOD
    expect(ai.run).not.toHaveBeenCalled(); // seeded fields are already read
  });
});

describe('consulta: duplicados (AC-19)', () => {
  it('finds an exact duplicate decided last month inside the 30-day window -> FRENAR', async () => {
    const w = workspace('A', { only: ['01'] });
    const sept = { ...w.invoices[0]!, id: 'A-sept', received_at: '2026-09-25T15:00:00Z' };
    db = fakeDb({ ...w, invoices: [sept, ...w.invoices],
      decisions: [{ id: 'old', invoice_id: 'A-sept', company_id: 'A', seq: 1, outcome: 'PAGAR', amount_usd: 2500 }] });
    expect(await runAgent(deps(), 'A', 'pending', 'manual')).toMatchObject({ FRENAR: 1 });
    expect((decisionsOf('A-01')[0]!.checks as Array<{ id: string; verdict: string }>).find((c) => c.id === 'duplicado_exacto')?.verdict).toBe('no_cumple');
  });
});

describe('lee: the reader only when fields are missing (AC-61, AC-13)', () => {
  it('reads an invoice without fields from its text; a failed read escalates as illegible', async () => {
    db = fakeDb(workspace('A', { only: ['13'] }));
    db.tables.invoices![0]!.fields = null;
    expect(await runAgent(deps(), 'A', 'pending', 'manual')).toMatchObject({ ESCALAR: 1 });
    expect(ai.run).toHaveBeenCalledOnce();
    const lectura = (decisionsOf('A-13')[0]!.checks as Array<{ id: string; verdict: string }>).find((c) => c.id === 'lectura');
    expect(lectura?.verdict).toBe('no_verificado');
  });
});

describe('actua (AC-24, AC-25, AC-39, R-15, R-16, R-25, R-29)', () => {
  it('STALE_PERIOD once -> recomputes the period and retries, one decision', async () => {
    db = fakeDb(workspace('A', { only: ['01'] }));
    let first = true;
    db.fail.insert_decision = () => (first ? ((first = false), 'STALE_PERIOD') : undefined);
    expect(await runAgent(deps(), 'A', 'pending', 'manual')).toEqual({ PAGAR: 1, FRENAR: 0, ESCALAR: 0, errors: 0, remaining: 0, cursor: null });
    expect(insertCalls()).toHaveLength(2);
    expect(db.rpcs.filter((r) => r.name === 'period_state')).toHaveLength(2);
    expect(decisionsOf('A-01')).toHaveLength(1);
  });

  it('STALE_PERIOD on every try -> 1 + 3 retries, then an error and no decision', async () => {
    db = fakeDb(workspace('A', { only: ['01'] }));
    db.fail.insert_decision = () => 'STALE_PERIOD';
    expect(await runAgent(deps(), 'A', 'pending', 'manual')).toEqual({ PAGAR: 0, FRENAR: 0, ESCALAR: 0, errors: 1, remaining: 0, cursor: null });
    expect(insertCalls()).toHaveLength(4);
    expect(db.tables.agent_runs).toEqual([{ company_id: 'A', trigger: 'manual', decided: { PAGAR: 0, FRENAR: 0, ESCALAR: 0 }, errors: 1 }]);
  });

  it('ALREADY_DECIDED -> skipped silently: no tokens, no mail, not counted', async () => {
    db = fakeDb(workspace('A', { only: ['11'] }));
    db.fail.insert_decision = () => 'ALREADY_DECIDED';
    expect(await runAgent(deps(), 'A', 'pending', 'manual')).toEqual({ PAGAR: 0, FRENAR: 0, ESCALAR: 0, errors: 0, remaining: 0, cursor: null });
    expect(send).not.toHaveBeenCalled();
    expect(db.tables.approval_tokens).toEqual([]);
  });

  it('a new ESCALAR stores the question and mails it once with two links on APP_URL; the token pair is recorded after the send', async () => {
    db = fakeDb(workspace('A', { only: ['11'] }));
    await runAgent(deps(), 'A', 'pending', 'manual');
    const d = decisionsOf('A-11')[0]!;
    expect(d.question_es).toBe('Juan, la factura #2044 de Nube Sur LLC por 4.200 USD supera tu umbral de aprobación de 2.500 USD. ¿La pago?');
    expect(d.question_en).toMatch(/^Juan, invoice #2044/);
    expect(send).toHaveBeenCalledOnce();
    const msg = send.mock.calls[0]![1];
    expect(msg.to).toBe('juan.perez@A.example');
    expect(msg.subject).toBe(d.question_es);
    const links = [...msg.text.matchAll(/https:\/\/app\.test\/approve\/(\S+)/g)].map((m) => m[1]!);
    expect(links).toHaveLength(2);
    expect(db.tables.approval_tokens).toEqual(await Promise.all(links.map(async (t) => ({
      token_hash: await hashToken(t), invoice_id: 'A-11', decision_id: d.id, company_id: 'A', email_sent: true, sent_to: 'juan.perez@A.example',
      expires_at: new Date(Date.parse(NOW) + 48 * 3600e3).toISOString(),
    }))));
    expect(JSON.stringify(db.tables.approval_tokens)).not.toContain(links[0]); // only hashes are stored
  });

  it('a failed send is recorded and never changes the decision', async () => {
    db = fakeDb(workspace('A', { only: ['11'] }));
    send.mockResolvedValueOnce({ sent: false });
    expect(await runAgent(deps(), 'A', 'pending', 'manual')).toMatchObject({ ESCALAR: 1, errors: 0 });
    expect(db.tables.approval_tokens!.map((t) => t.email_sent)).toEqual([false, false]);
  });

  it('the demo company never gets tokens or mail, but keeps the question (R-15)', async () => {
    db = fakeDb(workspace('A', { demo: true, only: ['11'] }));
    await runAgent(deps(), 'A', 'pending', 'manual');
    expect(send).not.toHaveBeenCalled();
    expect(db.tables.approval_tokens).toEqual([]);
    expect(decisionsOf('A-11')[0]!.question_es).toMatch(/¿La pago\?$/);
  });

  it('re-evaluating an ESCALAR appends against its seq and sends no second mail (R-16)', async () => {
    db = fakeDb(workspace('A', { only: ['11'] }));
    await runAgent(deps(), 'A', 'pending', 'manual');
    send.mockClear();
    expect(await runAgent(deps(), 'A', ['A-11'], 'reevaluate')).toMatchObject({ ESCALAR: 1 });
    expect(insertCalls().at(-1)!.args).toMatchObject({ p_expected_seq: 1, p_expected_committed_usd: 0 });
    expect(decisionsOf('A-11').map((d) => d.seq)).toEqual([1, 2]);
    expect(send).not.toHaveBeenCalled();
    expect(db.tables.approval_tokens).toHaveLength(2);
  });

  it('only a re-evaluation re-decides an ESCALAR; PAGAR and FRENAR are never re-decided (R-24, D16)', async () => {
    db = fakeDb(workspace('A', { only: ['01', '04', '11'] }));
    await runAgent(deps(), 'A', 'pending', 'manual');
    const before = insertCalls().length;
    expect(await runAgent(deps(), 'A', ['A-01', 'A-04', 'A-11'], 'manual')).toEqual({ PAGAR: 0, FRENAR: 0, ESCALAR: 0, errors: 0, remaining: 0, cursor: null });
    expect(await runAgent(deps(), 'A', ['A-01', 'A-04'], 'reevaluate')).toEqual({ PAGAR: 0, FRENAR: 0, ESCALAR: 0, errors: 0, remaining: 0, cursor: null });
    expect(insertCalls()).toHaveLength(before);
  });

  it('another company\'s invoice id is never loaded or decided', async () => {
    db = fakeDb({ ...workspace('A', { only: ['01'] }), invoices: [...seedInvoices('A', ['01']), ...seedInvoices('B', ['01'])] });
    expect(await runAgent(deps(), 'A', ['B-01'], 'manual')).toEqual({ PAGAR: 0, FRENAR: 0, ESCALAR: 0, errors: 0, remaining: 0, cursor: null });
    expect(decisionsOf('B-01')).toEqual([]);
  });

  it('one failing invoice is counted and the others are still decided in arrival order', async () => {
    db = fakeDb(workspace('A', { only: ['01', '03', '05'] }));
    db.fail.period_state = (a) => (a.p_exclude_invoice === 'A-03' ? 'boom' : undefined);
    expect(await runAgent(deps(), 'A', 'pending', 'manual')).toEqual({ PAGAR: 2, FRENAR: 0, ESCALAR: 0, errors: 1, remaining: 0, cursor: null });
    expect(console.error).toHaveBeenCalledWith('agent: invoice not decided', 'A-03', 'boom');
    expect(insertCalls().map((c) => c.args.p_invoice_id)).toEqual(['A-01', 'A-05']);
  });
});

describe('rindeCuentas (AC-63)', () => {
  it('writes one agent_runs row per call, also when nothing is pending', async () => {
    db = fakeDb(workspace('A', { only: ['01', '11'] }));
    await runAgent(deps(), 'A', 'pending', 'ingest');
    await runAgent(deps(), 'A', 'pending', 'manual');
    expect(db.tables.agent_runs).toEqual([
      { company_id: 'A', trigger: 'ingest', decided: { PAGAR: 1, FRENAR: 0, ESCALAR: 1 }, errors: 0 },
      { company_id: 'A', trigger: 'manual', decided: { PAGAR: 0, FRENAR: 0, ESCALAR: 0 }, errors: 0 },
    ]);
  });
});

describe('budgeted, resumable runs (R-56, R-57, AC-70)', () => {
  const run = async (budget: Budget, trigger: 'manual' | 'reevaluate' = 'manual', cursor: string | null = null) =>
    runAgent(deps(budget), 'A', 'pending', trigger, cursor ? decodeCursor(cursor) : null);

  it('counted subrequests: 5 per run (4 reads + run row), 4 per invoice, +3 per mailed escalation, +1 when Workers AI reads', async () => {
    db = fakeDb(workspace('A', { demo: true, only: ['01'] }));
    let b = new Budget(Infinity);
    await run(b);
    expect(b.used).toBe(5 + 4);
    db = fakeDb(workspace('A', { only: ['11'] }));
    await run(b = new Budget(Infinity));
    expect(send).toHaveBeenCalledOnce();
    expect(b.used).toBe(5 + 4 + 3);
    db = fakeDb(workspace('A', { demo: true, only: ['13'] }));
    db.tables.invoices![0]!.fields = null;
    await run(b = new Budget(Infinity));
    expect(b.used).toBe(5 + 1 + 4);
  });

  it('writes an invoice only if its attempt, its mail and the run row fit; the next one stays pending and is first in the next call', async () => {
    db = fakeDb(workspace('A', { only: ['01', '11'] }));
    const b = new Budget(15); // 4 reads, then 01 needs 4 + 3 + 1 = 8 of 11 left; then 7 left < 8 for 11
    const first = await run(b);
    expect(first).toMatchObject({ PAGAR: 1, ESCALAR: 0, errors: 0, remaining: 1, cursor: expect.any(String) });
    expect(b.used).toBeLessThanOrEqual(15);
    expect(decisionsOf('A-11')).toEqual([]);
    const next = await run(new Budget(Infinity), 'manual', first.cursor);
    expect(next).toEqual({ PAGAR: 0, FRENAR: 0, ESCALAR: 1, errors: 0, remaining: 0, cursor: null });
    expect(insertCalls().map((c) => c.args.p_invoice_id)).toEqual(['A-01', 'A-11']);
    expect(db.tables.approval_tokens).toHaveLength(2); // the ESCALAR has its pair: never half done
    expect(db.tables.agent_runs).toHaveLength(2); // one row per call (AC-63)
  });

  it('a STALE_PERIOD retry runs only if a whole attempt still fits; otherwise the invoice is left untouched', async () => {
    db = fakeDb(workspace('A', { demo: true, only: ['01'] }));
    db.fail.insert_decision = () => 'STALE_PERIOD';
    const b = new Budget(12); // 4 reads, attempt 4 (+1 run row reserved), then 4 left < 5
    expect(await run(b)).toMatchObject({ PAGAR: 0, errors: 0, remaining: 1, cursor: expect.any(String) });
    expect(insertCalls()).toHaveLength(1);
    expect(decisionsOf('A-01')).toEqual([]);
    expect(b.used).toBeLessThanOrEqual(12);
  });

  it('"Too many subrequests" despite the budget stops at once; the call reports what it did and the next call goes on (R-57)', async () => {
    db = fakeDb(workspace('A', { demo: true, only: ['01', '03', '05'] }));
    db.fail.period_state = (a) => (a.p_exclude_invoice === 'A-03' ? 'TypeError: Too many subrequests by single Worker invocation.' : undefined);
    const first = await run(new Budget());
    expect(first).toMatchObject({ PAGAR: 1, errors: 0, remaining: 2, cursor: expect.any(String) });
    expect(insertCalls().map((c) => c.args.p_invoice_id)).toEqual(['A-01']);
    db.fail.period_state = undefined;
    expect(await run(new Budget(), 'manual', first.cursor)).toMatchObject({ PAGAR: 2, remaining: 0, cursor: null });
  });

  it('a run row that cannot be written is logged and the decisions are still reported (R-57)', async () => {
    db = fakeDb(workspace('A', { demo: true, only: ['01'] }));
    db.fail.query = (q) => (q.table === 'agent_runs' ? 'boom' : undefined);
    expect(await run(new Budget())).toEqual({ PAGAR: 1, FRENAR: 0, ESCALAR: 0, errors: 0, remaining: 0, cursor: null });
    expect(console.error).toHaveBeenCalledWith('agent: run not recorded', 'A', 'boom');
  });

  it('a read before the first invoice fails: it throws and writes nothing (the route answers 503)', async () => {
    db = fakeDb(workspace('A', { demo: true, only: ['01'] }));
    db.fail.query = (q) => (q.table === 'policies' ? 'down' : undefined);
    await expect(run(new Budget())).rejects.toThrow('down');
    expect(db.tables.decisions).toEqual([]);
    expect(db.tables.agent_runs).toEqual([]);
  });

  it('an errored invoice lies behind the cursor: counted once, never retried by the same press', async () => {
    db = fakeDb(workspace('A', { demo: true, only: ['01', '03', '05'] }));
    db.fail.period_state = (a) => (a.p_exclude_invoice === 'A-01' ? 'boom' : undefined);
    const first = await run(new Budget(4 + 1 + 4 + 4)); // reads, A-01's failing read, A-03; then 4 left < 5 for A-05
    expect(first).toMatchObject({ PAGAR: 1, errors: 1, remaining: 1 });
    expect(await run(new Budget(), 'manual', first.cursor)).toMatchObject({ PAGAR: 1, errors: 0, remaining: 0, cursor: null });
  });

  it('re-evaluating in small calls re-decides every pending and ESCALAR invoice exactly once', async () => {
    db = fakeDb(workspace('A', { demo: true }));
    await run(new Budget(Infinity));
    const open = db.tables.invoices!.filter((i) => i.expected_outcome === 'ESCALAR').map((i) => String(i.id));
    const before = insertCalls().length;
    let cursor: string | null = null;
    let calls = 0;
    do { ({ cursor } = await run(new Budget(), 'reevaluate', cursor)); calls++; } while (cursor && calls < 20);
    expect(calls).toBeGreaterThan(1);
    expect(insertCalls().slice(before).map((c) => c.args.p_invoice_id).sort()).toEqual(open.sort());
  });

  it('an empty run has nothing remaining and a null cursor; a garbage cursor does not decode', async () => {
    db = fakeDb(workspace('A', { demo: true, only: [] }));
    expect(await run(new Budget())).toEqual({ PAGAR: 0, FRENAR: 0, ESCALAR: 0, errors: 0, remaining: 0, cursor: null });
    for (const bad of ['', 'x', btoa('[1]'), btoa('["a","b"]'), btoa('[-1,"a"]'), btoa('{}')]) expect(decodeCursor(bad)).toBeNull();
  });
});
