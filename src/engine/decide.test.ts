/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import sql from '../../supabase/migrations/20261017000300_seed_andina.sql?raw';
import { round2 } from '../lib/money';
import { bogotaDay, findBeneficiary } from './checks';
import { decide, decideWithOverrides, HUMAN_OVERRIDABLE, outcomeOf } from './decide';
import {
  CHECK_IDS, type Beneficiary, type Check, type CheckId, type Decision, type Invoice, type InvoiceFields,
  type Outcome, type PeriodState, type PolicyRules,
} from './types';

// The seed migration is the single source of the demo data (Task 3).
const SEED = JSON.parse(sql.match(/\$seed\$([\s\S]*?)\$seed\$/)?.[1] ?? 'null');
const RULES: PolicyRules = SEED.rules;
const DIRECTORY: Beneficiary[] = SEED.beneficiaries.map((b: Beneficiary) => ({
  ...b, id: `id-${b.name}`, agreement: { ...b.agreement, valid_until: '2027-10-17' },
}));

const NOW = '2026-10-17T15:00:00Z'; // 10:00 in Bogotá
const RECEIVED = '2026-10-10T15:00:00Z';
const EMPTY: PeriodState = { committed_usd: 0, paid_usd: 0, previous: [] };
const BY = { email: 'roberto@hacketix.com', channel: 'dashboard' as const };

const fields = (p: Partial<InvoiceFields> = {}): InvoiceFields => ({
  payee_name: 'Laura Méndez', amount: 2500, currency: 'USD', invoice_number: '1042', issue_date: '2026-10-10',
  due_date: '2026-11-24', concept: 'Retainer mensual de desarrollo', bank_account: 'Bancolombia ahorros 0012-3456-4821',
  confidence: {}, ...p,
});
const inv = (p: Partial<InvoiceFields> = {}, received_at = RECEIVED): Invoice =>
  ({ id: 'inv-x', received_at, source: 'pdf', fields: fields(p) });

interface Opts { rules?: PolicyRules | null; period?: Partial<PeriodState>; received_at?: string; directory?: Beneficiary[] }
const run = (p: Partial<InvoiceFields> = {}, o: Opts = {}): Decision => {
  const i = inv(p, o.received_at);
  return decide(i, findBeneficiary(i.fields.payee_name, o.directory ?? DIRECTORY), 'rules' in o ? o.rules ?? null : RULES,
    { ...EMPTY, ...o.period }, NOW);
};
const check = (d: Decision, id: CheckId) => d.checks.find((c) => c.id === id) as Check;
const failing = (d: Decision) => d.checks.filter((c) => c.verdict !== 'cumple').map((c) => c.id).sort();
const prev = (p: Partial<PeriodState['previous'][number]>): PeriodState['previous'][number] => ({
  invoice_id: 'inv-prev', invoice_number: '1040', beneficiary_id: 'id-Laura Méndez', payee_name: 'Laura Méndez',
  amount_usd: 2500, concept: 'Retainer mensual de desarrollo', received_at: '2026-10-05T15:00:00Z', outcome: 'PAGAR', ...p,
});

describe('all cumple', () => {
  it('-> PAGAR with the payment in Blinka shape, 13 checks in order, no overridden key (D2, AC-69)', () => {
    const d = run();
    expect(d.outcome).toBe('PAGAR');
    expect(d.checks.map((c) => c.id)).toEqual([...CHECK_IDS]);
    expect(d.checks.every((c) => c.verdict === 'cumple' && !('overridden' in c))).toBe(true);
    expect(d.amount_usd).toBe(2500);
    expect(d.payment).toEqual({ beneficiary: 'Laura Méndez', route: 'COP · transferencia', currency: 'USD', amount: 2500 });
  });
  it('comparisons are inclusive: 2.500 at a 2.500 threshold, budget and balance exactly reached (D24)', () => {
    expect(run({}, { period: { committed_usd: 39500, paid_usd: 20500 } }).outcome).toBe('PAGAR');
  });
});

