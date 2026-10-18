import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { dropCache } from './api';
import { routes } from './App';
import { DiffList, RULE_GROUPS, RuleCard, RuleSentence } from './components/PolicyCards';
import Policy from './pages/Policy';
import { mockApi, renderAt } from './test/utils';

// the signed-in user, for the loading card (AC-91 item 4); null session: an ordinary company
const auth = vi.hoisted(() => ({ value: { session: null as unknown, demoEmail: '' } }));
vi.mock('./auth', async (orig) => ({ ...(await orig<typeof import('./auth')>()), useSession: () => auth.value }));

const rules = {
  per_payment_limit_usd: 5000, approval_threshold_usd: 2500, period_budget_usd: 42000, account_balance_usd: 23000,
  duplicate_window_days: 30, agreement_tolerance_pct: 5, due_grace_days: 3,
  fx_rates: { COP: 0.000245, MXN: 0.054, BRL: 0.18, ARS: 0.00095, EUR: 1.08, USD: 1 }, allowed_beneficiaries_only: true,
};
const versions = [
  { id: 'p2', version: 2, name: 'Política general', rules, created_at: '2026-10-17T10:00:00Z' },
  { id: 'p1', version: 1, name: 'Inicial', rules, created_at: '2026-10-16T10:00:00Z' },
];
const company = { id: 'c1', name: 'Andina Labs Inc.', approver_email: 'ana@andina.co', lang: 'es', is_demo: false };
const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status });
const body = (init: RequestInit) => JSON.parse(String(init.body));

const fx = {
  provider: 'yahoo',
  rates: [
    { currency: 'COP', usd_per_unit: 0.00024876, units_per_usd: 4020.1, source: 'Yahoo Finance', fetched_at: '2026-10-17T15:00:00Z', stale: false },
    { currency: 'MXN', usd_per_unit: 0.054, units_per_usd: 18.5185, source: 'open.er-api.com', fetched_at: '2026-10-14T15:00:00Z', stale: true },
  ],
};

// AC-98: Política loads one GET /api/screen/policy. Tests still name its parts by the old endpoints; the mock composes them,
// and any part that fails (a Response) fails the whole screen request.
const PARTS = ['GET /api/policy', 'GET /api/company', 'GET /api/fx'];
function setup(extra: Record<string, unknown> = {}) {
  const all: Record<string, unknown> = { 'GET /api/company': company, 'GET /api/policy': versions, 'GET /api/fx': fx, ...extra };
  const part = async (k: string) => (typeof all[k] === 'function' ? await (all[k] as () => unknown)() : all[k]);
  return mockApi({
    ...Object.fromEntries(Object.entries(all).filter(([k]) => !PARTS.includes(k))),
    'GET /api/screen/policy': async () => {
      const [v, c, r] = await Promise.all(PARTS.map(part));
      const failed = [v, c, r].find((x) => x instanceof Response);
      return failed ?? { policy: (v as unknown[])[0] ?? null, versions: v, company: c, fx: r };
    },
  });
}
const limit = () => screen.findByLabelText('Límite por pago (USD)') as Promise<HTMLInputElement>;
const save = () => fireEvent.click(screen.getByRole('button', { name: /^Guardar como versión/ }));

test('/policy is in the nav after Bandeja, with its tour anchor present before data loads', () => {
  expect(routes.filter((r) => r.nav).map((r) => r.path).indexOf('/policy')).toBe(1);
  expect(routes.find((r) => r.path === '/policy')?.nav).toBe('screen.policy');
  setup();
  const { container } = renderAt(<Policy />);
  expect(container.querySelector('[data-tour="policy"]')).toBeTruthy();
});

test('shows every rule of the latest version, the five pin rows and "Guardar como versión 3" (AC-30)', async () => {
  setup();
  renderAt(<Policy />);
  expect((await limit()).value).toBe('5000');
  for (const l of ['Umbral de aprobación (USD)', 'Presupuesto del periodo (USD)', 'Saldo de la cuenta (USD)', 'Ventana de duplicados (días)', 'Tolerancia del acuerdo (%)', 'Días de gracia de vencimiento'])
    expect(screen.getByLabelText(l)).toBeTruthy();
  expect((screen.getByLabelText('Pagar solo a beneficiarios permitidos') as HTMLInputElement).checked).toBe(true);
  for (const c of ['COP', 'MXN', 'BRL', 'ARS', 'EUR']) expect(screen.getByLabelText(`1 ${c} en USD`)).toBeTruthy();
  expect((screen.getByLabelText('1 COP en USD') as HTMLInputElement).value).toBe('0.000245');
  expect(screen.getByRole('button', { name: 'Guardar como versión 3' })).toBeTruthy();
  expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([expect.stringContaining('Política general'), expect.stringContaining('Inicial')]);
});

test('saving with a 1000 payment limit puts the rules, shows the version the database returned and the would-change banner (AC-30, AC-31, R-41)', async () => {
  const f = setup({
    'PUT /api/policy': { policy: { ...versions[0], id: 'p4', version: 4 }, would_change: [{ invoice_id: 'i1', headline: 'Pixel Lab: 4.200 USD supera el límite', from: null, to: 'FRENAR' }, { invoice_id: 'i2', headline: 'Nube Sur', from: 'ESCALAR', to: 'FRENAR' }], will_pay: 0, unread_pending: 0 },
  });
  renderAt(<Policy />);
  fireEvent.change(await limit(), { target: { value: '1000' } });
  save();
  expect(await screen.findByText('Versión 4 guardada.')).toBeTruthy();
  const put = f.mock.calls.find(([u, i]) => u === '/api/policy' && i?.method === 'PUT')!;
  expect(body(put[1]!)).toEqual({ rules: { ...rules, per_payment_limit_usd: 1000 } });
  expect(screen.getByText('Si pulsas «Reevaluar pendientes», el agente decidirá 1 factura(s) pendiente(s) y cambiará el resultado de 1 factura(s) escalada(s):')).toBeTruthy();
  expect(screen.getByText(/Pixel Lab: 4\.200 USD supera el límite/).closest('li')!.textContent).toContain('Pendiente → FRENAR');
});

test('in English the would-change list uses the English outcome words (R-65)', async () => {
  localStorage.setItem('lang', 'en');
  setup({ 'PUT /api/policy': { policy: { ...versions[0], version: 3 }, would_change: [{ invoice_id: 'i2', headline: 'Nube Sur', from: 'ESCALAR', to: 'FRENAR' }] } });
  renderAt(<Policy />);
  fireEvent.change(await screen.findByLabelText('Per-payment limit (USD)'), { target: { value: '1000' } });
  fireEvent.click(screen.getByRole('button', { name: /^Save as version/ }));
  expect((await screen.findByText(/Nube Sur/)).closest('li')!.textContent).toContain('ESCALATE → STOP');
  expect(document.body.textContent).not.toMatch(/PAGAR|FRENAR|ESCALAR/);
});

