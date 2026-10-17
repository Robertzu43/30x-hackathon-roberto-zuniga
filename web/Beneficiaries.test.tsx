import { fireEvent, screen, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import Beneficiaries, { route } from './pages/Beneficiaries';
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
  const f = mockApi({ 'GET /api/beneficiaries': [laura], ...extra });
  const view = renderAt(<Beneficiaries />);
  return { f, view };
}

test('/beneficiaries is in the nav after Política, with its tour anchor present before data loads', () => {
  expect(route).toEqual({ path: '/beneficiaries', nav: { key: 'screen.beneficiaries', order: 30 } });
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
    'GET /api/beneficiaries': () => (++gets === 1 ? [laura] : [laura, { ...laura, id: 'b2', name: 'Pixel Lab' }]),
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
  expect(await screen.findByText('Pixel Lab', { selector: 'td' })).toBeTruthy();
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
  setup({ 'GET /api/beneficiaries': [] });
  expect(await screen.findByText('Todavía no hay beneficiarios. Agrega el primero con el formulario de abajo.')).toBeTruthy();
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
