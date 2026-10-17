// Bandeja, ingest and the decision detail (AC-08, AC-11, AC-12, AC-13, AC-15, AC-26, AC-29, AC-64, AC-65, AC-77).
// Every read and write uses the user's JWT client (RLS); decisions and runs are written only by runAgent's record.ts.
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { decodeCursor, runAgent } from '../agent/loop';
import { takeQuestion, type LecturaCheck } from '../agent/record';
import { findBeneficiary } from '../agent/tools';
import { agentTrace, recordedFields, type StoredDecision } from '../agent/trace';
import { explainCheck, whatWouldPay } from '../engine/explain';
import { validFields } from '../engine/checks';
import type { Beneficiary, Invoice, InvoiceFields } from '../engine/types';
import type { Lang } from '../i18n';
import * as trialText from '../i18n/features/trial-record';
import { documentToText, extractFields, type ReadFields } from '../lib/llm';
import { requireAuth, type AppEnv, type AuthEnv } from '../lib/auth';
import { docMarks, locate, READ } from '../lib/snippet';
import { isUuid, must, type Db } from '../lib/supabase';
import { memberRoutes } from './agent';

// One invoice_current row: the invoice and its latest decision's columns (outcome null = pending).
export interface Current extends Omit<Invoice, 'fields'> {
  fields: InvoiceFields | null;
  raw_text: string | null;
  file_path: string | null;
  decision_id: string | null;
  outcome: StoredDecision['outcome'] | null;
  amount_usd: number | null;
  headline_es: string | null;
  headline_en: string | null;
}

const FORMAT = 'Formato no admitido: sube un PDF, PNG o JPG de hasta 10 MB';
const MAX_BYTES = 10 * 1024 * 1024; // R-11
// The file's first bytes decide its type, never its name or declared MIME type (R-11).
const FILES = [
  { magic: '%PDF', source: 'pdf', ext: 'pdf', type: 'application/pdf' },
  { magic: '\x89PNG', source: 'image', ext: 'png', type: 'image/png' },
  { magic: '\xff\xd8\xff', source: 'image', ext: 'jpg', type: 'image/jpeg' },
] as const;
const BAD_TEXT = 'Pega un texto de 1 a 20.000 caracteres.'; // R-84
const PastedSource = z.object({ source: z.enum(['email', 'chat']) });
const PastedText = z.string().max(20000).refine((t) => t.trim().length > 0);
const SIGNED_URL_SECONDS = 300; // AC-08
export { READ };
const NOT_RUN = 'No pude ejecutar el agente ahora. Las facturas siguen pendientes; lo intentaré solo en la próxima revisión automática (cada 5 minutos).';

// "Ejecutar agente" and "Reevaluar" (R-60): one budgeted call after the optional {cursor} (AC-70). The browser calls again
// with the returned cursor until it is null. A non-2xx only when nothing changed (R-57).
export async function runFromCursor(c: Context<AppEnv>, trigger: 'manual' | 'reevaluate') {
  const cursor: unknown = ((await c.req.json().catch(() => null)) as { cursor?: unknown } | null)?.cursor ?? null;
  const from = typeof cursor === 'string' ? decodeCursor(cursor) : null;
  if (cursor !== null && !from) return c.json({ error: 'Cursor no válido' }, 400);
  try {
    return c.json(await runAgent({ db: c.var.db, env: c.env, budget: c.var.budget }, c.var.companyId, 'pending', trigger, from));
  } catch (e) {
    console.error('agent: run not started', c.var.companyId, e instanceof Error ? e.message : e);
    return c.json({ error: NOT_RUN }, 503);
  }
}

