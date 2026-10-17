// Bandeja (AC-29, AC-63, AC-66, AC-70): every invoice with its outcome chip and one-line headline, filters,
// "Ejecutar agente" (shared run loop, Task 11b), "Nueva factura" (AC-11) and when the agent last ran.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { findBeneficiary, nameKey } from '../../src/engine/checks';
import type { Beneficiary } from '../../src/engine/types';
import type { PageRoute } from '../App';
import { api } from '../api';
import NewInvoice from '../components/NewInvoice';
import { OutcomeChip, type Outcome } from '../components/OutcomeChip';
import { RunProgress, useRunAgent } from '../components/RunProgress';
import { useT } from '../i18n';
import './inbox.css';

export const route: PageRoute = { path: '/', nav: { key: 'screen.inbox', order: 10 } };

type Row = { id: string; outcome: Outcome | null; headline: string | null; received_at: string; fields: { payee_name: string | null } | null };
type LastRun = { at: string; trigger: string } | null;
const UNREAD = '#'; // nameKey never yields '#'
const keyOf = (r: Row) => nameKey(r.fields?.payee_name ?? null) || UNREAD;

export default function Inbox() {
  const { t, locale } = useT();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [lastRun, setLastRun] = useState<LastRun | undefined>();
  const [outcome, setOutcome] = useState('');
  const [payee, setPayee] = useState('');
  const [adding, setAdding] = useState(false);
  const [directory, setDirectory] = useState<Beneficiary[]>([]);

  const loadRows = () =>
    api.get<Row[]>('/api/invoices').then((r) => { setRows(r); setFailed(false); }, () => setFailed(true));
  const loadLastRun = () => api.get<LastRun>('/api/agent/last-run').then(setLastRun, () => setLastRun(undefined));
  useEffect(() => {
    void loadRows();
    void loadLastRun();
    api.get<Beneficiary[]>('/api/beneficiaries').then(setDirectory, () => {}); // without it the filter still groups by name
  }, []);
  const run = useRunAgent({ first: '/api/invoices/run', onBatch: () => void loadRows() });

  // AC-29 (R-79), grouped like Periodo (R-63): the engine's AC-19 name rule; labelled with the directory name, else the payee as
  // read on the group's oldest invoice; unread payees in one entry, listed last.
  const labels = new Map<string, string>();
  for (const r of [...(rows ?? [])].sort((a, b) => a.received_at.localeCompare(b.received_at))) {
    const k = keyOf(r);
    const read = r.fields?.payee_name ?? '';
    if (!labels.has(k)) labels.set(k, k === UNREAD ? t('period.unread') : findBeneficiary(read, directory)?.name ?? read);
  }
  const payees = [...labels].sort(([a, x], [b, y]) => (a === UNREAD ? 1 : b === UNREAD ? -1 : x.localeCompare(y, 'es')));
  const shown = (rows ?? []).filter(
    (r) => (!outcome || (r.outcome ?? 'pending') === outcome) && (!payee || keyOf(r) === payee),
  );
  const mins = lastRun ? Math.floor((Date.now() - Date.parse(lastRun.at)) / 60_000) : 0;
  const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });

  return (
    <section className="inbox" data-tour="inbox">
      <header className="inbox-head">
        <h1>{t('screen.inbox')}</h1>
        <div className="inbox-actions">
          <button type="button" data-tour="new-invoice" aria-expanded={adding} onClick={() => setAdding(!adding)}>{t('inbox.new')}</button>
          <button type="button" className="primary" data-tour="run-agent" disabled={run.running} onClick={() => void run.start().then(loadLastRun)}>
            {t('inbox.run')}
          </button>
        </div>
      </header>
      {lastRun !== undefined && (
        <p className="muted inbox-last-run">
          {lastRun === null
            ? t('inbox.last_run.never')
            : t('inbox.last_run', {
                ago: mins < 1 ? t('inbox.last_run.under_min') : t('inbox.last_run.min', { n: mins }),
                how: t(lastRun.trigger === 'cron' ? 'inbox.last_run.cron' : 'inbox.last_run.manual'),
              })}
        </p>
      )}
      <p className="muted">{t('inbox.reevaluate_note')}</p>
      <RunProgress run={run} mode="pending" />
      {adding && <NewInvoice />}

      <div className="inbox-filters">
        <label>
          {t('inbox.filter.outcome')}
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="">{t('inbox.filter.all')}</option>
            {(['PAGAR', 'FRENAR', 'ESCALAR'] as const).map((o) => <option key={o} value={o}>{t(`outcome.${o}`)}</option>)}
            <option value="pending">{t('inbox.pending')}</option>
          </select>
        </label>
        <label>
          {t('inbox.filter.payee')}
          <select value={payee} onChange={(e) => setPayee(e.target.value)}>
            <option value="">{t('inbox.filter.all')}</option>
            {payees.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
      </div>

      {failed ? (
        <p role="alert" className="error">{t('inbox.load_error')}</p>
      ) : rows === null ? (
        <p className="muted">{t('inbox.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="muted">{t('inbox.empty')}</p>
      ) : shown.length === 0 ? (
        <p className="muted">{t('inbox.no_match')}</p>
      ) : (
        <ul className="inbox-list">
          {shown.map((r) => (
            <li key={r.id} data-tour="invoice-row">
              <Link to={`/invoices/${r.id}`}>
                <OutcomeChip outcome={r.outcome} />
                <span>{r.headline ?? t('inbox.pending_headline', { payee: r.fields?.payee_name ?? t('value.unknown_payee') })}</span>
                <time className="muted" dateTime={r.received_at}>{date.format(new Date(r.received_at))}</time>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
