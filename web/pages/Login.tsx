import type { Session } from '@supabase/supabase-js';
import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { startInbox, supabase } from '../api';
import { prefetchInbox, whenIdle } from '../App';
import { isDemoUser, useSession } from '../auth';
import { useLeaveGuard } from '../components/LeaveTrialWarning';
import LogoIntro from '../components/LogoIntro';
import { MIN, PasswordField } from '../components/SaveAccess';
import TrialButton from '../components/TrialButton';
import { markFirstRun } from '../firstRun';
import { enterApp } from '../transition';
import { useT } from '../i18n';
import type { Lang } from '../../src/i18n';
import './login.css';


/**
 * AC-40: email -> one-time code -> Bandeja. A language picked here is stored on the user once the code is accepted (AC-41).
 * AC-107: Bandeja opens right after the sign-in call; the language write is not awaited and the shell runs the first-login pass.
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
  const [picked, setPicked] = useState<Lang | null>(null); // only a click on this screen counts as a choice
  const pick = (l: Lang) => { setPicked(l); setLang(l); };
  const { guard, warning } = useLeaveGuard();
  const { demoEmail } = useSession();
  useEffect(() => whenIdle(prefetchInbox), []); // R-150 lever 3: once usable; and on a door's hover or focus, below

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
    const { data, error } = await (await supabase()).auth
      .verifyOtp({ email: email.trim(), token: code, type: 'email' })
      .catch((err: Error) => ({ data: null, error: err }));
    if (error) {
      setBusy(false);
      return setError(t('login.wrong_code'));
    }
    signedIn(data?.session);
  };

  const signInPassword = async () => {
    setBusy(true);
    setError('');
    const { data, error } = await supabase()
      .then((sb) => sb.auth.signInWithPassword({ email: email.trim(), password }))
      .catch((err: Error) => ({ data: null, error: err }));
    if (error) {
      setBusy(false);
      const refused = error as { code?: string; status?: number }; // GoTrue: 400 invalid_credentials; a thrown fetch has neither
      return setError(t(refused.code === 'invalid_credentials' || refused.status === 400 ? 'account.wrong' : 'account.login_failed'));
    }
    signedIn(data?.session);
  };
  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    if (password.length < MIN) return setError(t('door.short_password')); // R-134: refused here, no call, no leave warning
    guard(() => void signInPassword());
  };

  // After either sign-in (code or password): nothing else is awaited before Bandeja (AC-107).
  const signedIn = (session?: Session | null) => {
    const saved: unknown = session?.user.user_metadata?.lang; // AuthProvider applies it too (AC-41, never the demo's, R-78): ask in it
    if (!picked && (saved === 'es' || saved === 'en') && !isDemoUser(session?.user, demoEmail)) setLang(saved);
    if (picked) {
      // AuthProvider applies the language saved on the user from this same session object: the choice just made is put
      // there at once, so it shows now, and the write that stores it (AC-41) is fired, not awaited.
      if (session) session.user.user_metadata = { ...session.user.user_metadata, lang: picked };
      void supabase().then((sb) => sb.auth.updateUser({ data: { lang: picked } })).catch(() => undefined);
    }
    if (session) markFirstRun(session.user.id); // the shell decides what is pending, in budgeted calls, after landing (AC-70)
    const to = typeof from === 'string' ? from : '/'; // the root URL arrives here with from '/': still Bandeja
    if (session && to === '/') startInbox(session.user.id); // R-150 lever 2: Bandeja's data, beside the route change
    void enterApp(() => navigate(to, { replace: true })); // AC-109
  };

  return (
    <div className="login" data-split>{/* R-196: the 1.split gate row measures the split and the form panel */}
      <section className="login-intro">
        <h1><LogoIntro screen="login" /></h1>{/* the logo is the wordmark: the name is shown once (AC-80) */}
        <p className="login-lead">{t('brand.subline')}</p>
      </section>
      <section className="login-form" data-panel="form" onPointerOver={prefetchInbox} onFocus={prefetchInbox}>
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
              <button type="submit" className="primary" disabled={busy} aria-busy={busy}>{t(busy ? 'entry.signing_in' : 'login.enter')}</button>
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
            <button type="submit" className="primary" disabled={busy} aria-busy={busy}>{t(busy ? 'entry.signing_in' : 'login.verify')}</button>
            <button type="button" className="link" onClick={() => { setSent(false); setCode(''); setError(''); }}>{t('login.other_email')}</button>
          </form>
        )}
        {error && <p role="alert" className="error">{error}</p>}
      </section>
    </div>
  );
}
