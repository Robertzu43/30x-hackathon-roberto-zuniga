import { fireEvent, screen, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { routes } from './App';
import Beneficiaries from './pages/Beneficiaries';
import Beneficiary from './pages/Beneficiary';
import { mockApi, renderAt } from './test/utils';

const laura = {
  id: 'b1', name: 'Laura Méndez', country: 'CO', currency: 'USD', bank_account: 'Bancolombia ahorros 0012-3456-4821',
  route: 'COP · transferencia', category: 'Desarrollo', agreement: { type: 'retainer', amount_usd: 2500, period: 'monthly' },
};
const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status });
const body = (init: RequestInit) => JSON.parse(String(init.body));
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Guardar beneficiario' }));
const calls = (f: ReturnType<typeof mockApi>, method: string, path: string) => f.mock.calls.filter(([u, i]) => u === path && (i?.method ?? 'GET') === method);

function setup(extra: Record<string, unknown> = {}) {
  const f = mockApi({ 'GET /api/screen/beneficiaries': { beneficiaries: [laura] }, ...extra }); // AC-98
  const view = renderAt(<Beneficiaries />);
  return { f, view };
}

test('/beneficiaries is in the nav after Política, with its tour anchor present before data loads', () => {
  expect(routes.filter((r) => r.nav).map((r) => r.path)).toEqual(['/', '/policy', '/beneficiaries', '/period']);
  expect(routes.find((r) => r.path === '/beneficiaries')?.nav).toBe('screen.beneficiaries');
  const { view } = setup();
  expect(view.container.querySelector('[data-tour="beneficiaries"]')).toBeTruthy();
});

test('lists the directory with route and agreement, and offers the seven Blinka routes (AC-33)', async () => {
  setup();
  const row = (await screen.findByText('Laura Méndez')).closest('tr')!;
  expect(within(row).getByText('COP · transferencia')).toBeTruthy();
  expect(within(row).getByText(/Fijo mensual \(retainer\)/)).toBeTruthy();
  const options = within(screen.getByLabelText('Ruta de pago')).getAllByRole('option').map((o) => o.textContent);
  expect(options).toEqual(['Sin ruta', 'ACH', 'Wire', 'SWIFT', 'Pix', 'CBU', 'Transferencia COP', 'USDC']);
});