describe('consequence table, one test per row (AC-17, D15)', () => {
  it('exact duplicate -> FRENAR', () => {
    const d = run({}, { period: { previous: [prev({ invoice_number: '1042', outcome: 'FRENAR' })] } });
    expect([d.outcome, failing(d)]).toEqual(['FRENAR', ['duplicado_exacto']]);
    expect(check(d, 'duplicado_exacto').values.duplicate_of).toBe('inv-prev');
  });
  it('over the per-payment limit -> FRENAR', () => {
    const d = run({ payee_name: 'Forma Studio', bank_account: 'IBAN ES91 2100 0418 4502 0005 1332', amount: 5000.01 });
    expect([d.outcome, failing(d)]).toEqual(['FRENAR', ['limite_pago', 'umbral_aprobacion']]);
  });
  it('FRENAR and ESCALAR triggers together -> FRENAR wins', () => {
    const d = run({ payee_name: 'Pixel Lab', amount: 9000 });
    expect(d.outcome).toBe('FRENAR');
    expect(check(d, 'beneficiario_permitido').verdict).toBe('no_cumple');
  });
  it('new beneficiary -> ESCALAR', () => {
    const d = run({ payee_name: 'Pixel Lab' });
    expect([d.outcome, check(d, 'beneficiario_permitido').verdict]).toEqual(['ESCALAR', 'no_cumple']);
    expect(check(d, 'beneficiario_permitido').values).toMatchObject({ payee_name: 'Pixel Lab', directory_name: null });
  });
  it('changed bank account -> ESCALAR "cuenta cambiada" with both last-4 snapshots (D4, R-29)', () => {
    const d = run({ bank_account: 'Nequi 300-555-7310' });
    expect([d.outcome, failing(d)]).toEqual(['ESCALAR', ['beneficiario_cuenta']]);
    expect(check(d, 'beneficiario_cuenta')).toMatchObject({
      verdict: 'no_cumple', values: { reason: 'cuenta cambiada', invoice_account_last4: '7310', directory_account_last4: '4821' },
    });
  });
  it('over the approval threshold -> ESCALAR', () => {
    const d = run({ payee_name: 'Nube Sur LLC', amount: 4200, bank_account: 'ACH routing 026009593 cuenta 483920175' });
    expect([d.outcome, failing(d)]).toEqual(['ESCALAR', ['umbral_aprobacion']]);
  });
  it('period budget -> ESCALAR (committed + amount above budget)', () => {
    const d = run({}, { period: { committed_usd: 39500.01 } });
    expect([d.outcome, failing(d)]).toEqual(['ESCALAR', ['presupuesto_periodo']]);
    expect(check(d, 'presupuesto_periodo').values).toMatchObject({ committed_usd: 39500.01, amount_usd: 2500, total_usd: 42000.01, budget_usd: 42000 });
  });
  it('insufficient balance -> ESCALAR (paid + amount above balance)', () => {
    const d = run({}, { period: { committed_usd: 20500.01, paid_usd: 20500.01 } });
    expect([d.outcome, failing(d)]).toEqual(['ESCALAR', ['saldo_cuenta']]);
  });
  it('agreement mismatch -> ESCALAR (retainer 3.100 vs 2.500)', () => {
    const d = run({ amount: 3100 });
    expect([d.outcome, failing(d)]).toEqual(['ESCALAR', ['acuerdo', 'umbral_aprobacion']]);
  });
  it('past due -> ESCALAR', () => {
    const d = run({ due_date: '2026-10-16' });
    expect([d.outcome, failing(d)]).toEqual(['ESCALAR', ['vencimiento']]);
  });
  it('outside the period -> ESCALAR', () => {
    const d = run({}, { received_at: '2026-09-30T23:00:00Z' });
    expect([d.outcome, failing(d)]).toEqual(['ESCALAR', ['periodo']]);
  });
  it('illegible reading -> ESCALAR, Lectura not verifiable (AC-13)', () => {
    const d = run({ payee_name: null, amount: null, currency: null, invoice_number: null, issue_date: null, due_date: null, concept: 'ilegible', bank_account: null });
    expect([d.outcome, check(d, 'lectura').verdict, d.payment]).toEqual(['ESCALAR', 'no_verificado', null]);
  });
  it('missing rule -> ESCALAR with that check not verifiable (AC-18)', () => {
    const d = run({}, { rules: { ...RULES, per_payment_limit_usd: null } });
    expect([d.outcome, failing(d)]).toEqual(['ESCALAR', ['limite_pago']]);
    expect(check(d, 'limite_pago').verdict).toBe('no_verificado');
  });
  it('currency without rate -> ESCALAR moneda', () => {
    const d = run({ amount: 2000, currency: 'GBP' });
    expect([d.outcome, check(d, 'moneda').verdict, d.amount_usd]).toEqual(['ESCALAR', 'no_cumple', null]);
    expect(check(d, 'limite_pago').verdict).toBe('no_verificado');
  });
});

