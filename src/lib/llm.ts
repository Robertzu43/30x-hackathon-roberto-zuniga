// The only place the Worker calls a model (AC-12, AC-61): documentToText (pdf/image/text -> text) and extractFields
// (text -> InvoiceFields). Every failure ends as "ilegible" so the agent escalates instead of erroring (AC-13).
import { extractText, getDocumentProxy } from 'unpdf';
import { z } from 'zod';
import type { Env } from '../env';
import type { InvoiceFields } from '../engine/types';
import { EXTRACT_SYSTEM, INVOICE_SCHEMA, VISION_PROMPT } from '../prompts/extract';
import { parseAmount, round2 } from './money';

const TIMEOUT_MS = 20_000;
const MIN_CONFIDENCE = 0.8; // R-10
const ILEGIBLE: InvoiceFields = {
  payee_name: null, amount: null, currency: null, invoice_number: null, issue_date: null, due_date: null,
  concept: 'ilegible', bank_account: null, confidence: {},
};

const withTimeout = <T>(p: Promise<T>): Promise<T> => {
  let t: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => { t = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS); });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
};

// Why a read failed, as a short code for `wrangler tail` (never the document text): 4006 = the account's daily Workers AI
// allocation is used up, which turns every read into "ilegible" until 00:00 UTC (7c live regression).
const reason = (e: unknown): string =>
  e instanceof z.ZodError ? 'schema' : e instanceof SyntaxError ? 'invalid_json' : !(e instanceof Error) ? 'model_error'
    : e.message === 'timeout' ? 'timeout' : /4006|neurons/i.test(e.message) ? 'quota' : 'model_error';

const ai = (env: Env, model: string, input: object): Promise<unknown> =>
  withTimeout(env.AI.run(model as keyof AiModels, input as never) as Promise<unknown>);

export async function documentToText(
  env: Env,
  input: { kind: 'pdf' | 'image' | 'text'; bytes?: ArrayBuffer; text?: string },
): Promise<string> {
  try {
    if (input.kind === 'text') return input.text ?? '';
    if (!input.bytes) return '';
    if (input.kind === 'pdf') {
      const pdf = await getDocumentProxy(new Uint8Array(input.bytes));
      // Chrome + Inter print the hyphen of "FS-118" as a private-use code point; read it back as the hyphen it shows.
      // ponytail: any private-use glyph becomes "-"; map by glyph name if a font uses them for other symbols.
      return (await extractText(pdf, { mergePages: true })).text.replace(/[\uE000-\uF8FF]/g, '-');
    }
    const out = (await ai(env, env.WORKERS_AI_VISION_MODEL, { image: [...new Uint8Array(input.bytes)], prompt: VISION_PROMPT, max_tokens: 2048 })) as
      { response?: string; description?: string } | null;
    return out?.response ?? out?.description ?? '';
  } catch (e) {
    console.error('reader: no text', reason(e));
    return ''; // extractFields turns empty text into ilegible
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

export async function extractFields(env: Env, text: string): Promise<InvoiceFields> {
  if (!text.trim()) return { ...ILEGIBLE };
  try {
    const out = (await ai(env, env.WORKERS_AI_MODEL, {
      messages: [{ role: 'system', content: EXTRACT_SYSTEM }, { role: 'user', content: text }],
      response_format: { type: 'json_schema', json_schema: INVOICE_SCHEMA },
      max_tokens: 1024,
    })) as { response?: unknown } | null;
    const raw = out?.response;
    const a = Answer.parse(typeof raw === 'string' ? JSON.parse(raw) : raw);
    const [amount, subtotal, tax] = [a.amount, a.subtotal, a.tax].map(toNumber);
    const consistent = subtotal == null || tax == null || amount == null || round2(Math.abs(round2(subtotal + tax) - amount)) <= 0.01;
    const sure = (k: string) => (a.confidence[k] ?? 0) >= MIN_CONFIDENCE;
    const keep = <T>(k: string, v: T): T | null => (sure(k) ? v : null);
    return {
      payee_name: keep('payee_name', a.payee_name),
      amount: consistent ? keep('amount', amount ?? null) : null,
      currency: keep('currency', a.currency),
      invoice_number: keep('invoice_number', a.invoice_number),
      issue_date: keep('issue_date', a.issue_date),
      due_date: keep('due_date', a.due_date),
      concept: keep('concept', a.concept),
      bank_account: keep('bank_account', a.bank_account),
      confidence: Object.fromEntries(Object.entries(a.confidence).filter(([k]) => k in ILEGIBLE && k !== 'confidence')),
    };
  } catch (e) {
    console.error('reader: ilegible', reason(e));
    return { ...ILEGIBLE };
  }
}
