// Bandeja (AC-29, AC-63, AC-66, AC-70, AC-101): "Ejecutar agente" (shared run loop, Task 11b), "Nueva factura" (AC-11) and when the
// agent last ran; then the finance dashboard, the portal link card (AC-86), «Actividad del agente» (AC-78), «Pregúntale a Thesaurus»
// (AC-67) right before the invoice table, which comes last (AC-101). While loading, the dashboard and the table are their own
// markup with made-up data, hidden, so nothing moves when the answer arrives (AC-91 item 4, AC-99).
// AC-107 (R-145): the shell's first-login pass shows here, in RunProgress's place; each of its calls refreshes the screen and the
// activity panel. Once it ran in this tab, the sections that grow as decisions arrive keep their box (dashboard.css).
import { useEffect, useRef, useState } from 'react';
import { screens, useScreen } from '../api';
import AgentActivity from '../components/AgentActivity';
import AskThesaurus from '../components/AskThesaurus';
import NewInvoice from '../components/NewInvoice';
import PortalLinkCard, { type PortalLink } from '../components/PortalLinkCard';
import { RunProgress, useRunAgent } from '../components/RunProgress';
import Dashboard, { type DashboardData } from '../dashboard/Dashboard';
import InvoiceTable, { type Row } from '../dashboard/InvoiceTable';
import { useFirstRun } from '../firstRun';
import { useT } from '../i18n';
import './inbox.css';

type LastRun = { at: string; trigger: string; via?: 'portal' | 'email' | null } | null;
// AC-98: GET /api/screen/inbox. `beneficiaries` holds only id and name (R-132), all the name rule reads; `dashboard` is AC-101's.
type Screen = { invoices: Row[]; last_run: LastRun; portal: PortalLink | null; beneficiaries: Array<{ id: string; name: string }>; dashboard: DashboardData | null };
// AC-99 (R-109): made-up data drawn in the loaded markup, hidden by .skeleton.
const SKELETON: Row[] = ['s1', 's2', 's3'].map((id) => ({ id, outcome: null, headline: null, // the pending line, in the tab's language (AC-91 item 5)
  received_at: '2026-10-10T15:00:00Z', amount_usd: 1200, fields: { payee_name: 'Nubia Diseño' }, origin: 'app' }));
const brief = { invoice_id: 's1', payee: 'Nubia Diseño', amount: 1200, currency: 'USD' };
const SKELETON_DASH: DashboardData = {
  // two-digit counts, so the KPI hints wrap like a real month's (a shorter line made the cards below jump, CLS 0.004 per load)
  kpis: { to_pay_today_usd: 12000, to_pay_today_count: 10, awaiting_count: 10, awaiting_usd: 12000, stopped_month_count: 10, autonomy_pct: 50, autonomy_n: 10, autonomy_m: 20 },
  by_day: Array.from({ length: 30 }, (_, i) => ({ day: `2026-10-${String(i + 1).padStart(2, '0')}`, PAGAR: 1, FRENAR: 0, ESCALAR: 0, pending: 0 })),
  by_currency: [{ currency: 'USD', usd: 1200 }], by_country: [{ country: 'CO', usd: 1200 }],
  due_soon: [{ ...brief, amount_usd: 1200, due_date: '2026-10-20', outcome: null }], due_soon_total: 1,
  approvals: [{ ...brief, question_es: '¿Apruebo 1.200 USD a Nubia Diseño?', question_en: 'Do I approve 1,200 USD to Nubia Diseño?', decided_at: null }], approvals_total: 1,
};
const hidden = { className: 'skeleton', 'aria-hidden': true, inert: true } as const;
const nothing = () => {};

