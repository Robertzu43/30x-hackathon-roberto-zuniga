import { Frame, useFmt } from './shared';

const W = 100;
const H = 100;

/** One measure over days. A null value is a day with no data: the line stops there (no projection). `ref` is a labelled horizontal line. */
export default function Line({ title, unit, points, reference, height }: {
  title: string; unit: string; points: { day: string; value: number | null }[]; reference?: { label: string; value: number }; height?: number;
}) {
  const { t, n, d } = useFmt();
  const known = points.flatMap((p, i) => (p.value === null ? [] : [{ ...p, i, value: p.value }]));
  const top = Math.max(...known.map((p) => p.value), reference?.value ?? 0, 0) || 1;
  const x = (i: number) => (points.length < 2 ? W / 2 : (i / (points.length - 1)) * W);
  const y = (v: number) => H - (v / top) * H;
  const last = known[known.length - 1];
  const summary = last
    ? t('charts.sum.line', {
        title, unit, last: n(last.value), date: d(last.day), max: n(Math.max(...known.map((p) => p.value))),
        ref: reference ? t('charts.sum.ref', { label: reference.label, value: n(reference.value) }) : '',
      })
    : '';
  return (
    <Frame title={title} unit={unit} height={height} empty={!last} summary={summary}
      table={{ head: [t('charts.day'), unit], rows: known.map((p) => [d(p.day), n(p.value)]) }}>
      <div className="chart-line" aria-hidden="true">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {reference && <line className="chart-ref" x1="0" x2={W} y1={y(reference.value)} y2={y(reference.value)} />}
          <polyline className="chart-path" points={known.map((p) => `${x(p.i)},${y(p.value)}`).join(' ')} />
        </svg>
        {last && <i className="chart-dot" style={{ left: `${x(last.i)}%`, top: `${y(last.value)}%` }} />}
        {!reference && <span className="chart-ymax">{n(top)}</span>}
        {reference && <span className="chart-reflabel" style={{ top: `${y(reference.value)}%` }}>{reference.label} {n(reference.value)}</span>}
      </div>
      <div className="chart-axis" aria-hidden="true">
        <span>{d(points[0]?.day)}</span><span>{d(points[points.length - 1]?.day)}</span>
      </div>
    </Frame>
  );
}
