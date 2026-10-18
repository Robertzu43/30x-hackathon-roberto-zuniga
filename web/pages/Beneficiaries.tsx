import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Beneficiary } from '../../src/engine/types';
import { screens, useScreen } from '../api';
import { tu } from '../components/User';
import { useT } from '../i18n';
import { StepIcon } from '../components/StepCards';
import '../policy.css';
import './beneficiary.css';
import { failure, send } from '../withField';


type Row = Beneficiary & { country: string | null };
// The seven Blinka payment routes (AC-33). A directory row may hold another value (the seed does); editing keeps it.
const ROUTES = ['ACH', 'Wire', 'SWIFT', 'Pix', 'CBU', 'Transferencia COP', 'USDC'];
const TYPES = ['retainer', 'hourly', 'subscription', 'one_off'] as const;
const TEXT = ['name', 'country', 'currency', 'bank_account', 'category'] as const;
// AC-99 (R-109): the loading table is the loaded markup with these made-up rows, hidden by .skeleton.
const SKELETON: Row[] = ['s1', 's2', 's3'].map((id) => ({ id, name: 'Andina Labs', country: 'CO', currency: 'USD', bank_account: null, route: 'ACH',
  category: 'Desarrollo', agreement: { type: 'retainer', amount_usd: 2500, period: 'monthly' } }));

const toForm = (b?: Row) => ({
  name: b?.name ?? '', country: b?.country ?? '', currency: b?.currency ?? '', bank_account: b?.bank_account ?? '', route: b?.route ?? '',
  category: b?.category ?? '', type: b?.agreement?.type ?? '', amount_usd: String(b?.agreement?.amount_usd ?? ''),
  cap_usd: String(b?.agreement?.cap_usd ?? ''), period: b?.agreement?.period ?? '', valid_until: b?.agreement?.valid_until ?? '',
});

