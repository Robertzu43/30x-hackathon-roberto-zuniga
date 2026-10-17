/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { FULL_CONFIDENCE } from '../engine/__fixtures__/seed';
import sql from '../../supabase/migrations/20261017000300_seed_andina.sql?raw';
import { findBeneficiary } from '../engine/checks';
import { decide, decideWithOverrides } from '../engine/decide';
import { CHECK_IDS, type Beneficiary, type Decision, type Invoice, type InvoiceFields, type PeriodState, type PolicyRules } from '../engine/types';
import en from '../i18n/en';
import es from '../i18n/es';
import { escalationQuestion } from './question';

const SEED = JSON.parse(sql.match(/\$seed\$([\s\S]*?)\$seed\$/)?.[1] ?? 'null');
const RULES: PolicyRules = SEED.rules;
const DIRECTORY: Beneficiary[] = SEED.beneficiaries.map((b: Beneficiary) => ({ ...b, id: `id-${b.name}` }));
const NOW = '2026-10-17T15:00:00Z';
const EMPTY: PeriodState = { committed_usd: 0, paid_usd: 0, previous: [] };
const NUBE: InvoiceFields = {
  payee_name: 'Nube Sur LLC', amount: 4200, currency: 'USD', invoice_number: '2044', issue_date: '2026-10-10', due_date: '2026-11-24',
  concept: 'Suscripción mensual plataforma de datos', bank_account: 'ACH routing 026009593 cuenta 483920175', confidence: FULL_CONFIDENCE,
};
const inv = (f: Partial<InvoiceFields> = {}): Invoice => ({ id: 'i', received_at: '2026-10-10T15:00:00Z', source: 'pdf', fields: { ...NUBE, ...f } });
const run = (i: Invoice, period = EMPTY) => decide(i, findBeneficiary(i.fields.payee_name, DIRECTORY), RULES, period, NOW);
const ask = (i: Invoice, decision: Decision, lang: 'es' | 'en' = 'es', approverEmail = 'juan@blinka.co') =>
  escalationQuestion({ approverEmail, invoice: i, decision }, lang);

describe('escalationQuestion (AC-65, D25)', () => {
  it('reproduces D25 verbatim for the Nube Sur fixture and juan@…', () => {
    const i = inv();
    expect(ask(i, run(i))).toBe('Juan, la factura #2044 de Nube Sur LLC por 4.200 USD supera tu umbral de aprobación de 2.500 USD. ¿La pago?');
  });
  it('an amount the engine cannot trust is "un monto que no pude leer" (R-71)', () => {
    const i = inv({ amount: 1e15 });
    expect(ask(i, run(i))).toContain('por un monto que no pude leer');
  });
  it('a changed account with the same last 4 names both accounts as read, es and en (R-73, AC-65)', () => {
    const i = inv({ bank_account: 'ACH routing 026009593 cuenta 3920175' });
    expect(ask(i, run(i))).toBe('Juan, la factura #2044 de Nube Sur LLC por 4.200 USD trae la cuenta «ACH routing 026009593 cuenta 3920175» y la registrada es «ACH routing 026009593 cuenta 483920175» ' +
      'y supera tu umbral de aprobación de 2.500 USD. ¿La pago?');
    expect(ask(i, run(i), 'en')).toContain('carries the account "ACH routing 026009593 cuenta 3920175" and the one on file is "ACH routing 026009593 cuenta 483920175"');
  });
  it('en version', () => {
    const i = inv();
    expect(ask(i, run(i), 'en')).toBe('Juan, invoice #2044 from Nube Sur LLC for 4,200 USD exceeds your approval threshold of 2,500 USD. Should I pay it?');
  });
  it('two motives, joined "a y b", in record order', () => {
    const i = inv({ bank_account: 'ACH routing 026009593 cuenta 999990001' });
    expect(ask(i, run(i))).toBe('Juan, la factura #2044 de Nube Sur LLC por 4.200 USD trae una cuenta terminada en 0001 y la registrada termina en 0175 ' +
      'y supera tu umbral de aprobación de 2.500 USD. ¿La pago?');
  });
  it('a new payee reads "es de un beneficiario que no está en el directorio"', () => {
    const d: Decision = { outcome: 'ESCALAR', amount_usd: 300, payment: null,
      checks: [{ id: 'beneficiario_permitido', verdict: 'no_cumple', actual: 'Taller Ruiz', threshold: '', values: { payee_name: 'Taller Ruiz' } }] };
    const i = inv({ payee_name: 'Taller Ruiz', amount: 300, invoice_number: '77' });
    expect(ask(i, d)).toBe('Juan, la factura #77 de Taller Ruiz por 300 USD es de un beneficiario que no está en el directorio. ¿La pago?');
  });
  it('unknown fields: sin número, beneficiario y monto que no pude leer (es and en)', () => {
    const i = inv({ payee_name: null, amount: null, invoice_number: null });
    const d: Decision = { outcome: 'ESCALAR', amount_usd: null, payment: null,
      checks: [{ id: 'lectura', verdict: 'no_verificado', actual: '', threshold: '', values: { missing: 'payee_name, amount, invoice_number' } }] };
    expect(ask(i, d)).toBe('Juan, la factura sin número de un beneficiario que no pude leer por un monto que no pude leer tiene datos que no pude leer. ¿La pago?');
    expect(ask(i, d, 'en')).toBe('Juan, invoice with no number from a payee I could not read for an amount I could not read has data I could not read. Should I pay it?');
  });
  it('a check a person cannot unlock ends per R-27 (es and en)', () => {
    const i = inv();
    const d = run(i, { ...EMPTY, committed_usd: 40000 });
    expect(ask(i, d)).toBe('Juan, la factura #2044 de Nube Sur LLC por 4.200 USD supera tu umbral de aprobación de 2.500 USD y supera el presupuesto del periodo de 42.000 USD. ' +
      'Aunque la apruebes no la puedo pagar hasta que se suba el presupuesto del periodo en la política. ¿La rechazo?');
    expect(ask(i, d, 'en')).toBe('Juan, invoice #2044 from Nube Sur LLC for 4,200 USD exceeds your approval threshold of 2,500 USD and exceeds the period budget of 42,000 USD. ' +
      'Even if you approve it I cannot pay it until the period budget is raised in the policy. Should I reject it?');
  });
  it('a re-escalation after approval lists only what is still blocking', () => {
    const i = inv();
    const d = decideWithOverrides(['umbral_aprobacion'], { email: 'juan@blinka.co', channel: 'link' }, i,
      findBeneficiary('Nube Sur LLC', DIRECTORY), RULES, { ...EMPTY, committed_usd: 40000 }, NOW);
    expect(ask(i, d)).toBe('Juan, la factura #2044 de Nube Sur LLC por 4.200 USD supera el presupuesto del periodo de 42.000 USD. ' +
      'Aunque la apruebes no la puedo pagar hasta que se suba el presupuesto del periodo en la política. ¿La rechazo?');
  });
  it.each([
    ['juan.perez@blinka.co', 'Juan, la factura'], ['roberto@hacketix.com', 'Roberto, la factura'], ['maria_jose@x.co', 'Maria, la factura'],
    ['ana-lucia@x.co', 'Ana, la factura'], ['pedro+pagos@x.co', 'Pedro, la factura'], ['finanzas2@x.co', 'La factura'],
    ['123@x.co', 'La factura'], ['.juan@x.co', 'La factura'],
  ])('R-26 name: %s starts "%s"', (email, start) => {
    const i = inv();
    expect(ask(i, run(i), 'es', email).startsWith(`${start} #2044`)).toBe(true);
  });
  it('without a name the English question starts "Invoice"', () => {
    const i = inv();
    expect(ask(i, run(i), 'en', 'ap1@x.co')).toBe('Invoice #2044 from Nube Sur LLC for 4,200 USD exceeds your approval threshold of 2,500 USD. Should I pay it?');
  });
  it('one line: newlines read from a document collapse to spaces (the question is an email subject)', () => {
    const i = inv({ payee_name: 'Nube Sur\r\nBcc: x@evil.co' });
    expect(ask(i, run(i))).not.toMatch(/[\r\n]/);
  });
  it('every non-cumple check has a motive template in es and en', () => {
    for (const id of CHECK_IDS) for (const v of ['no_cumple', 'no_verificado']) {
      expect(es[`question.motive.${id}.${v}`], `${id}.${v}`).toBeTruthy();
      expect(en[`question.motive.${id}.${v}`], `${id}.${v}`).toBeTruthy();
    }
  });
});

