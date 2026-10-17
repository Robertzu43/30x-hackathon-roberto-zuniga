// AC-77, R-88: where code found each read value in the stored document text. Never the model.
import { describe, expect, it } from 'vitest';
import { cut, locate } from './snippet';

// The text layer of web/public/demo/invoices/01.pdf (as in llm.test.ts).
const TEXT_01 = 'Laura Méndez\nFactura N.º 1042\nFacturar a\nAndina Labs Inc.\n1209 Orange St, Wilmington, DE 19801\nFecha de emisión\n16 de octubre de 2026\nVence\n30 de noviembre de 2026\nCONCEPTO VALOR (USD)\nRetainer mensual de desarrollo 2.500,00\nTotal a pagar USD 2.500,00\nDatos de pago\nBancolombia ahorros 0012-3456-4821';
const printed = (r: ReturnType<typeof locate>) => (r.snippet && r.match ? r.snippet.slice(...r.match) : null);

describe('locate (AC-77)', () => {
  it.each([
    ['payee_name', 'Laura Méndez', TEXT_01, 'Laura Méndez', 'Laura Méndez'],
    ['amount printed 1.000,00', 1000, 'Hola\nTotal a pagar USD 1.000,00\nGracias', 'Total a pagar USD 1.000,00', '1.000,00'],
    ['amount printed 1,000.00', 1000, 'Total: USD 1,000.00.', 'Total: USD 1,000.00.', '1,000.00'],
    ['amount printed without decimals', 2400, 'Pixel Lab: Total USD 2.400', 'Pixel Lab: Total USD 2.400', '2.400'],
    ['invoice_number', '1042', TEXT_01, 'Factura N.º 1042', '1042'],
    ['due_date printed 31/10/2026', '2026-10-31', 'Fecha: 31/10/2026', 'Fecha: 31/10/2026', '31/10/2026'],
    ['issue_date printed in Spanish words', '2026-10-16', TEXT_01, '16 de octubre de 2026', '16 de octubre de 2026'],
    ['due_date printed ISO', '2026-11-30', 'Due 2026-11-30', 'Due 2026-11-30', '2026-11-30'],
    ['due_date printed in English words', '2026-11-30', 'Due: November 30, 2026', 'Due: November 30, 2026', 'November 30, 2026'],
    ['bank_account, other spacing', 'Bancolombia ahorros 0012-3456-4821', '  Bancolombia  ahorros 0012-3456-4821\r\n', 'Bancolombia  ahorros 0012-3456-4821', 'Bancolombia  ahorros 0012-3456-4821'],
    ['payee_name in other case, printed form kept', 'Laura Méndez', 'De: LAURA MÉNDEZ <l@x.co>', 'De: LAURA MÉNDEZ <l@x.co>', 'LAURA MÉNDEZ'],
  ])('%s: the line holding it, and match spans the printed form', (name, value, text, snippet, form) => {
    const field = name.split(' ')[0]!;
    const r = locate(text, field, value);
    expect(r.snippet).toBe(snippet);
    expect(printed(r)).toBe(form);
  });

  it('a value past character 120 of its line keeps its whole span inside a 120-character snippet', () => {
    const line = `${'relleno '.repeat(20)}Total USD 1.000,00${' y'.repeat(40)}`;
    const r = locate(`Factura\n${line}`, 'amount', 1000);
    expect(r.snippet!.length).toBeLessThanOrEqual(120);
    expect(line).toContain(r.snippet!.replace(/^\u2026|\u2026$/g, '')); // R-130: «…» marks the cut
    expect(r.match![0]).toBeGreaterThanOrEqual(0);
    expect(r.match![1]).toBeLessThanOrEqual(r.snippet!.length);
    expect(printed(r)).toBe('1.000,00');
  });

  it.each([
    ['a value not in the text', 'payee_name', 'Nube Sur LLC', TEXT_01],
    ['an amount only inside a larger number', 'amount', 1000, 'Total USD 21.000,00 y 1.000,005'],
    ['a currency only inside a longer word', 'currency', 'USD', 'Pago en USDT'],
    ['an unknown value', 'payee_name', null, TEXT_01],
    ['no stored text', 'payee_name', 'Laura Méndez', null],
  ])('%s: snippet and match null', (_, field, value, text) => {
    expect(locate(text, field, value)).toEqual({ snippet: null, match: null });
  });
});

