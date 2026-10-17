// Bandeja and Nueva factura (AC-11, AC-29, AC-63, AC-66, AC-70).
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { expect, test } from 'vitest';
import OutcomeChip from './components/OutcomeChip';
import Inbox, { route } from './pages/Inbox';
import { mockApi, renderAt, signedInAs } from './test/utils';

const FORMAT = 'Formato no admitido: sube un PDF, PNG o JPG de hasta 10 MB';
const row = (id: string, outcome: string | null, payee: string | null, headline: string | null) => ({
  id, outcome, headline, received_at: '2026-10-10T15:00:00Z', fields: { payee_name: payee },
});
const ROWS = [
  row('a1', 'PAGAR', 'Nubia Diseño', 'PAGAR · 1.200 USD a Nubia Diseño, retainer mensual de 1.200 USD, dentro de reglas'),
  row('b2', 'ESCALAR', 'Kodex Labs', 'ESCALAR · 4.800 USD a Kodex Labs: supera el umbral de aprobación'),
  row('c3', null, 'Nubia Diseño', null),
];
const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const batch = (o = {}) => ({ PAGAR: 0, FRENAR: 0, ESCALAR: 0, errors: 0, remaining: 0, cursor: null, ...o });
const calls = (f: ReturnType<typeof mockApi>, method: string, path: string) =>
  f.mock.calls.filter(([u, i]) => u === path && (i?.method ?? 'GET') === method);

function setup(routes: Record<string, unknown> = {}) {
  signedInAs('ana@empresa.co');
  const f = mockApi({ 'GET /api/invoices': ROWS, 'GET /api/agent/last-run': { at: minsAgo(7), trigger: 'cron' }, ...routes });
  const view = renderAt(
    <Routes>
      <Route path="/" element={<Inbox />} />
      <Route path="/invoices/:id" element={<p>detalle abierto</p>} />
    </Routes>,
  );
  return { f, view };
}
const items = () => screen.getAllByRole('listitem');

test('Bandeja is the nav page at / (order 10)', () => expect(route).toEqual({ path: '/', nav: { key: 'screen.inbox', order: 10 } }));

test('tour anchors exist before data loads', () => {
  const { view } = setup({ 'GET /api/invoices': () => new Promise(() => {}) });
  for (const a of ['inbox', 'new-invoice', 'run-agent']) expect(view.container.querySelector(`[data-tour="${a}"]`)).not.toBeNull();
  expect(screen.getByText('Cargando facturas…')).toBeTruthy();
});

test('lists 3 rows with chip and headline, each a link to its detail (AC-29)', async () => {
  const { view } = setup();
  await screen.findByText(/supera el umbral/);
  expect(items()).toHaveLength(3);
  expect(within(items()[0]!).getByText('PAGAR')).toBeTruthy();
  expect(within(items()[0]!).getByRole('link').getAttribute('href')).toBe('/invoices/a1');
  expect(view.container.querySelector('[data-tour="invoice-row"]')).not.toBeNull();
});

test('a pending row shows the Pendiente chip and a pending line', async () => {
  setup();
  await screen.findByText(/supera el umbral/);
  expect(within(items()[2]!).getByText('Pendiente')).toBeTruthy();
  expect(within(items()[2]!).getByText('Nubia Diseño · el agente aún no la ha decidido')).toBeTruthy();
});

test('filter by ESCALAR leaves 1, filter by beneficiary narrows too', async () => {
  setup();
  await screen.findByText(/supera el umbral/);
  fireEvent.change(screen.getByLabelText('Resultado'), { target: { value: 'ESCALAR' } });
  expect(items()).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('Resultado'), { target: { value: 'pending' } });
  expect(items()).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('Resultado'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Beneficiario'), { target: { value: 'Nubia Diseño' } });
  expect(items()).toHaveLength(2);
  fireEvent.change(screen.getByLabelText('Resultado'), { target: { value: 'FRENAR' } });
  expect(screen.getByText('Ninguna factura coincide con estos filtros.')).toBeTruthy();
});

