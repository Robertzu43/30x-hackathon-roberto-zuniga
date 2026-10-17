// AC-77, R-88: where code found each read value in the stored document text. Never the model.
import { describe, expect, it } from 'vitest';
import { locate } from './snippet';

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
    expect(line).toContain(r.snippet);
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
