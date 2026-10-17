// The amount guard ("guardia del monto", R-80, AC-14 Clarified): deterministic code over the document text, run at `lee`
// before and independently of the field model. A credit-note signal or a total that does not add up makes the amount
// unknown, so the invoice escalates whatever the model answered.
import type { InvoiceFields, ReadError } from '../engine/types';
import { parseAmount, round2 } from './money';

export interface Guarded { read_error: Exclude<ReadError, 'lector_no_disponible'>; read_detail: NonNullable<InvoiceFields['read_detail']> }

// Case and accents ignored, one code point for one code point, so a match's index points at the printed text.
const fold = (s: string) => [...s].map((ch) => {
  const n = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return n.length === ch.length ? n : ch;
}).join('');

const WORDS = /\b(?:nota\s+(?:de\s+)?credito|credit\s+(?:note|memo)|no\s+(?:cobrar|pagar)|do\s+not\s+pay|saldo\s+a\s+favor|credit\s+balance)\b/g;
// A label, an optional percentage («IVA 19 %:»), optional `:`/`=`, then an amount on the same line, with its optional
// parentheses, minus sign, currency (a code that is not a tax label, or a symbol) and `CR`. Longer labels first.
const S = '[ \\t\\u00a0]*';
const CUR = '(?:(?!(?:iva|igv|vat|tax)\\b)[a-z]{3}\\b|[$€£])';
const LABELLED = new RegExp(
  '\\b(sub[\\s-]?total|total\\s+a\\s+pagar|valor\\s+total|monto\\s+total|total\\s+due|amount\\s+due|grand\\s+total|total' +
  `|iva|impuestos?|igv|sales\\s+tax|tax(?:es)?|vat)\\b${S}(?:\\(?${S}\\d+(?:[.,]\\d+)?${S}%${S}\\)?${S})?[:=]?${S}(\\()?${S}` +
  `([-−])?${S}(?:${CUR}${S})?([-−])?${S}(\\d(?:[\\d.,]*\\d)?)(?![\\d%]|${S}%)(?:${S}${CUR})?${S}(\\))?(?:${S}(cr)\\b)?`, 'g');

const near = (a: number, b: number) => round2(Math.abs(a - b)) <= 0.01;

export function amountGuard(printed: string, amountRead: number | null): Guarded | null {
  const text = printed.normalize('NFC');
  const folded = fold(text);
  const subtotals: number[] = [], taxes: number[] = [], totals: number[] = [];
  const signals: Array<{ at: number; end: number }> = [...folded.matchAll(WORDS)].map((m) => ({ at: m.index, end: m.index + m[0].length }));
  for (const m of folded.matchAll(LABELLED)) {
    const [all, label = '', open, sign1, sign2, digits = '', close, cr] = m;
    const n = parseAmount(digits);
    if (n === null) continue; // R-44: unparseable = ignored
    if (label.includes('sub')) subtotals.push(n);
    else if (!label.includes('total') && !label.endsWith('due')) taxes.push(n);
    else if (sign1 || sign2 || (open && close) || cr) signals.push({ at: m.index, end: m.index + all.length });
    else totals.push(n);
  }
  const first = signals.sort((a, b) => a.at - b.at)[0];
  if (first) return { read_error: 'nota_credito', read_detail: { signal: text.slice(first.at, Math.min(first.end, first.at + 60)) } };
  const s = subtotals.at(-1), tax = round2(taxes.reduce((a, b) => a + b, 0)), sum = s === undefined ? null : round2(s + tax);
  const listed = totals.join('; ');
  if (s !== undefined && sum !== null && totals.length && !totals.some((t) => near(t, sum))) {
    return { read_error: 'total_no_cuadra', read_detail: { subtotal: s, tax, sum, totals: listed, amount_read: amountRead } };
  }
  if (amountRead !== null && totals.length && !totals.some((t) => near(t, amountRead))) {
    return { read_error: 'total_no_cuadra', read_detail: { subtotal: null, tax: null, sum: null, totals: listed, amount_read: amountRead } };
  }
  return null;
}
