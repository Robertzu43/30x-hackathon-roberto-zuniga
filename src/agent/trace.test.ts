/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { FULL_CONFIDENCE } from '../engine/__fixtures__/seed';
import sql from '../../supabase/migrations/20261017000300_seed_andina.sql?raw';
import { findBeneficiary } from '../engine/checks';
import { decide, decideWithOverrides } from '../engine/decide';
import type { Beneficiary, Decision, Invoice, InvoiceFields, PeriodState, PolicyRules } from '../engine/types';
import src from './trace.ts?raw';
import { agentTrace, recordedFields, type StoredDecision, type TraceStep } from './trace';

const SEED = JSON.parse(sql.match(/\$seed\$([\s\S]*?)\$seed\$/)?.[1] ?? 'null');
const RULES: PolicyRules = SEED.rules;
const DIRECTORY: Beneficiary[] = SEED.beneficiaries.map((b: Beneficiary) => ({ ...b, id: `id-${b.name}` }));
const NOW = '2026-10-17T15:00:00Z';
const EMPTY: PeriodState = { committed_usd: 0, paid_usd: 0, previous: [] };
const LAURA: InvoiceFields = {
  payee_name: 'Laura Méndez', amount: 2500, currency: 'USD', invoice_number: '1042', issue_date: '2026-10-10',
  due_date: '2026-11-24', concept: 'Retainer mensual de desarrollo', bank_account: 'Bancolombia ahorros 0012-3456-4821', confidence: FULL_CONFIDENCE,
};
const NUBE: Partial<InvoiceFields> = { payee_name: 'Nube Sur LLC', amount: 4200, invoice_number: '2044',
  concept: 'Suscripción mensual plataforma de datos', bank_account: 'ACH routing 026009593 cuenta 483920175' };
const QUESTION = 'Roberto, la factura #2044 de Nube Sur LLC por 4.200 USD supera tu umbral de aprobación de 2.500 USD. ¿La pago?';
const SENT = { email_sent: true, sent_to: 'roberto@hacketix.com' };

const inv = (f: Partial<InvoiceFields> = {}, source: Invoice['source'] = 'pdf'): Invoice =>
  ({ id: 'i', received_at: '2026-10-10T15:00:00Z', source, fields: { ...LAURA, ...f } });
const run = (i: Invoice, rules: PolicyRules = RULES, period = EMPTY) =>
  decide(i, findBeneficiary(i.fields.payee_name, DIRECTORY), rules, period, NOW);
const stored = (d: Decision, p: Partial<StoredDecision> = {}): StoredDecision => ({
  id: 'd1', seq: 1, outcome: d.outcome, actor: 'agent', actor_email: null, channel: null, checks: d.checks,
  headline_es: null, headline_en: null, question_es: null, question_en: null, policy_version: 1,
  amount_usd: d.amount_usd, payment: d.payment, note: null, created_at: NOW, ...p,
});
const text = (steps: TraceStep[]) => steps.map((s, n) => `${n + 1}. ${s.text}`).join(' ');
const trace = (i: Invoice, decisions: StoredDecision[], o: { isDemo?: boolean; notification?: typeof SENT | null } = {}, lang: 'es' | 'en' = 'es') =>
  agentTrace({ invoice: i, decisions, isDemo: o.isDemo ?? false, notification: o.notification ?? null }, lang);
const escalated = () => {
  const i = inv(NUBE);
  return { i, d: stored(run(i), { question_es: QUESTION, question_en: 'Roberto, invoice #2044 … Should I pay it?' }) };
};

