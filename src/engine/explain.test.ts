/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import sql from '../../supabase/migrations/20261017000300_seed_andina.sql?raw';
import en from '../i18n/en';
import es from '../i18n/es';
import { findBeneficiary } from './checks';
import { decide, decideWithOverrides } from './decide';
import { explainCheck, headline, whatWouldPay } from './explain';
import { CHECK_IDS, type Beneficiary, type Check, type CheckId, type Invoice, type InvoiceFields, type PeriodState, type PolicyRules } from './types';

const SEED = JSON.parse(sql.match(/\$seed\$([\s\S]*?)\$seed\$/)?.[1] ?? 'null');
const RULES: PolicyRules = SEED.rules;
const DIRECTORY: Beneficiary[] = SEED.beneficiaries.map((b: Beneficiary) => ({ ...b, id: `id-${b.name}` }));
const NOW = '2026-10-17T15:00:00Z';
const EMPTY: PeriodState = { committed_usd: 0, paid_usd: 0, previous: [] };
const LAURA: InvoiceFields = {
  payee_name: 'Laura Méndez', amount: 2500, currency: 'USD', invoice_number: '1042', issue_date: '2026-10-10',
  due_date: '2026-11-24', concept: 'Retainer mensual de desarrollo', bank_account: 'Bancolombia ahorros 0012-3456-4821', confidence: {},
};
const NUBE: InvoiceFields = { ...LAURA, payee_name: 'Nube Sur LLC', amount: 4200, invoice_number: '2044',
  concept: 'Suscripción mensual plataforma de datos', bank_account: 'ACH routing 026009593 cuenta 483920175' };
const inv = (f: Partial<InvoiceFields>): Invoice => ({ id: 'i', received_at: '2026-10-10T15:00:00Z', source: 'pdf', fields: { ...LAURA, ...f } });
const run = (f: Partial<InvoiceFields>, rules: PolicyRules | null = RULES, period = EMPTY) => {
  const i = inv(f), b = findBeneficiary(i.fields.payee_name, DIRECTORY);
  return { i, b, d: decide(i, b, rules, period, NOW) };
};
const get = (checks: Check[], id: CheckId) => checks.find((c) => c.id === id) as Check;
const RECEIVED = '2026-10-10T15:00:00Z';

