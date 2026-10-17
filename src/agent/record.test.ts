import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import { fakeDb, type FakeDb } from './__fixtures__/fake-db';
import type { DecisionInput } from './record';

let admin: FakeDb;
vi.mock('../lib/admin', () => ({ adminClient: () => admin }));
const { recorder } = await import('./record');

const env = {} as Env;
const AGENT: DecisionInput = { outcome: 'ESCALAR', actor: 'agent', checks: [], amount_usd: 4200, payment: null, policy_version: 1,
  headline_es: 'h', headline_en: 'h', question_es: 'q', question_en: 'q' };
const TOKEN = { token_hash: 'h1', invoice_id: 'inv-b', decision_id: 'd1', expires_at: '2026-10-19T15:00:00.000Z', email_sent: true, sent_to: 'x@y.co' };

beforeEach(() => {
  admin = fakeDb({ invoices: [
    { id: 'inv-a', company_id: 'A', received_at: '2026-10-10T15:00:00Z' },
    { id: 'inv-b', company_id: 'B', received_at: '2026-10-10T15:00:00Z' },
  ] });
});

describe('record.ts, the only writer of decisions, approval_tokens and agent_runs (AC-38, R-32)', () => {
  it('writes a decision through insert_decision with the expected seq and committed amount', async () => {
    const row = await recorder(env, 'A').decision('inv-a', 0, AGENT, 0);
    expect(admin.rpcs).toEqual([{ name: 'insert_decision', args: { p_invoice_id: 'inv-a', p_expected_committed_usd: 0, p_decision: AGENT, p_expected_seq: 0 } }]);
    expect(row).toMatchObject({ invoice_id: 'inv-a', company_id: 'A', seq: 1, outcome: 'ESCALAR' });
  });

  it('company mismatch -> refused, nothing written', async () => {
    const r = recorder(env, 'A');
    await expect(r.decision('inv-b', 0, AGENT, 0)).rejects.toThrow('COMPANY_MISMATCH');
    await expect(r.tokens([TOKEN])).rejects.toThrow('COMPANY_MISMATCH');
    await expect(r.decision('missing', 0, AGENT, 0)).rejects.toThrow('COMPANY_MISMATCH');
    expect(admin.rpcs).toEqual([]);
    expect(admin.tables.decisions).toEqual([]);
    expect(admin.tables.approval_tokens).toEqual([]);
    expect(admin.queries.every((q) => q.op === 'select' && q.table === 'invoices')).toBe(true);
  });

  it('the cron tick authority (no company) can write no decision and no token', async () => {
    await expect(recorder(env, null).decision('inv-a', 0, AGENT, 0)).rejects.toThrow('COMPANY_MISMATCH');
    await expect(recorder(env, null).tokens([{ ...TOKEN, invoice_id: 'inv-a' }])).rejects.toThrow('COMPANY_MISMATCH');
    expect(admin.rpcs).toEqual([]);
  });

  it('a database refusal reaches the caller by its name', async () => {
    admin.fail.insert_decision = () => 'ALREADY_DECIDED';
    await expect(recorder(env, 'A').decision('inv-a', 0, AGENT, 0)).rejects.toThrow('ALREADY_DECIDED');
  });

  it('stores token rows under the authorised company, whatever the caller passes', async () => {
    await recorder(env, 'B').tokens([{ ...TOKEN, company_id: 'A' } as typeof TOKEN]);
    expect(admin.tables.approval_tokens).toEqual([{ ...TOKEN, company_id: 'B' }]);
  });

  it('records a link use under the authorised company, after re-reading the invoice (R-03, R-55)', async () => {
    await recorder(env, 'A').approvalUse('inv-a', 'h1', 'd1');
    expect(admin.tables.approval_uses).toEqual([{ token_hash: 'h1', decision_id: 'd1', company_id: 'A' }]);
    expect(admin.queries.map((q) => `${q.op} ${q.table}`)).toEqual(['select invoices', 'insert approval_uses']);
  });

  it('a link use of another company\'s invoice is refused, nothing written', async () => {
    await expect(recorder(env, 'A').approvalUse('inv-b', 'h1', 'd1')).rejects.toThrow('COMPANY_MISMATCH');
    expect(admin.tables.approval_uses ?? []).toEqual([]);
  });

  it('a pair already spent (unique violation 23505) -> TOKEN_USED; other errors keep their message', async () => {
    const base = admin;
    const failWith = (error: { code: string; message: string }) => {
      admin = { ...base, from: (t: string) => (t === 'approval_uses' ? { insert: async () => ({ data: null, error }) } : base.from(t)) } as unknown as FakeDb;
    };
    failWith({ code: '23505', message: 'duplicate key value violates unique constraint' });
    await expect(recorder(env, 'A').approvalUse('inv-a', 'h2', 'd1')).rejects.toThrow('TOKEN_USED');
    failWith({ code: '42501', message: 'permission denied' });
    await expect(recorder(env, 'A').approvalUse('inv-a', 'h2', 'd1')).rejects.toThrow('permission denied');
  });

  it('writes one agent_runs row: the company run and the cron tick (company null)', async () => {
    await recorder(env, 'A').run('manual', { PAGAR: 1, FRENAR: 0, ESCALAR: 2 }, 0);
    await recorder(env, null).run('cron', null, 1);
    expect(admin.tables.agent_runs).toEqual([
      { company_id: 'A', trigger: 'manual', decided: { PAGAR: 1, FRENAR: 0, ESCALAR: 2 }, errors: 0 },
      { company_id: null, trigger: 'cron', decided: null, errors: 1 },
    ]);
    expect(admin.queries.map((q) => q.table)).toEqual(['agent_runs', 'agent_runs']);
  });

  it('upserts market rates by (day, currency): a second fetch the same day replaces the row, nothing is deleted (AC-73, AC-38 (a))', async () => {
    const r = recorder(env, null);
    const cop = { day: '2026-10-17', currency: 'COP', usd_per_unit: 0.00031538976, source: 'Yahoo Finance', fetched_at: '2026-10-17T11:00:00.000Z' };
    await r.fxRates([cop, { ...cop, currency: 'MXN', usd_per_unit: 0.054115482 }]);
    await r.fxRates([{ ...cop, usd_per_unit: 0.0003155, source: 'open.er-api.com', fetched_at: '2026-10-17T15:00:00.000Z' }]);
    expect(admin.tables.fx_rates).toEqual([
      { ...cop, usd_per_unit: 0.0003155, source: 'open.er-api.com', fetched_at: '2026-10-17T15:00:00.000Z' },
      { ...cop, currency: 'MXN', usd_per_unit: 0.054115482 },
    ]);
    expect(admin.queries.filter((q) => q.table === 'fx_rates').map((q) => q.op)).toEqual(['upsert', 'upsert']);
  });
  it('no rows -> no request', async () => {
    await recorder(env, null).fxRates([]);
    expect(admin.queries).toEqual([]);
  });
});
