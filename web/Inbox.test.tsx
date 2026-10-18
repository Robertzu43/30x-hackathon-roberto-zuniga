// Bandeja and Nueva factura (AC-11, AC-29, AC-63, AC-66, AC-70, AC-101).
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import OutcomeChip from './components/OutcomeChip';
import { routes } from './App';
import type { DashboardData } from './dashboard/Dashboard';
import { FirstRunProvider, markFirstRun } from './firstRun';
import Inbox from './pages/Inbox';
import { sentence } from './test/text';
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
// AC-101: Task 45's `dashboard`, as the screen function computes it.
const DASH: DashboardData = {
  kpis: { to_pay_today_usd: 1200, to_pay_today_count: 1, awaiting_count: 3, awaiting_usd: 9600, stopped_month_count: 2, autonomy_pct: 75, autonomy_n: 3, autonomy_m: 4 },
  by_day: Array.from({ length: 30 }, (_, i) => ({ day: `2026-09-${String(i + 1).padStart(2, '0')}`, PAGAR: i === 29 ? 1 : 0, FRENAR: 0, ESCALAR: i === 29 ? 1 : 0, pending: i === 29 ? 1 : 0 })),
  by_currency: [{ currency: 'USD', usd: 1200 }], by_country: [{ country: 'CO', usd: 1200 }],
  due_soon: [{ invoice_id: 'a1', payee: 'Nubia Diseño', amount: 1200, currency: 'USD', amount_usd: 1200, due_date: '2026-10-20', outcome: 'PAGAR' }], due_soon_total: 1,
  approvals: [{ invoice_id: 'b2', payee: 'Kodex Labs', amount: 4800, currency: 'USD', question_es: '¿Apruebo 4.800 USD a Kodex Labs?', question_en: 'Do I approve 4,800 USD to Kodex Labs?', decided_at: '2026-10-10T15:00:00Z' }],
  approvals_total: 3,
};
const EMPTY_DASH: DashboardData = { ...DASH, kpis: { ...DASH.kpis, to_pay_today_usd: 0, to_pay_today_count: 0, awaiting_count: 0, awaiting_usd: 0, stopped_month_count: 0, autonomy_pct: null, autonomy_n: 0, autonomy_m: 0 },
  by_day: DASH.by_day.map((d) => ({ ...d, PAGAR: 0, ESCALAR: 0, pending: 0 })), by_currency: [], by_country: [], due_soon: [], due_soon_total: 0, approvals: [], approvals_total: 0 };
const PORTAL = 'https://facturas.30x-hackathon-roberto-zuniga.workers.dev/andina-labs';
const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const batch = (o = {}) => ({ PAGAR: 0, FRENAR: 0, ESCALAR: 0, errors: 0, remaining: 0, cursor: null, ...o });
const calls = (f: ReturnType<typeof mockApi>, method: string, path: string) =>
  f.mock.calls.filter(([u, i]) => u === path && (i?.method ?? 'GET') === method);
const screenCalls = (f: ReturnType<typeof mockApi>) => f.mock.calls.filter(([u]) => String(u).startsWith('/api/screen/inbox'));