describe('explainCheck (AC-27, AC-28, AC-22, R-22)', () => {
  const { d } = run({});
  it('per-payment limit, es and en', () => {
    expect(explainCheck(get(d.checks, 'limite_pago'), 'es', RECEIVED)).toBe('Límite por pago: 2.500 USD ≤ 5.000 USD → cumple');
    expect(explainCheck(get(d.checks, 'limite_pago'), 'en', RECEIVED)).toBe('Per-payment limit: 2,500 USD ≤ 5,000 USD → passes');
  });
  it('budget names the arrival month (R-45), es and en', () => {
    const c: Check = { id: 'presupuesto_periodo', verdict: 'no_cumple', actual: '51000', threshold: '50000',
      values: { committed_usd: 42000, amount_usd: 9000, total_usd: 51000, budget_usd: 50000 } };
    expect(explainCheck(c, 'es', RECEIVED)).toBe('Presupuesto de octubre: 42.000 usados + 9.000 = 51.000 > 50.000 USD → no cumple');
    expect(explainCheck(c, 'en', RECEIVED)).toBe('October budget: 42,000 used + 9,000 = 51,000 > 50,000 USD → does not pass');
  });
  it('currency conversion names the stored decision\'s policy version (R-49), es and en', () => {
    const c: Check = { id: 'moneda', verdict: 'cumple', actual: 'COP', threshold: '0.000245',
      values: { amount: 1500000, currency: 'COP', rate: 0.000245, amount_usd: 367.5 } };
    expect(explainCheck(c, 'es', RECEIVED, 1)).toBe('Moneda: 1.500.000 COP × 0,000245 = 367,50 USD (tasa de la política v1) → cumple');
    expect(explainCheck(c, 'en', RECEIVED, 1)).toBe('Currency: 1,500,000 COP × 0.000245 = 367.50 USD (policy rate v1) → passes');
    expect(explainCheck(c, 'es', RECEIVED, 3)).toContain('(tasa de la política v3)');
  });
  it('currency conversion without a stored policy version leaves the "v" out', () => {
    const c: Check = { id: 'moneda', verdict: 'cumple', actual: 'COP', threshold: '0.000245',
      values: { amount: 1500000, currency: 'COP', rate: 0.000245, amount_usd: 367.5 } };
    for (const v of [undefined, null]) {
      expect(explainCheck(c, 'es', RECEIVED, v)).toBe('Moneda: 1.500.000 COP × 0,000245 = 367,50 USD (tasa de la política) → cumple');
      expect(explainCheck(c, 'en', RECEIVED, v)).toBe('Currency: 1,500,000 COP × 0.000245 = 367.50 USD (policy rate) → passes');
    }
  });
  it('changed account, es and en', () => {
    const c = get(run({ bank_account: 'Nequi 300-555-7310' }).d.checks, 'beneficiario_cuenta');
    expect(explainCheck(c, 'es', RECEIVED)).toBe('Cuenta bancaria: la factura termina en 7310 y la registrada en 4821 → no cumple');
    expect(explainCheck(c, 'en', RECEIVED)).toBe('Bank account: the invoice\'s account ends in 7310 and the one on file in 4821 → does not pass');
  });
  it('an overridden check reads "no cumple · aprobado por <correo> <canal>", never plain cumple (R-22)', () => {
    const i = inv(NUBE), b = findBeneficiary('Nube Sur LLC', DIRECTORY);
    const a = decideWithOverrides(['umbral_aprobacion'], { email: 'roberto@hacketix.com', channel: 'dashboard' }, i, b, RULES, EMPTY, NOW);
    expect(explainCheck(get(a.checks, 'umbral_aprobacion'), 'es', RECEIVED))
      .toBe('Umbral de aprobación: 4.200 USD > 2.500 USD → no cumple · aprobado por roberto@hacketix.com en el tablero');
    expect(explainCheck({ ...get(a.checks, 'umbral_aprobacion'), overridden: { by: 'ana@x.co', channel: 'link' } }, 'en', RECEIVED))
      .toBe('Approval threshold: 4,200 USD > 2,500 USD → does not pass · approved by ana@x.co via link');
  });
  it('no sentence leaves a placeholder or a raw key, for every check of real decisions (null policy, traps)', () => {
    const decisions = [run({}).d, run({}, null).d, run({ payee_name: null, amount: null, currency: null, invoice_number: null }).d,
      run({ payee_name: 'Pixel Lab', amount: 1500000, currency: 'COP', due_date: '2026-01-01' }).d];
    for (const x of decisions) for (const c of x.checks) for (const lang of ['es', 'en'] as const) {
      expect(explainCheck(c, lang, RECEIVED)).not.toMatch(/[{}]|check\.|undefined|NaN/);
    }
  });
  it('a missing value reads "desconocido", not a blank', () => {
    const c: Check = { id: 'limite_pago', verdict: 'no_verificado', actual: '', threshold: '', values: {} };
    expect(explainCheck(c, 'es', RECEIVED)).toBe('Límite por pago: falta el monto en USD o el límite por pago en la política → no se pudo verificar');
    const u: Check = { id: 'umbral_aprobacion', verdict: 'cumple', actual: '', threshold: '', values: {} };
    expect(explainCheck(u, 'es', RECEIVED)).toBe('Umbral de aprobación: desconocido USD ≤ desconocido USD → cumple');
  });
});

