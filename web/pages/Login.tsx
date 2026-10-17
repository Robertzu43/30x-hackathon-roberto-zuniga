import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { PageRoute } from '../App';
import { supabase } from '../api';
import Logo from '../components/Logo';
import { useT } from '../i18n';
import { runUntilDone, type Progress } from '../runAgent';
import type { Lang } from '../../src/i18n';

export const route: PageRoute = { path: '/login', public: true, fullBleed: true };

/** AC-40: email -> one-time code -> Bandeja. A language picked here is stored on the user once the code is accepted (AC-41). */
export default function Login() {
  const { t, lang, setLang } = useT();
  const navigate = useNavigate();
  const from: unknown = useLocation().state?.from; // the deep link RequireAuth sent here from (R-62)
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deciding, setDeciding] = useState<Progress | null | false>(false);
  const [picked, setPicked] = useState<Lang | null>(null); // only a click on this screen counts as a choice
  const pick = (l: Lang) => { setPicked(l); setLang(l); };

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
    if (picked) {
      await (await supabase()).auth.updateUser({ data: { lang: picked } }).catch(() => undefined);
      setLang(picked); // the user's previously saved language may have been applied meanwhile; the choice just made wins
    }
    // First login: decide what is pending, in budgeted calls (AC-70). A failure is not fatal: the 5-minute cron decides them (D23).
    setDeciding(null);
    await runUntilDone({ first: '/api/invoices/run', onProgress: setDeciding });
    navigate(typeof from === 'string' ? from : '/', { replace: true });
  };

  return (
    <div className="login">
      <section className="login-intro">
        <Logo />
        <h1>{t('login.title')}</h1>
        <p className="login-lead">{t('login.lead')}</p>
      </section>
      <section className="login-form">
        <div className="lang-switch" role="group" aria-label={t('login.language')}>
          <button type="button" className="link" aria-pressed={lang === 'es'} onClick={() => pick('es')}>Español</button>
          <span aria-hidden="true">|</span>
          <button type="button" className="link" aria-pressed={lang === 'en'} onClick={() => pick('en')}>English</button>
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
            <button type="submit" className="primary" disabled={busy}>{deciding !== false ? t('login.deciding', { n: deciding?.n ?? 0, m: deciding?.m ?? '…' }) : t(busy ? 'login.verifying' : 'login.verify')}</button>
            <button type="button" className="link" onClick={() => { setSent(false); setCode(''); setError(''); }}>{t('login.other_email')}</button>
          </form>
        )}
        {error && <p role="alert" className="error">{error}</p>}
      </section>
    </div>
  );
}
