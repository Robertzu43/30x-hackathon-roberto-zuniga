/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sql from '../../supabase/migrations/20261017000300_seed_andina.sql?raw';
import { fakeDb, type FakeDb } from '../agent/__fixtures__/fake-db';
import type { StoredDecision } from '../agent/trace';
import { bogotaDay } from '../engine/checks';
import { HUMAN_OVERRIDABLE, outcomeOf } from '../engine/decide';
import type { Check } from '../engine/types';
import type { Env } from '../env';
import { sendEmail } from '../lib/email';
import type { Db } from '../lib/supabase';
import { signToken, verifyToken } from '../lib/tokens';

type TestDb = FakeDb & { auth: { getUser: (jwt: string) => Promise<unknown> } };
let db: TestDb;
vi.mock('../lib/admin', () => ({ adminClient: () => db }));
vi.mock('../lib/supabase', async (orig) => ({ ...(await orig<typeof import('../lib/supabase')>()), userClient: () => db }));
vi.mock('../lib/email', async (orig) => ({ ...(await orig<typeof import('../lib/email')>()), sendEmail: vi.fn(async () => ({ sent: true })) }));
const { approvals } = await import('./approvals');
const { runAgent } = await import('../agent/loop');

const SEED = JSON.parse(sql.match(/\$seed\$([\s\S]*?)\$seed\$/)?.[1] ?? 'null');
const NOW = '2026-10-17T15:00:00Z';
const SECRET = 'secret';
const APPROVER = 'juan.perez@andina.example';
const MEMBER = 'ana.gomez@andina.example';
const env = { AI: { run: async () => { throw new Error('no AI'); } }, APP_URL: 'https://app.test', APPROVAL_HMAC_SECRET: SECRET } as unknown as Env;
const send = vi.mocked(sendEmail);

// The seed's invoices of company A, dated as in loop.test.ts (the seed SQL's date rule).
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
interface SeedRow { nn: string; source: string; prev_month?: boolean; issue: number | null; due: number | null; raw_text: string | null; fields: object }
function workspace(only?: string[]) {
  const start = Date.parse(`${bogotaDay(NOW).slice(0, 7)}-01T00:00:00-05:00`);
  const invoices = (SEED.invoices as SeedRow[]).filter((r) => !only || only.includes(r.nn)).map((r) => {
    const received_at = new Date(r.prev_month ? start - 5 * 864e5 : start + ((Date.parse(NOW) - start) * Number(r.nn)) / 30).toISOString();
    const day = bogotaDay(received_at);
    return { id: `A-${r.nn}`, company_id: 'A', source: r.source, raw_text: r.raw_text, archived: false, received_at,
      fields: { ...r.fields, issue_date: r.issue === null ? null : addDays(day, r.issue), due_date: r.due === null ? null : addDays(day, r.due), confidence: {} } };
  });
  return {
    companies: [{ id: 'A', approver_email: APPROVER, is_demo: false }, { id: 'B', approver_email: 'x@b.example', is_demo: false }],
    company_members: [{ company_id: 'A', user_id: 'u1' }, { company_id: 'B', user_id: 'u2' }],
    policies: [{ company_id: 'A', version: 1, rules: SEED.rules }],
    beneficiaries: SEED.beneficiaries.map((b: object, n: number) => ({ ...b, id: `A-b${n}`, company_id: 'A' })),
    invoices: [...invoices, { id: 'B-01', company_id: 'B', source: 'email', raw_text: '', archived: false, received_at: NOW, fields: null }],
  };
}