test('the form creates a beneficiary: POST with the typed data, list reloaded, link to Reevaluar (AC-33)', async () => {
  let gets = 0;
  const { f } = setup({
    'GET /api/screen/beneficiaries': () => ({ beneficiaries: ++gets === 1 ? [laura] : [laura, { ...laura, id: 'b2', name: 'Pixel Lab' }] }),
    'POST /api/beneficiaries': (init: RequestInit) => ({ id: 'b2', ...body(init) }),
  });
  await screen.findByText('Laura Méndez');
  type('Nombre', 'Pixel Lab');
  type('País (2 letras, ej. CO)', 'br');
  type('Moneda (3 letras, ej. COP)', 'USD');
  type('Cuenta bancaria (simulada)', 'Pix chave 11 98765-4302');
  type('Ruta de pago', 'Pix');
  type('Categoría', 'Diseño');
  type('Tipo de acuerdo', 'retainer');
  type('Monto del acuerdo (USD)', '1800');
  type('Periodicidad', 'monthly');
  submit();
  expect(await screen.findByText(/Beneficiario guardado/)).toBeTruthy();
  expect(body(calls(f, 'POST', '/api/beneficiaries')[0]![1]!)).toEqual({
    name: 'Pixel Lab', country: 'BR', currency: 'USD', bank_account: 'Pix chave 11 98765-4302', route: 'Pix', category: 'Diseño',
    agreement: { type: 'retainer', amount_usd: 1800, period: 'monthly' },
  });
  expect(await screen.findByText('Pixel Lab', { selector: 'td [data-user]' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Política' }).getAttribute('href')).toBe('/policy');
  expect((screen.getByLabelText('Nombre') as HTMLInputElement).value).toBe('');
});

test('blank optional boxes are sent as null and no agreement type means no agreement', async () => {
  const { f } = setup({ 'POST /api/beneficiaries': { id: 'b2' } });
  await screen.findByText('Laura Méndez');
  type('Nombre', '  Pixel Lab ');
  submit();
  await screen.findByText(/Beneficiario guardado/);
  expect(body(calls(f, 'POST', '/api/beneficiaries')[0]![1]!)).toEqual({
    name: 'Pixel Lab', country: null, currency: null, bank_account: null, route: null, category: null, agreement: null,
  });
});

test('a 400 with a field shows the API text and marks that input (AC-33)', async () => {
  setup({ 'POST /api/beneficiaries': json({ error: 'Revisa el beneficiario: hay un dato no válido', field: 'country' }, 400) });
  await screen.findByText('Laura Méndez');
  type('Nombre', 'Pixel Lab');
  type('País (2 letras, ej. CO)', 'Brasil');
  submit();
  expect((await screen.findByRole('alert')).textContent).toContain('Revisa el beneficiario');
  expect(screen.getByLabelText('País (2 letras, ej. CO)').getAttribute('aria-invalid')).toBe('true');
  expect(screen.getByLabelText('Nombre').getAttribute('aria-invalid')).toBeNull();
});

test('Editar loads a row into the form, keeps a route outside the list, and saves with PUT (AC-33)', async () => {
  const { f } = setup({ 'PUT /api/beneficiaries/b1': (init: RequestInit) => ({ id: 'b1', ...body(init) }) });
  fireEvent.click(await screen.findByRole('button', { name: 'Editar Laura Méndez' }));
  expect((screen.getByLabelText('Nombre') as HTMLInputElement).value).toBe('Laura Méndez');
  expect((screen.getByLabelText('Ruta de pago') as HTMLInputElement).value).toBe('COP · transferencia');
  type('Monto del acuerdo (USD)', '2600');
  submit();
  await screen.findByText(/Beneficiario guardado/);
  expect(body(calls(f, 'PUT', '/api/beneficiaries/b1')[0]![1]!)).toEqual({
    name: 'Laura Méndez', country: 'CO', currency: 'USD', bank_account: 'Bancolombia ahorros 0012-3456-4821', route: 'COP · transferencia',
    category: 'Desarrollo', agreement: { type: 'retainer', amount_usd: 2600, period: 'monthly' },
  });
});

test('an empty directory says what to do next, and the button takes you to the form (UX-14)', async () => {
  setup({ 'GET /api/screen/beneficiaries': { beneficiaries: [] } });
  expect(await screen.findByText('Todavía no hay beneficiarios. Agrega el primero con el formulario de abajo.')).toBeTruthy();
  expect(screen.queryByRole('table')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Agregar beneficiario' }));
  expect(document.activeElement).toBe(screen.getByLabelText('Nombre'));
});

test('Editar brings the form into view and puts the cursor in it (UX-15)', async () => {
  setup();
  const scrolled: Element[] = [];
  vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element) { scrolled.push(this); });
  fireEvent.click(await screen.findByRole('button', { name: 'Editar Laura Méndez' }));
  expect(scrolled.some((el) => el.contains(screen.getByRole('heading', { name: 'Editar Laura Méndez' })))).toBe(true);
  expect(document.activeElement).toBe(screen.getByLabelText('Nombre'));
});

test('Save is busy at once while the request runs (UX-16)', async () => {
  let answer: (r: Response) => void = () => {};
  setup({ 'POST /api/beneficiaries': () => new Promise<Response>((r) => { answer = r; }) });
  await screen.findByText('Laura Méndez');
  type('Nombre', 'Pixel Lab');
  submit();
  const button = await screen.findByRole('button', { name: 'Guardando…' });
  expect(button.hasAttribute('disabled')).toBe(true);
  expect(button.getAttribute('aria-busy')).toBe('true');
  answer(new Response(JSON.stringify({ id: 'b2' }), { status: 201 }));
  expect(await screen.findByRole('button', { name: 'Guardar beneficiario' })).toBeTruthy();
});

test('the date of an agreement is typed in a field labelled in the app language, not the browser date widget (UX-19)', async () => {
  setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Editar Laura Méndez' }));
  const date = screen.getByLabelText('Vigente hasta') as HTMLInputElement;
  expect(date.type).toBe('text');
  expect(date.placeholder).toBe('AAAA-MM-DD');
});

test('the directory table scroll region is reachable by keyboard and named (UX-22)', async () => {
  setup();
  const region = await screen.findByRole('region', { name: 'Directorio de beneficiarios' });
  expect(region.tabIndex).toBe(0);
  expect(within(region).getByRole('table')).toBeTruthy();
});

// AC-99 (R-109): while the directory loads, the table is drawn with placeholder rows in the loaded markup, hidden.
test('while loading, the directory table is a skeleton with the loaded markup', () => {
  const { view } = setup({ 'GET /api/screen/beneficiaries': () => new Promise(() => {}) });
  const table = view.container.querySelector('.skeleton') as HTMLElement;
  expect(table.tagName).toBe('TABLE');
  expect(table.getAttribute('aria-hidden')).toBe('true');
  expect(table.hasAttribute('inert')).toBe(true);
  expect(table.querySelectorAll('tbody tr').length).toBeGreaterThan(0);
  expect(screen.getByRole('status').textContent).toBe('Cargando…');
});

test('a failed load says so; the skeleton goes away', async () => {
  const { view } = setup({ 'GET /api/screen/beneficiaries': json({ error: 'boom' }, 500) });
  expect((await screen.findByRole('alert')).textContent).toBe('No pude cargar los beneficiarios. Recarga la página.');
  expect(view.container.querySelector('.skeleton')).toBeNull();
});

// AC-104: the profile at /beneficiaries/:id, on the contract of GET /api/screen/beneficiary/:id.
const profile = {
  beneficiary: { ...laura, id: 'b1' },
  totals: { paid_month_usd: 2500, paid_total_usd: 7500, invoices: 4 },
  history: [{ received_at: '2026-08-02T15:00:00Z', amount_usd: 2500 }, { received_at: '2026-09-02T15:00:00Z', amount_usd: 2500 }, { received_at: '2026-10-02T15:00:00Z', amount_usd: 2500 }],
  last: [
    { invoice_id: 'i4', received_at: '2026-10-14T15:00:00Z', amount: 2500, currency: 'USD', outcome: 'PAGAR' },
    { invoice_id: 'i3', received_at: '2026-10-10T15:00:00Z', amount: 9000, currency: 'USD', outcome: 'ESCALAR' },
    { invoice_id: 'i2', received_at: '2026-10-05T15:00:00Z', amount: 2500, currency: 'USD', outcome: null },
  ],
};
const at = (extra: Record<string, unknown>) => {
  mockApi(extra);
  return renderAt(<Beneficiary />, { at: '/beneficiaries/b1', route: '/beneficiaries/:id' });
};

test('the profile shows who, the route, the account tail, the agreement in words, totals, the sparkline and the last invoices (AC-104)', async () => {
  const view = at({ 'GET /api/screen/beneficiary/b1': profile });
  expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('Laura Méndez');
  expect(view.container.querySelector('h1 [data-user], h1[data-user]')).toBeTruthy();
  expect(screen.getByText('COP · transferencia')).toBeTruthy();
  expect(screen.getByText(/Cuenta terminada en/).textContent).toContain('4821');
  expect(screen.getByText(/Cuenta terminada en/).textContent).not.toContain('0012');
  expect(screen.getByText(/Fijo mensual \(retainer\), 2\.500 USD, cada mes/)).toBeTruthy();
  expect(await screen.findByLabelText(/Pagado este mes: .*2\.500/)).toBeTruthy();
  expect(await screen.findByLabelText(/Pagado en total: .*7\.500/)).toBeTruthy();
  expect(await screen.findByLabelText('Facturas: 4')).toBeTruthy();
  expect(await screen.findByLabelText(/Monto de los últimos pagos.*3 valores/)).toBeTruthy();
  const chips = screen.getAllByRole('link', { name: /PAGAR|ESCALAR|Pendiente/ });
  expect(chips.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([['PAGAR', '/invoices/i4'], ['ESCALAR', '/invoices/i3'], ['Pendiente', '/invoices/i2']]);
  expect(screen.getByRole('link', { name: 'Volver a Beneficiarios' }).getAttribute('href')).toBe('/beneficiaries');
});

test.each([['es', 'Últimas facturas'], ['en', 'Latest invoices']])('the last invoices heading names no count, which can be fewer than 5 (%s, R-166)', async (lang, heading) => {
  localStorage.setItem('lang', lang);
  at({ 'GET /api/screen/beneficiary/b1': profile });
  expect(await screen.findByRole('heading', { level: 2, name: heading })).toBeTruthy();
  expect(screen.getByRole('region', { name: heading })).toBeTruthy();
});

test('each directory row links its name to the profile at /beneficiaries/:id, and the route table mounts it there (AC-104)', async () => {
  setup();
  const link = await screen.findByRole('link', { name: 'Laura Méndez' });
  expect(link.getAttribute('href')).toBe('/beneficiaries/b1');
  expect(link.closest('[data-user]')).toBeNull(); // R-131: a link never sits inside a user-data marker
  expect(link.querySelector('[data-user]')?.textContent).toBe('Laura Méndez');
  expect((await routes.find((r) => r.path === '/beneficiaries/:id')!.load()).default).toBe(Beneficiary);
});

test('no invoices says so and what to do next, never a blank chart (AC-104 empty state)', async () => {
  at({ 'GET /api/screen/beneficiary/b1': { ...profile, totals: { paid_month_usd: 0, paid_total_usd: 0, invoices: 0 }, history: [], last: [] } });
  expect(await screen.findByText('Todavía no hay pagos a este beneficiario.')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Ir a la Bandeja' }).getAttribute('href')).toBe('/');
  expect(screen.getByRole('link', { name: 'Volver a Beneficiarios' })).toBeTruthy();
});

test('another company\'s id (404) and a failed load each get their designed message with a way out (AC-104)', async () => {
  at({ 'GET /api/screen/beneficiary/b1': json({ error: 'Beneficiario no encontrado' }, 404) });
  expect(await screen.findByText('No encontré este beneficiario.')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Volver a Beneficiarios' })).toBeTruthy();
  expect(screen.queryByText('Beneficiario no encontrado')).toBeNull();
});

test('a 500 offers a retry that loads the profile (AC-91 item 4)', async () => {
  let n = 0;
  at({ 'GET /api/screen/beneficiary/b1': () => (++n === 1 ? json({ error: 'boom' }, 500) : profile) });
  expect((await screen.findByRole('alert')).textContent).toContain('No pude cargar');
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('Laura Méndez');
});

// AC-99 (R-109): while the profile loads, the loaded markup is drawn from a made-up profile, hidden from people and assistive tech.
test('while loading, the profile is a skeleton with the loaded markup and one status line (AC-99)', () => {
  const { container } = at({ 'GET /api/screen/beneficiary/b1': () => new Promise(() => {}) });
  const skeleton = container.querySelector('.skeleton') as HTMLElement;
  expect(skeleton.getAttribute('aria-hidden')).toBe('true');
  expect(skeleton.hasAttribute('inert')).toBe(true);
  expect(skeleton.querySelector('h1')).toBeTruthy();
  expect(skeleton.querySelector('.beneficiary-totals')).toBeTruthy();
  expect(skeleton.querySelector('table')).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe('Cargando…');
  expect(screen.getByRole('link', { name: 'Volver a Beneficiarios' })).toBeTruthy();
});
