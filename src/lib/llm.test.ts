/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import { ASK_SYSTEM, askMessage } from '../prompts/ask';
import { answerQuestion, documentToText, extractFields } from './llm';

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
// Without the Bedrock vars and secrets (every env above), the reader goes straight to Workers AI and names it.
const WAI = { read_by: { provider: 'Workers AI · text-model' } };

// R-94: no test reaches the network; a Bedrock test installs its own fake fetch.
beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no network in unit tests'); })); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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
    expect(await extractFields(envWith(run), 'Factura 1042')).toEqual({ ...good, ...WAI });
    const [name, input] = run.mock.calls[0] as unknown as [string, { response_format: { type: string }; max_tokens: number }];
    expect(name).toBe('text-model');
    expect(input.response_format.type).toBe('json_schema');
    expect(input.max_tokens).toBeGreaterThan(0);
  });

  it('accepts the model answer as a JSON string', async () => {
    expect(await extractFields(model(JSON.stringify(good)), 'x')).toEqual({ ...good, ...WAI });
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
    expect(await extractFields(answers(150), CUADRA)).toEqual({ ...good, ...WAI, amount: null, read_error: 'total_no_cuadra',
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
    expect(await extractFields(answers(2500), 'Total: USD 2,500.00')).toEqual({ ...good, ...WAI, amount: 2500 });
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

// AC-89 (D36, R-92): Amazon Nova Lite on Bedrock first, one Workers AI attempt second. Fake fetch and recorded Converse
// fixtures only (R-94): the request aws4fetch signs is inspected, never sent.
describe('Bedrock first, Workers AI fallback (AC-89, AC-13, AC-77)', () => {
  const SECRET = 'test-only-secret-never-logged';
  const BEDROCK = { BEDROCK_MODEL_ID: 'amazon.nova-lite-v1:0', BEDROCK_REGION: 'us-east-2', AWS_BEDROCK_ACCESS_KEY_ID: 'AKIDTESTONLY', AWS_BEDROCK_SECRET_ACCESS_KEY: SECRET };
  const NOVA = { read_by: { provider: 'Amazon Nova Lite (AWS Bedrock)' } };
  const ENDPOINT = 'https://bedrock-runtime.us-east-2.amazonaws.com/model/amazon.nova-lite-v1:0/converse';
  const both = (run: (model: string, input: unknown) => Promise<unknown>) => ({ ...envWith(run), ...BEDROCK }) as unknown as Env;
  const fixture = async (name: string) => new TextDecoder().decode(await readFixture(`./__fixtures__/${name}`));
  const json = (body: string, status = 200, headers: Record<string, string> = {}) =>
    new Response(body, { status, headers: { 'content-type': 'application/json', ...headers } });
  const converse = (text: string) => json(JSON.stringify({ output: { message: { role: 'assistant', content: [{ text }] } }, stopReason: 'end_turn' }));
  const throttled = async () => json(await fixture('bedrock-throttling.json'), 429, { 'x-amzn-ErrorType': 'ThrottlingException:http://internal.amazon.com/coral/com.amazon.bedrock/' });
  // Fake Bedrock: answers every request with `answer` and records the signed requests.
  const bedrock = (answer: () => Response | Promise<Response> | Promise<never>) => {
    const f = vi.fn<(req: Request) => Promise<Response>>(async () => answer());
    vi.stubGlobal('fetch', f);
    return f;
  };
  const sent = async (f: ReturnType<typeof bedrock>) => {
    const req = f.mock.calls[0]![0];
    return { req, body: (await req.clone().json()) as { system?: { text: string }[]; messages: { role: string; content: Record<string, unknown>[] }[]; inferenceConfig: { maxTokens: number } } };
  };
  const READ_01 = {
    payee_name: 'Laura Méndez', amount: 2500, currency: 'USD', invoice_number: '1042', issue_date: '2026-10-16', due_date: '2026-11-30',
    concept: 'Retainer mensual de desarrollo', bank_account: 'Bancolombia ahorros 0012-3456-4821',
    confidence: { payee_name: 0.98, amount: 0.97, currency: 0.99, invoice_number: 0.96, issue_date: 0.93, due_date: 0.92, concept: 0.9, bank_account: 0.94 },
  };
  const wai = () => vi.fn(async () => ({ response: good }));

  describe('extractFields', () => {
    it('Bedrock answers (a fenced JSON, recorded): the fields name Nova and Workers AI is never called', async () => {
      const f = bedrock(async () => json(await fixture('bedrock-extract.json')));
      const run = wai();
      expect(await extractFields(both(run), TEXT_01)).toEqual({ ...READ_01, ...NOVA });
      expect(f).toHaveBeenCalledTimes(1);
      expect(run).not.toHaveBeenCalled();
    });

    it('signs a Converse call to the in-Region Nova Lite endpoint with the Worker secret, which never travels in clear', async () => {
      const f = bedrock(async () => json(await fixture('bedrock-extract.json')));
      await extractFields(both(wai()), TEXT_01);
      const { req, body } = await sent(f);
      expect([req.method, req.url, new URL(req.url).host]).toEqual(['POST', ENDPOINT, 'bedrock-runtime.us-east-2.amazonaws.com']);
      expect(req.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDTESTONLY\/\d{8}\/us-east-2\/bedrock\/aws4_request, SignedHeaders=.*, Signature=[0-9a-f]{64}$/);
      expect(JSON.stringify([...req.headers]) + JSON.stringify(body)).not.toContain(SECRET);
      expect(body.messages).toEqual([{ role: 'user', content: [{ text: TEXT_01 }] }]); // the document is data, never the system prompt
      expect(body.inferenceConfig.maxTokens).toBeGreaterThan(0);
    });

    it('keeps the Task 7b payee rule and the JSON schema in the Nova prompt', async () => {
      const f = bedrock(async () => json(await fixture('bedrock-extract.json')));
      await extractFields(both(wai()), TEXT_01);
      const system = (await sent(f)).body.system![0]!.text;
      expect(system).toMatch(/issued the invoice and gets paid/);
      expect(system).toMatch(/Facturar a.*Bill to|Bill to.*Facturar a/s);
      expect(system).toContain('"bank_account"');
    });

    it.each([
      ['HTTP 500', () => json('{"message":"internal"}', 500)],
      ['throttling (429 ThrottlingException)', throttled],
      ['a network error', () => Promise.reject(new TypeError('fetch failed'))],
      ['an answer that is not JSON', () => converse('No puedo leer esta factura.')],
      ['an answer that breaks the schema', () => converse(JSON.stringify({ ...good, confidence: { amount: 7 } }))],
      ['a response with no message', () => json('{}')],
    ])('Bedrock fails with %s: Workers AI is called once and its answer is used and named', async (_n, answer) => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      bedrock(answer);
      const run = wai();
      expect(await extractFields(both(run), 'Factura 1042')).toEqual({ ...good, ...WAI });
      expect(run).toHaveBeenCalledTimes(1);
      expect(run.mock.calls[0]).toEqual(['text-model', expect.objectContaining({ response_format: expect.objectContaining({ type: 'json_schema' }) })]);
    });

    it('Bedrock silent for 20 s: Workers AI answers', async () => {
      vi.useFakeTimers();
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      bedrock(() => new Promise<never>(() => {}));
      const p = extractFields(both(wai()), 'Factura 1042');
      await vi.advanceTimersByTimeAsync(20_000);
      expect(await p).toEqual({ ...good, ...WAI });
      expect(log).toHaveBeenCalledWith('llm: bedrock', 'timeout');
    });

    it.each([
      ['Bedrock 500, Workers AI out of quota', () => json('{}', 500), async () => { throw new Error(QUOTA); }],
      ['Bedrock throttled, Workers AI unknown model', throttled, async () => { throw new Error('5007: No such model'); }],
      ['Bedrock invalid, Workers AI down', () => converse('lo siento'), async () => { throw new Error('boom'); }],
    ])('both fail (%s): lector_no_disponible, with no provider recorded (AC-13 Clarified)', async (_n, answer, run) => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      bedrock(answer);
      expect(await extractFields(both(run), 'x')).toEqual(UNAVAILABLE);
    });

    it('Bedrock fails and Workers AI answers nothing usable: ilegible, as today', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      bedrock(() => json('{}', 500));
      expect(await extractFields(both(async () => ({ response: 'lo siento' })), 'x')).toEqual(ALL_NULL);
    });

    it('without the Bedrock secrets it goes straight to Workers AI, with no request at all', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const f = bedrock(() => json('{}'));
      expect(await extractFields({ ...envWith(wai()), BEDROCK_MODEL_ID: 'amazon.nova-lite-v1:0', BEDROCK_REGION: 'us-east-2' } as unknown as Env, 'x'))
        .toEqual({ ...good, ...WAI });
      expect(f).not.toHaveBeenCalled();
    });

    it('logs only reason codes: never the secret, never the document text', async () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      bedrock(throttled);
      await extractFields(both(async () => { throw new Error(QUOTA); }), 'SECRETO factura 1042');
      expect(log).toHaveBeenCalledWith('llm: bedrock', 'quota');
      expect(JSON.stringify(log.mock.calls)).not.toMatch(new RegExp(`SECRETO|${SECRET}|AKIDTESTONLY`));
    });

    it('the amount guard runs on the Nova answer too, and the provider stays recorded (AC-14, R-80)', async () => {
      bedrock(() => converse(JSON.stringify({ ...good, amount: 150 })));
      expect(await extractFields(both(wai()), 'Subtotal: USD 100.00 / IVA: USD 19.00 / Total: USD 150.00'))
        .toMatchObject({ amount: null, read_error: 'total_no_cuadra', ...NOVA });
    });
  });

  describe('documentToText', () => {
    const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7]);
    const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1]);
    const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));

    it.each([['png', PNG], ['jpeg', JPEG]])('an image (%s) goes to Nova as a Converse image block; the transcription is the text', async (format, bytes) => {
      const f = bedrock(async () => json(await fixture('bedrock-transcribe.json')));
      const run = vi.fn();
      const text = await documentToText(both(run), { kind: 'image', bytes: bytes.buffer as ArrayBuffer });
      expect(text).toMatch(/^Laura Méndez\nFactura N\.º 1042/);
      const { req, body } = await sent(f);
      expect(req.url).toBe(ENDPOINT);
      expect(body.messages[0]!.content).toEqual([{ image: { format, source: { bytes: b64(bytes) } } }, { text: expect.stringMatching(/transcribe/i) }]);
      expect(run).not.toHaveBeenCalled();
    });

    it('an image Bedrock cannot read goes to the Workers AI vision model once', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      bedrock(throttled);
      const run = vi.fn(async () => ({ response: 'Laura Méndez 2.500,00' }));
      expect(await documentToText(both(run), { kind: 'image', bytes: PNG.buffer as ArrayBuffer })).toBe('Laura Méndez 2.500,00');
      expect(run).toHaveBeenCalledTimes(1);
      expect(run).toHaveBeenCalledWith('vision-model', expect.objectContaining({ image: [...PNG] }));
    });

    it('an image neither provider reads is null (lector_no_disponible)', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      bedrock(() => json('{}', 500));
      expect(await documentToText(both(async () => { throw new Error(QUOTA); }), { kind: 'image', bytes: PNG.buffer as ArrayBuffer })).toBeNull();
    });

    it('a PDF with an empty text layer goes to Nova as a Converse document block (R-92)', async () => {
      const f = bedrock(async () => json(await fixture('bedrock-transcribe.json')));
      const bytes = await readFixture('./__fixtures__/blank.pdf');
      expect(await documentToText(both(vi.fn()), { kind: 'pdf', bytes })).toMatch(/^Laura Méndez/);
      const content = (await sent(f)).body.messages[0]!.content;
      expect(content).toEqual([{ document: { format: 'pdf', name: 'factura', source: { bytes: b64(new Uint8Array(bytes)) } } }, { text: expect.any(String) }]);
    });

    it('a PDF with a text layer sends the text only: no model call', async () => {
      const f = bedrock(() => json('{}'));
      const run = vi.fn();
      expect(await documentToText(both(run), { kind: 'pdf', bytes: await readFixture('./__fixtures__/simple.pdf') })).toContain('Laura Méndez');
      expect(f).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
    });

    it('a PDF with no text layer that Nova cannot read is null: Workers AI cannot read PDF pages', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      bedrock(throttled);
      const run = vi.fn();
      expect(await documentToText(both(run), { kind: 'pdf', bytes: await readFixture('./__fixtures__/blank.pdf') })).toBeNull();
      expect(run).not.toHaveBeenCalled();
    });
  });

  // AC-67: the grounded answer. The route (Task 23) builds the context and takes the quota.
  describe('answerQuestion', () => {
    const CONTEXT = 'Factura 1042 de Laura Méndez · FRENAR · Límite por pago: 2.500 USD supera 2.000 USD → no cumple';
    const Q = '¿por qué frenaste esta factura?';
    const waiAnswer = (answer: unknown) => vi.fn(async () => ({ response: { answer } }));

    it('Bedrock answers (recorded): the answer and the provider that gave it', async () => {
      const f = bedrock(async () => json(await fixture('bedrock-answer.json')));
      const run = vi.fn();
      expect(await answerQuestion(both(run), CONTEXT, Q, 'es'))
        .toEqual({ answer: 'La frené porque el monto supera el límite por pago de la política.', provider: 'Amazon Nova Lite (AWS Bedrock)' });
      expect(run).not.toHaveBeenCalled();
      const { req, body } = await sent(f);
      expect(req.url).toBe(ENDPOINT);
      expect(req.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 /);
      expect(body.system).toEqual([{ text: ASK_SYSTEM('es') }]);
      expect(body.messages).toEqual([{ role: 'user', content: [{ text: askMessage(CONTEXT, Q) }] }]);
    });

    it('the prompt holds only the context and the question, and says what to answer when the record lacks it', () => {
      expect(askMessage(CONTEXT, Q)).toBe(`<registro>\n${CONTEXT}\n</registro>\n<pregunta>\n${Q}\n</pregunta>`);
      expect(ASK_SYSTEM('es')).toContain('No tengo ese dato en el registro.');
      expect(ASK_SYSTEM('en')).toContain('That is not in the record.');
      expect(ASK_SYSTEM('es')).toMatch(/never approve, pay/);
      expect(ASK_SYSTEM('en')).toMatch(/in English/);
      expect(ASK_SYSTEM('es')).toMatch(/en español/);
    });

    it('Bedrock fails: one Workers AI attempt with a JSON schema, named in the result', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      bedrock(() => json('{}', 500));
      const run = waiAnswer('Porque supera el límite.');
      expect(await answerQuestion(both(run), CONTEXT, Q, 'es')).toEqual({ answer: 'Porque supera el límite.', provider: 'Workers AI · text-model' });
      expect(run).toHaveBeenCalledTimes(1);
      const [name, input] = run.mock.calls[0] as unknown as [string, { messages: unknown[]; response_format: { type: string } }];
      expect(name).toBe('text-model');
      expect(input.response_format.type).toBe('json_schema');
      expect(input.messages).toEqual([{ role: 'system', content: ASK_SYSTEM('es') }, { role: 'user', content: askMessage(CONTEXT, Q) }]);
    });

    it.each([
      ['Bedrock 429 ThrottlingException, Workers AI 4006', throttled, async () => { throw new Error(QUOTA); }],
      ['Bedrock 429, Workers AI 429', () => json('{}', 429), async () => { throw new Error('AiError: 429 Too Many Requests'); }],
    ])('both refuse for quota (%s): ai_quota', async (_n, answer, run) => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      bedrock(answer);
      expect(await answerQuestion(both(run), CONTEXT, Q, 'en')).toEqual({ reason: 'ai_quota' });
    });

    it.each([
      ['Bedrock throttled, Workers AI throws', throttled, async () => { throw new Error('boom'); }],
      ['Bedrock HTTP 500, Workers AI 4006', () => json('{}', 500), async () => { throw new Error(QUOTA); }],
      ['both throw', () => Promise.reject(new TypeError('fetch failed')), async () => { throw new Error('boom'); }],
      ['both answer invalid JSON', () => converse('claro que sí'), async () => ({ response: 'claro que sí' })],
      ['both answer over 1.200 characters', () => converse(JSON.stringify({ answer: 'a'.repeat(1201) })), async () => ({ response: { answer: 'a'.repeat(1201) } })],
      ['both answer an empty string', () => converse('{"answer":""}'), async () => ({ response: { answer: '' } })],
    ])('anything else (%s): failed', async (_n, answer, run) => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      bedrock(answer);
      expect(await answerQuestion(both(run), CONTEXT, Q, 'es')).toEqual({ reason: 'failed' });
    });

    it('both silent for 20 s: failed', async () => {
      vi.useFakeTimers();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      bedrock(() => new Promise<never>(() => {}));
      const p = answerQuestion(both(() => new Promise(() => {})), CONTEXT, Q, 'es');
      await vi.advanceTimersByTimeAsync(40_000);
      expect(await p).toEqual({ reason: 'failed' });
    });
  });
});
