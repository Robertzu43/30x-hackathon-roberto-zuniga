import { Fragment, type CSSProperties } from 'react';
import { Frame, useFmt, type Series } from './shared';

const ONE: Series[] = [{ label: '', tone: 'ink' }]; // a single measure: one ink colour, no legend

/** Horizontal bars, one row per label; values[i] belongs to series[i]. The value sits at the bar tip as text. `user` marks the label as company data (R-142). */
export default function HBars({ title, unit, series = ONE, rows, height }: {
  title: string; unit: string; series?: Series[]; rows: { label: string; values: number[]; user?: boolean }[]; height?: number;
}) {
  const { t, n } = useFmt(unit);
  const max = Math.max(...rows.flatMap((r) => r.values));
  const many = series.length > 1;
  const rest = (r: { values: number[] }) => (many ? ` (${series.map((s, i) => `${s.label} ${n(r.values[i] ?? 0)}`).join(', ')})` : ` ${n(r.values[0] ?? 0)}`);
  const parts = rows.map((r) => r.label + rest(r)).join(', ');
  const [head = '', tail = ''] = t('charts.sum.list', { title, unit, parts: '\u0000' }).split('\u0000'); // the sentence, with the parts as nodes
  return (
    <Frame title={title} unit={unit} height={height} empty={!(max > 0)} legend={series}
      summary={t('charts.sum.list', { title, unit, parts })}
      summaryNode={<>{head}{rows.map((r, i) => <Fragment key={r.label}>{i > 0 && ', '}{r.user ? <span data-user>{r.label}</span> : r.label}{rest(r)}</Fragment>)}{tail}</>}>
      <ul className="chart-hbars">
        {rows.map((r) => (
          <li key={r.label} title={r.label}>
            <span className="chart-hlabel" data-user={r.user || undefined}>{r.label}</span>
            <span className="chart-htracks">
              {series.map((s, i) => (
                <span className="chart-hrow" key={s.label}>
                  <span className={`chart-hbar tone-${s.tone}`} style={{ '--r': (r.values[i] ?? 0) / max } as CSSProperties} aria-hidden="true" />
                  <span className="chart-hvalue">{n(r.values[i] ?? 0)}</span>
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </Frame>
  );
}
