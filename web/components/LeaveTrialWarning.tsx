// AC-94 (R-119): an action that would end an unsaved trial session warns first, in place.
import { useState, type ReactNode } from 'react';
import { useSession } from '../auth';
import { useT } from '../i18n';
import { guardLeave, useTrialCompany } from '../trial';
import './trial.css';

type Props = { company: string | null; onSave?: () => void; onLeave: () => void; onCancel: () => void };

/** Without `onSave` (Task 41's dialog not mounted yet) there is no save button and «Cancelar» is the primary. */
export default function LeaveTrialWarning({ company, onSave, onLeave, onCancel }: Props) {
  const { t } = useT();
  return (
    <div className="leave-trial" role="alertdialog" aria-labelledby="leave-trial-ask" onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
      <p id="leave-trial-ask">{t('trial.leave.ask', { company: company ?? t('trial.company') })}</p>
      {onSave && <button type="button" className="primary" autoFocus onClick={onSave}>{t('trial.save')}</button>}
      <button type="button" onClick={onLeave}>{t('trial.leave.go')}</button>
      <button type="button" className={onSave ? undefined : 'primary'} autoFocus={!onSave} onClick={onCancel}>{t('trial.leave.cancel')}</button>
    </div>
  );
}

/** `guard(leave)` runs `leave` at once, or shows `warning` first for an unsaved trial. Render `warning` next to the action. */
export function useLeaveGuard(onSave?: () => void): { guard: (leave: () => void) => void; warning: ReactNode } {
  const user = useSession().session?.user;
  const company = useTrialCompany();
  const [pending, setPending] = useState<(() => void) | null>(null);
  const guard = (leave: () => void) => guardLeave(user, leave, (go) => setPending(() => go));
  const warning = pending && (
    <LeaveTrialWarning
      company={company}
      onSave={onSave && (() => { setPending(null); onSave(); })}
      onLeave={() => { setPending(null); pending(); }}
      onCancel={() => setPending(null)}
    />
  );
  return { guard, warning };
}
