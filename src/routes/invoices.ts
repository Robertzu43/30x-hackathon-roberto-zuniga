// Bandeja, ingest and the decision detail (AC-08, AC-11, AC-12, AC-13, AC-15, AC-26, AC-29, AC-64, AC-65).
// Every read and write uses the user's JWT client (RLS); decisions and runs are written only by runAgent's record.ts.
import { z } from 'zod';
import { runAgent } from '../agent/loop';
import { directorio, findBeneficiary } from '../agent/tools';
import { agentTrace, type StoredDecision } from '../agent/trace';
import { explainCheck, whatWouldPay } from '../engine/explain';
import type { Invoice, InvoiceFields } from '../engine/types';
import { documentToText, extractFields } from '../lib/llm';
import { must } from '../lib/supabase';
import { memberRoutes } from './agent';

// One invoice_current row: the invoice and its latest decision's columns (outcome null = pending).
export interface Current extends Omit<Invoice, 'fields'> {
  fields: InvoiceFields | null;
  file_path: string | null;
  outcome: StoredDecision['outcome'] | null;
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
const Pasted = z.object({ source: z.enum(['email', 'chat']), text: z.string().max(20000).refine((t) => t.trim().length > 0) });
const SIGNED_URL_SECONDS = 300; // AC-08

export const invoices = memberRoutes()
  .get('/', async (c) => {
    const rows: Current[] = must(await c.var.db.from('invoice_current').select('*').eq('company_id', c.var.companyId)
      .order('received_at', { ascending: false }));
    return c.json(rows.map((r) => ({ ...r, headline: r[`headline_${c.var.lang}`] })));
  })

  .post('/run', async (c) => c.json(await runAgent({ db: c.var.db, env: c.env }, c.var.companyId, 'pending', 'manual')))

  // Validate, store the file, read it (the only model call, src/lib/llm.ts), insert the invoice WITH its read fields,
  // then let the agent decide it. A failed read is stored as "ilegible" and escalates (AC-13).
  .post('/', async (c) => {
    const { db, companyId } = c.var;
    const id = crypto.randomUUID();
    let source: Invoice['source'];
    let text: string;
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
      text = await documentToText(c.env, { kind: kind.source, bytes });
    } else {
      const p = Pasted.safeParse(await c.req.json().catch(() => null));
      if (!p.success) return c.json({ error: FORMAT }, 400);
      ({ source, text } = p.data);
    }
    const fields = await extractFields(c.env, text);
    must(await db.from('invoices').insert({ id, company_id: companyId, source, file_path: filePath, raw_text: filePath ? null : text, fields }));
    await runAgent({ db, env: c.env }, companyId, [id], 'ingest');
    const [invoice, decision] = await Promise.all([
      db.from('invoice_current').select('*').eq('id', id).single().then(must),
      db.from('decisions').select('*').eq('invoice_id', id).order('seq', { ascending: false }).limit(1).maybeSingle().then(must),
    ]);
    return c.json({ invoice, decision }, 201);
  })

  .get('/:id', async (c) => {
    const { db, companyId, lang } = c.var;
    const row: Current | null = must(await db.from('invoice_current').select('*').eq('company_id', companyId).eq('id', c.req.param('id')).maybeSingle());
    if (!row) return c.json({ error: 'Factura no encontrada' }, 404);
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
    const invoice = { ...row, fields: row.fields as InvoiceFields };
    return c.json({
      invoice: row,
      headline: row[`headline_${lang}`],
      decisions,
      beneficiary: findBeneficiary(row.fields?.payee_name ?? null, directory),
      // R-49: each line names the rate of the stored decision's policy version, never the current one.
      explanations: (latest?.checks ?? []).map((ch) => explainCheck(ch, lang, row.received_at, latest?.policy_version)),
      fixes: whatWouldPay({ checks: latest?.checks ?? [] }, lang),
      policy,
      trace: agentTrace({ invoice, decisions, isDemo: company.is_demo, notification }, lang),
      question: latest?.outcome === 'ESCALAR' ? latest[`question_${lang}`] : null,
      file_url: fileUrl,
    });
  });
