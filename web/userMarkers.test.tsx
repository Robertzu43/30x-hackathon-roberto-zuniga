// R-131 (AC-91 item 5, Clarified): the web marks user data with `data-user` on the innermost element whose whole text is data,
// and never on copy. One representative data node and one copy node per screen family; the structural rule (5.marker (a)) on all.
import { fireEvent, screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { expect, test } from 'vitest';
import NewInvoice from './components/NewInvoice';
import Approve from './pages/Approve';
import Beneficiaries from './pages/Beneficiaries';
import Inbox from './pages/Inbox';
import InvoiceDetail from './pages/InvoiceDetail';
import Period from './pages/Period';
import Policy from './pages/Policy';
import { mockApi, renderAt, signedInAs } from './test/utils';

const marked = (el: Element) => el.hasAttribute('data-user');
const text = (s: string, root: Element = document.body) =>
  [...root.querySelectorAll('*')].filter((e) => e.children.length === 0 || [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent!.includes(s)))
    .find((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent!.includes(s)))!;
// 5.marker (a): a marked element never holds a control or a heading.
const noMisuse = (root: Element = document.body) => {
  for (const el of root.querySelectorAll('[data-user]')) expect(el.querySelector('button,a,input,select,textarea,label,h1,h2,h3,h4,h5,h6'), el.outerHTML).toBeNull();
};

test('Bandeja: payee option, sender and pending payee are marked; headline, origin copy and filters are not; the ask box marks the question', async () => {
  signedInAs('ana@empresa.co');
  const row = (id: string, outcome: string | null, payee: string | null, headline: string | null, extra = {}) =>
    ({ id, outcome, headline, received_at: '2026-10-10T15:00:00Z', fields: { payee_name: payee }, ...extra });
  mockApi({
    'GET /api/invoices': [row('a1', 'PAGAR', 'Nubia Diseño', 'PAGAR · 1.200 USD a Nubia Diseño, dentro de reglas', { origin: 'email', sender: 'cobros@nubia.co' }),
      row('c3', null, 'Kodex Labs', null)],
    'GET /api/agent/last-run': null, 'GET /api/portal-link': { portal_url: 'https://p.example/andina', email_address: 'in@andina.example' }, 'GET /api/agent/activity': { items: [] },
  });
  const { container } = renderAt(<Inbox />);
  await screen.findByText(/dentro de reglas/);
  expect(marked(within(screen.getByLabelText('Beneficiario')).getByRole('option', { name: 'Nubia Diseño' }))).toBe(true);
  expect(marked(within(screen.getByLabelText('Beneficiario')).getByRole('option', { name: 'Todos' }))).toBe(false);
  expect(marked(text('cobros@nubia.co'))).toBe(true);
  expect(text('Correo de').textContent).toBe('Correo de cobros@nubia.co'); // the container stays whole and unmarked
  expect(marked(text('Correo de'))).toBe(false);
  expect(marked(text('dentro de reglas'))).toBe(false); // record sentence (R-98)
  expect(marked(text('Kodex Labs', container.querySelector('.inbox-list')!))).toBe(true);
  expect(marked(text('el agente aún no la ha decidido'))).toBe(false);
  expect(marked(screen.getByLabelText('Tu pregunta sobre el registro'))).toBe(true);
  noMisuse(container);
});

test('Detalle: sender note, stored text, read values and snippets, payee and policy name are marked; labels, sentences, amounts and dates are not', async () => {
  signedInAs('ana@empresa.co');
  const decision = { id: 'd1', seq: 1, outcome: 'PAGAR', actor: 'human', actor_email: 'ana@blinka.example', channel: 'dashboard', checks: [], note: 'Aprobada tras llamar',
    policy_version: 1, amount_usd: 4200, payment: { beneficiary: 'Nube Sur LLC', route: 'ACH', currency: 'USD', amount: 4200 }, created_at: '2026-10-16T16:05:00Z' };
  mockApi({ 'GET /api/invoices/inv-1': {
    invoice: { source: 'email', raw_text: 'Hola, adjunto la cuenta de cobro 2044', origin: 'portal', sender_note: 'Pago urgente, por favor',
      fields: { payee_name: 'Nube Sur LLC', amount: 4200, currency: 'USD', invoice_number: '2044', issue_date: '2026-10-01', due_date: '2026-10-31', concept: 'Infraestructura', bank_account: null } },
    headline: 'PAGAR · 4.200 USD a Nube Sur LLC', decisions: [decision], explanations: ['Regla 1: frase → cumple'], fixes: ['Que alguien revise'],
    policy: { name: 'Política general', version: 2, created_at: '2026-10-01T12:00:00Z' }, trace: [{ stage: 'lee', text: 'Leí el correo.' }], question: null, file_url: null,
    reading: { provider: 'Nova', fields: [
      { name: 'payee_name', value: 'Nube Sur LLC', confidence: 0.97, snippet: 'Emisor: Nube Sur LLC, NIT 900', match: [8, 20] },
      { name: 'amount', value: 4200, confidence: 0.9, snippet: 'Total: USD 4,200.00', match: [7, 19] },
      { name: 'due_date', value: '2026-10-31', confidence: 0.6, snippet: null, match: null }] },
    reading_status: 'ai' } });
  const { container } = renderAt(<InvoiceDetail />, { at: '/invoices/inv-1', route: '/invoices/:id' });
  await screen.findByRole('heading', { level: 1 });
  expect(marked(text('Pago urgente'))).toBe(true);
  expect(marked(screen.getByText('Mensaje del proveedor'))).toBe(false);
  expect(marked(text('Hola, adjunto'))).toBe(true); // raw_text
  const read = (label: string) => screen.getAllByText(label, { selector: 'dt' })[0]!.parentElement!;
  expect(marked(read('Beneficiario').querySelector('dd')!)).toBe(true);
  expect(marked(read('Beneficiario').querySelector('.reading-snippet')!)).toBe(true);
  expect(marked(screen.getAllByText('Beneficiario', { selector: 'dt' })[0]!)).toBe(false);
  expect(marked(read('Monto').querySelector('dd')!)).toBe(false); // the app formats the amount (money)
  expect(marked(read('Monto').querySelector('.reading-snippet')!)).toBe(true); // printed as read
  expect(marked(read('Vencimiento').querySelector('dd')!)).toBe(false); // the app formats the date
  expect(marked(read('Vencimiento').querySelector('.reading-snippet')!)).toBe(false); // «No encontré…» is copy
  expect(marked(text('PAGAR · 4.200 USD a Nube Sur LLC', container.querySelector('h1')!.parentElement!))).toBe(false);
  expect(marked(text('Que alguien revise'))).toBe(false);
  expect(marked(text('frase'))).toBe(false);
  expect(marked(text('Leí el correo.'))).toBe(false);
  const policy = text('Política:');
  expect(marked(policy)).toBe(false);
  expect(marked(within(policy as HTMLElement).getByText('Política general'))).toBe(true);
  expect(marked(text('Nube Sur LLC', screen.getByRole('region', { name: 'Orden de pago' })))).toBe(true);
  expect(marked(text('ana@blinka.example', screen.getByRole('list', { name: 'Historial' })))).toBe(true);
  expect(marked(text('Aprobada tras llamar'))).toBe(true);
  expect(marked(text('Nota:'))).toBe(false);
  noMisuse(container);
});

test('Política: version names are marked, version labels and market rates are not', async () => {
  const rules = { per_payment_limit_usd: 5000, approval_threshold_usd: 2500, period_budget_usd: 42000, account_balance_usd: 23000, duplicate_window_days: 30,
    agreement_tolerance_pct: 5, due_grace_days: 3, fx_rates: { COP: 0.000245 }, allowed_beneficiaries_only: true };
  mockApi({ 'GET /api/company': { id: 'c1', name: 'Andina Labs Inc.', approver_email: 'ana@andina.co', lang: 'es', is_demo: false },
    'GET /api/policy': [{ id: 'p2', version: 2, name: 'Política general', rules, created_at: '2026-10-17T10:00:00Z' }],
    'GET /api/fx': { rates: [{ currency: 'COP', usd_per_unit: 0.00024876, units_per_usd: 4020.1, source: 'Yahoo Finance', fetched_at: '2026-10-17T15:00:00Z', stale: false }] } });
  const { container } = renderAt(<Policy />);
  const name = await screen.findByText('Política general', { selector: 'strong' });
  expect(marked(name)).toBe(true);
  expect(marked(name.parentElement!.querySelector('.mono')!)).toBe(false);
  expect(container.querySelector('.fx-table [data-user]')).toBeNull();
  noMisuse(container);
});

test('Beneficiarios: name and category cells are marked, the agreement summary and headings are not; the edit title marks only the name', async () => {
  mockApi({ 'GET /api/beneficiaries': [{ id: 'b1', name: 'Laura Méndez', country: 'CO', currency: 'USD', bank_account: null, route: 'ACH', category: 'Desarrollo',
    agreement: { type: 'retainer', amount_usd: 2500, period: 'monthly' } }] });
  const { container } = renderAt(<Beneficiaries />);
  const row = (await screen.findByText('Laura Méndez')).closest('tr')!;
  expect(marked(within(row).getByText('Laura Méndez'))).toBe(true);
  expect(marked(within(row).getByText('Desarrollo'))).toBe(true);
  expect(marked(within(row).getByText(/Fijo mensual/))).toBe(false);
  expect(marked(screen.getByText('Nombre', { selector: 'th' }))).toBe(false);
  fireEvent.click(within(row).getByRole('button'));
  const title = screen.getByRole('heading', { name: 'Editar Laura Méndez' });
  expect(marked(title)).toBe(false);
  expect(marked(within(title).getByText('Laura Méndez'))).toBe(true);
  noMisuse(container);
});

test('Periodo: the beneficiary name is marked, «sin leer», money and counts are not', async () => {
  const month = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }).slice(0, 7);
  mockApi({ [`GET /api/period?month=${month}`]: { month, budget_usd: 10000, balance_usd: 20000, paid_usd: 1500.5, committed_usd: 5700.5, available_usd: 4299.5,
    count_by_outcome: { PAGAR: 3, FRENAR: 2, ESCALAR: 1 }, autonomy: { n: 18, m: 24 }, autonomy_pct: 75, violations: 0, explained_pct: 100,
    by_beneficiary: [{ beneficiary: 'Nube Sur LLC', paid_usd: 0, committed_usd: 4200, count: 1 }, { beneficiary: null, paid_usd: 1500.5, committed_usd: 1500.5, count: 2 }] } });
  const { container } = renderAt(<Period />, { at: '/period' });
  const rows = (await screen.findByText('Nube Sur LLC')).closest('tbody')!.querySelectorAll('tr');
  expect(marked(within(rows[0]!).getByText('Nube Sur LLC'))).toBe(true);
  expect(marked(rows[1]!.querySelector('td')!)).toBe(false);
  expect(rows[0]!.querySelectorAll('td.num [data-user], td.num[data-user]')).toHaveLength(0);
  expect(container.querySelector('.period-money [data-user]')).toBeNull();
  noMisuse(container);
});