export default function Inbox() {
  const { t } = useT();
  const [outcome, setOutcome] = useState('');
  const [adding, setAdding] = useState(false);
  const [batches, setBatches] = useState(0);
  const screen = useScreen<Screen>(screens.inbox());
  const d = screen.data;
  const failed = !d && screen.error !== undefined;
  const lastRun = d?.last_run;
  const link = d && (typeof d.portal?.portal_url === 'string' ? d.portal : null); // null: no URL in the answer, no card

  // One screen request in flight (AC-107), Bandeja's first load included: it is out until a fresh answer shows (a cached one,
  // AC-100, shows at once). A call answered meanwhile asks for one more refresh after it.
  const refreshing = useRef(true);
  const again = useRef(false);
  const settle = () => {
    refreshing.current = false;
    if (again.current) {
      again.current = false;
      refresh();
    }
  };
  const refresh = () => {
    if (refreshing.current) return void (again.current = true);
    refreshing.current = true;
    void screen.reload().finally(settle);
  };
  const first = useRef<Screen | null | undefined>(d); // null once the first load answered
  useEffect(() => {
    if (first.current === null || (d === first.current && screen.error === undefined)) return;
    first.current = null;
    settle();
  }, [d, screen.error]);
  const run = useRunAgent({ first: '/api/invoices/run', onBatch: () => { refresh(); setBatches((n) => n + 1); } });
  const pass = useFirstRun();
  const base = useRef(pass.batches).current; // the calls answered before this screen mounted are in its first load
  useEffect(() => {
    if (pass.batches > base) refresh();
  }, [pass.batches]);
  const shown = run.running || run.result ? run : pass; // «Ejecutar agente» pressed after the pass shows its own run
  const busy = run.running || pass.running;
  const held = pass.running || pass.result !== null;
  const mins = lastRun ? Math.floor((Date.now() - Date.parse(lastRun.at)) / 60_000) : 0;

  return (
    <section className={held ? 'inbox inbox-held' : 'inbox'} data-tour="inbox" data-band>
      <div className="inbox-top" data-block>
      <header className="inbox-head">
        <h1>{t('screen.inbox')}</h1>
        <div className="inbox-actions">
          <button type="button" data-tour="new-invoice" aria-expanded={adding} onClick={() => setAdding(!adding)}>{t('inbox.new')}</button>
          <button type="button" className={adding ? undefined : 'primary'} data-tour="run-agent" disabled={busy} aria-busy={busy || undefined} onClick={() => void run.start().then(refresh)}>
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
      <RunProgress run={shown} mode="pending" progressKey={shown === pass ? 'entry.deciding' : undefined}
        pending={shown === pass && held ? (d ? d.invoices.filter((r) => !r.outcome).length : null) : undefined} />
      {adding && <NewInvoice />}
      </div>

      {failed ? (
        <div className="inbox-error" data-block>{/* only after the one retry (R-150 lever 4) */}
          <p role="alert" className="error">{t('inbox.load_failed')}</p>
          <button type="button" onClick={() => void screen.reload()}>{t('inbox.retry')}</button>
        </div>
      ) : !d ? (
        <>
          <p role="status" className="sr-only">{t('inbox.loading')}</p>
          <div {...hidden}><Dashboard data={SKELETON_DASH} onMore={nothing} /></div>{/* a wrapper: the dashboard's cards are the blocks */}
        </>
      ) : (
        <>
          {d.dashboard && <Dashboard data={d.dashboard} onMore={() => setOutcome('ESCALAR')} deciding={pass.running ? d.invoices.filter((r) => !r.outcome).length : 0} />}
          {link && <div data-block><PortalLinkCard link={link} /></div>}
          <div className="activity-box" data-block tabIndex={held ? 0 : undefined}>{/* held: it scrolls inside, so it takes focus (axe) */}
            <AgentActivity refresh={batches + pass.batches - base} />
          </div>
        </>
      )}
      <div data-block><AskThesaurus /></div>
      {!failed && (d
        ? <div data-block><InvoiceTable rows={d.invoices} directory={d.beneficiaries} outcome={outcome} onOutcome={setOutcome} /></div>
        : <div data-block {...hidden}><InvoiceTable rows={SKELETON} directory={[]} outcome="" onOutcome={nothing} /></div>)}
    </section>
  );
}