describe('reading (AC-14, R-10)', () => {
  it('unknown amount -> ESCALAR, Lectura not verifiable, never a payment', () => {
    const d = run({ amount: null });
    expect([d.outcome, check(d, 'lectura').verdict, d.amount_usd]).toEqual(['ESCALAR', 'no_verificado', null]);
  });
  it('a field read with confidence below 0.8 is not trusted', () => {
    expect(check(run({ confidence: { amount: 0.79 } }), 'lectura').verdict).toBe('no_verificado');
    expect(check(run({ confidence: { amount: 0.8 } }), 'lectura').verdict).toBe('cumple');
  });
  it('zero or negative amount is not a payable reading', () => {
    expect(run({ amount: 0 }).outcome).toBe('ESCALAR');
    expect(check(run({ amount: -2500 }), 'lectura').verdict).toBe('no_verificado');
  });
});

describe('policy missing or empty (AC-18, Review Focus 4)', () => {
  const RULE_CHECKS: CheckId[] = ['beneficiario_permitido', 'acuerdo', 'duplicado_exacto', 'limite_pago', 'umbral_aprobacion',
    'presupuesto_periodo', 'saldo_cuenta', 'vencimiento', 'moneda'];
  const cop = { payee_name: 'Contadores Andinos S.A.S.', amount: 3673500, currency: 'COP', bank_account: 'Davivienda corriente 4569-8812-0034', concept: 'Contabilidad y nómina del mes' };
  it.each([['null', null], ['{}', {}]])('rules %s -> ESCALAR, every rule check no_verificado', (_, rules) => {
    const d = run(cop, { rules });
    expect(d.outcome).toBe('ESCALAR');
    for (const id of RULE_CHECKS) expect([id, check(d, id).verdict]).toEqual([id, 'no_verificado']);
    for (const id of ['lectura', 'beneficiario_cuenta', 'duplicado_probable', 'periodo'] as const) expect([id, check(d, id).verdict]).toEqual([id, 'cumple']);
  });
  it('rules null with a USD invoice -> moneda is still cumple (needs no rate)', () => {
    const d = run({}, { rules: null });
    expect([d.outcome, check(d, 'moneda').verdict]).toEqual(['ESCALAR', 'cumple']);
  });
  it('empty allowed list (empty directory) -> ESCALAR, beneficiario nuevo', () => {
    const d = run({}, { directory: [] });
    expect([d.outcome, check(d, 'beneficiario_permitido').verdict]).toEqual(['ESCALAR', 'no_cumple']);
  });
  it('allowed-only switch off still never pays an unknown payee (account cannot be verified)', () => {
    const d = run({ payee_name: 'Pixel Lab' }, { rules: { ...RULES, allowed_beneficiaries_only: false } });
    expect([d.outcome, check(d, 'beneficiario_permitido').verdict, check(d, 'beneficiario_cuenta').verdict]).toEqual(['ESCALAR', 'cumple', 'no_verificado']);
  });
});

