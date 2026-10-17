import type { TraceStep } from '../../src/agent/trace';
import { useT } from '../i18n';

/** "Lo que hice" (AC-64): the stored steps, numbered, each tagged with its loop stage. */
export default function AgentTrace({ steps }: { steps: TraceStep[] }) {
  const { t } = useT();
  return (
    <section className="detail-trace">
      <h2>{t('detail.did')}</h2>
      <ol aria-label={t('detail.did')}>
        {steps.map((s, i) => (
          <li key={i}>
            <span className="trace-n">{i + 1}</span>
            <span className="trace-stage">{t(`trace.stage.${s.stage}`)}</span>
            <span>{s.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