export const invoices = memberRoutes()
  .get('/', async (c) => {
    const rows: Current[] = must(await c.var.db.from('invoice_current').select('*').eq('company_id', c.var.companyId)
      .order('received_at', { ascending: false }));
    return c.json(rows.map((r) => ({ ...r, headline: r[`headline_${c.var.lang}`] })));
  })

  .post('/run', (c) => runFromCursor(c, 'manual'))

  // Validate, store the file, read it (the only model call, src/lib/llm.ts), insert the invoice WITH its read fields,
  // then let the agent decide it. A failed read is stored as "ilegible" and escalates (AC-13).
  .post('/', async (c) => {
    const { db, companyId } = c.var;
    // AC-96, R-117: a trial company's user ingests at most 30 invoices per UTC day, counted in the database first.
    const { is_trial }: { is_trial: boolean } = must(await db.from('companies').select('is_trial').eq('id', companyId).single());
    if (is_trial && 'reason' in await takeQuestion(c.env, `ingest:${c.var.user.id}`, c.var.budget)) {
      return c.json({ error: trialText[c.var.lang]['trial_record.ingest_cap'] }, 429);
    }
    const id = crypto.randomUUID();
    let source: Invoice['source'];
    let text: string | null; // null: the vision model gave no answer (R-75)
    let filePath: string | null = null;
    if (c.req.header('Content-Type')?.startsWith('multipart/form-data')) {
      const file = (await c.req.formData().catch(() => null))?.get('file');
      if (!(file instanceof File) || !file.size || file.size > MAX_BYTES) return c.json({ error: FORMAT }, 400);
      const bytes = await file.arrayBuffer();
      const head = String.fromCharCode(...new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength)));
      const kind = FILES.find((f) => head.startsWith(f.magic));
      if (!kind) return c.json({ error: FORMAT }, 400);
      filePath = `${companyId}/${id}.${kind.ext}`;
      must(await db.storage.from('files').upload(filePath, bytes, { contentType: kind.type }));
      source = kind.source;
      if (kind.source === 'image') c.var.budget.count(); // the Workers AI vision call (R-56)
      text = await documentToText(c.env, { kind: kind.source, bytes });
    } else {
      const body: unknown = await c.req.json().catch(() => null);
      const s = PastedSource.safeParse(body);
      if (!s.success) return c.json({ error: FORMAT }, 400);
      const t = PastedText.safeParse((body as { text?: unknown }).text);
      if (!t.success) return c.json({ error: BAD_TEXT }, 400);
      source = s.data.source;
      text = t.data;
    }
    c.var.budget.count(); // the Workers AI reader (R-56)
    const fields = await extractFields(c.env, text);
    must(await db.from('invoices').insert({ id, company_id: companyId, source, file_path: filePath, raw_text: text?.slice(0, 20000) ?? null, fields })); // R-88: files too
    // One invoice always fits the budget. If the agent cannot run, the invoice is stored and pending: the cron decides it (R-60).
    await runAgent({ db, env: c.env, budget: c.var.budget }, companyId, [id], 'ingest')
      .catch((e) => console.error('agent: ingest not decided', id, e instanceof Error ? e.message : e));
    const [invoice, decision] = await Promise.all([
      db.from('invoice_current').select('*').eq('id', id).single().then(must),
      db.from('decisions').select('*').eq('invoice_id', id).order('seq', { ascending: false }).limit(1).maybeSingle().then(must),
    ]);
    return c.json({ invoice, decision }, 201);
  });

// Detalle (AC-98): the JWT check and one RPC, screen_detail, with no membership read: the function finds the company from
// auth.uid(). Mounted before `invoices` in src/index.ts, so its requireUser never runs for this GET.
export const invoiceScreen = new Hono<AuthEnv>().get('/:id', requireAuth, async (c) => {
  const d = isUuid(c.req.param('id')) ? await invoiceDetail(c.var, c.req.param('id'), c.var.lang) : null; // R-74
  return d ? c.json(d) : c.json({ error: 'Factura no encontrada' }, 404);
});