export default function Beneficiaries() {
  const { t, locale } = useT();
  const screen = useScreen<{ beneficiaries: Row[] }>(screens.beneficiaries()); // AC-98
  const rows = screen.data?.beneficiaries ?? null;
  const loadFailed = !rows && screen.error !== undefined;
  const [f, setF] = useState(toForm());
  const [editing, setEditing] = useState<Row | null>(null);
  const [err, setErr] = useState<ReturnType<typeof failure> | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const edit = (b: Row | null) => {
    setEditing(b);
    setF(toForm(b ?? undefined));
    setErr(null);
    setSaved(false);
  };
  // UX-14, UX-15: the form sits below the list; bring it into view and put the cursor in it.
  const openForm = (b: Row | null) => {
    edit(b);
    formRef.current?.scrollIntoView({ block: 'start' });
    nameRef.current?.focus({ preventScroll: true });
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSaved(false);
    setBusy(true);
    const opt = (s: string) => s.trim() || null;
    const agreement = !f.type ? null : {
      type: f.type,
      ...(f.amount_usd.trim() && { amount_usd: Number(f.amount_usd) }),
      ...(f.cap_usd.trim() && { cap_usd: Number(f.cap_usd) }),
      ...(f.period && { period: f.period }),
      ...(f.valid_until && { valid_until: f.valid_until }),
    };
    const data = { name: f.name.trim(), country: opt(f.country), currency: opt(f.currency), bank_account: opt(f.bank_account), route: opt(f.route), category: opt(f.category), agreement };
    try {
      await (editing ? send('PUT', `/api/beneficiaries/${editing.id}`, data) : send('POST', '/api/beneficiaries', data));
      edit(null);
      setSaved(true);
      await screen.reload();
    } catch (x) {
      setErr(failure(x));
    }
    setBusy(false);
  };

  const bad = (k: string) => (err?.field === k ? true : undefined);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const money = (n: number) => `${n.toLocaleString(locale)} USD`;
  const agreement = (a: Row['agreement']) => (a ? [t(`ben.agreement.${a.type}`), a.amount_usd && money(a.amount_usd), a.cap_usd && `≤ ${money(a.cap_usd)}`].filter(Boolean).join(' · ') : '—');
  const routes = f.route && !ROUTES.includes(f.route) ? [...ROUTES, f.route] : ROUTES;

  return (
    <section data-tour="beneficiaries" className="beneficiaries" data-band>
      <div className="page-head" data-block>
        <h1>{t('screen.beneficiaries')}</h1>
        <p className="muted">{t('ben.intro')}</p>
      </div>

      <section className="card table-wrap" data-block aria-label={t('ben.list')} tabIndex={0}>
        {!rows && !loadFailed && <p role="status" className="sr-only">{t('policy.loading')}</p>}
        {loadFailed && <p role="alert" className="error">{t('ben.load_error')}</p>}
        {rows?.length === 0 && (
          <div className="empty step-card" data-step-card>
            <StepIcon name="inbox" />
            <p className="muted">{t('ben.empty')} {t('ben.empty_next')}</p>
            <button type="button" onClick={() => openForm(null)}>{t('ben.add')}</button>
          </div>
        )}
        {(rows ? rows.length > 0 : !loadFailed) && (
          <table className={rows ? undefined : 'skeleton'} aria-hidden={rows ? undefined : true} inert={!rows}>
            <thead>
              <tr>{['name', 'country', 'currency', 'route', 'category', 'agreement'].map((c) => <th key={c}>{t(`ben.col.${c}`)}</th>)}<th /></tr>
            </thead>
            <tbody>
              {(rows ?? SKELETON).map((b) => (
                <tr key={b.id}>
                  <td><Link to={`/beneficiaries/${b.id}`}><span data-user="">{b.name}</span></Link></td>{/* AC-104; R-131: the marker inside the link */}
                  <td>{b.country ?? '—'}</td>
                  <td>{b.currency ?? '—'}</td>
                  <td>{b.route ?? '—'}</td>
                  <td data-user={b.category ? '' : undefined}>{b.category ?? '—'}</td>
                  <td>{agreement(b.agreement)}</td>
                  <td><button type="button" aria-label={`${t('ben.edit')} ${b.name}`} onClick={() => openForm(b)}>{t('ben.edit')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card" data-block aria-labelledby="ben-form-h" ref={formRef}>
        <h2 id="ben-form-h">{editing ? tu(t('ben.edit_title'), { name: editing.name }) : t('ben.new_title')}</h2>
        <form onSubmit={submit} noValidate>
          <div className="grid">
            {TEXT.map((k) => (
              <label key={k}>{t(`ben.${k}`)}
                <input ref={k === 'name' ? nameRef : undefined} value={f[k]} aria-invalid={bad(k)} maxLength={k === 'country' ? 2 : k === 'currency' ? 3 : 200}
                  onChange={(e) => setF({ ...f, [k]: k === 'country' || k === 'currency' ? e.target.value.toUpperCase() : e.target.value })} />
              </label>
            ))}
            <label>{t('ben.route')}
              <select value={f.route} aria-invalid={bad('route')} onChange={set('route')}>
                <option value="">{t('ben.route.none')}</option>
                {routes.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label>{t('ben.agreement.type')}
              <select value={f.type} aria-invalid={bad('agreement')} onChange={set('type')}>
                <option value="">{t('ben.agreement.none')}</option>
                {TYPES.map((k) => <option key={k} value={k}>{t(`ben.agreement.${k}`)}</option>)}
              </select>
            </label>
            {f.type && (
              <>
                <label>{t('ben.agreement.amount_usd')}
                  <input type="number" min="0" step="any" value={f.amount_usd} aria-invalid={bad('agreement')} onChange={set('amount_usd')} />
                </label>
                <label>{t('ben.agreement.cap_usd')}
                  <input type="number" min="0" step="any" value={f.cap_usd} aria-invalid={bad('agreement')} onChange={set('cap_usd')} />
                </label>
                <label>{t('ben.agreement.period')}
                  <select value={f.period} aria-invalid={bad('agreement')} onChange={set('period')}>
                    <option value="" />
                    <option value="monthly">{t('ben.agreement.monthly')}</option>
                  </select>
                </label>
                <label>{t('ben.agreement.valid_until')}
                  <input inputMode="numeric" placeholder={t('ben.date_placeholder')} maxLength={10} value={f.valid_until} aria-invalid={bad('agreement')} onChange={set('valid_until')} />
                </label>
              </>
            )}
          </div>
          <button className="primary" disabled={busy} aria-busy={busy}>{t(busy ? 'ben.saving' : 'ben.save')}</button>
          {editing && <button type="button" onClick={() => edit(null)}>{t('ben.cancel')}</button>}
          {err && rows && <p role="alert" className="error">{err.text}</p>}
          {saved && <p role="status">{t('ben.saved')} <Link to="/policy">{t('ben.go_policy')}</Link>.</p>}
        </form>
      </section>
    </section>
  );
}
