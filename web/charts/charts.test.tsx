import { Suspense } from 'react';
import { screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { expect, test } from 'vitest';
import { renderAt } from '../test/utils';
import HBars from './HBars';
import Kpi from './Kpi';
import Line from './Line';
import * as lazy from './lazy';
import Segments from './Segments';
import Sparkline from './Sparkline';
import StackedBars from './StackedBars';

// The approved palette (AC-53 Clarified), as `PALETTE` in scripts/ux-gate.mjs.
const PALETTE = ['#000000', '#111111', '#333333', '#346538', '#6d6c69', '#956400', '#9f2f2d', '#eaeaea', '#edf3ec', '#f1efe9', '#fbf3db', '#fbfbfa', '#fdebec', '#ffffff'];
const series = [
  { label: 'PAGAR', tone: 'pagar' as const }, { label: 'FRENAR', tone: 'frenar' as const },
  { label: 'ESCALAR', tone: 'escalar' as const }, { label: 'pendiente', tone: 'pending' as const },
];
const rows = [
  { day: '2026-10-15', values: [2, 1, 0, 0] },
  { day: '2026-10-16', values: [1, 0, 0, 1] },
  { day: '2026-10-17', values: [0, 0, 0, 1] },
];
const stacked = <StackedBars title="Facturas por día" unit="facturas" series={series} rows={rows} />;
const hbars = <HBars title="Pagado por moneda" unit="USD" rows={[{ label: 'COP', values: [4200] }, { label: 'USD', values: [1500.5] }]} />;
const grouped = (
  <HBars title="Por beneficiario" unit="USD" series={[{ label: 'Pagado', tone: 'ink' }, { label: 'Comprometido', tone: 'pending' }]}
    rows={[{ label: 'Nube Sur LLC', values: [0, 4200] }]} />
);
const line = (
  <Line title="Presupuesto disponible" unit="USD" reference={{ label: 'presupuesto', value: 10000 }}
    points={[{ day: '2026-10-15', value: 10000 }, { day: '2026-10-16', value: 4299.5 }, { day: '2026-10-17', value: null }]} />
);
const spark = <Sparkline title="Últimas facturas pagadas" unit="USD" values={[100, 250.5, 80]} />;
const segments = <Segments title="Reglas" unit="reglas" segments={[{ label: 'cumplen', value: 11, tone: 'pagar' }, { label: 'no cumplen', value: 2, tone: 'frenar' }]} />;

test('every chart has a one-sentence summary as its aria-label (es)', () => {
  const sentences = [stacked, hbars, grouped, line, spark, segments].map((ui) => {
    const { container, unmount } = renderAt(ui);
    const s = container.querySelector('figure')!.getAttribute('aria-label');
    unmount();
    return s;
  });
  expect(sentences).toEqual([
    'Facturas por día: 6 facturas en 3 días, PAGAR 3, FRENAR 1, ESCALAR 0, pendiente 2.',
    'Pagado por moneda, en USD: COP 4.200, USD 1.500,5.',
    'Por beneficiario, en USD: Nube Sur LLC (Pagado 0, Comprometido 4.200).',
    'Presupuesto disponible: 4.299,5 USD el 16 de oct, máximo 10.000 USD, presupuesto 10.000.',
    'Últimas facturas pagadas: 3 valores en USD, el último 80, entre 80 y 250,5.',
    'Reglas, en reglas: cumplen 11, no cumplen 2.',
  ]);
});

test('numbers and dates follow the tab language (en)', () => {
  localStorage.setItem('lang', 'en');
  const { container } = renderAt(line);
  expect(container.querySelector('figure')!.getAttribute('aria-label')).toBe(
    'Presupuesto disponible: 4,299.5 USD on Oct 16, highest 10,000 USD, presupuesto 10,000.',
  );
});

test('the summary is also visible, with the title and its unit', () => {
  renderAt(stacked);
  const fig = screen.getByRole('figure');
  expect(within(fig).getByText('Facturas por día', { selector: '.chart-title span' })).toBeTruthy();
  expect(within(fig).getByText('facturas', { selector: '.chart-unit' })).toBeTruthy();
  expect(within(fig).getByText('Facturas por día: 6 facturas en 3 días, PAGAR 3, FRENAR 1, ESCALAR 0, pendiente 2.', { selector: 'p' })).toBeTruthy();
});

test('legend has words, and values are reachable as a text table', () => {
  renderAt(stacked);
  const fig = screen.getByRole('figure');
  for (const w of ['PAGAR', 'FRENAR', 'ESCALAR', 'pendiente']) expect(within(fig).getAllByText(w, { selector: 'li' }).length).toBe(1);
  const table = within(fig).getByRole('table');
  expect(within(table).getByRole('row', { name: '15 de oct 2 1 0 0' })).toBeTruthy();
  expect(within(table).getAllByRole('row').length).toBe(4); // head + 3 days
});

test('a single-measure chart has no legend and one ink colour', () => {
  const { container } = renderAt(hbars);
  expect(container.querySelector('.chart-legend')).toBeNull();
  expect(container.querySelectorAll('.tone-ink').length).toBe(2);
  expect(screen.getByText('1.500,5')).toBeTruthy();
});

test('grouped bars have a legend with words', () => {
  const { container } = renderAt(grouped);
  expect([...container.querySelectorAll('.chart-legend li')].map((li) => li.textContent)).toEqual(['Pagado', 'Comprometido']);
});

test('segments print every value with its word', () => {
  renderAt(segments);
  expect(screen.getByText('cumplen')).toBeTruthy();
  expect(screen.getByText('11')).toBeTruthy();
});

test('Kpi formats by locale and kind, and has a name', () => {
  renderAt(<Kpi label="Por pagar hoy" value={1500.5} kind="usd" hint="3 órdenes preparadas hoy" />);
  expect(screen.getByRole('group', { name: /Por pagar hoy: .*1\.500,50/ })).toBeTruthy();
  expect(screen.getByText('3 órdenes preparadas hoy')).toBeTruthy();
});

test('Kpi without a value says so instead of printing a placeholder number', () => {
  renderAt(<Kpi label="Autonomía" value={null} kind="pct" />);
  expect(screen.getByText('Sin datos')).toBeTruthy();
});

test.each([
  ['stacked', <StackedBars key="a" title="Facturas por día" unit="facturas" series={series} rows={[]} />],
  ['stacked zeros', <StackedBars key="a" title="Facturas por día" unit="facturas" series={series} rows={[{ day: '2026-10-15', values: [0, 0, 0, 0] }]} />],
  ['hbars', <HBars key="b" title="Pagado por moneda" unit="USD" rows={[]} />],
  ['line', <Line key="c" title="Presupuesto disponible" unit="USD" points={[{ day: '2026-10-15', value: null }]} />],
  ['sparkline', <Sparkline key="d" title="Últimas facturas pagadas" unit="USD" values={[]} />],
  ['segments', <Segments key="e" title="Reglas" unit="reglas" segments={[{ label: 'cumplen', value: 0, tone: 'pagar' }]} />],
])('%s with no data shows the designed empty state and keeps its height', (name, ui) => {
  const { container } = renderAt(ui);
  expect(screen.getByText('Todavía no hay datos para este gráfico.')).toBeTruthy();
  expect(container.querySelector('figure')!.getAttribute('aria-label')).toMatch(/: Todavía no hay datos para este gráfico\.$/);
  expect((container.querySelector('.chart-body') as HTMLElement).style.minHeight).toBe({ sparkline: '64px', segments: '48px' }[name] ?? '160px');
});

test('the empty state is in English in an English tab, and height is configurable', () => {
  localStorage.setItem('lang', 'en');
  const { container } = renderAt(<HBars title="Paid by currency" unit="USD" rows={[]} height={96} />);
  expect(screen.getByText('No data for this chart yet.')).toBeTruthy();
  expect((container.querySelector('.chart-body') as HTMLElement).style.minHeight).toBe('96px');
});

test('charts.css uses only approved palette colours and no animation', async () => {
  const { readFileSync } = (await import('node:fs' as string)) as { readFileSync(p: string, enc: string): string };
  const css = readFileSync('web/charts/charts.css', 'utf8');
  const hexes = [...new Set(css.match(/#[0-9a-f]{3,8}\b/gi) ?? [])].map((h) => h.toLowerCase());
  expect(hexes.length).toBeGreaterThan(0);
  expect(hexes.filter((h) => !PALETTE.includes(h))).toEqual([]);
  for (const c of ['#346538', '#9f2f2d', '#956400', '#6d6c69']) expect(hexes).toContain(c);
  expect(css).not.toMatch(/animation|transition/);
});

test('lazy wrappers load the chart on demand and render it', async () => {
  const { container } = renderAt(<Suspense fallback={null}><lazy.StackedBars title="Facturas por día" unit="facturas" series={series} rows={rows} /></Suspense>);
  expect(await screen.findByRole('figure')).toBeTruthy();
  expect(container.querySelector('.chart-body')).toBeTruthy();
});

test('axe finds no serious or critical violation in any chart state', async () => {
  const all = [stacked, hbars, grouped, line, spark, segments, <Kpi key="k" label="Autonomía" value={75} kind="pct" />,
    <HBars key="e" title="Vacío" unit="USD" rows={[]} />];
  for (const ui of all) {
    const { container, unmount } = renderAt(<main><h1>t</h1>{ui}</main>);
    const r = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
    unmount();
  }
});

test('hbar lengths are proportional: 100% and 85% of the maximum render different widths, none clamped', async () => {
  const { container } = renderAt(<HBars title="Pagado" unit="USD" rows={[{ label: 'a', values: [100] }, { label: 'b', values: [85] }, { label: 'c', values: [50] }]} />);
  const r = [...container.querySelectorAll<HTMLElement>('.chart-hbar')].map((el) => Number(el.style.getPropertyValue('--r')));
  expect(r).toEqual([1, 0.85, 0.5]);
  const { readFileSync } = (await import('node:fs' as string)) as { readFileSync(p: string, enc: string): string };
  expect(readFileSync('web/charts/charts.css', 'utf8')).not.toMatch(/\.chart-hbar \{[^}]*max-width/);
});

const day = (i: number) => `2026-10-${String(10 + i)}`;
const series_ = (vs: (number | null)[]) => vs.map((value, i) => ({ day: day(i), value }));

test('a null day stops the line: [a, null, b, c] draws two polylines and a dot on the isolated point', () => {
  const { container } = renderAt(<Line title="Presupuesto" unit="USD" points={series_([10, null, 4, 3])} />);
  const lines = [...container.querySelectorAll('polyline')].map((p) => p.getAttribute('points')!.split(' ').length);
  expect(lines).toEqual([1, 2]);
  expect(container.querySelectorAll('.chart-dot').length).toBe(2); // isolated first point + latest
});

test('an over-budget (negative) value is drawn above the bottom edge with a visible zero line', () => {
  const { container } = renderAt(<Line title="Presupuesto" unit="USD" points={series_([5000, -2000])} />);
  const ys = container.querySelector('polyline')!.getAttribute('points')!.split(' ').map((p) => Number(p.split(',')[1]));
  expect(Math.max(...ys)).toBeLessThanOrEqual(100);
  expect(ys[1]).toBe(100); // lowest value sits on the bottom edge
  const zero = container.querySelector('.chart-zero')!;
  expect(Number(zero.getAttribute('y1'))).toBeCloseTo(100 - (2000 / 7000) * 100);
  expect(renderAt(<Line title="P" unit="USD" points={series_([5, 4])} />).container.querySelector('.chart-zero')).toBeNull();
});