// AC-98: Bandeja loads one GET /api/screen/inbox. Tests still name its parts by the old endpoints; the mock composes them,
// and any part that fails (a Response) fails the whole screen request.
const PARTS = { 'GET /api/invoices': 'invoices', 'GET /api/agent/last-run': 'last_run', 'GET /api/portal-link': 'portal', 'GET /api/beneficiaries': 'beneficiaries' };
function setup(routes: Record<string, unknown> = {}, dashboard: DashboardData | null = DASH, pass = false) {
  signedInAs('ana@empresa.co');
  if (pass) markFirstRun('id:ana@empresa.co'); // the entry's tab flag: the shell's first-login pass starts (AC-107)
  const all: Record<string, unknown> = { 'GET /api/invoices': ROWS, 'GET /api/agent/last-run': { at: minsAgo(7), trigger: 'cron' },
    'GET /api/portal-link': { portal_url: PORTAL, email_address: null }, 'GET /api/beneficiaries': [], 'GET /api/agent/activity': { items: [] }, ...routes };
  const inbox = async () => {
    const body: Record<string, unknown> = { dashboard };
    for (const [k, field] of Object.entries(PARTS)) {
      const v = typeof all[k] === 'function' ? await (all[k] as () => unknown)() : all[k];
      if (v instanceof Response) return v;
      body[field] = v;
    }
    return body;
  };
  const rest = Object.fromEntries(Object.entries(all).filter(([k]) => !(k in PARTS)));
  const f = mockApi({ ...rest, 'GET /api/screen/inbox?lang=es': inbox, 'GET /api/screen/inbox?lang=en': inbox });
  const view = renderAt(
    <FirstRunProvider>
      <Routes>
        <Route path="/" element={<Inbox />} />
        <Route path="/invoices/:id" element={<p>detalle abierto</p>} />
      </Routes>
    </FirstRunProvider>,
  );
  return { f, view };
}
const tableBlock = () => screen.getByRole('region', { name: /^(Facturas|Invoices)$/ });
const table = () => within(tableBlock()).getByRole('table'); // the charts hold their own visually hidden value tables (AC-106)
const items = () => within(table()).getAllByRole('row').slice(1); // the invoice rows, under the header row
const payeeSelect = () => screen.getByLabelText(/^Benefici(ario|ary)$/);
const payeeOptions = () => within(payeeSelect()).getAllByRole('option').map((o) => o.textContent);
const choosePayee = (label: string) => {
  const select = payeeSelect();
  const option = within(select).getAllByRole('option').find((o) => o.textContent === label)!;
  fireEvent.change(select, { target: { value: (option as HTMLOptionElement).value } });
};

test('Bandeja is the first nav page, at /', () => expect(routes.filter((r) => r.nav)[0]).toMatchObject({ path: '/', nav: 'screen.inbox' }));

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
  expect(screen.queryByRole('list', { name: /./ })).toBeNull();
  expect(view.container.querySelector('[data-tour="invoice-row"]')).not.toBeNull();
});

test('a pending row shows the Pendiente chip and a pending line', async () => {
  setup();
  await screen.findByText(/supera el umbral/);
  expect(within(items()[2]!).getByText('Pendiente')).toBeTruthy();
  expect(within(items()[2]!).getByText(sentence('Nubia Diseño · el agente aún no la ha decidido'))).toBeTruthy();
});

test('filter by ESCALAR leaves 1, filter by beneficiary narrows too', async () => {
  setup();
  await screen.findByText(/supera el umbral/);
  fireEvent.change(screen.getByLabelText('Resultado'), { target: { value: 'ESCALAR' } });
  expect(items()).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('Resultado'), { target: { value: 'pending' } });
  expect(items()).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('Resultado'), { target: { value: '' } });
  choosePayee('Nubia Diseño');
  expect(items()).toHaveLength(2);
  fireEvent.change(screen.getByLabelText('Resultado'), { target: { value: 'FRENAR' } });
  expect(screen.getByText('Ninguna factura coincide con estos filtros.')).toBeTruthy();
});

test('empty state', async () => {
  setup({ 'GET /api/invoices': [] });
  expect(await screen.findByText('Todavía no hay facturas. Usa «Nueva factura» para subir un PDF o una imagen, o pegar un correo o un chat.')).toBeTruthy();
});

