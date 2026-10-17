// Detalle de decisión (AC-08, AC-26, AC-28, AC-34, AC-64, AC-65, AC-67, AC-77, R-22, R-55): every line comes from GET /api/invoices/:id.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { StoredDecision, TraceStep } from '../../src/agent/trace';
import { money } from '../../src/engine/explain';
import type { InvoiceFields } from '../../src/engine/types';
import type { PageRoute } from '../App';
import { api, ApiError, useScreen } from '../api';
import AgentTrace from '../components/AgentTrace';
import AskThesaurus from '../components/AskThesaurus';
import ChecksTable from '../components/ChecksTable';
import { originLabel } from '../components/PortalLinkCard';
import ReadingPanel, { type Reading } from '../components/ReadingPanel';
import Timeline from '../components/Timeline';
import { printedAsRead, tu } from '../components/User';
import { useT } from '../i18n';
import './detail.css';

export const route: PageRoute = { path: '/invoices/:id' };

type Detail = {
  // read_error (AC-13, R-75): the reader never answered; absent until the backend sends it.
  invoice: { source: 'pdf' | 'image' | 'email' | 'chat'; raw_text: string | null; fields: (InvoiceFields & { read_error?: string }) | null;
    /** AC-86: the channel (invoice_current.origin, sender) and a vendor's portal message, shown and never read (R-90.5). */
    origin?: 'app' | 'portal' | 'email'; sender?: string | null; sender_note?: string | null };
  headline: string | null;
  decisions: StoredDecision[];
  explanations: string[];
  fixes: string[];
  policy: { name: string; version: number; created_at: string } | null;
  trace: TraceStep[];
  question: string | null;
  file_url: string | null;
  /** AC-77: null when no model read it (seeded, inserted with fields, or the reader was unavailable). */
  reading?: Reading | null;
  /** R-97: who read it, decided by the API (never derived here); absent on an older API, treated as 'none'. */
  reading_status?: 'ai' | 'preloaded' | 'unavailable' | 'none';
};

const FIELDS = ['payee_name', 'amount', 'currency', 'invoice_number', 'issue_date', 'due_date', 'concept', 'bank_account'] as const;
// AC-99 (R-109): the loading page is the loaded markup with this made-up record, hidden by .skeleton.
const SKELETON = {
  invoice: { source: 'email', raw_text: 'Factura de octubre', fields: null }, headline: 'PAGAR · 1.200 USD a Nubia Diseño, dentro de reglas',
  decisions: [{ seq: 1, outcome: 'FRENAR', checks: [], created_at: '2026-10-10T15:00:00Z', actor: 'agent' }],
  explanations: [], fixes: [], policy: null, trace: [], question: null, file_url: null,
} as unknown as Detail;

