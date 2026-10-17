// "Leído por IA" provenance (AC-77, R-88): the line of the stored document text where code found a read value, at most 120
// characters, and the span of the value as printed there. Never the model's words. Not found = both null.
const MAX = 120;
const MONTHS = {
  es: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The ways a document prints the value: an amount in es-CO and en-US grouping, a YYYY-MM-DD date as d/m/y, m/d/y, ISO or
// words. ponytail: common forms only (no "1 500,00", no abbreviated months); add a form when a real document misses.
function forms(name: string, value: string | number): string[] {
  if (name === 'amount' && typeof value === 'number') {
    const [int = '', dec] = value.toFixed(2).split('.');
    const g = (sep: string) => int.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
    return [`${g('.')},${dec}`, `${g(',')}.${dec}`, `${int}.${dec}`, `${int},${dec}`, ...(dec === '00' ? [g('.'), g(','), int] : [])];
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (!iso || !name.endsWith('_date')) return [String(value)];
  const [, y, mm = '', dd = ''] = iso;
  const [m, d] = [String(Number(mm)), String(Number(dd))];
  const es = MONTHS.es[Number(mm) - 1], en = MONTHS.en[Number(mm) - 1];
  return [`${y}-${mm}-${dd}`, `${y}/${mm}/${dd}`, `${d} de ${es} del? ${y}`, `${en} ${d}, ${y}`, `${d} ${en} ${y}`,
    ...[dd, d].flatMap((day) => [mm, m].flatMap((mon) => ['/', '-', '.'].flatMap((s) => [`${day}${s}${mon}${s}${y}`, `${mon}${s}${day}${s}${y}`])))];
}

export function locate(text: string | null, name: string, value: string | number | null): { snippet: string | null; match: [number, number] | null } {
  const none = { snippet: null, match: null };
  if (!text || value === null || value === '') return none;
  // Longest form first; no letter, digit or "digit + separator" may touch the value, so 1000 is not found inside 21.000,00.
  const alts = [...new Set(forms(name, value))].sort((a, b) => b.length - a.length)
    .map((f) => esc(f).replace(/ del\\\? /g, ' del? ').replace(/[ \t\u00a0]+/g, '[ \\t\\u00a0]+'));
  const m = new RegExp(`(?<![\\p{L}\\p{N}]|\\d[.,])(?:${alts.join('|')})(?![\\p{L}\\p{N}]|[.,]\\d)`, 'iu').exec(text);
  if (!m || m[0].length > MAX) return none; // ponytail: a value over 120 characters cannot fit; no field is that long
  const from = text.lastIndexOf('\n', m.index - 1) + 1;
  const to = text.indexOf('\n', m.index);
  const raw = text.slice(from, to < 0 ? text.length : to).trimEnd();
  const line = raw.trimStart();
  const start = m.index - from - (raw.length - line.length), end = start + m[0].length;
  const cut = line.length <= MAX ? 0 : Math.min(Math.max(0, start - Math.floor((MAX - m[0].length) / 2)), line.length - MAX);
  return { snippet: line.slice(cut, cut + MAX), match: [start - cut, end - cut] };
}