test('a second 5xx shows a plain message with «Reintentar», no skeleton; «Reintentar» loads Bandeja (R-150 lever 4)', async () => {
  let n = 0;
  const { f, view } = setup({ 'GET /api/invoices': () => (++n <= 2 ? new Response(JSON.stringify({ error: 'boom' }), { status: 503 }) : ROWS) });
  expect((await screen.findByRole('alert')).textContent).toBe('No pude cargar las facturas. Revisa tu conexión e intenta de nuevo.');
  expect(screenCalls(f)).toHaveLength(2); // the one retry, then the message
  expect(view.container.querySelector('.skeleton')).toBeNull();
  expect(screen.queryByRole('table')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  await screen.findByText(/supera el umbral/);
  expect(screen.queryByRole('alert')).toBeNull();
});

test('one 5xx is retried with the skeleton kept and no message (R-150 lever 4)', async () => {
  let n = 0;
  const { f } = setup({ 'GET /api/invoices': () => (++n === 1 ? new Response(JSON.stringify({ error: 'boom' }), { status: 500 }) : ROWS) });
  await screen.findByText(/supera el umbral/);
  expect(screenCalls(f)).toHaveLength(2);
  expect(screen.queryByRole('alert')).toBeNull();
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
  expect(screenCalls(f).length).toBeGreaterThanOrEqual(3); // first load + one per batch
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

// AC-29 Clarified (R-79, R-63): the beneficiary filter groups exactly like Periodo.
const at = (day: string, id: string, payee: string | null) => ({ ...row(id, 'ESCALAR', payee, `ESCALAR · ${id}`), received_at: `2026-10-${day}T15:00:00Z`, fields: payee === null ? null : { payee_name: payee } });

test('the beneficiary filter lists one vendor once, under its directory name, with every spelling of it (R-79)', async () => {
  setup({
    'GET /api/invoices': [at('12', 'n2', 'Contadores Andinos SAS'), at('11', 'k1', 'Kodex Labs'), at('10', 'n1', 'Contadores Andinos S.A.S.'), at('09', 'u1', null)],
    'GET /api/beneficiaries': [{ id: 'b1', name: 'Contadores Andinos', bank_account: '1234', agreement: null }],
  });
  await screen.findByText('ESCALAR · n2');
  expect(payeeOptions()).toEqual(['Todos', 'Contadores Andinos', 'Kodex Labs', 'Beneficiario no leído']);
  choosePayee('Contadores Andinos');
  expect(items().map((li) => li.textContent)).toEqual([expect.stringContaining('n2'), expect.stringContaining('n1')]);
  choosePayee('Beneficiario no leído');
  expect(items().map((li) => li.textContent)).toEqual([expect.stringContaining('u1')]);
});

test('a payee outside the directory is one entry labelled as read on its oldest invoice (R-63)', async () => {
  localStorage.setItem('lang', 'en');
  setup({ 'GET /api/invoices': [at('12', 'p2', 'PIXEL LAB'), at('10', 'p1', 'Pixel Lab S.A.S.'), at('09', 'u1', null)] });
  await screen.findByText('ESCALAR · p2');
  expect(payeeOptions()).toEqual(['All', 'Pixel Lab S.A.S.', 'Payee not read']);
  choosePayee('Pixel Lab S.A.S.');
  expect(items()).toHaveLength(2);
});

const follows = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

// AC-101: the dashboard first, then the ask box (AC-67), then the invoice table, last on the page.
test('Bandeja shows the dashboard, then «Pregúntale a Thesaurus», then the table last (AC-101, AC-67)', async () => {
  const { view } = setup();
  await screen.findByText(/supera el umbral/);
  const kpi = await screen.findByRole('group', { name: /^Por pagar hoy: / });
  const ask = screen.getByRole('region', { name: 'Pregúntale a Thesaurus' });
  expect(follows(kpi, ask)).toBe(true);
  expect(follows(screen.getByRole('region', { name: 'Necesita tu respuesta' }), ask)).toBe(true);
  expect(follows(ask, tableBlock())).toBe(true);
  expect(view.container.querySelector('section.inbox')!.lastElementChild).toBe(tableBlock());
  expect(within(tableBlock()).getByRole('table')).toBeTruthy();
});

test('each dashboard section is on Bandeja with the screen function figures (AC-101)', async () => {
  setup();
  expect((await screen.findByRole('group', { name: 'Esperando tu aprobación: 3' })).textContent).toMatch(/US\$\s9\.600,00/);
  expect(await screen.findByRole('group', { name: 'Frenadas este mes: 2' })).toBeTruthy();
  expect(await screen.findByRole('group', { name: /^Autonomía: 75\s?%$/ })).toBeTruthy();
  const ask = screen.getByRole('region', { name: 'Necesita tu respuesta' });
  expect(within(ask).getByText('¿Apruebo 4.800 USD a Kodex Labs?')).toBeTruthy();
  expect(within(ask).getByRole('link', { name: 'Responder' }).getAttribute('href')).toBe('/invoices/b2');
  expect(within(screen.getByRole('region', { name: 'Vence pronto (7 días)' })).getByText('Nubia Diseño')).toBeTruthy();
  for (const title of ['Facturas por día y resultado (últimos 30 días)', 'Pagado este mes por moneda', 'Pagado este mes por país']) {
    expect((await screen.findAllByText(title)).length).toBeGreaterThan(0);
  }
});

test('«y 2 más» filters the table to ESCALAR (AC-101)', async () => {
  setup();
  await screen.findByText(/supera el umbral/);
  fireEvent.click(screen.getByRole('link', { name: 'y 2 más' }));
  expect(screen.getByLabelText('Resultado')).toHaveProperty('value', 'ESCALAR');
  expect(items()).toHaveLength(1);
  expect(within(items()[0]!).getByText('ESCALAR')).toBeTruthy();
});

test('empty states: every dashboard section and the table say so (AC-101, AC-106)', async () => {
  setup({ 'GET /api/invoices': [] }, EMPTY_DASH);
  expect(await screen.findByText('Todavía no hay facturas. Usa «Nueva factura» para subir un PDF o una imagen, o pegar un correo o un chat.')).toBeTruthy();
  expect(screen.getByText('Nada espera tu respuesta.')).toBeTruthy();
  expect(screen.getByText('Nada vence en los próximos 7 días.')).toBeTruthy();
  expect(await screen.findAllByText('Todavía no hay datos para este gráfico.')).toHaveLength(3);
});

test('an answer with no dashboard yet shows the table alone (AC-98: null until Task 45)', async () => {
  setup({}, null);
  await screen.findByText(/supera el umbral/);
  expect(screen.queryByRole('region', { name: 'Necesita tu respuesta' })).toBeNull();
  expect(items()).toHaveLength(3);
});

test('search ignores case and accents over beneficiary, number and concept (AC-101)', async () => {
  setup({ 'GET /api/invoices': [
    { ...row('a1', 'PAGAR', 'Nubia Diseño', 'PAGAR · a1'), fields: { payee_name: 'Nubia Diseño', invoice_number: 'FE-77', concept: 'Retainer' } },
    { ...row('b2', 'ESCALAR', 'Kodex Labs', 'ESCALAR · b2'), fields: { payee_name: 'Kodex Labs', invoice_number: '2044', concept: 'Migración de datos' } },
  ] });
  await screen.findByText('PAGAR · a1');
  const search = screen.getByLabelText('Buscar por beneficiario, número o concepto');
  fireEvent.change(search, { target: { value: 'NUBIA DISENO' } });
  expect(items().map((r) => r.textContent)).toEqual([expect.stringContaining('a1')]);
  fireEvent.change(search, { target: { value: 'migracion' } });
  expect(items().map((r) => r.textContent)).toEqual([expect.stringContaining('b2')]);
  fireEvent.change(search, { target: { value: 'fe-77' } });
  expect(items().map((r) => r.textContent)).toEqual([expect.stringContaining('a1')]);
});

test('a header click sorts and toggles the direction, with aria-sort (AC-101)', async () => {
  setup({ 'GET /api/invoices': [{ ...row('a1', 'PAGAR', 'Nubia Diseño', 'PAGAR · a1'), amount_usd: 1200 }, { ...row('b2', 'ESCALAR', 'Kodex Labs', 'ESCALAR · b2'), amount_usd: 4800 }] });
  await screen.findByText('PAGAR · a1');
  const usd = () => screen.getByRole('columnheader', { name: /Monto USD/ });
  fireEvent.click(within(usd()).getByRole('button'));
  expect(usd().getAttribute('aria-sort')).toBe('ascending');
  expect(items().map((r) => r.getAttribute('data-id'))).toEqual(['a1', 'b2']);
  fireEvent.click(within(usd()).getByRole('button'));
  expect(usd().getAttribute('aria-sort')).toBe('descending');
  expect(items().map((r) => r.getAttribute('data-id'))).toEqual(['b2', 'a1']);
});

// AC-67: the ask box asks about the whole inbox, no invoice.
test('Bandeja carries «Pregúntale a Thesaurus»; it asks about the whole inbox, no invoice (AC-67)', async () => {
  const { f } = setup({ 'POST /api/ask': { answer: 'Quedan 3.200 USD del presupuesto de octubre.', provider: 'Amazon Nova Lite (AWS Bedrock)', remaining: 8 } });
  await screen.findByText(/supera el umbral/);
  const ask = screen.getByRole('region', { name: 'Pregúntale a Thesaurus' });
  fireEvent.change(within(ask).getByLabelText('Tu pregunta sobre el registro'), { target: { value: '¿cuánto queda del presupuesto?' } });
  fireEvent.click(within(ask).getByRole('button', { name: 'Preguntar' }));
  expect(await within(ask).findByText('Te quedan 8 preguntas hoy')).toBeTruthy();
  expect(calls(f, 'POST', '/api/ask').map(([, i]) => JSON.parse(String(i!.body)))).toEqual([{ question: '¿cuánto queda del presupuesto?', lang: 'es' }]);
});

// AC-91 item 4: nothing may change height once data arrives (measured in Chromium: the
// last-run line popping in and the payee select widening with its options were the shifts).
test('the last-run line holds its place before its request answers', () => {
  setup();
  expect(document.querySelector('.inbox-last-run')).not.toBeNull();
});

test('the filters and the last-run line have sizes that do not depend on the data', async () => {
  const { readFileSync } = (await import('node:fs' as string)) as { readFileSync(p: string, enc: string): string };
  const css = readFileSync('web/pages/inbox.css', 'utf8');
  expect(css).toMatch(/\n\.inbox-last-run \{[^}]*min-height: 1\.6em/); // one line
  expect(css.split('@media (max-width: 640px) {')[1]).toMatch(/\.inbox-last-run \{[^}]*min-height: 3\.2em/); // it wraps to two on a phone
  expect(css).toMatch(/\n\.inbox-filters label \{[^}]*flex: 1 1 12rem/);
  expect(css).toMatch(/\n\.inbox-filters select \{[^}]*width: 100%/);
});

// AC-63 Clarified (R-90): a run started by the vendor portal or the email intake is never «manual».
test.each([
  ['portal', 'es', 'El agente revisó las facturas pendientes hace 3 min · portal de proveedores'],
  ['email', 'es', 'El agente revisó las facturas pendientes hace 3 min · correo'],
  ['portal', 'en', 'The agent last checked pending invoices 3 min ago · vendor portal'],
  ['email', 'en', 'The agent last checked pending invoices 3 min ago · email'],
])('last-run line: via %s (%s)', async (via, lang, line) => {
  localStorage.setItem('lang', lang);
  setup({ 'GET /api/agent/last-run': { at: minsAgo(3), trigger: 'ingest', via } });
  expect(await screen.findByText(line)).toBeTruthy();
});

// AC-86: the portal link card, above the table (AC-101: the table comes last).
const card = () => screen.findByRole('region', { name: 'Comparte este enlace con tus proveedores' });

test('the card shows the company portal URL and no email line when the intake address is null (AC-86)', async () => {
  setup();
  const c = await card();
  expect(within(c).getByText(PORTAL)).toBeTruthy();
  expect(c.textContent).not.toMatch(/escriban|@/);
  expect(follows(c, tableBlock())).toBe(true);
  expect(screen.getAllByRole('button').filter((b) => b.classList.contains('primary')).map((b) => b.textContent)).toEqual(['Ejecutar agente']);
});

test('with an intake address the card adds «o que escriban a facturas+<slug>@<dominio>» (AC-86)', async () => {
  setup({ 'GET /api/portal-link': { portal_url: PORTAL, email_address: 'facturas+andina-labs@in.example.co' } });
  expect(within(await card()).getByText('o que escriban a facturas+andina-labs@in.example.co')).toBeTruthy();
});

test('«Copiar enlace» copies the URL, says «Copiado» for 2 s in an aria-live region (R-102)', async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  setup();
  const c = await card();
  fireEvent.click(within(c).getByRole('button', { name: 'Copiar enlace' }));
  expect(await within(c).findByRole('button', { name: 'Copiado' })).toBeTruthy();
  expect(writeText).toHaveBeenCalledWith(PORTAL);
  expect(c.querySelector('[aria-live="polite"]')!.textContent).toBe('Copiado');
  expect(await within(c).findByRole('button', { name: 'Copiar enlace' }, { timeout: 3000 })).toBeTruthy();
});

test('a refused clipboard shows the press-and-hold text (R-102)', async () => {
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: async () => { throw new Error('denied'); } } });
  setup();
  fireEvent.click(within(await card()).getByRole('button', { name: 'Copiar enlace' }));
  expect(await screen.findByText('No pude copiarlo; mantén presionado el enlace.')).toBeTruthy();
});

