import type { Check, Verdict } from '../../src/engine/types';
import { Segments } from '../charts/lazy';
import type { Tone } from '../charts/shared';
import { useT } from '../i18n';

// The verdict word sits beside the mark (AC-102), so the mark is never read alone.
const MARK = { cumple: '✓', no_cumple: '✕', no_verificado: '?' } as const;
const TONE: Record<Verdict, Tone> = { cumple: 'pagar', no_cumple: 'frenar', no_verificado: 'escalar' };

/** "Lo que decidí" (AC-26, AC-102, R-22): a bar «11 de 13 cumplen», then one row per check: mark, verdict, rule name, the API's sentence. */
export default function RuleChecklist({ explanations, checks }: { explanations: string[]; checks: Check[] }) {
  const { t, locale } = useT();
  const count = (v: Verdict) => checks.filter((c) => c.verdict === v).length;
  const n = count('cumple');
  const title = t(`detail.rules.pass.${new Intl.PluralRules(locale).select(n) === 'one' ? 'one' : 'other'}`, { n, total: checks.length });
  return (
    <section>
      <h2>{t('detail.decided')}</h2>
      <Segments title={title} unit={t('detail.rules.unit')}
        segments={(['cumple', 'no_cumple', 'no_verificado'] as const).map((v) => ({ label: t(`verdict.${v}`), value: count(v), tone: TONE[v] }))} />
      <ul className="checks" aria-label={t('detail.decided')}>
        {explanations.map((s, i) => {
          const c = checks[i];
          const cut = s.indexOf(': ');
          return (
            <li key={i} className={c ? `${c.verdict}${c.overridden ? ' overridden' : ''}` : undefined}>
              <span className="mark" aria-hidden="true">{c ? MARK[c.verdict] : ''}</span>
              <span>
                {c && <span className="check-verdict">{t(`verdict.${c.verdict}`)}</span>}
                <strong>{s.slice(0, cut)}</strong>{s.slice(cut)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
