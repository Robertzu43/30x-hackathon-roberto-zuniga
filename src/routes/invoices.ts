// Bandeja, ingest and the decision detail (AC-08, AC-11, AC-12, AC-13, AC-15, AC-26, AC-29, AC-64, AC-65, AC-77).
// Every read and write uses the user's JWT client (RLS); decisions and runs are written only by runAgent's record.ts.
import type { Context } from 'hono';
import { z } from 'zod';
import { decodeCursor, runAgent } from '../agent/loop';
import type { LecturaCheck } from '../agent/record';
import { directorio, findBeneficiary } from '../agent/tools';
import { agentTrace, recordedFields, type StoredDecision } from '../agent/trace';
import { explainCheck, whatWouldPay } from '../engine/explain';
import { validFields } from '../engine/checks';
import type { Invoice, InvoiceFields } from '../engine/types';
import type { Lang } from '../i18n';
import { documentToText, extractFields, type ReadFields } from '../lib/llm';
import type { AppEnv } from '../lib/auth';
import { locate } from '../lib/snippet';
import { isUuid, must } from '../lib/supabase';
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
// "Lo que leí" fields in screen order (AC-12, AC-77).
export const READ = ['payee_name', 'amount', 'currency', 'invoice_number', 'issue_date', 'due_date', 'concept', 'bank_account'] as const;
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
  })

  .get('/:id', async (c) => {
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

// The decision detail of one of the company's invoices in `lang`, or null when it has none with that id. Also the record
// «Pregúntale a Thesaurus» answers from (AC-67).
export async function invoiceDetail({ db, companyId }: AppEnv['Variables'], id: string, lang: Lang) {
  const row: Current | null = must(await db.from('invoice_current').select('*').eq('company_id', companyId).eq('id', id).maybeSingle());
  if (!row) return null;
  const [decisions, directory, company, notification]: [StoredDecision[], Awaited<ReturnType<typeof directorio>>, { is_demo: boolean }, { email_sent: boolean; sent_to: string } | null] = await Promise.all([
    db.from('decisions').select('*').eq('company_id', companyId).eq('invoice_id', row.id).order('seq').then(must),
    directorio(db, companyId),
    db.from('companies').select('is_demo').eq('id', companyId).single().then(must),
    db.from('approval_tokens').select('email_sent, sent_to').eq('invoice_id', row.id).order('created_at', { ascending: false }).limit(1).maybeSingle().then(must),
  ]);
  const latest = decisions.at(-1);
  // file_path is member-writable (R-31): only the seed's static documents pass as is, only the company's own Storage keys are signed.
  const path = row.file_path;
  const fileUrl = !path || path.split('/').includes('..') ? null
    : path.startsWith('/demo/invoices/') ? path
    : path.startsWith(`${companyId}/`) ? (await db.storage.from('files').createSignedUrl(path, SIGNED_URL_SECONDS)).data?.signedUrl ?? null
    : null;
  const policy = latest?.policy_version == null ? null
    : must(await db.from('policies').select('name, version, created_at').eq('company_id', companyId).eq('version', latest.policy_version).maybeSingle());
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
    trace: agentTrace({ invoice, decisions, isDemo: company.is_demo, notification }, lang),
    question: latest?.outcome === 'ESCALAR' ? latest[`question_${lang}`] : null,
    file_url: fileUrl,
    ...readingOf(row.fields, decisions.find((d) => d.actor === 'agent'), invoice.fields, row.raw_text),
  };
}