test('an answer without a portal URL (empty) shows no card and no developer words', async () => {
  setup({ 'GET /api/portal-link': [] });
  await screen.findByRole('heading', { name: 'Actividad del agente' });
  expect(screen.queryByRole('region', { name: 'Comparte este enlace con tus proveedores' })).toBeNull();
  expect(document.body.textContent).not.toMatch(/undefined|null/);
});

test('rows show where a portal or email invoice came from (AC-86)', async () => {
  setup({ 'GET /api/invoices': [
    { ...row('p1', 'PAGAR', 'Laura Méndez', 'PAGAR · portal'), origin: 'portal', sender: null, received_at: '2026-10-10T15:02:00Z' },
    { ...row('e1', 'ESCALAR', 'Kodex Labs', 'ESCALAR · correo'), origin: 'email', sender: 'cobros@kodex.example', received_at: '2026-10-10T15:01:00Z' },
    { ...row('a1', 'PAGAR', 'Nubia Diseño', 'PAGAR · app'), origin: 'app', sender: null },
  ] });
  await screen.findByText('PAGAR · portal');
  expect(within(items()[0]!).getByText('Portal de proveedores')).toBeTruthy();
  expect(within(items()[1]!).getByText(sentence('Correo de cobros@kodex.example'))).toBeTruthy();
  expect(items()[2]!.textContent).not.toMatch(/Portal de proveedores|Correo/);
});

