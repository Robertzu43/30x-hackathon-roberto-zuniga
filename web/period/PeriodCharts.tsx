// Periodo's charts (AC-103, R-124): props in (the `charts` payload of /api/screen/period and the AC-44 table rows), JSX out.
import { useT } from '../i18n';
import { HBars, Kpi, Line, Segments } from '../charts/lazy';

export type Charts = {
  budget_usd: number | null;
  burn: { day: string; available_usd: number | null }[];
  stack: { paid: number; escalated: number; available: number | null; over: number | null };
  outcomes: { PAGAR: number; FRENAR: number; ESCALAR: number; pending: number };
  trend: { day: string; autonomy_pct: number; violations: number }[];
};
type Row = { beneficiary: string | null; paid_usd: number; committed_usd: number };

export default function PeriodCharts({ charts: c, byBeneficiary }: { charts: Charts; byBeneficiary: Row[] }) {
  const { t, locale } = useT();
  const usd = (n: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', currencyDisplay: 'code' }).format(n);
  const last = c.trend.at(-1);
  const { stack: s, outcomes: o } = c;
  return (
    <>
      <h2>{t('periodviz.heading')}</h2>
      <div className="period-charts">
        <Line title={t('periodviz.burn')} unit="USD" points={c.burn.map((b) => ({ day: b.day, value: b.available_usd }))}
          reference={c.budget_usd === null ? undefined : { label: t('periodviz.budget_line'), value: c.budget_usd }} />
        <Segments title={t('periodviz.stack')} unit="USD" note={s.over ? t('periodviz.over', { usd: usd(s.over) }) : undefined}
          segments={[
            { label: t('periodviz.paid'), value: s.paid, tone: 'pagar' },
            { label: t('periodviz.escalated'), value: s.escalated, tone: 'escalar' },
            ...(s.available === null ? [] : [{ label: t('periodviz.available'), value: s.available, tone: 'track' as const }]),
          ]} />
        <Segments title={t('periodviz.outcomes')} unit={t('periodviz.invoices')}
          segments={[
            { label: t('outcome.PAGAR'), value: o.PAGAR, tone: 'pagar' },
            { label: t('outcome.FRENAR'), value: o.FRENAR, tone: 'frenar' },
            { label: t('outcome.ESCALAR'), value: o.ESCALAR, tone: 'escalar' },
            { label: t('periodviz.pending'), value: o.pending, tone: 'pending' },
          ]} />
        {c.trend.length > 1 ? (
          <>
            <Line title={t('periodviz.autonomy_trend')} unit="%" points={c.trend.map((p) => ({ day: p.day, value: p.autonomy_pct }))} />
            <Line title={t('periodviz.violations_trend')} unit={t('periodviz.violations_unit')} points={c.trend.map((p) => ({ day: p.day, value: p.violations }))} />
          </>
        ) : (
          <div className="period-trend">
            <Kpi label={t('periodviz.autonomy')} value={last?.autonomy_pct ?? null} kind="pct" />
            <Kpi label={t('periodviz.violations')} value={last?.violations ?? null} kind="count" />
            <p className="muted">{t('periodviz.one_day')}</p>
          </div>
        )}
        {/* last: its height grows with the number of beneficiaries, so nothing below it can jump (AC-91 CLS) */}
        <HBars title={t('periodviz.bene')} unit="USD"
          series={[{ label: t('periodviz.paid'), tone: 'ink' }, { label: t('periodviz.committed'), tone: 'pending' }]}
          rows={byBeneficiary.map((b) => ({ label: b.beneficiary || t('period.unread'), values: [b.paid_usd, b.committed_usd] }))} />
      </div>
    </>
  );
}
