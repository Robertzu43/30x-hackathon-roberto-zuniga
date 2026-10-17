// Public /demo pitch page (AC-45, AC-46, AC-47, AC-66, AC-79, R-30; design-taste-frontend, "quiet instrument" direction):
// the problem in Blinka's words, the agent loop and the pitch line, Andina Labs' read-only inbox and Periodo figures.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PageRoute } from '../App';
import { isDemoUser, useSession } from '../auth';
import { useLeaveGuard } from '../components/LeaveTrialWarning';
import Logo from '../components/Logo';
import TrialButton from '../components/TrialButton';
import { RunProgress, useRunAgent } from '../components/RunProgress';
import { useT } from '../i18n';
import { enterDemo } from '../trial';
import './demo.css';
import '../components/ai.css';

export const route: PageRoute = { path: '/demo', public: true, fullBleed: true };

const PORTAL = 'https://facturas.30x-hackathon-roberto-zuniga.workers.dev/andina-labs'; // AC-83's demo portal; ponytail: per-deploy value via /api/config if another company hosts /demo
const STAGES = ['percibe', 'lee', 'consulta', 'decide', 'actua', 'rinde'];
// AC-79: the model reads; code consults the tools and decides.
const TAG: Record<string, 'ai' | 'code'> = { lee: 'ai', consulta: 'code', decide: 'code' };
type Outcome = 'PAGAR' | 'FRENAR' | 'ESCALAR';
type Row = { id: string; outcome: Outcome | null; headline_es: string | null; headline_en: string | null };
type Overview = { invoices: Row[]; period: { autonomy: { n: number; m: number }; autonomy_pct: number | null; violations: number; explained_pct: number } };
// AC-99 (R-109): while the overview loads, the rows and figures are the loaded markup with these placeholders, hidden by .skeleton.
const SKELETON: Overview = {
  invoices: ['s1', 's2', 's3', 's4'].map((id) => ({ id, outcome: null, headline_es: null, headline_en: null })),
  period: { autonomy: { n: 1, m: 1 }, autonomy_pct: 100, violations: 0, explained_pct: 100 },
};
const hide = (loading: boolean) => (loading ? { 'aria-hidden': true, inert: true } as const : {});

export default function Demo() {
  const { t, lang, setLang } = useT();
  const navigate = useNavigate();
  const { session, demoEmail } = useSession();
  const [data, setData] = useState<Overview | null>(null);
  const [failed, setFailed] = useState(false);
  const [entering, setEntering] = useState(false);
  const [enterFailed, setEnterFailed] = useState(false);
  const [asking, setAsking] = useState(false); // AC-71: the shared demo is reset only after an in-place "Reiniciar"
  const run = useRunAgent({ first: '/api/demo/reset', next: '/api/invoices/run' });
  const { guard, warning } = useLeaveGuard(); // AC-94 (R-119): entering the shared demo ends an unsaved trial

  // Public and cached 60 s by the API; a retry or a reset skips the browser cache.
  const load = (fresh = false) => {
    setFailed(false);
    fetch('/api/demo/overview', fresh ? { cache: 'no-store' } : {})
      .then((r) => (r.ok ? (r.json() as Promise<Overview>) : Promise.reject(new Error(String(r.status)))))
      .then(setData, () => setFailed(true));
  };
  useEffect(() => load(), []);
  // R-78, D14: /demo opens in Spanish unless this tab chose otherwise; whatever another judge picked never carries over.
  useEffect(() => {
    if (sessionStorage.getItem('lang') === null) setLang('es', true);
  }, []);

  const enter = async () => {
    setEntering(true);
    setEnterFailed(false);
    if (await enterDemo()) return navigate('/');
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
  const shown = data ?? SKELETON;
  const p = shown.period;

  return (
    <div className="demo">
      <div className="lang-switch demo-lang" role="group" aria-label={t('topbar.language')}>
        <button type="button" className="link" aria-pressed={lang === 'es'} onClick={() => setLang('es', true)}>Español</button>
        <button type="button" className="link" aria-pressed={lang === 'en'} onClick={() => setLang('en', true)}>English</button>
      </div>

      <header className="demo-hero">
        <Logo />
        <h1>{t('demo.title')}</h1>
        <div className="demo-problem">
          {[1, 2, 3].map((n) => <p key={n} data-testid="problem-line">{t(`demo.problem.${n}`)}</p>)}
        </div>
        <TrialButton />
        <div className="demo-actions">
          <button type="button" disabled={entering} onClick={() => guard(() => void enter())}>{t(entering ? 'demo.entering' : 'demo.enter')}</button>
          <a href="/demo/happy-path.webm">{t('demo.video')} →</a>
          <a href={PORTAL}>{t('demo.portal')} →</a>
          {isDemoUser(session?.user, demoEmail) && (
            <button type="button" disabled={run.running || asking} onClick={() => setAsking(true)}>{t('demo.reset')}</button>
          )}
        </div>
        {asking && (
          <div className="demo-confirm">
            <p>{t('demo.reset.ask')}</p>
            <button type="button" className="primary" onClick={() => { setAsking(false); void reset(); }}>{t('demo.reset.yes')}</button>
            <button type="button" onClick={() => setAsking(false)}>{t('demo.reset.no')}</button>
          </div>
        )}
        {warning}
        {enterFailed && <p role="alert" className="error">{t('demo.enter_failed')}</p>}
        <RunProgress run={run} mode="pending" />
      </header>

      <section className="demo-loop" aria-labelledby="demo-loop-title">
        <h2 id="demo-loop-title">{t('demo.loop.title')}</h2>
        <p>{t('demo.loop.lead')}</p>
        <ol aria-label={t('demo.loop.label')}>
          {STAGES.map((s) => (
            <li key={s}>
              <span><strong>{t(`demo.stage.${s}`)}</strong>{TAG[s] && <span className={`ai-tag ai-tag-${TAG[s]}`}>{t(`demo.tag.${TAG[s]}`)}</span>}</span>
              <span>{t(`demo.stage.${s}.text`)}</span>
            </li>
          ))}
        </ol>
        <p className="demo-ask">
          <span><strong>{t('ask.title')}</strong><span className="ai-tag ai-tag-ai">{t('demo.tag.ai')}</span></span>
          <span>{t('demo.ask.text')}</span>
        </p>
        <p className="demo-where">{t('demo.where')}</p>
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
        {!failed && !data && <p role="status" className="sr-only">{t('demo.inbox.loading')}</p>}
        {!failed && (
          <ul className={data ? 'demo-rows' : 'demo-rows skeleton'} data-ui aria-label={t('demo.inbox.label')} {...hide(!data)}>
            {shown.invoices.map((r) => (
              <li key={r.id}>
                <span className={`demo-chip demo-chip-${r.outcome ?? 'pending'}`}>{label(r.outcome)}</span>
                <span>{reason(r)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="demo-period" aria-labelledby="demo-period-title">
        <h2 id="demo-period-title">{t('demo.period.title')}</h2>
        {!failed && (
          <dl className={data ? undefined : 'skeleton'} {...hide(!data)}>
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
