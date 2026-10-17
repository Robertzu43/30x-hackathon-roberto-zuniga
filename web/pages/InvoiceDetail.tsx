// Detalle de decisión (AC-08, AC-26, AC-28, AC-34, AC-64, AC-65, R-22, R-55): every line comes from GET /api/invoices/:id.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { StoredDecision, TraceStep } from '../../src/agent/trace';
import { money } from '../../src/engine/explain';
import type { InvoiceFields } from '../../src/engine/types';
import type { PageRoute } from '../App';
import { api, ApiError } from '../api';
import { useSession } from '../auth';
import AgentTrace from '../components/AgentTrace';
import ChecksTable from '../components/ChecksTable';
import Timeline from '../components/Timeline';
import { useT } from '../i18n';
import './detail.css';

export const route: PageRoute = { path: '/invoices/:id' };

type Detail = {
  // read_error (AC-13, R-75): the reader never answered; absent until the backend sends it.
  invoice: { source: 'pdf' | 'image' | 'email' | 'chat'; raw_text: string | null; fields: (InvoiceFields & { read_error?: string }) | null };
  headline: string | null;
  decisions: StoredDecision[];
  explanations: string[];
  fixes: string[];
  policy: { name: string; version: number; created_at: string } | null;
  trace: TraceStep[];
  question: string | null;
  file_url: string | null;
};

const FIELDS = ['payee_name', 'amount', 'currency', 'invoice_number', 'issue_date', 'due_date', 'concept', 'bank_account'] as const;

export default function InvoiceDetail() {
  const { t, lang, locale } = useT();
  const { id } = useParams();
  const metaLang: unknown = useSession().session?.user.user_metadata?.lang; // the API answers in the user's saved language (AC-28)
  const [data, setData] = useState<Detail | null | 'missing' | 'error'>(null);
  const [reloads, setReloads] = useState(0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.get<Detail>(`/api/invoices/${id}`).then(
      (d) => live && setData(d),
      (e) => live && setData(e instanceof ApiError && e.status === 404 ? 'missing' : 'error'),
    );
    return () => {
      live = false;
    };
  }, [id, metaLang, reloads]);

  const back = <Link to="/" className="detail-back">{t('detail.back')}</Link>;
  if (data === null) return <section>{back}<p className="muted">{t('detail.loading')}</p></section>;
  if (typeof data === 'string') return <section>{back}<p className="error">{t(data === 'missing' ? 'detail.not_found' : 'detail.load_error')}</p></section>;
  const latest = data.decisions.at(-1);
  if (!latest) return <section>{back}<h1>{t('detail.pending')}</h1></section>;

  const date = (iso: string, timeZone: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone }).format(d);
  };
  const shown = (k: (typeof FIELDS)[number], v: string | number) =>
    typeof v === 'number' ? money(v, lang) : k.endsWith('_date') ? date(v, 'UTC') : v;
  const pct = new Intl.NumberFormat(locale, { style: 'percent' });

  // R-55: the answer carries the seq of the ESCALAR shown; a 409 means it moved, so reload and say so in our words.
  const answer = async (action: 'approve' | 'reject') => {
    setBusy(true);
    setMsg(null);
    try {
      await api.post(`/api/invoices/${id}/${action}`, note.trim() ? { seq: latest.seq, note: note.trim() } : { seq: latest.seq });
      setNote('');
      setReloads((n) => n + 1);
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      const conflict = err?.status === 409 && (err.message === 'changed' || err.message === 'already_decided');
      setMsg(t(`detail.err.${conflict ? err.message : err?.status === 503 ? 'busy' : 'other'}`));
      if (conflict) setReloads((n) => n + 1);
    } finally {
      setBusy(false);
    }
  };

  const { invoice, file_url: url } = data;
  const payment = latest.outcome === 'PAGAR' ? latest.payment : null;
  const unreached = invoice.fields?.read_error === 'lector_no_disponible';
  return (
    <section className="detail">
      {back}
      <h1>{data.headline}</h1>
      <AgentTrace steps={data.trace} />
      <div className="detail-cols">
        <div>
          <h2>{t('detail.read')}</h2>
          {unreached && <p className="detail-notice">{t('detail.reader_unavailable')}</p>}
          {invoice.source === 'email' || invoice.source === 'chat' ? (
            invoice.raw_text ? <pre className="detail-doc">{invoice.raw_text}</pre> : <p className="muted">{t('detail.file.none')}</p>
          ) : !url ? (
            <p className="muted">{t('detail.file.none')}</p>
          ) : (
            <>
              {invoice.source === 'pdf'
                ? <iframe className="detail-doc" src={url} title={t('detail.file.title')} />
                : <img className="detail-doc" src={url} alt={t('detail.file.title')} />}
              <a href={url} target="_blank" rel="noreferrer">{t('detail.file.open')}</a>
            </>
          )}
          <dl className="detail-fields">
            {FIELDS.map((k) => {
              const v = invoice.fields?.[k] ?? null;
              const c = invoice.fields?.confidence?.[k];
              return (
                <div key={k}>
                  <dt>{t(`detail.field.${k}`)}</dt>
                  <dd className={v === null ? 'muted' : undefined}>{v === null ? t(unreached ? 'value.unknown' : 'detail.unread') : shown(k, v)}</dd>
                  {v !== null && c != null && <dd className="muted">{t('detail.confidence', { pct: pct.format(c) })}</dd>}
                </div>
              );
            })}
          </dl>
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
                <div><dt>{t('detail.payment.beneficiary')}</dt><dd>{payment.beneficiary}</dd></div>
                <div><dt>{t('detail.payment.route')}</dt><dd>{payment.route ?? t('value.unknown')}</dd></div>
                <div><dt>{t('detail.payment.currency')}</dt><dd>{payment.currency}</dd></div>
                <div><dt>{t('detail.payment.amount')}</dt><dd>{money(payment.amount, lang)}</dd></div>
                {latest.amount_usd != null && <div><dt>{t('detail.payment.amount_usd')}</dt><dd>{money(latest.amount_usd, lang)}</dd></div>}
              </dl>
            </section>
          )}
          {msg && <p className="error" role="alert">{msg}</p>}
          {latest.outcome === 'ESCALAR' && (
            <section className="detail-card" aria-label={t('detail.ask')}>
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
            </section>
          )}
          {data.policy && (
            <p className="muted">{t('detail.policy', { name: data.policy.name, version: data.policy.version, date: date(data.policy.created_at, 'America/Bogota') })}</p>
          )}
          <Timeline decisions={data.decisions} />
        </div>
      </div>
    </section>
  );
}
