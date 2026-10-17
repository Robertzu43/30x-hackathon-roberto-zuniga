// «Comparte este enlace con tus proveedores» (AC-86) and the origin label of a portal or email invoice. «Copiar enlace»
// behaves like the portal's (R-102): clipboard, «Copiado» for 2 s announced politely, press-and-hold text if refused.
import { useState, type ReactNode } from 'react';
import { useT } from '../i18n';
import { tu } from './User';

export type PortalLink = { portal_url: string; email_address: string | null };

type T = ReturnType<typeof useT>['t'];
export const originLabel = (t: T, i: { origin?: string; sender?: string | null }): ReactNode =>
  i.origin === 'portal' ? t('inbox.origin.portal')
  : i.origin === 'email' ? (i.sender ? tu(t('inbox.origin.email'), { sender: i.sender }) : t('inbox.origin.email_unknown'))
  : null;

export default function PortalLinkCard({ link }: { link: PortalLink | 'error' }) {
  const { t } = useT();
  const [copy, setCopy] = useState<'idle' | 'copied' | 'refused'>('idle');
  if (link === 'error') return <p className="muted">{t('inbox.portal.error')}</p>;
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(link.portal_url); // no clipboard API throws here too: counts as refused
      setCopy('copied');
      setTimeout(() => setCopy('idle'), 2000);
    } catch {
      setCopy('refused');
    }
  };
  return (
    <section className="portal-card" aria-labelledby="portal-card-title">
      <h2 id="portal-card-title">{t('inbox.portal.title')}</h2>
      <p className="portal-card-url">{link.portal_url}</p>
      {link.email_address && <p className="muted">{t('inbox.portal.email', { email: link.email_address })}</p>}
      <button type="button" onClick={() => void onCopy()}>{t(copy === 'copied' ? 'portal.copied' : 'portal.copy')}</button>
      {copy === 'refused' && <p className="muted">{t('portal.copy_failed')}</p>}
      <span className="sr-only" aria-live="polite">{copy === 'copied' ? t('portal.copied') : ''}</span>
    </section>
  );
}
