import type { Check } from '../../src/engine/types';
import { money } from '../../src/engine/explain';
import { useT } from '../i18n';

/** AC-102 (AC-74): the rate the Moneda check stored, as «1 USD = 4.020,10 COP · Yahoo Finance · 17 oct 2026 10:00 ·
 * 1.500.000 COP = 373,14 USD», or «tasa fijada por la política v<n>» for a pin. Nothing shown without a stored rate. */
export default function FxCard({ check, version }: { check: Check | undefined; version: number | null }) {
  const { t, lang, locale } = useT();
  const v = check?.values ?? {};
  const { rate, currency, amount, amount_usd: usd, rate_source: src, rate_fetched_at: at } = v;
  if (typeof rate !== 'number' || !(rate > 0) || typeof currency !== 'string' || currency === 'USD') return null;
  const per = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(1 / rate);
  const parts = [`1 USD = ${per} ${currency}`];
  if (src === 'policy') parts.push(t('detail.fx.pin', { version: version == null ? '' : ` v${version}` }));
  else if (typeof src === 'string') parts.push(src, ...(typeof at === 'string' ? [stamp(locale, at)] : []));
  if (typeof amount === 'number' && typeof usd === 'number') parts.push(`${money(amount, lang)} ${currency} = ${money(usd, lang)} USD`);
  return (
    <section className="detail-card fx-card">
      <h3>{t('detail.fx')}</h3>
      <p>{parts.join(' · ')}</p>
    </section>
  );
}

// «17 oct 2026 10:00» / «Oct 17, 2026 10:00» in Bogotá, as the Moneda sentence prints it (explain.ts dateTime).
function stamp(locale: string, iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = Object.fromEntries(new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit',
    minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Bogota' }).formatToParts(d).map((x) => [x.type, x.value]));
  const month = String(p.month).replace(/\.$/, '');
  return locale === 'es-CO' ? `${p.day} ${month} ${p.year} ${p.hour}:${p.minute}` : `${month} ${p.day}, ${p.year} ${p.hour}:${p.minute}`;
}
