import type { StoredDecision } from '../../src/agent/trace';
import { useT } from '../i18n';
import { tu } from './User';

// AC-102: a person's initials, up to two, from the local-part segments split as R-26 splits them.
const initials = (email: string) => email.split('@')[0]!.split(/[._+-]/).map((w) => w[0] ?? '').filter((c) => /\p{L}/u.test(c)).slice(0, 2).join('').toUpperCase();
const GLYPH = <svg viewBox="0 0 16 16" width="16" height="16"><circle cx="8" cy="5.5" r="3" fill="currentColor" /><path d="M2.5 14.5a5.5 5.5 0 0 1 11 0z" fill="currentColor" /></svg>;

/** "Historial" (AC-26): every decision, oldest first, with actor, outcome and Bogotá date-time. */
export default function Timeline({ decisions }: { decisions: StoredDecision[] }) {
  const { t, locale } = useT();
  // R-116: a guest's stored invitado:<8 hex> reads «Invitado <8 hex>»; R-131: only the data is marked, never the copy.
  const who = (email: string | null) =>
    email?.startsWith('invitado:') ? tu(t('trial_record.guest'), { id: email.slice(9) }) : email && <span data-user="">{email}</span>;
  // The Thesaurus mark for the agent, initials for a person (data, R-131), a neutral glyph for a guest or no letters.
  const avatar = (d: StoredDecision) => {
    if (d.actor === 'agent') return <img src="/brand/thesaurus-mark.svg" alt="" width={24} height={24} />;
    const i = d.actor_email && !d.actor_email.startsWith('invitado:') ? initials(d.actor_email) : '';
    return i ? <span data-user="">{i}</span> : GLYPH;
  };
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Bogota' });
  return (
    <section>
      <h2>{t('detail.history')}</h2>
      <ol className="timeline" aria-label={t('detail.history')}>
        {decisions.map((d) => (
          <li key={d.id}>
            <span className="avatar" aria-hidden="true">{avatar(d)}</span>
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
