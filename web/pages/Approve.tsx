// The emailed approve/reject link (AC-35, AC-36, R-55). GET only shows the latest ESCALAR; the one "Confirmar"
// button POSTs that decision's seq. Error texts come from the API's `error` code, in the page's language.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { PageRoute } from '../App';
import { api, ApiError } from '../api';
import { useT } from '../i18n';
import { money, motives } from '../../src/engine/explain';
import type { Check } from '../../src/engine/types';
import './approve.css';

export const route: PageRoute = { path: '/approve/:token', public: true };

type Lines = { headline_es: string | null; headline_en: string | null };
type Link = {
  action: 'approve' | 'reject';
  expires_at: string;
  invoice: { received_at: string; fields: { payee_name: string | null; amount: number | null; currency: string | null; invoice_number: string | null } };
  decision: Lines & { seq: number; checks: Check[]; question_es: string | null; question_en: string | null; amount_usd: number | null };
};
const CODES = ['invalid_token', 'not_found', 'token_used', 'already_decided', 'changed', 'busy'];
const codeOf = (e: unknown) => (e instanceof ApiError && CODES.includes(e.message) ? e.message : 'generic');

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
  const f = link?.invoice.fields;
  const d = link?.decision;
  return (
    <section className="approve">
      <h1>{t(dead ? 'approve.title.dead' : `approve.title.${link?.action ?? 'approve'}`)}</h1>
      {!link && !error && <p className="muted">{t('approve.loading')}</p>}
      {link && f && d && (
        <>
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
            {motives(d.checks, lang, link.invoice.received_at).map((m) => <li key={m}>{m}</li>)}
          </ul>
        </>
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
