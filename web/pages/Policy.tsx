import { useEffect, useState, type FormEvent } from 'react';
import type { PageRoute } from '../App';
import type { PolicyRules } from '../../src/engine/types';
import { api, ApiError } from '../api';
import { RunProgress, useRunAgent } from '../components/RunProgress';
import { useT } from '../i18n';
import '../policy.css';
import { failure, send } from '../withField';

export const route: PageRoute = { path: '/policy', nav: { key: 'screen.policy', order: 20 } };

type Version = { id: string; version: number; name: string; rules: PolicyRules; created_at: string };
type Change = { invoice_id: string; headline: string; from: string; to: string };
type Company = { id: string; name: string; approver_email: string; lang: 'es' | 'en'; is_demo: boolean };
type Failure = ReturnType<typeof failure>;

const NUM = ['per_payment_limit_usd', 'approval_threshold_usd', 'period_budget_usd', 'account_balance_usd', 'duplicate_window_days', 'agreement_tolerance_pct', 'due_grace_days'] as const;
const FX = ['COP', 'MXN', 'BRL', 'ARS', 'EUR', 'USD'];

function CompanySection() {
  const { t } = useT();
  const [c, setC] = useState<Company | null>(null);
  const [err, setErr] = useState<Failure | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => void api.get<Company>('/api/company').then(setC, (e) => setErr(failure(e))), []);

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
    <section className="card" aria-labelledby="company-h">
      <h2 id="company-h">{t('policy.company.title')}</h2>
      {!c && !err && <p className="muted">{t('policy.loading')}</p>}
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

const toForm = (v?: Version) => ({
  name: '',
  num: Object.fromEntries(NUM.map((k) => [k, String(v?.rules[k] ?? '')])),
  fx: Object.fromEntries(Object.entries(v?.rules.fx_rates ?? {}).map(([k, r]) => [k, String(r)])),
  allowed: v?.rules.allowed_beneficiaries_only ?? false,
});

export default function Policy() {
  const { t, locale } = useT();
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [f, setF] = useState(toForm());
  const [err, setErr] = useState<Failure | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const [would, setWould] = useState<Change[] | null>(null);
  const run = useRunAgent({ first: '/api/policy/reevaluate' });

  const load = async (fill: boolean) => {
    const v = await api.get<Version[]>('/api/policy');
    setVersions(v);
    if (fill) setF(toForm(v[0]));
  };
  useEffect(() => void load(true).catch((e) => setErr(failure(e))), []);

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
    try {
      const r = await send<{ policy: Version; would_change: Change[] }>('PUT', '/api/policy', { name: f.name.trim() || undefined, rules });
      setSaved(r.policy.version); // the number the database assigned (R-41), not the one the button showed
      setWould(r.would_change);
      await load(false);
    } catch (x) {
      setErr(failure(x));
      if (x instanceof ApiError && x.status === 409) await load(false).catch(() => {}); // another save won: refresh the list and the next number
    }
  };

  const next = (versions?.[0]?.version ?? 0) + 1;
  const bad = (k: string) => (err?.field === k ? true : undefined);
  const date = (s: string) => new Date(s).toLocaleDateString(locale, { dateStyle: 'medium' });

  return (
    <section data-tour="policy" className="policy">
      <h1>{t('screen.policy')}</h1>
      <p className="muted">{t('policy.intro')}</p>
      <CompanySection />

      <section className="card" aria-labelledby="rules-h">
        <h2 id="rules-h">{t('policy.rules.title')}</h2>
        {!versions && !err && <p className="muted">{t('policy.loading')}</p>}
        {!versions && err && <p role="alert" className="error">{t('policy.load_error')}</p>}
        {versions && (
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
            <fieldset>
              <legend>{t('policy.fx.title')}</legend>
              <p className="muted hint">{t('policy.fx.hint')}</p>
              <div className="grid fx">
                {FX.map((c) => (
                  <label key={c}>{t('policy.fx.row', { c })}
                    <input type="number" min="0" step="any" value={f.fx[c] ?? ''} aria-invalid={bad('fx_rates')}
                      onChange={(e) => setF({ ...f, fx: { ...f.fx, [c]: e.target.value } })} />
                  </label>
                ))}
              </div>
            </fieldset>
            <label>{t('policy.name')}
              <input value={f.name} placeholder={versions[0]?.name} maxLength={100} onChange={(e) => setF({ ...f, name: e.target.value })} />
            </label>
            <button className="primary">{t('policy.save', { n: next })}</button>
            {saved !== null && <p role="status">{t('policy.saved', { n: saved })}</p>}
          </form>
        )}
        {versions && err && <p role="alert" className="error">{err.text}</p>}
      </section>

      <section className="card" aria-labelledby="reeval-h">
        <h2 id="reeval-h">{t('policy.reevaluate')}</h2>
        {would && (
          <div className="banner" role="status">
            <p>{would.length === 0 ? t('policy.would_change_none') : would.length === 1 ? t('policy.would_change_one') : t('policy.would_change_other', { n: would.length })}</p>
            {would.length > 0 && (
              <ul>
                {would.map((w) => (
                  <li key={w.invoice_id}>{w.headline} <span className="mono">{w.from} → {w.to}</span></li>
                ))}
              </ul>
            )}
          </div>
        )}
        <button className="primary" disabled={run.running} onClick={() => void run.start().then(() => setWould(null))}>{t('policy.reevaluate')}</button>
        <p className="muted hint">{t('policy.reevaluate.note')}</p>
        <RunProgress run={run} mode="reevaluate" />
      </section>

      {versions && (
        <section className="card" aria-labelledby="versions-h">
          <h2 id="versions-h">{t('policy.versions')}</h2>
          <ol className="versions">
            {versions.map((v) => (
              <li key={v.id}>
                <strong>{v.name}</strong>
                <span className="mono">{t('policy.version', { n: v.version })}</span>
                <span className="muted">{date(v.created_at)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </section>
  );
}
