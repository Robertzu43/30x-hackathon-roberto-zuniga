/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import { documentToText, extractFields } from './llm';

const conf = { payee_name: 0.99, amount: 0.97, currency: 0.99, invoice_number: 0.95, issue_date: 0.9, due_date: 0.9, concept: 0.9, bank_account: 0.9 };
const good = {
  payee_name: 'Laura Méndez', amount: 2500, currency: 'USD', invoice_number: '1042', issue_date: '2026-10-16',
  due_date: '2026-11-30', concept: 'Retainer mensual', bank_account: 'Bancolombia ahorros 123', confidence: conf,
};
const envWith = (run: (model: string, input: unknown) => Promise<unknown>) =>
  ({ AI: { run }, WORKERS_AI_MODEL: 'text-model', WORKERS_AI_VISION_MODEL: 'vision-model' }) as unknown as Env;
const model = (out: unknown) => envWith(async () => ({ response: out }));
const ALL_NULL = { payee_name: null, amount: null, currency: null, invoice_number: null, issue_date: null, due_date: null, concept: 'ilegible', bank_account: null, confidence: {} };
// R-75: no answer came from the model for this invoice. No concept 'ilegible': the document was never judged.
const UNAVAILABLE = { ...ALL_NULL, concept: null, read_error: 'lector_no_disponible' };
const QUOTA = '4006: you have used up your daily free allocation of 10,000 neurons';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