// The fake db plus the two database guards a human answer meets (migration 000250): NOT_ESCALATED and the PAGAR invariant.
async function setup(only?: string[]) {
  db = Object.assign(fakeDb(workspace(only)), {
    auth: { getUser: async (jwt: string) => (jwt === 'good' ? { data: { user: { id: 'u1', email: MEMBER, user_metadata: {} } }, error: null }
      : jwt === 'other' ? { data: { user: { id: 'u2', email: 'x@b.example', user_metadata: {} } }, error: null }
        : { data: { user: null }, error: { message: 'invalid JWT' } }) },
  });
  db.fail.insert_decision = (a) => {
    const d = a.p_decision as StoredDecision;
    if (d.actor === 'human' && latest(String(a.p_invoice_id))?.outcome !== 'ESCALAR') return 'NOT_ESCALATED';
    const bad = (c: Check) => c.verdict !== 'cumple' && !(c.overridden && HUMAN_OVERRIDABLE.includes(c.id));
    if (d.outcome === 'PAGAR' && (d.checks.length < 13 || d.checks.some(bad))) return 'PAGAR_OUTSIDE_RULES';
    return undefined;
  };
  await agent('pending', 'manual');
}
const agent = (ids: string[] | 'pending', trigger: 'manual' | 'reevaluate') => runAgent({ db: db as unknown as Db, env }, 'A', ids, trigger);
const decisionsOf = (id: string) => db.tables.decisions!.filter((d) => d.invoice_id === id) as unknown as StoredDecision[];
const latest = (id: string) => decisionsOf(id).sort((a, b) => b.seq - a.seq)[0];
const humans = (id: string) => decisionsOf(id).filter((d) => d.actor === 'human');
const check = (d: StoredDecision, id: string) => d.checks.find((c) => c.id === id)!;
const inserts = () => db.rpcs.filter((r) => r.name === 'insert_decision').length;

// The pair mailed for an invoice's escalation.
async function links(invoiceId: string) {
  const all = send.mock.calls.flatMap((c) => [...c[1].text.matchAll(/https:\/\/app\.test\/approve\/(\S+)/g)].map((m) => m[1]!));
  const pair = { approve: '', reject: '' };
  for (const t of all) {
    const p = await verifyToken(SECRET, t);
    if (p?.invoice_id === invoiceId) pair[p.action] = t;
  }
  return pair;
}
const get = (token: string) => approvals.request(`/approve/${token}`, {}, env);
const post = (path: string, body: unknown, jwt?: string) => approvals.request(path, {
  method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
}, env);
const answer = (token: string, seq: number, extra: object = {}) => post(`/approve/${token}`, { seq, ...extra });
const dashboard = (id: string, action: 'approve' | 'reject', seq: number, extra: object = {}, jwt = 'good') =>
  post(`/invoices/${id}/${action}`, { seq, ...extra }, jwt);
const USED = { error: 'token_used', message: 'Este enlace ya se usó' };
const DECIDED = { error: 'already_decided', message: 'Esta factura ya fue decidida' };
const CHANGED = { error: 'changed', message: 'Esta factura cambió desde que abriste el enlace; ábrelo de nuevo.' };
const INVALID = { error: 'invalid_token', message: 'Este enlace no es válido o venció' };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  send.mockClear();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('GET /api/approve/:token (AC-35, R-55)', () => {
  it('shows the invoice and its latest ESCALAR decision and writes nothing, however often it is opened', async () => {
    await setup(['11']);
    const { approve } = await links('A-11');
    const writes = db.queries.filter((q) => q.op === 'insert').length;
    const rpcs = db.rpcs.length;
    for (let i = 0; i < 2; i++) {
      const res = await get(approve);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        action: 'approve', expires_at: new Date(Date.parse(NOW) + 48 * 3600e3).toISOString(),
        invoice: { id: 'A-11', source: 'pdf', fields: { payee_name: 'Nube Sur LLC', amount: 4200 } },
        decision: { seq: 1, outcome: 'ESCALAR', actor: 'agent' },
      });
    }
    expect(db.queries.filter((q) => q.op === 'insert').length).toBe(writes);
    expect(db.rpcs.length).toBe(rpcs);
    expect(decisionsOf('A-11')).toHaveLength(1);
  });

  it('a tampered, expired, unknown or malformed token -> "no es válido o venció", nothing written', async () => {
    await setup(['11']);
    const { approve } = await links('A-11');
    const p = (await verifyToken(SECRET, approve))!;
    const tampered = `${approve.slice(0, -2)}${approve.endsWith('AA') ? 'BB' : 'AA'}`;
    const unknown = await signToken(SECRET, { ...p, decision_id: 'dec-999' }); // validly signed, never stored
    for (const t of [tampered, unknown, 'nope']) {
      const res = await get(t);
      expect([res.status, await res.json()]).toEqual([404, INVALID]);
      const r = await answer(t, 1);
      expect([r.status, await r.json()]).toEqual([404, INVALID]);
    }
    vi.setSystemTime(Date.parse(NOW) + 48 * 3600e3 + 1);
    expect([(await get(approve)).status, (await answer(approve, 1)).status]).toEqual([404, 404]);
    expect(humans('A-11')).toEqual([]);
  });

  it('after the invoice was decided -> "ya fue decidida"; after the pair was used -> "ya se usó"', async () => {
    await setup(['11']);
    const { approve, reject } = await links('A-11');
    await dashboard('A-11', 'reject', 1);
    expect([(await get(approve)).status, await (await get(reject)).json()]).toEqual([409, DECIDED]);
    await setup(['11']);
    const pair = await links('A-11');
    await answer(pair.approve, 1);
    expect([(await get(pair.reject)).status, await (await get(pair.reject)).json()]).toEqual([409, USED]);
  });
});