test('empty state', async () => {
  setup({ 'GET /api/invoices': [] });
  expect(await screen.findByText('Todavía no hay facturas. Usa «Nueva factura» para subir un PDF o una imagen, o pegar un correo o un chat.')).toBeTruthy();
});

test('error state shows a plain message', async () => {
  setup({ 'GET /api/invoices': new Response(JSON.stringify({ error: 'boom' }), { status: 503 }) });
  expect((await screen.findByRole('alert')).textContent).toBe('No pude cargar las facturas. Recarga la página para intentar de nuevo.');
});

test('"Ejecutar agente" runs the loop: progress, list reloads, summed summary, last-run refreshed (AC-29, AC-70, AC-63)', async () => {
  let n = 0;
  let release: (v: unknown) => void = () => {};
  let lastRun = { at: minsAgo(7), trigger: 'cron' };
  const { f } = setup({
    'POST /api/invoices/run': () => (n++ === 0 ? batch({ PAGAR: 1, remaining: 1, cursor: 'c1' }) : new Promise((r) => (release = r))),
    'GET /api/agent/last-run': () => lastRun,
  });
  await screen.findByText(/hace 7 min · automático/);
  const btn = screen.getByRole('button', { name: 'Ejecutar agente' }) as HTMLButtonElement;
  fireEvent.click(btn);
  expect(await screen.findByText('Decidiendo facturas… 1 de 2')).toBeTruthy();
  expect(btn.disabled).toBe(true);
  lastRun = { at: minsAgo(0.2), trigger: 'manual' };
  release(batch({ ESCALAR: 1 }));
  expect(await screen.findByText('1 PAGAR · 0 FRENAR · 1 ESCALAR')).toBeTruthy();
  expect(await screen.findByText('El agente revisó las facturas pendientes hace menos de 1 min · manual')).toBeTruthy();
  expect(btn.disabled).toBe(false);
  expect(calls(f, 'GET', '/api/invoices').length).toBeGreaterThanOrEqual(3); // first load + one per batch
  expect(JSON.parse(String(calls(f, 'POST', '/api/invoices/run')[1]![1]?.body))).toEqual({ cursor: 'c1' });
});

test('last-run line: cron -> automático', async () => {
  setup();
  expect(await screen.findByText('El agente revisó las facturas pendientes hace 7 min · automático')).toBeTruthy();
});

test('last-run line: any company trigger -> manual, under a minute', async () => {
  setup({ 'GET /api/agent/last-run': { at: minsAgo(0.5), trigger: 'ingest' } });
  expect(await screen.findByText('El agente revisó las facturas pendientes hace menos de 1 min · manual')).toBeTruthy();
});

