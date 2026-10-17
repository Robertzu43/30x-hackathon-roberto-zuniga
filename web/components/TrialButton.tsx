// The trial door on /login and /demo, their one primary action (AC-92, AC-94, AC-40 and AC-45 Clarified; R-120).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../auth';
import { useT } from '../i18n';
import type { Progress } from '../runAgent';
import { enterDemo, isTrial, startTrial } from '../trial';
import './trial.css';

export default function TrialButton() {
  const { t, lang } = useT();
  const navigate = useNavigate();
  const { session } = useSession();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [failed, setFailed] = useState<'trial' | 'demo' | null>(null);

  // The sign-in below makes this a trial session mid-run: the progress stays until Bandeja opens.
  if (isTrial(session?.user) && !busy)
    return <button type="button" className="primary" onClick={() => navigate('/')}>{t('trial.back')}</button>;

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(null);
    setProgress(null);
    if (await startTrial(lang, setProgress)) return navigate('/', { replace: true });
    setBusy(false);
    setFailed('trial');
  };
  const demo = async () => {
    if (await enterDemo()) return navigate('/');
    setFailed('demo');
  };

  return (
    <div className="trial-door">
      <button type="button" className="primary" disabled={busy} aria-busy={busy} onClick={() => void start()}>
        {!busy ? t('trial.start') : isTrial(session?.user) ? t('login.deciding', { n: progress?.n ?? 0, m: progress?.m ?? '…' }) : t('trial.creating')}
      </button>
      <p className="muted">{t('trial.lead')}</p>
      {failed && (
        <div className="error">
          <p role="alert">{t(failed === 'trial' ? 'trial.failed' : 'demo.enter_failed')}</p>
          {failed === 'trial' && <button type="button" onClick={() => void demo()}>{t('demo.enter')}</button>}
        </div>
      )}
    </div>
  );
}
