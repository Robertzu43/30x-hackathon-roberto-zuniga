/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { FULL_CONFIDENCE } from './__fixtures__/seed';
import sql from '../../supabase/migrations/20261017000300_seed_andina.sql?raw';
import en from '../i18n/en';
import es from '../i18n/es';
import { findBeneficiary } from './checks';
import { decide, decideWithOverrides } from './decide';
import { explainCheck, headline, whatWouldPay } from './explain';
import { CHECK_IDS, type Beneficiary, type Check, type CheckId, type Invoice, type InvoiceFields, type MarketRates, type PeriodState, type PolicyRules } from './types';

const SEED = JSON.parse(sql.match(/\$seed\$([\s\S]*?)\$seed\$/)?.[1] ?? 'null');
const RULES: PolicyRules = SEED.rules;
const DIRECTORY: Beneficiary[] = SEED.beneficiaries.map((b: Beneficiary) => ({ ...b, id: `id-${b.name}` }));
const NOW = '2026-10-17T15:00:00Z';
const EMPTY: PeriodState = { committed_usd: 0, paid_usd: 0, previous: [] };
const LAURA: InvoiceFields = {
  payee_name: 'Laura Méndez', amount: 2500, currency: 'USD', invoice_number: '1042', issue_date: '2026-10-10',
  due_date: '2026-11-24', concept: 'Retainer mensual de desarrollo', bank_account: 'Bancolombia ahorros 0012-3456-4821', confidence: FULL_CONFIDENCE,
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
  it('#15 and the Pixel Lab line vs Laura: different endings are named (R-73)', () => {
    const c = get(run({ bank_account: 'Banco de Bogotá ahorros 112-45009-8' }).d.checks, 'beneficiario_cuenta');
    expect(explainCheck(c, 'es', RECEIVED)).toBe('Cuenta bancaria: la factura termina en 0098 y la registrada en 4821 → no cumple');
  });
  it('a changed account with the same last 4 names both accounts as read, never "1332 y 1332", es and en (R-73)', () => {
    const { d, i, b } = run({ bank_account: 'Bancolombia ahorros 3456-4821' });
    const c = get(d.checks, 'beneficiario_cuenta');
    expect(explainCheck(c, 'es', RECEIVED)).toBe('Cuenta bancaria: la cuenta de la factura («Bancolombia ahorros 3456-4821») no coincide con la registrada («Bancolombia ahorros 0012-3456-4821») → no cumple');
    expect(explainCheck(c, 'en', RECEIVED)).toBe('Bank account: the invoice\'s account ("Bancolombia ahorros 3456-4821") does not match the one on file ("Bancolombia ahorros 0012-3456-4821") → does not pass');
    expect(headline(d, i, b, 'es')).toBe('ESCALAR · 2.500 USD a Laura Méndez: cuenta cambiada (la de la factura es «Bancolombia ahorros 3456-4821» y la registrada «Bancolombia ahorros 0012-3456-4821»)');
    expect(headline(d, i, b, 'en')).toBe('ESCALATE · 2,500 USD to Laura Méndez: changed account (the invoice\'s is "Bancolombia ahorros 3456-4821" and the one on file "Bancolombia ahorros 0012-3456-4821")');
  });
  it('an overridden check reads "no cumple · aprobado por <correo> <canal>", never plain cumple (R-22)', () => {
    const i = inv(NUBE), b = findBeneficiary('Nube Sur LLC', DIRECTORY);
    const a = decideWithOverrides(['umbral_aprobacion'], { email: 'roberto@hacketix.com', channel: 'dashboard' }, i, b, RULES, EMPTY, NOW);
    expect(explainCheck(get(a.checks, 'umbral_aprobacion'), 'es', RECEIVED))
      .toBe('Umbral de aprobación: 4.200 USD > 2.500 USD → no cumple · aprobado por roberto@hacketix.com en el tablero');
    expect(explainCheck({ ...get(a.checks, 'umbral_aprobacion'), overridden: { by: 'ana@x.co', channel: 'link' } }, 'en', RECEIVED))
      .toBe('Approval threshold: 4,200 USD > 2,500 USD → does not pass · approved by ana@x.co via link');
  });
  it('a guest\'s override names «Invitado <8 hex>», never the stored invitado:<hex>, es and en (AC-37 Clarified, R-116)', () => {
    const i = inv(NUBE), b = findBeneficiary('Nube Sur LLC', DIRECTORY);
    const a = decideWithOverrides(['umbral_aprobacion'], { email: 'invitado:3f9a1c2b', channel: 'dashboard' }, i, b, RULES, EMPTY, NOW);
    expect(explainCheck(get(a.checks, 'umbral_aprobacion'), 'es', RECEIVED))
      .toBe('Umbral de aprobación: 4.200 USD > 2.500 USD → no cumple · aprobado por Invitado 3f9a1c2b en el tablero');
    expect(explainCheck(get(a.checks, 'umbral_aprobacion'), 'en', RECEIVED))
      .toBe('Approval threshold: 4,200 USD > 2,500 USD → does not pass · approved by Guest 3f9a1c2b on the dashboard');
    expect(a.outcome).toBe('PAGAR');
    expect(headline(a, i, b, 'es')).toMatch(/aprobado por Invitado 3f9a1c2b$/);
    expect(headline(a, i, b, 'en')).toMatch(/approved by Guest 3f9a1c2b$/);
  });
  it('no sentence leaves a placeholder or a raw key, for every check of real decisions (null policy, traps)', () => {
    const decisions = [run({}).d, run({}, null).d, run({ payee_name: null, amount: null, currency: null, invoice_number: null }).d,
      run({ payee_name: 'Pixel Lab', amount: 1500000, currency: 'COP', due_date: '2026-01-01' }).d];
    for (const x of decisions) for (const c of x.checks) for (const lang of ['es', 'en'] as const) {
      expect(explainCheck(c, lang, RECEIVED)).not.toMatch(/[{}]|check\.|undefined|NaN/);
    }
  });
  it('an agreement type with no dictionary entry reads "sin acuerdo registrado" in every verdict, never the raw key (R-52, AC-27)', () => {
    const acuerdo = { ...get(d.checks, 'acuerdo'), values: { ...get(d.checks, 'acuerdo').values, agreement_type: 'weird' } };
    const words = { es: 'sin acuerdo registrado', en: 'no agreement on file' };
    for (const verdict of ['cumple', 'no_cumple', 'no_verificado'] as const) for (const lang of ['es', 'en'] as const) {
      for (const c of [{ ...acuerdo, verdict }, { ...acuerdo, verdict, overridden: { by: 'ana@x.co', channel: 'link' as const } }]) {
        const text = explainCheck(c, lang, RECEIVED);
        expect(text).not.toMatch(/agreement\.|null|undefined/);
        if (verdict !== 'no_verificado') expect(text).toContain(words[lang]);
      }
    }
  });
  it('a missing value reads "desconocido", not a blank', () => {
    const c: Check = { id: 'limite_pago', verdict: 'no_verificado', actual: '', threshold: '', values: {} };
    expect(explainCheck(c, 'es', RECEIVED)).toBe('Límite por pago: falta el monto en USD o el límite por pago en la política → no se pudo verificar');
    const u: Check = { id: 'umbral_aprobacion', verdict: 'cumple', actual: '', threshold: '', values: {} };
    expect(explainCheck(u, 'es', RECEIVED)).toBe('Umbral de aprobación: desconocido USD ≤ desconocido USD → cumple');
  });
});