// the repo has no @types/node, so the fs module is typed by hand
const readFixture = async (path: string): Promise<ArrayBuffer> => {
  const { readFile } = (await import('node:fs/promises' as string)) as { readFile(u: URL): Promise<Uint8Array> };
  const b = await readFile(new URL(path, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
// The text layer of web/public/demo/invoices/01.pdf as documentToText returns it: issuer on top, the company billed below.
const TEXT_01 = 'Laura Méndez\nFactura N.º 1042\nFacturar a\nAndina Labs Inc.\n1209 Orange St, Wilmington, DE 19801\nFecha de emisión\n16 de octubre de 2026\nVence\n30 de noviembre de 2026\nCONCEPTO VALOR (USD)\nRetainer mensual de desarrollo 2.500,00\nTotal a pagar USD 2.500,00\nDatos de pago\nBancolombia ahorros 0012-3456-4821';

describe('extractFields (AC-12, AC-13, AC-14)', () => {
  it('returns the validated fields and calls the text model with a JSON schema', async () => {
    const run = vi.fn(async () => ({ response: good }));
    expect(await extractFields(envWith(run), 'Factura 1042')).toEqual(good);
    const [name, input] = run.mock.calls[0] as unknown as [string, { response_format: { type: string }; max_tokens: number }];
    expect(name).toBe('text-model');
    expect(input.response_format.type).toBe('json_schema');
    expect(input.max_tokens).toBeGreaterThan(0);
  });

  it('accepts the model answer as a JSON string', async () => {
    expect(await extractFields(model(JSON.stringify(good)), 'x')).toEqual(good);
  });

  it('re-parses a string amount "1.000,00" as 1000', async () => {
    expect((await extractFields(model({ ...good, amount: '1.000,00' }), 'x')).amount).toBe(1000);
  });

  it('turns an ambiguous string amount into null', async () => {
    expect((await extractFields(model({ ...good, amount: '2.500,5' }), 'x')).amount).toBeNull();
  });

  it('stores a field with confidence below 0.8 as null, keeps the others (R-10)', async () => {
    const out = await extractFields(model({ ...good, concept: 'dudoso', confidence: { ...conf, concept: 0.79, due_date: 0.8 } }), 'x');
    expect(out.concept).toBeNull();
    expect(out.due_date).toBe('2026-11-30');
  });

  it('stores a field with no confidence as null', async () => {
    expect((await extractFields(model({ ...good, confidence: { ...conf, amount: undefined } }), 'x')).amount).toBeNull();
  });

  it('makes the amount null when subtotal + tax differs from the total by more than 0.01 (AC-14, R-37)', async () => {
    expect((await extractFields(model({ ...good, amount: 1000, subtotal: 800, tax: 190 }), 'x')).amount).toBeNull();
  });

  it('keeps the amount when subtotal + tax matches the total within 0.01', async () => {
    expect((await extractFields(model({ ...good, amount: 1000, subtotal: 840.005, tax: 159.99 }), 'x')).amount).toBe(1000);
  });

  it('keeps the amount when the difference is exactly one cent (AC-14)', async () => {
    expect((await extractFields(model({ ...good, amount: 2500.01, subtotal: 2000, tax: 500 }), 'x')).amount).toBe(2500.01);
  });

  it('makes the amount null when the difference is two cents (AC-14)', async () => {
    expect((await extractFields(model({ ...good, amount: 2500.02, subtotal: 2000, tax: 500 }), 'x')).amount).toBeNull();
  });

  it('drops a malformed date or currency instead of guessing', async () => {
    const out = await extractFields(model({ ...good, due_date: '30/11/2026', currency: 'dollars' }), 'x');
    expect([out.due_date, out.currency]).toEqual([null, null]);
  });

  it.each([
    ['the answer is not JSON', model('lo siento')],
    ['the answer breaks the schema', model({ ...good, confidence: { amount: 7 } })],
    ['the answer is not an object', model(42)],
  ])('returns all-null fields with concept ilegible when %s: the model answered (AC-13, R-75)', async (_n, env) => {
    expect(await extractFields(env, 'x')).toEqual(ALL_NULL);
  });

  it.each([
    ['the daily allocation is used up (429, 4006)', envWith(async () => { throw new Error(QUOTA); })],
    ['any other model error', envWith(async () => { throw new Error('boom'); })],
    ['an unknown model', envWith(async () => { throw new Error('5007: No such model @cf/thesaurus/no-existe or task'); })],
    ['a non-Error rejection', envWith(() => Promise.reject('down'))],
  ])('returns lector_no_disponible, not ilegible, when %s (AC-13 Clarified, R-75)', async (_n, env) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await extractFields(env, 'x')).toEqual(UNAVAILABLE);
  });

  it('null text (the vision step got no answer) is lector_no_disponible without a second model call (R-75)', async () => {
    const run = vi.fn();
    expect(await extractFields(envWith(run), null)).toEqual(UNAVAILABLE);
    expect(run).not.toHaveBeenCalled();
  });

  // 7c live regression: the account's daily Workers AI allocation ran out (error 4006) and every read became a silent
  // "ilegible". Each failure now logs one reason code, never the document text; no answer is logged as unavailable (R-75).
  it.each([
    ['quota', 'reader: lector_no_disponible', UNAVAILABLE, envWith(async () => { throw new Error(QUOTA); })],
    ['model_error', 'reader: lector_no_disponible', UNAVAILABLE, envWith(async () => { throw new Error('boom'); })],
    ['invalid_json', 'reader: ilegible', ALL_NULL, model('lo siento')],
    ['schema', 'reader: ilegible', ALL_NULL, model({ ...good, confidence: { amount: 7 } })],
  ])('logs the reason code %s without the document text (AC-13)', async (code, line, result, env) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await extractFields(env, 'SECRETO factura 1042')).toEqual(result);
    expect(log).toHaveBeenCalledWith(line, code);
    expect(JSON.stringify(log.mock.calls)).not.toContain('SECRETO');
  });

  it('returns lector_no_disponible after 20 s without an answer (AC-13, R-75)', async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const p = extractFields(envWith(() => new Promise(() => {})), 'x');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await p).toEqual(UNAVAILABLE);
    expect(log).toHaveBeenCalledWith('reader: lector_no_disponible', 'timeout');
  });

  it('reads the issuer, not the company billed, from the real 01.pdf text (live QA regression)', async () => {
    // Like the live model: without an explicit bill-to rule it answers the "Facturar a" company.
    const run = vi.fn(async (_m: string, input: unknown) => {
      const { messages } = input as { messages: { role: string; content: string }[] };
      const told = /Facturar a/.test(messages[0]!.content) && /issue/i.test(messages[0]!.content);
      return { response: { ...good, payee_name: told ? 'Laura Méndez' : 'Andina Labs Inc.', bank_account: 'Bancolombia ahorros 0012-3456-4821' } };
    });
    const out = await extractFields(envWith(run), TEXT_01);
    expect(out.payee_name).toBe('Laura Méndez');
    const { messages } = (run.mock.calls[0] as unknown as [string, { messages: { role: string; content: string }[] }])[1];
    expect(messages[1]).toEqual({ role: 'user', content: TEXT_01 }); // the document goes as data, never into the system prompt
  });

  it('tells the model a blurry or non-invoice transcription is all null', async () => {
    const run = vi.fn(async () => ({ response: good }));
    await extractFields(envWith(run), 'x');
    const { messages } = (run.mock.calls[0] as unknown as [string, { messages: { content: string }[] }])[1];
    expect(messages[0]!.content).toMatch(/blurry/i);
  });

  it('does not call the model for blank text', async () => {
    const run = vi.fn();
    expect(await extractFields(envWith(run), '  \n')).toEqual(ALL_NULL);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('documentToText (AC-11, AC-12)', () => {
  it('returns text as is', async () => {
    expect(await documentToText(model(null), { kind: 'text', text: 'hola' })).toBe('hola');
  });

  it('reads the text layer of a PDF', async () => {
    const bytes = await readFixture('./__fixtures__/simple.pdf');
    expect(await documentToText(model(null), { kind: 'pdf', bytes })).toContain('Laura Méndez');
  });

  it('reads the demo 01.pdf with its printed hyphens (the font maps them to a private-use code)', async () => {
    const bytes = await readFixture('../../web/public/demo/invoices/01.pdf');
    expect(await documentToText(model(null), { kind: 'pdf', bytes })).toBe(TEXT_01);
  });

  it('transcribes an image with the vision model', async () => {
    const run = vi.fn(async () => ({ response: 'Laura Méndez 2.500,00' }));
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    expect(await documentToText(envWith(run), { kind: 'image', bytes })).toBe('Laura Méndez 2.500,00');
    expect(run).toHaveBeenCalledWith('vision-model', expect.objectContaining({ image: [1, 2, 3], prompt: expect.any(String) }));
  });

  it.each([
    ['the PDF is corrupt', () => documentToText(model(null), { kind: 'pdf', bytes: new TextEncoder().encode('not a pdf').buffer as ArrayBuffer })],
    ['bytes are missing', () => documentToText(model(null), { kind: 'pdf' })],
    ['the vision model answers nothing', () => documentToText(model(null), { kind: 'image', bytes: new ArrayBuffer(2) })],
  ])('returns an empty string when %s, so the reader ends in ilegible (AC-13)', async (_n, call) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await call()).toBe('');
  });

  it.each([
    ['the daily allocation is used up', async () => { throw new Error(QUOTA); }],
    ['the vision model throws', async () => { throw new Error('boom'); }],
  ])('returns null (reader unavailable, R-75) when %s on an image', async (_n, run) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await documentToText(envWith(run), { kind: 'image', bytes: new ArrayBuffer(2) })).toBeNull();
  });

  it('returns null after 20 s without a vision answer (R-75)', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const p = documentToText(envWith(() => new Promise(() => {})), { kind: 'image', bytes: new ArrayBuffer(2) });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await p).toBeNull();
  });

  it('logs the vision failure reason, so an unread image is never silent (AC-13)', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await documentToText(envWith(async () => { throw new Error('4006: daily free allocation of 10,000 neurons'); }), { kind: 'image', bytes: new ArrayBuffer(2) });
    expect(log).toHaveBeenCalledWith('reader: no text', 'quota');
  });
});