// R-130 (AC-77 Clarified): a line over 120 characters is cut on whole words, with «…» (U+2026) exactly where text was cut.
const EL = '…';
const fill = (n: number, words = ['servicios', 'de', 'desarrollo', 'mensual', 'según', 'el', 'acuerdo', 'vigente', 'con', 'Andina']) => {
  const out: string[] = [];
  for (let i = 0; out.join(' ').length < n; i++) out.push(words[i % words.length]!);
  return out.join(' ');
};
// Every property of the rule, checked on one result: L is the trimmed line, form the value as printed in it.
function window(L: string, r: ReturnType<typeof locate>, form: string) {
  const s = r.snippet!;
  expect(s.length).toBeLessThanOrEqual(120);
  expect(s.slice(...r.match!)).toBe(form);
  const lead = s.startsWith(EL), trail = s.endsWith(EL);
  const core = s.slice(lead ? 1 : 0, trail ? -1 : undefined);
  const at = L.indexOf(core);
  expect(at).toBeGreaterThanOrEqual(0);
  expect(lead).toBe(at > 0);
  expect(trail).toBe(at + core.length < L.length);
  if (lead) expect([/\s/.test(L[at - 1]!), /\S/.test(core[0]!)]).toEqual([true, true]); // starts a word of L
  if (trail) expect([/\s/.test(L[at + core.length]!), /\S/.test(core.at(-1)!)]).toEqual([true, true]); // ends a word of L
  return { lead, trail };
}

describe('locate: cutting a long line on whole words (AC-77, R-130)', () => {
  // QA case 1 (snippet started «NCEPTO»): the PDF text on one line, the amount at the end.
  it.each([122, 150, 233, 400])('«CONCEPTO VALOR (USD) …» with the amount at the end, %i characters', (n) => {
    const L = `CONCEPTO VALOR (USD) ${fill(n - 47)} Total a pagar USD 2.500,00`;
    expect(L.length).toBeGreaterThanOrEqual(n);
    const r = locate(`Factura 1042\n  ${L}  \nGracias`, 'amount', 2500);
    expect(window(L, r, '2.500,00')).toEqual({ lead: true, trail: false });
    expect(r.snippet).not.toMatch(/^…NCEPTO|^…ONCEPTO/);
    expect(r.snippet).toMatch(/Total a pagar USD 2\.500,00$/);
  });

  // QA case 2 (snippet started «ola,»): a vendor message on one line, the account in the middle.
  it.each([121, 150, 260, 400])('«Hola, soy Martín López …» with the account in the middle, %i characters', (n) => {
    const half = Math.ceil((n - 70) / 2);
    const L = `Hola, soy Martín López, ${fill(half)} mi cuenta es Pix chave 11 98765-4302 ${fill(half)} gracias`;
    expect(L.length).toBeGreaterThanOrEqual(n);
    const r = locate(L, 'bank_account', 'Pix chave 11 98765-4302');
    const w = window(L, r, 'Pix chave 11 98765-4302');
    expect(r.snippet).not.toMatch(/^…ola,/);
    expect(w.lead || w.trail).toBe(true);
  });

  it('a line of exactly 120 characters comes back unchanged, with no marks', () => {
    const L = `Total a pagar USD 1.000,00 ${fill(200)}`.slice(0, 120);
    const r = locate(L, 'amount', 1000);
    expect(r).toEqual({ snippet: L, match: [18, 26] });
  });

  it('a 130-character concept comes back whole, with no marks', () => {
    const value = fill(130).slice(0, 130).trimEnd();
    const L = `${fill(90)} Concepto: ${value} ${fill(90)}`;
    const r = locate(L, 'concept', value);
    expect(r).toEqual({ snippet: value, match: [0, value.length] });
  });
});

describe('cut: the glued case (AC-77, R-130)', () => {
  // «USD1.000,00»: the window edge falls inside the word that holds the span, so it moves outward to the word's start.
  const V = `1.000,00 ${fill(120)}`.slice(0, 113);
  it('«USD1.000,00» glued to text keeps the whole word when it fits', () => {
    const L = `${fill(100)} USD${V} ${'z'.repeat(30)} ${fill(100)}`;
    const s = L.indexOf(V);
    const r = cut(L, s, s + V.length);
    expect(r.snippet).toBe(`${EL}USD${V}${EL}`);
    expect(r.snippet.slice(...r.match)).toBe(V);
  });
  it('a glued word that does not fit: the edge stays at the span', () => {
    const L = `${fill(100)} REF-0042-USD${V} ${'z'.repeat(30)} ${fill(100)}`;
    const s = L.indexOf(V);
    const r = cut(L, s, s + V.length);
    expect(r.snippet).toBe(`${EL}${V}${EL}`);
    expect(r.match).toEqual([1, 1 + V.length]);
  });
});
