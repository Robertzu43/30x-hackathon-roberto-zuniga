import { Frame, useFmt, type Series } from './shared';

/** Columns by day, stacked by series (values[i] belongs to series[i]). */
export default function StackedBars({ title, unit, series, rows, height }: {
  title: string; unit: string; series: Series[]; rows: { day: string; values: number[] }[]; height?: number;
}) {
  const { t, n, d } = useFmt();
  const totals = series.map((_, i) => rows.reduce((a, r) => a + (r.values[i] ?? 0), 0));
  const total = totals.reduce((a, b) => a + b, 0);
  const max = Math.max(...rows.map((r) => r.values.reduce((a, b) => a + b, 0)));
  const parts = series.map((s, i) => `${s.label} ${n(totals[i] ?? 0)}`).join(', ');
  const col = (r: (typeof rows)[number]) => `${d(r.day)}: ${series.map((s, i) => `${s.label} ${n(r.values[i] ?? 0)}`).join(', ')}`;
  return (
    <Frame title={title} unit={unit} height={height} empty={total === 0} legend={series}
      summary={t('charts.sum.stacked', { title, total: n(total), unit, n: rows.length, parts })}
      table={{ head: [t('charts.day'), ...series.map((s) => s.label)], rows: rows.map((r) => [d(r.day), ...series.map((_, i) => n(r.values[i] ?? 0))]) }}>
      <div className="chart-cols" aria-hidden="true">
        {rows.map((r) => (
          <div className="chart-col" key={r.day} title={col(r)} style={{ height: `${(r.values.reduce((a, b) => a + b, 0) / max) * 100}%` }}>
            {series.map((s, i) => (r.values[i] ? <span key={s.label} className={`tone-${s.tone}`} style={{ flexGrow: r.values[i] }} /> : null))}
          </div>
        ))}
      </div>
      <div className="chart-axis" aria-hidden="true">
        <span>{d(rows[0]?.day)}</span><span>{d(rows[rows.length - 1]?.day)}</span>
      </div>
    </Frame>
  );
}
