/// <reference types="vite/client" />
// R-80 (AC-14 Clarified): the amount guard over the document text. Fakes only, no model (R-76).
import { describe, expect, it } from 'vitest';
import sql from '../../supabase/migrations/20261017000300_seed_andina.sql?raw';
import type { Env } from '../env';
import { amountGuard } from './amount-guard';
import { documentToText } from './llm';

type SeedInvoice = { nn: string; source: string; raw_text: string | null; fields: { amount: number | null; currency: string | null; concept: string | null } };
const SEED: { invoices: SeedInvoice[] } = JSON.parse(sql.match(/\$seed\$([\s\S]*?)\$seed\$/)?.[1] ?? 'null');

describe('amountGuard: the six QA texts and the R-80 examples are flagged, whatever the model read', () => {
  it.each([
    ['Subtotal: USD 100.00 / IVA: USD 19.00 / Total: USD 150.00', { subtotal: 100, tax: 19, sum: 119, totals: '150' }],
    ['Subtotal 200 + impuesto 20 = Total 100', { subtotal: 200, tax: 20, sum: 220, totals: '100' }],
    ['Subtotal 1000 / Impuestos 190 / Total 1400', { subtotal: 1000, tax: 190, sum: 1190, totals: '1400' }],
    ['Subtotal 100 / VAT 19 / Total 300', { subtotal: 100, tax: 19, sum: 119, totals: '300' }],
  ])('total_no_cuadra (3a): %s', (text, values) => {
    for (const read of [null, 150, 300, 119, 1400]) {
      expect(amountGuard(text, read)).toEqual({ read_error: 'total_no_cuadra', read_detail: { ...values, amount_read: read } });
    }
  });
  it.each([
    ['Total: (USD 500,00) nota credito', 'Total: (USD 500,00)'],
    ['Total: USD 200.00 CR (saldo a favor del cliente, no cobrar)', 'Total: USD 200.00 CR'],
    ['Total: -500 USD', 'Total: -500 USD'],
    ['Nota de crédito NC-12 Total USD 80', 'Nota de crédito'],
    ['Total − USD 75', 'Total − USD 75'],
    ['TOTAL: −USD 75.00', 'TOTAL: −USD 75.00'],
    ['Factura 9 · CREDIT MEMO · Total due 40', 'CREDIT MEMO'],
    ['Por favor no pagar: es un ajuste. Total 10', 'no pagar'],
    ['Do not pay, this is a credit balance', 'Do not pay'],
    ['Saldo a favor: USD 12', 'Saldo a favor'],
    ['Credit note CN-3', 'Credit note'],
    ['Nota crédito 44', 'Nota crédito'],
  ])('nota_credito: %s', (text, signal) => {
    for (const read of [null, 500, 200, 80, 1]) {
      expect(amountGuard(text, read)).toEqual(signal === null ? null : { read_error: 'nota_credito', read_detail: { signal } });
    }
  });
  it('the signal is at most 60 characters, as printed', () => {
    const text = `Total: (USD ${'1'.repeat(3)}.000.000.000.000.000.000.000.000.000.000.000.000,00)`;
    const g = amountGuard(text, null);
    expect(g?.read_error).toBe('nota_credito');
    expect(String(g?.read_detail.signal)).toBe(text.slice(0, 60));
  });
  it('a credit-note signal beats a total that does not add up (2 beats 3)', () => {
    expect(amountGuard('Subtotal 100 / IVA 19 / Total 300 / nota de credito', 300)?.read_error).toBe('nota_credito');
  });
  it('3b: a model amount that is none of the printed totals; 3a beats 3b', () => {
    expect(amountGuard('Total: USD 2,500.00', 250)).toEqual({ read_error: 'total_no_cuadra',
      read_detail: { subtotal: null, tax: null, sum: null, totals: '2500', amount_read: 250 } });
    expect(amountGuard('Total 100 / Gran total: 200 / Total a pagar 300', 250)?.read_detail.totals).toBe('100; 200; 300');
    expect(amountGuard('Subtotal 100 / IVA 19 / Total 300', 300)?.read_detail).toMatchObject({ subtotal: 100, sum: 119 });
  });
});

