// The trial door on /login and /demo, their one primary action (AC-92, AC-94, AC-40 and AC-45 Clarified; R-120).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../auth';
import { useT } from '../i18n';
import { enterDemo, isTrial, startTrial } from '../trial';
import './trial.css';

export default function TrialButton() {
  const { t, lang } = useT();
  const navigate = useNavigate();
  const { session } = useSession();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<'trial' | 'demo' | null>(null);

  // The sign-in below makes this a trial session mid-click: the busy text stays until Bandeja opens.
  if (isTrial(session?.user) && !busy)
    return <button type="button" className="primary" onClick={() => navigate('/')}>{t('trial.back')}</button>;

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(null);
    if (await startTrial(lang)) return navigate('/', { replace: true });
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
        {t(busy ? 'trial.creating' : 'trial.start')}
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
