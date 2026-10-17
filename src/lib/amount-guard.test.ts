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