describe('beneficiary (AC-19, D4, R-05)', () => {
  it('names match ignoring case, accents, punctuation and SAS / S.A.S / Ltda / Inc / LLC', () => {
    expect(findBeneficiary('Contadores Andinos S.A.S.', DIRECTORY)?.name).toBe('Contadores Andinos SAS');
    expect(findBeneficiary('nube sur, llc', DIRECTORY)?.name).toBe('Nube Sur LLC');
    expect(findBeneficiary('NUBE SUR INC.', DIRECTORY)?.name).toBe('Nube Sur LLC');
    expect(findBeneficiary('LAURA MENDEZ', DIRECTORY)?.name).toBe('Laura Méndez');
    expect(findBeneficiary('Laura', DIRECTORY)).toBeNull();
    expect(findBeneficiary(null, DIRECTORY)).toBeNull();
  });
  it('invoice without bank account -> ESCALAR, account not verifiable', () => {
    const d = run({ bank_account: null });
    expect([d.outcome, failing(d), check(d, 'beneficiario_cuenta').verdict]).toEqual(['ESCALAR', ['beneficiario_cuenta'], 'no_verificado']);
  });
  it('account compared ignoring spaces, case and punctuation', () => {
    expect(run({ bank_account: 'BANCOLOMBIA AHORROS 001234564821' }).outcome).toBe('PAGAR');
  });
  it('snapshots the directory for the trace (R-29)', () => {
    const d = run();
    expect(check(d, 'beneficiario_permitido').values).toMatchObject({ directory_name: 'Laura Méndez' });
    expect(check(d, 'beneficiario_cuenta').values).toMatchObject({ invoice_account_last4: '4821', directory_account_last4: '4821' });
    expect(check(d, 'acuerdo').values).toMatchObject({ agreement_type: 'retainer', agreement_amount_usd: 2500, cap_usd: null, period: 'monthly' });
  });
});

describe('duplicates (AC-20, D13, R-06, R-20)', () => {
  it('same number outside the duplicate window is not an exact duplicate', () => {
    expect(run({}, { period: { previous: [prev({ invoice_number: '1042', received_at: '2026-09-09T15:00:00Z' })] } }).outcome).toBe('PAGAR');
  });
  it('same number from another beneficiary is not a duplicate', () => {
    expect(run({}, { period: { previous: [prev({ invoice_number: '1042', beneficiary_id: 'id-Ana Souza', payee_name: 'Ana Souza' })] } }).outcome).toBe('PAGAR');
  });
  it('the invoice itself in previous is ignored', () => {
    expect(run({}, { period: { previous: [prev({ invoice_id: 'inv-x', invoice_number: '1042' })] } }).outcome).toBe('PAGAR');
  });
  it('an unknown payee is matched by name: the same Pixel Lab invoice twice -> FRENAR', () => {
    const d = run({ payee_name: 'Pixel Lab' }, { period: { previous: [prev({ beneficiary_id: null, payee_name: 'PIXEL LAB', invoice_number: '1042' })] } });
    expect(d.outcome).toBe('FRENAR');
  });
  it('missing duplicate window -> exact duplicate not verifiable', () => {
    expect(check(run({}, { rules: { ...RULES, duplicate_window_days: null } }), 'duplicado_exacto').verdict).toBe('no_verificado');
  });
  it('same concept, same month, different number -> ESCALAR posible duplicado (case and punctuation ignored)', () => {
    const d = run({ concept: 'RETAINER mensual, de desarrollo.' }, { period: { previous: [prev({})] } });
    expect([d.outcome, failing(d)]).toEqual(['ESCALAR', ['duplicado_probable']]);
    expect(check(d, 'duplicado_probable').values.duplicate_of).toBe('inv-prev');
  });
  it('a monthly retainer is never flagged against the previous month', () => {
    expect(run({}, { period: { previous: [prev({ received_at: '2026-09-20T15:00:00Z' })] } }).outcome).toBe('PAGAR');
  });
});

