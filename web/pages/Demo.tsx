// Placeholder: Task 16 replaces this file wholesale (keep the route export).
import type { PageRoute } from '../App';
import { useT } from '../i18n';

export const route: PageRoute = { path: '/demo', public: true };

export default function Demo() {
  const { t } = useT();
  return (
    <section>
      <h1>{t('screen.demo')}</h1>
      <p className="muted">{t('screen.pending')}</p>
    </section>
  );
}
