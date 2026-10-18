// The Canales card (AC-123): how invoices reach this company, three honest rows. «Copiar enlace» is the one from
// PortalLinkCard (AC-84 Clarified, R-102): clipboard, «Copiado» for 2 s announced politely, press-and-hold text if refused.
import { useState } from 'react';
import { useT } from '../i18n';
import './channels-card.css';

export type Channels = { portal_url: string; email_address: string | null; email_live: boolean; telegram_url: string | null };

function CopyLink({ url }: { url: string }) {
  const { t } = useT();
  const [copy, setCopy] = useState<'idle' | 'copied' | 'refused'>('idle');
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(url); // no clipboard API throws here too: counts as refused
      setCopy('copied');
      setTimeout(() => setCopy('idle'), 2000);
    } catch {
      setCopy('refused');
    }
  };
  return (
    <>
      <button type="button" onClick={() => void onCopy()}>{t(copy === 'copied' ? 'portal.copied' : 'portal.copy')}</button>
      {copy === 'refused' && <p className="muted">{t('portal.copy_failed')}</p>}
      <span className="sr-only" aria-live="polite">{copy === 'copied' ? t('portal.copied') : ''}</span>
    </>
  );
}

export default function ChannelsCard({ link }: { link: Channels | 'error' }) {
  const { t } = useT();
  if (link === 'error') return <p className="muted">{t('inbox.portal.error')}</p>;
  const email = link.email_live && link.email_address ? link.email_address : null; // an address only while the route works (R-190)
  const chip = (word: string, active: boolean) => <span className={`channel-chip ${active ? 'channel-chip-active' : 'channel-chip-idle'}`}>{t(word)}</span>;
  return (
    <section className="channels-card" data-block aria-labelledby="channels-title">
      <h2 id="channels-title">{t('channels.title')}</h2>
      <p className="muted">{t('channels.lead')}</p>
      <ul className="channels-list">
        <li data-channel="portal">
          <h3>{t('channels.portal.name')}</h3>
          {chip('channels.status.active', true)}
          <p>{t('channels.portal.text')}</p>
          <p className="channel-url">{link.portal_url}</p>
          <CopyLink url={link.portal_url} />
        </li>
        <li data-channel="email">
          <h3>{t('channels.email.name')}</h3>
          {chip(email ? 'channels.status.active' : 'channels.status.pending_domain', !!email)}
          <p>{t(email ? 'channels.email.text' : 'channels.email.pending')}</p>
          {email && <p className="channel-url">{email}</p>}
        </li>
        <li data-channel="telegram">
          <h3>{t('channels.telegram.name')}</h3>
          {chip(link.telegram_url ? 'channels.status.active' : 'channels.status.off', !!link.telegram_url)}
          <p>{t(link.telegram_url ? 'channels.telegram.text' : 'channels.telegram.off')}</p>
          {link.telegram_url && (
            <>
              <p className="channel-url">{link.telegram_url}</p>
              <CopyLink url={link.telegram_url} />
            </>
          )}
        </li>
      </ul>
    </section>
  );
}
