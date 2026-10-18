// Bandeja's finance dashboard and invoice table (AC-101, AC-106, AC-29 R-79), on Task 45's `dashboard` contract, mocked.
import { fireEvent, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { expect, test, vi } from 'vitest';
import { renderAt } from '../test/utils';
import Dashboard, { type DashboardData } from './Dashboard';
import InvoiceTable, { type Row } from './InvoiceTable';

const day = (d: number) => `2026-09-${String(d).padStart(2, '0')}`;
const DATA: DashboardData = {
  kpis: { to_pay_today_usd: 4800.5, to_pay_today_count: 2, awaiting_count: 5, awaiting_usd: 9600, stopped_month_count: 3, autonomy_pct: 80, autonomy_n: 8, autonomy_m: 10 },
  by_day: Array.from({ length: 30 }, (_, i) => ({ day: day(i + 1), PAGAR: i === 29 ? 2 : 0, FRENAR: i === 29 ? 1 : 0, ESCALAR: i === 28 ? 1 : 0, pending: 0 })),
  by_currency: [{ currency: 'COP', usd: 1500 }, { currency: null, usd: 200 }],
  by_country: [{ country: 'CO', usd: 1500 }, { country: null, usd: 200 }],
  due_soon: [
    { invoice_id: 'd1', payee: 'Nubia Diseño', amount: 1200, currency: 'USD', amount_usd: 1200, due_date: '2026-10-20', outcome: 'PAGAR' },
    { invoice_id: 'd2', payee: null, amount: null, currency: null, amount_usd: null, due_date: '2026-10-22', outcome: null },
  ],
  due_soon_total: 7,
  approvals: [
    { invoice_id: 'e1', payee: 'Kodex Labs', amount: 4800, currency: 'USD', question_es: '¿Apruebo 4.800 USD a Kodex Labs?', question_en: 'Do I approve 4,800 USD to Kodex Labs?', decided_at: '2026-10-01T10:00:00Z' },
    { invoice_id: 'e2', payee: 'Pixel Lab', amount: 900, currency: 'EUR', question_es: '¿Pago la factura duplicada?', question_en: 'Do I pay the duplicate invoice?', decided_at: '2026-10-02T10:00:00Z' },
  ],
  approvals_total: 5,
};
const EMPTY: DashboardData = {
  kpis: { to_pay_today_usd: 0, to_pay_today_count: 0, awaiting_count: 0, awaiting_usd: 0, stopped_month_count: 0, autonomy_pct: null, autonomy_n: 0, autonomy_m: 0 },
  by_day: DATA.by_day.map((d) => ({ ...d, PAGAR: 0, FRENAR: 0, ESCALAR: 0, pending: 0 })),
  by_currency: [], by_country: [], due_soon: [], due_soon_total: 0, approvals: [], approvals_total: 0,
};
const show = (data = DATA, onMore = () => {}) => renderAt(<Dashboard data={data} onMore={onMore} />);
const region = (name: string) => screen.getByRole('region', { name });
const NO_DATA = 'Todavía no hay datos para este gráfico.';

test('KPI strip: four tiles with the R-124 figures in the tab locale (AC-101)', async () => {
  show();
  expect((await screen.findByRole('group', { name: /^Por pagar hoy: / })).textContent).toMatch(/US\$\s4\.800,50.*2 órdenes preparadas hoy/);
  expect((await screen.findByRole('group', { name: 'Esperando tu aprobación: 5' })).textContent).toMatch(/US\$\s9\.600,00/);
  expect(await screen.findByRole('group', { name: 'Frenadas este mes: 3' })).toBeTruthy();
  // AC-44's figure and the same "n de m" line as Periodo
  expect((await screen.findByRole('group', { name: /^Autonomía: 80\s?%$/ })).textContent).toContain('8 de 10 facturas decididas solas y correctamente');
});

test('during a run the four tiles read «Decidiendo… n de m» and no figure; without a run they show the figures (AC-121)', async () => {
  const { unmount } = renderAt(<Dashboard data={DATA} onMore={() => {}} run={{ n: 15, m: 29 }} />);
  const tiles = await screen.findAllByRole('group', { name: /^(Por pagar hoy|Esperando tu aprobación|Frenadas este mes|Autonomía): Decidiendo… 15 de 29$/ });
  expect(tiles).toHaveLength(4);
  for (const t of tiles) expect(t.textContent!.replace(/15|29/g, '')).not.toMatch(/[%$\d]/);
  unmount();
  renderAt(<Dashboard data={DATA} onMore={() => {}} run={null} />);
  expect(await screen.findByRole('group', { name: 'Frenadas este mes: 3' })).toBeTruthy();
});

test('during a run the Autonomía tile holds the hint\'s lines for its final width, n = m: the hint wraps by its digits (AC-121, R-176)', async () => {
  const { container } = renderAt(<Dashboard data={{ ...DATA, kpis: { ...DATA.kpis, autonomy_pct: null, autonomy_n: 0, autonomy_m: 0 } }} onMore={() => {}} run={{ n: 7, m: 29 }} />);
  await screen.findByRole('group', { name: 'Autonomía: Decidiendo… 7 de 29' });
  expect([...container.querySelectorAll('.chart-kpi-hold')].map((h) => h.getAttribute('data-hint')).pop()).toBe('29 de 29 facturas decididas solas y correctamente');
});

test('in English the tiles read «Deciding… n of m» (AC-121)', async () => {
  localStorage.setItem('lang', 'en');
  renderAt(<Dashboard data={DATA} onMore={() => {}} run={{ n: 15, m: 29 }} />);
  expect(await screen.findAllByRole('group', { name: /: Deciding… 15 of 29$/ })).toHaveLength(4);
  localStorage.clear();
});

test('one order prepared today reads in the singular', async () => {
  show({ ...DATA, kpis: { ...DATA.kpis, to_pay_today_count: 1 } });
  expect((await screen.findByRole('group', { name: /^Por pagar hoy: / })).textContent).toContain('1 orden preparada hoy');
});

test('the KPI strip sits 2 x 2 on phones and in one row on wide screens (AC-101)', async () => {
  const { readFileSync } = (await import('node:fs' as string)) as { readFileSync(p: string, enc: string): string };
  const css = readFileSync('web/dashboard/dashboard.css', 'utf8');
  expect(css).toMatch(/\n\.dash-kpis \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  expect(css.split('@media (min-width: 900px) {')[1]).toMatch(/\.dash-kpis \{[^}]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
});

test('«Necesita tu respuesta»: the stored question in Spanish, «Responder» to Detalle, no approve or reject here', async () => {
  show();
  const r = region('Necesita tu respuesta');
  const items = within(r).getAllByRole('listitem');
  expect(items).toHaveLength(2);
  expect(items[0]!.textContent).toContain('¿Apruebo 4.800 USD a Kodex Labs?');
  expect(within(items[0]!).getByText('Kodex Labs').hasAttribute('data-user')).toBe(true);
  expect(within(items[0]!).getByRole('link', { name: 'Responder' }).getAttribute('href')).toBe('/invoices/e1');
  expect(within(r).queryAllByRole('button')).toHaveLength(0);
});

test('wide, «Necesita tu respuesta» spans the full row, with no empty half column beside it (R-166)', () => {
  show();
  expect(region('Necesita tu respuesta').classList.contains('dash-wide')).toBe(true);
});

test('«y 3 más» filters the table to ESCALAR and goes to it', async () => {
  const onMore = vi.fn();
  show(DATA, onMore);
  const more = within(region('Necesita tu respuesta')).getByRole('link', { name: 'y 3 más' });
  expect(more.getAttribute('href')).toBe('#invoices');
  fireEvent.click(more);
  expect(onMore).toHaveBeenCalledOnce();
});

test('approvals in English show the English question; no «more» when all are listed', async () => {
  localStorage.setItem('lang', 'en');
  show({ ...DATA, approvals_total: 2 });
  const r = region('Needs your answer');
  expect(r.textContent).toContain('Do I approve 4,800 USD to Kodex Labs?');
  expect(r.textContent).not.toContain('¿Apruebo');
  expect(within(r).getAllByRole('link', { name: 'Answer' })).toHaveLength(2);
  expect(within(r).queryByText(/more/)).toBeNull();
});

test('stacked bars by arrival day with the four outcome words (AC-101, AC-106)', async () => {
  show();
  const fig = await screen.findByRole('figure', { name: /^Facturas por día y resultado \(últimos 30 días\): 4 facturas en 30 días/ });
  expect(within(fig).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['PAGAR', 'FRENAR', 'ESCALAR', 'Pendiente']);
});

test('currency and country bars in USD; an unread currency and an unmatched country are named (R-124)', async () => {
  show();
  const cur = await screen.findByRole('figure', { name: /^Pagado este mes por moneda, en USD: / });
  expect(cur.textContent).toContain('COP');
  expect(cur.textContent).toContain('Moneda no leída');
  const country = await screen.findByRole('figure', { name: /^Pagado este mes por país, en USD: / });
  expect(country.textContent).toContain('Colombia');
  expect(country.textContent).toContain('Sin país en el directorio');
  expect(cur.textContent).toContain('1.500,00'); // R-166: money values with the tables' two decimals
});

test('«Vence pronto (7 días)»: each with its due date and USD, linked to Detalle, then «y 5 más»', async () => {
  show();
  const r = region('Vence pronto (7 días)');
  const items = within(r).getAllByRole('listitem');
  expect(items).toHaveLength(2);
  expect(items[0]!.textContent).toMatch(/Nubia Diseño.*20 de oct.*US\$\s1\.200,00/);
  expect(within(items[0]!).getByRole('link').getAttribute('href')).toBe('/invoices/d1');
  expect(items[1]!.textContent).toContain('Beneficiario no leído');
  expect(items[1]!.textContent).not.toMatch(/null|undefined|NaN/);
  expect(within(r).getByText('y 5 más')).toBeTruthy();
});

test('empty dashboard: designed empty states, no made-up numbers (AC-106.1)', async () => {
  show(EMPTY);
  expect(await screen.findByRole('group', { name: 'Autonomía: Sin datos' })).toBeTruthy();
  expect(region('Necesita tu respuesta').textContent).toContain('Nada espera tu respuesta.');
  expect(region('Vence pronto (7 días)').textContent).toContain('Nada vence en los próximos 7 días.');
  await screen.findByRole('figure', { name: /^Pagado este mes por país/ });
  expect(screen.getAllByText(NO_DATA)).toHaveLength(3);
  expect(document.body.textContent).not.toMatch(/null|undefined|NaN/);
});

test('the dashboard in English', async () => {
  localStorage.setItem('lang', 'en');
  show();
  expect((await screen.findByRole('group', { name: /^To pay today: / })).textContent).toMatch(/\$4,800\.50.*2 orders prepared today/);
  expect(await screen.findByRole('figure', { name: /^Invoices by day and outcome \(last 30 days\)/ })).toBeTruthy();
  expect(region('Due soon (7 days)').textContent).toMatch(/Oct 20/);
});

// The table (AC-101): search, sort and filters in the browser over the loaded rows.
const r = (id: string, o: Partial<Row> & { payee?: string | null; number?: string; concept?: string }): Row => ({
  id, outcome: null, headline: `línea ${id}`, received_at: '2026-10-10T15:00:00Z', amount_usd: null, origin: 'app', sender: null,
  fields: o.payee === null ? null : { payee_name: o.payee ?? 'Kodex Labs', invoice_number: o.number ?? null, concept: o.concept ?? null }, ...o,
});
const ROWS: Row[] = [
  r('a', { outcome: 'PAGAR', payee: 'Nubia Diseño', amount_usd: 1200, received_at: '2026-10-12T15:00:00Z', number: 'FE-77' }),
  r('b', { outcome: 'ESCALAR', payee: 'Kodex Labs', amount_usd: '4800.00', received_at: '2026-10-11T15:00:00Z', origin: 'portal', concept: 'Campaña de lanzamiento' }),
  r('c', { outcome: null, payee: 'Árbol Estudio', amount_usd: null, received_at: '2026-10-10T15:00:00Z', origin: 'email', sender: 'cobros@arbol.example' }),
  r('d', { outcome: 'FRENAR', payee: null, amount_usd: 300, received_at: '2026-10-09T15:00:00Z' }),
];
function Table({ rows = ROWS, directory = [] as { id: string; name: string }[], start = '' }) {
  const [outcome, setOutcome] = useState(start);
  return <InvoiceTable rows={rows} directory={directory} outcome={outcome} onOutcome={setOutcome} />;
}
const table = (p: Parameters<typeof Table>[0] = {}) => renderAt(<Table {...p} />);
const ids = () => screen.getAllByRole('row').slice(1).map((tr) => tr.getAttribute('data-id'));
const header = (name: string) => screen.getByRole('columnheader', { name });
const search = (q: string) => fireEvent.change(screen.getByLabelText('Buscar por beneficiario, número o concepto'), { target: { value: q } });

test('the table lists every row, newest first, with chip, beneficiary as data, headline link and USD (AC-29, AC-101)', () => {
  table();
  expect(ids()).toEqual(['a', 'b', 'c', 'd']);
  const first = screen.getAllByRole('row')[1]!;
  expect(within(first).getByText('PAGAR')).toBeTruthy();
  expect(within(first).getByText('Nubia Diseño').hasAttribute('data-user')).toBe(true);
  expect(within(first).getByRole('link', { name: 'línea a' }).getAttribute('href')).toBe('/invoices/a');
  expect(first.textContent).toMatch(/US\$\s1\.200,00/);
  expect(screen.getAllByRole('row')[4]!.textContent).toContain('Beneficiario no leído');
  expect(header('Fecha').getAttribute('aria-sort')).toBe('descending');
});

test('search ignores case and accents over beneficiary, number and concept', () => {
  table();
  search('ARBOL estudio');
  expect(ids()).toEqual(['c']);
  search('nubia diseno');
  expect(ids()).toEqual(['a']);
  search('fe-77');
  expect(ids()).toEqual(['a']);
  search('campana');
  expect(ids()).toEqual(['b']);
  search('no leído'); // the name the row shows
  expect(ids()).toEqual(['d']);
  search('zzz');
  expect(screen.getByText('Ninguna factura coincide con estos filtros.')).toBeTruthy();
});

test('a header click sorts and toggles the direction, with aria-sort', () => {
  table();
  fireEvent.click(within(header('Monto USD')).getByRole('button'));
  expect(header('Monto USD').getAttribute('aria-sort')).toBe('ascending');
  expect(header('Fecha').hasAttribute('aria-sort')).toBe(false);
  expect(ids()).toEqual(['d', 'a', 'b', 'c']); // no USD amount goes last
  fireEvent.click(within(header('Monto USD')).getByRole('button'));
  expect(header('Monto USD').getAttribute('aria-sort')).toBe('descending');
  expect(ids()).toEqual(['b', 'a', 'd', 'c']);
  fireEvent.click(within(header('Beneficiario')).getByRole('button'));
  expect(ids()).toEqual(['c', 'b', 'a', 'd']); // Árbol, Kodex, Nubia, «Beneficiario no leído» last
  fireEvent.click(within(header('Resultado')).getByRole('button'));
  expect(ids()).toEqual(['a', 'd', 'b', 'c']); // PAGAR, FRENAR, ESCALAR, pendiente
  fireEvent.click(within(header('Fecha')).getByRole('button'));
  expect(ids()).toEqual(['d', 'c', 'b', 'a']);
});

test('filters by outcome (pendiente included) and by origin', () => {
  table();
  fireEvent.change(screen.getByLabelText('Resultado'), { target: { value: 'pending' } });
  expect(ids()).toEqual(['c']);
  fireEvent.change(screen.getByLabelText('Resultado'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Origen'), { target: { value: 'portal' } });
  expect(ids()).toEqual(['b']);
  fireEvent.change(screen.getByLabelText('Origen'), { target: { value: 'app' } });
  expect(ids()).toEqual(['a', 'd']);
  expect(within(screen.getByLabelText('Origen')).getAllByRole('option').map((o) => o.textContent))
    .toEqual(['Todos', 'Subida en la app', 'Portal de proveedores', 'Correo']);
});

test('the outcome filter is the page\'s, so «y n más» can set it', () => {
  table({ start: 'ESCALAR' });
  expect(ids()).toEqual(['b']);
  expect(screen.getByLabelText('Resultado')).toHaveProperty('value', 'ESCALAR');
});

test('the beneficiary filter groups like Periodo from the top-level directory (R-79, R-132)', () => {
  table({
    rows: [r('n2', { payee: 'Contadores Andinos SAS', received_at: '2026-10-12T15:00:00Z' }), r('k1', { payee: 'Kodex Labs', received_at: '2026-10-11T15:00:00Z' }),
      r('n1', { payee: 'Contadores Andinos S.A.S.', received_at: '2026-10-10T15:00:00Z' }), r('u1', { payee: null, received_at: '2026-10-09T15:00:00Z' })],
    directory: [{ id: 'b1', name: 'Contadores Andinos' }],
  });
  const select = screen.getByLabelText('Beneficiario');
  const options = within(select).getAllByRole('option');
  expect(options.map((o) => o.textContent)).toEqual(['Todos', 'Contadores Andinos', 'Kodex Labs', 'Beneficiario no leído']);
  fireEvent.change(select, { target: { value: (options[1] as HTMLOptionElement).value } });
  expect(ids()).toEqual(['n2', 'n1']);
});

test('no invoices: the empty message, the filters stay', () => {
  table({ rows: [] });
  expect(screen.getByText(/^Todavía no hay facturas\./)).toBeTruthy();
  expect(screen.getByLabelText('Resultado')).toBeTruthy();
});

test('the table in English: headers, origin words and outcome words follow the tab', () => {
  localStorage.setItem('lang', 'en');
  table();
  expect(screen.getAllByRole('columnheader').map((h) => h.textContent!.replace(/ [↑↓]$/, ''))).toEqual(['Date', 'Beneficiary', 'Invoice', 'Amount USD', 'Outcome']);
  expect(screen.getAllByRole('row')[1]!.textContent).toMatch(/\$1,200\.00/);
  expect(within(screen.getAllByRole('row')[1]!).getByText('PAY')).toBeTruthy();
});