export default function InvoiceDetail() {
  const { t, lang, locale } = useT();
  const { id } = useParams();
  const screen = useScreen<Detail>(`/api/invoices/${id}`); // the tab language is in its cache key and request (R-98)
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const back = <Link to="/" className="detail-back detail-link">{t('detail.back')}</Link>;
  const loaded = screen.data;
  // UX-18: the API answers an unknown id with 404 (its contract); the page names it and says what to do next.
  if (!loaded && screen.error instanceof ApiError && screen.error.status === 404)
    return <section>{back}<h1>{t('detail.not_found')}</h1><p>{t('detail.not_found.next')}</p></section>;
  if (!loaded && screen.error !== undefined) return <section>{back}<p className="error">{t('detail.load_error')}</p></section>;
  const data = loaded ?? SKELETON;
  const latest = data.decisions.at(-1);
  if (!latest) return <section>{back}<h1>{t('detail.pending')}</h1></section>;

  const date = (iso: string, timeZone: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone }).format(d);
  };
  const shown = (k: string, v: string | number) =>
    typeof v === 'number' ? money(v, lang) : k.endsWith('_date') ? date(v, 'UTC') : v;
  const pct = new Intl.NumberFormat(locale, { style: 'percent' });

  // R-55: the answer carries the seq of the ESCALAR shown; a 409 means it moved, so reload and say so in our words.
  // R-122: until the server answers and the new record is shown, the card only says it is sending; no outcome is predicted.
  const answer = async (action: 'approve' | 'reject') => {
    setBusy(true);
    setMsg(null);
    try {
      await api.post(`/api/invoices/${id}/${action}`, note.trim() ? { seq: latest.seq, note: note.trim() } : { seq: latest.seq });
      setNote('');
      await screen.reload();
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      const conflict = err?.status === 409 && (err.message === 'changed' || err.message === 'already_decided');
      setMsg(t(`detail.err.${conflict ? err.message : err?.status === 503 ? 'busy' : 'other'}`));
      if (conflict) void screen.reload();
    } finally {
      setBusy(false);
    }
  };

  const { invoice, file_url: url } = data;
  const payment = latest.outcome === 'PAGAR' ? latest.payment : null;
  const status = data.reading_status ?? 'none';
  const unreached = status === 'unavailable';
  const reading = status === 'ai' ? data.reading ?? null : null;
  return (
    <section className="detail">
      {back}
      {!loaded && <p role="status" className="sr-only">{t('detail.loading')}</p>}
      <div className={loaded ? undefined : 'skeleton'} aria-hidden={loaded ? undefined : true} inert={!loaded}>
        <h1>{data.headline}</h1>
        {originLabel(t, invoice) && <p className="muted detail-origin">{originLabel(t, invoice)}</p>}
        {invoice.sender_note && (
          <section aria-labelledby="sender-note">
            <h2 id="sender-note">{t('inbox.sender_note')}</h2>
            <p data-user="" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{invoice.sender_note}</p>
          </section>
        )}
        <AgentTrace steps={data.trace} />
        <div className="detail-cols">
          <div>
            <h2>{t('detail.read')}</h2>
            {reading && <p className="ai-badge">{t('detail.read_by', { provider: reading.provider })}</p>}
            {unreached && <p className="detail-notice">{t('detail.reader_unavailable')}</p>}
            {status === 'preloaded' && <p className="muted">{t('detail.preloaded')}</p>}
            {invoice.source === 'email' || invoice.source === 'chat' ? (
              invoice.raw_text ? <pre className="detail-doc" data-user="">{invoice.raw_text}</pre> : <p className="muted">{t('detail.file.none')}</p>
            ) : !url ? (
              <p className="muted">{t('detail.file.none')}</p>
            ) : (
              <>
                {invoice.source === 'pdf'
                  ? <iframe className="detail-doc" src={url} title={t('detail.file.title')} />
                  : <img className="detail-doc" src={url} alt={t('detail.file.title')} />}
                <a className="detail-link" href={url} target="_blank" rel="noreferrer">{t('detail.file.open')}</a>
              </>
            )}
            {reading ? <ReadingPanel fields={reading.fields} show={shown} /> : <dl className="detail-fields">
              {FIELDS.map((k) => {
                const v = invoice.fields?.[k] ?? null;
                const c = invoice.fields?.confidence?.[k];
                return (
                  <div key={k}>
                    <dt>{t(`detail.field.${k}`)}</dt>
                    <dd className={v === null ? 'muted' : undefined} data-user={v !== null && printedAsRead(k, v) ? '' : undefined}>{v === null ? t(unreached ? 'value.unknown' : 'detail.unread') : shown(k, v)}</dd>
                    {v !== null && c != null && <dd className="muted">{t('detail.confidence', { pct: pct.format(c) })}</dd>}
                  </div>
                );
              })}
            </dl>}
          </div>
          <div>
            <ChecksTable explanations={data.explanations} checks={latest.checks} />
            {data.fixes.length > 0 && (
              <section>
                <h2>{t('detail.fixes')}</h2>
                <ul className="detail-fixes">{data.fixes.map((f) => <li key={f}>{f}</li>)}</ul>
              </section>
            )}
            {payment && (
              <section className="detail-card" aria-label={t('detail.payment')}>
                <h2>{t('detail.payment')}</h2>
                <dl className="detail-fields">
                  <div><dt>{t('detail.payment.beneficiary')}</dt><dd data-user="">{payment.beneficiary}</dd></div>
                  <div><dt>{t('detail.payment.route')}</dt><dd>{payment.route ?? t('value.unknown')}</dd></div>
                  <div><dt>{t('detail.payment.currency')}</dt><dd>{payment.currency}</dd></div>
                  <div><dt>{t('detail.payment.amount')}</dt><dd>{money(payment.amount, lang)}</dd></div>
                  {latest.amount_usd != null && <div><dt>{t('detail.payment.amount_usd')}</dt><dd>{money(latest.amount_usd, lang)}</dd></div>}
                </dl>
              </section>
            )}
            {msg && <p className="error" role="alert">{msg}</p>}
            {latest.outcome === 'ESCALAR' && (
              <section className="detail-card" aria-label={t('detail.ask')} aria-busy={busy || undefined}>
                <h2>{t('detail.ask')}</h2>
                {data.question && <p className="detail-question">{data.question}</p>}
                <label>
                  {t('detail.note_label')}
                  <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
                </label>
                <div className="detail-actions">
                  <button type="button" className="primary" disabled={busy} onClick={() => void answer('approve')}>{t('detail.approve')}</button>
                  <button type="button" disabled={busy} onClick={() => void answer('reject')}>{t('detail.reject')}</button>
                </div>
                {busy && <p role="status">{t('detail.sending')}</p>}
              </section>
            )}
            {data.policy && (
              <p className="muted">{tu(t('detail.policy', { version: data.policy.version, date: date(data.policy.created_at, 'America/Bogota') }), { name: data.policy.name })}</p>
            )}
            <AskThesaurus invoiceId={id} /> {/* R-106: directly above «Historial», after the decision content it answers about */}
            <Timeline decisions={data.decisions} />
          </div>
        </div>
      </div>
    </section>
  );
}
