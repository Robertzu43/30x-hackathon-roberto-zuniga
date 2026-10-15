export function toE164(raw: string): string | null {
  let d = raw.replace(/[\s\-.()]/g, '');
  if (d.startsWith('+')) {
    if (!d.startsWith('+57')) return null;
    d = d.slice(3);
  } else if (d.length === 12 && d.startsWith('57')) d = d.slice(2);
  return /^(3|60)\d+$/.test(d) && d.length === 10 ? `+57${d}` : null;
}

// Bogota is UTC-5 with no DST.
export const bogotaToday = (now: Date = new Date()): string =>
  new Date(now.getTime() - 5 * 3600e3).toISOString().slice(0, 10);

export const formatDate = (iso: string): string => iso.split('-').reverse().join('/');

export const formatCOP = (n: number): string => `$ ${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n)}`;

export function parseCOP(raw: string): number | null {
  const s = raw.replace(/[$\s]/g, '').replace(/,0+$/, '');
  return /^(\d+|\d{1,3}(\.\d{3})+)$/.test(s) ? Number(s.replace(/\./g, '')) : null;
}
