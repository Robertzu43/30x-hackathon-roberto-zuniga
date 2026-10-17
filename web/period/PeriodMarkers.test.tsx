// R-142 (AC-106 Clarified, R-131): a payee name in a chart label or visible summary sits in its own `[data-user]`; fallback copy and numbers never do.
import { screen } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import HBars from '../charts/HBars';
import { renderAt } from '../test/utils';
import PeriodCharts, { type Charts } from './PeriodCharts';

beforeEach(() => localStorage.clear());

const rows = [{ label: 'Nube Sur LLC', values: [10], user: true }, { label: 'Beneficiario no leído', values: [5] }];
const names = (el: Element) => [...el.querySelectorAll('[data-user]')].map((e) => e.textContent);

test('HBars: a user row marks its label and only its name in the visible summary; aria-label keeps the whole sentence', () => {
  const { container } = renderAt(<HBars title="Por beneficiario" unit="USD" rows={rows} />);
  const fig = container.querySelector('figure')!;
  const summary = fig.querySelector('.chart-summary')!;
  expect(names(fig.querySelector('.chart-hbars')!)).toEqual(['Nube Sur LLC']);
  expect(names(summary)).toEqual(['Nube Sur LLC']);
  expect(summary.textContent).toBe(fig.getAttribute('aria-label'));
  expect(summary.textContent).toBe('Por beneficiario, en USD: Nube Sur LLC 10, Beneficiario no leído 5.');
  expect(fig.querySelector('figcaption [data-user]')).toBeNull();
});

test('PeriodCharts: the beneficiary is marked, «Beneficiario no leído», amounts and legend are not', async () => {
  const charts: Charts = { budget_usd: null, burn: [], stack: { paid: 1, escalated: 0, available: null, over: null },
    outcomes: { PAGAR: 1, FRENAR: 0, ESCALAR: 0, pending: 0 }, trend: [{ day: '2026-10-01', autonomy_pct: 50, violations: 0 }] };
  renderAt(<PeriodCharts charts={charts} byBeneficiary={[
    { beneficiary: 'Nube Sur LLC', paid_usd: 0, committed_usd: 4200 }, { beneficiary: null, paid_usd: 1500.5, committed_usd: 1500.5 }]} />);
  const fig = await screen.findByRole('figure', { name: /Nube Sur LLC/ });
  expect(names(fig)).toEqual(['Nube Sur LLC', 'Nube Sur LLC']); // label + summary
  expect(screen.getAllByText('Beneficiario no leído').every((e) => !e.closest('[data-user]'))).toBe(true);
  expect(fig.querySelector('.chart-legend [data-user]')).toBeNull();
});
