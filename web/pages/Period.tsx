// Periodo (AC-44, D17, R-01, AC-53): the month's money and the three honesty figures from GET /api/period.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { screens, thisMonth, useScreen } from '../api';
import { useFirstRun } from '../firstRun';
import { useT } from '../i18n';
import PeriodCharts, { type Charts } from '../period/PeriodCharts';
import './period.css';


type Outcome = 'PAGAR' | 'FRENAR' | 'ESCALAR';
type Period = {
  budget_usd: number | null; balance_usd: number | null; paid_usd: number; committed_usd: number; available_usd: number | null;
  count_by_outcome: Record<Outcome, number>;
  by_beneficiary: { beneficiary: string | null; paid_usd: number; committed_usd: number; count: number }[];
  autonomy: { n: number; m: number }; autonomy_pct: number | null; violations: number; explained_pct: number;
};
// AC-99 (R-109): the loading screen is the loaded markup with this made-up period, hidden by .skeleton.
const SKELETON: Period = {
  budget_usd: 10000, balance_usd: 10000, paid_usd: 4200, committed_usd: 4200, available_usd: 5800, count_by_outcome: { PAGAR: 1, FRENAR: 1, ESCALAR: 1 },
  by_beneficiary: ['Andina Labs', 'Estudio Kairos', 'Contadores Andinos'].map((beneficiary) => ({ beneficiary, paid_usd: 4200, committed_usd: 4200, count: 1 })),
   autonomy: { n: 1, m: 1 }, autonomy_pct: 100, violations: 0, explained_pct: 100,
};
// Same idea for the charts: the real layout with zeroed values, its drawing hidden by period.css while .skeleton is on.
const SKELETON_CHARTS: Charts = {
  budget_usd: 10000, burn: [{ day: '2000-01-01', available_usd: 10000 }, { day: '2000-01-02', available_usd: 5800 }],
  stack: { paid: 1, escalated: 1, available: 1, over: 0 }, outcomes: { PAGAR: 1, FRENAR: 1, ESCALAR: 1, pending: 1 },
  trend: [{ day: '2000-01-01', autonomy_pct: 0, violations: 0 }, { day: '2000-01-02', autonomy_pct: 0, violations: 0 }],
};

// UX-19: a select in the app's language, not <input type="month"> (the browser's). ponytail: the last 24 months; widen if asked.
const lastMonths = (from: string) => Array.from({ length: 24 }, (_, i) => {
  const [y, m] = from.split('-').map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 - i, 1));
  return d.toISOString().slice(0, 7);
});

export default function Period() {
  const { t, locale, pct } = useT();
  const [month, setMonth] = useState(thisMonth);
  const screen = useScreen<{ period: Period; charts: Charts | null }>(screens.period(month));
  const data = screen.data?.period;
  const failed = !data && screen.error !== undefined; // UX-13: any failure (offline, 500) gets the designed message, never the raw text
  const shown = data ?? SKELETON;
  // AC-121 (b): while this tab's first-login pass runs, and until the figures loaded after its last call are here, the two
  // percentages show the run. («Ejecutar agente» lives on Bandeja and ends there; it is not visible from this screen.)
  const pass = useFirstRun();
  const [tail, setTail] = useState(false);
  const [was, setWas] = useState(pass.running);
  if (was !== pass.running) {
    setWas(pass.running);
    if (!pass.running) setTail(true);
  }
  useEffect(() => {
    if (tail) void screen.reload().finally(() => setTail(false));
  }, [tail]);
  const deciding = pass.running || tail ? t('dash.kpi.deciding', { n: pass.progress?.n ?? 0, m: pass.progress?.m ?? '…' }) : null;
  const charts = data ? screen.data?.charts : SKELETON_CHARTS; // null on an older Worker: the AC-44 page alone

  const usd = (n: number | null) => (n === null ? '—' : new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', currencyDisplay: 'code' }).format(n));

  return (
    <section className="period" data-tour="period">
      <h1>{t('screen.period')}</h1>
      <label>
        {t('period.month')}
        <select value={month} onChange={(e) => setMonth(e.target.value)}>
          {lastMonths(thisMonth()).map((m) => (
            <option key={m} value={m}>{new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-01T00:00:00Z`))}</option>
          ))}
        </select>
      </label>
      {failed && (
        <div className="period-state">
          <p role="alert" className="error">{t('period.load_error')}</p>
          <button type="button" onClick={() => void screen.reload()}>{t('period.retry')}</button>
        </div>
      )}
      {!data && !failed && <p role="status" className="sr-only">{t('period.loading')}</p>}
      {!failed && (
        <div className={data ? undefined : 'skeleton'} aria-hidden={data ? undefined : true} inert={!data}>
          <div className="period-figures">
            <div className="period-fig">
              <p className="big">{deciding ?? t('period.autonomy', { v: shown.autonomy_pct === null ? '—' : pct(shown.autonomy_pct) })}</p>
              <p>{t('period.autonomy_of', shown.autonomy)}</p>
              <p>{t('period.autonomy_why')}</p>
            </div>
            <div className={`period-fig${shown.violations > 0 ? ' bad' : ''}`}>
              <p className="big">{t('period.violations', { n: shown.violations })}</p>
              {shown.violations > 0 && <p role="alert" className="alert">{t('period.violations_alert', { n: shown.violations })}</p>}
              <p>{t('period.violations_why')}</p>
            </div>
            <div className="period-fig">
              <p className="big">{deciding ?? t('period.explained', { pct: pct(shown.explained_pct) })}</p>
              <p>{t('period.explained_why')}</p>
            </div>
          </div>
          <h2>{t('period.money')}</h2>
          <dl className="period-money">
            {(['budget', 'balance', 'paid', 'committed', 'available'] as const).map((k) => (
              <div key={k}>
                <dt>{t(`period.${k}`)}</dt>
                <dd>{usd(shown[`${k}_usd`])}</dd>
              </div>
            ))}
          </dl>
          <h2>{t('period.outcomes')}</h2>
          <ul className="period-outcomes">
            {(['PAGAR', 'FRENAR', 'ESCALAR'] as const).map((o) => (
              <li key={o}>{`${t(`outcome.${o}`)}: ${shown.count_by_outcome[o]}`}</li>
            ))}
          </ul>
          {charts && <PeriodCharts charts={charts} byBeneficiary={shown.by_beneficiary} />}
          <h2>{t('period.beneficiaries')}</h2>
          {shown.by_beneficiary.length === 0 ? (
            <div key="empty" className="period-state empty">
              <p>{t('period.none')}</p>
              <p className="muted">{t('period.none_next')}</p>
              <Link to="/">{t('period.to_inbox')}</Link>
            </div>
          ) : (
            <div key="table" className="table-wrap" role="region" aria-label={t('period.beneficiaries')} tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    <th>{t('period.beneficiary')}</th>
                    <th className="num">{t('period.invoices')}</th>
                    <th className="num">{t('period.paid')}</th>
                    <th className="num">{t('period.committed')}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.by_beneficiary.map((b, i) => (
                    <tr key={b.beneficiary ?? i}>
                      <td data-user={b.beneficiary ? '' : undefined}>{b.beneficiary || t('period.unread')}</td>
                      <td className="num">{b.count}</td>
                      <td className="num">{usd(b.paid_usd)}</td>
                      <td className="num">{usd(b.committed_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
