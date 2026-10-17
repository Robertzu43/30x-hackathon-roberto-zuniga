// Placeholder: Task 15 replaces this file wholesale (keep the route export and the data-tour=period anchor).
import type { PageRoute } from '../App';
import { useT } from '../i18n';

export const route: PageRoute = { path: '/period', nav: { key: 'screen.period', order: 40 } };

export default function Period() {
  const { t } = useT();
  return (
    <section data-tour="period">
      <h1>{t('screen.period')}</h1>
      <p className="muted">{t('screen.pending')}</p>
    </section>
  );
}