describe('agreement, due date, period (AC-21)', () => {
  const ana = { payee_name: 'Ana Souza', currency: 'BRL', bank_account: 'Pix chave 11 98765-4302', concept: 'Diseño' };
  it('retainer within tolerance passes, one cent beyond fails', () => {
    expect(check(run({ ...ana, amount: 10100 }), 'acuerdo').verdict).toBe('cumple'); // 1.818 = 1.800 + 1 %
    expect(check(run({ ...ana, amount: 10101 }), 'acuerdo').verdict).toBe('no_cumple');
  });
  const diego = { payee_name: 'Diego Ruiz', currency: 'MXN', amount: 9000, bank_account: 'BBVA México CLABE 012180001534779908', concept: 'API' };
  const diegoPrev = (amount_usd: number, p: Partial<PeriodState['previous'][number]> = {}) =>
    prev({ beneficiary_id: 'id-Diego Ruiz', payee_name: 'Diego Ruiz', invoice_number: 'DR-1', concept: 'Otro', amount_usd, ...p });
  it('hourly: the month total up to the cap passes, above it fails', () => {
    const at = run(diego, { period: { previous: [diegoPrev(2514)] } }); // 2.514 + 486 = 3.000
    expect([at.outcome, check(at, 'acuerdo').values.month_total_usd]).toEqual(['PAGAR', 3000]);
    expect(check(run(diego, { period: { previous: [diegoPrev(2514.01)] } }), 'acuerdo').verdict).toBe('no_cumple');
  });
  it('hourly: last month and FRENAR invoices do not count toward the cap', () => {
    const d = run(diego, { period: { previous: [diegoPrev(2600, { received_at: '2026-09-20T15:00:00Z' }), diegoPrev(2600, { invoice_number: 'DR-2', outcome: 'FRENAR' })] } });
    expect(d.outcome).toBe('PAGAR');
  });
  it('one-off always passes the agreement check', () => {
    const d = run({ payee_name: 'Forma Studio', amount: 2000, currency: 'EUR', bank_account: 'IBAN ES91 2100 0418 4502 0005 1332' });
    expect([d.outcome, check(d, 'acuerdo').verdict]).toEqual(['PAGAR', 'cumple']);
  });
  it('an expired agreement does not match', () => {
    const directory = DIRECTORY.map((b) => (b.name === 'Laura Méndez' ? { ...b, agreement: { type: 'retainer' as const, amount_usd: 2500, valid_until: '2026-10-16' } } : b));
    expect(check(run({}, { directory }), 'acuerdo').verdict).toBe('no_cumple');
  });
  it('due today passes; due yesterday passes only with one grace day', () => {
    expect(run({ due_date: '2026-10-17' }).outcome).toBe('PAGAR');
    expect(run({ due_date: '2026-10-16' }, { rules: { ...RULES, due_grace_days: 1 } }).outcome).toBe('PAGAR');
  });
  it('due date unknown -> not verifiable', () => {
    expect(check(run({ due_date: null }), 'vencimiento').verdict).toBe('no_verificado');
  });
  it('the period is the calendar month in America/Bogota', () => {
    expect(check(run({}, { received_at: '2026-10-01T04:59:00Z' }), 'periodo').verdict).toBe('no_cumple'); // 30 Sep 23:59 Bogotá
    expect(check(run({}, { received_at: '2026-10-01T05:00:00Z' }), 'periodo').verdict).toBe('cumple');
  });
});

