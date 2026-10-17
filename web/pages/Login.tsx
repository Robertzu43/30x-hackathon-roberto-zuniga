import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PageRoute } from '../App';
import { api, supabase } from '../api';
import { useT } from '../i18n';

export const route: PageRoute = { path: '/login', public: true, fullBleed: true };

/** AC-40: email -> one-time code -> Bandeja. The language picked here is stored on the user at sign-in (auth.tsx, AC-41). */
export default function Login() {
  const { t, lang, setLang } = useT();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deciding, setDeciding] = useState(false);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error } = await (await supabase()).auth
      .signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } })
      .catch((err: Error) => ({ error: err }));
    setBusy(false);
    if (error) return setError(t('login.send_failed'));
    setSent(true);
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error } = await (await supabase()).auth
      .verifyOtp({ email: email.trim(), token: code, type: 'email' })
      .catch((err: Error) => ({ error: err }));
    if (error) {
      setBusy(false);
      return setError(t('login.wrong_code'));
    }
    // First login: decide what is pending once. A failure is not fatal: the 5-minute cron decides them (D23).
    setDeciding(true);
    await api.post('/api/invoices/run').catch(() => undefined);
    navigate('/', { replace: true });
  };

  return (
    <div className="login">
      <section className="login-intro">
        <h1>{t('login.title')}</h1>
        <p className="login-lead">{t('login.lead')}</p>
      </section>
      <section className="login-form">
        <div className="lang-switch" role="group" aria-label={t('login.language')}>
          <button type="button" className="link" aria-pressed={lang === 'es'} onClick={() => setLang('es')}>Español</button>
          <span aria-hidden="true">|</span>
          <button type="button" className="link" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>English</button>
        </div>
        {!sent ? (
          <form onSubmit={send}>
            <label htmlFor="login-email">{t('login.email')}</label>
            <input id="login-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            <button type="submit" className="primary" disabled={busy}>{t(busy ? 'login.sending' : 'login.send')}</button>
          </form>
        ) : (
          <form onSubmit={verify}>
            <p>{t('login.sent', { email: email.trim() })}</p>
            <label htmlFor="login-code">{t('login.code')}</label>
            <input
              id="login-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
            <button type="submit" className="primary" disabled={busy}>{t(deciding ? 'login.deciding' : busy ? 'login.verifying' : 'login.verify')}</button>
            <button type="button" className="link" onClick={() => { setSent(false); setCode(''); setError(''); }}>{t('login.other_email')}</button>
          </form>
        )}
        {error && <p role="alert" className="error">{error}</p>}
      </section>
    </div>
  );
}
