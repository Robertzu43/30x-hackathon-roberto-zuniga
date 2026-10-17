import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import type { StoredDecision } from '../src/agent/trace';
import type { Check } from '../src/engine/types';
import DocumentPanel from './components/DocumentPanel';
import FxCard from './components/FxCard';
import RuleChecklist from './components/RuleChecklist';
import Timeline from './components/Timeline';
import InvoiceDetail, { route } from './pages/InvoiceDetail';
import { sentence } from './test/text';
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
  expect(screen.getByText(sentence(/Política: Política general · versión 1 ·/))).toBeTruthy();
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

// AC-102 (Task 48): the D39 parts of the record, rendered from the API's contracts (doc_marks, checks, the Moneda values).
const RAW = 'CUENTA DE COBRO 2044\nNube Sur LLC\nTotal: 4.200,00 USD';
const MARKS = [{ field: 'invoice_number', start: 16, end: 20 }, { field: 'payee_name', start: 21, end: 33 }, { field: 'amount', start: 41, end: 49 }];

test('the document panel marks exactly raw_text.slice(start, end) for each doc_mark, inside one data-user text (AC-102, R-131)', () => {
  const { container } = renderAt(<DocumentPanel source="pdf" url="/demo/invoices/11.pdf" rawText={RAW} marks={MARKS} />);
  expect(screen.getByTitle('Documento de la factura').getAttribute('src')).toBe('/demo/invoices/11.pdf');
  const text = container.querySelector('pre')!;
  expect(text.textContent).toBe(RAW);
  expect(text.hasAttribute('data-user')).toBe(true);
  expect([...text.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(MARKS.map((m) => RAW.slice(m.start, m.end)));
  expect(container.querySelectorAll('[data-user] mark, mark').length).toBe(3);
  expect(container.querySelector('canvas, svg')).toBeNull(); // nothing drawn on the document (R-124)
});

test('the document panel: no marks when doc_marks is null; an image is shown; no text shows only the document; nothing says so', () => {
  const a = renderAt(<DocumentPanel source="email" url={null} rawText={RAW} marks={null} />);
  expect(a.container.querySelector('pre')!.textContent).toBe(RAW);
  expect(a.container.querySelector('mark')).toBeNull();
  a.unmount();
  const b = renderAt(<DocumentPanel source="image" url="/demo/invoices/12.png" rawText={null} marks={null} />);
  expect(screen.getByAltText('Documento de la factura').getAttribute('src')).toBe('/demo/invoices/12.png');
  expect(b.container.querySelector('pre')).toBeNull();
  b.unmount();
  renderAt(<DocumentPanel source="pdf" url={null} rawText={null} marks={null} />);
  expect(screen.getByText('No hay archivo para mostrar.')).toBeTruthy();
});

const mixed = () => IDS.map((id) => ({ id, verdict: id === 'umbral_aprobacion' ? 'no_cumple' : id === 'moneda' ? 'no_verificado' : 'cumple',
  actual: '', threshold: '', values: {} })) as Check[];
const sentences = IDS.map((id, i) => `Regla ${i + 1}: frase de la regla ${i + 1} → ${id === 'umbral_aprobacion' ? 'no cumple' : id === 'moneda' ? 'no se pudo verificar' : 'cumple'}`);

test('the rules checklist: a segmented bar «11 de 13 cumplen» with its three counts, then one row per check (AC-102)', async () => {
  renderAt(<RuleChecklist explanations={sentences} checks={mixed()} />);
  const bar = await screen.findByRole('figure');
  expect(bar.getAttribute('aria-label')).toBe('11 de 13 cumplen, en reglas: cumple 11, no cumple 1, no se pudo verificar 1.');
  expect(within(bar).getByText('11 de 13 cumplen')).toBeTruthy();
  const rows = within(screen.getByRole('list', { name: 'Lo que decidí' })).getAllByRole('listitem');
  expect(rows).toHaveLength(13);
  expect(rows[7]!.className).toBe('no_cumple');
  expect(rows[7]!.querySelector('.mark')!.getAttribute('aria-hidden')).toBe('true');
  expect(rows[7]!.querySelector('.check-verdict')!.textContent).toBe('no cumple');
  expect(rows[7]!.querySelector('strong')!.textContent).toBe('Regla 8');
  expect(rows[7]!.textContent).toContain('frase de la regla 8 → no cumple');
  expect(rows[12]!.querySelector('.check-verdict')!.textContent).toBe('no se pudo verificar');
});

test('the rules checklist in English, and one passing rule in the singular (AC-102)', async () => {
  localStorage.setItem('lang', 'en');
  const { unmount } = renderAt(<RuleChecklist explanations={sentences} checks={mixed()} />);
  expect(await screen.findByText('11 of 13 pass')).toBeTruthy();
  expect(screen.getAllByText('passes', { selector: '.check-verdict' })).toHaveLength(11);
  unmount();
  localStorage.setItem('lang', 'es');
  const one = mixed().map((c, i) => ({ ...c, verdict: i === 0 ? 'cumple' : 'no_cumple' })) as Check[];
  renderAt(<RuleChecklist explanations={sentences} checks={one} />);
  expect(await screen.findByText('1 de 13 cumple')).toBeTruthy();
});

const moneda = (values: Record<string, string | number | null>) =>
  ({ id: 'moneda', verdict: values.rate === null ? 'no_verificado' : 'cumple', actual: '', threshold: '', values }) as Check;
const market = { amount: 1500000, currency: 'COP', rate: 1 / 4020.1, amount_usd: 373.14, rate_source: 'Yahoo Finance', rate_fetched_at: '2026-10-17T15:00:00Z' };

test('the FX card is not shown without a stored Moneda rate, nor for USD (AC-102)', () => {
  const { container } = renderAt(<>
    <FxCard check={moneda({ ...market, rate: null, amount_usd: null })} version={1} />
    <FxCard check={moneda({ amount: 4200, currency: 'USD', rate: 1, amount_usd: 4200, rate_source: null, rate_fetched_at: null })} version={1} />
    <FxCard check={undefined} version={1} />
  </>);
  expect(container.textContent).toBe('');
});

test.each([
  ['es', market, 1, '1 USD = 4.020,10 COP · Yahoo Finance · 17 oct 2026 10:00 · 1.500.000 COP = 373,14 USD'],
  ['en', market, 1, '1 USD = 4,020.10 COP · Yahoo Finance · Oct 17, 2026 10:00 · 1,500,000 COP = 373.14 USD'],
  ['es', { ...market, rate: 1 / 4000, amount_usd: 375, rate_source: 'policy', rate_fetched_at: null }, 3,
    '1 USD = 4.000,00 COP · tasa fijada por la política v3 · 1.500.000 COP = 375 USD'],
  ['en', { ...market, rate: 1 / 4000, amount_usd: 375, rate_source: 'policy', rate_fetched_at: null }, 3,
    '1 USD = 4,000.00 COP · rate pinned by policy v3 · 1,500,000 COP = 375 USD'],
])('the FX card (%s) is built from the stored Moneda values (AC-102, AC-74)', (lang, values, version, line) => {
  localStorage.setItem('lang', lang);
  renderAt(<FxCard check={moneda(values)} version={version} />);
  expect(screen.getByText(line)).toBeTruthy();
  expect(screen.getByRole('heading', { name: lang === 'es' ? 'Tasa de cambio' : 'Exchange rate' })).toBeTruthy();
});

test('the timeline has an avatar per actor: the Thesaurus mark, a person\'s initials, a guest glyph (AC-102, R-26)', () => {
  const d = (id: string, more: Partial<StoredDecision>) => ({ ...decision(1, 'ESCALAR'), id, ...more }) as StoredDecision;
  renderAt(<Timeline decisions={[d('a', {}), d('b', { actor: 'human', actor_email: 'juan.perez@blinka.example', channel: 'link' }),
    d('c', { actor: 'human', actor_email: 'ana@blinka.example', channel: 'dashboard' }), d('e', { actor: 'human', actor_email: 'invitado:3f9a1c2b', channel: 'dashboard' })]} />);
  const [agent, juan, ana, guest] = screen.getAllByRole('listitem').map((r) => r.querySelector('.avatar')!);
  expect(agent!.querySelector('img')!.getAttribute('src')).toBe('/brand/thesaurus-mark.svg');
  expect(juan!.textContent).toBe('JP');
  expect(ana!.textContent).toBe('A');
  expect(guest!.querySelector('svg')).toBeTruthy();
  expect(guest!.textContent).toBe('');
  for (const a of [agent, juan, ana, guest]) expect(a!.getAttribute('aria-hidden')).toBe('true');
  expect(screen.getByText('juan.perez@blinka.example').hasAttribute('data-user')).toBe(true);
  expect(screen.getAllByRole('listitem')[3]!.textContent).toContain('Invitado 3f9a1c2b');
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
  await waitFor(() => expect(screen.getByText(sentence('ana@blinka.example en el tablero'))).toBeTruthy());
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
  expect(screen.queryByRole('button', { name: /Aprobar|Rechazar/ })).toBeNull(); // the only button left is AC-67's «Preguntar»
  expect(screen.queryByRole('region', { name: 'Orden de pago' })).toBeNull();
});

test('a pending invoice says the agent has not decided it yet and links back', async () => {
  mockApi({ [GET]: { ...escalated, invoice: { ...invoice, outcome: null }, headline: null, decisions: [], explanations: [], fixes: [], policy: null, trace: [], question: null } });
  open();
  expect(await screen.findByText('Pendiente: el agente aún no la decidió')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Volver a la bandeja' }).getAttribute('href')).toBe('/');
});

// UX-18: the API's 404 stays (its contract); the page gives a heading and a next step in both languages.
test.each([
  ['es', 'No encontré esta factura', 'Revisa el enlace, o vuelve a la bandeja y ábrela desde la lista.', 'Volver a la bandeja'],
  ['en', 'I could not find this invoice', 'Check the link, or go back to the inbox and open it from the list.', 'Back to the inbox'],
])('an unknown invoice (%s): a heading, a next step and the way back', async (lang, heading, next, back) => {
  localStorage.setItem('lang', lang);
  mockApi({ [GET]: json({ error: 'Factura no encontrada' }, 404) });
  open();
  expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeTruthy();
  expect(screen.getByText(next)).toBeTruthy();
  expect(screen.getByRole('link', { name: back }).getAttribute('href')).toBe('/');
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
  expect(screen.getByText(sentence('ana@blinka.example on the dashboard'))).toBeTruthy();
  expect(screen.getAllByText('Agent')).toHaveLength(2);
});

// AC-13 Clarified (R-75, item 7): the reader never answered, so «Lo que leí» says so above the fields, all «desconocido».
const NOTICE_ES = 'No leí esta factura: el lector de facturas no estaba disponible cuando llegó. No adiviné ningún campo.';
const NOTICE_EN = 'I did not read this invoice: the invoice reader was unavailable when it arrived. I did not guess any field.';
const unread = {
  ...escalated,
  invoice: { ...invoice, source: 'email', raw_text: 'Factura de octubre, 300 USD', file_path: null, outcome: 'ESCALAR',
    fields: { payee_name: null, amount: null, currency: null, invoice_number: null, issue_date: null, due_date: null, concept: null,
      bank_account: null, confidence: {}, read_error: 'lector_no_disponible' } },
  file_url: null,
  reading_status: 'unavailable',
};

test('an invoice the reader could not reach: the notice tops «Lo que leí», beside the text, every field unknown (AC-13, R-75)', async () => {
  mockApi({ [GET]: unread });
  open();
  const notice = await screen.findByText(NOTICE_ES);
  const read = screen.getByRole('heading', { name: 'Lo que leí' });
  const text = screen.getByText('Factura de octubre, 300 USD');
  expect(read.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(notice.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const values = [...document.querySelectorAll('.detail-fields dd')].map((dd) => dd.textContent);
  expect(values).toEqual(Array(8).fill('desconocido'));
});

test('the reader notice in English (AC-13, R-75)', async () => {
  localStorage.setItem('lang', 'en');
  mockApi({ [GET]: unread });
  open();
  expect(await screen.findByText(NOTICE_EN)).toBeTruthy();
  expect([...document.querySelectorAll('.detail-fields dd')].map((dd) => dd.textContent)).toEqual(Array(8).fill('unknown'));
});

test('an invoice with no read_error (or before the backend sends it) shows no reader notice (AC-13)', async () => {
  mockApi({ [GET]: escalated });
  open();
  await screen.findByText('Nube Sur LLC', { selector: 'dd' });
  expect(screen.queryByText(NOTICE_ES)).toBeNull();
});

// AC-77 (R-88): «Leído por IA». Snippets are located by code (src/lib/snippet.ts, Task 23); `match` is the found span inside it.
const NOVA = 'Amazon Nova Lite (AWS Bedrock)';
const NOT_FOUND_ES = 'No encontré este valor literal en el texto';
const PRELOADED_ES = 'Datos precargados del conjunto de ejemplo; la IA no leyó este documento.';
const reading = (provider = NOVA) => ({
  provider,
  fields: [
    { name: 'payee_name', value: 'Nube Sur LLC', confidence: 0.97, snippet: 'Emisor: Nube Sur LLC, NIT 900.123', match: [8, 20] },
    { name: 'amount', value: 4200, confidence: 0.92, snippet: 'Total a pagar: USD 4,200.00', match: [19, 27] },
    { name: 'invoice_number', value: '2044', confidence: 0.9, snippet: 'Factura No. 2044', match: [12, 16] },
    { name: 'due_date', value: '2026-10-31', confidence: 0.6, snippet: null, match: null },
    { name: 'bank_account', value: null, confidence: null, snippet: null, match: null },
  ],
});
const fieldRow = (label: string) => screen.getByText(label, { selector: 'dt' }).parentElement!;

test('a model-read invoice heads «Lo que leí» with the provider, and shows each field with value, percentage and snippet (AC-77)', async () => {
  mockApi({ [GET]: { ...escalated, reading: reading(), reading_status: 'ai' } });
  open();
  const badge = await screen.findByText(`Leído por IA · ${NOVA}`);
  expect(screen.getByRole('heading', { name: 'Lo que leí' }).compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const payee = fieldRow('Beneficiario');
  expect(payee.textContent).toMatch(/Nube Sur LLC.*confianza de la IA: 97\s%/);
  expect(payee.querySelector('mark')?.textContent).toBe('Nube Sur LLC');
  expect(payee.textContent).toContain('Emisor: Nube Sur LLC, NIT 900.123');
  const amount = fieldRow('Monto');
  expect(amount.textContent).toMatch(/^Monto4\.200confianza de la IA: 92\s%/);
  expect(amount.querySelector('mark')?.textContent).toBe('4,200.00');
  expect(fieldRow('Número de factura').querySelector('mark')?.textContent).toBe('2044');
  expect(fieldRow('Vencimiento').textContent).toContain(NOT_FOUND_ES);
  expect(screen.queryByText('Cuenta bancaria', { selector: 'dt' })).toBeNull(); // R-107: an unknown field gets no row
  expect(screen.getByText('La IA no pudo leer 1 campo: Cuenta bancaria.')).toBeTruthy();
  expect(screen.queryByText(PRELOADED_ES)).toBeNull();
  expect(document.body.textContent).not.toMatch(/null|undefined|NaN/);
});

test('the Workers AI fallback is named with its model id, as recorded at read time (AC-77)', async () => {
  mockApi({ [GET]: { ...escalated, reading: reading('Workers AI · @cf/meta/llama-3.2-11b-vision-instruct'), reading_status: 'ai' } });
  open();
  expect(await screen.findByText('Leído por IA · Workers AI · @cf/meta/llama-3.2-11b-vision-instruct')).toBeTruthy();
});

test('an invoice no model read says its data was preloaded, with no AI badge (AC-77)', async () => {
  mockApi({ [GET]: { ...escalated, reading: null, reading_status: 'preloaded' } });
  open();
  expect(await screen.findByText(PRELOADED_ES)).toBeTruthy();
  expect(screen.queryByText(/Leído por IA/)).toBeNull();
  expect(screen.getByText('Nube Sur LLC', { selector: 'dd' })).toBeTruthy();
});

test('an unread invoice keeps the AC-13 notice, neither preloaded nor AI-read (AC-77)', async () => {
  mockApi({ [GET]: { ...unread, reading: null, reading_status: 'unavailable' } });
  open();
  expect(await screen.findByText(NOTICE_ES)).toBeTruthy();
  expect(screen.queryByText(PRELOADED_ES)).toBeNull();
  expect(screen.queryByText(/Leído por IA/)).toBeNull();
});

// R-97: the API says who read the invoice (reading_status); the web maps it one to one and never derives it.
test.each([
  ['ai', { reading: reading() }, true, false, false],
  ['preloaded', { reading: null }, false, true, false],
  ['unavailable', { reading: null }, false, false, true],
  ['none', { reading: null }, false, false, false],
  [undefined, {}, false, false, false],
])('reading_status %s renders exactly its line (AC-77, AC-13)', async (status, extra, badge, preloaded, notice) => {
  mockApi({ [GET]: { ...unread, ...extra, reading_status: status } });
  open();
  await screen.findByRole('heading', { name: 'Lo que leí' });
  expect(!!screen.queryByText(/Leído por IA/)).toBe(badge);
  expect(!!screen.queryByText(PRELOADED_ES)).toBe(preloaded);
  expect(!!screen.queryByText(NOTICE_ES)).toBe(notice);
});

test('«Leído por IA» in English (AC-77)', async () => {
  localStorage.setItem('lang', 'en');
  mockApi({ [GET]: { ...escalated, reading: reading(), reading_status: 'ai' } });
  open();
  expect(await screen.findByText(`Read by AI · ${NOVA}`)).toBeTruthy();
  expect(fieldRow('Due date').textContent).toContain('I did not find this value verbatim in the text');
  expect(fieldRow('Beneficiary').textContent).toMatch(/AI confidence: 97%/);
  expect(screen.getByText('The AI could not read 1 field: Bank account.')).toBeTruthy();
});

test('the preloaded notice in English (AC-77)', async () => {
  localStorage.setItem('lang', 'en');
  mockApi({ [GET]: { ...escalated, reading: null, reading_status: 'preloaded' } });
  open();
  expect(await screen.findByText('Preloaded sample data; the AI did not read this document.')).toBeTruthy();
});

test('the record carries «Pregúntale a Thesaurus», which asks about this invoice (AC-67)', async () => {
  const f = mockApi({ [GET]: stopped, 'POST /api/ask': { answer: 'Es un duplicado exacto de la factura #2044.', provider: NOVA, remaining: 9 } });
  open();
  await screen.findByRole('heading', { name: 'Pregúntale a Thesaurus' });
  fireEvent.change(screen.getByLabelText('Tu pregunta sobre el registro'), { target: { value: '¿por qué frenaste esta factura?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preguntar' }));
  expect(await screen.findByText('Es un duplicado exacto de la factura #2044.')).toBeTruthy();
  const posted = f.mock.calls.find(([u]) => u === '/api/ask')![1]!;
  expect(JSON.parse(String(posted.body))).toEqual({ question: '¿por qué frenaste esta factura?', lang: 'es', invoice_id: 'inv-1' });
});

// AC-77 (product ruling): the web marks exactly snippet.slice(start, end), the value as printed, and never searches the snippet.
test('the highlight is the span the API sends, as printed in the document (AC-77)', async () => {
  const fields = [
    { name: 'amount', value: 1000, confidence: 0.9, snippet: 'Total a pagar: COP 1.000,00', match: [19, 27] },
    { name: 'concept', value: 'x', confidence: 0.9, snippet: 'Total due: USD 1,000.00', match: [15, 23] },
    { name: 'due_date', value: '2026-10-31', confidence: 0.9, snippet: 'Vence: 31/10/2026', match: [7, 17] },
  ];
  mockApi({ [GET]: { ...escalated, reading: { provider: NOVA, fields }, reading_status: 'ai' } });
  open();
  await screen.findByText(`Leído por IA · ${NOVA}`);
  expect(fieldRow('Monto').querySelector('mark')?.textContent).toBe('1.000,00');
  expect(fieldRow('Concepto').querySelector('mark')?.textContent).toBe('1,000.00');
  expect(fieldRow('Vencimiento').querySelector('mark')?.textContent).toBe('31/10/2026');
});

// R-130: a cut line arrives with «…» marks and `match` already shifted by the leading one; the web renders it as given.
test('a snippet with «…» marks highlights exactly the span, marks shown as text (AC-77, R-130)', async () => {
  const fields = [
    { name: 'amount', value: 2500, confidence: 0.9, snippet: '\u2026Total a pagar USD 2.500,00', match: [19, 27] },
    { name: 'bank_account', value: 'Pix chave 11 98765-4302', confidence: 0.9, snippet: '\u2026mi cuenta es Pix chave 11 98765-4302 gracias\u2026', match: [14, 37] },
  ];
  mockApi({ [GET]: { ...escalated, reading: { provider: NOVA, fields }, reading_status: 'ai' } });
  open();
  await screen.findByText(`Leído por IA · ${NOVA}`);
  expect(fieldRow('Monto').querySelector('mark')?.textContent).toBe('2.500,00');
  expect(fieldRow('Monto').querySelector('.reading-snippet')?.textContent).toBe('\u2026Total a pagar USD 2.500,00');
  expect(fieldRow('Cuenta bancaria').querySelector('mark')?.textContent).toBe('Pix chave 11 98765-4302');
  expect(fieldRow('Cuenta bancaria').querySelector('.reading-snippet')?.textContent).toBe('\u2026mi cuenta es Pix chave 11 98765-4302 gracias\u2026');
});

test('no <mark> when match is null or missing, even if the value appears in the snippet (AC-77)', async () => {
  const fields = [
    { name: 'invoice_number', value: '2044', confidence: 0.9, snippet: 'Factura No. 2044', match: null },
    { name: 'payee_name', value: 'Nube Sur LLC', confidence: 0.9, snippet: 'Emisor: Nube Sur LLC' },
  ];
  mockApi({ [GET]: { ...escalated, reading: { provider: NOVA, fields }, reading_status: 'ai' } });
  open();
  await screen.findByText(`Leído por IA · ${NOVA}`);
  expect(fieldRow('Número de factura').textContent).toContain('Factura No. 2044');
  expect(document.querySelector('mark')).toBeNull();
});

// R-107: a row only for what the AI read; unknown fields are named once, in one muted line after the rows.
const LABELS_ES = 'Beneficiario, Monto, Moneda, Número de factura, Fecha de emisión, Vencimiento, Concepto, Cuenta bancaria';
const NAMES = ['payee_name', 'amount', 'currency', 'invoice_number', 'issue_date', 'due_date', 'concept', 'bank_account'];
const allUnknown = NAMES.map((name, i) => ({ name, value: [null, '', ' desconocido ', 'unknown'][i % 4], confidence: i % 2 ? 0.4 : null, snippet: null, match: null }));

test('ESCALAR with 8 unknown fields: no rows, no «No encontré», no «desconocido», one line naming the 8 (R-107)', async () => {
  mockApi({ [GET]: { ...escalated, reading: { provider: NOVA, fields: allUnknown }, reading_status: 'ai' } });
  open();
  await screen.findByText(`Leído por IA · ${NOVA}`);
  expect(screen.getByText(`La IA no pudo leer 8 campos: ${LABELS_ES}.`).className).toContain('muted');
  expect(screen.queryByText(NOT_FOUND_ES)).toBeNull();
  expect(screen.queryByText(/desconocido/)).toBeNull();
  expect(screen.queryByText(/confianza/)).toBeNull();
  expect(document.querySelector('.detail-fields')).toBeNull();
  expect(screen.getByTitle('Documento de la factura')).toBeTruthy(); // the badge, the document and the line
});

test('FRENAR, a known value code could not find: the value, «confianza de la IA: 100 %» and «No encontré…» (R-107)', async () => {
  const fields = [{ name: 'due_date', value: '2026-10-31', confidence: 1, snippet: null, match: null }];
  mockApi({ [GET]: { ...stopped, reading: { provider: NOVA, fields }, reading_status: 'ai' } });
  open();
  await screen.findByText(`Leído por IA · ${NOVA}`);
  const row = fieldRow('Vencimiento');
  expect(row.textContent).toContain('31 de octubre de 2026');
  expect(row.textContent).toMatch(/confianza de la IA: 100\s%/);
  expect(row.textContent).toContain(NOT_FOUND_ES);
  expect(screen.queryByText(/La IA no pudo leer/)).toBeNull(); // nothing unknown, no line
});

test('a known field with no usable confidence shows no percentage and never null or NaN (R-107)', async () => {
  const fields = [
    { name: 'payee_name', value: 'Nube Sur LLC', confidence: null, snippet: 'Emisor: Nube Sur LLC', match: [8, 20] },
    { name: 'amount', value: 4200, confidence: 1.5, snippet: null, match: null },
  ];
  mockApi({ [GET]: { ...escalated, reading: { provider: NOVA, fields }, reading_status: 'ai' } });
  open();
  await screen.findByText(`Leído por IA · ${NOVA}`);
  expect(fieldRow('Beneficiario').textContent).toBe('BeneficiarioNube Sur LLCEmisor: Nube Sur LLC');
  expect(fieldRow('Monto').textContent).not.toMatch(/confianza|%/);
  expect(document.body.textContent).not.toMatch(/null|undefined|NaN/);
});

test('the unknown-fields line in English, plural (R-107)', async () => {
  localStorage.setItem('lang', 'en');
  mockApi({ [GET]: { ...escalated, reading: { provider: NOVA, fields: allUnknown }, reading_status: 'ai' } });
  open();
  expect(await screen.findByText('The AI could not read 8 fields: Beneficiary, Amount, Currency, Invoice number, Issue date, Due date, Concept, Bank account.')).toBeTruthy();
  expect(screen.queryByText(/unknown/)).toBeNull();
});

// R-106: the ask box sits directly above «Historial», after the escalation card and the policy line, in Historial's column.
test('«Pregúntale a Thesaurus» comes after the escalation card and the policy line, directly before «Historial» (R-106)', async () => {
  mockApi({ [GET]: escalated });
  open();
  const ask = (await screen.findByRole('heading', { name: 'Pregúntale a Thesaurus' })).closest('section')!;
  const history = screen.getByRole('heading', { name: 'Historial' }).closest('section')!;
  const before = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  expect(before(screen.getByRole('region', { name: 'Necesito tu respuesta' }), ask)).toBe(true);
  expect(before(screen.getByText(/Política general/), ask)).toBe(true);
  expect(ask.nextElementSibling).toBe(history);
});

test('every top-level detail section sits 2.5 rem below what precedes it (R-106)', async () => {
  const { readFileSync } = (await import('node:fs' as string)) as { readFileSync(p: string, enc: string): string };
  const css = readFileSync('web/pages/detail.css', 'utf8');
  expect(css).toMatch(/\.detail \.ask \{[^}]*margin: 2\.5rem 0 0/);
  expect(css).toMatch(/\.detail-card \{[^}]*margin-top: 2\.5rem/);
  expect(css).toMatch(/\.detail h2 \{[^}]*margin: 2\.5rem 0 1rem/);
});

// AC-86: the record names the channel; a vendor's portal message is shown, never read (R-90.5).
test('a portal invoice shows «Portal de proveedores» and the vendor message', async () => {
  mockApi({ [GET]: { ...escalated, invoice: { ...escalated.invoice, origin: 'portal', sender: null, sender_note: 'Adjunto la factura de octubre.' } } });
  open();
  expect(await screen.findByText('Portal de proveedores')).toBeTruthy();
  const note = screen.getByRole('region', { name: 'Mensaje del proveedor' });
  expect(within(note).getByText('Adjunto la factura de octubre.')).toBeTruthy();
});

test('an email invoice shows «Correo de <remitente>»; an app invoice shows no origin and no message', async () => {
  mockApi({ [GET]: { ...escalated, invoice: { ...escalated.invoice, origin: 'email', sender: 'cobros@nubesur.example', sender_note: null } } });
  const view = open();
  expect(await screen.findByText(sentence('Correo de cobros@nubesur.example'))).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'Mensaje del proveedor' })).toBeNull();
  view.unmount();
  mockApi({ [GET]: { ...escalated, invoice: { ...escalated.invoice, origin: 'app', sender: null, sender_note: null } } });
  open();
  await screen.findByRole('heading', { level: 1, name: escalated.headline });
  expect(screen.queryByText(/Portal de proveedores|Correo de/)).toBeNull();
});

test('origin in English', async () => {
  localStorage.setItem('lang', 'en');
  mockApi({ [GET]: { ...escalated, invoice: { ...escalated.invoice, origin: 'email', sender: null, sender_note: null } } });
  open();
  expect(await screen.findByText('Email')).toBeTruthy();
});

// AC-91 item 1 (Task 29 review): a long sender in «Correo de …» or a long payee in the headline never pushes 360 sideways.
test('the origin line and the headline wrap a long unbreakable sender or payee', async () => {
  mockApi({ [GET]: { ...escalated, invoice: { ...escalated.invoice, origin: 'email', sender: 'cuentasporcobrar@distribuidoracolombiana.com.co' } } });
  open();
  expect((await screen.findByText(/cuentasporcobrar@/)).closest('p')!.className).toContain('detail-origin');
  const { readFileSync } = (await import('node:fs' as string)) as { readFileSync(p: string, enc: string): string };
  expect(readFileSync('web/pages/detail.css', 'utf8')).toMatch(/\n\.detail h1, \.detail-origin \{[^}]*overflow-wrap: anywhere/);
});

// UX-05: the two detail links are 44 px tall tap targets on a phone.
test('«Volver a la bandeja» and «Abrir el documento» are 44 px tap targets at phone width', async () => {
  mockApi({ [GET]: { ...escalated, file_url: 'https://files.example/11.pdf' } });
  open();
  expect((await screen.findByRole('link', { name: 'Abrir el documento' })).className).toContain('detail-link');
  expect(screen.getByRole('link', { name: 'Volver a la bandeja' }).className).toContain('detail-link');
  const { readFileSync } = (await import('node:fs' as string)) as { readFileSync(p: string, enc: string): string };
  const phone = readFileSync('web/pages/detail.css', 'utf8').split('@media (max-width: 640px) {')[1] ?? '';
  expect(phone).toMatch(/\.detail-link \{[^}]*min-height: 44px/);
});

// UX-12 (AC-91 item 4): the document image pushed the page down when it loaded (768). Its box is sized before the
// file arrives: the demo scans are 860 × 643 (4:3); any other shape is letterboxed inside it.
test('the document image has a 4:3 box reserved before it loads', async () => {
  const { readFileSync } = (await import('node:fs' as string)) as { readFileSync(p: string, enc: string): string };
  expect(readFileSync('web/pages/detail.css', 'utf8')).toMatch(/\nimg\.detail-doc \{[^}]*aspect-ratio: 4 \/ 3;[^}]*object-fit: contain/);
});