test('last-run line in English', async () => {
  localStorage.setItem('lang', 'en');
  setup({ 'GET /api/agent/last-run': { at: minsAgo(12), trigger: 'cron' } });
  expect(await screen.findByText('The agent last checked pending invoices 12 min ago · automatic')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Run agent' })).toBeTruthy();
});

test('last-run line when the agent never ran', async () => {
  setup({ 'GET /api/agent/last-run': null });
  expect(await screen.findByText('El agente todavía no ha revisado facturas.')).toBeTruthy();
});

// Nueva factura (AC-11, AC-15 client-side mirror)
const open = () => fireEvent.click(screen.getByRole('button', { name: 'Nueva factura' }));
const pick = (file: File) => fireEvent.change(screen.getByLabelText('Archivo: PDF, PNG o JPG, hasta 10 MB'), { target: { files: [file] } });
const send = () => fireEvent.click(screen.getByRole('button', { name: 'Enviar al agente' }));

test('Nueva factura offers the three tabs', async () => {
  setup();
  open();
  expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Subir PDF o imagen', 'Pegar correo', 'Pegar chat']);
});

test('rejects a .txt file client-side with the API text, posts nothing', async () => {
  const { f } = setup();
  open();
  pick(new File(['hola'], 'factura.txt', { type: 'text/plain' }));
  send();
  expect((await screen.findByRole('alert')).textContent).toBe(FORMAT);
  expect(calls(f, 'POST', '/api/invoices')).toHaveLength(0);
});

test('rejects an 11 MB PDF client-side', async () => {
  const { f } = setup();
  open();
  const big = new File(['%PDF'], 'grande.pdf', { type: 'application/pdf' });
  Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
  pick(big);
  send();
  expect((await screen.findByRole('alert')).textContent).toBe(FORMAT);
  expect(calls(f, 'POST', '/api/invoices')).toHaveLength(0);
});

test('uploads a PDF as multipart file + source, then opens the detail', async () => {
  const { f } = setup({ 'POST /api/invoices': new Response(JSON.stringify({ invoice: { id: 'n1' }, decision: null }), { status: 201 }) });
  open();
  pick(new File(['%PDF-1.4'], '01.pdf', { type: 'application/pdf' }));
  send();
  expect(await screen.findByText('detalle abierto')).toBeTruthy();
  const body = calls(f, 'POST', '/api/invoices')[0]![1]?.body as FormData;
  expect(body.get('source')).toBe('pdf');
  expect((body.get('file') as File).name).toBe('01.pdf');
});

test('shows the API 400 text as is', async () => {
  setup({ 'POST /api/invoices': new Response(JSON.stringify({ error: FORMAT }), { status: 400 }) });
  open();
  pick(new File(['x'], 'scan.png', { type: 'image/png' }));
  send();
  expect((await screen.findByRole('alert')).textContent).toBe(FORMAT);
  expect(screen.queryByText('detalle abierto')).toBeNull();
});

test('posts a pasted chat as JSON and navigates to the new invoice detail', async () => {
  const { f } = setup({ 'POST /api/invoices': new Response(JSON.stringify({ invoice: { id: 'n9' }, decision: {} }), { status: 201 }) });
  open();
  fireEvent.click(screen.getByRole('tab', { name: 'Pegar chat' }));
  fireEvent.change(screen.getByLabelText('Pega aquí el texto'), { target: { value: 'Hola, te paso la cuenta de octubre: 300 USD' } });
  send();
  expect(await screen.findByText('detalle abierto')).toBeTruthy();
  expect(JSON.parse(String(calls(f, 'POST', '/api/invoices')[0]![1]?.body))).toEqual({ source: 'chat', text: 'Hola, te paso la cuenta de octubre: 300 USD' });
});

test('rejects empty and over-20.000-character text client-side', async () => {
  const { f } = setup();
  open();
  fireEvent.click(screen.getByRole('tab', { name: 'Pegar correo' }));
  fireEvent.change(screen.getByLabelText('Pega aquí el texto'), { target: { value: '   ' } });
  send();
  expect((await screen.findByRole('alert')).textContent).toBe('Pega un texto de 1 a 20.000 caracteres.');
  fireEvent.change(screen.getByLabelText('Pega aquí el texto'), { target: { value: 'x'.repeat(20001) } });
  send();
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Pega un texto de 1 a 20.000 caracteres.'));
  expect(calls(f, 'POST', '/api/invoices')).toHaveLength(0);
});

test('OutcomeChip: null is Pendiente', () => {
  renderAt(<><OutcomeChip outcome={null} /><OutcomeChip outcome="ESCALAR" /></>);
  expect(screen.getByText('Pendiente')).toBeTruthy();
  expect(screen.getByText('ESCALAR')).toBeTruthy();
});

test('states that only pending and escalated invoices are re-evaluated (AC-31)', () => {
  setup();
  expect(screen.getByText('Las facturas pagadas o frenadas no se reevalúan; solo las pendientes y escaladas.')).toBeTruthy();
});

test('re-evaluation note in English (AC-31)', () => {
  localStorage.setItem('lang', 'en');
  setup();
  expect(screen.getByText('Paid or stopped invoices are not re-evaluated; only pending and escalated ones.')).toBeTruthy();
});
