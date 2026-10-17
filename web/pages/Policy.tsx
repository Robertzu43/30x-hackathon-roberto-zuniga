import { useState, type FormEvent } from 'react';
import type { PageRoute } from '../App';
import type { PolicyRules } from '../../src/engine/types';
import { api, ApiError, screens, useScreen } from '../api';
import { RunProgress, useRunAgent } from '../components/RunProgress';
import { useT } from '../i18n';
import '../policy.css';
import { failure, send } from '../withField';

export const route: PageRoute = { path: '/policy', nav: { key: 'screen.policy', order: 20 } };

type Version = { id: string; version: number; name: string; rules: PolicyRules; created_at: string };
type Change = { invoice_id: string; headline: string; from: string | null; to: string | null }; // null from: pending; null to: pending and not read yet (R-68)
type Company = { id: string; name: string; approver_email: string; lang: 'es' | 'en'; is_demo: boolean };
type Failure = ReturnType<typeof failure>;
type Rate = { currency: string; usd_per_unit: number; units_per_usd: number; source: string; fetched_at: string; stale: boolean };

const NUM = ['per_payment_limit_usd', 'approval_threshold_usd', 'period_budget_usd', 'account_balance_usd', 'duplicate_window_days', 'agreement_tolerance_pct', 'due_grace_days'] as const;
const FX = ['ARS', 'BRL', 'COP', 'EUR', 'MXN']; // code order, like the market table (R-110); USD is always 1: nothing to pin
const pinList = (fx: Record<string, string>) => [...FX, ...Object.keys(fx).filter((c) => c !== 'USD' && !FX.includes(c)).sort()];
// the loading rows are real rows with this made-up data, hidden by CSS: same markup, so same height as the loaded table (R-109)
const placeholder = (currency: string): Rate => ({ currency, usd_per_unit: 0.000249, units_per_usd: 4020.1, source: 'Yahoo Finance', fetched_at: '2026-10-17T15:00:00Z', stale: false });
// AC-98: GET /api/screen/policy, the data of the old /api/policy, /api/company and /api/fx in one answer.
type Screen = { versions: Version[]; company: Company; fx: { rates: Rate[] } };
// AC-99 (R-109): the loading page is the loaded markup with this made-up answer, hidden by .skeleton; the market slot draws
// its own placeholder rows, one per pin currency.
const SKELETON = {
  versions: [{ id: 's', version: 1, name: 'Política general', rules: {} as PolicyRules, created_at: '2026-10-17T10:00:00Z' }],
  company: { id: 's', name: 'Andina Labs Inc.', approver_email: 'ana@andina.co', lang: 'es', is_demo: false },
} as const;
const hidden = { 'aria-hidden': true, inert: true } as const;

// The company answer is loaded by Policy, so every card appears at once and none moves another (UX-09).
function CompanySection({ initial, skeleton }: { initial: Company; skeleton: boolean }) {
  const { t } = useT();
  const [c, setC] = useState<Company | null>(initial);
  const [err, setErr] = useState<Failure | null>(null);
  const [was, setWas] = useState(skeleton);
  if (was !== skeleton) { // the answer replaces the placeholder in the same inputs, so nothing remounts or moves
    setWas(skeleton);
    setC(initial);
  }
  const [saved, setSaved] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!c) return;
    setErr(null);
    setSaved(false);
    try {
      setC(await api.put<Company>('/api/company', { name: c.name, approver_email: c.approver_email, lang: c.lang }));
      setSaved(true);
    } catch (x) {
      setErr(failure(x));
    }
  };
  return (
    <section className={skeleton ? 'card skeleton' : 'card'} aria-labelledby="company-h" {...(skeleton && hidden)}>
      <h2 id="company-h">{t('policy.company.title')}</h2>
      {c && (
        <form onSubmit={submit} noValidate>
          {c.is_demo && <p className="muted">{t('policy.company.demo')}</p>}
          <div className="grid">
            <label>{t('policy.company.name')}
              <input value={c.name} disabled={c.is_demo} onChange={(e) => setC({ ...c, name: e.target.value })} />
            </label>
            <label>{t('policy.company.email')}
              <input type="email" value={c.approver_email} disabled={c.is_demo} onChange={(e) => setC({ ...c, approver_email: e.target.value })} />
            </label>
            <label>{t('policy.company.lang')}
              <select value={c.lang} disabled={c.is_demo} onChange={(e) => setC({ ...c, lang: e.target.value as Company['lang'] })}>
                <option value="es">Español</option>
                <option value="en">English</option>
              </select>
            </label>
          </div>
          <button className="primary" disabled={c.is_demo}>{t('policy.company.save')}</button>
          {saved && <p role="status">{t('policy.company.saved')}</p>}
        </form>
      )}
      {err && <p role="alert" className="error">{err.text}</p>}
    </section>
  );
}