describe('conversion (AC-22, D6)', () => {
  it('converts with the policy rate and records the arithmetic', () => {
    const d = run({ payee_name: 'Contadores Andinos S.A.S.', amount: 3673500, currency: 'COP', bank_account: 'Davivienda corriente 4569-8812-0034', concept: 'Contabilidad' });
    expect([d.outcome, d.amount_usd]).toEqual(['PAGAR', 900.01]);
    expect(check(d, 'moneda').values).toEqual({ amount: 3673500, currency: 'COP', rate: 0.000245, amount_usd: 900.01 });
    expect(d.payment).toEqual({ beneficiary: 'Contadores Andinos SAS', route: 'COP', currency: 'COP', amount: 3673500 });
  });
  it('COP whose USD equivalent exceeds the per-payment limit -> FRENAR (R-07)', () => {
    const d = run({ payee_name: 'Contadores Andinos S.A.S.', amount: 25000000, currency: 'COP', bank_account: 'Davivienda corriente 4569-8812-0034' });
    expect([d.outcome, d.amount_usd]).toEqual(['FRENAR', 6125]);
  });
});

describe('no check can be bypassed (AC-16)', () => {
  const allPass = (): Check[] => CHECK_IDS.map((id) => ({ id, verdict: 'cumple', actual: '', threshold: '', values: {} }));
  it.each(CHECK_IDS.flatMap((id) => [[id, 'no_cumple'], [id, 'no_verificado']] as const))('%s %s -> not PAGAR', (id, verdict) => {
    const checks = allPass().map((c) => (c.id === id ? { ...c, verdict } : c));
    const expected = verdict === 'no_cumple' && (id === 'duplicado_exacto' || id === 'limite_pago') ? 'FRENAR' : 'ESCALAR';
    expect(outcomeOf(checks)).toBe(expected);
  });
  it('fewer than 13 checks is never PAGAR', () => expect(outcomeOf(allPass().slice(1))).toBe('ESCALAR'));
});

describe('human approval (AC-34, R-02, R-21, R-22)', () => {
  const nube = { payee_name: 'Nube Sur LLC', amount: 4200, bank_account: 'ACH routing 026009593 cuenta 483920175', concept: 'Suscripción' };
  const approve = (ids: CheckId[], p: Partial<InvoiceFields>, period: Partial<PeriodState> = {}) => {
    const i = inv(p);
    return decideWithOverrides(ids, BY, i, findBeneficiary(i.fields.payee_name, DIRECTORY), RULES, { ...EMPTY, ...period }, NOW);
  };
  it('overridable set is exactly the 8 checks of AC-34', () => {
    expect([...HUMAN_OVERRIDABLE].sort()).toEqual(['acuerdo', 'beneficiario_cuenta', 'beneficiario_permitido', 'duplicado_probable', 'lectura', 'periodo', 'umbral_aprobacion', 'vencimiento']);
  });
  it('approving the threshold -> PAGAR; the check keeps no_cumple and carries who approved', () => {
    const d = approve(['umbral_aprobacion'], nube);
    expect([d.outcome, check(d, 'umbral_aprobacion')]).toEqual(['PAGAR', expect.objectContaining({ verdict: 'no_cumple', overridden: { by: BY.email, channel: 'dashboard' } })]);
    expect(d.payment).toEqual({ beneficiary: 'Nube Sur LLC', route: 'ACH', currency: 'USD', amount: 4200 });
    expect(d.checks.filter((c) => c.overridden).map((c) => c.id)).toEqual(['umbral_aprobacion']);
  });
  it('approving the threshold after the budget is gone -> ESCALAR presupuesto_periodo', () => {
    const d = approve(['umbral_aprobacion'], nube, { committed_usd: 38241.42 });
    expect([d.outcome, check(d, 'presupuesto_periodo').verdict]).toEqual(['ESCALAR', 'no_cumple']);
  });
  it.each([
    ['presupuesto_periodo', {}, { committed_usd: 38000 }],
    ['saldo_cuenta', {}, { paid_usd: 19000 }],
    ['moneda', { currency: 'GBP' }, {}],
  ] as const)('%s is never overridable -> still ESCALAR', (id, p, period) => {
    const d = approve([id, 'umbral_aprobacion', 'acuerdo'], { ...nube, ...p }, period);
    expect([d.outcome, check(d, id).verdict, 'overridden' in check(d, id)]).toEqual(['ESCALAR', 'no_cumple', false]);
  });
  it.each(['limite_pago', 'duplicado_exacto'] as CheckId[])('%s is never overridable -> still FRENAR', (id) => {
    const d = approve([id, 'umbral_aprobacion', 'acuerdo'], { ...nube, amount: 9800 }, { previous: [prev({ beneficiary_id: 'id-Nube Sur LLC', invoice_number: '1042' })] });
    expect([d.outcome, 'overridden' in check(d, id)]).toEqual(['FRENAR', false]);
  });
  it.each([-2500, 0])('approving lectura on amount %s never pays: limits stay no_verificado -> ESCALAR', (amount) => {
    const d = approve(['lectura', 'acuerdo'], { amount });
    expect([d.outcome, d.payment]).toEqual(['ESCALAR', null]);
    expect(check(d, 'limite_pago').verdict).toBe('no_verificado');
  });
  it('a check that passes is never marked overridden', () => {
    expect(approve(['lectura', 'umbral_aprobacion'], nube).checks.filter((c) => c.overridden).map((c) => c.id)).toEqual(['umbral_aprobacion']);
  });
  it('approving a new beneficiary pays the payee as read, with no directory route', () => {
    const d = approve(['beneficiario_permitido', 'beneficiario_cuenta', 'acuerdo'], { payee_name: 'Pixel Lab', amount: 2400 });
    expect([d.outcome, d.payment]).toEqual(['PAGAR', { beneficiary: 'Pixel Lab', route: null, currency: 'USD', amount: 2400 }]);
  });
});

