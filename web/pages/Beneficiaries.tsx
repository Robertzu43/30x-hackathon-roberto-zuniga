// Placeholder: Task 14 replaces this file wholesale (keep the route export and the data-tour=beneficiaries anchor).
import type { PageRoute } from '../App';
import { useT } from '../i18n';

export const route: PageRoute = { path: '/beneficiaries', nav: { key: 'screen.beneficiaries', order: 30 } };

export default function Beneficiaries() {
  const { t } = useT();
  return (
    <section data-tour="beneficiaries">
      <h1>{t('screen.beneficiaries')}</h1>
      <p className="muted">{t('screen.pending')}</p>
    </section>
  );
}
