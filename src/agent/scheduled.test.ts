/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sql from '../../supabase/migrations/20261017000300_seed_andina.sql?raw';
import { bogotaDay } from '../engine/checks';
import type { Env } from '../env';
import { sendEmail } from '../lib/email';
import { fakeDb, type FakeDb } from './__fixtures__/fake-db';

let db: FakeDb;
import type { Budget } from '../lib/supabase';
vi.mock('../lib/admin', () => ({ adminClient: (_env: Env, budget?: Budget) => { if (budget) db.meter.budget = budget; return db; } }));
vi.mock('../lib/email', async (orig) => ({ ...(await orig<typeof import('../lib/email')>()), sendEmail: vi.fn(async () => ({ sent: true })) }));
const { scheduled } = await import('./scheduled');

const SEED = JSON.parse(sql.match(/\$seed\$([\s\S]*?)\$seed\$/)?.[1] ?? 'null');
const NOW = '2026-10-17T15:00:00Z';
const ai = { run: vi.fn(async () => { throw new Error('down'); }) };
const env = { AI: ai, APP_URL: 'https://app.test', APPROVAL_HMAC_SECRET: 'secret' } as unknown as Env;
const TICK = 300_000; // */5 * * * *
const tick = (n = 0) => scheduled({ scheduledTime: n * TICK } as ScheduledController, env);
// Every subrequest a tick makes: Supabase calls (fake db), Workers AI calls and emails.
async function counted(n: number) {
  const before = db.meter.calls + ai.run.mock.calls.length + send.mock.calls.length;
  await tick(n);
  return db.meter.calls + ai.run.mock.calls.length + send.mock.calls.length - before;
}
const send = vi.mocked(sendEmail);

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
interface SeedRow { nn: string; source: string; expected_outcome: string; prev_month?: boolean; issue: number | null; due: number | null; raw_text: string | null; fields: object }
function workspace(id: string, o: { demo?: boolean; only?: string[] } = {}) {
  const start = Date.parse(`${bogotaDay(NOW).slice(0, 7)}-01T00:00:00-05:00`);
  return {
    companies: [{ id, approver_email: `juan@${id}.example`, is_demo: !!o.demo }],
    policies: [{ company_id: id, version: 1, name: 'Política general', rules: SEED.rules }],
    beneficiaries: SEED.beneficiaries.map((b: object, n: number) => ({ ...b, id: `${id}-b${n}`, company_id: id })),
    invoices: (SEED.invoices as SeedRow[]).filter((r) => !o.only || o.only.includes(r.nn)).map((r) => {
      const received_at = new Date(r.prev_month ? start - 5 * 864e5 : start + ((Date.parse(NOW) - start) * Number(r.nn)) / 30).toISOString();
      const day = bogotaDay(received_at);
      return { id: `${id}-${r.nn}`, company_id: id, source: r.source, raw_text: r.raw_text, archived: false, expected_outcome: r.expected_outcome, received_at,
        fields: { ...r.fields, issue_date: r.issue === null ? null : addDays(day, r.issue), due_date: r.due === null ? null : addDays(day, r.due), confidence: {} } };
    }),
  };
}
type Tables = Record<string, Array<Record<string, unknown>>>;
const merge = (...ws: Tables[]) =>
  ws.reduce<Tables>((acc, w) => { for (const [k, v] of Object.entries(w)) acc[k] = [...(acc[k] ?? []), ...v]; return acc; }, {});
