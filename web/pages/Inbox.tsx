// Bandeja (AC-29, AC-63, AC-66, AC-70): every invoice with its outcome chip and one-line headline, filters,
// "Ejecutar agente" (shared run loop, Task 11b), "Nueva factura" (AC-11), when the agent last ran and «Pregúntale a Thesaurus» (AC-67).
// After the list: the portal link card (AC-86) and «Actividad del agente» (AC-78). They appear once the rows and the link
// have loaded, below everything else, so nothing above them moves (AC-91 item 4).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { findBeneficiary, nameKey } from '../../src/engine/checks';
import type { Beneficiary } from '../../src/engine/types';
import type { PageRoute } from '../App';
import { screens, useScreen } from '../api';
import AgentActivity from '../components/AgentActivity';
import AskThesaurus from '../components/AskThesaurus';
import NewInvoice from '../components/NewInvoice';
import { OutcomeChip, type Outcome } from '../components/OutcomeChip';
import PortalLinkCard, { originLabel, type PortalLink } from '../components/PortalLinkCard';
import { RunProgress, useRunAgent } from '../components/RunProgress';
import { tu } from '../components/User';
import { useT } from '../i18n';
import './inbox.css';

export const route: PageRoute = { path: '/', nav: { key: 'screen.inbox', order: 10 } };

type Row = { id: string; outcome: Outcome | null; headline: string | null; received_at: string; fields: { payee_name: string | null } | null;
  origin?: 'app' | 'portal' | 'email'; sender?: string | null };
type LastRun = { at: string; trigger: string; via?: 'portal' | 'email' | null } | null;
const UNREAD = '#'; // nameKey never yields '#'
const keyOf = (r: Row) => nameKey(r.fields?.payee_name ?? null) || UNREAD;
// AC-98: GET /api/screen/inbox. `beneficiaries` holds only id and name (R-132), all the name rule reads.
type Screen = { invoices: Row[]; last_run: LastRun; portal: PortalLink | null; beneficiaries: Beneficiary[] };
// AC-99 (R-109): the loading list is the loaded markup with these made-up rows, hidden by .skeleton.
const SKELETON: Row[] = ['s1', 's2', 's3'].map((id) => ({ id, outcome: null, headline: 'PAGAR · 1.200 USD a Nubia Diseño, dentro de reglas', received_at: '2026-10-10T15:00:00Z', fields: null }));

export default function Inbox() {
  const { t, locale } = useT();
  const [outcome, setOutcome] = useState('');
  const [payee, setPayee] = useState('');
  const [adding, setAdding] = useState(false);
  const [batches, setBatches] = useState(0);
  const screen = useScreen<Screen>(screens.inbox());
  const d = screen.data;
  const rows = d?.invoices ?? null;
  const failed = !d && screen.error !== undefined;
  const lastRun = d?.last_run;
  const directory = d?.beneficiaries ?? [];
  const link = d && (typeof d.portal?.portal_url === 'string' ? d.portal : null); // null: no URL in the answer, no card

  const run = useRunAgent({ first: '/api/invoices/run', onBatch: () => { void screen.reload(); setBatches((n) => n + 1); } });

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
  const item = (r: Row) => (
    <li key={r.id} data-tour="invoice-row">
      <Link to={`/invoices/${r.id}`}>
        <OutcomeChip outcome={r.outcome} />
        <span>
          {r.headline ?? (r.fields?.payee_name ? tu(t('inbox.pending_headline'), { payee: r.fields.payee_name }) : t('inbox.pending_headline', { payee: t('value.unknown_payee') }))}
          {originLabel(t, r) && <small className="muted inbox-origin">{originLabel(t, r)}</small>}
        </span>
        <time className="muted" dateTime={r.received_at}>{date.format(new Date(r.received_at))}</time>
      </Link>
    </li>
  );

  return (
    <section className="inbox" data-tour="inbox">
      <header className="inbox-head">
        <h1>{t('screen.inbox')}</h1>
        <div className="inbox-actions">
          <button type="button" data-tour="new-invoice" aria-expanded={adding} onClick={() => setAdding(!adding)}>{t('inbox.new')}</button>
          <button type="button" className={adding ? undefined : 'primary'} data-tour="run-agent" disabled={run.running} onClick={() => void run.start().then(screen.reload)}>
            {t('inbox.run')}
          </button>
        </div>
      </header>
      <p className={`muted inbox-last-run${d || failed ? '' : ' skeleton'}`} aria-hidden={d || failed ? undefined : true}>
        {failed
          ? null
          : !lastRun // the loading line holds this text, hidden
            ? t('inbox.last_run.never')
            : t('inbox.last_run', {
                ago: mins < 1 ? t('inbox.last_run.under_min') : t('inbox.last_run.min', { n: mins }),
                how: t(lastRun.via ? `inbox.last_run.${lastRun.via}` : lastRun.trigger === 'cron' ? 'inbox.last_run.cron' : 'inbox.last_run.manual'),
              })}
      </p>
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
            {payees.map(([k, label]) => <option key={k} value={k} data-user={k === UNREAD ? undefined : ''}>{label}</option>)}
          </select>
        </label>
      </div>
      <AskThesaurus />

      {failed ? (
        <p role="alert" className="error">{t('inbox.load_error')}</p>
      ) : rows === null ? (
        <>
          <p role="status" className="sr-only">{t('inbox.loading')}</p>
          <ul className="inbox-list skeleton" aria-hidden inert>{SKELETON.map(item)}</ul>
        </>
      ) : rows.length === 0 ? (
        <p className="muted">{t('inbox.empty')}</p>
      ) : shown.length === 0 ? (
        <p className="muted">{t('inbox.no_match')}</p>
      ) : (
        <ul className="inbox-list">{shown.map(item)}</ul>
      )}
      {d && (
        <>
          {link && <PortalLinkCard link={link} />}
          <AgentActivity refresh={batches} />
        </>
      )}
    </section>
  );
}
