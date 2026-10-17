// The only place the Worker calls a model (AC-12, AC-61, AC-89): documentToText (pdf/image/text -> text), extractFields
// (text -> InvoiceFields) and answerQuestion (AC-67). Amazon Nova Lite on Bedrock first, then one Workers AI attempt.
// No failure is an error, so the agent escalates (AC-13): no answer from either provider is "lector_no_disponible", an
// answer with nothing usable is "ilegible" (R-75, R-92).
import { AwsClient } from 'aws4fetch';
import { extractText, getDocumentProxy } from 'unpdf';
import { z } from 'zod';
import type { Env } from '../env';
import type { InvoiceFields } from '../engine/types';
import type { Lang } from '../i18n';
import { ASK_SCHEMA, ASK_SYSTEM, askMessage } from '../prompts/ask';
import { EXTRACT_SYSTEM, INVOICE_SCHEMA, JSON_ONLY, VISION_PROMPT } from '../prompts/extract';
import { amountGuard } from './amount-guard';
import { parseAmount, round2 } from './money';

const TIMEOUT_MS = 20_000;
const MIN_CONFIDENCE = 0.8; // R-10
const ILEGIBLE: InvoiceFields = {
  payee_name: null, amount: null, currency: null, invoice_number: null, issue_date: null, due_date: null,
  concept: 'ilegible', bank_account: null, confidence: {},
};
const UNAVAILABLE: InvoiceFields = { ...ILEGIBLE, concept: null, read_error: 'lector_no_disponible' };
const NOVA = 'Amazon Nova Lite (AWS Bedrock)'; // R-92: the label recorded with a Bedrock read (AC-77)

// AC-77: the provider that read the fields, recorded at read time. Absent when no model read them.
export type ReadFields = InvoiceFields & { read_by?: { provider: string } };

const withTimeout = <T>(p: Promise<T>): Promise<T> => {
  let t: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => { t = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS); });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
};

// Why a read failed, as a short code for `wrangler tail` (never the document text): 4006 = the account's daily Workers AI
// allocation is used up, which turns every read into "lector_no_disponible" until 00:00 UTC (7c live regression, R-75).
// 'quota' also covers Bedrock throttling and any 429 (AC-67 ai_quota).
const reason = (e: unknown): string =>
  e instanceof z.ZodError ? 'schema' : e instanceof SyntaxError ? 'invalid_json' : !(e instanceof Error) ? 'model_error'
    : ['timeout', 'not_configured'].includes(e.message) ? e.message : /4006|neurons|\b429\b|Throttling/i.test(e.message) ? 'quota' : 'model_error';

const ai = (env: Env, model: string, input: object): Promise<unknown> =>
  withTimeout(env.AI.run(model as keyof AiModels, input as never) as Promise<unknown>);

