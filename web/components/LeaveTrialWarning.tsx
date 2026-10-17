// AC-94 (R-119): an action that would end an unsaved trial session warns first, in place.
import { useState, type ReactNode } from 'react';
import { useSession } from '../auth';
import { useT } from '../i18n';
import { guardLeave, useTrialCompany } from '../trial';
import SaveAccess from './SaveAccess';
import './trial.css';

type Props = { company: string | null; onSave: () => void; onLeave: () => void; onCancel: () => void };

export default function LeaveTrialWarning({ company, onSave, onLeave, onCancel }: Props) {
  const { t } = useT();
  return (
    <div className="leave-trial" role="alertdialog" aria-labelledby="leave-trial-ask" onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
      <p id="leave-trial-ask">{t('trial.leave.ask', { company: company ?? t('trial.company') })}</p>
      <button type="button" className="primary" autoFocus onClick={onSave}>{t('trial.save')}</button>
      <button type="button" onClick={onLeave}>{t('trial.leave.go')}</button>
      <button type="button" onClick={onCancel}>{t('trial.leave.cancel')}</button>
    </div>
  );
}

/**
 * `guard(leave)` runs `leave` at once, or shows the warning first for an unsaved trial; `save()` opens «Guardar mi acceso»
 * (AC-95), which is also what the warning's primary does. Render `warning` next to the action: it is the warning or the dialog.
 * `company` is the trial's name (null until loaded, or when not a trial).
 */
export function useLeaveGuard(): { guard: (leave: () => void) => void; save: () => void; warning: ReactNode; company: string | null } {
  const user = useSession().session?.user;
  const company = useTrialCompany();
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [saving, setSaving] = useState(false);
  const guard = (leave: () => void) => guardLeave(user, leave, (go) => setPending(() => go));
  const save = () => { setPending(null); setSaving(true); };
  const warning = saving ? <SaveAccess onClose={() => setSaving(false)} /> : pending && (
    <LeaveTrialWarning
      company={company}
      onSave={save}
      onLeave={() => { setPending(null); pending(); }}
      onCancel={() => setPending(null)}
    />
  );
  return { guard, save, warning, company };
}
