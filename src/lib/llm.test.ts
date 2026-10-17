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

afterEach(() => vi.useRealTimers());

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

  it('drops a malformed date or currency instead of guessing', async () => {
    const out = await extractFields(model({ ...good, due_date: '30/11/2026', currency: 'dollars' }), 'x');
    expect([out.due_date, out.currency]).toEqual([null, null]);
  });

  it.each([
    ['the model throws', envWith(async () => { throw new Error('boom'); })],
    ['the answer is not JSON', model('lo siento')],
    ['the answer breaks the schema', model({ ...good, confidence: { amount: 7 } })],
    ['the answer is not an object', model(42)],
  ])('returns all-null fields with concept ilegible when %s (AC-13)', async (_n, env) => {
    expect(await extractFields(env, 'x')).toEqual(ALL_NULL);
  });

  it('returns ilegible after 20 s without an answer (AC-13)', async () => {
    vi.useFakeTimers();
    const p = extractFields(envWith(() => new Promise(() => {})), 'x');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await p).toEqual(ALL_NULL);
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
    // the repo has no @types/node, so the fs module is typed by hand
    const { readFile } = (await import('node:fs/promises' as string)) as { readFile(u: URL): Promise<{ buffer: ArrayBuffer }> };
    const { buffer: bytes } = await readFile(new URL('./__fixtures__/simple.pdf', import.meta.url));
    expect(await documentToText(model(null), { kind: 'pdf', bytes })).toContain('Laura Méndez');
  });

  it('transcribes an image with the vision model', async () => {
    const run = vi.fn(async () => ({ response: 'Laura Méndez 2.500,00' }));
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    expect(await documentToText(envWith(run), { kind: 'image', bytes })).toBe('Laura Méndez 2.500,00');
    expect(run).toHaveBeenCalledWith('vision-model', expect.objectContaining({ image: [1, 2, 3], prompt: expect.any(String) }));
  });

  it.each([
    ['the vision model throws', () => documentToText(envWith(async () => { throw new Error('boom'); }), { kind: 'image', bytes: new ArrayBuffer(2) })],
    ['the PDF is corrupt', () => documentToText(model(null), { kind: 'pdf', bytes: new TextEncoder().encode('not a pdf').buffer as ArrayBuffer })],
    ['bytes are missing', () => documentToText(model(null), { kind: 'pdf' })],
  ])('returns an empty string when %s, so the reader ends in ilegible (AC-13)', async (_n, call) => {
    expect(await call()).toBe('');
  });
});