const decisionsOf = (id: string) => db.tables.decisions!.filter((d) => d.invoice_id === id);
const inserted = () => db.rpcs.filter((r) => r.name === 'insert_decision').map((r) => r.args.p_invoice_id);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  send.mockClear();
  ai.run.mockClear();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('the 5-minute cron (D23, AC-62, R-23, R-24, R-25)', () => {
  beforeEach(() => {
    db = fakeDb(merge(
      workspace('N', { only: ['01', '03', '05', '11', '13', '15'] }),
      workspace('D', { demo: true, only: ['01', '11'] }),
      { invoices: [{ id: 'X-01', company_id: 'X', source: 'chat', fields: null, archived: false, received_at: '2026-10-01T06:00:00Z' }] }, // no company row: its run throws
    ));
    db.tables.decisions!.push(
      { id: 'old-1', invoice_id: 'N-05', company_id: 'N', seq: 1, outcome: 'PAGAR', amount_usd: 486, actor: 'agent' },
      { id: 'old-2', invoice_id: 'N-13', company_id: 'N', seq: 1, outcome: 'ESCALAR', amount_usd: 2400, actor: 'agent' },
    );
    db.fail.period_state = (a) => (a.p_exclude_invoice === 'N-03' ? 'boom' : undefined); // this invoice's tools throw
    db.fail.insert_decision = (a) => (a.p_invoice_id === 'N-15' ? 'ALREADY_DECIDED' : undefined); // an ingest won the race
  });

  it('decides every company\'s pending invoices oldest first; failures are logged and do not stop the others', async () => {
    await tick();
    expect(inserted()).toEqual(['D-01', 'D-11', 'N-01', 'N-11', 'N-15']);
    expect(['N-01', 'N-11', 'D-01', 'D-11'].map((id) => decisionsOf(id).map((d) => [d.outcome, d.actor])))
      .toEqual([[['PAGAR', 'agent']], [['ESCALAR', 'agent']], [['PAGAR', 'agent']], [['ESCALAR', 'agent']]]);
    expect(decisionsOf('N-03')).toEqual([]);
    expect(decisionsOf('N-15')).toEqual([]);
  });

  it('never touches an invoice that already has a decision', async () => {
    await tick();
    expect(decisionsOf('N-05').map((d) => d.id)).toEqual(['old-1']);
    expect(decisionsOf('N-13').map((d) => d.id)).toEqual(['old-2']);
    expect(inserted()).not.toContain('N-05');
    expect(inserted()).not.toContain('N-13');
  });

  it('mails only the normal company\'s new ESCALAR: not the demo company, not the race loser', async () => {
    await tick();
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]![1]).toMatchObject({ to: 'juan@N.example', subject: decisionsOf('N-11')[0]!.question_es });
    expect(db.tables.approval_tokens!.map((t) => t.invoice_id)).toEqual(['N-11', 'N-11']);
  });

  it('writes one run row per company and one cron tick row with no counts and errors 0 (R-54)', async () => {
    await tick();
    expect(db.tables.agent_runs).toEqual([
      { company_id: 'D', trigger: 'cron', decided: { PAGAR: 1, FRENAR: 0, ESCALAR: 1 }, errors: 0 },
      { company_id: 'N', trigger: 'cron', decided: { PAGAR: 1, FRENAR: 0, ESCALAR: 1 }, errors: 1 },
      { company_id: null, trigger: 'cron', decided: null, errors: 0 },
    ]);
  });

  it('a company whose tools throw: its own row carries the error, the tick row stays errors 0 and decided null (R-54, AC-63)', async () => {
    db = fakeDb(workspace('N', { only: ['03'] }));
    db.fail.period_state = () => 'boom';
    await tick();
    expect(db.tables.agent_runs).toEqual([
      { company_id: 'N', trigger: 'cron', decided: { PAGAR: 0, FRENAR: 0, ESCALAR: 0 }, errors: 1 },
      { company_id: null, trigger: 'cron', decided: null, errors: 0 },
    ]);
  });

  it('after the cross-company pick, every query names the company', async () => {
    await tick();
    const [pick, ...rest] = db.queries.filter((q) => q.op === 'select' && q.table !== 'invoices');
    expect(pick).toEqual({ table: 'invoice_current', op: 'select', eq: {} });
    for (const q of rest) expect(q.eq.company_id ?? (q.table === 'companies' ? q.eq.id : undefined), q.table).toBeDefined();
    expect(db.rpcs.filter((r) => r.name === 'period_state').every((r) => r.args.p_company_id)).toBe(true);
  });
});

describe('budgeted ticks and company turns (R-58, AC-62, AC-70)', () => {
  it('writes the tick row even when nothing is pending', async () => {
    db = fakeDb();
    await tick();
    expect(db.tables.agent_runs).toEqual([{ company_id: null, trigger: 'cron', decided: null, errors: 0 }]);
  });

  it('companies with pending invoices take turns: tick t starts with company floor(t / 300000) mod C, sorted by id', async () => {
    const firsts: string[] = [];
    for (const n of [0, 1, 2, 3, 7]) {
      db = fakeDb(merge(workspace('C', { only: ['01', '03'] }), workspace('A', { only: ['01', '03'] }), workspace('B', { only: ['01', '03'] })));
      await tick(n);
      firsts.push(String(inserted()[0]));
    }
    expect(firsts).toEqual(['A-01', 'B-01', 'C-01', 'A-01', 'B-01']);
  });

  it('k = 4: in the worst case (every invoice a mailed escalation the reader must read) one tick decides 4 invoices of one company, within 40 counted subrequests', async () => {
    const w = workspace('N', { only: ['01', '03', '05', '06', '07', '08', '09', '10'] });
    for (const i of w.invoices) Object.assign(i, { fields: null, raw_text: 'texto ilegible' }); // AI down -> ilegible -> ESCALAR, mailed
    db = fakeDb(w);
    expect(await counted(0)).toBeLessThanOrEqual(40);
    expect(inserted()).toEqual(['N-01', 'N-03', 'N-05', 'N-06']);
    expect(send).toHaveBeenCalledTimes(4);
    expect(db.tables.approval_tokens).toHaveLength(8); // every written ESCALAR has its pair
    expect(db.tables.agent_runs!.at(-1)).toEqual({ company_id: null, trigger: 'cron', decided: null, errors: 0 });
  });

  it('a backlog of three companies drains tick by tick: every tick within 40, decides at least one, oldest first, outcomes as expected', async () => {
    db = fakeDb(merge(workspace('A', { demo: true }), workspace('B'), workspace('C', { demo: true })));
    const pending = () => db.tables.invoices!.filter((i) => decisionsOf(String(i.id)).length === 0).length;
    let ticks = 0;
    while (pending() > 0 && ticks < 3 * Math.ceil(29 / 4)) { // C x ceil(N / k)
      const before = pending();
      expect(await counted(ticks++)).toBeLessThanOrEqual(40);
      expect(pending()).toBeLessThan(before);
    }
    expect(pending()).toBe(0);
    for (const inv of db.tables.invoices!) expect([inv.id, decisionsOf(String(inv.id)).map((d) => d.outcome)]).toEqual([inv.id, [inv.expected_outcome]]);
    for (const c of ['A', 'B', 'C']) {
      const order = inserted().filter((id) => String(id).startsWith(c));
      expect(order).toEqual(db.tables.invoices!.filter((i) => i.company_id === c)
        .sort((a, b) => String(a.received_at).localeCompare(String(b.received_at)) || String(a.id).localeCompare(String(b.id))).map((i) => i.id));
    }
    expect(db.tables.agent_runs!.filter((r) => r.company_id === null).every((r) => r.errors === 0 && r.decided === null)).toBe(true);
  });
});
