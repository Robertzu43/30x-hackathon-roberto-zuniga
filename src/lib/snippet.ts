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

// The first place `text` prints the value. Longest form first; no letter, digit or "digit + separator" may touch the value,
// so 1000 is not found inside 21.000,00.
function find(text: string | null, name: string, value: unknown): RegExpExecArray | null {
  if (!text || (typeof value !== 'string' && typeof value !== 'number') || value === '') return null;
  const alts = [...new Set(forms(name, value))].sort((a, b) => b.length - a.length)
    .map((f) => esc(f).replace(/ del\\\? /g, ' del? ').replace(/[ \t\u00a0]+/g, '[ \\t\\u00a0]+'));
  return new RegExp(`(?<![\\p{L}\\p{N}]|\\d[.,])(?:${alts.join('|')})(?![\\p{L}\\p{N}]|[.,]\\d)`, 'iu').exec(text);
}

// "Lo que leí" fields in screen order (AC-12, AC-77).
export const READ = ['payee_name', 'amount', 'currency', 'invoice_number', 'issue_date', 'due_date', 'concept', 'bank_account'] as const;

// AC-102: where each read value is printed in the stored text, as [start, end) offsets into it, sorted, never overlapping
// (an overlapping later mark is dropped, so the web can wrap each in <mark> as is). No stored text: null.
export function docMarks(text: string | null, fields: Partial<Record<(typeof READ)[number], unknown>> | null) {
  if (!text) return null;
  const found = READ.flatMap((field) => {
    const m = find(text, field, fields?.[field]);
    return m ? [{ field, start: m.index, end: m.index + m[0].length }] : [];
  }).sort((a, b) => a.start - b.start);
  let end = 0;
  return found.filter((m) => {
    if (m.start < end) return false;
    end = m.end;
    return true;
  });
}

export function locate(text: string | null, name: string, value: string | number | null): { snippet: string | null; match: [number, number] | null } {
  const none = { snippet: null, match: null };
  const m = find(text, name, value);
  if (!text || !m) return none;
  const from = text.lastIndexOf('\n', m.index - 1) + 1;
  const to = text.indexOf('\n', m.index);
  const raw = text.slice(from, to < 0 ? text.length : to).trimEnd();
  const line = raw.trimStart();
  const start = m.index - from - (raw.length - line.length);
  return cut(line, start, start + m[0].length);
}

// R-130: the window of trimmed line L around the span [s, e): centred, snapped to whole words, «…» where cut, <= 120 in all.
export function cut(L: string, s: number, e: number): { snippet: string; match: [number, number] } {
  if (L.length <= MAX) return { snippet: L, match: [s, e] };
  if (e - s > MAX - 2) return { snippet: L.slice(s, e), match: [0, e - s] };
  const ws = (i: number) => i < 0 || i >= L.length || /\s/.test(L[i]!);
  const size = (x: number, y: number) => y - x + (x > 0 ? 1 : 0) + (y < L.length ? 1 : 0);
  let a = Math.max(0, Math.min(s - Math.floor((MAX - 2 - (e - s)) / 2), L.length - (MAX - 2)));
  let b = a + MAX - 2;
  if (a === 0) b = MAX - 1;
  else if (b === L.length) a = L.length - (MAX - 1);
  // An edge inside a word: inward to the word's edge, or, when the word holds part of the span, outward if it fits.
  let wordStart = -1, wordEnd = -1;
  if (!ws(a - 1) && !ws(a)) {
    let x = a;
    while (!ws(x)) x++;
    if (x > s) { wordStart = s; while (!ws(wordStart - 1)) wordStart--; a = s; } else a = Math.min(x, s);
  }
  if (!ws(b - 1) && !ws(b)) {
    let y = b;
    while (!ws(y - 1)) y--;
    if (y < e) { wordEnd = e; while (!ws(wordEnd)) wordEnd++; b = e; } else b = Math.max(y, e);
  }
  while (a < s && ws(a)) a++;
  while (b > e && ws(b - 1)) b--;
  if (wordStart >= 0 && size(wordStart, b) <= MAX) a = wordStart;
  if (wordEnd >= 0 && size(a, wordEnd) <= MAX) b = wordEnd;
  const m = a > 0 ? 1 : 0;
  return { snippet: `${m ? '\u2026' : ''}${L.slice(a, b)}${b < L.length ? '\u2026' : ''}`, match: [s - a + m, e - a + m] };
}
