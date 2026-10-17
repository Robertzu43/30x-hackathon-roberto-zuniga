import type { CSSProperties } from 'react';
import { Frame, useFmt, type Series } from './shared';

const ONE: Series[] = [{ label: '', tone: 'ink' }]; // a single measure: one ink colour, no legend

/** Horizontal bars, one row per label; values[i] belongs to series[i]. The value sits at the bar tip as text. */
export default function HBars({ title, unit, series = ONE, rows, height }: {
  title: string; unit: string; series?: Series[]; rows: { label: string; values: number[] }[]; height?: number;
}) {
  const { t, n } = useFmt();
  const max = Math.max(...rows.flatMap((r) => r.values));
  const many = series.length > 1;
  const parts = rows.map((r) => (many ? `${r.label} (${series.map((s, i) => `${s.label} ${n(r.values[i] ?? 0)}`).join(', ')})` : `${r.label} ${n(r.values[0] ?? 0)}`)).join(', ');
  return (
    <Frame title={title} unit={unit} height={height} empty={!(max > 0)} legend={series}
      summary={t('charts.sum.list', { title, unit, parts })}>
      <ul className="chart-hbars">
        {rows.map((r) => (
          <li key={r.label} title={r.label}>
            <span className="chart-hlabel">{r.label}</span>
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