// AC-77, R-88, R-97: who read it, as recorded at read time (fields.read_by, else the run read recorded on the first agent
// decision's Lectura check), and per field the line of the stored text where code found the value. reading_status is the
// API's word on it; the web maps it one to one.
function readingOf(stored: ReadFields | null, first: StoredDecision | undefined, shown: InvoiceFields | null, text: string | null) {
  const lectura: LecturaCheck | undefined = stored ? undefined : first?.checks.find((c) => c.id === 'lectura');
  const src = stored ?? lectura;
  const provider = src?.read_by?.provider;
  if (typeof provider === 'string') {
    return { reading_status: 'ai' as const, reading: { provider, fields: READ.map((name) => {
      const value = shown?.[name] ?? null, c = src?.confidence?.[name];
      return { name, value, confidence: typeof c === 'number' ? c : null, ...locate(text, name, value) };
    }) } };
  }
  const error = stored ? stored.read_error : lectura?.values.reason;
  // An «ilegible» ingest with no model call stored its empty text (a corrupt PDF); a seeded one stored null.
  const unread = stored?.concept === 'ilegible' && text !== null && !text.trim();
  const reading_status = error === 'lector_no_disponible' ? 'unavailable' as const : stored && !error && !unread ? 'preloaded' as const : 'none' as const;
  return { reading_status, reading: null };
}

// screen_detail's rows (migration 20261017001000): the reads Detalle needs, in one round trip.
interface DetailRows {
  company_id: string;
  invoice: Current;
  decisions: StoredDecision[];
  directory: Beneficiary[];
  company: { is_demo: boolean; is_trial: boolean };
  notification: { email_sent: boolean; sent_to: string } | null;
  policy: { name: string; version: number; created_at: string } | null;
}

// The decision detail of one of the caller's company's invoices in `lang`, or null when it has none with that id. Also the
// record «Pregúntale a Thesaurus» answers from (AC-67). The texts are rendered here from the stored data (R-29).
export async function invoiceDetail({ db }: { db: Db }, id: string, lang: Lang) {
  const d: DetailRows | null = must(await db.rpc('screen_detail', { p_id: id }));
  if (!d) return null;
  const { invoice: row, decisions, directory, company, notification, policy, company_id: companyId } = d;
  const latest = decisions.at(-1);
  // file_path is member-writable (R-31): only the seed's static documents pass as is, only the company's own Storage keys are signed.
  const path = row.file_path;
  const fileUrl = !path || path.split('/').includes('..') ? null
    : path.startsWith('/demo/invoices/') ? path
    : path.startsWith(`${companyId}/`) ? (await db.storage.from('files').createSignedUrl(path, SIGNED_URL_SECONDS)).data?.signedUrl ?? null
    : null;
  // R-71: "Lo que leí" shows a field the engine cannot trust as unknown, as every check saw it.
  const read = recordedFields(row.fields, latest?.checks);
  const invoice = { ...row, fields: (read && validFields(read)) as InvoiceFields };
  return {
    invoice,
    headline: row[`headline_${lang}`],
    decisions,
    beneficiary: findBeneficiary(read?.payee_name ?? null, directory),
    // R-49: each line names the rate of the stored decision's policy version, never the current one.
    explanations: (latest?.checks ?? []).map((ch) => explainCheck(ch, lang, row.received_at, latest?.policy_version)),
    fixes: whatWouldPay({ checks: latest?.checks ?? [] }, lang),
    policy,
    trace: agentTrace({ invoice, decisions, isDemo: company.is_demo, isTrial: company.is_trial, notification }, lang),
    question: latest?.outcome === 'ESCALAR' ? latest[`question_${lang}`] : null,
    file_url: fileUrl,
    doc_marks: docMarks(row.raw_text, invoice.fields), // AC-102: offsets into raw_text, from code (R-88, R-124)
    ...readingOf(row.fields, decisions.find((d) => d.actor === 'agent'), invoice.fields, row.raw_text),
  };
}
