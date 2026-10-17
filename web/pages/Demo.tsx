// Public /demo pitch page (AC-45, AC-46, AC-47, AC-66, R-30; design-taste-frontend, "quiet instrument" direction):
// the problem in Blinka's words, the agent loop and the pitch line, Andina Labs' read-only inbox and Periodo figures.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PageRoute } from '../App';
import { config, supabase } from '../api';
import { isDemoUser, useSession } from '../auth';
import { RunProgress, useRunAgent } from '../components/RunProgress';
import { useT } from '../i18n';
import './demo.css';

export const route: PageRoute = { path: '/demo', public: true, fullBleed: true };

const DEMO_PASSWORD = 'andina-demo-2026'; // public by design (D8, AC-46), same as src/routes/demo.ts
const OUTCOMES = ['PAGAR', 'FRENAR', 'ESCALAR'] as const;
const STAGES = ['percibe', 'lee', 'consulta', 'decide', 'actua', 'rinde'];
type Outcome = (typeof OUTCOMES)[number];
type Row = { id: string; outcome: Outcome | null; headline_es: string | null; headline_en: string | null };
type Overview = { invoices: Row[]; period: { autonomy: { n: number; m: number }; autonomy_pct: number | null; violations: number; explained_pct: number } };

export default function Demo() {
  const { t, lang, setLang } = useT();
  const navigate = useNavigate();
  const { session, demoEmail } = useSession();
  const [data, setData] = useState<Overview | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Outcome | null>(null);
  const [entering, setEntering] = useState(false);
  const [enterFailed, setEnterFailed] = useState(false);
  const run = useRunAgent({ first: '/api/demo/reset', next: '/api/invoices/run' });

  // Public and cached 60 s by the API; a retry or a reset skips the browser cache.
  const load = (fresh = false) => {
    setFailed(false);
    fetch('/api/demo/overview', fresh ? { cache: 'no-store' } : {})
      .then((r) => (r.ok ? (r.json() as Promise<Overview>) : Promise.reject(new Error(String(r.status)))))
      .then(setData, () => setFailed(true));
  };
  useEffect(() => load(), []);

  const enter = async () => {
    setEntering(true);
    setEnterFailed(false);
    const { error } = await Promise.all([supabase(), config()])
      .then(([sb, c]) => sb.auth.signInWithPassword({ email: c.demo_email, password: DEMO_PASSWORD }))
      .catch((e: Error) => ({ error: e }));
    if (!error) return navigate('/');
    setEntering(false);
    setEnterFailed(true);
  };

  const reset = async () => {
    await run.start();
    load(true);
  };

  const label = (o: Outcome | null) => (o ? t(`outcome.${o}`) : t('demo.inbox.pending'));
  // The chip already says the outcome, so the stored headline is shown without its "PAGAR · " prefix.
  const reason = (r: Row) => {
    const h = r[`headline_${lang}`];
    if (!r.outcome || !h) return t('demo.inbox.pending_row');
    const prefix = `${label(r.outcome)} · `;
    return h.startsWith(prefix) ? h.slice(prefix.length) : h;
  };
  const rows = data?.invoices.filter((r) => !filter || r.outcome === filter) ?? [];
  const p = data?.period;

  return (
    <div className="demo">
      <div className="lang-switch demo-lang" role="group" aria-label={t('topbar.language')}>
        <button type="button" className="link" aria-pressed={lang === 'es'} onClick={() => setLang('es')}>Español</button>
        <button type="button" className="link" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>English</button>
      </div>

      <header className="demo-hero">
        <p className="demo-mark">{t('app.name')}</p>
        <h1>{t('demo.title')}</h1>
        <div className="demo-problem">
          {[1, 2, 3].map((n) => <p key={n} data-testid="problem-line">{t(`demo.problem.${n}`)}</p>)}
        </div>
        <div className="demo-actions">
          <button type="button" className="primary" disabled={entering} onClick={() => void enter()}>{t(entering ? 'demo.entering' : 'demo.enter')}</button>
          {/* TODO(task18): the recorded happy-path video URL replaces this placeholder. */}
          <a href="#video">{t('demo.video')} →</a>
          {isDemoUser(session?.user, demoEmail) && (
            <button type="button" disabled={run.running} onClick={() => void reset()}>{t('demo.reset')}</button>
          )}
        </div>
        {enterFailed && <p role="alert" className="error">{t('demo.enter_failed')}</p>}
        <RunProgress run={run} mode="pending" />
      </header>

      <section className="demo-loop" aria-labelledby="demo-loop-title">
        <h2 id="demo-loop-title">{t('demo.loop.title')}</h2>
        <p>{t('demo.loop.lead')}</p>
        <ol aria-label={t('demo.loop.label')}>
          {STAGES.map((s) => (
            <li key={s}><strong>{t(`demo.stage.${s}`)}</strong><span>{t(`demo.stage.${s}.text`)}</span></li>
          ))}
        </ol>
        <blockquote>{t('demo.pitch')}</blockquote>
        <p className="demo-jev">{t('demo.jev')}</p>
      </section>

      <section className="demo-inbox" aria-labelledby="demo-inbox-title">
        <h2 id="demo-inbox-title">{t('demo.inbox.title')}</h2>
        <p>{t('demo.inbox.lead')}</p>
        {failed && (
          <div className="demo-unavailable">
            <p role="alert">{t('demo.inbox.unavailable')}</p>
            <button type="button" onClick={() => load(true)}>{t('demo.inbox.retry')}</button>
          </div>
        )}
        {!failed && !data && <p className="muted">{t('demo.inbox.loading')}</p>}
        {data && (
          <>
            <div className="demo-filter" role="group" aria-label={t('demo.inbox.filter')}>
              {[null, ...OUTCOMES].map((o) => (
                <button key={o ?? 'all'} type="button" className="link" aria-pressed={filter === o} onClick={() => setFilter(o)}>
                  {`${o ? label(o) : t('demo.inbox.all')} ${data.invoices.filter((r) => !o || r.outcome === o).length}`}
                </button>
              ))}
            </div>
            <ul className="demo-rows" data-ui aria-label={t('demo.inbox.label')}>
              {rows.map((r) => (
                <li key={r.id}>
                  <span className={`demo-chip demo-chip-${r.outcome ?? 'pending'}`}>{label(r.outcome)}</span>
                  <span>{reason(r)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="demo-period" aria-labelledby="demo-period-title">
        <h2 id="demo-period-title">{t('demo.period.title')}</h2>
        {p && (
          <dl>
            <dt>{p.autonomy_pct === null ? '—' : `${p.autonomy_pct} %`}</dt>
            <dd>{t('demo.period.autonomy', p.autonomy)}</dd>
            <dt>{p.violations}</dt>
            <dd>{t('demo.period.violations')}</dd>
            <dt>{`${p.explained_pct} %`}</dt>
            <dd>{t('demo.period.explained')}</dd>
          </dl>
        )}
      </section>

      <footer className="demo-footer">{`${t('app.name')}, ${t('app.tagline')}.`}</footer>
    </div>
  );
}