// AC-78: the panel sits on Bandeja and plays what a run call decided as soon as the call returns.
test('Bandeja carries the activity panel and refreshes it after each run call (AC-78)', async () => {
  const { f } = setup({ 'POST /api/invoices/run': batch({ PAGAR: 1 }) });
  await screen.findByRole('heading', { name: 'Actividad del agente' });
  const before = calls(f, 'GET', '/api/agent/activity').length;
  fireEvent.click(screen.getByRole('button', { name: 'Ejecutar agente' }));
  await waitFor(() => expect(calls(f, 'GET', '/api/agent/activity').length).toBe(before + 1));
});

// AC-91 item 1 (Task 29 review): «Correo de cuentasporcobrar@distribuidoracolombiana.com.co» or a long payee made the page scroll sideways.
test('a table cell wraps a long unbreakable sender or payee', async () => {
  const { readFileSync } = (await import('node:fs' as string)) as { readFileSync(p: string, enc: string): string };
  expect(readFileSync('web/dashboard/dashboard.css', 'utf8')).toMatch(/\n\.dash-table td \{[^}]*overflow-wrap: anywhere/);
});

// UX-23 (AC-91 item 6): one primary per view. With the form open «Enviar al agente» is it; «Ejecutar agente» steps back.
test('opening «Nueva factura» demotes «Ejecutar agente» to secondary; closing it restores it', async () => {
  setup();
  await screen.findByText(/supera el umbral/);
  const primaries = () => screen.getAllByRole('button').filter((b) => b.classList.contains('primary')).map((b) => b.textContent);
  open();
  expect(primaries()).toEqual(['Enviar al agente']);
  open();
  expect(primaries()).toEqual(['Ejecutar agente']);
});

