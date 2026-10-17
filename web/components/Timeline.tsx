import type { StoredDecision } from '../../src/agent/trace';
import { useT } from '../i18n';
import { tu } from './User';

/** "Historial" (AC-26): every decision, oldest first, with actor, outcome and Bogotá date-time. */
export default function Timeline({ decisions }: { decisions: StoredDecision[] }) {
  const { t, locale } = useT();
  // R-116: a guest's stored invitado:<8 hex> reads «Invitado <8 hex>»; R-131: only the data is marked, never the copy.
  const who = (email: string | null) =>
    email?.startsWith('invitado:') ? tu(t('trial_record.guest'), { id: email.slice(9) }) : email && <span data-user="">{email}</span>;
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Bogota' });
  return (
    <section>
      <h2>{t('detail.history')}</h2>
      <ol className="timeline" aria-label={t('detail.history')}>
        {decisions.map((d) => (
          <li key={d.id}>
            <span>{d.actor === 'agent' ? t('detail.actor.agent') : <>{who(d.actor_email)}{d.actor_email && d.channel ? ' ' : ''}{d.channel && t(`channel.${d.channel}`)}</>}</span>
            <span className={`chip ${d.outcome}`}>{t(`outcome.${d.outcome}`)}</span>
            <time dateTime={d.created_at} className="muted">{when.format(new Date(d.created_at))}</time>
            {d.note && <p className="muted">{tu(t('detail.note'), { note: d.note })}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}