type Block = Record<string, unknown>;
// One Converse call on Bedrock (AC-89), signed with the Worker's own IAM secret. Returns the answer text; throws on any
// failure (missing secret, HTTP error, throttling, network, 20 s, empty answer) so the caller falls back to Workers AI.
const converse = (env: Env, system: string | null, content: Block[], maxTokens: number): Promise<string> =>
  withTimeout((async () => {
    const { AWS_BEDROCK_ACCESS_KEY_ID: accessKeyId, AWS_BEDROCK_SECRET_ACCESS_KEY: secretAccessKey, BEDROCK_REGION: region, BEDROCK_MODEL_ID: model } = env;
    if (!accessKeyId || !secretAccessKey || !region || !model) throw new Error('not_configured');
    const aws = new AwsClient({ accessKeyId, secretAccessKey, region, service: 'bedrock', retries: 0 });
    const res = await aws.fetch(`https://bedrock-runtime.${region}.amazonaws.com/model/${model}/converse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...(system && { system: [{ text: system }] }),
        messages: [{ role: 'user', content }],
        inferenceConfig: { maxTokens, temperature: 0 },
      }),
    });
    if (!res.ok) throw new Error(`bedrock ${res.status} ${res.headers.get('x-amzn-errortype') ?? ''}`);
    const out = (await res.json()) as { output?: { message?: { content?: { text?: string }[] } } };
    const text = out.output?.message?.content?.map((c) => c.text ?? '').join('') ?? '';
    if (!text.trim()) throw new SyntaxError('empty answer');
    return text;
  })());

// Nova's answer parsed, or why it failed (logged as a code: never the secret, never the document).
const nova = async <T>(env: Env, system: string | null, content: Block[], maxTokens: number, parse: (text: string) => T):
  Promise<{ ok: T } | { why: string }> => {
  try {
    return { ok: parse(await converse(env, system, content, maxTokens)) };
  } catch (e) {
    const why = reason(e);
    console.error('llm: bedrock', why);
    return { why };
  }
};

// Nova wraps JSON in a code fence at times: take the outermost object.
const jsonIn = (text: string): unknown => JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
const b64 = (bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const transcribe = (env: Env, block: Block) => nova(env, null, [block, { text: VISION_PROMPT }], 2048, (t) => t);

// null = no provider gave an answer (R-75); '' = nothing usable, so extractFields says ilegible.
export async function documentToText(
  env: Env,
  input: { kind: 'pdf' | 'image' | 'text'; bytes?: ArrayBuffer; text?: string },
): Promise<string | null> {
  if (input.kind === 'text') return input.text ?? '';
  if (!input.bytes) return '';
  const bytes = new Uint8Array(input.bytes);
  if (input.kind === 'pdf') {
    let text: string;
    try {
      const pdf = await getDocumentProxy(bytes.slice()); // pdf.js detaches the buffer it gets
      // Chrome + Inter print the hyphen of "FS-118" as a private-use code point; read it back as the hyphen it shows.
      // ponytail: any private-use glyph becomes "-"; map by glyph name if a font uses them for other symbols.
      text = (await extractText(pdf, { mergePages: true })).text.replace(/[\uE000-\uF8FF]/g, '-');
    } catch (e) {
      console.error('reader: no text', reason(e));
      return '';
    }
    if (text.trim()) return text;
    // R-92: a scan has no text layer; Nova reads the pages as a Converse document block. Workers AI reads no PDF.
    const n = await transcribe(env, { document: { format: 'pdf', name: 'factura', source: { bytes: b64(bytes) } } });
    return 'ok' in n ? n.ok : null;
  }
  const n = await transcribe(env, { image: { format: bytes[0] === 0xff ? 'jpeg' : 'png', source: { bytes: b64(bytes) } } }); // ingest takes PNG and JPEG only
  if ('ok' in n) return n.ok;
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

// R-129 (AC-12): a sentence is never an account. 6+ ASCII digits anywhere, or an email-shaped Pix key (R-73 (b)).
// Tested on the first 200 chars: model output is untrusted, and `\S@\S+\.\S` is the same set as `\S+@\S+\.\S+` without its cubic backtracking.
const looksLikeAccount = (v: string | null): string | null => {
  const head = v?.slice(0, 200) ?? '';
  return v && (/(?:\d\D*){6}/.test(head) || /\S@\S+\.\S/.test(head)) ? v : null;
};

const toNumber = (v: number | string | null): number | null => (typeof v === 'string' ? parseAmount(v) : v);

export async function extractFields(env: Env, text: string | null): Promise<ReadFields> {
  if (text === null) return { ...UNAVAILABLE };
  if (!text.trim()) return { ...ILEGIBLE };
  const [fields, amountRead] = await modelFields(env, text);
  const guarded = amountGuard(text, amountRead); // R-80: wins over the model's answer and over lector_no_disponible
  return guarded ? { ...fields, amount: null, ...guarded } : fields;
}

// The fields the model read, and the amount it answered before the confidence filter (null when it gave none).
async function modelFields(env: Env, text: string): Promise<[ReadFields, number | null]> {
  const n = await nova(env, `${EXTRACT_SYSTEM}\n${JSON_ONLY(INVOICE_SCHEMA)}`, [{ text }], 1024, (t) => toFields(jsonIn(t)));
  if ('ok' in n) return [{ ...n.ok[0], read_by: { provider: NOVA } }, n.ok[1]];
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
  const read_by = { provider: `Workers AI · ${env.WORKERS_AI_MODEL}` }; // R-97: it answered, usable or not
  try {
    const raw = out?.response;
    const [fields, amount] = toFields(typeof raw === 'string' ? JSON.parse(raw) : raw);
    return [{ ...fields, read_by }, amount];
  } catch (e) {
    console.error('reader: ilegible', reason(e));
    return [{ ...ILEGIBLE, read_by }, null];
  }
}

// A model answer as fields (R-10, AC-14); throws when it breaks the schema.
function toFields(raw: unknown): [InvoiceFields, number | null] {
  const a = Answer.parse(raw);
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
    bank_account: keep('bank_account', looksLikeAccount(a.bank_account)),
    confidence: Object.fromEntries(Object.entries(a.confidence).filter(([k]) => k in ILEGIBLE && k !== 'confidence')),
  }, amount ?? null];
}

const Reply = z.object({ answer: z.string().trim().min(1).max(1200) });

// AC-67: a grounded answer to one question, from the context the route built. Never an action, never a guess:
// 'ai_quota' when every provider refused for quota or throttling, 'failed' for anything else.
export async function answerQuestion(env: Env, context: string, question: string, lang: Lang):
  Promise<{ answer: string; provider: string } | { reason: 'ai_quota' | 'failed' }> {
  const [system, user] = [ASK_SYSTEM(lang), askMessage(context, question)];
  const n = await nova(env, system, [{ text: user }], 600, (t) => Reply.parse(jsonIn(t)).answer);
  if ('ok' in n) return { answer: n.ok, provider: NOVA };
  try {
    const out = (await ai(env, env.WORKERS_AI_MODEL, {
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      response_format: { type: 'json_schema', json_schema: ASK_SCHEMA },
      max_tokens: 600,
    })) as { response?: unknown } | null;
    const raw = out?.response;
    return { answer: Reply.parse(typeof raw === 'string' ? JSON.parse(raw) : raw).answer, provider: `Workers AI · ${env.WORKERS_AI_MODEL}` };
  } catch (e) {
    const why = reason(e);
    console.error('ask: no answer', why);
    return { reason: n.why === 'quota' && why === 'quota' ? 'ai_quota' : 'failed' };
  }
}
