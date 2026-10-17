// The outcome chip of Bandeja, the detail and /demo (AC-29). null = not decided yet ("Pendiente").
import { useT } from '../i18n';
import '../pages/inbox.css';

export type Outcome = 'PAGAR' | 'FRENAR' | 'ESCALAR';

export function OutcomeChip({ outcome }: { outcome: Outcome | null }) {
  const { t } = useT();
  return <span className={`chip chip-${outcome ?? 'pending'}`}>{t(outcome ? `outcome.${outcome}` : 'inbox.pending')}</span>;
}
export default OutcomeChip;
