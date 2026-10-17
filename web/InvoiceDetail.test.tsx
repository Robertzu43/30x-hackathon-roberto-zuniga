import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import InvoiceDetail, { route } from './pages/InvoiceDetail';
import { mockApi, renderAt, signedInAs } from './test/utils';

const IDS = ['lectura', 'beneficiario_permitido', 'beneficiario_cuenta', 'acuerdo', 'duplicado_exacto', 'duplicado_probable',
  'limite_pago', 'umbral_aprobacion', 'presupuesto_periodo', 'saldo_cuenta', 'vencimiento', 'periodo', 'moneda'];
const checks = (failing: string[] = [], overridden?: { by: string; channel: 'link' | 'dashboard' }) =>
  IDS.map((id) => ({ id, verdict: failing.includes(id) ? 'no_cumple' : 'cumple', actual: '', threshold: '', values: {},
    ...(overridden && failing.includes(id) ? { overridden } : {}) }));
const explanations = (failing: string[] = [], extra = '') =>
  IDS.map((id, i) => `Regla ${i + 1}: frase de la regla ${i + 1} → ${failing.includes(id) ? `no cumple${extra}` : 'cumple'}`);

const decision = (seq: number, outcome: string, more: Record<string, unknown> = {}) => ({
  id: `d${seq}`, seq, outcome, actor: 'agent', actor_email: null, channel: null, checks: checks(), note: null,
  policy_version: 1, amount_usd: 4200, payment: null, created_at: '2026-10-16T15:30:00Z', ...more,
});

const invoice = {
  id: 'inv-1', source: 'pdf', file_path: '/demo/invoices/11.pdf', raw_text: null, received_at: '2026-10-16T15:00:00Z',
  fields: { payee_name: 'Nube Sur LLC', amount: 4200, currency: 'USD', invoice_number: '2044', issue_date: '2026-10-01',
    due_date: '2026-10-31', concept: 'Infraestructura de octubre', bank_account: null,
    confidence: { payee_name: 0.97, amount: 0.95, currency: 0.99, invoice_number: 0.9, issue_date: 0.9, due_date: 0.88, concept: 0.8 } },
};
const QUESTION = 'Roberto, la factura #2044 de Nube Sur LLC por 4.200 USD supera tu umbral de aprobación de 2.500 USD. ¿La pago?';
const trace = [
  { stage: 'lee', text: 'Leí el PDF y encontré a Nube Sur LLC, 4.200 USD, factura #2044.' },
  { stage: 'consulta', text: 'La encontré en el directorio: suscripción mensual de 4.200 USD, cuenta terminada en 7781.' },
  { stage: 'consulta', text: 'Verifiqué 13 reglas: 12 cumplen, 1 no cumple.' },
  { stage: 'decide', text: 'Decidí ESCALAR: supera el umbral de aprobación de 2.500 USD.' },
  { stage: 'actua', text: `Le envié a roberto@blinka.example la pregunta: «${QUESTION}»` },
];
const escalated = {
  invoice: { ...invoice, outcome: 'ESCALAR' },
  headline: 'ESCALAR · 4.200 USD a Nube Sur LLC: supera el umbral de aprobación de 2.500 USD',
  decisions: [decision(1, 'ESCALAR', { checks: checks(['umbral_aprobacion']) }), decision(2, 'ESCALAR', { checks: checks(['umbral_aprobacion']) })],
  beneficiary: { name: 'Nube Sur LLC' },
  explanations: explanations(['umbral_aprobacion']),
  fixes: ['Que una persona apruebe el monto sobre el umbral'],
  policy: { name: 'Política general', version: 1, created_at: '2026-10-01T12:00:00Z' },
  trace,
  question: QUESTION,
  file_url: '/demo/invoices/11.pdf',
};
const payment = { beneficiary: 'Nube Sur LLC', route: 'ACH', currency: 'USD', amount: 4200 };
const paid = {
  ...escalated,
  invoice: { ...invoice, outcome: 'PAGAR' },
  headline: 'PAGAR · 4.200 USD a Nube Sur LLC, suscripción de octubre, aprobado por ana@blinka.example',
  decisions: [...escalated.decisions, decision(3, 'PAGAR', { actor: 'human', actor_email: 'ana@blinka.example', channel: 'dashboard',
    checks: checks(['umbral_aprobacion'], { by: 'ana@blinka.example', channel: 'dashboard' }), payment, created_at: '2026-10-16T16:05:00Z' })],
  explanations: explanations(['umbral_aprobacion'], ' · aprobado por ana@blinka.example en el tablero'),
  fixes: [],
  question: null,
};
const stopped = {
  ...escalated,
  invoice: { ...invoice, outcome: 'FRENAR' },
  headline: 'FRENAR · 4.200 USD a Nube Sur LLC: duplicado exacto de la factura #2044',
  decisions: [decision(1, 'FRENAR', { checks: checks(['duplicado_exacto']) })],
  explanations: explanations(['duplicado_exacto']),
  fixes: ['Que el beneficiario envíe una factura nueva con otro número'],
  question: null,
};