describe('agentTrace "Lo que hice" (AC-64, D24, R-29)', () => {
  it('PAGAR reproduces D24 verbatim, with its loop stages', () => {
    const i = inv();
    const steps = trace(i, [stored(run(i))]);
    expect(text(steps)).toBe('1. Leí el PDF y encontré a Laura Méndez, 2.500 USD, factura #1042. 2. La encontré en el directorio: ' +
      'retainer mensual de 2.500 USD, cuenta terminada en 4821. 3. Verifiqué 13 reglas: 13 cumplen. 4. Decidí PAGAR. ' +
      '5. Preparé la orden de pago: COP · transferencia.');
    expect(steps.map((s) => s.stage)).toEqual(['lee', 'consulta', 'consulta', 'decide', 'actua']);
  });
  it('PAGAR in English', () => {
    const i = inv();
    expect(text(trace(i, [stored(run(i))], {}, 'en'))).toBe('1. I read the PDF and found Laura Méndez, 2,500 USD, invoice #1042. ' +
      '2. I found the payee in the directory: monthly retainer of 2,500 USD, account ending in 4821. 3. I checked 13 rules: 13 pass. ' +
      '4. I decided PAY. 5. I prepared the payment order: COP · transferencia.');
  });
  it('a route without its currency gets the payment currency in front', () => {
    const i = inv(NUBE);
    const steps = trace(i, [stored(run(i, { ...RULES, approval_threshold_usd: 5000 }))]);
    expect(steps[4]?.text).toBe('Preparé la orden de pago: USD · ACH.');
    const mxn = stored(run(inv()), { payment: { beneficiary: 'Diego Ruiz', route: 'MXN', currency: 'MXN', amount: 9000 } });
    expect(trace(inv(), [mxn])[4]?.text).toBe('Preparé la orden de pago: MXN.');
  });
  it('FRENAR: exact duplicate, read from an email', () => {
    const i = inv({}, 'email');
    const prev = { invoice_id: 'p', invoice_number: '1042', beneficiary_id: 'id-Laura Méndez', payee_name: 'Laura Méndez',
      amount_usd: 2500, concept: 'x', received_at: '2026-10-05T15:00:00Z', outcome: 'PAGAR' as const };
    const steps = trace(i, [stored(run(i, RULES, { ...EMPTY, previous: [prev] }))]);
    expect(steps[0]?.text).toBe('Leí el correo y encontré a Laura Méndez, 2.500 USD, factura #1042.');
    expect(steps.slice(2).map((s) => s.text)).toEqual(['Verifiqué 13 reglas: 12 cumplen, 1 no cumple.',
      'Decidí FRENAR: duplicado exacto de la factura #1042.', 'Frené la factura; no preparé orden de pago.']);
  });
  it('ESCALAR with the email sent quotes the stored question', () => {
    const { i, d } = escalated();
    expect(text(trace(i, [d], { notification: SENT }))).toBe('1. Leí el PDF y encontré a Nube Sur LLC, 4.200 USD, factura #2044. ' +
      '2. La encontré en el directorio: suscripción mensual de 4.200 USD, cuenta terminada en 0175. ' +
      '3. Verifiqué 13 reglas: 12 cumplen, 1 no cumple. 4. Decidí ESCALAR: supera el umbral de aprobación de 2.500 USD. ' +
      `5. Le envié a roberto@hacketix.com la pregunta: «${QUESTION}»`);
  });
  it('ESCALAR whose send failed never says "envié" (R-29)', () => {
    const { i, d } = escalated();
    const steps = trace(i, [d], { notification: { email_sent: false, sent_to: 'roberto@hacketix.com' } });
    expect(steps[4]).toEqual({ stage: 'actua', text: 'No pude enviar el correo a roberto@hacketix.com; la pregunta quedó en el tablero.' });
    expect(text(steps)).not.toMatch(/envié/);
  });
  it('ESCALAR on the demo company sends no email (R-15)', () => {
    const { i, d } = escalated();
    expect(trace(i, [d], { isDemo: true })[4]?.text).toBe('Empresa demo: la pregunta quedó en el tablero, sin correo.');
  });
  it('ESCALAR with no recorded send does not claim one', () => {
    const { i, d } = escalated();
    expect(trace(i, [d])[4]?.text).toBe('La pregunta quedó en el tablero; no hay registro de envío de correo.');
  });
  it('a field the engine cannot trust is reported as not read (R-71)', () => {
    const i = inv({ amount: '100' as unknown as number });
    expect(trace(i, [stored(run(i))])[0]?.text).toBe('Leí el PDF y encontré a Laura Méndez, factura #1042; no pude leer el monto.');
  });
  it('an illegible image', () => {
    const i = inv({ payee_name: null, amount: null, currency: null, invoice_number: null, bank_account: null, concept: 'ilegible' }, 'image');
    const steps = trace(i, [stored(run(i))]);
    expect(steps.slice(0, 2).map((s) => s.text)).toEqual(['Leí la imagen y no pude leerla: ilegible.', 'No la encontré en el directorio.']);
    expect(steps[3]?.text).toMatch(/^Decidí ESCALAR: ilegible, /);
  });
  it('an agreement type with no dictionary entry reads "sin acuerdo registrado", never the raw key (R-52, AC-28)', () => {
    const i = inv(), d = stored(run(i));
    const checks = d.checks.map((c) => (c.id === 'acuerdo' ? { ...c, values: { ...c.values, agreement_type: 'weird' } } : c));
    expect(trace(i, [{ ...d, checks }])[1]?.text).toBe('La encontré en el directorio: sin acuerdo registrado, cuenta terminada en 4821.');
    expect(trace(i, [{ ...d, checks }], {}, 'en')[1]?.text).toBe('I found the payee in the directory: no agreement on file, account ending in 4821.');
  });
  it('a field not read is named', () => {
    const i = inv({ amount: null });
    expect(trace(i, [stored(run(i))])[0]?.text).toBe('Leí el PDF y encontré a Laura Méndez, factura #1042; no pude leer el monto.');
  });
  it('a changed account with the same last 4 names both accounts as read, es and en (R-73)', () => {
    const i = inv({ bank_account: 'Bancolombia ahorros 3456-4821' });
    expect(trace(i, [stored(run(i))])[1]?.text).toBe('La encontré en el directorio, pero la cuenta de la factura («Bancolombia ahorros 3456-4821») no coincide con la registrada («Bancolombia ahorros 0012-3456-4821»).');
    expect(trace(i, [stored(run(i))], {}, 'en')[1]?.text).toBe('I found the payee in the directory, but the invoice\'s account ("Bancolombia ahorros 3456-4821") does not match the one on file ("Bancolombia ahorros 0012-3456-4821").');
  });
  it('a changed account is named with both endings', () => {
    const i = inv({ bank_account: 'Nequi 300-555-7310' });
    expect(trace(i, [stored(run(i))])[1]?.text)
      .toBe('La encontré en el directorio, pero la cuenta de la factura termina en 7310 y la registrada en 4821.');
  });
  it('a person approving adds a step; the agent steps stay those of the agent decision', () => {
    const { i, d } = escalated();
    const a = decideWithOverrides(['umbral_aprobacion'], { email: 'roberto@hacketix.com', channel: 'dashboard' },
      i, findBeneficiary('Nube Sur LLC', DIRECTORY), RULES, EMPTY, NOW);
    const h = stored(a, { id: 'd2', seq: 2, actor: 'human', actor_email: 'roberto@hacketix.com', channel: 'dashboard' });
    const steps = trace(i, [d, h], { notification: SENT });
    expect(steps).toHaveLength(6);
    expect(steps[2]?.text).toBe('Verifiqué 13 reglas: 12 cumplen, 1 no cumple.');
    expect(steps[5]).toEqual({ stage: 'actua',
      text: 'roberto@hacketix.com aprobó en el tablero; volví a verificar las reglas y el resultado es PAGAR.' });
    expect(trace(i, [d, h], { notification: SENT }, 'en')[5]?.text)
      .toBe('roberto@hacketix.com approved on the dashboard; I checked the rules again and the result is PAY.');
  });
  it('a person rejecting adds a step without claiming a re-check', () => {
    const { i, d } = escalated();
    const r = { ...d, id: 'd3', seq: 2, outcome: 'FRENAR' as const, actor: 'human' as const, actor_email: 'ana@x.co',
      channel: 'link' as const, question_es: null, question_en: null };
    const want = 'ana@x.co rechazó vía enlace; el resultado es FRENAR y no preparé orden de pago.';
    expect(trace(i, [d, { ...r, checks: [] }])[5]?.text).toBe(want);
    expect(trace(i, [d, r])[5]?.text).toBe(want);
  });
  it('an approval that re-escalates keeps steps 1-5 of the first decision and ends with its own reason (R-64)', () => {
    const { i, d } = escalated();
    const full = { ...EMPTY, committed_usd: 40000 }; // the month's budget is gone by the time the person approves
    const a = decideWithOverrides(['umbral_aprobacion'], { email: 'roberto@hacketix.com', channel: 'dashboard' },
      i, findBeneficiary('Nube Sur LLC', DIRECTORY), RULES, full, NOW);
    expect(a.outcome).toBe('ESCALAR');
    const h = stored(a, { id: 'd2', seq: 2, actor: 'human', actor_email: 'roberto@hacketix.com', channel: 'dashboard' });
    const steps = trace(i, [d, h], { notification: SENT });
    expect(steps).toHaveLength(6);
    expect(steps[2]?.text).toBe('Verifiqué 13 reglas: 12 cumplen, 1 no cumple.'); // history: the first decision's counts
    expect(steps[5]).toEqual({ stage: 'actua', text: 'roberto@hacketix.com aprobó en el tablero; volví a verificar las reglas y el resultado es ' +
      'ESCALAR: supera el presupuesto del periodo de 42.000 USD.' });
    expect(trace(i, [d, h], { notification: SENT }, 'en')[5]?.text).toBe('roberto@hacketix.com approved on the dashboard; ' +
      'I checked the rules again and the result is ESCALATE: exceeds the period budget of 42,000 USD.');
  });
  it('a re-evaluation adds one decide step with its policy version, counts and result; steps 1-5 stay the first decision (R-64)', () => {
    const { i, d } = escalated();
    const frenar = stored(run(i, { ...RULES, per_payment_limit_usd: 1000 }), { id: 'd2', seq: 2, policy_version: 2 });
    const steps = trace(i, [d, frenar], { notification: SENT });
    expect(steps.slice(0, 5)).toEqual(trace(i, [d], { notification: SENT }));
    expect(steps[5]).toEqual({ stage: 'decide', text: 'Reevalué la factura con la política v2: 11 cumplen, 2 no cumplen. ' +
      'Decidí FRENAR: supera el límite por pago de 1.000 USD y supera el umbral de aprobación de 2.500 USD.' });
    expect(trace(i, [d, frenar], { notification: SENT }, 'en')[5]?.text).toBe('I re-evaluated the invoice under policy v2: 11 pass, 2 do not pass. ' +
      'I decided STOP: exceeds the per-payment limit of 1,000 USD and exceeds the approval threshold of 2,500 USD.');
    const pagar = stored(run(i, { ...RULES, approval_threshold_usd: 5000 }), { id: 'd2', seq: 2, policy_version: 3 });
    expect(trace(i, [d, pagar])[5]?.text).toBe('Reevalué la factura con la política v3: 13 cumplen. Decidí PAGAR.');
    expect(trace(i, [d, pagar], {}, 'en')[5]?.text).toBe('I re-evaluated the invoice under policy v3: 13 pass. I decided PAY.');
  });
  it('no decision yet -> no steps', () => expect(trace(inv(), [])).toEqual([]));
  it('is built from templates only: no model import (R-29, AC-28)', () => expect(src).not.toMatch(/lib\/llm|AI\.run/));
});

