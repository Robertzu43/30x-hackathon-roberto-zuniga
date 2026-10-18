import { Frame, useFmt } from './shared';

const W = 100;
const H = 100;

/** One measure over days. A null value is a day with no data: the line stops there (no projection). `ref` is a labelled horizontal line. */
export default function Line({ title, unit, points, reference, height }: {
  title: string; unit: string; points: { day: string; value: number | null }[]; reference?: { label: string; value: number }; height?: number;
}) {
  const { t, n, d } = useFmt(unit);
  const v = (x: number) => (unit === '%' ? n(x) : `${n(x)} ${unit}`); // a percentage carries its own sign (R-164)
  const known = points.flatMap((p, i) => (p.value === null ? [] : [{ ...p, i, value: p.value }]));
  const vals = [...known.map((p) => p.value), reference?.value ?? 0, 0];
  const top = Math.max(...vals);
  const low = Math.min(...vals); // zero is always on the axis; negative values (over budget) get room below it
  const span = top - low || 1;
  const x = (i: number) => (points.length < 2 ? W / 2 : (i / (points.length - 1)) * W);
  const y = (v: number) => H - ((v - low) / span) * H;
  const last = known[known.length - 1];
  const runs = known.reduce<typeof known[]>((acc, p) => {
    const run = acc.at(-1);
    if (run && run.at(-1)?.i === p.i - 1) run.push(p);
    else acc.push([p]);
    return acc;
  }, []); // a null day ends a run: no segment is drawn across it
  const dots = [...runs.filter((r) => r.length === 1).flat(), ...(last ? [last] : [])].filter((p, k, a) => a.indexOf(p) === k);
  const summary = last
    ? t('charts.sum.line', {
        title, last: v(last.value), date: d(last.day), max: v(Math.max(...known.map((p) => p.value))),
        ref: reference ? t('charts.sum.ref', { label: reference.label, value: n(reference.value) }) : '',
      })
    : '';
  return (
    <Frame title={title} unit={unit} height={height} empty={!last} summary={summary}
      table={{ head: [t('charts.day'), unit], rows: known.map((p) => [d(p.day), n(p.value)]) }}>
      <div className="chart-line" aria-hidden="true">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {reference && <line className="chart-ref" x1="0" x2={W} y1={y(reference.value)} y2={y(reference.value)} />}
          {low < 0 && <line className="chart-zero" x1="0" x2={W} y1={y(0)} y2={y(0)} />}
          {runs.map((r) => <polyline key={r.at(0)?.i} className="chart-path" points={r.map((p) => `${x(p.i)},${y(p.value)}`).join(' ')} />)}
        </svg>
        {dots.map((p) => <i key={p.i} className="chart-dot" style={{ left: `${x(p.i)}%`, top: `${y(p.value)}%` }} />)}
        {!reference && <span className="chart-ymax">{n(top)}</span>}
        {reference && <span className="chart-reflabel" style={{ top: `${y(reference.value)}%` }}>{reference.label} {n(reference.value)}</span>}
      </div>
      <div className="chart-axis" aria-hidden="true">
        <span>{d(points[0]?.day)}</span><span>{d(points[points.length - 1]?.day)}</span>
      </div>
    </Frame>
  );
}