// AC-98: one data request on load; the activity poll (AC-78) is off the critical path.
test('Bandeja loads its data with one request to /api/screen/inbox in the tab language', async () => {
  const { f } = setup();
  await screen.findByText(/supera el umbral/);
  const data = f.mock.calls.map(([u]) => String(u)).filter((u) => u !== '/api/config' && u !== '/api/agent/activity');
  expect(data).toEqual(['/api/screen/inbox?lang=es']);
});

// AC-99 (R-109): while it loads, the dashboard and the table are drawn in the loaded markup with placeholder data, hidden; the last-run line too.
test('while loading, the dashboard, the table and the last-run line are a skeleton with the loaded markup', () => {
  const { view } = setup({ 'GET /api/invoices': () => new Promise(() => {}) });
  const skeletons = [...view.container.querySelectorAll<HTMLElement>('.skeleton:not(.inbox-last-run)')];
  expect(skeletons.map((s) => [s.getAttribute('aria-hidden'), s.hasAttribute('inert')])).toEqual([['true', true], ['true', true]]);
  expect(skeletons[0]!.querySelector('.dash-kpis')).not.toBeNull();
  expect(skeletons[1]!.querySelectorAll('tbody tr a').length).toBeGreaterThan(0);
  expect(view.container.querySelector('.inbox-last-run.skeleton')).not.toBeNull();
});

test('the skeleton is gone once the rows arrive', async () => {
  const { view } = setup();
  await screen.findByText(/supera el umbral/);
  expect(view.container.querySelector('.skeleton')).toBeNull();
});

// AC-91 item 5 (gate 5.mixed/5.locale): the hidden loading rows speak the tab's language.
test('the loading table rows are in the tab language', () => {
  localStorage.setItem('lang', 'en');
  const { view } = setup({ 'GET /api/invoices': () => new Promise(() => {}) });
  const body = view.container.querySelector('.skeleton .dash-table tbody')!.textContent!;
  expect(body).toContain('the agent has not decided it yet');
  expect(body).not.toMatch(/PAGAR|dentro de reglas/);
});

