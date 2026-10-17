// Placeholder: Task 12 replaces this file wholesale (keep the route export and the data-tour=inbox anchor).
import type { PageRoute } from '../App';
import { useT } from '../i18n';

export const route: PageRoute = { path: '/', nav: { key: 'screen.inbox', order: 10 } };

export default function Inbox() {
  const { t } = useT();
  return (
    <section data-tour="inbox">
      <h1>{t('screen.inbox')}</h1>
      <p className="muted">{t('screen.pending')}</p>
    </section>
  );
}