// AC-74, AC-22 Superseded in part: the rate's source and time are printed from what the Moneda check recorded (R-29).
describe('market and pinned rates in the record (AC-74)', () => {
  const COP_FIELDS = { payee_name: 'Contadores Andinos S.A.S.', amount: 1500000, currency: 'COP', invoice_number: 'CA-5521', bank_account: 'Davivienda corriente 4569-8812-0034', concept: 'Contabilidad' };
  const NO_PINS: PolicyRules = { ...RULES, fx_rates: {} };
  const at = (rules: PolicyRules, market: MarketRates, f: Partial<InvoiceFields> = COP_FIELDS) => {
    const i = inv(f), b = findBeneficiary(i.fields.payee_name, DIRECTORY);
    return { i, b, d: decide(i, b, rules, EMPTY, NOW, market) };
  };
  const yahoo = (usd_per_unit: number, fetched_at: string): MarketRates => ({ COP: { currency: 'COP', usd_per_unit, source: 'Yahoo Finance', fetched_at } });
  const line = (d: { checks: Check[] }, lang: 'es' | 'en', v?: number) => explainCheck(get(d.checks, 'moneda'), lang, RECEIVED, v);
  it('market rate: every stored significant digit, source and Bogotá time, es and en', () => {
    const { d } = at(NO_PINS, yahoo(0.00024876, '2026-10-17T15:00:00Z'));
    expect(line(d, 'es', 2)).toBe('Moneda: 1.500.000 COP × 0,00024876 = 373,14 USD (Yahoo Finance, 17 oct 2026 10:00) → cumple');
    expect(line(d, 'en', 2)).toBe('Currency: 1,500,000 COP × 0.00024876 = 373.14 USD (Yahoo Finance, Oct 17, 2026 10:00) → passes');
    const { d: d8 } = at(NO_PINS, yahoo(0.00031538976, '2026-10-17T13:09:12.345Z'));
    expect(line(d8, 'es')).toBe('Moneda: 1.500.000 COP × 0,00031538976 = 473,08 USD (Yahoo Finance, 17 oct 2026 08:09) → cumple');
  });
  it('pinned rate names the stored decision\'s policy version, es and en', () => {
    const { d } = at({ ...NO_PINS, fx_rates: { COP: 0.00025 } }, yahoo(0.00024876, '2026-10-17T15:00:00Z'));
    expect(line(d, 'es', 2)).toBe('Moneda: 1.500.000 COP × 0,00025 = 375 USD (tasa fijada por la política v2) → cumple');
    expect(line(d, 'en', 2)).toBe('Currency: 1,500,000 COP × 0.00025 = 375 USD (rate pinned by policy v2) → passes');
  });
  it('stale market rate, es and en', () => {
    const { d } = at(NO_PINS, yahoo(0.00024876, '2026-10-14T15:00:00Z'));
    expect(line(d, 'es')).toBe('Moneda: la última tasa de mercado de COP es del 14 oct 2026 10:00, de hace más de 48 horas → no se pudo verificar');
    expect(line(d, 'en')).toBe('Currency: the latest market rate for COP is from Oct 14, 2026 10:00, more than 48 hours old → could not be verified');
  });
  it('no market and no pinned rate, es and en', () => {
    const { d } = at(NO_PINS, {}, { ...COP_FIELDS, currency: 'GBP' });
    expect(line(d, 'es')).toBe('Moneda: no tengo tasa de mercado ni tasa fijada para GBP → no se pudo verificar');
    expect(line(d, 'en')).toBe('Currency: I have no market or pinned rate for GBP → could not be verified');
  });
  it.each([['stale', yahoo(0.00024876, '2026-10-14T15:00:00Z')], ['missing', {}]] as const)('%s: one headline reason and one fix line, es and en', (_, market) => {
    const { d, i, b } = at(NO_PINS, market);
    expect(headline(d, i, b, 'es')).toBe('ESCALAR · 1.500.000 COP a Contadores Andinos SAS: no tengo una tasa de cambio vigente para COP');
    expect(headline(d, i, b, 'en')).toBe('ESCALATE · 1,500,000 COP to Contadores Andinos SAS: I have no current exchange rate for COP');
    expect(whatWouldPay(d, 'es')).toEqual(['Que se actualice la tasa de mercado de COP o que la política fije una tasa']);
    expect(whatWouldPay(d, 'en')).toEqual(['That the market rate for COP is refreshed, or the policy pins a rate']);
  });
  it('another failing check is still named after the rate', () => {
    const { d, i, b } = at(NO_PINS, {}, { ...COP_FIELDS, bank_account: 'Nequi 300-555-7310' });
    expect(headline(d, i, b, 'es')).toBe('ESCALAR · 1.500.000 COP a Contadores Andinos SAS: no tengo una tasa de cambio vigente para COP y 1 motivo más');
  });
  it('a check stored before Task 21 (no rate_source) keeps "(tasa de la política v<n>)" (AC-22, R-29)', () => {
    const c: Check = { id: 'moneda', verdict: 'cumple', actual: 'COP', threshold: '0.000245', values: { amount: 1500000, currency: 'COP', rate: 0.000245, amount_usd: 367.5 } };
    expect(explainCheck(c, 'es', RECEIVED, 1)).toBe('Moneda: 1.500.000 COP × 0,000245 = 367,50 USD (tasa de la política v1) → cumple');
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
  it('an amount the engine cannot trust reads as unknown, never as printed (R-71)', () => {
    const { d, i, b } = run({ amount: 1e15 });
    expect(headline(d, i, b, 'es')).toMatch(/^ESCALAR · monto desconocido a Laura Méndez: /);
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
  it('PAGAR approved for a payee with no agreement reads "sin acuerdo registrado" (R-52, AC-27)', () => {
    const i = inv({ payee_name: 'Pixel Lab', amount: 900, bank_account: 'Banco de Bogotá ahorros 112-45009-8' }), b = findBeneficiary('Pixel Lab', DIRECTORY);
    const a = decideWithOverrides(['beneficiario_permitido', 'beneficiario_cuenta', 'acuerdo'], { email: 'roberto@hacketix.com', channel: 'dashboard' }, i, b, RULES, EMPTY, NOW);
    expect(a.outcome).toBe('PAGAR');
    expect(headline(a, i, b, 'es')).toBe('PAGAR · 900 USD a Pixel Lab, sin acuerdo registrado, aprobado por roberto@hacketix.com');
    expect(headline(a, i, b, 'en')).toBe('PAY · 900 USD to Pixel Lab, no agreement on file, approved by roberto@hacketix.com');
  });
  it('no headline leaks a key, null or undefined, for every outcome, language and agreement type (R-52)', () => {
    const i = inv({}), b = findBeneficiary('Laura Méndez', DIRECTORY);
    const base = run({}).d;
    for (const outcome of ['PAGAR', 'ESCALAR', 'FRENAR'] as const) for (const type of [null, 'weird', 'retainer', 'subscription', 'hourly', 'one_off'])
      for (const lang of ['es', 'en'] as const) for (const by of [undefined, 'ana@x.co']) {
        const checks = base.checks.map((c) => (c.id === 'acuerdo' ? { ...c, values: { ...c.values, agreement_type: type }, verdict: outcome === 'PAGAR' ? c.verdict : 'no_cumple' as const } : c))
          .map((c) => (by && c.id === 'umbral_aprobacion' ? { ...c, overridden: { by, channel: 'link' as const } } : c));
        expect(headline({ outcome, checks }, i, b, lang), `${outcome} ${type} ${lang}`).not.toMatch(/headline\.|null|undefined/);
      }
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

// R-75 (AC-13 Clarified): no answer came from the reader. The record says so, in the exact es/en texts, and never pays.
describe('reader unavailable: lector_no_disponible (AC-13 Clarified, R-75)', () => {
  const UNREAD: InvoiceFields = { payee_name: null, amount: null, currency: null, invoice_number: null, issue_date: null, due_date: null,
    concept: null, bank_account: null, confidence: {}, read_error: 'lector_no_disponible' };
  const i: Invoice = { id: 'u', received_at: RECEIVED, source: 'email', fields: UNREAD };
  const d = decide(i, null, RULES, EMPTY, NOW);
  const lectura = get(d.checks, 'lectura');

  it('decides ESCALAR with Lectura no_verificado and stores the reason in the check', () => {
    expect(d.outcome).toBe('ESCALAR');
    expect(lectura).toMatchObject({ verdict: 'no_verificado', values: { reason: 'lector_no_disponible' } });
  });
  it('the headline, with no "y n motivos más", es and en', () => {
    expect(headline(d, i, null, 'es')).toBe('ESCALAR · factura sin leer: el lector de facturas no estaba disponible; vuelve a ingresarla más tarde');
    expect(headline(d, i, null, 'en')).toBe('ESCALATE · unread invoice: the invoice reader was unavailable; enter it again later');
  });
  it('the Lectura check row, es and en; the other 12 rows keep their own sentences', () => {
    expect(explainCheck(lectura, 'es', RECEIVED)).toBe('Lectura: el lector de facturas no estaba disponible cuando llegó (límite diario del servicio o falla temporal); no se leyó ningún dato → no se pudo verificar');
    expect(explainCheck(lectura, 'en', RECEIVED)).toBe('Reading: the invoice reader was unavailable when it arrived (daily service limit or temporary failure); no data was read → could not be verified');
    expect(explainCheck(get(d.checks, 'limite_pago'), 'es', RECEIVED)).not.toMatch(/lector/);
  });
  it('the «qué tendría que pasar» Lectura line, es and en', () => {
    expect(whatWouldPay(d, 'es')[0]).toBe('Que vuelvas a ingresar la factura cuando el lector esté disponible y rechaces esta copia sin leer');
    expect(whatWouldPay(d, 'en')[0]).toBe('That you enter the invoice again once the reader is available, and reject this unread copy');
  });
  it('an approval overrides Lectura but re-escalates: the USD checks are not overridable, never PAGAR; the headline keeps the reason', () => {
    const failing = d.checks.filter((c) => c.verdict !== 'cumple').map((c) => c.id);
    const a = decideWithOverrides(failing, { email: 'r@x.co', channel: 'dashboard' }, i, null, RULES, EMPTY, NOW);
    expect(a.outcome).toBe('ESCALAR');
    expect(get(a.checks, 'lectura').values.reason).toBe('lector_no_disponible');
    expect(headline(a, i, null, 'es')).toBe('ESCALAR · factura sin leer: el lector de facturas no estaba disponible; vuelve a ingresarla más tarde');
  });
  it('an illegible invoice (the model answered) keeps the "ilegible" texts and no reason', () => {
    const r = run({ payee_name: null, amount: null, currency: null, invoice_number: null, bank_account: null, concept: 'ilegible' });
    expect(get(r.d.checks, 'lectura').values.reason).toBeUndefined();
    expect(headline(r.d, r.i, r.b, 'es')).toMatch(/^ESCALAR · monto desconocido a beneficiario desconocido: ilegible y \d+ motivos más$/);
  });
});

// R-80 (AC-14 Clarified): the amount guard stopped the amount. ESCALAR, never FRENAR, never PAGAR, in the exact es/en texts.
describe('amount guard: nota_credito and total_no_cuadra (AC-14 Clarified, R-80)', () => {
  const guarded = (read_error: InvoiceFields['read_error'], read_detail: InvoiceFields['read_detail'], f: Partial<InvoiceFields> = {}): Invoice =>
    ({ id: 'g', received_at: RECEIVED, source: 'email', fields: { ...LAURA, amount: null, read_error, read_detail, ...f } });
  const CUADRA = guarded('total_no_cuadra', { subtotal: 100, tax: 19, sum: 119, totals: '150', amount_read: 150 });
  const LEI = guarded('total_no_cuadra', { subtotal: null, tax: null, sum: null, totals: '2500; 300', amount_read: 250 });
  const NOTA = guarded('nota_credito', { signal: 'Total: (USD 500,00)' });
  const at = (i: Invoice) => decide(i, findBeneficiary(i.fields.payee_name, DIRECTORY), RULES, EMPTY, NOW);

  it.each([CUADRA, LEI, NOTA])('ESCALAR with Lectura no_verificado carrying the reason and values; the USD checks unknown', (i) => {
    const d = at(i);
    expect(d.outcome).toBe('ESCALAR');
    expect(get(d.checks, 'lectura')).toMatchObject({ verdict: 'no_verificado', values: { reason: i.fields.read_error, ...i.fields.read_detail } });
    for (const id of ['limite_pago', 'presupuesto_periodo', 'saldo_cuenta', 'umbral_aprobacion'] as const) expect(get(d.checks, id).verdict).toBe('no_verificado');
    expect(d.checks).toHaveLength(13);
  });
  it('a read_error with an amount still in the fields (an untrusted insert): the amount is unknown to every check', () => {
    const d = at(guarded('nota_credito', { signal: 'no cobrar' }, { amount: 500 }));
    expect([get(d.checks, 'lectura').verdict, get(d.checks, 'limite_pago').verdict, d.amount_usd]).toEqual(['no_verificado', 'no_verificado', null]);
  });
  it('headlines, es and en, with no "y n motivos más"', () => {
    expect(headline(at(NOTA), NOTA, null, 'es')).toBe('ESCALAR · la factura de Laura Méndez parece una nota crédito: dice «Total: (USD 500,00)»; no es un cobro y no la pago');
    expect(headline(at(NOTA), NOTA, null, 'en')).toBe('ESCALATE · the document from Laura Méndez looks like a credit note: it says "Total: (USD 500,00)"; it is not a charge and I will not pay it');
    expect(headline(at(CUADRA), CUADRA, null, 'es')).toBe('ESCALAR · el total de la factura de Laura Méndez no cuadra: 100,00 + 19,00 = 119,00, pero el total dice 150,00');
    expect(headline(at(CUADRA), CUADRA, null, 'en')).toBe('ESCALATE · the total on the invoice from Laura Méndez does not add up: 100.00 + 19.00 = 119.00, but the total says 150.00');
    expect(headline(at(LEI), LEI, null, 'es')).toBe('ESCALAR · el total de la factura de Laura Méndez no cuadra: leí 250,00, pero el total impreso es 2.500,00, 300,00');
    expect(headline(at(LEI), LEI, null, 'en')).toBe('ESCALATE · the total on the invoice from Laura Méndez does not add up: I read 250.00, but the printed total is 2,500.00, 300.00');
  });
  it('an unread payee is «un beneficiario que no pude leer» / "a payee I could not read"', () => {
    const i = guarded('nota_credito', { signal: 'no cobrar' }, { payee_name: null });
    expect(headline(at(i), i, null, 'es')).toBe('ESCALAR · la factura de un beneficiario que no pude leer parece una nota crédito: dice «no cobrar»; no es un cobro y no la pago');
    expect(headline(at(i), i, null, 'en')).toMatch(/^ESCALATE · the document from a payee I could not read looks like/);
  });
  it('the Lectura rows, es and en', () => {
    const row = (i: Invoice, lang: 'es' | 'en') => explainCheck(get(at(i).checks, 'lectura'), lang, RECEIVED);
    expect(row(NOTA, 'es')).toBe('Lectura: el documento dice «Total: (USD 500,00)»; no tomo su monto como un cobro → no se pudo verificar');
    expect(row(NOTA, 'en')).toBe('Reading: the document says "Total: (USD 500,00)"; I do not take its amount as a charge → could not be verified');
    expect(row(CUADRA, 'es')).toBe('Lectura: subtotal 100,00 + impuestos 19,00 = 119,00, total impreso 150,00 → no cuadra, no se pudo verificar');
    expect(row(CUADRA, 'en')).toBe('Reading: subtotal 100.00 + taxes 19.00 = 119.00, printed total 150.00 → does not add up, could not be verified');
    expect(row(LEI, 'es')).toBe('Lectura: leí el monto 250,00, pero el total impreso es 2.500,00, 300,00 → no se pudo verificar');
    expect(row(LEI, 'en')).toBe('Reading: I read the amount 250.00, but the printed total is 2,500.00, 300.00 → could not be verified');
  });
  it('the «qué tendría que pasar» Lectura line, es and en', () => {
    expect(whatWouldPay(at(NOTA), 'es')[0]).toBe('Que no se pague: una nota crédito se descuenta de una factura, no se paga. Recházala; si de verdad es un cobro, que el proveedor envíe una factura sin esa señal');
    expect(whatWouldPay(at(NOTA), 'en')[0]).toBe('That it is not paid: a credit note is deducted from an invoice, not paid. Reject it; if it really is a charge, the vendor sends an invoice without that signal');
    expect(whatWouldPay(at(CUADRA), 'es')[0]).toBe('Que el proveedor envíe la factura con un total que cuadre; rechaza esta');
    expect(whatWouldPay(at(LEI), 'en')[0]).toBe('That the vendor sends the invoice with a total that adds up; reject this one');
  });
  it('an approval overrides Lectura but re-escalates, keeping the reason and the headline; never PAGAR', () => {
    for (const i of [CUADRA, LEI, NOTA]) {
      const d = at(i);
      const a = decideWithOverrides(d.checks.filter((c) => c.verdict !== 'cumple').map((c) => c.id), { email: 'r@x.co', channel: 'dashboard' },
        i, findBeneficiary(i.fields.payee_name, DIRECTORY), RULES, EMPTY, NOW);
      expect(a.outcome).toBe('ESCALAR');
      expect(get(a.checks, 'lectura').values.reason).toBe(i.fields.read_error);
      expect(headline(a, i, null, 'es')).toBe(headline(d, i, null, 'es'));
    }
    const a = decideWithOverrides(['lectura'], { email: 'r@x.co', channel: 'dashboard' }, CUADRA, null, RULES, EMPTY, NOW);
    expect(explainCheck(get(a.checks, 'lectura'), 'es', RECEIVED)).toBe('Lectura: subtotal 100,00 + impuestos 19,00 = 119,00, total impreso 150,00 → no cuadra, no se pudo verificar · aprobado por r@x.co en el tablero');
  });
});