// R-75 (AC-13 Clarified item 6): the question, also the e-mail subject and first line of a non-demo company.
describe('escalationQuestion when the reader was unavailable (AC-13 Clarified, R-75)', () => {
  const UNREAD: InvoiceFields = { payee_name: null, amount: null, currency: null, invoice_number: null, issue_date: null, due_date: null,
    concept: null, bank_account: null, confidence: {}, read_error: 'lector_no_disponible' };
  const unread = (source: Invoice['source']): Invoice => ({ id: 'u', received_at: '2026-10-10T15:00:00Z', source, fields: UNREAD });
  it.each([['email', 'por correo'], ['chat', 'por chat'], ['pdf', 'en PDF'], ['image', 'en imagen']] as const)('es, %s', (source, how) => {
    const i = unread(source);
    expect(ask(i, run(i))).toBe(`Juan, no pude leer una factura que llegó ${how}: el lector de facturas no estaba disponible. ` +
      'No la pago sin leerla; vuelve a ingresarla más tarde. ¿Rechazo esta copia sin leer?');
  });
  it.each([['email', 'by email'], ['chat', 'by chat'], ['pdf', 'as a PDF'], ['image', 'as an image']] as const)('en, %s', (source, how) => {
    const i = unread(source);
    expect(ask(i, run(i), 'en')).toBe(`Juan, I could not read an invoice that arrived ${how}: the invoice reader was unavailable. ` +
      'I will not pay it without reading it; enter it again later. Shall I reject this unread copy?');
  });
  it('with no name (R-26) it starts "No pude leer…" / "I could not read…"', () => {
    const i = unread('email');
    expect(ask(i, run(i), 'es', 'ops1@blinka.co')).toMatch(/^No pude leer una factura que llegó por correo: /);
    expect(ask(i, run(i), 'en', 'ops1@blinka.co')).toMatch(/^I could not read an invoice that arrived by email: /);
  });
  it('a re-escalation after an approval asks the same question (the reason is kept, R-77)', () => {
    const i = unread('chat');
    const d = run(i);
    const a = decideWithOverrides(d.checks.filter((c) => c.verdict !== 'cumple').map((c) => c.id), { email: 'r@x.co', channel: 'link' }, i, null, RULES, EMPTY, NOW);
    expect(ask(i, a)).toBe(ask(i, d));
  });
});