// ---- Seed replay (AC-10, R-09, R-35, R-36) ----------------------------------------------------------
interface SeedRow { nn: string; expected_outcome: Outcome; check: CheckId | null; also: CheckId[]; prev_month?: boolean; issue: number | null; due: number | null; source: Invoice['source']; fields: Omit<InvoiceFields, 'issue_date' | 'due_date' | 'confidence'> }
interface Done { inv: Invoice; row: SeedRow; beneficiary: Beneficiary | null; outcome: Outcome; amount_usd: number | null }

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

// The seed SQL's date rule, in TypeScript: NN arrives at start(M) + (now - start(M)) × NN/30; prev_month at start(M) - 5 days.
function seedInvoices(now: string): Array<{ inv: Invoice; row: SeedRow }> {
  const start = Date.parse(`${bogotaDay(now).slice(0, 7)}-01T00:00:00-05:00`);
  return (SEED.invoices as SeedRow[]).map((row) => {
    const at = row.prev_month ? start - 5 * 864e5 : start + ((Date.parse(now) - start) * Number(row.nn)) / 30;
    const received_at = new Date(at).toISOString();
    const day = bogotaDay(received_at);
    const f = { ...row.fields, issue_date: row.issue === null ? null : addDays(day, row.issue), due_date: row.due === null ? null : addDays(day, row.due), confidence: {} };
    return { row, inv: { id: `seed-${row.nn}`, received_at, source: row.source, fields: f } };
  }).sort((a, b) => a.inv.received_at.localeCompare(b.inv.received_at) || a.row.nn.localeCompare(b.row.nn));
}