const GET = 'GET /api/invoices/inv-1';
const open = () => renderAt(<InvoiceDetail />, { at: '/invoices/inv-1', route: route.path });
const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const gets = (f: ReturnType<typeof mockApi>) => f.mock.calls.filter(([u, i]) => u === '/api/invoices/inv-1' && i?.method === 'GET').length;

test('keeps the /invoices/:id route', () => expect(route.path).toBe('/invoices/:id'));

test('renders the headline and one row per check (13), never a check id or raw key (AC-26)', async () => {
  mockApi({ [GET]: escalated });
  open();
  expect(await screen.findByRole('heading', { level: 1, name: escalated.headline })).toBeTruthy();
  const rows = within(screen.getByRole('list', { name: 'Lo que decidí' })).getAllByRole('listitem');
  expect(rows).toHaveLength(13);
  expect(rows[7]!.textContent).toContain('frase de la regla 8 → no cumple');
  expect(document.body.textContent).not.toMatch(/umbral_aprobacion|payee_name|detail\.|outcome\./);
  expect(screen.getByText('Que una persona apruebe el monto sobre el umbral')).toBeTruthy();
  expect(screen.getByText(/Política: Política general · versión 1 ·/)).toBeTruthy();
});

test('"Lo que hice" sits between the headline and the two columns, numbered, each step with its stage (AC-64)', async () => {
  mockApi({ [GET]: escalated });
  open();
  const did = await screen.findByRole('list', { name: 'Lo que hice' });
  expect(did.tagName).toBe('OL');
  const steps = within(did).getAllByRole('listitem');
  expect(steps.map((s) => s.textContent)).toEqual(trace.map((s, i) => `${i + 1}${s.stage === 'actua' ? 'actúa' : s.stage}${s.text}`));
  const h1 = screen.getByRole('heading', { level: 1 });
  const read = screen.getByRole('heading', { name: 'Lo que leí' });
  expect(h1.compareDocumentPosition(did) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(did.compareDocumentPosition(read) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('"Lo que leí" previews the PDF and lists each field with its confidence; an unread field says so (AC-26, AC-08)', async () => {
  mockApi({ [GET]: escalated });
  open();
  const frame = await screen.findByTitle('Documento de la factura');
  expect(frame.getAttribute('src')).toBe('/demo/invoices/11.pdf');
  expect(screen.getByText('Nube Sur LLC', { selector: 'dd' }).textContent).toBe('Nube Sur LLC');
  expect(screen.getByText('confianza 97%')).toBeTruthy();
  expect(screen.getByText('4.200')).toBeTruthy();
  const account = screen.getByText('Cuenta bancaria').nextElementSibling!;
  expect(account.textContent).toBe('no se pudo leer');
});

test('pasted email text is shown as is; a file that cannot be served says so', async () => {
  mockApi({ [GET]: { ...escalated, invoice: { ...escalated.invoice, source: 'email', file_path: null, raw_text: 'Hola, adjunto la cuenta de cobro 2044' }, file_url: null } });
  open();
  expect(await screen.findByText('Hola, adjunto la cuenta de cobro 2044')).toBeTruthy();
  mockApi({ [GET]: { ...escalated, file_url: null } });
  open();
  expect(await screen.findByText('No hay archivo para mostrar.')).toBeTruthy();
});

test('ESCALAR shows the stored question above Aprobar and Rechazar; Aprobar posts the shown seq, then the new entry appears (AC-65, R-55)', async () => {
  let answered = false;
  const fetchMock = mockApi({
    [GET]: () => (answered ? paid : escalated),
    'POST /api/invoices/inv-1/approve': () => ((answered = true), { decision: paid.decisions[2] }),
  });
  open();
  const card = await screen.findByRole('region', { name: 'Necesito tu respuesta' });
  const q = within(card).getByText(QUESTION);
  const approve = within(card).getByRole('button', { name: 'Aprobar' });
  within(card).getByRole('button', { name: 'Rechazar' });
  expect(q.compareDocumentPosition(approve) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(approve);
  await waitFor(() => expect(screen.getByText('ana@blinka.example en el tablero')).toBeTruthy());
  const post = fetchMock.mock.calls.find(([u]) => u === '/api/invoices/inv-1/approve')!;
  expect(JSON.parse(String(post[1]!.body))).toEqual({ seq: 2 });
  expect(screen.queryByRole('button', { name: 'Aprobar' })).toBeNull();
});

test('Rechazar posts the seq with the optional note', async () => {
  const fetchMock = mockApi({ [GET]: escalated, 'POST /api/invoices/inv-1/reject': { decision: {} } });
  open();
  fireEvent.change(await screen.findByLabelText('Nota (opcional)'), { target: { value: 'No reconozco este cobro' } });
  fireEvent.click(screen.getByRole('button', { name: 'Rechazar' }));
  await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => u === '/api/invoices/inv-1/reject')).toBe(true));
  const post = fetchMock.mock.calls.find(([u]) => u === '/api/invoices/inv-1/reject')!;
  expect(JSON.parse(String(post[1]!.body))).toEqual({ seq: 2, note: 'No reconozco este cobro' });
});

test('a 409 changed shows our own message and reloads the detail (R-55)', async () => {
  const fetchMock = mockApi({ [GET]: escalated, 'POST /api/invoices/inv-1/approve': json({ error: 'changed', message: 'x' }, 409) });
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Aprobar' }));
  expect(await screen.findByText('Esta factura cambió mientras la mirabas. Ya cargué la versión nueva: revísala antes de responder.')).toBeTruthy();
  await waitFor(() => expect(gets(fetchMock)).toBe(2));
});

test('a 409 already_decided says so and reloads', async () => {
  const fetchMock = mockApi({ [GET]: escalated, 'POST /api/invoices/inv-1/approve': json({ error: 'already_decided', message: 'x' }, 409) });
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Aprobar' }));
  expect(await screen.findByText('Alguien ya respondió esta factura. Abajo está el resultado actualizado.')).toBeTruthy();
  await waitFor(() => expect(gets(fetchMock)).toBe(2));
});

test('a 503 busy asks to retry and keeps the buttons', async () => {
  mockApi({ [GET]: escalated, 'POST /api/invoices/inv-1/approve': json({ error: 'busy', message: 'x' }, 503) });
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Aprobar' }));
  expect(await screen.findByText('No pude registrar tu respuesta; inténtalo de nuevo en unos segundos.')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Aprobar' }) as HTMLButtonElement).disabled).toBe(false);
});

test('PAGAR shows the payment block and the overridden check as "no cumple · aprobado por" (AC-26, R-22)', async () => {
  mockApi({ [GET]: paid });
  open();
  const block = await screen.findByRole('region', { name: 'Orden de pago' });
  expect(within(block).getByText('Beneficiario').nextElementSibling!.textContent).toBe('Nube Sur LLC');
  expect(within(block).getByText('Ruta').nextElementSibling!.textContent).toBe('ACH');
  expect(within(block).getByText('Moneda').nextElementSibling!.textContent).toBe('USD');
  expect(within(block).getByText('Monto').nextElementSibling!.textContent).toBe('4.200');
  expect(within(block).getByText('Equivalente en USD').nextElementSibling!.textContent).toBe('4.200');
  expect(screen.getByText(/no cumple · aprobado por ana@blinka\.example en el tablero/)).toBeTruthy();
  const history = within(screen.getByRole('list', { name: 'Historial' })).getAllByRole('listitem');
  expect(history.map((h) => h.textContent)).toEqual([
    expect.stringMatching(/Agente.*ESCALAR/), expect.stringMatching(/Agente.*ESCALAR/), expect.stringMatching(/ana@blinka\.example en el tablero.*PAGAR/),
  ]);
  expect(history[2]!.textContent).toMatch(/16 de octubre de 2026.*11:05/);
  expect(screen.queryByRole('button', { name: 'Aprobar' })).toBeNull();
});

test('FRENAR is final: no answer buttons, no payment block', async () => {
  mockApi({ [GET]: stopped });
  open();
  expect(await screen.findByRole('heading', { level: 1, name: stopped.headline })).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.queryByRole('region', { name: 'Orden de pago' })).toBeNull();
});

test('a pending invoice says the agent has not decided it yet and links back', async () => {
  mockApi({ [GET]: { ...escalated, invoice: { ...invoice, outcome: null }, headline: null, decisions: [], explanations: [], fixes: [], policy: null, trace: [], question: null } });
  open();
  expect(await screen.findByText('Pendiente: el agente aún no la decidió')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Volver a la bandeja' }).getAttribute('href')).toBe('/');
});

test('an unknown invoice says so', async () => {
  mockApi({ [GET]: json({ error: 'Factura no encontrada' }, 404) });
  open();
  expect(await screen.findByText('No encontré esta factura.')).toBeTruthy();
});

test('English renders the English labels and en-US formats (AC-28)', async () => {
  signedInAs('ana@blinka.example', { lang: 'en' });
  mockApi({ [GET]: { ...paid, headline: 'PAY · 4,200 USD to Nube Sur LLC' } });
  open();
  expect(await screen.findByRole('heading', { level: 1, name: 'PAY · 4,200 USD to Nube Sur LLC' })).toBeTruthy();
  expect(await screen.findByRole('heading', { name: 'What I did' })).toBeTruthy();
  for (const h of ['What I did', 'What I read', 'What I decided', 'History']) expect(screen.getByRole('heading', { name: h })).toBeTruthy();
  const block = screen.getByRole('region', { name: 'Payment order' });
  expect(within(block).getByText('Amount').nextElementSibling!.textContent).toBe('4,200');
  expect(screen.getByText('ana@blinka.example on the dashboard')).toBeTruthy();
  expect(screen.getAllByText('Agent')).toHaveLength(2);
});