describe('amountGuard: legitimate invoices are not flagged', () => {
  it.each([
    ['Subtotal 100 / IVA 19 / Total 119', 119],
    ['Subtotal 1.000.000,00 COP / IVA 19 %: 190.000,00 / Total a pagar 1.190.000,00', 1190000],
    ['Subtotal 100 / VAT 19 / Total due 119', 119],
    ['Total horas: 40 / Total: USD 2,500.00', 2500],
    ['Subtotal 100 / IVA (19%): 19 / Total 119', 119],
    ['Subtotal 100.000 / Total IVA 19.000 / Total 119.000', 119000],
    ['Subtotal 100 / Total 100', null],
    ['Total 119 / IVA incluido', 119],
    ['Sub-total: 50 / Sub total 100 / Tax 19 / Grand total 119', 119],
    ['Factura 12. Valor: USD 300. Nada más.', 7],
    ['', null],
  ])('%s', (text, read) => expect(amountGuard(text, read)).toBeNull());
  it('a model that read nothing never trips 3b', () => expect(amountGuard('Total: USD 2,500.00', null)).toBeNull());
});

describe('amountGuard: every seed document and every /demo/invoices file reads clean with its seeded amount', () => {
  const emails = SEED.invoices.filter((i) => i.raw_text !== null);
  it.each(emails.map((i) => [i.nn, i.raw_text!, i.fields.amount] as const))('seed #%s (pasted text)', (_nn, text, amount) =>
    expect(amountGuard(text, amount)).toBeNull());
  it('has the pasted seed texts', () => expect(emails.length).toBeGreaterThan(10));

  // the repo has no @types/node, so the fs module is typed by hand
  const fs = async () => (await import('node:fs/promises' as string)) as { readdir(u: URL): Promise<string[]>; readFile(u: URL): Promise<Uint8Array> };
  const DIR = new URL('../../web/public/demo/invoices/', import.meta.url);
  const NO_MODEL = { AI: { run: () => { throw new Error('no model in tests'); } } } as unknown as Env;
  it('every /demo/invoices PDF, through documentToText (its text layer, no model)', async () => {
    const files = (await (await fs()).readdir(DIR)).filter((f) => f.endsWith('.pdf'));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const b = await (await fs()).readFile(new URL(f, DIR));
      const text = await documentToText(NO_MODEL, { kind: 'pdf', bytes: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer });
      expect(text, f).toMatch(/Total a pagar/);
      expect(amountGuard(text!, SEED.invoices.find((i) => `${i.nn}.pdf` === f)!.fields.amount), f).toBeNull();
    }
  });
  // The PNGs (03, 18, 21) have no text layer: their text is whatever the vision model transcribes (README). Here, the
  // lines scripts/gen-invoices.mjs prints on them, as a faithful transcription would read them.
  it.each(SEED.invoices.filter((i) => i.source === 'image' && i.fields.amount !== null).map((i) => [i.nn, i] as const))('image #%s, transcribed', (_nn, i) => {
    const { amount, currency, concept } = i.fields;
    const m = new Intl.NumberFormat('es-CO', { minimumFractionDigits: currency === 'COP' ? 0 : 2, maximumFractionDigits: currency === 'COP' ? 0 : 2 }).format(amount!);
    expect(amountGuard(`CONCEPTO VALOR (${currency})\n${concept} ${m}\nTotal a pagar ${currency} ${m}`, amount)).toBeNull();
  });
});

