import { useFmt } from './shared';

/** A stat tile: label, one value formatted for the tab's locale, an optional unit word and hint. No value shows "Sin datos", never a made-up number. */
export default function Kpi({ label, value, kind, unit, hint, height = 96 }: {
  label: string; value: number | null; kind: 'usd' | 'count' | 'pct'; unit?: string; hint?: string; height?: number;
}) {
  const { t, locale } = useFmt();
  const text = value === null ? t('charts.na')
    : kind === 'usd' ? new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(value)
    : kind === 'pct' ? new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(value / 100)
    : new Intl.NumberFormat(locale).format(value);
  return (
    <div className="chart-kpi" role="group" aria-label={`${label}: ${text}${value !== null && unit ? ` ${unit}` : ''}`} style={{ minHeight: height }}>
      <span className="chart-kpi-label">{label}</span>
      <b className={value === null ? 'chart-kpi-value chart-kpi-na' : 'chart-kpi-value'}>{text}{value !== null && unit && <span className="chart-unit"> {unit}</span>}</b>
      {hint && <span className="chart-kpi-hint">{hint}</span>}
    </div>
  );
}
