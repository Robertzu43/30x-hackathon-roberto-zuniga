// Periodo (AC-44, D17, R-01, AC-53): the month's money and the three honesty figures from GET /api/period.
import { useEffect, useState } from 'react';
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

export default function Period() {
  const { t, locale } = useT();
  const [month, setMonth] = useState(thisMonth);
  const [data, setData] = useState<Period | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    api.get<Period>(`/api/period?month=${month}`).then(
      (d) => live && setData(d),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [month]);

  const usd = (n: number | null) => (n === null ? '—' : new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', currencyDisplay: 'code' }).format(n));

  return (
    <section className="period" data-tour="period">
      <h1>{t('screen.period')}</h1>
      <label>
        {t('period.month')}
        <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
      </label>
      {error && <p role="alert">{error}</p>}
      {!data && !error && <p role="status" className="muted">{t('period.loading')}</p>}
      {data && (
        <>
          <div className="period-figures">
            <div className="period-fig">
              <p className="big">{t('period.autonomy', { v: data.autonomy_pct === null ? '—' : `${data.autonomy_pct} %` })}</p>
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
            <p className="muted">{t('period.none')}</p>
          ) : (
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
                    <td>{b.beneficiary ?? '—'}</td>
                    <td className="num">{b.count}</td>
                    <td className="num">{usd(b.paid_usd)}</td>
                    <td className="num">{usd(b.committed_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