// R-81 (AC-14 Amended): every input verbatim, `\n` a real line break.
describe('amountGuard R-81: flagged nota_credito', () => {
  it.each([
    ['Total:\n-150', 'Total: -150'],
    ['Total:\n(150.00)', 'Total: (150.00)'],
    ['Total: –500', 'Total: –500'],
    ['Total: —500', 'Total: —500'],
    ['Total: －500', 'Total: －500'],
    ['Total: ﹣500', 'Total: ﹣500'],
    ['Total: 500-', 'Total: 500-'],
    ['Total: USD 500.00-', 'Total: USD 500.00-'],
    ['NOTAS CRÉDITO aplicadas\nTotal USD 80', 'NOTAS CRÉDITO'],
    ['Credit notes issued\nTotal USD 80', 'Credit notes'],
    ['notacredito 45\nTotal USD 80', 'notacredito'],
    ['Nota-Crédito No. 45\nTotal USD 80', 'Nota-Crédito'],
    ['nota_de_credito 45\nTotal USD 80', 'nota_de_credito'],
    ['CREDIT-MEMO 7\nTotal USD 80', 'CREDIT-MEMO'],
    ['No-cobrar\nTotal USD 80', 'No-cobrar'],
    ['Documento NC-0045\nTotal USD 80', 'NC-0045'],
  ])('%j', (text, signal) => {
    for (const read of [null, 80, 150, 500]) expect(amountGuard(text, read)).toEqual({ read_error: 'nota_credito', read_detail: { signal } });
  });
});

describe('amountGuard R-81: flagged total_no_cuadra', () => {
  const n = null;
  it.each([
    ['Subtotal: USD 100.00\nIVA: USD 19.00\nTotal:\nUSD 150.00', n, [100, 19, 119, '150']],
    ['Total a pagar\n\nUSD 2,500.00', 1500, [n, n, n, '2500']],
    ['Subtotal 200.00\nIVA: 19% 38.00\nTotal 219.00', n, [200, 38, 238, '219']],
    ['Subtotal 200\nIVA 38\nTotal IVA 38\nTotal 300', n, [200, 38, 238, '300']],
    ['Subtotal 1.000.000\nIVA 190.000\nReteFuente 25.000\nTotal a pagar 1.165.000', n, [1000000, 190000, 1190000, '1165000']],
    ['Subtotal 100.00\nDescuento 10.00\nIVA 17.10\nTotal 107.10', n, [100, 17.1, 117.1, '107.1']],
  ] as const)('%j (model %s)', (text, read, [subtotal, tax, sum, totals]) => {
    expect(amountGuard(text, read)).toEqual({ read_error: 'total_no_cuadra', read_detail: { subtotal, tax, sum, totals, amount_read: read } });
  });
});

describe('amountGuard R-81: not flagged', () => {
  it.each([
    ['Subtotal\n100.00\nIVA\n19.00\nTotal\n119.00', 119],
    ['Descripción Cantidad Total\n1 Consultoría 2,500.00\nTotal: USD 2,500.00', 2500],
    ['Total\n40 horas\nTotal a pagar: USD 2,500.00', 2500],
    ['Total: 500 USD - pago a 30 días', 500],
    ['Periodo 2026-10\nTotal: USD 500', 500],
    ['Abono a la cuenta de ahorros Bancolombia 123\nTotal USD 80', 80],
    ['Política de devoluciones: 30 días\nTotal USD 80', 80],
    ['Reembolso de gastos de viaje\nTotal USD 80', 80],
    ['Refund policy: no refunds after 30 days\nTotal USD 80', 80],
    ['Raleigh, NC 27601\nTotal USD 80', 80],
    ['Factura FE-0045\nTotal USD 80', 80],
    ['Subtotal 200.00\nIVA: 19% 38.00\nTotal 238.00', 238],
    ['Subtotal 200.000\nIVA (19%): 38.000\nTotal 238.000', 238000],
    ['Subtotal 200,00\nIVA: 19 % $ 38,00\nTotal 238,00', 238],
    ['Subtotal 200.00\nIVA 19% 38.00\nTotal IVA 38.00\nTotal a pagar 238.00', 238],
    ['Subtotal 200.000\nIVA 38.000\nImpoconsumo 16.000\nTotal impuestos 54.000\nTotal 254.000', 254000],
    ['Subtotal 100.00\nImpoconsumo 8% 8.00\nTotal 108.00', 108],
    ['Subtotal 1.000.000\nIVA 190.000\nReteIVA 28.500\nTotal 1.190.000', 1190000],
    ['Total: 1 500,00 EUR', 1500],
    ['Total: 1 500,00 EUR', 900], // F2: the space-grouped token is ignored, so there is no printed total
    ['Total: 1 500,00', 1500],
    ['Total: 1 500,00 EUR', 900],
  ])('%j (model %s)', (text, read) => expect(amountGuard(text, read)).toBeNull());
});

