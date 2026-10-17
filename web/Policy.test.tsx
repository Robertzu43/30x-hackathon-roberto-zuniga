import { fireEvent, screen, waitFor } from '@testing-library/react';
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

function setup(extra: Record<string, unknown> = {}) {
  return mockApi({ 'GET /api/company': company, 'GET /api/policy': versions, ...extra });
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
    'PUT /api/policy': { policy: { ...versions[0], id: 'p4', version: 4 }, would_change: [{ invoice_id: 'i1', headline: 'Pixel Lab: 4.200 USD supera el límite', from: 'PAGAR', to: 'FRENAR' }, { invoice_id: 'i2', headline: 'Nube Sur', from: 'ESCALAR', to: 'FRENAR' }] },
  });
  renderAt(<Policy />);
  fireEvent.change(await limit(), { target: { value: '1000' } });
  save();
  expect(await screen.findByText('Versión 4 guardada.')).toBeTruthy();
  const put = f.mock.calls.find(([u, i]) => u === '/api/policy' && i?.method === 'PUT')!;
  expect(body(put[1]!)).toEqual({ rules: { ...rules, per_payment_limit_usd: 1000 } });
  expect(screen.getByText('2 facturas pendientes cambiarían de resultado')).toBeTruthy();
  expect(screen.getByText(/Pixel Lab: 4\.200 USD supera el límite/).textContent).toContain('PAGAR → FRENAR');
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
  await screen.findByText('1 factura pendiente cambiaría de resultado');
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