describe('every CheckId x Verdict has a template key in both dictionaries (AC-27)', () => {
  for (const dict of [es, en]) for (const id of CHECK_IDS) {
    it(`${dict === es ? 'es' : 'en'} ${id}`, () => {
      expect(dict[`check.${id}.name`]).toBeTruthy();
      for (const v of ['cumple', 'no_cumple', 'no_verificado']) expect(dict[`check.${id}.${v}`]).toBeTruthy();
      for (const v of ['no_cumple', 'no_verificado']) {
        expect(dict[`motive.${id}.${v}`]).toBeTruthy();
        expect(dict[`fix.${id}.${v}`]).toBeTruthy();
      }
    });
  }
  it('every Spanish "qué tendría que pasar" line starts with "Que " so Task 6 can drop it (R-27)', () => {
    for (const [k, s] of Object.entries(es)) if (k.startsWith('fix.')) expect(s.startsWith('Que '), k).toBe(true);
  });
});

describe('headline (AC-27, AC-13)', () => {
  it('PAGAR within the rules, es and en', () => {
    const { d, i, b } = run({});
    expect(headline(d, i, b, 'es')).toBe('PAGAR · 2.500 USD a Laura Méndez, retainer de octubre, dentro de reglas');
    expect(headline(d, i, b, 'en')).toBe('PAY · 2,500 USD to Laura Méndez, October retainer, within the rules');
  });
  it('ESCALAR over the approval threshold, es and en', () => {
    const { d, i, b } = run(NUBE);
    expect(headline(d, i, b, 'es')).toBe('ESCALAR · 4.200 USD a Nube Sur LLC: supera el umbral de aprobación de 2.500 USD');
    expect(headline(d, i, b, 'en')).toBe('ESCALATE · 4,200 USD to Nube Sur LLC: exceeds the approval threshold of 2,500 USD');
  });
  it('FRENAR names its trigger first, then how many more reasons', () => {
    const { d, i, b } = run({ amount: 9800, bank_account: 'Nequi 1' });
    expect(headline(d, i, b, 'es')).toBe('FRENAR · 9.800 USD a Laura Méndez: supera el límite por pago de 5.000 USD y 3 motivos más');
  });
  it('PAGAR after a person approved does not say "dentro de reglas" (R-22)', () => {
    const i = inv(NUBE), b = findBeneficiary('Nube Sur LLC', DIRECTORY);
    const a = decideWithOverrides(['umbral_aprobacion'], { email: 'roberto@hacketix.com', channel: 'link' }, i, b, RULES, EMPTY, NOW);
    expect(headline(a, i, b, 'es')).toBe('PAGAR · 4.200 USD a Nube Sur LLC, suscripción de octubre, aprobado por roberto@hacketix.com');
  });
  it('an unreadable invoice says "ilegible" (AC-13)', () => {
    const { d, i, b } = run({ payee_name: null, amount: null, currency: null, invoice_number: null });
    expect(headline(d, i, b, 'es')).toMatch(/^ESCALAR · monto desconocido a beneficiario desconocido: ilegible/);
  });
});

describe('whatWouldPay (AC-26, AC-27)', () => {
  it('one line per non-passing check, ESCALAR with two failing checks, es and en', () => {
    const { d } = run({ amount: 3100 });
    expect(whatWouldPay(d, 'es')).toEqual(['Que una persona apruebe el monto distinto al acordado', 'Que una persona apruebe el monto sobre el umbral']);
    expect(whatWouldPay(d, 'en')).toEqual(['A person approves the amount that differs from the agreement', 'A person approves the amount above the threshold']);
  });
  it('budget names the policy change; overridden checks are not listed', () => {
    const i = inv(NUBE), b = findBeneficiary('Nube Sur LLC', DIRECTORY);
    const a = decideWithOverrides(['umbral_aprobacion'], { email: 'r@x.co', channel: 'link' }, i, b, RULES,
      { ...EMPTY, committed_usd: 40000 }, NOW);
    expect(whatWouldPay(a, 'es')).toEqual(['Que se suba el presupuesto del periodo en la política']);
  });
  it('an unread amount does not ask to define rules the policy already has', () => {
    const lines = whatWouldPay(run({ amount: null }).d, 'es');
    expect(lines).toContain('Que se conozca el monto en USD y la política tenga límite por pago');
    expect(lines.join(' ')).not.toMatch(/Que se defina|no tiene umbral/);
  });
  it('PAGAR has nothing to add', () => expect(whatWouldPay(run({}).d, 'es')).toEqual([]));
});
