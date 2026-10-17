// The outcome chip of Bandeja, the detail and /demo (AC-29). null = not decided yet ("Pendiente").
import { format, type Lang } from '../../src/i18n';
import { ui } from '../../src/i18n/ui';
import { useT } from '../i18n';
import '../pages/inbox.css';

export type Outcome = 'PAGAR' | 'FRENAR' | 'ESCALAR';

export function OutcomeChip({ outcome, lang }: { outcome: Outcome | null; lang?: Lang }) {
  const ctx = useT();
  const label = format(ui[lang ?? ctx.lang], outcome ? `outcome.${outcome}` : 'inbox.pending');
  return <span className={`chip chip-${outcome ?? 'pending'}`}>{label}</span>;
}
export default OutcomeChip;
