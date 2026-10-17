// Placeholder: Task 13 replaces this file wholesale (keep the route export).
import type { PageRoute } from '../App';
import { useT } from '../i18n';

export const route: PageRoute = { path: '/invoices/:id' };

export default function InvoiceDetail() {
  const { t } = useT();
  return (
    <section>
      <h1>{t('screen.invoice')}</h1>
      <p className="muted">{t('screen.pending')}</p>
    </section>
  );
}
