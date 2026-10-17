import type { Check } from '../../src/engine/types';
import { useT } from '../i18n';

// The verdict word is inside each sentence ("→ cumple"); the mark repeats it for scanning, never alone.
const MARK = { cumple: '✓', no_cumple: '✕', no_verificado: '?' } as const;

/** "Lo que decidí" (AC-26, R-22): one row per check, the API's sentence beside a verdict mark. */
export default function ChecksTable({ explanations, checks }: { explanations: string[]; checks: Check[] }) {
  const { t } = useT();
  return (
    <section>
      <h2>{t('detail.decided')}</h2>
      <ul className="checks" aria-label={t('detail.decided')}>
        {explanations.map((s, i) => {
          const c = checks[i];
          const cut = s.indexOf(': ');
          return (
            <li key={i} className={c ? `${c.verdict}${c.overridden ? ' overridden' : ''}` : undefined}>
              <span className="mark" aria-hidden="true">{c ? MARK[c.verdict] : ''}</span>
              <span><strong>{s.slice(0, cut)}</strong>{s.slice(cut)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
