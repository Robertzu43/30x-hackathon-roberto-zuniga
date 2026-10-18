// Perfil de un beneficiario (AC-104, R-124, AC-106): who, route, agreement, totals, sparkline and the last 5 invoices.
import { Link, useParams } from 'react-router-dom';
import type { Beneficiary as Dir } from '../../src/engine/types';
import { ApiError, useScreen } from '../api';
import { Kpi, Sparkline } from '../charts/lazy';
import { OutcomeChip, type Outcome } from '../components/OutcomeChip';
import { tu } from '../components/User';
import { useT } from '../i18n';
import { StepIcon } from '../components/StepCards';
import './beneficiary.css';

type Profile = {
  beneficiary: Dir & { country?: string | null };
  totals: { paid_month_usd: number; paid_total_usd: number; invoices: number };
  history: { received_at: string; amount_usd: number }[];
  last: { invoice_id: string; received_at: string; amount: number | null; currency: string | null; outcome: Outcome | null }[];
};
// AC-99 (R-109): the loading screen is the loaded markup with this made-up profile, hidden by .skeleton.
const SKELETON: Profile = {
  beneficiary: { id: '', name: 'Andina Labs', country: 'CO', currency: 'COP', route: 'transferencia', bank_account: '0000', agreement: { type: 'retainer', amount_usd: 1000, period: 'monthly' } } as Profile['beneficiary'],
  totals: { paid_month_usd: 1000, paid_total_usd: 1000, invoices: 1 },
  history: [1, 1, 1].map((amount_usd) => ({ received_at: '2026-01-01T00:00:00Z', amount_usd })),
  last: [1, 2, 3].map((n) => ({ invoice_id: `s${n}`, received_at: '2026-01-01T00:00:00Z', amount: 1000, currency: 'USD', outcome: 'PAGAR' as const })),
};

export default function Beneficiary() {
  const { t, locale } = useT();
  const { id } = useParams();
  const screen = useScreen<Profile>(`/api/screen/beneficiary/${id}`); // AC-98: one request
  const data = screen.data;
  // The raw API text never reaches the screen (UX-13); another company's id answers 404.
  const state = data ? 'ok' : screen.error === undefined ? 'loading' : screen.error instanceof ApiError && screen.error.status === 404 ? 'missing' : 'failed';

  const back = <div data-block><Link to="/beneficiaries">{t('ben.p.back')}</Link></div>;
  if (state === 'missing' || state === 'failed')
    return (
      <section className="beneficiary" data-tour="beneficiary" data-band>
        {back}
        {state === 'missing' && (
          <div className="beneficiary-state" data-block>
            <p role="alert">{t('ben.p.not_found')}</p>
            <p className="muted">{t('ben.p.not_found_next')}</p>
          </div>
        )}
        {state === 'failed' && (
          <div className="beneficiary-state" data-block>
            <p role="alert" className="error">{t('ben.p.load_error')}</p>
            <button type="button" onClick={() => void screen.reload()}>{t('period.retry')}</button>
          </div>
        )}
      </section>
    );

  const { beneficiary: b, totals, history, last } = data ?? SKELETON;
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
    <section className="beneficiary" data-tour="beneficiary" data-band>
      {back}
      {!data && <p role="status" className="sr-only">{t('policy.loading')}</p>}
      <div className={data ? 'beneficiary-body' : 'beneficiary-body skeleton'} aria-hidden={data ? undefined : true} inert={!data}>
      <h1 data-block><span data-user="">{b.name}</span></h1>
      {/* AC-113: the agreement and bank route beside the history from 1440 px */}
      <div className="beneficiary-profile" data-block>
      <dl className="beneficiary-facts">
        <div><dt>{t('ben.col.country')}</dt><dd>{b.country ?? '—'}</dd></div>
        <div><dt>{t('ben.col.currency')}</dt><dd>{b.currency ?? '—'}</dd></div>
        <div><dt>{t('ben.p.route')}</dt><dd>{b.route ?? '—'}</dd></div>
        <div><dt>{t('ben.p.bank')}</dt><dd>{tail ? tu(t('ben.p.account'), { last: tail }) : t('ben.p.no_account')}</dd></div>
      </dl>
      <p><b>{t('ben.p.agreement')}.</b> {agreement}</p>
      </div>

      {totals.invoices === 0 && history.length === 0 && last.length === 0 ? (
        <div className="beneficiary-state step-card" data-step-card data-block>
          <StepIcon name="upload" />
          <p>{t('ben.p.empty')}</p>
          <p className="muted">{t('ben.p.empty_next')}</p>
          <Link to="/">{t('period.to_inbox')}</Link>
        </div>
      ) : (
        <div className="beneficiary-history" data-block>
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
        </div>
      )}
      </div>
    </section>
  );
}
