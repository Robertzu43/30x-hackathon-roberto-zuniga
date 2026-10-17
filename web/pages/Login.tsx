import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../api';
import { useLeaveGuard } from '../components/LeaveTrialWarning';
import Logo from '../components/Logo';
import { PasswordField } from '../components/SaveAccess';
import TrialButton from '../components/TrialButton';
import { useT } from '../i18n';
import { runUntilDone, type Progress } from '../runAgent';
import type { Lang } from '../../src/i18n';
import './login.css';


/**
 * AC-40: email -> one-time code -> Bandeja. A language picked here is stored on the user once the code is accepted (AC-41).
 * The trial door is the primary (AC-92, R-120); «Enviar código» and «Entrar con contraseña» (AC-95) are secondary and warn
 * an unsaved trial first (AC-94, R-119).
 */
export default function Login() {
  const { t, lang, setLang } = useT();
  const navigate = useNavigate();
  const from: unknown = useLocation().state?.from; // the deep link RequireAuth sent here from (R-62)
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [withPassword, setWithPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deciding, setDeciding] = useState<Progress | null | false>(false);
  const [picked, setPicked] = useState<Lang | null>(null); // only a click on this screen counts as a choice
  const pick = (l: Lang) => { setPicked(l); setLang(l); };
  const { guard, warning } = useLeaveGuard();

  const send = (e: FormEvent) => {
    e.preventDefault();
    guard(() => void sendCode());
  };
  const sendCode = async () => {
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
    await signedIn();
  };

  const signInPassword = async () => {
    setBusy(true);
    setError('');
    const { error } = await supabase()
      .then((sb) => sb.auth.signInWithPassword({ email: email.trim(), password }))
      .catch((err: Error) => ({ error: err }));
    if (error) {
      setBusy(false);
      const refused = error as { code?: string; status?: number }; // GoTrue: 400 invalid_credentials; a thrown fetch has neither
      return setError(t(refused.code === 'invalid_credentials' || refused.status === 400 ? 'account.wrong' : 'account.login_failed'));
    }
    await signedIn();
  };
  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    guard(() => void signInPassword());
  };

  // After either sign-in (code or password).
  const signedIn = async () => {
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
        <h1><Logo /></h1>{/* the logo is the wordmark: the name is shown once (AC-80) */}
        <p className="login-lead">{t('login.lead')}</p>
      </section>
      <section className="login-form">
        <div className="lang-switch" role="group" aria-label={t('login.language')}>
          <button type="button" className="link" aria-pressed={lang === 'es'} onClick={() => pick('es')}>Español</button>
          <span aria-hidden="true">|</span>
          <button type="button" className="link" aria-pressed={lang === 'en'} onClick={() => pick('en')}>English</button>
        </div>
        {withPassword ? (
          <>
            <form onSubmit={submitPassword}>
              <label htmlFor="login-email">{t('login.email')}</label>
              <input id="login-email" type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
              <PasswordField id="login-password" value={password} onChange={setPassword} autoComplete="current-password" />
              <button type="submit" className="primary" disabled={busy}>{deciding !== false ? t('login.deciding', { n: deciding?.n ?? 0, m: deciding?.m ?? '…' }) : t(busy ? 'login.verifying' : 'login.verify')}</button>
              <button type="button" className="link" onClick={() => { setWithPassword(false); setError(''); }}>{t('account.back')}</button>
            </form>
            {warning}
          </>
        ) : !sent ? (
          <>
            <TrialButton />
            <form onSubmit={send}>
              <label htmlFor="login-email">{t('login.email')}</label>
              <input id="login-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              <button type="submit" disabled={busy}>{t(busy ? 'login.sending' : 'login.send')}</button>
            </form>
            <button type="button" onClick={() => { setWithPassword(true); setError(''); }}>{t('account.with_password')}</button>
            {warning}
          </>
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