test('Aprobar: payee and invoice number are marked, the formatted amount and the record sentences are not', async () => {
  mockApi({ 'GET /api/approve/tok': { action: 'approve', expires_at: '2026-10-19T12:00:00.000Z',
    invoice: { received_at: '2026-10-16T10:00:00.000Z', fields: { payee_name: 'Nube Sur LLC', amount: 4200, currency: 'USD', invoice_number: 'NS-118' } },
    decision: { seq: 2, amount_usd: 4200, headline_es: 'ESCALAR · 4.200 USD a Nube Sur LLC', headline_en: 'x', question_es: '¿Apruebas?', question_en: 'x',
      checks: [{ id: 'umbral_aprobacion', verdict: 'no_cumple', actual: '4200', threshold: '2500', values: { limit_usd: 2500 } }] } } });
  const { container } = renderAt(
    <Routes><Route path="/approve/:token" element={<Approve />} /></Routes>, { at: '/approve/tok' });
  expect(marked(await screen.findByText('Nube Sur LLC', { selector: 'dd' }))).toBe(true);
  expect(marked(screen.getByText('NS-118'))).toBe(true);
  expect(marked(screen.getByText(/4\.200,00? USD|4\.200 USD/, { selector: 'dd' }))).toBe(false);
  expect(marked(screen.getByText(/^ESCALAR · 4\.200 USD a Nube Sur LLC$/))).toBe(false);
  expect(marked(screen.getByText('Beneficiario', { selector: 'dt' }))).toBe(false);
  noMisuse(container);
});

test('Nueva factura: only the file name is marked, not «Archivo elegido:»', () => {
  const { container } = renderAt(<NewInvoice />);
  fireEvent.change(screen.getByLabelText('Archivo: PDF, PNG o JPG, hasta 10 MB'), { target: { files: [new File(['%PDF'], '01.pdf', { type: 'application/pdf' })] } });
  const name = screen.getByText('01.pdf');
  expect(marked(name)).toBe(true);
  expect(marked(name.parentElement!)).toBe(false);
  expect(name.parentElement!.textContent).toBe('Archivo elegido: 01.pdf');
  noMisuse(container);
});
