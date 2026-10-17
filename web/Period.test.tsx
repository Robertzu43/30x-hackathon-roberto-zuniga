import { screen, fireEvent, within } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import Period from './pages/Period';
import { mockApi, renderAt } from './test/utils';

const month = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }).slice(0, 7);
const body = {
  month, budget_usd: 10000, balance_usd: 20000, paid_usd: 1500.5, committed_usd: 5700.5, available_usd: 4299.5,
  count_by_outcome: { PAGAR: 3, FRENAR: 2, ESCALAR: 1 },
  by_beneficiary: [
    { beneficiary: 'Nube Sur LLC', paid_usd: 0, committed_usd: 4200, count: 1 },
    { beneficiary: null, paid_usd: 1500.5, committed_usd: 1500.5, count: 2 },
  ],
  autonomy: { n: 18, m: 24 }, autonomy_pct: 75, violations: 0, explained_pct: 100,
};
const empty = {
  month, budget_usd: null, balance_usd: null, paid_usd: 0, committed_usd: 0, available_usd: null,
  count_by_outcome: { PAGAR: 0, FRENAR: 0, ESCALAR: 0 }, by_beneficiary: [],
  autonomy: { n: 0, m: 0 }, autonomy_pct: null, violations: 0, explained_pct: 100,
};
const show = () => renderAt(<Period />, { at: '/period' });
beforeEach(() => localStorage.clear());

test('renders the three figures with a plain explanation each', async () => {
  mockApi({ [`GET /api/period?month=${month}`]: body });
  show();
  expect(await screen.findByText('Autonomía 75 %')).toBeTruthy();
  expect(screen.getByText('18 de 24 facturas decididas solas y correctamente')).toBeTruthy();
  expect(screen.getByText('Violaciones 0')).toBeTruthy();
  expect(screen.getByText('Decisiones explicadas 100 %')).toBeTruthy();
  expect(screen.getByText(/Facturas de ejemplo que el agente mandó a PAGAR/)).toBeTruthy();
});

test('shows money, outcome counts and the per-beneficiary table', async () => {
  mockApi({ [`GET /api/period?month=${month}`]: body });
  show();
  await screen.findByText('Autonomía 75 %');
  expect(screen.getByText(/10\.000/)).toBeTruthy(); // es-CO grouping
  expect(screen.getAllByText(/1\.500,50/).length).toBeGreaterThan(0);
  const row = screen.getByText('Nube Sur LLC').closest('tr') as HTMLElement;
  expect(within(row).getByText(/4\.200/)).toBeTruthy();
  expect(screen.getByText('PAGAR: 3')).toBeTruthy();
  expect(within(screen.getByText('Beneficiario no leído').closest('tr')!).getByText('2')).toBeTruthy(); // R-63: never "—"
  expect(screen.queryByText('—')).toBeNull();
});

test('the per-beneficiary table scrolls inside its own wrapper on a narrow screen (AC-72)', async () => {
  mockApi({ [`GET /api/period?month=${month}`]: body });
  show();
  expect((await screen.findByRole('table')).parentElement!.className).toBe('table-wrap');
});

test('an unread-payee row (beneficiary null) is labelled in the UI language (R-63)', async () => {
  localStorage.setItem('lang', 'en');
  mockApi({ [`GET /api/period?month=${month}`]: { ...body, by_beneficiary: [{ beneficiary: null, paid_usd: 0, committed_usd: 0, count: 3 }] } });
  show();
  expect(await screen.findByText('Payee not read')).toBeTruthy();
});

test('"100 %" never breaks from its number (R-63)', async () => {
  mockApi({ [`GET /api/period?month=${month}`]: body });
  show();
  expect((await screen.findByText('Decisiones explicadas 100 %')).textContent).toBe('Decisiones explicadas 100\u00a0%');
  expect(screen.getByText('Autonomía 75 %').textContent).toBe('Autonomía 75\u00a0%');
});

test('a violation is spelled out in words, not only by color', async () => {
  mockApi({ [`GET /api/period?month=${month}`]: { ...body, violations: 2 } });
  show();
  expect(await screen.findByText('Violaciones 2')).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toMatch(/PAGAR fuera de las reglas en 2 /);
});

test('changing the month refetches with ?month=', async () => {
  const fetchMock = mockApi({ [`GET /api/period?month=${month}`]: body, 'GET /api/period?month=2026-09': { ...body, paid_usd: 77 } });
  show();
  await screen.findByText('Autonomía 75 %');
  fireEvent.change(screen.getByLabelText('Mes'), { target: { value: '2026-09' } });
  expect(await screen.findByText(/77,00/)).toBeTruthy();
  expect(fetchMock.mock.calls.some(([u]) => String(u) === '/api/period?month=2026-09')).toBe(true);
});

test('an empty period shows zeros and never NaN', async () => {
  mockApi({ [`GET /api/period?month=${month}`]: empty });
  const { container } = show();
  expect(await screen.findByText('Violaciones 0')).toBeTruthy();
  expect(screen.getByText('0 de 0 facturas decididas solas y correctamente')).toBeTruthy();
  expect(screen.getByText('Sin pagos en este mes.')).toBeTruthy();
  expect(container.textContent).not.toMatch(/NaN|undefined|null/);
});

test('English renders English', async () => {
  localStorage.setItem('lang', 'en');
  mockApi({ [`GET /api/period?month=${month}`]: body });
  show();
  expect(await screen.findByText('Autonomy 75 %')).toBeTruthy();
  expect(screen.getByText('18 of 24 invoices decided alone and correctly')).toBeTruthy();
  expect(screen.getByText('Violations 0')).toBeTruthy();
  expect(screen.getByText('Decisions explained 100 %')).toBeTruthy();
  expect(screen.getByText('PAY: 3')).toBeTruthy();
  expect(screen.getByText(/10,000/)).toBeTruthy();
});

test('shows loading with the anchor present, then an error', async () => {
  mockApi({ [`GET /api/period?month=${month}`]: new Response(JSON.stringify({ error: 'Mes no válido' }), { status: 400 }) });
  const { container } = show();
  expect(container.querySelector('[data-tour="period"]')).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe('Cargando…');
  expect((await screen.findByRole('alert')).textContent).toContain('Mes no válido');
});
