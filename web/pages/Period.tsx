// Periodo (AC-44, D17, R-01, AC-53): the month's money and the three honesty figures from GET /api/period.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PageRoute } from '../App';
import { api } from '../api';
import { useT } from '../i18n';
import './period.css';

export const route: PageRoute = { path: '/period', nav: { key: 'screen.period', order: 40 } };

type Outcome = 'PAGAR' | 'FRENAR' | 'ESCALAR';
type Period = {
  budget_usd: number | null; balance_usd: number | null; paid_usd: number; committed_usd: number; available_usd: number | null;
  count_by_outcome: Record<Outcome, number>;
  by_beneficiary: { beneficiary: string | null; paid_usd: number; committed_usd: number; count: number }[];
  autonomy: { n: number; m: number }; autonomy_pct: number | null; violations: number; explained_pct: number;
};

// Same Bogota-day month the API defaults to.
const thisMonth = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }).slice(0, 7);
// UX-19: a select in the app's language, not <input type="month"> (the browser's). ponytail: the last 24 months; widen if asked.
const lastMonths = (from: string) => Array.from({ length: 24 }, (_, i) => {
  const [y, m] = from.split('-').map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 - i, 1));
  return d.toISOString().slice(0, 7);
});

export default function Period() {
  const { t, locale } = useT();
  const [month, setMonth] = useState(thisMonth);
  const [data, setData] = useState<Period | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setData(null);
    setFailed(false);
    // UX-13: any failure (offline, 500) gets the designed message; the raw text never reaches the screen.
    api.get<Period>(`/api/period?month=${month}`).then(
      (d) => live && setData(d),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [month, attempt]);

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
          <button type="button" onClick={() => setAttempt((n) => n + 1)}>{t('period.retry')}</button>
        </div>
      )}
      {!data && !failed && <p role="status" className="muted">{t('period.loading')}</p>}
      {data && (
        <>
          <div className="period-figures">
            <div className="period-fig">
              <p className="big">{t('period.autonomy', { v: data.autonomy_pct === null ? '—' : `${data.autonomy_pct}\u00a0%` })}</p>
              <p>{t('period.autonomy_of', data.autonomy)}</p>
              <p>{t('period.autonomy_why')}</p>
            </div>
            <div className={`period-fig${data.violations > 0 ? ' bad' : ''}`}>
              <p className="big">{t('period.violations', { n: data.violations })}</p>
              {data.violations > 0 && <p role="alert" className="alert">{t('period.violations_alert', { n: data.violations })}</p>}
              <p>{t('period.violations_why')}</p>
            </div>
            <div className="period-fig">
              <p className="big">{t('period.explained', { pct: data.explained_pct })}</p>
              <p>{t('period.explained_why')}</p>
            </div>
          </div>
          <h2>{t('period.money')}</h2>
          <dl className="period-money">
            {(['budget', 'balance', 'paid', 'committed', 'available'] as const).map((k) => (
              <div key={k}>
                <dt>{t(`period.${k}`)}</dt>
                <dd>{usd(data[`${k}_usd`])}</dd>
              </div>
            ))}
          </dl>
          <h2>{t('period.outcomes')}</h2>
          <ul className="period-outcomes">
            {(['PAGAR', 'FRENAR', 'ESCALAR'] as const).map((o) => (
              <li key={o}>{`${t(`outcome.${o}`)}: ${data.count_by_outcome[o]}`}</li>
            ))}
          </ul>
          <h2>{t('period.beneficiaries')}</h2>
          {data.by_beneficiary.length === 0 ? (
            <div className="period-state empty">
              <p>{t('period.none')}</p>
              <p className="muted">{t('period.none_next')}</p>
              <Link to="/">{t('period.to_inbox')}</Link>
            </div>
          ) : (
            <div className="table-wrap" role="region" aria-label={t('period.beneficiaries')} tabIndex={0}>
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
                  {data.by_beneficiary.map((b, i) => (
                    <tr key={b.beneficiary ?? i}>
                      <td>{!b.beneficiary ? t('period.unread') : b.beneficiary}</td>
                      <td className="num">{b.count}</td>
                      <td className="num">{usd(b.paid_usd)}</td>
                      <td className="num">{usd(b.committed_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
