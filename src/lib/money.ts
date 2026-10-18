// Money (D6, AC-14, AC-22). Amounts are numbers with 2 decimals; USD = round2(amount × policy rate).

// Half-up at 2 decimals; toPrecision(12) drops float noise (1.005 * 100 = 100.4999…).
export const round2 = (n: number): number => (Number.isFinite(n) ? Math.round(Number((n * 100).toPrecision(12))) / 100 : NaN);

const grouped = (s: string, sep: string) => new RegExp(`^\\d{1,3}(\\${sep}\\d{3})+$`).test(s);

// Decimal part is '.' + 1-2 digits or ',' + exactly 2 digits: es-CO prints ",00", so "2.500,5" is ambiguous -> null.
// Only a leading or trailing currency token is stripped; letters or spaces anywhere else -> null.
// A lone separator before exactly 3 digits is a thousands separator ("$ 2.500" = 2500). Anything else -> null.
export function parseAmount(raw: string): number | null {
  const m = /^([\d.,]+?)(?:\.(\d{1,2})|,(\d{2}))?$/.exec(raw.trim().replace(/^(?:[a-z]{3}|[$€£])\s*|\s*[a-z]{3}$/gi, ''));
  if (!m) return null;
  const [, int = '', dot, comma] = m;
  const ok = /^\d+$/.test(int) ||
    (dot !== undefined ? grouped(int, ',') : comma !== undefined ? grouped(int, '.') : grouped(int, '.') || grouped(int, ','));
  return ok ? Number(`${int.replace(/[.,]/g, '')}.${dot ?? comma ?? '0'}`) : null;
}

// R-71: the largest amount and USD amount the engine trusts; decisions.amount_usd numeric(14,2) can never overflow.
export const MAX_AMOUNT = 1e11;

// null = no usable rate (missing, zero or negative): the engine escalates "moneda sin tasa"; or a result that is not
// finite or above MAX_AMOUNT (R-71).
export function toUsd(amount: number, currency: string, rates: Record<string, number>): number | null {
  const rate = currency === 'USD' ? 1 : rates[currency];
  if (typeof rate !== 'number' || !(rate > 0) || !Number.isFinite(rate) || !Number.isFinite(amount)) return null;
  const usd = round2(amount * rate);
  return Number.isFinite(usd) && usd <= MAX_AMOUNT ? usd : null;
}