// AC-91 item 6 (AC-53 Clarified): the pending chip uses an approved palette colour.
test('the pending chip background is in the palette', async () => {
  const { readFileSync } = (await import('node:fs' as string)) as { readFileSync(p: string, enc: string): string };
  expect(readFileSync('web/pages/inbox.css', 'utf8')).toMatch(/\n\.chip-pending \{ background: #f1efe9;/);
});

// AC-107 (R-143, R-145): the first-login pass runs on Bandeja after landing, in view.
const PENDING = [row('p1', null, 'Nubia Diseño', null), row('p2', null, 'Kodex Labs', null)];
const STILL = 'Thesaurus todavía está decidiendo 2 facturas; lo que necesite tu respuesta aparecerá aquí.';

test('the shell\'s pass shows its progress sentence in RunProgress\'s place, keeps «Ejecutar agente» busy as the same run, then its summary (AC-107)', async () => {
  let release: (v: unknown) => void = () => {};
  const { f } = setup({ 'POST /api/invoices/run': () => (calls(f, 'POST', '/api/invoices/run').length === 1
    ? batch({ PAGAR: 5, remaining: 24, cursor: 'c1' }) : new Promise((r) => (release = r))) }, DASH, true);
  expect(await screen.findByText('Decidiendo tus facturas pendientes… 5 de 29. Las cifras se actualizan con cada decisión.')).toBeTruthy();
  const run = screen.getByRole('button', { name: 'Ejecutar agente' }) as HTMLButtonElement;
  expect([run.disabled, run.getAttribute('aria-busy')]).toEqual([true, 'true']);
  fireEvent.click(run);
  expect(calls(f, 'POST', '/api/invoices/run')).toHaveLength(2); // one loop per tab
  release(batch({ PAGAR: 20, FRENAR: 3, ESCALAR: 1 }));
  expect(await screen.findByText('25 PAGAR · 3 FRENAR · 1 ESCALAR')).toBeTruthy();
  expect(screen.queryByText(/Decidiendo tus facturas/, { ignore: '.run-ghost' })).toBeNull(); // the hidden line only holds the box
  expect(run.disabled).toBe(false);
});

test('each call of the pass refreshes the screen data with one screen request in flight, a first load slower than the calls included, and the last answer shows the end state (AC-107)', async () => {
  let decided = 0;
  let inFlight = 0;
  let most = 0;
  const held: Array<() => void> = []; // each screen request answers when the test says so, with the state it left with
  const { f } = setup({
    'POST /api/invoices/run': () => {
      decided++;
      return batch({ PAGAR: 1, remaining: 2 - decided, cursor: decided < 2 ? `c${decided}` : null });
    },
    'GET /api/invoices': async () => {
      most = Math.max(most, ++inFlight);
      const seen = decided;
      await new Promise<void>((r) => held.push(r));
      inFlight--;
      return PENDING.map((r, i) => (i < seen ? { ...r, outcome: 'PAGAR', headline: `PAGAR · ${r.fields.payee_name}` } : r));
    },
  }, DASH, true);
  expect(await screen.findByText('2 PAGAR · 0 FRENAR · 0 ESCALAR')).toBeTruthy(); // both calls answered while the first load is out
  expect(held).toHaveLength(1);
  held.shift()!();
  await waitFor(() => expect(held).toHaveLength(1)); // then one refresh, for both calls
  expect(items().map((r) => within(r).getByText('Pendiente'))).toHaveLength(2); // the first load's older state, for now
  held.shift()!();
  await waitFor(() => expect(within(table()).getAllByText('PAGAR')).toHaveLength(2));
  await new Promise((r) => setTimeout(r, 50));
  expect(most).toBe(1);
  expect(screenCalls(f)).toHaveLength(2);
});

test('a failed call of the pass stops it with the response text; the rows stay «Pendiente» and Bandeja stays usable (AC-107, AC-40)', async () => {
  setup({ 'GET /api/invoices': PENDING,
    'POST /api/invoices/run': new Response(JSON.stringify({ error: 'El agente no está disponible ahora.' }), { status: 500 }) }, DASH, true);
  expect((await screen.findByText('El agente no está disponible ahora.')).getAttribute('role')).toBe('alert');
  expect(items().map((r) => within(r).getByText('Pendiente'))).toHaveLength(2);
  expect((screen.getByRole('button', { name: 'Ejecutar agente' }) as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByRole('button', { name: 'Nueva factura' }) as HTMLButtonElement).disabled).toBe(false);
});

test('a seeded row with an expected PAGAR and no decision renders «Pendiente», never the prediction (R-122, AC-16)', async () => {
  setup({ 'GET /api/invoices': [{ ...row('s1', null, 'Nubia Diseño', null), expected_outcome: 'PAGAR' }] });
  await screen.findByText(sentence('Nubia Diseño · el agente aún no la ha decidido'));
  expect(within(items()[0]!).getByText('Pendiente')).toBeTruthy();
  expect(within(items()[0]!).queryByText('PAGAR')).toBeNull();
});

test('during the pass an empty «Necesita tu respuesta» and «Vence pronto» say Thesaurus is still deciding <n>; after it, their own empty text (AC-107, R-145)', async () => {
  let release: (v: unknown) => void = () => {};
  setup({ 'GET /api/invoices': PENDING, 'POST /api/invoices/run': () => new Promise((r) => (release = r)) }, EMPTY_DASH, true);
  expect(await screen.findAllByText(STILL)).toHaveLength(2);
  expect(screen.queryByText('Nada espera tu respuesta.')).toBeNull();
  release(batch({ FRENAR: 2 }));
  expect(await screen.findByText('Nada espera tu respuesta.')).toBeTruthy();
  expect(screen.getByText('Nada vence en los próximos 7 días.')).toBeTruthy();
  expect(screen.queryByText(STILL)).toBeNull();
});

// Part B 2 (Task 52c): before the first call answers the line already counts the «Pendiente» rows; before the data, its box is empty.
test('from its first paint the pass line reads «0 de <pending rows>»; until the data is there its box is reserved and empty (AC-107)', async () => {
  let give: ((v: unknown) => void) | undefined;
  const { view } = setup({ 'GET /api/invoices': () => new Promise((r) => (give = r)), 'POST /api/invoices/run': () => new Promise(() => {}) }, DASH, true);
  await waitFor(() => expect(give && view.container.querySelector('.run-box')).toBeTruthy());
  expect(view.container.querySelectorAll('.run-box > :not(.run-ghost)')).toHaveLength(0);
  give!([...PENDING, ROWS[0]]);
  const line = await screen.findByText('Decidiendo tus facturas pendientes… 0 de 2. Las cifras se actualizan con cada decisión.');
  expect(line.className).not.toMatch(/run-ghost/);
  expect(screen.queryByText(/0 de …/)).toBeNull();
});

test('in English, the progress sentence and the still-deciding text (AC-107)', async () => {
  localStorage.setItem('lang', 'en');
  setup({ 'GET /api/invoices': PENDING, 'POST /api/invoices/run': () => new Promise(() => {}) }, EMPTY_DASH, true);
  expect(await screen.findByText('Deciding your pending invoices… 0 of 2. The figures update with each decision.')).toBeTruthy();
  expect(await screen.findAllByText('Thesaurus is still deciding 2 invoices; anything that needs your answer will appear here.')).toHaveLength(2);
});

test('during the pass rows keep their order, even when the server lists ties differently, and hold their box (AC-107, R-145)', async () => {
  let n = 0;
  let release: (v: unknown) => void = () => {};
  const tied = [row('k2', null, 'Kodex Labs', null), row('k1', null, 'Nubia Diseño', null)];
  const { view } = setup({
    'GET /api/invoices': () => (n++ === 0 ? tied : [{ ...tied[1]!, outcome: 'PAGAR', headline: 'PAGAR · Nubia Diseño' }, tied[0]!]),
    'POST /api/invoices/run': () => new Promise((r) => (release = r)),
  }, DASH, true);
  await screen.findByText(sentence('Kodex Labs · el agente aún no la ha decidido'));
  const before = items().map((r) => r.dataset.id);
  release(batch({ PAGAR: 1 }));
  await screen.findByText('PAGAR · Nubia Diseño');
  expect(items().map((r) => r.dataset.id)).toEqual(before);
  expect(view.container.querySelector('.inbox.inbox-held')).not.toBeNull(); // the growing sections and the rows keep their box
  expect(within(items()[0]!).getByRole('link').className).toBe('dash-headline');
});

test('with no pass in this tab, Bandeja holds no boxes and shows no pass line', async () => {
  const { view } = setup();
  await screen.findByText(/supera el umbral/);
  expect(view.container.querySelector('.inbox-held')).toBeNull();
  expect(screen.queryByText(/Decidiendo tus facturas/)).toBeNull();
});
