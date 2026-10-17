// Perfil de un beneficiario (AC-104, R-124, AC-106): who, route, agreement, totals, sparkline and the last 5 invoices.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { PageRoute } from '../App';
import type { Beneficiary as Dir } from '../../src/engine/types';
import { ApiError, api } from '../api';
import { Kpi, Sparkline } from '../charts/lazy';
import { OutcomeChip, type Outcome } from '../components/OutcomeChip';
import { tu } from '../components/User';
import { useT } from '../i18n';
import './beneficiary.css';

export const route: PageRoute = { path: '/beneficiaries/:id' };

type Profile = {
  beneficiary: Dir & { country?: string | null };
  totals: { paid_month_usd: number; paid_total_usd: number; invoices: number };
  history: { received_at: string; amount_usd: number }[];
  last: { invoice_id: string; received_at: string; amount: number | null; currency: string | null; outcome: Outcome | null }[];
};

export default function Beneficiary() {
  const { t, locale } = useT();
  const { id } = useParams();
  const [data, setData] = useState<Profile | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'missing' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setState('loading');
    api.get<Profile>(`/api/screen/beneficiary/${id}`).then(
      (d) => live && (setData(d), setState('ok')),
      (e) => live && setState(e instanceof ApiError && e.status === 404 ? 'missing' : 'failed'), // the raw text never reaches the screen (UX-13)
    );
    return () => {
      live = false;
    };
  }, [id, attempt]);

  const back = <Link to="/beneficiaries">{t('ben.p.back')}</Link>;
  if (state !== 'ok' || !data)
    return (
      <section className="beneficiary" data-tour="beneficiary">
        {back}
        {state === 'loading' && <p role="status" className="muted">{t('policy.loading')}</p>}
        {state === 'missing' && (
          <div className="beneficiary-state">
            <p role="alert">{t('ben.p.not_found')}</p>
            <p className="muted">{t('ben.p.not_found_next')}</p>
          </div>
        )}
        {state === 'failed' && (
          <div className="beneficiary-state">
            <p role="alert" className="error">{t('ben.p.load_error')}</p>
            <button type="button" onClick={() => setAttempt((n) => n + 1)}>{t('period.retry')}</button>
          </div>
        )}
      </section>
    );

  const { beneficiary: b, totals, history, last } = data;
  const num = new Intl.NumberFormat(locale);
  const day = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'America/Bogota' }).format(new Date(iso));
  const a = b.agreement;
  const agreement = a
    ? [
        t(`ben.agreement.${a.type}`),
        a.amount_usd && t('ben.p.ag.amount', { n: num.format(a.amount_usd) }),
        a.cap_usd && t('ben.p.ag.cap', { n: num.format(a.cap_usd) }),
        a.period && t('ben.p.ag.monthly'),
        a.valid_until && t('ben.p.ag.until', { date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${a.valid_until}T00:00:00Z`)) }),
      ].filter(Boolean).join(', ')
    : t('ben.p.ag.none');
  const tail = b.bank_account?.replace(/\D/g, '').slice(-4);

  return (
    <section className="beneficiary" data-tour="beneficiary">
      {back}
      <h1><span data-user="">{b.name}</span></h1>
      <dl className="beneficiary-facts">
        <div><dt>{t('ben.col.country')}</dt><dd>{b.country ?? '—'}</dd></div>
        <div><dt>{t('ben.col.currency')}</dt><dd>{b.currency ?? '—'}</dd></div>
        <div><dt>{t('ben.p.route')}</dt><dd>{b.route ?? '—'}</dd></div>
        <div><dt>{t('ben.p.bank')}</dt><dd>{tail ? tu(t('ben.p.account'), { last: tail }) : t('ben.p.no_account')}</dd></div>
      </dl>
      <p><b>{t('ben.p.agreement')}.</b> {agreement}</p>

      {totals.invoices === 0 && history.length === 0 && last.length === 0 ? (
        <div className="beneficiary-state">
          <p>{t('ben.p.empty')}</p>
          <p className="muted">{t('ben.p.empty_next')}</p>
          <Link to="/">{t('period.to_inbox')}</Link>
        </div>
      ) : (
        <>
          <div className="beneficiary-totals">
            <Kpi label={t('ben.p.paid_month')} value={totals.paid_month_usd} kind="usd" />
            <Kpi label={t('ben.p.paid_total')} value={totals.paid_total_usd} kind="usd" />
            <Kpi label={t('ben.p.invoices')} value={totals.invoices} kind="count" />
          </div>
          <Sparkline title={t('ben.p.spark')} unit="USD" values={history.map((h) => h.amount_usd)} />
          <p className="muted">{t('ben.p.spark_note')}</p>
          <h2>{t('ben.p.last')}</h2>
          <div className="table-wrap" role="region" aria-label={t('ben.p.last')} tabIndex={0}>
            <table>
              <thead>
                <tr><th>{t('ben.p.received')}</th><th className="num">{t('ben.p.amount')}</th><th>{t('ben.p.outcome')}</th></tr>
              </thead>
              <tbody>
                {last.map((r) => (
                  <tr key={r.invoice_id}>
                    <td>{day(r.received_at)}</td>
                    <td className="num">{r.amount === null ? '—' : `${num.format(r.amount)} ${r.currency ?? ''}`}</td>
                    <td><Link to={`/invoices/${r.invoice_id}`}><OutcomeChip outcome={r.outcome} /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
