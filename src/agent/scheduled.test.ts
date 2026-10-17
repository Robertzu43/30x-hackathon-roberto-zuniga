/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sql from '../../supabase/migrations/20261017000300_seed_andina.sql?raw';
import { bogotaDay } from '../engine/checks';
import type { Env } from '../env';
import { sendEmail } from '../lib/email';
import { fakeDb, type FakeDb } from './__fixtures__/fake-db';

let db: FakeDb;
vi.mock('../lib/admin', () => ({ adminClient: () => db }));
vi.mock('../lib/email', async (orig) => ({ ...(await orig<typeof import('../lib/email')>()), sendEmail: vi.fn(async () => ({ sent: true })) }));
const { scheduled, CRON_MAX_INVOICES } = await import('./scheduled');

const SEED = JSON.parse(sql.match(/\$seed\$([\s\S]*?)\$seed\$/)?.[1] ?? 'null');
const NOW = '2026-10-17T15:00:00Z';
const env = { AI: { run: async () => { throw new Error('down'); } }, APP_URL: 'https://app.test', APPROVAL_HMAC_SECRET: 'secret' } as unknown as Env;
const tick = () => scheduled({} as ScheduledController, env);
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

describe('cron cap and idle ticks', () => {
  it('writes the tick row even when nothing is pending', async () => {
    db = fakeDb();
    await tick();
    expect(db.tables.agent_runs).toEqual([{ company_id: null, trigger: 'cron', decided: null, errors: 0 }]);
  });

  it('takes at most CRON_MAX_INVOICES per tick, the oldest; the rest wait and still end as expected', async () => {
    db = fakeDb(merge(workspace('A', { demo: true }), workspace('B', { demo: true }), workspace('C', { demo: true })));
    const all = db.tables.invoices!.map((i) => ({ id: String(i.id), at: String(i.received_at) }))
      .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id)).map((i) => i.id);
    expect(all.length).toBeGreaterThan(CRON_MAX_INVOICES);
    await tick();
    expect([...inserted()].sort()).toEqual(all.slice(0, CRON_MAX_INVOICES).sort());
    await tick();
    for (const inv of db.tables.invoices!) expect([inv.id, decisionsOf(String(inv.id)).map((d) => d.outcome)]).toEqual([inv.id, [inv.expected_outcome]]);
  });
});