// AC-76: the market rates the agent uses, read-only. Staleness comes from the API (R-85.3), never computed here.
function MarketRates({ pins, rates }: { pins: string[]; rates: Rate[] | null }) {
  const { t, locale } = useT();
  // es-CO prints «17 de oct de 2026»; AC-76 shows «17 oct 2026» (the replace below)
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Bogota' });
  const hour = new Intl.DateTimeFormat(locale, { timeStyle: 'short', hour12: false, timeZone: 'America/Bogota' });
  const num = (n: number, o: Intl.NumberFormatOptions) => n.toLocaleString(locale, o);
  const shown = rates ?? pins.map(placeholder);
  return (
    <div className="fx-market">
      <h3 id="fx-market-h">{t('policy.fx.market')}</h3>
      <div className="fx-slot">
        {rates && !rates.length && <p className="muted">{t('policy.fx.empty')}</p>}
        {shown.length > 0 && (
          // scrolls inside its own container (AC-91 item 1); cards at phone width (policy.css)
          <div className="fx-scroll" role={rates ? 'region' : undefined} aria-labelledby={rates ? 'fx-market-h' : undefined} tabIndex={rates ? 0 : undefined} aria-hidden={rates ? undefined : true}>
            <table className={rates ? 'fx-table' : 'fx-table loading'} aria-labelledby="fx-market-h">
              <thead>
                <tr>{['currency', 'rate', 'usd', 'source', 'fetched', 'status'].map((c) => <th key={c} scope="col">{t(`policy.fx.col.${c}`)}</th>)}</tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const at = new Date(r.fetched_at);
                  return (
                    <tr key={r.currency} className={r.stale ? 'stale' : undefined}>
                      <td>{r.currency}</td>
                      {/* one fixed fraction length on every row: in es-CO "18,479" would read as eighteen thousand */}
                      <td>{t('policy.fx.units', { n: num(r.units_per_usd, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), c: r.currency })}</td>
                      <td className="mono" data-label={t('policy.fx.col.usd')}>{num(r.usd_per_unit, { maximumSignificantDigits: 6 })}</td>
                      <td>{r.source}</td>
                      <td>{t('policy.fx.fetched', { when: `${day.format(at).replace(/ de /g, ' ')} ${hour.format(at)}` })}</td>
                      <td>{r.stale ? t('policy.fx.stale') : t('policy.fx.fresh')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const toForm = (v?: Version) => ({
  name: '',
  num: Object.fromEntries(NUM.map((k) => [k, String(v?.rules[k] ?? '')])),
  fx: Object.fromEntries(Object.entries(v?.rules.fx_rates ?? {}).map(([k, r]) => [k, String(r)])),
  allowed: v?.rules.allowed_beneficiaries_only ?? false,
});

export default function Policy() {
  const { t, locale } = useT();
  const screen = useScreen<Screen>(screens.policy());
  const d = screen.data;
  const loadFailed = !d && screen.error !== undefined;
  const versions: readonly Version[] = (d ?? SKELETON).versions;
  const [f, setF] = useState(toForm());
  const [filled, setFilled] = useState(false);
  if (d && !filled) { // the form starts from the latest version once, at the first answer; later answers only refresh the list
    setFilled(true);
    setF(toForm(d.versions[0]));
  }
  const [err, setErr] = useState<Failure | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const [would, setWould] = useState<Change[] | null>(null);
  const [willPay, setWillPay] = useState(0);
  const [unread, setUnread] = useState(0);
  const [saving, setSaving] = useState(false);
  const [allVersions, setAllVersions] = useState(false);
  const run = useRunAgent({ first: '/api/policy/reevaluate' });


  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSaved(null);
    setWould(null);
    // An empty box is a rule the company has not set: null, and its check says "no se pudo verificar" (AC-18).
    const n = (s: string) => (s.trim() === '' ? null : Number(s));
    const rules = {
      ...Object.fromEntries(NUM.map((k) => [k, n(f.num[k]!)])),
      fx_rates: Object.fromEntries(Object.entries(f.fx).filter(([, r]) => r.trim() !== '').map(([k, r]) => [k, Number(r)])),
      allowed_beneficiaries_only: f.allowed,
    };
    setSaving(true);
    try {
      const r = await send<{ policy: Version; would_change: Change[]; will_pay?: number; unread_pending: number }>('PUT', '/api/policy', { name: f.name.trim() || undefined, rules });
      setSaved(r.policy.version); // the number the database assigned (R-41), not the one the button showed
      setWould(r.would_change);
      setUnread(r.unread_pending);
      setWillPay(r.will_pay ?? r.would_change.filter((w) => w.to === 'PAGAR').length); // R-61
      await screen.reload();
    } catch (x) {
      setErr(failure(x));
      if (x instanceof ApiError && x.status === 409) await screen.reload(); // another save won: refresh the list and the next number
    } finally {
      setSaving(false);
    }
  };

  const p = would?.filter((w) => !w.from).length ?? 0;
  const e = would?.filter((w) => w.from === 'ESCALAR').length ?? 0;
  const header = p && e ? t('policy.header_both', { p, e }) : p ? t('policy.header_pending', { p }) : e ? t('policy.header_escalated', { e }) : t('policy.would_change_none');
  const pins = pinList(f.fx);
  const next = (versions[0]?.version ?? 0) + 1;
  const card = d ? { className: 'card' } : { className: 'card skeleton', ...hidden };
  const bad = (k: string) => (err?.field === k ? true : undefined);
  const date = (s: string) => new Date(s).toLocaleDateString(locale, { dateStyle: 'medium' });

  return (
    <section data-tour="policy" className="policy">
      <h1>{t('screen.policy')}</h1>
      <p className="muted">{t('policy.intro')}</p>
      {!d && !loadFailed && <p role="status" className="sr-only">{t('policy.loading')}</p>}
      {loadFailed && (
        <div>
          <p role="alert" className="error">{t('policy.load_error')}</p>
          <button type="button" onClick={() => void screen.reload()}>{t('policy.fx.retry')}</button>
        </div>
      )}
      {!loadFailed && <>
        <CompanySection initial={(d ?? SKELETON).company} skeleton={!d} />

        <section {...card} aria-labelledby="rules-h">
          <h2 id="rules-h">{t('policy.rules.title')}</h2>
          <form onSubmit={submit} noValidate>
            <label className="switch">
              <input type="checkbox" checked={f.allowed} onChange={(e) => setF({ ...f, allowed: e.target.checked })} aria-describedby="allowed-hint" />
              {t('policy.allowed')}
            </label>
            <p id="allowed-hint" className="muted hint">{t('policy.allowed.hint')}</p>
            <div className="grid">
              {NUM.map((k) => (
                <div key={k}>
                  <label>{t(`policy.${k}`)}
                    <input type="number" min="0" step="any" value={f.num[k]} aria-invalid={bad(k)} aria-describedby={`${k}-hint`}
                      onChange={(e) => setF({ ...f, num: { ...f.num, [k]: e.target.value } })} />
                  </label>
                  <span id={`${k}-hint`} className="muted hint">{t(`policy.${k}.hint`)}</span>
                </div>
              ))}
            </div>
            <MarketRates pins={pins} rates={d?.fx.rates ?? null} />
            <fieldset>
              <legend>{t('policy.fx.title')}</legend>
              <p className="muted hint">{t('policy.fx.hint')}</p>
              <div className="grid fx">
                {pins.map((c) => (
                  <label key={c}>{t('policy.fx.row', { c })}
                    <input type="number" min="0" step="any" value={f.fx[c] ?? ''} aria-invalid={bad('fx_rates')}
                      onChange={(e) => setF({ ...f, fx: { ...f.fx, [c]: e.target.value } })} />
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="muted hint">{t('policy.fx.source')}</p>
            <label>{t('policy.name')}
              <input value={f.name} placeholder={versions[0]?.name} maxLength={100} onChange={(e) => setF({ ...f, name: e.target.value })} />
            </label>
            <button className="primary" disabled={saving} aria-busy={saving || undefined}>{t('policy.save', { n: next })}</button>
            {saved !== null && <p role="status">{t('policy.saved', { n: saved })}</p>}
          </form>
          {err && <p role="alert" className="error">{err.text}</p>}
        </section>

        <section {...card} aria-labelledby="reeval-h">
          <h2 id="reeval-h">{t('policy.reevaluate')}</h2>
          {would && (
            <div className="banner" role="status">
              <p>{header}</p>
              {willPay > 0 && <p>{t('policy.will_pay', { n: willPay })}</p>}
              {unread > 0 && <p>{t('policy.unread_pending', { k: unread })}</p>}
              {(p > 0 || e > 0) && (
                <ul>
                  {would.map((w) => (
                    <li key={w.invoice_id}>{w.headline} <span className="mono">{w.to ? `${t(w.from ? `outcome.${w.from}` : 'inbox.pending')} → ${t(`outcome.${w.to}`)}` : t('policy.row_unread')}</span></li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <button className="primary" disabled={run.running} aria-busy={run.running || undefined} onClick={() => void run.start().then(() => setWould(null))}>{t('policy.reevaluate')}</button>
          <p className="muted hint">{t('policy.reevaluate.note')}</p>
          <RunProgress run={run} mode="reevaluate" />
        </section>

        <section {...card} aria-labelledby="versions-h">
          <h2 id="versions-h">{t('policy.versions')}</h2>
          <ol className="versions" aria-labelledby="versions-h">
            {(allVersions ? versions : versions.slice(0, 10)).map((v) => (
              <li key={v.id}>
                <strong>{v.name}</strong>
                <span className="mono">{t('policy.version', { n: v.version })}</span>
                <span className="muted">{date(v.created_at)}</span>
              </li>
            ))}
          </ol>
          {!allVersions && versions.length > 10 && (
            <button type="button" onClick={() => setAllVersions(true)}>{t('policy.versions.all', { n: versions.length })}</button>
          )}
        </section>
      </>}
    </section>
  );
}