describe('POST /api/approve/:token (AC-34, AC-36, AC-37, R-02, R-03, R-55)', () => {
  it('approve -> human PAGAR by the approver via link, the failed overridable check kept no_cumple with overridden.by, the pair spent', async () => {
    await setup(['11']);
    const { approve } = await links('A-11');
    const esc = latest('A-11')!;
    const res = await answer(approve, 1, { note: 'ok, es la suscripción', actor_email: 'evil@x.example', channel: 'dashboard' });
    expect(res.status).toBe(200);
    const { decision } = await res.json() as { decision: StoredDecision };
    expect(decision).toMatchObject({ seq: 2, outcome: 'PAGAR', actor: 'human', actor_email: APPROVER, channel: 'link', note: 'ok, es la suscripción',
      policy_version: 1, amount_usd: 4200, payment: { beneficiary: 'Nube Sur LLC', amount: 4200 }, question_es: null });
    expect(decision.headline_es).toMatch(/^PAGAR · 4\.200 USD a Nube Sur LLC, .*aprobado por juan\.perez@andina\.example$/);
    expect(decision.headline_en).toMatch(/^PAY · 4,200 USD to Nube Sur LLC/);
    expect(check(decision, 'umbral_aprobacion')).toMatchObject({ verdict: 'no_cumple', overridden: { by: APPROVER, channel: 'link' } });
    expect(decision.checks.filter((c) => c.overridden).map((c) => c.id)).toEqual(['umbral_aprobacion']);
    expect(db.tables.approval_uses).toEqual([{ token_hash: expect.any(String), decision_id: esc.id, company_id: 'A' }]);
    expect(db.rpcs.filter((r) => r.name === 'insert_decision').at(-1)!.args).toMatchObject({ p_expected_seq: 1, p_expected_committed_usd: 0 });
  });

  it('approve then the pair\'s reject link -> 409 "ya se usó", and a second POST of the same link too: one human decision', async () => {
    await setup(['11']);
    const { approve, reject } = await links('A-11');
    expect((await answer(approve, 1)).status).toBe(200);
    for (const r of [await answer(reject, 2), await answer(approve, 2)]) expect([r.status, await r.json()]).toEqual([409, USED]);
    expect(humans('A-11')).toHaveLength(1);
  });

  it('reject -> human FRENAR via link with the escalated checks (which do not produce FRENAR themselves) and no payment', async () => {
    await setup(['15']);
    const { reject } = await links('A-15');
    const esc = latest('A-15')!;
    const res = await answer(reject, 1);
    const { decision } = await res.json() as { decision: StoredDecision };
    expect(decision).toMatchObject({ outcome: 'FRENAR', actor: 'human', actor_email: APPROVER, channel: 'link', payment: null, question_es: null, amount_usd: 2500 });
    expect(decision.checks).toEqual(esc.checks);
    expect(outcomeOf(decision.checks)).not.toBe('FRENAR');
    expect(decision.headline_es).toMatch(/^FRENAR · 2\.500 USD a Laura Méndez/);
    expect(db.tables.approval_uses).toHaveLength(1);
  });

  it('a token created for ESCALAR seq 1 answers seq 2 after a re-evaluation, against seq 2\'s failing checks', async () => {
    await setup(['11']);
    const { approve } = await links('A-11');
    const nube = db.tables.beneficiaries!.find((b) => b.name === 'Nube Sur LLC')!;
    nube.bank_account = 'ACH routing 026009593 cuenta 000000001'; // the directory changed: the account no longer matches
    await agent(['A-11'], 'reevaluate');
    expect(decisionsOf('A-11').map((d) => [d.seq, d.outcome])).toEqual([[1, 'ESCALAR'], [2, 'ESCALAR']]);
    expect(await (await get(approve)).json()).toMatchObject({ decision: { seq: 2 } });
    const { decision } = await (await answer(approve, 2)).json() as { decision: StoredDecision };
    expect(decision).toMatchObject({ seq: 3, outcome: 'PAGAR' });
    expect(decision.checks.filter((c) => c.overridden).map((c) => c.id).sort()).toEqual(['beneficiario_cuenta', 'umbral_aprobacion']);
    expect(db.tables.approval_uses).toEqual([expect.objectContaining({ decision_id: decisionsOf('A-11')[0]!.id })]);
  });

  it('a stale form seq -> 409 "cambió", nothing written and the pair still usable', async () => {
    await setup(['11']);
    const { approve } = await links('A-11');
    await agent(['A-11'], 'reevaluate');
    const before = inserts();
    const res = await answer(approve, 1);
    expect([res.status, await res.json()]).toEqual([409, CHANGED]);
    expect(inserts()).toBe(before);
    expect(db.tables.approval_uses ?? []).toEqual([]);
    expect((await answer(approve, 2)).status).toBe(200);
  });

  it('a decision appended between the read and the write (ALREADY_DECIDED) -> 409 "cambió" and the pair not spent', async () => {
    await setup(['11']);
    const { approve } = await links('A-11');
    db.fail.insert_decision = () => 'ALREADY_DECIDED';
    expect([(await answer(approve, 1)).status, humans('A-11')]).toEqual([409, []]);
    expect(db.tables.approval_uses ?? []).toEqual([]);
  });

  it('STALE_PERIOD -> re-reads the period and retries; still stale after 3 retries -> 503, nothing written', async () => {
    await setup(['11']);
    const { approve } = await links('A-11');
    const guard = db.fail.insert_decision!;
    let first = true;
    db.fail.insert_decision = (a) => (first ? ((first = false), 'STALE_PERIOD') : guard(a));
    expect((await answer(approve, 1)).status).toBe(200);
    expect(humans('A-11')).toHaveLength(1);
    await setup(['11']);
    const pair = await links('A-11');
    db.fail.insert_decision = () => 'STALE_PERIOD';
    const before = inserts();
    const res = await answer(pair.approve, 1);
    expect([res.status, inserts() - before, humans('A-11'), db.tables.approval_uses ?? []]).toEqual([503, 4, [], []]);
  });

  it('the database refusing a human answer (NOT_ESCALATED, FINAL_DECISION) -> 409 "ya fue decidida", the pair not spent', async () => {
    for (const refusal of ['NOT_ESCALATED', 'FINAL_DECISION']) {
      await setup(['11']);
      db.fail.insert_decision = () => refusal;
      const res = await answer((await links('A-11')).approve, 1);
      expect([res.status, await res.json(), db.tables.approval_uses ?? []]).toEqual([409, DECIDED, []]);
    }
  });

  it('the pair spent by the other link meanwhile (unique decision_id) -> 409 "ya se usó"', async () => {
    await setup(['11']);
    const { approve } = await links('A-11');
    const from = db.from;
    db.from = ((t: string) => (t === 'approval_uses' && db.tables.decisions!.some((d) => d.actor === 'human')
      ? { insert: async () => ({ data: null, error: { code: '23505', message: 'duplicate key' } }) } : from(t))) as typeof db.from;
    const res = await answer(approve, 1);
    expect([res.status, await res.json()]).toEqual([409, USED]);
  });

  it('a company without approver_email -> the link is not valid, nothing written (AC-37: no actor to record)', async () => {
    await setup(['11']);
    const { approve } = await links('A-11');
    db.tables.companies![0]!.approver_email = null;
    expect([(await answer(approve, 1)).status, humans('A-11')]).toEqual([404, []]);
  });

  it('a missing or bad seq, or a note that is not a short string -> 400, nothing written', async () => {
    await setup(['11']);
    const { approve } = await links('A-11');
    for (const body of [{}, { seq: '1' }, { seq: 1.5 }, { seq: 1, note: 5 }, { seq: 1, note: 'x'.repeat(1001) }]) {
      expect((await post(`/approve/${approve}`, body)).status).toBe(400);
    }
    expect((await approvals.request(`/approve/${approve}`, { method: 'POST', body: 'not json' }, env)).status).toBe(400);
    expect(humans('A-11')).toEqual([]);
  });
});