const toPay = [
  { invoice_id: 'i1', headline: 'Nube Sur', from: 'ESCALAR', to: 'FRENAR' },
  { invoice_id: 'i2', headline: 'Diego Ruiz', from: 'ESCALAR', to: 'PAGAR' },
];
const PAY_ES = /^Si pulsas «Reevaluar pendientes», el agente pagará (\d+) factura\(s\) que hoy no están pagadas, porque con esta política cumplen todas las reglas\.$/;

test('a preview with rows ending in PAGAR says above the list how many the agent will pay (R-61)', async () => {
  setup({ 'PUT /api/policy': { policy: { ...versions[0], version: 3 }, would_change: toPay } });
  renderAt(<Policy />);
  await limit();
  save();
  const line = await screen.findByText(PAY_ES);
  expect(line.textContent!.match(PAY_ES)![1]).toBe('1');
  expect(line.compareDocumentPosition(screen.getByText(/Diego Ruiz/)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByText(/Diego Ruiz/).closest('li')!.textContent).toContain('ESCALAR → PAGAR');
});

test('the count comes from will_pay when the API sends it (R-61)', async () => {
  setup({ 'PUT /api/policy': { policy: { ...versions[0], version: 3 }, would_change: toPay, will_pay: 2 } });
  renderAt(<Policy />);
  await limit();
  save();
  expect((await screen.findByText(PAY_ES)).textContent).toContain('pagará 2 factura(s)');
});

test('no row ends in PAGAR: no payment sentence (R-61)', async () => {
  setup({ 'PUT /api/policy': { policy: { ...versions[0], version: 3 }, would_change: toPay.slice(0, 1), will_pay: 0 } });
  renderAt(<Policy />);
  await limit();
  save();
  await screen.findByText('Si pulsas «Reevaluar pendientes», el agente cambiará el resultado de 1 factura(s) escalada(s):');
  expect(screen.queryByText(/el agente pagará/)).toBeNull();
});

test('the payment sentence in English (R-61)', async () => {
  localStorage.setItem('lang', 'en');
  setup({ 'PUT /api/policy': { policy: { ...versions[0], version: 3 }, would_change: toPay } });
  renderAt(<Policy />);
  await screen.findByLabelText('Per-payment limit (USD)');
  fireEvent.click(screen.getByRole('button', { name: /^Save as version/ }));
  expect(await screen.findByText('If you press "Re-evaluate pending", the agent will pay 1 invoice(s) that are not paid today, because under this policy they pass every rule.')).toBeTruthy();
});

test('an empty rule is sent as null and a version name is sent when typed (AC-18)', async () => {
  const f = setup({ 'PUT /api/policy': { policy: { ...versions[0], version: 3 }, would_change: [] } });
  renderAt(<Policy />);
  fireEvent.change(await limit(), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Nombre de la versión'), { target: { value: 'Tope bajo' } });
  save();
  expect(await screen.findByText('Ninguna factura pendiente cambiaría de resultado')).toBeTruthy();
  const put = f.mock.calls.find(([, i]) => i?.method === 'PUT')!;
  expect(body(put[1]!)).toMatchObject({ name: 'Tope bajo', rules: { per_payment_limit_usd: null } });
});

test('a 400 shows the API text and marks the field that failed, with no banner (AC-30)', async () => {
  setup({ 'PUT /api/policy': json({ error: 'Valor no válido: los montos y los días deben ser números mayores o iguales a 0, y las tasas mayores que 0', field: 'per_payment_limit_usd' }, 400) });
  renderAt(<Policy />);
  fireEvent.change(await limit(), { target: { value: '-5' } });
  save();
  expect((await screen.findByRole('alert')).textContent).toContain('Valor no válido');
  expect((await limit()).getAttribute('aria-invalid')).toBe('true');
  expect(screen.getByLabelText('Umbral de aprobación (USD)').getAttribute('aria-invalid')).toBeNull();
  expect(screen.queryByText(/cambiarían de resultado/)).toBeNull();
});

test('a 409 shows the R-41 text, reloads the versions and keeps what was typed (AC-30, R-41)', async () => {
  let gets = 0;
  setup({
    'GET /api/policy': () => (++gets === 1 ? versions : [{ ...versions[0], id: 'p3', version: 3 }, ...versions]),
    'PUT /api/policy': json({ error: 'Otra versión se guardó al mismo tiempo; recarga y vuelve a intentar' }, 409),
  });
  renderAt(<Policy />);
  fireEvent.change(await limit(), { target: { value: '1000' } });
  save();
  expect(await screen.findByText('Otra versión se guardó al mismo tiempo; recarga y vuelve a intentar')).toBeTruthy();
  expect(await screen.findByRole('button', { name: 'Guardar como versión 4' })).toBeTruthy();
  expect(gets).toBe(2);
  expect((await limit()).value).toBe('1000');
});

test('"Reevaluar pendientes" calls the loop until the cursor ends and sums the batches (AC-31, AC-70)', async () => {
  const f = setup({
    'POST /api/policy/reevaluate': (init: RequestInit) =>
      init.body === undefined
        ? { PAGAR: 1, FRENAR: 1, ESCALAR: 0, errors: 0, remaining: 2, cursor: 'c1' }
        : { PAGAR: 0, FRENAR: 0, ESCALAR: 2, errors: 0, remaining: 0, cursor: null },
  });
  renderAt(<Policy />);
  await limit();
  expect(screen.getByText('Las facturas pagadas o frenadas no se reevalúan; solo las pendientes y escaladas.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Reevaluar pendientes' }));
  expect(await screen.findByText('1 PAGAR · 1 FRENAR · 2 ESCALAR')).toBeTruthy();
  const posts = f.mock.calls.filter(([u, i]) => u === '/api/policy/reevaluate' && i?.method === 'POST');
  expect(posts.map(([, i]) => i?.body)).toEqual([undefined, JSON.stringify({ cursor: 'c1' })]);
});

test('company fields are all disabled for the demo company, with the reason (AC-32, R-31)', async () => {
  setup({ 'GET /api/company': { ...company, is_demo: true } });
  renderAt(<Policy />);
  await waitFor(() => expect((screen.getByLabelText('Nombre de la empresa') as HTMLInputElement).value).toBe('Andina Labs Inc.'));
  for (const l of ['Nombre de la empresa', 'Correo del aprobador', 'Idioma de la empresa']) expect((screen.getByLabelText(l) as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Guardar empresa' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/La empresa demo es de solo lectura/)).toBeTruthy();
});

test('a normal company saves name, approver email and language; a 400 shows its text (AC-32, R-34)', async () => {
  const f = setup({
    'PUT /api/company': (init: RequestInit) =>
      body(init).approver_email === 'x' ? json({ error: 'El correo del aprobador no es válido' }, 400) : { ...company, ...body(init) },
  });
  renderAt(<Policy />);
  const email = (await screen.findByLabelText('Correo del aprobador')) as HTMLInputElement;
  await waitFor(() => expect(email.value).toBe('ana@andina.co'));
  expect(email.disabled).toBe(false);
  fireEvent.change(email, { target: { value: 'x' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar empresa' }));
  expect(await screen.findByText('El correo del aprobador no es válido')).toBeTruthy();
  fireEvent.change(email, { target: { value: 'pagos@andina.co' } });
  fireEvent.change(screen.getByLabelText('Idioma de la empresa'), { target: { value: 'en' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar empresa' }));
  expect(await screen.findByText('Empresa guardada.')).toBeTruthy();
  const puts = f.mock.calls.filter(([u, i]) => u === '/api/company' && i?.method === 'PUT');
  expect(body(puts[1]![1]!)).toEqual({ name: 'Andina Labs Inc.', approver_email: 'pagos@andina.co', lang: 'en' });
});

test.each([
  ['es', 'Correo del aprobador', 'Guardar empresa', 'Las empresas de prueba no envían correos; las escalaciones esperan en el tablero.', 'Empresa guardada.'],
  ['en', 'Approver email', 'Save company', 'Trial companies send no email; escalations wait on the dashboard.', 'Company saved.'],
])('a trial company: the approver field is read-only with why, and a save never sends it (AC-93, R-115) %s', async (lang, label, saveLabel, why, saved) => {
  localStorage.setItem('lang', lang);
  const trial = { ...company, name: 'Empresa de prueba 7', approver_email: null, is_trial: true };
  const f = setup({ 'GET /api/company': trial, 'PUT /api/company': (init: RequestInit) => ({ ...trial, ...body(init) }) });
  renderAt(<Policy />);
  const email = (await screen.findByLabelText(label)) as HTMLInputElement;
  expect(email.readOnly).toBe(true);
  expect(email.value).toBe('');
  expect(screen.getByText(why)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: saveLabel }));
  expect(await screen.findByText(saved)).toBeTruthy();
  const put = f.mock.calls.find(([u, i]) => u === '/api/company' && i?.method === 'PUT')!;
  expect(body(put[1]!)).toEqual({ name: 'Empresa de prueba 7', lang: 'es' });
});

const pending = (n: number, to: string | null = 'PAGAR') => Array.from({ length: n }, (_, i) => ({ invoice_id: `p${i}`, headline: `Factura ${i}`, from: null, to }));
const put = (r: Record<string, unknown>) => setup({ 'PUT /api/policy': { policy: { ...versions[0], version: 3 }, will_pay: 0, unread_pending: 0, ...r } });
const saveEs = async () => { renderAt(<Policy />); await limit(); save(); };
const saveEn = async () => {
  localStorage.setItem('lang', 'en');
  renderAt(<Policy />);
  await screen.findByLabelText('Per-payment limit (USD)');
  fireEvent.click(screen.getByRole('button', { name: /^Save as version/ }));
};

test('only pending rows: the header counts them, the PAGAR sentence follows, and all 29 rows read "Pendiente → result" (R-68)', async () => {
  put({ would_change: [...pending(8, 'PAGAR'), ...pending(21, 'FRENAR')], will_pay: 8 });
  await saveEs();
  const header = await screen.findByText('Si pulsas «Reevaluar pendientes», el agente decidirá 29 factura(s) pendiente(s):');
  const pay = screen.getByText(PAY_ES);
  expect(pay.textContent).toContain('pagará 8 factura(s)');
  expect(header.compareDocumentPosition(pay) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const rows = screen.getAllByRole('listitem').filter((li) => /^Factura /.test(li.textContent!));
  expect(rows).toHaveLength(29);
  expect(rows.filter((r) => /Pendiente → PAGAR(Cumple todas las reglas\.)?$/.test(r.textContent!))).toHaveLength(8);
  expect(rows.filter((r) => /Pendiente → FRENAR$/.test(r.textContent!))).toHaveLength(21);
  expect(document.body.textContent).not.toMatch(/outcome\.|null/);
});

test('pending and escalated rows: the mixed header (R-68)', async () => {
  put({ would_change: [...pending(2, 'FRENAR'), { invoice_id: 'e', headline: 'Nube Sur', from: 'ESCALAR', to: 'FRENAR' }] });
  await saveEs();
  expect(await screen.findByText('Si pulsas «Reevaluar pendientes», el agente decidirá 2 factura(s) pendiente(s) y cambiará el resultado de 1 factura(s) escalada(s):')).toBeTruthy();
});

test('no pending rows and no escalated rows: the empty-list text and no list (R-68)', async () => {
  put({ would_change: [] });
  await saveEs();
  expect(await screen.findByText('Ninguna factura pendiente cambiaría de resultado')).toBeTruthy();
  expect(screen.queryByText(/Si pulsas/)).toBeNull();
});

test('a pending row with no read fields says it is decided once read, and the unread sentence follows the PAGAR sentence (R-68)', async () => {
  put({ would_change: [...pending(1, 'PAGAR'), ...pending(2, null)], will_pay: 1, unread_pending: 2 });
  await saveEs();
  expect(await screen.findAllByText(/Pendiente → se decidirá al leerla$/)).toHaveLength(2);
  const note = screen.getByText('2 factura(s) pendiente(s) aún no se han leído: el agente las leerá al reevaluar, y su resultado puede cambiar el de las facturas que llegaron después.');
  expect(screen.getByText(PAY_ES).compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(note.compareDocumentPosition(screen.getAllByRole('listitem')[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('no unread invoices: no unread sentence (R-68)', async () => {
  put({ would_change: pending(1, 'FRENAR') });
  await saveEs();
  await screen.findByText(/decidirá 1 factura/);
  expect(screen.queryByText(/aún no se han leído/)).toBeNull();
});

test('English: pending-only header, row words, unread row and sentence (R-68)', async () => {
  put({ would_change: [...pending(1, 'PAGAR'), ...pending(1, null)], will_pay: 1, unread_pending: 1 });
  await saveEn();
  expect(await screen.findByText('If you press "Re-evaluate pending", the agent will decide 2 pending invoice(s):')).toBeTruthy();
  expect(screen.getAllByText(/Factura 0/)[0]!.closest('li')!.textContent).toContain('Pending → PAY');
  expect(screen.getByText(/Pending → decided once read$/)).toBeTruthy();
  expect(screen.getByText('1 pending invoice(s) have not been read yet: the agent will read them on re-evaluation, and their result may change that of invoices that arrived later.')).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/outcome\.|null|Pendiente|PAGAR/);
});

test('English: mixed and escalated-only headers (R-68)', async () => {
  put({ would_change: [...pending(1, 'FRENAR'), { invoice_id: 'e', headline: 'Nube Sur', from: 'ESCALAR', to: 'FRENAR' }] });
  await saveEn();
  expect(await screen.findByText('If you press "Re-evaluate pending", the agent will decide 1 pending invoice(s) and change the result of 1 escalated invoice(s):')).toBeTruthy();
  cleanup();
  put({ would_change: [{ invoice_id: 'e', headline: 'Nube Sur', from: 'ESCALAR', to: 'FRENAR' }] });
  await saveEn();
  expect(await screen.findByText('If you press "Re-evaluate pending", the agent will change the result of 1 escalated invoice(s):')).toBeTruthy();
});

const sentenceEs = 'Fuente de tasas: Yahoo Finance (respaldo: open.er-api.com). Tu empresa puede conectar otra fuente —su banco, su proveedor de tesorería o la tasa de Blinka— agregando un proveedor; ver README, sección «Tasas de cambio».';
const sentenceEn = 'Rate source: Yahoo Finance (fallback: open.er-api.com). Your company can connect another source (its bank, its treasury provider or Blinka\'s rate) by adding a provider; see README, section "Tasas de cambio".';

test('«Tasas de mercado» lists each rate read-only: 1 USD in units, USD per unit, source, fetched time in Bogotá and status (AC-76)', async () => {
  setup();
  renderAt(<Policy />);
  const table = await screen.findByRole('table', { name: 'Tasas de mercado' });
  const cop = within(table).getByRole('row', { name: /COP/ });
  const cells = within(cop).getAllByRole('cell').map((c) => c.textContent);
  expect(cells).toEqual(['COP', '1 USD = 4.020,10 COP', '0,00024876', 'Yahoo Finance', 'consultada 17 oct 2026 10:00', 'vigente']);
  expect(within(table).getAllByRole('row').map((r) => r.textContent).join('|')).toContain('MXN');
  expect(table.querySelector('input')).toBeNull();
});

test('every «1 USD =» figure has the same two decimals, so a comma never reads as a thousands mark; USD per unit keeps 6 significant digits (AC-76, AC-91 item 5)', async () => {
  setup({ 'GET /api/fx': { provider: 'yahoo', rates: [
    { currency: 'COP', usd_per_unit: 0.000248761234, units_per_usd: 4020.1, source: 'Yahoo Finance', fetched_at: '2026-10-17T15:00:00Z', stale: false },
    { currency: 'MXN', usd_per_unit: 0.0541, units_per_usd: 18.479, source: 'Yahoo Finance', fetched_at: '2026-10-17T15:00:00Z', stale: false },
    { currency: 'EUR', usd_per_unit: 1.08, units_per_usd: 0.9259, source: 'Yahoo Finance', fetched_at: '2026-10-17T15:00:00Z', stale: false },
  ] } });
  renderAt(<Policy />);
  const table = await screen.findByRole('table', { name: 'Tasas de mercado' });
  const cells = within(table).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell').map((c) => c.textContent));
  expect(cells.map((c) => c[1])).toEqual(['1 USD = 4.020,10 COP', '1 USD = 18,48 MXN', '1 USD = 0,93 EUR']);
  expect(cells.map((c) => c[2])).toEqual(['0,000248761', '0,0541', '1,08']);
});

test('the date column header does not repeat the word in its cells (AC-76)', async () => {
  setup();
  renderAt(<Policy />);
  const table = await screen.findByRole('table', { name: 'Tasas de mercado' });
  expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Moneda', 'Tasa', 'USD por unidad', 'Fuente', 'Fecha', 'Estado']);
});

const pinLabels = () => screen.getAllByLabelText(/^1 \w{3} en USD$/).map((l) => l.closest('label')!.textContent);

test('the pin list is ARS, BRL, COP, EUR, MXN in code order, never «1 USD en USD» (AC-30 Clarified, R-110)', async () => {
  setup();
  renderAt(<Policy />);
  await limit();
  expect(pinLabels()).toEqual(['1 ARS en USD', '1 BRL en USD', '1 COP en USD', '1 EUR en USD', '1 MXN en USD']);
});

test('another policy currency follows the five, in code order (R-110)', async () => {
  const v = [{ ...versions[0], rules: { ...rules, fx_rates: { ...rules.fx_rates, PEN: 0.27, CLP: 0.001 } } }];
  setup({ 'GET /api/policy': v });
  renderAt(<Policy />);
  await limit();
  expect(pinLabels()).toEqual(['1 ARS en USD', '1 BRL en USD', '1 COP en USD', '1 EUR en USD', '1 MXN en USD', '1 CLP en USD', '1 PEN en USD']);
});

test('a stale row says «vencida: el agente escalará las facturas en esta moneda», a fresh one «vigente» (AC-76)', async () => {
  setup();
  renderAt(<Policy />);
  const table = await screen.findByRole('table', { name: 'Tasas de mercado' });
  expect(within(within(table).getByRole('row', { name: /MXN/ })).getByText('vencida: el agente escalará las facturas en esta moneda')).toBeTruthy();
  expect(within(table).getAllByText('vigente')).toHaveLength(1);
});

test('the market table sits above the optional pin section, and the source sentence closes the rates (AC-76, AC-30)', async () => {
  setup();
  renderAt(<Policy />);
  const table = await screen.findByRole('table', { name: 'Tasas de mercado' });
  const pins = screen.getByText('Tasas fijadas por la política');
  const sentence = screen.getByText(sentenceEs);
  expect(table.compareDocumentPosition(pins) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(pins.compareDocumentPosition(sentence) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('English: table, status, date and sentence (AC-76)', async () => {
  localStorage.setItem('lang', 'en');
  setup();
  renderAt(<Policy />);
  const table = await screen.findByRole('table', { name: 'Market rates' });
  expect(within(within(table).getByRole('row', { name: /COP/ })).getAllByRole('cell').map((c) => c.textContent)).toEqual(['COP', '1 USD = 4,020.10 COP', '0.00024876', 'Yahoo Finance', 'fetched Oct 17, 2026 10:00', 'current']);
  expect(within(table).getByText('expired: the agent will escalate invoices in this currency')).toBeTruthy();
  expect(screen.getByText('Rates pinned by the policy')).toBeTruthy();
  expect(screen.getByText(sentenceEn)).toBeTruthy();
});

test('with an empty pin table, saving posts fx_rates: {} (AC-30 Clarified, R-85)', async () => {
  const f = setup({
    'GET /api/policy': [{ ...versions[0], rules: { ...rules, fx_rates: {} } }],
    'PUT /api/policy': { policy: { ...versions[0], version: 3 }, would_change: [] },
  });
  renderAt(<Policy />);
  await limit();
  save();
  await screen.findByText('Versión 3 guardada.');
  const sent = f.mock.calls.find(([, i]) => i?.method === 'PUT' && String(i.body).includes('fx_rates'))!;
  expect(body(sent[1]!).rules.fx_rates).toEqual({});
});

test('a rate ≤ 0 pin is refused with the API text and marks the pin inputs (AC-30)', async () => {
  setup({ 'PUT /api/policy': json({ error: 'Valor no válido: las tasas deben ser mayores que 0', field: 'fx_rates' }, 400) });
  renderAt(<Policy />);
  await limit();
  fireEvent.change(screen.getByLabelText('1 COP en USD'), { target: { value: '0' } });
  save();
  expect((await screen.findByRole('alert')).textContent).toContain('tasas');
  expect(screen.getByLabelText('1 COP en USD').getAttribute('aria-invalid')).toBe('true');
});

test('no rates yet: a designed empty message with a «Reintentar» next step that refetches, and no table (AC-91 item 4)', async () => {
  let calls = 0;
  setup({ 'GET /api/fx': () => (++calls === 1 ? { provider: 'yahoo', rates: [] } : fx) });
  renderAt(<Policy />);
  expect((await screen.findByText(/Todavía no hay tasas de mercado/)).getAttribute('role')).toBe('status');
  expect(screen.queryByRole('table')).toBeNull();
  fireEvent.click(within(document.querySelector('.fx-slot') as HTMLElement).getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByRole('table', { name: 'Tasas de mercado' })).toBeTruthy();
});

test('the screen fails: a designed message with a «Reintentar» next step that refetches, in both languages, no status code (AC-91, AC-98)', async () => {
  let calls = 0;
  setup({ 'GET /api/fx': () => (++calls === 1 ? json({ error: 'boom' }, 500) : fx) });
  renderAt(<Policy />);
  const msg = await screen.findByText('No pude cargar la política. Recarga la página.');
  expect(msg.textContent).not.toMatch(/500|boom/);
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByRole('table', { name: 'Tasas de mercado' })).toBeTruthy();
  expect(calls).toBe(2);
  cleanup();
  localStorage.setItem('lang', 'en');
  setup({ 'GET /api/fx': json({ error: 'boom' }, 500) });
  renderAt(<Policy />);
  expect(await screen.findByText('I could not load the policy. Reload the page.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
});

// AC-99 (R-109): while the screen loads, every card is drawn in its loaded markup with placeholder data, hidden; the market
// table has one placeholder row per pin currency, no fixed-height block.
test('while the screen loads the cards are a skeleton and the real table shows one placeholder row per pin currency (R-109)', () => {
  setup({ 'GET /api/fx': () => new Promise(() => {}) });
  const { container } = renderAt(<Policy />);
  expect(screen.getByRole('status').textContent).toBe('Cargando…');
  const cards = [...container.querySelectorAll('section.card')];
  expect(cards.length).toBeGreaterThanOrEqual(3);
  expect(cards.every((c) => c.classList.contains('skeleton') && c.getAttribute('aria-hidden') === 'true' && c.hasAttribute('inert'))).toBe(true);
  expect(container.querySelector('.fx-skel')).toBeNull();
  const rows = container.querySelectorAll('.fx-slot table.fx-table tbody tr');
  expect([...rows].map((r) => r.firstElementChild!.textContent)).toEqual(['ARS', 'BRL', 'COP', 'EUR', 'MXN']);
  expect([...rows].every((r) => r.children.length === 6)).toBe(true);
});

test('the skeleton is gone once the screen answers', async () => {
  setup();
  const { container } = renderAt(<Policy />);
  await screen.findByRole('table', { name: 'Tasas de mercado' });
  expect(container.querySelector('.skeleton')).toBeNull();
});

test('empty and error render no table and no placeholder rows: the slot is its own content (R-109)', async () => {
  setup({ 'GET /api/fx': { provider: 'yahoo', rates: [] } });
  const { container } = renderAt(<Policy />);
  await screen.findByText(/Todavía no hay tasas de mercado/);
  expect(container.querySelector('.fx-slot tr')).toBeNull();
  cleanup();
  dropCache(); // a fresh tab: no last answer to show while the failing one is asked
  setup({ 'GET /api/fx': json({ error: 'boom' }, 500) });
  const e = renderAt(<Policy />);
  await screen.findByText('No pude cargar la política. Recarga la página.');
  expect(e.container.querySelector('.fx-slot tr')).toBeNull();
});

test('the market table scrolls inside its own container (AC-91 item 1)', async () => {
  setup();
  renderAt(<Policy />);
  expect((await screen.findByRole('table', { name: 'Tasas de mercado' })).parentElement!.className).toBe('fx-scroll');
});

// jsdom cannot measure layout (see mobile.test.ts): these guard the rules measured in Chromium at 360, 390 and 1440 px.
const { readFileSync } = (await import('node:fs' as string)) as { readFileSync(p: string, enc: string): string };
const css = readFileSync('web/policy.css', 'utf8');
const rule = (selector: string) => css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*>]/g, '\\$&')} \\{([^}]*)\\}`))?.[1] ?? '';

test('CSS: the rate table scrolls in its own box, the page grid may shrink, and the help line has a gap (AC-91 items 1 and 6)', () => {
  expect(rule('.fx-scroll')).toMatch(/overflow-x: auto/);
  expect(rule('.fx-scroll')).toMatch(/max-width: 100%/);
  expect(rule('.policy > *')).toMatch(/min-width: 0/);
  expect(rule('.card form > *')).toMatch(/min-width: 0/);
  expect(rule('fieldset > .hint')).toMatch(/margin-bottom: 1\.25rem/);
});

test('CSS: at 768 px and below the pin inputs are 16 px and the rate rows become cards (AC-91 items 1 and 2)', () => {
  const m = css.split('@media (max-width: 768px) {')[1]?.split('\n}\n')[0] ?? '';
  expect(m).toMatch(/fieldset input \{[^}]*font-size: 1rem/);
  expect(m).toMatch(/\.fx-table tr \{[^}]*display: flex/);
});

test('CSS: the market slot has no height of its own, at any width, and no pixel constants (R-109)', () => {
  expect(css).not.toMatch(/\.fx-slot \{[^}]*height/);
  expect(css).not.toMatch(/\.fx-skel/);
  expect(rule('.fx-slot p')).toMatch(/margin: 0/); // empty: the message is the last element, the 2.5rem gap to the pins is the section gap alone
  expect(rule('.fx-market')).toMatch(/margin-bottom: 1\.25rem/);
});

test('CSS: the pin grid column may shrink, the fieldset has min-width 0 and the inputs fill it, so both side gaps match (R-108)', () => {
  expect(rule('fieldset')).toMatch(/min-width: 0/);
  expect(rule('fieldset input')).toMatch(/width: 100%/);
  expect(rule('fieldset input')).toMatch(/box-sizing: border-box/);
  expect(rule('.grid.fx')).toMatch(/grid-template-columns: minmax\(0, 1fr\)/);
});

test('CSS: the rate header hidden on phones uses the standard sr-only pattern (AC-91 item 1)', () => {
  const m = css.split('@media (max-width: 768px) {')[1]?.split('\n}\n')[0] ?? '';
  const head = m.match(/\.fx-table thead \{([^}]*)\}/)?.[1] ?? '';
  for (const d of ['position: absolute', 'width: 1px', 'height: 1px', 'margin: -1px', 'padding: 0', 'overflow: hidden', 'clip: rect(0 0 0 0)', 'white-space: nowrap', 'border: 0', 'font-size: 0']) expect(head).toContain(d);
});

// UX-16 (AC-91 item 4): the save shows it is working within 100 ms, before the answer.
test('«Guardar como versión» is disabled and aria-busy while the save is in flight', async () => {
  let answer: (v: unknown) => void = () => {};
  setup({ 'PUT /api/policy': () => new Promise((r) => { answer = r; }) });
  renderAt(<Policy />);
  await limit();
  save();
  const button = screen.getByRole('button', { name: /^Guardar como versión/ }) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(true));
  expect(button.getAttribute('aria-busy')).toBe('true');
  answer({ policy: { ...versions[0], id: 'p3', version: 3 }, would_change: [], will_pay: 0, unread_pending: 0 });
  await waitFor(() => expect(button.disabled).toBe(false));
  expect(button.getAttribute('aria-busy')).toBeNull();
});

test('«Reevaluar pendientes» is disabled and aria-busy while the loop runs (UX-16)', async () => {
  setup({ 'POST /api/policy/reevaluate': () => new Promise(() => {}) });
  renderAt(<Policy />);
  await limit();
  fireEvent.click(screen.getByRole('button', { name: 'Reevaluar pendientes' }));
  const button = screen.getByRole('button', { name: 'Reevaluar pendientes' }) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(true));
  expect(button.getAttribute('aria-busy')).toBe('true');
});

// UX-24: the newest 10 versions, the rest one click away.
const many = Array.from({ length: 12 }, (_, i) => ({ ...versions[0], id: `p${12 - i}`, version: 12 - i }));
test.each([
  ['es', 'Mostrar todas (12)'],
  ['en', 'Show all (12)'],
])('more than 10 versions: the newest 10 and «%s»', async (lang, label) => {
  localStorage.setItem('lang', lang);
  setup({ 'GET /api/policy': many });
  renderAt(<Policy />);
  const list = (await screen.findByRole('list', { name: lang === 'es' ? 'Versiones' : 'Versions' }));
  expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(many.slice(0, 10).map((v) => expect.stringContaining(`${v.version}`)));
  fireEvent.click(screen.getByRole('button', { name: label }));
  expect(within(list).getAllByRole('listitem')).toHaveLength(12);
  expect(screen.queryByRole('button', { name: label })).toBeNull();
  localStorage.removeItem('lang');
});

test('10 versions or fewer: no «Mostrar todas» button (UX-24)', async () => {
  setup();
  renderAt(<Policy />);
  await limit();
  expect(screen.queryByRole('button', { name: /Mostrar todas/ })).toBeNull();
});

// UX-09 (AC-91 item 4): the company card grew when /api/company answered and pushed «Reglas de pago» down. The cards
// appear together once the company and the policy have both answered, so nothing that is shown moves.
test('no card is shown until the company and the policy have both answered (UX-09)', async () => {
  let company_: (v: unknown) => void = () => {};
  setup({ 'GET /api/company': () => new Promise((r) => { company_ = r; }) });
  renderAt(<Policy />);
  await waitFor(() => expect(screen.getByText('Cargando…')).toBeTruthy());
  await new Promise((r) => setTimeout(r, 20)); // the policy has answered by now
  expect(screen.queryByRole('heading', { name: 'Límites y aprobación' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Empresa' })).toBeNull();
  company_(company);
  expect(await screen.findByRole('heading', { name: 'Límites y aprobación' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Empresa' })).toBeTruthy();
});

test('CSS: at phone width the «Pagar solo a beneficiarios permitidos» checkbox is a 44 x 44 target (AC-91 item 2)', async () => {
  const { readFileSync } = (await import('node:fs' as string)) as { readFileSync(p: string, enc: string): string };
  const phone = readFileSync('web/policy.css', 'utf8').split('@media (max-width: 640px) {')[1] ?? '';
  expect(phone).toMatch(/\.switch input \{[^}]*width: 44px; height: 44px/);
});

// ---- AC-105: rule cards, one sentence per rule, the diff list. New components, not mounted in the page yet. ----
// R-164: Intl's own percent for the tab locale, never a hand-written "{n} %"; a policy value keeps its decimals.
const pct = (v: number, locale: string) => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(v / 100);
const SENTENCES = {
  per_payment_limit_usd: ['Si una factura supera 10.000 USD, la freno: no se paga.', 'If an invoice is above 10,000 USD, I stop it: it is not paid.'],
  approval_threshold_usd: ['Desde 10.000 USD te pregunto antes de pagar.', 'From 10,000 USD I ask you before paying.'],
  period_budget_usd: ['Si con una factura los pagos del mes pasarían de 10.000 USD, la escalo.', 'If an invoice would take the month\'s payments past 10,000 USD, I escalate it.'],
  account_balance_usd: ['Si el saldo de 10.000 USD no alcanza para una factura, la escalo.', 'If the 10,000 USD balance does not cover an invoice, I escalate it.'],
  duplicate_window_days: ['Si ya recibí una factura igual en los últimos 10.000 día(s), la freno; si es parecida, la escalo.', 'If I already received an identical invoice in the last 10,000 day(s), I stop it; if it looks similar, I escalate it.'],
  agreement_tolerance_pct: [`Acepto hasta ${pct(10000, 'es-CO')} de diferencia con el monto acordado; si es más, la escalo.`, `I accept up to ${pct(10000, 'en-US')} difference from the agreed amount; beyond that, I escalate it.`],
  due_grace_days: ['Acepto una factura hasta 10.000 día(s) después de su vencimiento; después, la escalo.', 'I accept an invoice up to 10,000 day(s) after its due date; after that, I escalate it.'],
} as const;
const EMPTY = ['Sin valor: no puedo verificar esta regla y escalo la factura.', 'No value: I cannot check this rule, so I escalate the invoice.'];

test.each([['es', 0], ['en', 1]] as const)('each rule gets one sentence with its value, and one for an empty box, in %s (AC-105)', (lang, i) => {
  localStorage.setItem('lang', lang);
  for (const [rule, s] of Object.entries(SENTENCES)) {
    const { unmount } = renderAt(<RuleSentence rule={rule as keyof typeof SENTENCES} value="10000" />);
    expect(screen.getByText(s[i]!).id).toBe(`${rule}-hint`);
    unmount();
    const empty = renderAt(<RuleSentence rule={rule as keyof typeof SENTENCES} value="" />);
    expect(screen.getByText(EMPTY[i]!)).toBeTruthy();
    empty.unmount();
  }
});

test.each([['es', 'es-CO'], ['en', 'en-US']] as const)('a tolerance with decimals is printed whole, through Intl percent (%s, R-164)', (lang, locale) => {
  localStorage.setItem('lang', lang);
  renderAt(<RuleSentence rule="agreement_tolerance_pct" value="2.5" />);
  expect(document.getElementById('agreement_tolerance_pct-hint')!.textContent).toContain(pct(2.5, locale));
});

test('the spec examples read exactly, a half-typed value counts as empty, and the switch has its own two sentences (AC-105)', () => {
  renderAt(<><RuleSentence rule="approval_threshold_usd" value="2500" /><RuleSentence rule="per_payment_limit_usd" value="-" /><RuleSentence rule="allowed_beneficiaries_only" value={true} /><RuleSentence rule="allowed_beneficiaries_only" value={false} /></>);
  expect(screen.getByText('Desde 2.500 USD te pregunto antes de pagar.')).toBeTruthy();
  expect(screen.getByText(EMPTY[0]!)).toBeTruthy();
  expect(screen.getByText('Solo pago a quien está en Beneficiarios; si no está, escalo la factura.')).toBeTruthy();
  expect(screen.getByText('Pago también a quien no está en Beneficiarios.')).toBeTruthy();
});

test('the five cards, in order, hold every rule once and Moneda holds the market table and the pins (AC-105)', () => {
  expect(RULE_GROUPS.map((g) => g.id)).toEqual(['beneficiaries', 'limits', 'budget', 'dates', 'currency']);
  expect(RULE_GROUPS.flatMap((g) => g.rules).sort()).toEqual(['account_balance_usd', 'agreement_tolerance_pct', 'allowed_beneficiaries_only', 'approval_threshold_usd', 'due_grace_days', 'duplicate_window_days', 'per_payment_limit_usd', 'period_budget_usd'].sort());
  expect(RULE_GROUPS.at(-1)!.rules).toEqual([]);
  renderAt(<>{RULE_GROUPS.map((g) => <RuleCard key={g.id} group={g.id}><input aria-label={g.id} /></RuleCard>)}</>);
  expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Beneficiarios y acuerdos', 'Límites y aprobación', 'Presupuesto y saldo', 'Fechas y duplicados', 'Moneda']);
  expect(within(screen.getByRole('region', { name: 'Moneda' })).getByLabelText('currency')).toBeTruthy();
});

test('the cards are named in English too (AC-105)', () => {
  localStorage.setItem('lang', 'en');
  renderAt(<>{RULE_GROUPS.map((g) => <RuleCard key={g.id} group={g.id}>x</RuleCard>)}</>);
  expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Beneficiaries and agreements', 'Limits and approval', 'Budget and balance', 'Dates and duplicates', 'Currency']);
});

const diff = [
  { invoice_id: 'i1', headline: 'Pixel Lab: 4.200 USD supera el límite', payee: 'Pixel Lab', amount: 4200, currency: 'USD', reason: 'Supera el límite por pago.', from: null, to: 'FRENAR' as const },
  { invoice_id: 'i2', headline: 'Diego Ruiz', payee: 'Diego Ruiz', amount: 15000, currency: 'MXN', reason: null, from: 'ESCALAR' as const, to: 'PAGAR' as const },
  { invoice_id: 'i3', headline: '', from: null, to: null },
];

test('each diff row shows the invoice link, the payee, the amount, from-chip to to-chip and the reason, then how many do not change (AC-105)', () => {
  renderAt(<DiffList rows={diff} unchanged={12} />, { at: '/policy' });
  const rows = screen.getAllByRole('listitem');
  expect(rows).toHaveLength(3);
  const a = within(rows[0]!), b = within(rows[1]!);
  expect(a.getByRole('link', { name: 'Pixel Lab' }).getAttribute('href')).toBe('/invoices/i1');
  expect(a.getByText('Pixel Lab').hasAttribute('data-user')).toBe(true);
  expect(a.getByText('4.200 USD').hasAttribute('data-user')).toBe(false);
  expect(rows[0]!.textContent).toContain('Pendiente → FRENAR');
  expect(a.getByText('Supera el límite por pago.')).toBeTruthy();
  expect(b.getByText('15.000 MXN')).toBeTruthy();
  expect(rows[1]!.textContent).toContain('ESCALAR → PAGAR');
  expect(b.getByText('Cumple todas las reglas.').hasAttribute('data-user')).toBe(false);
  expect(screen.getByText('12 facturas no cambian.')).toBeTruthy();
});

test('a PAGAR row has no blocking motive from the route (reason null), so it says it passes every rule, in English too (AC-105, R-61)', () => {
  localStorage.setItem('lang', 'en');
  renderAt(<DiffList rows={[diff[1]!]} />);
  expect(screen.getByText('Passes every rule.')).toBeTruthy();
});

test('an unread invoice says it will be decided once read; rows without the new fields fall back to the headline (AC-105, R-68)', () => {
  renderAt(<DiffList rows={[diff[2]!, { invoice_id: 'i4', headline: 'Nube Sur: pasa', from: 'ESCALAR', to: 'FRENAR' }]} unchanged={1} />);
  expect(screen.getByText('Pendiente → se decidirá al leerla')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Factura sin leer' }).getAttribute('href')).toBe('/invoices/i3');
  expect(screen.getByRole('link', { name: 'Nube Sur: pasa' }).getAttribute('href')).toBe('/invoices/i4');
  expect(screen.getByText('1 factura no cambia.')).toBeTruthy();
});

test('no count from the API: no "no cambian" line; English words and plural (AC-105)', () => {
  localStorage.setItem('lang', 'en');
  const { unmount } = renderAt(<DiffList rows={diff.slice(0, 1)} />);
  expect(document.body.textContent).not.toMatch(/not change|no cambian/);
  expect(document.body.textContent).toContain('Pending → STOP');
  unmount();
  renderAt(<DiffList rows={diff.slice(0, 1)} unchanged={5} />);
  expect(screen.getByText('5 invoices do not change.')).toBeTruthy();
});

// ---- AC-105, mounted: the page groups the form into the five cards, one sentence per rule, the diff list after a save ----
test('the mounted page shows the five cards in order, each rule under its card, Moneda holding the market table and the pins (AC-105)', async () => {
  setup();
  renderAt(<Policy />);
  await limit();
  const names = ['Beneficiarios y acuerdos', 'Límites y aprobación', 'Presupuesto y saldo', 'Fechas y duplicados', 'Moneda'];
  const cards = names.map((n) => screen.getByRole('region', { name: n }));
  expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Empresa', ...names, 'Reevaluar pendientes', 'Versiones']);
  expect(within(cards[0]!).getByLabelText(/Pagar solo a beneficiarios/)).toBeTruthy();
  expect(within(cards[0]!).getByLabelText(/Tolerancia del acuerdo/)).toBeTruthy();
  expect(within(cards[1]!).getByLabelText('Límite por pago (USD)')).toBeTruthy();
  expect(within(cards[1]!).getByLabelText(/Umbral de aprobación/)).toBeTruthy();
  expect(within(cards[2]!).getByLabelText(/Presupuesto del periodo/)).toBeTruthy();
  expect(within(cards[2]!).getByLabelText(/Saldo de la cuenta/)).toBeTruthy();
  expect(within(cards[3]!).getByLabelText(/Ventana de duplicados/)).toBeTruthy();
  expect(within(cards[3]!).getByLabelText(/Días de gracia/)).toBeTruthy();
  expect(within(cards[4]!).getByRole('table', { name: 'Tasas de mercado' })).toBeTruthy();
  expect(within(cards[4]!).getByRole('group', { name: 'Tasas fijadas por la política' })).toBeTruthy();
});

test('each rule shows its sentence with its current value, follows typing, and says so when the box is empty, in es and en (AC-105)', async () => {
  setup();
  renderAt(<Policy />);
  const input = await limit();
  expect(input.getAttribute('aria-describedby')).toBe('per_payment_limit_usd-hint');
  expect(screen.getByText('Si una factura supera 5.000 USD, la freno: no se paga.').id).toBe('per_payment_limit_usd-hint');
  expect(screen.getByText('Desde 2.500 USD te pregunto antes de pagar.')).toBeTruthy();
  expect(screen.getByText('Solo pago a quien está en Beneficiarios; si no está, escalo la factura.')).toBeTruthy();
  fireEvent.change(input, { target: { value: '1000' } });
  expect(screen.getByText('Si una factura supera 1.000 USD, la freno: no se paga.')).toBeTruthy();
  fireEvent.change(input, { target: { value: '' } });
  expect(within(input.closest('div')!).getByText('Sin valor: no puedo verificar esta regla y escalo la factura.')).toBeTruthy();
  fireEvent.click(screen.getByLabelText(/Pagar solo a beneficiarios/));
  expect(screen.getByText('Pago también a quien no está en Beneficiarios.')).toBeTruthy();
  cleanup();
  localStorage.setItem('lang', 'en');
  setup();
  renderAt(<Policy />);
  await screen.findByLabelText('Per-payment limit (USD)');
  expect(screen.getByText('If an invoice is above 5,000 USD, I stop it: it is not paid.')).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Limits and approval' })).toBeTruthy();
});

test('after saving, «qué cambiaría» is a diff list: invoice, beneficiary, amount, from-chip to to-chip, reason, then how many do not change (AC-105, 45b)', async () => {
  const row = { payee: null, amount: null, currency: null, reason: null };
  setup({
    'PUT /api/policy': {
      policy: { ...versions[0], version: 3 }, will_pay: 1, unread_pending: 1, unchanged: 12,
      would_change: [
        { invoice_id: 'i1', headline: 'Pixel Lab: 4.200 USD', from: null, to: 'PAGAR', payee: 'Pixel Lab', amount: 4200, currency: 'USD', reason: null },
        { invoice_id: 'i2', headline: 'Nube Sur', from: 'ESCALAR', to: 'FRENAR', payee: 'Nube Sur', amount: 15000, currency: 'MXN', reason: 'Supera el límite por pago.' },
        { invoice_id: 'i3', headline: '', from: null, to: null, ...row },
      ],
    },
  });
  renderAt(<Policy />, { at: '/policy' });
  await limit();
  save();
  await screen.findByText('12 facturas no cambian.');
  const rows = screen.getAllByRole('listitem').filter((li) => li.closest('ul.diff'));
  expect(rows).toHaveLength(3);
  expect(within(rows[0]!).getByRole('link', { name: 'Pixel Lab' })).toBeTruthy();
  expect(within(rows[0]!).getByText('Pixel Lab').hasAttribute('data-user')).toBe(true);
  expect(within(rows[0]!).getByText('4.200 USD')).toBeTruthy();
  expect(rows[0]!.textContent).toContain('Pendiente → PAGAR');
  expect(within(rows[0]!).getByText('Cumple todas las reglas.')).toBeTruthy();
  expect(rows[1]!.textContent).toContain('ESCALAR → FRENAR');
  expect(within(rows[1]!).getByText('15.000 MXN')).toBeTruthy();
  expect(rows[2]!.textContent).toContain('Pendiente → se decidirá al leerla');
  expect(screen.getByText('12 facturas no cambian.')).toBeTruthy();
});

test('«Guardar como versión» is the one primary button on the page (AC-105)', async () => {
  setup();
  const { container } = renderAt(<Policy />);
  await limit();
  const primary = [...container.querySelectorAll('button.primary')];
  expect(primary.map((b) => b.textContent)).toEqual(['Guardar como versión 3']);
});

test('while the screen loads the Empresa card already has the demo and trial notes of the signed-in user, so the answer moves nothing (AC-91 item 4)', () => {
  setup({ 'GET /api/fx': () => new Promise(() => {}) });
  auth.value = { session: { user: { email: 'demo@andina-labs.example' } }, demoEmail: 'demo@andina-labs.example' };
  const demo = renderAt(<Policy />);
  expect(demo.container.querySelector('section.skeleton .muted')!.textContent).toContain('solo lectura');
  cleanup();
  auth.value = { session: { user: { is_anonymous: true } }, demoEmail: 'demo@andina-labs.example' };
  const trial = renderAt(<Policy />);
  expect(trial.container.querySelector('section.skeleton #trial-approver')).toBeTruthy();
  auth.value = { session: null, demoEmail: '' };
});
