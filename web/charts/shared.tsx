import type { CSSProperties, ReactNode } from 'react';
import { useT } from '../i18n';
import './charts.css';

export type Tone = 'pagar' | 'frenar' | 'escalar' | 'pending' | 'ink' | 'track';
export type Series = { label: string; tone: Tone };

/** Locale formats (AC-106.3): numbers from the tab's locale; day strings are plain 'YYYY-MM-DD' so they render in UTC. */
export function useFmt() {
  const { t, locale } = useT();
  const num = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return { t, locale, n: (v: number) => num.format(v), d: (s?: string) => (s ? day.format(new Date(`${s}T00:00:00Z`)) : '') };
}

export const DEFAULT_HEIGHT = 160;

/** Title + unit, one-sentence summary (visible and the aria-label), a body that keeps its height, and an optional text table. */
export function Frame({ title, unit, summary, empty, height = DEFAULT_HEIGHT, legend, table, children }: {
  title: string; unit: string; summary: string; empty: boolean; height?: number;
  legend?: Series[]; table?: { head: string[]; rows: string[][] }; children: ReactNode;
}) {
  const { t } = useT();
  return (
    <figure className="chart" aria-label={empty ? `${title}: ${t('charts.empty')}` : summary}>
      <figcaption className="chart-title"><span>{title}</span> <span className="chart-unit">{unit}</span></figcaption>
      <div className="chart-body" style={{ minHeight: height, '--h': `${height}px` } as CSSProperties}>
        {empty ? <p className="chart-empty">{t('charts.empty')}</p> : children}
      </div>
      {!empty && legend && legend.length > 1 && (
        <ul className="chart-legend">{legend.map((s) => <li key={s.label}><i className={`chart-swatch tone-${s.tone}`} aria-hidden="true" />{s.label}</li>)}</ul>
      )}
      {!empty && <p className="chart-summary">{summary}</p>}
      {!empty && table && (
        <table className="chart-sr">
          <caption>{title}</caption>
          <thead><tr>{table.head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
          <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}</tr>)}</tbody>
        </table>
      )}
    </figure>
  );
}
