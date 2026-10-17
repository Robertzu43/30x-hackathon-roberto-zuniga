// Placeholder: Task 14 replaces this file wholesale (keep the route export and the data-tour=policy anchor).
import type { PageRoute } from '../App';
import { useT } from '../i18n';

export const route: PageRoute = { path: '/policy', nav: { key: 'screen.policy', order: 20 } };

export default function Policy() {
  const { t } = useT();
  return (
    <section data-tour="policy">
      <h1>{t('screen.policy')}</h1>
      <p className="muted">{t('screen.pending')}</p>
    </section>
  );
}
