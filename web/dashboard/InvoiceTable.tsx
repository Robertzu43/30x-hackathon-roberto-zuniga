// Bandeja's invoice table, last on the page (AC-101, AC-29, AC-86): search, sort and filters run in the browser over the loaded rows.
// The outcome filter belongs to the page, so the dashboard's «y n más» can set it to ESCALAR.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { findBeneficiary, nameKey } from '../../src/engine/checks';
import type { Beneficiary } from '../../src/engine/types';
import { OutcomeChip, type Outcome } from '../components/OutcomeChip';
import { originLabel } from '../components/PortalLinkCard';
import { tu } from '../components/User';
import { useT } from '../i18n';
import StepCards, { type Icon } from '../components/StepCards';
import './dashboard.css';

const EMPTY: Icon[] = ['upload', 'decide', 'record']; // AC-116 (c)

export type Row = {
  id: string; outcome: Outcome | null; headline: string | null; received_at: string; amount_usd?: number | string | null;
  fields: { payee_name: string | null; invoice_number?: string | null; concept?: string | null } | null;
  origin: 'app' | 'portal' | 'email'; sender?: string | null; // origin: not null, default 'app' (migration 000800)
};
type Key = 'date' | 'payee' | 'usd' | 'outcome';

const UNREAD = '#'; // nameKey never yields '#'
const keyOf = (r: Row) => nameKey(r.fields?.payee_name ?? null) || UNREAD;
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const OUTCOMES = ['PAGAR', 'FRENAR', 'ESCALAR', 'pending'] as const;
const value = (r: Row, k: Key): number | string | null =>
  k === 'date' ? Date.parse(r.received_at)
  : k === 'payee' ? r.fields?.payee_name || null
  : k === 'usd' ? (r.amount_usd === null || r.amount_usd === undefined ? null : Number(r.amount_usd))
  : OUTCOMES.indexOf(r.outcome ?? 'pending');

export default function InvoiceTable({ rows, directory, outcome, onOutcome }: {
  rows: Row[]; directory: Array<{ id: string; name: string }>; outcome: string; onOutcome: (o: string) => void;
}) {
  const { t, locale } = useT();
  const [query, setQuery] = useState('');
  const [origin, setOrigin] = useState('');
  const [payee, setPayee] = useState('');
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 }>({ key: 'date', dir: -1 });
  const usd = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format;
  const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
  const name = (r: Row) => r.fields?.payee_name || t('period.unread');

  // AC-29 (R-79), grouped like Periodo (R-63): the engine's AC-19 name rule; labelled with the directory name (only `name` is read),
  // else the payee as read on the group's oldest invoice; unread payees in one entry, listed last.
  const labels = new Map<string, string>();
  for (const r of [...rows].sort((a, b) => a.received_at.localeCompare(b.received_at))) {
    const k = keyOf(r);
    const read = r.fields?.payee_name ?? '';
    if (!labels.has(k)) labels.set(k, k === UNREAD ? t('period.unread') : findBeneficiary(read, directory as Beneficiary[])?.name ?? read);
  }
  const payees = [...labels].sort(([a, x], [b, y]) => (a === UNREAD ? 1 : b === UNREAD ? -1 : x.localeCompare(y, 'es')));

  const q = fold(query.trim());
  const cmp = (a: number | string | null, b: number | string | null) => // no value goes last, either direction
    a === null ? (b === null ? 0 : 1) : b === null ? -1
    : sort.dir * (typeof a === 'number' ? a - (b as number) : a.localeCompare(b as string, locale, { sensitivity: 'base' }));
  const shown = rows
    .filter((r) => (!outcome || (r.outcome ?? 'pending') === outcome) && (!origin || r.origin === origin) && (!payee || keyOf(r) === payee)
      && (!q || [name(r), r.fields?.invoice_number, r.fields?.concept].some((s) => s && fold(s).includes(q))))
    .sort((a, b) => cmp(value(a, sort.key), value(b, sort.key)) || a.id.localeCompare(b.id)); // ties by id: refreshes never reorder (AC-107)

  const head = (key: Key, label: string) => (
    <th scope="col" aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
      <button type="button" className="dash-sort" onClick={() => setSort({ key, dir: sort.key === key ? (-sort.dir as 1 | -1) : 1 })}>
        {label}<span aria-hidden="true">{sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}</span>
      </button>
    </th>
  );

  return (
    <section id="invoices" className="dash-table" aria-labelledby="dash-table">
      <div data-tour="inbox">{/* AC-117 target 1: the table's header (title, search, filters); its title alone on a phone (tour-steps.ts) */}
      <h2 id="dash-table" data-tour="inbox-title">{t('dash.table.title')}</h2>
      <div className="inbox-filters">
        <label className="dash-search">
          {t('dash.search')}
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <label>
          {t('inbox.filter.outcome')}
          <select value={outcome} onChange={(e) => onOutcome(e.target.value)}>
            <option value="">{t('inbox.filter.all')}</option>
            {(['PAGAR', 'FRENAR', 'ESCALAR'] as const).map((o) => <option key={o} value={o}>{t(`outcome.${o}`)}</option>)}
            <option value="pending">{t('inbox.pending')}</option>
          </select>
        </label>
        <label>
          {t('dash.filter.origin')}
          <select value={origin} onChange={(e) => setOrigin(e.target.value)}>
            <option value="">{t('inbox.filter.all')}</option>
            <option value="app">{t('dash.origin.app')}</option>
            <option value="portal">{t('inbox.origin.portal')}</option>
            <option value="email">{t('inbox.origin.email_unknown')}</option>
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
      </div>

      {rows.length === 0 ? <div className="empty"><StepCards steps={EMPTY.map((icon, i) => ({ icon, title: t(`inbox.empty.${i + 1}.title`), text: t(`inbox.empty.${i + 1}.text`) }))} /></div>
        : shown.length === 0 ? <p className="muted">{t('inbox.no_match')}</p>
        : (
          <div className="table-wrap">
            <table className="inbox-list">{/* the class is the rows hook of userMarkers.test.tsx */}
              <thead>
                <tr>{head('date', t('dash.col.date'))}{head('payee', t('inbox.filter.payee'))}<th scope="col">{t('dash.col.invoice')}</th>
                  {head('usd', t('dash.col.usd'))}{head('outcome', t('inbox.filter.outcome'))}</tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} data-id={r.id} data-tour="invoice-row">
                    <td><time dateTime={r.received_at}>{date.format(new Date(r.received_at))}</time></td>
                    <td>{r.fields?.payee_name ? <span data-user="">{r.fields.payee_name}</span> : t('period.unread')}</td>
                    <td><div data-tour="invoice-open">{/* AC-117 target 4 on a phone, where the whole row scrolls sideways */}
                      <Link to={`/invoices/${r.id}`} className="dash-headline">
                        {r.headline ?? (r.fields?.payee_name ? tu(t('inbox.pending_headline'), { payee: r.fields.payee_name }) : t('inbox.pending_headline', { payee: t('value.unknown_payee') }))}
                      </Link>
                      {originLabel(t, r) && <small className="muted inbox-origin">{originLabel(t, r)}</small>}
                    </div></td>
                    <td className="dash-usd">{value(r, 'usd') === null ? '—' : usd(value(r, 'usd') as number)}</td>
                    <td><OutcomeChip outcome={r.outcome} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </section>
  );
}
