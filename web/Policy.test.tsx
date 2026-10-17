import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import Policy, { route } from './pages/Policy';
import { mockApi, renderAt } from './test/utils';

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

function setup(extra: Record<string, unknown> = {}) {
  return mockApi({ 'GET /api/company': company, 'GET /api/policy': versions, 'GET /api/fx': fx, ...extra });
}
const limit = () => screen.findByLabelText('Límite por pago (USD)') as Promise<HTMLInputElement>;
const save = () => fireEvent.click(screen.getByRole('button', { name: /^Guardar como versión/ }));

test('/policy is in the nav after Bandeja, with its tour anchor present before data loads', () => {
  expect(route).toEqual({ path: '/policy', nav: { key: 'screen.policy', order: 20 } });
  setup();
  const { container } = renderAt(<Policy />);
  expect(container.querySelector('[data-tour="policy"]')).toBeTruthy();
});

test('shows every rule of the latest version, the six FX rows and "Guardar como versión 3" (AC-30)', async () => {
  setup();
  renderAt(<Policy />);
  expect((await limit()).value).toBe('5000');
  for (const l of ['Umbral de aprobación (USD)', 'Presupuesto del periodo (USD)', 'Saldo de la cuenta (USD)', 'Ventana de duplicados (días)', 'Tolerancia del acuerdo (%)', 'Días de gracia de vencimiento'])
    expect(screen.getByLabelText(l)).toBeTruthy();
  expect((screen.getByLabelText('Pagar solo a beneficiarios permitidos') as HTMLInputElement).checked).toBe(true);
  for (const c of ['COP', 'MXN', 'BRL', 'ARS', 'EUR', 'USD']) expect(screen.getByLabelText(`1 ${c} en USD`)).toBeTruthy();
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
  expect(screen.getByText(/Pixel Lab: 4\.200 USD supera el límite/).textContent).toContain('Pendiente → FRENAR');
});

test('in English the would-change list uses the English outcome words (R-65)', async () => {
  localStorage.setItem('lang', 'en');
  setup({ 'PUT /api/policy': { policy: { ...versions[0], version: 3 }, would_change: [{ invoice_id: 'i2', headline: 'Nube Sur', from: 'ESCALAR', to: 'FRENAR' }] } });
  renderAt(<Policy />);
  fireEvent.change(await screen.findByLabelText('Per-payment limit (USD)'), { target: { value: '1000' } });
  fireEvent.click(screen.getByRole('button', { name: /^Save as version/ }));
  expect((await screen.findByText(/Nube Sur/)).textContent).toContain('ESCALATE → STOP');
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
  expect(screen.getByText(/Diego Ruiz/).textContent).toContain('ESCALAR → PAGAR');
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
  expect(rows.filter((r) => /Pendiente → PAGAR$/.test(r.textContent!))).toHaveLength(8);
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
  expect(screen.getAllByText(/Factura 0/)[0]!.textContent).toContain('Pending → PAY');
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

test('no rates yet: a designed empty message, and no table (AC-91)', async () => {
  setup({ 'GET /api/fx': { provider: 'yahoo', rates: [] } });
  renderAt(<Policy />);
  expect(await screen.findByText(/Todavía no hay tasas de mercado/)).toBeTruthy();
  expect(screen.queryByRole('table')).toBeNull();
});

test('/api/fx fails: a designed message with the next step, in both languages, no status code (AC-91)', async () => {
  setup({ 'GET /api/fx': json({ error: 'boom' }, 500) });
  renderAt(<Policy />);
  const msg = await screen.findByText(/No pude cargar las tasas de mercado\. Recarga la página/);
  expect(msg.textContent).not.toMatch(/500|boom/);
  cleanup();
  localStorage.setItem('lang', 'en');
  setup({ 'GET /api/fx': json({ error: 'boom' }, 500) });
  renderAt(<Policy />);
  expect(await screen.findByText(/I could not load the market rates\. Reload the page/)).toBeTruthy();
});

test('while /api/fx loads the section shows a message, not a blank (AC-91)', () => {
  setup({ 'GET /api/fx': () => new Promise(() => {}) });
  renderAt(<Policy />);
  expect(screen.getAllByText('Cargando…').length).toBeGreaterThan(0);
});
