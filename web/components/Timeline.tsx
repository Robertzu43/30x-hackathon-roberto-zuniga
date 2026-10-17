import type { StoredDecision } from '../../src/agent/trace';
import { actorName } from '../../src/engine/explain';
import { useT } from '../i18n';

/** "Historial" (AC-26): every decision, oldest first, with actor, outcome and Bogotá date-time. */
export default function Timeline({ decisions }: { decisions: StoredDecision[] }) {
  const { t, lang, locale } = useT();
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Bogota' });
  return (
    <section>
      <h2>{t('detail.history')}</h2>
      <ol className="timeline" aria-label={t('detail.history')}>
        {decisions.map((d) => (
          <li key={d.id}>
            <span>{d.actor === 'agent' ? t('detail.actor.agent') : [actorName(d.actor_email, lang), d.channel && t(`channel.${d.channel}`)].filter(Boolean).join(' ')}</span>
            <span className={`chip ${d.outcome}`}>{t(`outcome.${d.outcome}`)}</span>
            <time dateTime={d.created_at} className="muted">{when.format(new Date(d.created_at))}</time>
            {d.note && <p className="muted">{t('detail.note', { note: d.note })}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}