// R-75 (AC-13 Clarified): no answer came from the reader. Steps 1 and 4 say so; 2, 3 and 5 are unchanged.
describe('agentTrace when the reader was unavailable (AC-13 Clarified, R-75, R-77)', () => {
  const UNREAD: InvoiceFields = { payee_name: null, amount: null, currency: null, invoice_number: null, issue_date: null, due_date: null,
    concept: null, bank_account: null, confidence: {}, read_error: 'lector_no_disponible' };
  const unread = (source: Invoice['source']): Invoice => ({ id: 'u', received_at: '2026-10-10T15:00:00Z', source, fields: UNREAD });

  it('steps 1-5 for a pasted email on the demo company, es and en', () => {
    const i = unread('email');
    const d = stored(run(i));
    expect(trace(i, [d], { isDemo: true }).map((s) => s.text)).toEqual([
      'Intenté leer el correo, pero el lector de facturas no estaba disponible; no inventé ningún dato.',
      'No la encontré en el directorio.',
      expect.stringMatching(/^Verifiqué 13 reglas: /),
      'Decidí ESCALAR: el lector de facturas no estaba disponible.',
      'Empresa demo: la pregunta quedó en el tablero, sin correo.',
    ]);
    const en = trace(i, [d], { isDemo: true }, 'en').map((s) => s.text);
    expect([en[0], en[3]]).toEqual(['I tried to read the email, but the invoice reader was unavailable; I did not make up any data.',
      'I decided ESCALATE: the invoice reader was unavailable.']);
  });
  it.each([['pdf', 'el PDF'], ['image', 'la imagen'], ['chat', 'el chat']] as const)('step 1 names the %s', (source, name) => {
    const i = unread(source);
    expect(trace(i, [stored(run(i))])[0]?.text).toBe(`Intenté leer ${name}, pero el lector de facturas no estaba disponible; no inventé ningún dato.`);
  });
  it('an invoice stored without fields (read by a run) is narrated from its decision: recordedFields carries read_error (R-77)', () => {
    const d = stored(run(unread('chat')));
    const fields = recordedFields(null, d.checks)!;
    expect(fields.read_error).toBe('lector_no_disponible');
    expect(trace({ ...unread('chat'), fields }, [d])[0]?.text).toMatch(/^Intenté leer el chat, pero el lector/);
  });
  it('an approval re-escalates and its step keeps the true reason; never PAGAR', () => {
    const i = unread('email');
    const d = stored(run(i));
    const failing = d.checks.filter((c) => c.verdict !== 'cumple').map((c) => c.id);
    const a = decideWithOverrides(failing, { email: 'r@x.co', channel: 'dashboard' }, i, null, RULES, EMPTY, NOW);
    expect(a.outcome).toBe('ESCALAR');
    const h = stored(a, { id: 'd2', seq: 2, actor: 'human', actor_email: 'r@x.co', channel: 'dashboard' });
    expect(trace(i, [d, h])[5]?.text).toMatch(/el resultado es ESCALAR: el lector de facturas no estaba disponible\.$/);
  });
});

