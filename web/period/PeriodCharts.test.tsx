import { screen, within } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import PeriodCharts, { type Charts } from './PeriodCharts';
import { renderAt } from '../test/utils';

const day = (n: number) => `2026-10-${String(n).padStart(2, '0')}`;
const charts: Charts = {
  budget_usd: 10000,
  burn: [{ day: day(1), available_usd: 10000 }, { day: day(2), available_usd: 4299.5 }, { day: day(3), available_usd: null }],
  stack: { paid: 1500.5, escalated: 4200, available: 4299.5, over: 0 },
  outcomes: { PAGAR: 3, FRENAR: 2, ESCALAR: 1, pending: 4 },
  trend: [{ day: day(1), autonomy_pct: 50, violations: 0 }, { day: day(2), autonomy_pct: 75, violations: 0 }],
};
const rows = [
  { beneficiary: 'Nube Sur LLC', paid_usd: 0, committed_usd: 4200 },
  { beneficiary: null, paid_usd: 1500.5, committed_usd: 1500.5 },
];
const show = (c: Charts = charts) => renderAt(<PeriodCharts charts={c} byBeneficiary={rows} />);
const chart = async (title: string) => (await screen.findByRole('figure', { name: new RegExp(title) })) as HTMLElement;
beforeEach(() => localStorage.clear());

test('burn-down: the budget line, the last known day, and no projection after today (AC-103)', async () => {
  show();
  const f = await chart('Presupuesto disponible');
  expect(f.getAttribute('aria-label')).toMatch(/4\.299,5 USD el 2 de oct/);
  expect(f.getAttribute('aria-label')).toMatch(/presupuesto 10\.000/);
  expect(within(f).queryByText(/3 de oct/, { selector: 'th' })).toBeNull(); // the null day is not a row
});

test('stacked bar: Pagado, Escalado and Disponible with their values', async () => {
  show();
  const f = await chart('Presupuesto del mes');
  for (const w of ['Pagado', 'Escalado', 'Disponible']) expect(within(f).getAllByText(w).length).toBeGreaterThan(0);
  expect(f.getAttribute('aria-label')).toMatch(/Escalado 4\.200/);
  expect(within(f).queryByText(/Excede el presupuesto/)).toBeNull();
});

test('over budget: the label names the excess in USD and Disponible is 0 (AC-103)', async () => {
  show({ ...charts, stack: { paid: 1000, escalated: 11500, available: 0, over: 2500 } });
  const f = await chart('Presupuesto del mes');
  expect(within(f).getByText(/Excede el presupuesto por USD\s2\.500,00/)).toBeTruthy();
  expect(f.getAttribute('aria-label')).toMatch(/Disponible 0/);
});

test('per-beneficiary bars: paid and committed per row, the unread payee in words (R-63)', async () => {
  show();
  const f = await chart('Por beneficiario');
  expect(f.getAttribute('aria-label')).toMatch(/Nube Sur LLC \(Pagado 0, Comprometido 4\.200\)/);
  expect(f.getAttribute('aria-label')).toMatch(/Beneficiario no leído \(Pagado 1\.500,5/);
});

test('outcome breakdown: PAGAR, FRENAR, ESCALAR and pendiente, with counts', async () => {
  show();
  const f = await chart('Facturas del mes por decisión');
  expect(f.getAttribute('aria-label')).toBe('Facturas del mes por decisión, en facturas: PAGAR 3, FRENAR 2, ESCALAR 1, pendiente 4.');
});

test('trend with two days: one line for autonomy and one for violations (never two scales in one chart)', async () => {
  show();
  expect((await chart('Autonomía')).getAttribute('aria-label')).toMatch(/75 % el 2 de oct/);
  expect((await chart('Violaciones')).getAttribute('aria-label')).toMatch(/0 violaciones el 2 de oct/);
  expect(screen.queryByText('La tendencia aparece cuando haya decisiones en más de un día.')).toBeNull();
});

test('trend with one day: the current figures and the message, no one-point line (AC-103)', async () => {
  const { container } = show({ ...charts, trend: [{ day: day(2), autonomy_pct: 75, violations: 1 }] });
  expect(await screen.findByText('La tendencia aparece cuando haya decisiones en más de un día.')).toBeTruthy();
  expect(await screen.findByRole('group', { name: /Autonomía: 75\s?%/ })).toBeTruthy();
  expect(screen.getByRole('group', { name: 'Violaciones: 1' })).toBeTruthy();
  expect(container.querySelector('.chart-line')).toBeTruthy(); // only the burn-down draws a line
  expect(container.querySelectorAll('.chart-line').length).toBe(1);
});

test('trend with no decisions: no figures invented, the message still shows', async () => {
  show({ ...charts, trend: [] });
  expect(await screen.findByText('La tendencia aparece cuando haya decisiones en más de un día.')).toBeTruthy();
  expect((await screen.findAllByText('Sin datos')).length).toBe(2);
});

test('no budget: burn-down and stack show the designed empty state, nothing invented (AC-106.1)', async () => {
  const { container } = show({ ...charts, budget_usd: null, burn: charts.burn.map((b) => ({ ...b, available_usd: null })), stack: { paid: 0, escalated: 0, available: null, over: null } });
  await chart('Presupuesto disponible');
  expect(screen.getAllByText('Todavía no hay datos para este gráfico.').length).toBeGreaterThanOrEqual(2);
  expect(container.textContent).not.toMatch(/NaN|undefined|null/);
});

test('English: titles, units and the one-day message follow the tab', async () => {
  localStorage.setItem('lang', 'en');
  show({ ...charts, stack: { paid: 5, escalated: 7, available: 0, over: 12 }, trend: [{ day: day(2), autonomy_pct: 75, violations: 0 }] });
  expect(await screen.findByText('The trend appears once there are decisions on more than one day.')).toBeTruthy();
  expect(await screen.findByText(/Over budget by USD\s12\.00/)).toBeTruthy();
  expect((await chart('Invoices this month by decision')).getAttribute('aria-label')).toMatch(/PAY 3.*pending 4/);
});
