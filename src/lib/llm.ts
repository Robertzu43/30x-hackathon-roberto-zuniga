// The only place the Worker calls a model (AC-12, AC-61): documentToText (pdf/image/text -> text) and extractFields
// (text -> InvoiceFields). No failure is an error, so the agent escalates (AC-13): no answer from the model is
// "lector_no_disponible", an answer with nothing usable is "ilegible" (R-75).
import { extractText, getDocumentProxy } from 'unpdf';
import { z } from 'zod';
import type { Env } from '../env';
import type { InvoiceFields } from '../engine/types';
import { EXTRACT_SYSTEM, INVOICE_SCHEMA, VISION_PROMPT } from '../prompts/extract';
import { amountGuard } from './amount-guard';
import { parseAmount, round2 } from './money';

const TIMEOUT_MS = 20_000;
const MIN_CONFIDENCE = 0.8; // R-10
const ILEGIBLE: InvoiceFields = {
  payee_name: null, amount: null, currency: null, invoice_number: null, issue_date: null, due_date: null,
  concept: 'ilegible', bank_account: null, confidence: {},
};
const UNAVAILABLE: InvoiceFields = { ...ILEGIBLE, concept: null, read_error: 'lector_no_disponible' };

const withTimeout = <T>(p: Promise<T>): Promise<T> => {
  let t: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => { t = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS); });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
};

// Why a read failed, as a short code for `wrangler tail` (never the document text): 4006 = the account's daily Workers AI
// allocation is used up, which turns every read into "lector_no_disponible" until 00:00 UTC (7c live regression, R-75).
const reason = (e: unknown): string =>
  e instanceof z.ZodError ? 'schema' : e instanceof SyntaxError ? 'invalid_json' : !(e instanceof Error) ? 'model_error'
    : e.message === 'timeout' ? 'timeout' : /4006|neurons/i.test(e.message) ? 'quota' : 'model_error';

const ai = (env: Env, model: string, input: object): Promise<unknown> =>
  withTimeout(env.AI.run(model as keyof AiModels, input as never) as Promise<unknown>);

// null = the vision model gave no answer (R-75); '' = nothing usable, so extractFields says ilegible.
export async function documentToText(
  env: Env,
  input: { kind: 'pdf' | 'image' | 'text'; bytes?: ArrayBuffer; text?: string },
): Promise<string | null> {
  if (input.kind === 'text') return input.text ?? '';
  if (!input.bytes) return '';
  if (input.kind === 'pdf') {
    try {
      const pdf = await getDocumentProxy(new Uint8Array(input.bytes));
      // Chrome + Inter print the hyphen of "FS-118" as a private-use code point; read it back as the hyphen it shows.
      // ponytail: any private-use glyph becomes "-"; map by glyph name if a font uses them for other symbols.
      return (await extractText(pdf, { mergePages: true })).text.replace(/[\uE000-\uF8FF]/g, '-');
    } catch (e) {
      console.error('reader: no text', reason(e));
      return '';
    }
  }
  try {
    const out = (await ai(env, env.WORKERS_AI_VISION_MODEL, { image: [...new Uint8Array(input.bytes)], prompt: VISION_PROMPT, max_tokens: 2048 })) as
      { response?: string; description?: string } | null;
    return out?.response ?? out?.description ?? '';
  } catch (e) {
    console.error('reader: no text', reason(e));
    return null;
  }
}

const unknownField = <T extends z.ZodType>(t: T) => t.nullable().catch(null); // a malformed field is unknown, not an error
const money = z.union([z.number().positive(), z.string()]).nullable().catch(null);
const date = unknownField(z.string().regex(/^\d{4}-\d{2}-\d{2}$/));
const Answer = z.object({
  payee_name: unknownField(z.string()),
  amount: money,
  currency: unknownField(z.string().regex(/^[A-Z]{3}$/)),
  invoice_number: unknownField(z.string()),
  issue_date: date,
  due_date: date,
  concept: unknownField(z.string()),
  bank_account: unknownField(z.string()),
  subtotal: money,
  tax: money,
  confidence: z.record(z.string(), z.number().min(0).max(1)),
});

const toNumber = (v: number | string | null): number | null => (typeof v === 'string' ? parseAmount(v) : v);

export async function extractFields(env: Env, text: string | null): Promise<InvoiceFields> {
  if (text === null) return { ...UNAVAILABLE };
  if (!text.trim()) return { ...ILEGIBLE };
  const [fields, amountRead] = await modelFields(env, text);
  const guarded = amountGuard(text, amountRead); // R-80: wins over the model's answer and over lector_no_disponible
  return guarded ? { ...fields, amount: null, ...guarded } : fields;
}

// The fields the model read, and the amount it answered before the confidence filter (null when it gave none).
async function modelFields(env: Env, text: string): Promise<[InvoiceFields, number | null]> {
  let out: { response?: unknown } | null;
  try {
    out = (await ai(env, env.WORKERS_AI_MODEL, {
      messages: [{ role: 'system', content: EXTRACT_SYSTEM }, { role: 'user', content: text }],
      response_format: { type: 'json_schema', json_schema: INVOICE_SCHEMA },
      max_tokens: 1024,
    })) as { response?: unknown } | null;
  } catch (e) {
    console.error('reader: lector_no_disponible', reason(e));
    return [{ ...UNAVAILABLE }, null];
  }
  try {
    const raw = out?.response;
    const a = Answer.parse(typeof raw === 'string' ? JSON.parse(raw) : raw);
    const [amount, subtotal, tax] = [a.amount, a.subtotal, a.tax].map(toNumber);
    const consistent = subtotal == null || tax == null || amount == null || round2(Math.abs(round2(subtotal + tax) - amount)) <= 0.01;
    const sure = (k: string) => (a.confidence[k] ?? 0) >= MIN_CONFIDENCE;
    const keep = <T>(k: string, v: T): T | null => (sure(k) ? v : null);
    return [{
      payee_name: keep('payee_name', a.payee_name),
      amount: consistent ? keep('amount', amount ?? null) : null,
      currency: keep('currency', a.currency),
      invoice_number: keep('invoice_number', a.invoice_number),
      issue_date: keep('issue_date', a.issue_date),
      due_date: keep('due_date', a.due_date),
      concept: keep('concept', a.concept),
      bank_account: keep('bank_account', a.bank_account),
      confidence: Object.fromEntries(Object.entries(a.confidence).filter(([k]) => k in ILEGIBLE && k !== 'confidence')),
    }, amount ?? null];
  } catch (e) {
    console.error('reader: ilegible', reason(e));
    return [{ ...ILEGIBLE }, null];
  }
}
