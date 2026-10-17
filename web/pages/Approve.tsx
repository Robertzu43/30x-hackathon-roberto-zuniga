// The emailed approve/reject link (AC-35, AC-36, R-55). GET only shows the latest ESCALAR; the one "Confirmar"
// button POSTs that decision's seq. Error texts come from the API's `error` code, in the page's language.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useT } from '../i18n';
import { money, motives } from '../../src/engine/explain';
import type { Check } from '../../src/engine/types';
import './approve.css';


type Lines = { headline_es: string | null; headline_en: string | null };
type Link = {
  action: 'approve' | 'reject';
  expires_at: string;
  invoice: { received_at: string; fields: { payee_name: string | null; amount: number | null; currency: string | null; invoice_number: string | null } };
  decision: Lines & { seq: number; checks: Check[]; question_es: string | null; question_en: string | null; amount_usd: number | null };
};
const CODES = ['invalid_token', 'not_found', 'token_used', 'already_decided', 'changed', 'busy'];
const codeOf = (e: unknown) => (e instanceof ApiError && CODES.includes(e.message) ? e.message : 'generic');
// AC-99 (R-109): while the link loads, the summary is the loaded markup with this made-up link, hidden by .skeleton.
const SKELETON: Link = {
  action: 'approve', expires_at: '2026-10-19T12:00:00Z',
  invoice: { received_at: '2026-10-16T10:00:00Z', fields: { payee_name: 'Nube Sur LLC', amount: 4200, currency: 'USD', invoice_number: 'NS-118' } },
  decision: { seq: 1, checks: [{ id: 'umbral_aprobacion', verdict: 'no_cumple', actual: '4200', threshold: '2500', values: { limit_usd: 2500 } }], headline_es: 'ESCALAR · 4.200 USD a Nube Sur LLC', headline_en: 'ESCALATE · 4,200 USD to Nube Sur LLC',
    question_es: null, question_en: null, amount_usd: null },
};

export default function Approve() {
  const { t, lang, locale } = useT();
  const { token = '' } = useParams();
  const path = `/api/approve/${encodeURIComponent(token)}`;
  const [link, setLink] = useState<Link | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Lines | null>(null);

  useEffect(() => {
    api.get<Link>(path).then(setLink, (e) => setError(codeOf(e)));
  }, [path]);

  const confirm = async () => {
    setBusy(true);
    setError('');
    await api.post<{ decision: Lines }>(path, { seq: link!.decision.seq }).then((r) => setDone(r.decision), (e) => setError(codeOf(e)));
    setBusy(false);
  };

  const canAnswer = link && !done && (!error || error === 'busy' || error === 'generic');
  const dead = !link && !!error; // UX-17: nothing to answer here, so no «Aprobar este pago» heading over a dead end
  const loading = !link && !error;
  const shown = link ?? (loading ? SKELETON : null);
  const f = shown?.invoice.fields;
  const d = shown?.decision;
  return (
    <section className="approve">
      <h1>{t(dead ? 'approve.title.dead' : `approve.title.${link?.action ?? 'approve'}`)}</h1>
      {loading && <p role="status" className="sr-only">{t('approve.loading')}</p>}
      {shown && f && d && (
        <div className={loading ? 'skeleton' : undefined} aria-hidden={loading || undefined} inert={loading}>
          <p className="approve-headline">{d[`headline_${lang}`]}</p>
          {d[`question_${lang}`] && <p>{d[`question_${lang}`]}</p>}
          <h2>{t('approve.read')}</h2>
          <dl className="approve-read">
            <dt>{t('approve.payee')}</dt>
            <dd data-user={f.payee_name ? '' : undefined}>{f.payee_name ?? t('value.unknown_payee')}</dd>
            <dt>{t('approve.amount')}</dt>
            <dd>{f.amount === null ? t('value.unknown_amount') : `${money(f.amount, lang)} ${f.currency ?? ''}`.trim()}
              {f.currency !== 'USD' && d.amount_usd !== null && ` (${money(d.amount_usd, lang)} USD)`}</dd>
            <dt>{t('approve.number')}</dt>
            <dd data-user={f.invoice_number ? '' : undefined}>{f.invoice_number ?? t('value.unknown')}</dd>
          </dl>
          <h2>{t('approve.broken')}</h2>
          <ul className="approve-broken">
            {motives(d.checks, lang, shown.invoice.received_at).map((m) => <li key={m}>{m}</li>)}
          </ul>
        </div>
      )}
      {done && (
        <div role="status" className="approve-done">
          <p>{t('approve.done')}</p>
          <p className="approve-headline">{done[`headline_${lang}`]}</p>
        </div>
      )}
      {error && <p role="alert" className="error">{t(`approve.error.${error}`)}</p>}
      {dead && <p className="approve-next">{t('approve.dead.next')}</p>}
      {canAnswer && (
        <div className="approve-confirm">
          <p>{t(`approve.does.${link.action}`)}</p>
          <button type="button" className="primary" disabled={busy} onClick={() => void confirm()}>{t(busy ? 'approve.confirming' : 'approve.confirm')}</button>
          <p className="muted">{t('approve.expires', { date: new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short' }).format(new Date(link.expires_at)) })}</p>
        </div>
      )}
    </section>
  );
}