// F1: the guard runs on every read and every cron tick inside a 10 ms CPU budget; no input may backtrack (the regression takes seconds, so the ceiling is 1 s).
describe('amountGuard: linear time on hostile and large text', () => {
  const ms = (text: string) => { const t = performance.now(); amountGuard(text, 1); return performance.now() - t; };
  const ordinary = SEED.invoices.map((i) => i.raw_text ?? '').join('\n');
  it.each([
    ['Total + 120 spaces + x', `Total${' '.repeat(120)}x`],
    ['Total + 5000 spaces + x', `Total${' '.repeat(5000)}x`],
    ['IVA + 5000 spaces + x', `IVA${' '.repeat(5000)}x`],
    ['Subtotal + 5000 spaces + x', `Subtotal${' '.repeat(5000)}x`],
    ['Total + 5000 NBSP/tabs + x', `Total${' \t'.repeat(2500)}x`],
    ['Total + 5000 spaces + newline', `Total${' '.repeat(5000)}\n`],
    ['Total: + 20000 newlines + x', `Total:${'\n'.repeat(20000)}x`],
    ['"Total " x 20000', 'Total '.repeat(20000)],
    ['"IVA 19 % " x 20000', 'IVA 19 % '.repeat(20000)],
    ['"(" x 20000', `Total: ${'('.repeat(20000)}`],
    ['"-" x 20000', `Total: ${'-'.repeat(20000)}1`],
    ['digits x 20000 then %', `Total ${'1'.repeat(20000)}%`],
    ['"1." x 20000', `Total ${'1.'.repeat(20000)}`],
    ['nota + 20000 separators + x', `nota${'-_. \n'.repeat(5000)}x`],
    ['saldo a + 20000 spaces', `saldo a${' '.repeat(20000)}x`],
    ['"Total:\\n" x 20000', 'Total:\n'.repeat(20000)],
    ['200 KB ordinary text', ordinary.repeat(Math.ceil(200_000 / ordinary.length))],
  ])('%s', (_name, text) => expect(ms(text)).toBeLessThan(1000));
});

// R-82 (AC-14 Amended): every evidence input verbatim, `\n` a real line break, `\uXXXX` that character. Each one is
// also timed: no new shape may cost more than 1 s (a backtracking regression takes seconds; a wall-clock ceiling under 1 s flakes on a loaded CI box).
const timed = (text: string, read: number | null) => {
  const t = performance.now(), g = amountGuard(text, read);
  expect(performance.now() - t).toBeLessThan(1000);
  return g;
};
describe('amountGuard R-82: flagged nota_credito', () => {
  it.each([
    ['Total: USD (500.00)', 'Total: USD (500.00)'],
    ['Total: $ (500.00)', 'Total: $ (500.00)'],
    ['Total: $(500.00)', 'Total: $(500.00)'],
    ['Total USD (500.00)', 'Total USD (500.00)'],
    ['Total:\nUSD (500.00)', 'Total: USD (500.00)'],
    ['Total: USD (-500.00)', 'Total: USD (-500.00)'],
    ['Total: USD (500.00) CR', 'Total: USD (500.00) CR'],
    ['TOTAL DUE: USD (500.00)', 'TOTAL DUE: USD (500.00)'],
    ['Total: US$ -500', 'Total: US$ -500'],
    ['Total: - US$ 500', 'Total: - US$ 500'],
    ['Total: US$ (500.00)', 'Total: US$ (500.00)'],
    ['Total: S/ -500', 'Total: S/ -500'],
    ['Total: S/. (500.00)', 'Total: S/. (500.00)'],
    ['Total: R$ -500', 'Total: R$ -500'],
    ['Total: COP$ -500.000', 'Total: COP$ -500.000'],
    ['Nota­crédito 45\nTotal USD 80', 'Notacrédito'],
    ['nota​crédito 45\nTotal USD 80', 'notacrédito'],
    ['Total: USD (5​00.00)', 'Total: USD (500.00)'],
    ['Nota‐crédito 45\nTotal USD 80', 'Nota‐crédito'],
    ['credit‑memo 7\nTotal USD 80', 'credit‑memo'],
    ['nota–de–credito 45\nTotal USD 80', 'nota–de–credito'],
  ])('%j', (text, signal) => {
    for (const read of [null, 80, 500, 119]) expect(timed(text, read)).toEqual({ read_error: 'nota_credito', read_detail: { signal } });
  });
  it('a parenthesised total beats a line-item sum that adds up (rule 2 beats rule 3)', () =>
    expect(timed('Subtotal 100\nIVA 19\nTotal: USD (119.00)', 119)).toEqual({ read_error: 'nota_credito', read_detail: { signal: 'Total: USD (119.00)' } }));
});

