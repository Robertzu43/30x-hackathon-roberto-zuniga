// Bandeja's finance dashboard (AC-101, R-124): KPI strip, «Necesita tu respuesta», the three charts and «Vence pronto».
// Props in, JSX out: every figure is Task 45's `dashboard` as computed by the screen function (AC-106.1), nothing derived here.
import { Link } from 'react-router-dom';
import { HBars, Kpi, StackedBars } from '../charts/lazy';
import { useT } from '../i18n';
import './dashboard.css';

type Brief = { invoice_id: string; payee: string | null; amount: number | null; currency: string | null };
export type DashboardData = {
  kpis: { to_pay_today_usd: number; to_pay_today_count: number; awaiting_count: number; awaiting_usd: number; stopped_month_count: number;
    autonomy_pct: number | null; autonomy_n: number; autonomy_m: number };
  by_day: Array<{ day: string; PAGAR: number; FRENAR: number; ESCALAR: number; pending: number }>;
  by_currency: Array<{ currency: string | null; usd: number }>;
  by_country: Array<{ country: string | null; usd: number }>;
  due_soon: Array<Brief & { amount_usd: number | null; due_date: string; outcome: string | null }>;
  due_soon_total: number;
  approvals: Array<Brief & { question_es: string | null; question_en: string | null; decided_at: string | null }>;
  approvals_total: number;
};

/** `deciding`: the pending count while the first-login pass runs; an empty section then says so instead (AC-107, R-145).
 *  `run`: n of m of this tab's run; the four tiles show it in place of their figures (AC-121). */
export default function Dashboard({ data, onMore, deciding = 0, run = null }: { data: DashboardData; onMore: () => void; deciding?: number; run?: { n: number; m: number } | null }) {
  const { t, lang, locale } = useT();
  const { kpis: k } = data;
  const usd = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format;
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const regions = new Intl.DisplayNames([locale], { type: 'region' });
  const country = (c: string) => { try { return regions.of(c) ?? c; } catch { return c; } }; // a malformed code stays as typed
  const payee = (p: string | null) => (p ? <span data-user="">{p}</span> : t('period.unread'));
  const moreAsking = data.approvals_total - data.approvals.length;
  const moreDue = data.due_soon_total - data.due_soon.length;
  const busy = run ? t('dash.kpi.deciding', run) : undefined;
  const empty = (key: string) => <p className="muted">{deciding ? t('entry.still_deciding', { n: deciding }) : t(key)}</p>;
  return (
    <div className="dash">
      <div className="dash-kpis">
        <Kpi label={t('dash.kpi.today')} value={k.to_pay_today_usd} kind="usd" busy={busy}
          hint={k.to_pay_today_count === 1 ? t('dash.kpi.today_hint.one') : t('dash.kpi.today_hint', { n: k.to_pay_today_count })} />
        <Kpi label={t('dash.kpi.awaiting')} value={k.awaiting_count} kind="count" busy={busy} hint={t('dash.kpi.awaiting_hint', { usd: usd(k.awaiting_usd) })} />
        <Kpi label={t('dash.kpi.stopped')} value={k.stopped_month_count} kind="count" busy={busy} />
        <Kpi label={t('dash.kpi.autonomy')} value={k.autonomy_pct} kind="pct" busy={busy}
          hint={run ? t('period.autonomy_of', { n: run.m, m: run.m }) // the held lines: this hint wraps by its digits, so hold the final n = m
            : k.autonomy_pct === null ? undefined : t('period.autonomy_of', { n: k.autonomy_n, m: k.autonomy_m })} />
      </div>

      <section className="dash-card dash-wide dash-approvals" aria-labelledby="dash-approvals">
        <h2 id="dash-approvals">{t('dash.approvals.title')}</h2>
        <div className="dash-box">
        {data.approvals.length === 0 ? empty('dash.approvals.empty') : (
          <ul className="dash-list">
            {data.approvals.map((a) => (
              <li key={a.invoice_id}>
                <b>{payee(a.payee)}</b>
                {a[`question_${lang}`] && <p>{a[`question_${lang}`]}</p>}
                <Link to={`/invoices/${a.invoice_id}`}>{t('dash.approvals.answer')}</Link>
              </li>
            ))}
          </ul>
        )}
        {moreAsking > 0 && (
          <a className="dash-more" href="#invoices" onClick={onMore}>{t('dash.more', { n: moreAsking })}</a>
        )}
        </div>
      </section>

      <div className="dash-card dash-wide">
        <StackedBars title={t('dash.by_day.title')} unit={t('dash.unit.invoices')}
          series={[{ label: t('outcome.PAGAR'), tone: 'pagar' }, { label: t('outcome.FRENAR'), tone: 'frenar' },
            { label: t('outcome.ESCALAR'), tone: 'escalar' }, { label: t('inbox.pending'), tone: 'pending' }]}
          rows={data.by_day.map((d) => ({ day: d.day, values: [d.PAGAR, d.FRENAR, d.ESCALAR, d.pending] }))} />
      </div>
      <div className="dash-card">
        <HBars title={t('dash.by_currency.title')} unit="USD" rows={data.by_currency.map((c) => ({ label: c.currency ?? t('dash.no_currency'), values: [c.usd] }))} />
      </div>
      <div className="dash-card">
        <HBars title={t('dash.by_country.title')} unit="USD" rows={data.by_country.map((c) => ({ label: c.country ? country(c.country) : t('dash.no_country'), values: [c.usd] }))} />
      </div>

      <section className="dash-card dash-wide dash-due" aria-labelledby="dash-due">
        <h2 id="dash-due">{t('dash.due.title')}</h2>
        <div className="dash-box">
        {data.due_soon.length === 0 ? empty('dash.due.empty') : (
          <ul className="dash-list">
            {data.due_soon.map((d) => (
              <li key={d.invoice_id}>
                <Link to={`/invoices/${d.invoice_id}`}>
                  <b>{payee(d.payee)}</b>
                  <span className="muted">{t('dash.due.on', { date: day.format(new Date(`${d.due_date}T00:00:00Z`)) })}</span>
                  {d.amount_usd !== null && <span className="dash-usd">{usd(d.amount_usd)}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {moreDue > 0 && <p className="muted">{t('dash.more', { n: moreDue })}</p>}
        </div>
      </section>
    </div>
  );
}