// R-80 (AC-14 Clarified): the amount guard runs on the text at `lee`, before and independently of the model; its code
// wins over lector_no_disponible, and the amount is stored null whatever the model said.
describe('extractFields with the amount guard (AC-14 Clarified, R-80)', () => {
  const CUADRA = 'Subtotal: USD 100.00 / IVA: USD 19.00 / Total: USD 150.00';
  const NOTA = 'Total: (USD 500,00) nota credito';
  const answers = (amount: unknown) => model({ ...good, amount });
  it.each([
    [CUADRA, 'total_no_cuadra'], [NOTA, 'nota_credito'],
  ])('%s: amount null and the same read_error for every model answer', async (text, code) => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const hang = extractFields(envWith(() => new Promise(() => {})), text);
    await vi.advanceTimersByTimeAsync(20_000);
    const outs = [
      await extractFields(answers(150), text), await extractFields(answers(500), text), await extractFields(answers(119), text),
      await extractFields(answers('150,00'), text), await extractFields(envWith(async () => { throw new Error(QUOTA); }), text),
      await hang, await extractFields(model('lo siento'), text),
    ];
    for (const o of outs) expect(o).toMatchObject({ amount: null, read_error: code });
  });
  it('keeps the other fields the model read, and stores the guard values', async () => {
    expect(await extractFields(answers(150), CUADRA)).toEqual({ ...good, amount: null, read_error: 'total_no_cuadra',
      read_detail: { subtotal: 100, tax: 19, sum: 119, totals: '150', amount_read: 150 } });
  });
  it('with the model unavailable: every field null, the guard code instead of lector_no_disponible', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await extractFields(envWith(async () => { throw new Error(QUOTA); }), NOTA)).toEqual({ ...UNAVAILABLE, read_error: 'nota_credito',
      read_detail: { signal: 'Total: (USD 500,00)' } });
  });
  it('3b: a model amount that is none of the printed totals is total_no_cuadra', async () => {
    expect(await extractFields(answers(250), 'Total: USD 2,500.00')).toMatchObject({ amount: null, read_error: 'total_no_cuadra',
      read_detail: { totals: '2500', amount_read: 250 } });
    expect(await extractFields(answers(2500), 'Total: USD 2,500.00')).toEqual({ ...good, amount: 2500 });
  });
  it('an image whose vision transcription says «nota crédito» is flagged (the text model unavailable)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = envWith(async (m) => { if (m === 'vision-model') return { response: 'NOTA CRÉDITO NC-7\nTotal USD 300.00' }; throw new Error(QUOTA); });
    const text = await documentToText(env, { kind: 'image', bytes: new ArrayBuffer(2) });
    expect(await extractFields(env, text)).toMatchObject({ amount: null, read_error: 'nota_credito', read_detail: { signal: 'NOTA CRÉDITO' } });
  });
  it('a vision step with no answer has no text to guard: lector_no_disponible', async () => {
    expect(await extractFields(model(null), null)).toEqual(UNAVAILABLE);
  });
});