describe('amountGuard R-82: flagged total_no_cuadra', () => {
  const n = null;
  it.each([
    ['Subtotal US$ 100.00\nIVA US$ 19.00\nTotal US$ 150.00', n, [100, 19, 119, '150']],
    ['Total a pagar: S/. 2,500.00', 1500, [n, n, n, '2500']],
    ['Total: US$ 2,500.00', 1500, [n, n, n, '2500']],
  ] as const)('%j (model %s)', (text, read, [subtotal, tax, sum, totals]) => {
    expect(timed(text, read)).toEqual({ read_error: 'total_no_cuadra', read_detail: { subtotal, tax, sum, totals, amount_read: read } });
  });
});

describe('amountGuard R-82: not flagged', () => {
  it.each([
    ['Total: USD 500.00', 500],
    ['Total: US$ 2,500.00', 2500],
    ['Total: S/ 500.00', 500],
    ['Total a pagar: R$ 1.500,00', 1500],
    ['Subtotal 100\nIVA 19\nTotal: USD 119.00', 119],
    ['Total: USD 500.00 (incluye IVA)', 500],
    ['Total (USD): 500.00', 500],
    ['Notas: crédito a 30 días\nTotal USD 80', 80],
  ])('%j (model %s)', (text, read) => expect(timed(text, read)).toBeNull());
});

// R-82 fuzz: runs of the new currency, parenthesis, invisible-character and hyphen shapes, 20000 each.
describe('amountGuard R-82: linear time on runs of the new shapes', () => {
  const ms = (text: string) => { const t = performance.now(); amountGuard(text, 1); return performance.now() - t; };
  it.each([
    ['"USD (" x 20000', `Total: ${'USD ('.repeat(20000)}`],
    ['"US$ " x 20000', `Total: ${'US$ '.repeat(20000)}`],
    ['"COP$" x 20000', `Total: ${'COP$'.repeat(20000)}1`],
    ['"S/. (" x 20000', `Total: ${'S/. ('.repeat(20000)}`],
    ['"$(" x 20000', `Total: ${'$('.repeat(20000)}`],
    ['"- US$ (" x 20000', `Total: ${'- US$ ('.repeat(20000)}1`],
    ['"Total: USD (" x 20000', 'Total: USD ('.repeat(20000)],
    ['invisible chars x 20000', `nota${'​‌‍⁠﻿­'.repeat(20000)}x`],
    ['"\\u00ad(" x 20000', `Total: ${'­('.repeat(20000)}`],
    ['hyphens x 20000', `nota${'‐‑‒–−'.repeat(4000)}x`],
  ])('%s', (_name, text) => expect(ms(text)).toBeLessThan(1000));
});