// What the agent reads before deciding `inv`: its month's figures by latest decision, excluding itself (D5).
function stateFor(inv: Invoice, done: Done[]): PeriodState {
  const others = done.filter((x) => x.inv.id !== inv.id);
  const month = others.filter((x) => bogotaDay(x.inv.received_at).slice(0, 7) === bogotaDay(inv.received_at).slice(0, 7));
  const sum = (o: Outcome[]) => round2(month.filter((x) => o.includes(x.outcome)).reduce((s, x) => s + (x.amount_usd ?? 0), 0));
  return {
    committed_usd: sum(['PAGAR', 'ESCALAR']), paid_usd: sum(['PAGAR']),
    previous: others.map((x) => ({ invoice_id: x.inv.id, invoice_number: x.inv.fields.invoice_number, beneficiary_id: x.beneficiary?.id ?? null, payee_name: x.inv.fields.payee_name, amount_usd: x.amount_usd, concept: x.inv.fields.concept, received_at: x.inv.received_at, outcome: x.outcome })),
  };
}

function replay(now: string): Array<Done & { d: Decision }> {
  const done: Array<Done & { d: Decision }> = [];
  for (const { inv, row } of seedInvoices(now)) {
    const beneficiary = findBeneficiary(inv.fields.payee_name, DIRECTORY);
    const d = decide(inv, beneficiary, RULES, stateFor(inv, done), now);
    done.push({ inv, row, beneficiary, d, outcome: d.outcome, amount_usd: d.amount_usd });
  }
  return done;
}

// Any date: mid-month, one minute into a month, the last minute of a 31-day month. The engine takes no env and
// no AI binding at all: seeded fields are pre-extracted, so Workers AI being down cannot change an outcome.
describe.each(['2026-10-17T15:00:00Z', '2026-11-01T05:01:00Z', '2027-04-01T04:59:00Z'])('seed replay at %s', (now) => {
  const done = replay(now);
  it.each(done.map((x) => [x.row.nn, x.row.expected_outcome, [x.row.check, ...x.row.also].filter(Boolean).join(', ') || 'all cumple', x] as const))(
    '#%s -> %s (%s)', (_nn, expected, _c, x) => {
      expect(x.d.outcome).toBe(expected);
      expect(failing(x.d)).toEqual([x.row.check, ...x.row.also].filter((c) => c !== null).sort());
    });
  it('ends the month at committed 42.441,42 and paid 18.502,21 (DATASET.md)', () => {
    const s = stateFor({ ...done[0]!.inv, id: 'none', received_at: now }, done);
    expect([s.committed_usd, s.paid_usd]).toEqual([42441.42, 18502.21]);
  });

  // R-35: approving Nube Sur #2044 re-runs everything with fresh state; only the threshold is overridden (R-02).
  const nube = done.find((x) => x.row.nn === '11')!;
  const approveNube = (state: Done[]) => {
    const failed = nube.d.checks.filter((c) => c.verdict !== 'cumple').map((c) => c.id);
    const ids = failed.filter((id) => HUMAN_OVERRIDABLE.includes(id));
    expect(ids).toEqual(['umbral_aprobacion']);
    return decideWithOverrides(ids, BY, nube.inv, nube.beneficiary, RULES, stateFor(nube.inv, state), now);
  };
  it('R-35: approving Nube Sur without rejecting #15 re-escalates on presupuesto_periodo', () => {
    const d = approveNube(done);
    expect([d.outcome, failing(d)]).toEqual(['ESCALAR', ['presupuesto_periodo', 'umbral_aprobacion']]);
    expect(check(d, 'presupuesto_periodo').values.total_usd).toBe(42441.42);
  });
  it('R-35: rejecting #15 (releases 2.500) then approving Nube Sur -> PAGAR', () => {
    const afterReject = done.map((x) => (x.row.nn === '15' ? { ...x, outcome: 'FRENAR' as const } : x));
    const d = approveNube(afterReject);
    expect(d.outcome).toBe('PAGAR');
    expect([check(d, 'presupuesto_periodo').values.total_usd, check(d, 'saldo_cuenta').values.total_usd]).toEqual([39941.42, 22702.21]);
    expect(check(d, 'umbral_aprobacion')).toMatchObject({ verdict: 'no_cumple', overridden: { by: BY.email, channel: 'dashboard' } });
  });
});
