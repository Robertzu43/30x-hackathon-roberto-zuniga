// The amount guard ("guardia del monto"): deterministic code over the document text, run at `lee`
// before and independently of the field model.
//
// Safety invariant: a non-null return sets read_error to 'nota_credito' or 'total_no_cuadra'.
// validFields() then clears the amount, lectura stays 'no_verificado', and decide() cannot return PAGAR
// for that invoice, whatever amount the model wrote. A photo is guarded only on the text the reader transcribed.
import type { InvoiceFields, ReadError } from '../engine/types';
import { parseAmount, round2 } from './money';

export interface Guarded { read_error: Exclude<ReadError, 'lector_no_disponible'>; read_detail: NonNullable<InvoiceFields['read_detail']> }

// Case and accents ignored, one code point for one code point, so a match's index points at the printed text.
// Only uppercase ASCII runs and non-ASCII code points need work, so ordinary text is not visited char by char.
const fold = (s: string) => s.replace(/[A-Z]+|[^\0-\x7f]/gu, (ch) => {
  const n = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return n.length === ch.length ? n : ch;
});

// R-81 (C): multi-word signals also match joined by any run of spaces, line breaks, `_`, `.`, hyphens (R-82 D: every
// R-81 minus and U+2010-2012), or by nothing. One unbounded run between two literals, never two side by side: linear time.
const J = '[\\s._\u2010-\u2014\u2212\uff0d\ufe63-]*';
const WORDS = new RegExp(`\\b(?:notas?${J}(?:de${J})?credito|credit${J}(?:notes?|memos?)|no${J}(?:cobrar|pagar)|do${J}not${J}pay` +
  `|saldo${J}a${J}favor|credit${J}balance|nc-\\d+)\\b`, 'g');
// R-80 (3) / R-81: a label, an optional percentage before or after `:`/`=`, then the amount with its optional
// parentheses, minus (before, or attached after the digits), currency (a code that is not a tax label, or a symbol) and
// `CR`. Or (A): a line holding only the label, `:`/`=` and a currency, and the amount on the next line. Whitespace is
// collapsed first, so every gap is one optional space: no input backtracks (F1). A digit after a space (`1 500,00`) or
// after a minus (`2026-10`) voids the token (R-81 F). Longer labels first.
const TAX = 'iva|impuestos?|igv|sales tax|tax(?:es)?|vat|impoconsumo';
const MINUS = '[-−–—－﹣]';
// R-82 (B): a code, a symbol, one to three letters before `$` (US$, COP$, R$), or S/ and S/.
const CUR = '(?:[a-z]{1,3}\\$|s\\/\\.?|(?!(?:iva|igv|vat|tax)\\b)[a-z]{3}\\b|[$€£])';
const PCT = '(?:\\(? ?\\d+(?:[.,]\\d+)? ?% ?\\)? ?)';
const LABELLED = new RegExp(`\\b(?:(?<sub>sub[ -]?total)|(?<taxTotal>total (?:${TAX}))` +
  '|(?<total>total a pagar|valor total|monto total|total due|amount due|grand total|total)' + `|(?<tax>${TAX}))\\b` +
  `(?: ?${PCT}?[:=]? ?${PCT}?|(?: ?[:=])?(?: ?${CUR})?(?<nl>\\n))(?:${CUR} ?)?(?<open>\\()? ?(?:(?<s1>${MINUS}) ?)?(?:${CUR} ?)?` +
  `(?:(?<s2>${MINUS}) ?)?(?<digits>\\d(?:[\\d.,]*\\d)?)(?<s3>${MINUS}(?!\\d))?(?! ?[\\d%]|${MINUS}\\d)(?: ?${CUR})?` +
  '(?: ?(?<close>\\)))?(?: ?(?<cr>cr)\\b)?', 'g');

const near = (a: number, b: number) => round2(Math.abs(a - b)) <= 0.01;

export function amountGuard(printed: string, amountRead: number | null): Guarded | null {
  // one space for every horizontal run, no blank lines: identical on text and folded, so indexes line up
  // R-82 (C): invisible characters removed first, so the signal is printed from the cleaned text
  const text = printed.replace(/[\u200b-\u200d\u2060\ufeff\u00ad]/g, '').normalize('NFC').replace(/[^\S\n]+/g, ' ').replace(/ ?\n[\n ]*/g, '\n').trim();
  const folded = fold(text);
  const subtotals: number[] = [], taxes: number[] = [], taxTotals: number[] = [], totals: number[] = [];
  const signals: Array<{ at: number; end: number }> = [...folded.matchAll(WORDS)].map((m) => ({ at: m.index, end: m.index + m[0].length }));
  for (const m of folded.matchAll(LABELLED)) {
    const g = m.groups ?? {}, end = m.index + m[0].length;
    // (A): only a label on its line, and only an amount on the next one
    if (g.nl && ((m.index > 0 && folded[m.index - 1] !== '\n') || (end < folded.length && folded[end] !== '\n'))) continue;
    const n = parseAmount(g.digits ?? '');
    if (n === null) continue; // R-44: unparseable = ignored
    if (g.sub) subtotals.push(n);
    else if (g.taxTotal) taxTotals.push(n);
    else if (g.tax) taxes.push(n);
    else if (g.s1 || g.s2 || g.s3 || (g.open && g.close) || g.cr) signals.push({ at: m.index, end });
    else totals.push(n);
  }
  const first = signals.sort((a, b) => a.at - b.at)[0];
  if (first) return { read_error: 'nota_credito', read_detail: { signal: text.slice(first.at, Math.min(first.end, first.at + 60)).replace(/\n/g, ' ') } };
  const s = subtotals.at(-1), tax = round2(taxTotals.at(-1) ?? taxes.reduce((a, b) => a + b, 0)), sum = s === undefined ? null : round2(s + tax);
  const listed = totals.join('; ');
  if (s !== undefined && sum !== null && totals.length && !totals.some((t) => near(t, sum))) {
    return { read_error: 'total_no_cuadra', read_detail: { subtotal: s, tax, sum, totals: listed, amount_read: amountRead } };
  }
  if (amountRead !== null && totals.length && !totals.some((t) => near(t, amountRead))) {
    return { read_error: 'total_no_cuadra', read_detail: { subtotal: null, tax: null, sum: null, totals: listed, amount_read: amountRead } };
  }
  return null;
}
