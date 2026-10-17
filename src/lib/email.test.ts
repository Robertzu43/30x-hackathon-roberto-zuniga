import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FULL_CONFIDENCE } from '../engine/__fixtures__/seed';
import type { Env } from '../env';
import type { Decision, Invoice } from '../engine/types';
import { escalationEmail, sendEmail } from './email';

const ENV = {
  SES_REGION: 'us-east-2', SES_FROM_EMAIL: 'agente@example.com',
  AWS_SES_ACCESS_KEY_ID: 'AKIDEXAMPLE', AWS_SES_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
} as Env;
const MSG = { to: 'juan@example.com', subject: 'Asunto', text: 'Hola', html: '<p>Hola</p>' };
const fetchMock = vi.fn();

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); vi.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('sendEmail via SES v2 (AC-39, R-19)', () => {
  it('signs a SigV4 SendEmail request and returns the message id', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ MessageId: 'm-1' }), { status: 200 }));
    expect(await sendEmail(ENV, MSG)).toEqual({ sent: true, id: 'm-1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const req = fetchMock.mock.calls[0]?.[0] as Request;
    expect(req.url).toBe('https://email.us-east-2.amazonaws.com/v2/email/outbound-emails');
    expect(req.method).toBe('POST');
    expect(req.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/us-east-2\/ses\/aws4_request/);
    const body = await req.json() as { FromEmailAddress: string; Destination: unknown; Content: { Simple: { Subject: { Data: string }; Body: Record<'Text' | 'Html', { Data: string }> } } };
    expect(body.FromEmailAddress).toBe('agente@example.com');
    expect(body.Destination).toEqual({ ToAddresses: ['juan@example.com'] });
    expect(body.Content.Simple.Subject.Data).toBe('Asunto');
    expect(body.Content.Simple.Body.Text.Data).toBe('Hola');
    expect(body.Content.Simple.Body.Html.Data).toBe('<p>Hola</p>');
  });
  it.each(['AWS_SES_ACCESS_KEY_ID', 'AWS_SES_SECRET_ACCESS_KEY', 'SES_FROM_EMAIL', 'SES_REGION'] as const)(
    'without %s returns { sent: false } and calls no fetch', async (k) => {
      expect(await sendEmail({ ...ENV, [k]: '' }, MSG)).toEqual({ sent: false });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  it('a rejected send (sandbox: unverified recipient) returns { sent: false } after one try', async () => {
    fetchMock.mockResolvedValue(new Response('{"message":"Email address is not verified."}', { status: 400 }));
    expect(await sendEmail(ENV, MSG)).toEqual({ sent: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('a network error returns { sent: false }, never throws', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    expect(await sendEmail(ENV, MSG)).toEqual({ sent: false });
  });
  it('never logs the body (approval links) or the secret', async () => {
    const log = vi.spyOn(console, 'log');
    await sendEmail({ ...ENV, AWS_SES_ACCESS_KEY_ID: '' }, { ...MSG, text: 'https://x/a?t=SECRET_TOKEN', html: 'SECRET_TOKEN' });
    fetchMock.mockResolvedValue(new Response('no', { status: 500 }));
    await sendEmail(ENV, { ...MSG, text: 'SECRET_TOKEN', html: 'SECRET_TOKEN' });
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain('juan@example.com');
    expect(logged).not.toContain('SECRET_TOKEN');
    expect(logged).not.toContain(ENV.AWS_SES_SECRET_ACCESS_KEY);
  });
});

describe('escalationEmail (AC-39, AC-65, R-28)', () => {
  const QUESTION = 'Juan, la factura #2044 de Nube Sur LLC por 4.200 USD supera tu umbral de aprobación de 2.500 USD. ¿La pago?';
  const invoice: Invoice = { id: 'i', received_at: '2026-10-10T15:00:00Z', source: 'pdf', fields: {
    payee_name: 'Nube Sur LLC', amount: 4200, currency: 'USD', invoice_number: '2044', issue_date: '2026-10-10', due_date: '2026-11-24',
    concept: 'Suscripción mensual plataforma de datos', bank_account: 'ACH routing 026009593 cuenta 483920175', confidence: FULL_CONFIDENCE } };
  const decision: Decision = { outcome: 'ESCALAR', amount_usd: 4200, payment: null, checks: [
    { id: 'limite_pago', verdict: 'cumple', actual: '4200', threshold: '5000', values: { amount_usd: 4200, limit_usd: 5000 } },
    { id: 'umbral_aprobacion', verdict: 'no_cumple', actual: '4200', threshold: '2500', values: { amount_usd: 4200, limit_usd: 2500 } },
  ] };
  const urls = { approveUrl: 'https://app.example/aprobar?t=abc.def&a=1', rejectUrl: 'https://app.example/aprobar?t=ghi.jkl' };
  const mail = (o: Partial<Parameters<typeof escalationEmail>[0]> = {}) =>
    escalationEmail({ lang: 'es', question: QUESTION, invoice, decision, ...urls, ...o });

  it('"Lo que leí" shows a field the engine cannot trust as desconocido (R-71)', () => {
    const text = mail({ invoice: { ...invoice, fields: { ...invoice.fields, due_date: 'not-a-date' } } }).text;
    expect(text).toContain('Vencimiento: desconocido');
    expect(text).not.toContain('not-a-date');
  });
  it('subject and first line equal the stored question', () => {
    const m = mail();
    expect(m.subject).toBe(QUESTION);
    expect(m.text.split('\n')[0]).toBe(QUESTION);
    expect(m.html).toMatch(/<body[^>]*>\s*<p[^>]*>Juan, la factura #2044 de Nube Sur LLC por 4\.200 USD supera tu umbral de aprobación de 2\.500 USD\. ¿La pago\?<\/p>/);
  });
  it('text: headline, "Lo que leí", only the broken rules, Aprobar and Rechazar links', () => {
    expect(mail().text).toBe([
      QUESTION, '',
      'ESCALAR · 4.200 USD a Nube Sur LLC: supera el umbral de aprobación de 2.500 USD', '',
      'Lo que leí',
      'Beneficiario: Nube Sur LLC', 'Monto: 4.200 USD', 'Número de factura: 2044', 'Concepto: Suscripción mensual plataforma de datos',
      'Fecha de emisión: 10 de octubre de 2026', 'Vencimiento: 24 de noviembre de 2026', '',
      'Reglas que no se cumplen',
      '- Umbral de aprobación: 4.200 USD > 2.500 USD → no cumple', '',
      `Aprobar: ${urls.approveUrl}`, `Rechazar: ${urls.rejectUrl}`,
    ].join('\n'));
  });
  it('html has the two buttons with their links', () => {
    const { html } = mail();
    expect(html).toContain('href="https://app.example/aprobar?t=abc.def&amp;a=1"');
    expect(html).toContain('href="https://app.example/aprobar?t=ghi.jkl"');
    expect(html).toMatch(/>Aprobar<\/a>/);
    expect(html).toMatch(/>Rechazar<\/a>/);
  });
  it('unread fields print "desconocido"', () => {
    const { text } = mail({ invoice: { ...invoice, fields: { ...invoice.fields, amount: null, concept: null } } });
    expect(text).toContain('Monto: desconocido');
    expect(text).toContain('Concepto: desconocido');
  });
  it('html escapes every value read from the document', () => {
    const evil = '<img src=x onerror=alert(1)> & "Co"';
    const { html } = mail({ question: `Juan, ${evil}`, invoice: { ...invoice, fields: { ...invoice.fields, payee_name: evil, concept: '<script>x</script>' } } });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;Co&quot;');
  });
});

describe('escalationEmail when the reader was unavailable (AC-13 Clarified, R-75)', () => {
  it('subject and first line are the stored question; the body has the headline and the Lectura row', async () => {
    const { decide } = await import('../engine/decide');
    const inv: Invoice = { id: 'u', received_at: '2026-10-10T15:00:00Z', source: 'email', fields: { payee_name: null, amount: null, currency: null,
      invoice_number: null, issue_date: null, due_date: null, concept: null, bank_account: null, confidence: {}, read_error: 'lector_no_disponible' } };
    const decision: Decision = decide(inv, null, { per_payment_limit_usd: 5000 }, { committed_usd: 0, paid_usd: 0, previous: [] }, '2026-10-17T15:00:00Z');
    const question = 'No pude leer una factura que llegó por correo: el lector de facturas no estaba disponible. No la pago sin leerla; vuelve a ingresarla más tarde. ¿Rechazo esta copia sin leer?';
    const m = escalationEmail({ lang: 'es', question, invoice: inv, decision, approveUrl: 'https://a', rejectUrl: 'https://r' });
    expect(m.subject).toBe(question);
    const lines = m.text.split('\n');
    expect(lines[0]).toBe(question);
    expect(lines[2]).toBe('ESCALAR · factura sin leer: el lector de facturas no estaba disponible; vuelve a ingresarla más tarde');
    expect(m.text).toContain('- Lectura: el lector de facturas no estaba disponible cuando llegó (límite diario del servicio o falla temporal); no se leyó ningún dato → no se pudo verificar');
    expect(m.text).not.toContain('ilegible');
  });
});

