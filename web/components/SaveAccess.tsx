// «Guardar mi acceso» (AC-95, R-118): attaches an email and a password to this same anonymous Auth user (updateUser;
// autoconfirm is on, so no mail), which keeps its company and data. The E1 probe proved it live, so there is no fallback route.
import { useState, type FormEvent } from 'react';
import { supabase } from '../api';
import { useT } from '../i18n';
import './trial.css';

const MIN = 8; // the Auth config's password_min_length (R-118); checked here so the message is ours, not the browser's

/** The password input with its show/hide toggle; Login's «Entrar con contraseña» uses it too. */
export function PasswordField({ id, value, onChange, autoComplete, hint }: {
  id: string; value: string; onChange: (v: string) => void; autoComplete: 'new-password' | 'current-password'; hint?: string;
}) {
  const { t } = useT();
  const [shown, setShown] = useState(false);
  return (
    <>
      <label htmlFor={id}>{t('account.password')}</label>
      <div className="password">
        <input id={id} type={shown ? 'text' : 'password'} autoComplete={autoComplete} required value={value}
          aria-describedby={hint ? `${id}-hint` : undefined} onChange={(e) => onChange(e.target.value)} />
        <button type="button" aria-pressed={shown} aria-controls={id} onClick={() => setShown(!shown)}>{t('account.show')}</button>
      </div>
      {hint && <p id={`${id}-hint`} className="muted">{hint}</p>}
    </>
  );
}

// GoTrue's refusals: an email another user has (422 email_exists), a password under the minimum (weak_password).
// Anything else, a thrown fetch included, is "try again".
const reason = (e: { code?: string; message?: string }) =>
  e.code === 'email_exists' || /already.*registered/i.test(e.message ?? '') ? 'account.email_taken'
    : e.code === 'weak_password' ? 'account.short_password' : 'account.save_failed';

export default function SaveAccess({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (password.length < MIN) return setError(t('account.short_password'));
    setBusy(true);
    const address = email.trim();
    const { error } = await supabase()
      .then((sb) => sb.auth.updateUser({ email: address, password }))
      .catch((x: Error) => ({ error: x }));
    setBusy(false);
    if (error) return setError(t(reason(error)));
    setSaved(address);
  };

  return (
    <div className="save-access" role="dialog" aria-labelledby="save-access-title" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <h2 id="save-access-title">{t('trial.save')}</h2>
      {saved ? (
        <>
          <p role="status">{t('account.saved', { email: saved })}</p>
          <button type="button" className="primary" autoFocus onClick={onClose}>{t('account.close')}</button>
        </>
      ) : (
        <form onSubmit={(e) => void save(e)}>
          <p className="muted">{t('account.lead')}</p>
          <label htmlFor="save-email">{t('login.email')}</label>
          <input id="save-email" type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          <PasswordField id="save-password" value={password} onChange={setPassword} autoComplete="new-password" hint={t('account.password_hint')} />
          {error && <p role="alert" className="error">{error}</p>}
          <div className="save-access-actions">
            <button type="submit" className="primary" disabled={busy} aria-busy={busy}>{t(busy ? 'account.saving' : 'trial.save')}</button>
            <button type="button" onClick={onClose}>{t('trial.leave.cancel')}</button>
          </div>
        </form>
      )}
    </div>
  );
}
