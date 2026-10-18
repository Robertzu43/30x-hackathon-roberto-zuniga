import { Frame, useFmt } from './shared';

const W = 100;
const H = 100;

/** Small trend line in the muted ink; the latest value gets the dot. Needs no axis: min, max and latest are in the summary. */
export default function Sparkline({ title, unit, values, height = 64 }: { title: string; unit: string; values: number[]; height?: number }) {
  const { t, n, locale } = useFmt(unit);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const x = (i: number) => (values.length < 2 ? W / 2 : (i / (values.length - 1)) * W);
  const y = (v: number) => (max === min ? H / 2 : H - ((v - min) / (max - min)) * H);
  const last = values[values.length - 1] ?? 0;
  return (
    <Frame title={title} unit={unit} height={height} empty={values.length === 0}
      summary={t(`charts.sum.spark.${new Intl.PluralRules(locale).select(values.length) === 'one' ? 'one' : 'other'}`, { title, n: values.length, unit, last: n(last), min: n(min), max: n(max) })}
      table={{ head: ['#', unit], rows: values.map((v, i) => [String(i + 1), n(v)]) }}>
      <div className="chart-line chart-spark" aria-hidden="true">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <polyline className="chart-path chart-path-muted" points={values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
        </svg>
        <i className="chart-dot" style={{ left: `${x(values.length - 1)}%`, top: `${y(last)}%` }} />
      </div>
    </Frame>
  );
}