describe('dashboard answers (AC-34, AC-37, R-03)', () => {
  it('approve: actor_email from the verified session, never from the body; channel dashboard; no approval_uses row', async () => {
    await setup(['11']);
    const res = await dashboard('A-11', 'approve', 1, { actor_email: 'evil@x.example', channel: 'link' });
    expect(res.status).toBe(200);
    const { decision } = await res.json() as { decision: StoredDecision };
    expect(decision).toMatchObject({ outcome: 'PAGAR', actor: 'human', actor_email: MEMBER, channel: 'dashboard' });
    expect(check(decision, 'umbral_aprobacion').overridden).toEqual({ by: MEMBER, channel: 'dashboard' });
    expect(db.tables.approval_uses ?? []).toEqual([]);
  });

  it('a link answer after a dashboard answer -> 409 "ya fue decidida"', async () => {
    await setup(['11']);
    const { reject } = await links('A-11');
    await dashboard('A-11', 'approve', 1);
    const res = await answer(reject, 2);
    expect([res.status, await res.json()]).toEqual([409, DECIDED]);
    expect(humans('A-11')).toHaveLength(1);
  });

  it('a dashboard approve after a link approve -> 409 "ya fue decidida"', async () => {
    await setup(['11']);
    await answer((await links('A-11')).approve, 1);
    const res = await dashboard('A-11', 'approve', 2);
    expect([res.status, await res.json()]).toEqual([409, DECIDED]);
    expect(humans('A-11')).toHaveLength(1);
  });

  it('two concurrent answers -> exactly one human decision, the other 409', async () => {
    await setup(['11']);
    const res = await Promise.all([dashboard('A-11', 'approve', 1), dashboard('A-11', 'reject', 1)]);
    expect(res.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(humans('A-11')).toHaveLength(1);
  });

  it('reject from the dashboard -> human FRENAR with channel dashboard', async () => {
    await setup(['15']);
    const { decision } = await (await dashboard('A-15', 'reject', 1, { note: 'cuenta sospechosa' })).json() as { decision: StoredDecision };
    expect(decision).toMatchObject({ outcome: 'FRENAR', actor: 'human', actor_email: MEMBER, channel: 'dashboard', note: 'cuenta sospechosa' });
  });

  it('without a session -> 401; another company\'s invoice -> 404; nothing written', async () => {
    await setup(['11']);
    expect((await post('/invoices/A-11/approve', { seq: 1 })).status).toBe(401);
    expect((await dashboard('A-11', 'approve', 1, {}, 'forged')).status).toBe(401);
    expect((await dashboard('A-11', 'approve', 1, {}, 'other')).status).toBe(404);
    expect((await dashboard('nope', 'reject', 1)).status).toBe(404);
    expect(humans('A-11')).toEqual([]);
  });
});

describe('an archived invoice cannot be answered (AC-34, R-21)', () => {
  const archive = (id: string) => { db.tables.invoices!.find((i) => i.id === id)!.archived = true; };
  const NOT_FOUND = { error: 'not_found', message: 'Factura no encontrada' };
  const uses = () => db.tables.approval_uses?.length ?? 0;

  it('the emailed approve link on an archived invoice -> 404, no human decision, no approval_uses', async () => {
    await setup(['11']);
    const { approve } = await links('A-11');
    archive('A-11');
    const res = await answer(approve, 1);
    expect([res.status, await res.json()]).toEqual([404, NOT_FOUND]);
    expect(humans('A-11')).toEqual([]);
    expect(uses()).toBe(0);
  });

  it('the dashboard approve and reject on an archived invoice -> 404, no human decision', async () => {
    await setup(['11']);
    archive('A-11');
    for (const action of ['approve', 'reject'] as const) {
      const res = await dashboard('A-11', action, 1);
      expect([res.status, await res.json()]).toEqual([404, NOT_FOUND]);
    }
    expect(humans('A-11')).toEqual([]);
    expect(uses()).toBe(0);
  });

  it('GET on an archived invoice\'s link is not actionable and writes nothing', async () => {
    await setup(['11']);
    const { approve } = await links('A-11');
    archive('A-11');
    const writes = db.queries.filter((q) => q.op === 'insert').length;
    const rpcs = db.rpcs.length;
    const res = await get(approve);
    expect([res.status, await res.json()]).toEqual([404, NOT_FOUND]);
    expect(db.queries.filter((q) => q.op === 'insert').length).toBe(writes);
    expect(db.rpcs.length).toBe(rpcs);
  });
});

describe('the video sequence (R-35, AC-34)', () => {
  const period = () => db.rpc('period_state', { p_company_id: 'A', p_month: `${bogotaDay(NOW).slice(0, 7)}-01` })
    .then((r) => r.data as { committed_usd: number; paid_usd: number });

  it('approving Nube Sur first re-escalates on the period budget, the override kept; the pair is then spent', async () => {
    await setup();
    const { approve, reject } = await links('A-11');
    const { decision } = await (await answer(approve, 1)).json() as { decision: StoredDecision };
    expect(decision).toMatchObject({ seq: 2, outcome: 'ESCALAR', actor: 'human', channel: 'link' });
    expect(check(decision, 'presupuesto_periodo').verdict).toBe('no_cumple');
    expect(check(decision, 'umbral_aprobacion')).toMatchObject({ verdict: 'no_cumple', overridden: { by: APPROVER, channel: 'link' } });
    expect(decision.question_es).toMatch(/^Juan, /);
    expect(send).toHaveBeenCalledTimes(11); // the agent's 11 escalation mails; a re-escalation mails nobody (R-16)
    expect([(await answer(reject, 2)).status, (await answer(approve, 2)).status]).toEqual([409, 409]);
    expect(humans('A-11')).toHaveLength(1);
  });

  it('rejecting Laura #15 first releases 2.500, then approving Nube Sur ends in PAGAR', async () => {
    await setup();
    const p0 = await period();
    expect((await answer((await links('A-15')).reject, 1)).status).toBe(200);
    const p1 = await period();
    expect(p1.committed_usd).toBeCloseTo(p0.committed_usd - 2500, 2);
    const { decision } = await (await dashboard('A-11', 'approve', 1)).json() as { decision: StoredDecision };
    expect(decision.outcome).toBe('PAGAR');
    const p2 = await period();
    expect([p2.committed_usd, p2.paid_usd]).toEqual([p1.committed_usd, p1.paid_usd + 4200]);
  });
});

describe('mounted on the Worker', () => {
  it('serves the approval routes under /api, before the JSON 404', async () => {
    const { app } = await import('../index');
    await setup(['11']);
    expect(await (await app.request('/api/approve/nope', {}, env)).json()).toEqual(INVALID);
    expect((await app.request('/api/invoices/A-11/approve', { method: 'POST', body: '{"seq":1}' }, env)).status).toBe(401);
  });
});
