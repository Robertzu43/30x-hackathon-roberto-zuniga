// The public intake (D34, AC-83..AC-85, AC-38 Amended): a vendor with no account sends an invoice to the company resolved
// from a public slug. No user JWT exists, so it uses the service-role client and writes only the invoice (origin
// 'portal'), its file under <company_id>/, its status token hash and the intake counters; every query after the slug
// lookup names that company. The decision is runAgent's, written by record.ts, like the cron. Replies and the status page
// are templates filled with recorded values (R-90.10): no model writes vendor-facing text.
import { validFields } from '../engine/checks';
import { money } from '../engine/explain';
import type { Check, InvoiceFields, Outcome } from '../engine/types';
import type { Env } from '../env';
import { format, type Lang } from '../i18n';
import { en, es } from '../i18n/features/portal';
import { adminClient } from '../lib/admin';
import { documentToText, extractFields } from '../lib/llm';
import { must, type Budget, type Db } from '../lib/supabase';
import { hashToken } from '../lib/tokens';
import { runAgent } from './loop';
import { recordedFields } from './trace';

export interface IntakeInput { slug: string; text?: string; file?: { bytes: ArrayBuffer }; ip: string }
export type Bilingual<T> = Record<Lang, T>;
export type IntakeResult = { ok: true; reply: Bilingual<string[]>; status_path: string }
  | { ok: false; error: 'not_found' | 'file' | 'text' | 'rate_ip' | 'rate_company' | 'failed' };
export type StatusResult = { ok: true; company: string; status: Bilingual<string>; read: Bilingual<string[]>; updated_at: string }
  | { ok: false; error: 'invalid' | 'rate_status' };

const MAX_BYTES = 10 * 1024 * 1024; // AC-15, R-11
const MAX_TEXT = 20000;
const MAX_NOTE = 2000; // R-90.5
// The file's first bytes decide its type, never its name or declared MIME type (R-11, as src/routes/invoices.ts).
const FILES = [
  { magic: '%PDF', source: 'pdf', ext: 'pdf', type: 'application/pdf' },
  { magic: '\x89PNG', source: 'image', ext: 'png', type: 'image/png' },
  { magic: '\xff\xd8\xff', source: 'image', ext: 'jpg', type: 'image/jpeg' },
] as const;
const SLUG = /^[a-z0-9][a-z0-9-]{2,39}$/; // companies.portal_slug's check
const TOKEN = /^[A-Za-z0-9_-]{43}$/; // 32 bytes in base64url

const dict = { es, en };
const say = (lang: Lang, key: string, vars: Record<string, string> = {}) => format(dict[lang], key, vars);
const both = <T>(f: (lang: Lang) => T): Bilingual<T> => ({ es: f('es'), en: f('en') });
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

type Company = { id: string; name: string | null };
const companyBySlug = async (db: Db, slug: unknown): Promise<Company | null> =>
  typeof slug === 'string' && SLUG.test(slug) ? must(await db.from('companies').select('id, name').eq('portal_slug', slug).maybeSingle()) : null;

export async function portalCompany(env: Env, budget: Budget, slug: string): Promise<{ name: string } | null> {
  const c = await companyBySlug(adminClient(env, budget), slug);
  return c && { name: c.name ?? '' };
}

// What was read (beneficiario, monto y moneda, número), as the engine trusted it (R-71); «no pude leerlo» when unknown.
function readLines(fields: InvoiceFields, lang: Lang): string[] {
  const f = validFields(fields);
  const v = (x: string | null) => x ?? say(lang, 'portal.reply.unknown');
  return [
    say(lang, 'portal.reply.payee', { value: v(f.payee_name) }),
    say(lang, 'portal.reply.amount', { value: v(f.amount === null ? null : `${money(f.amount, lang)} ${f.currency ?? ''}`.trim()) }),
    say(lang, 'portal.reply.number', { value: v(f.invoice_number) }),
  ];
}

// AC-84: the latest decision in fixed words. The only reason ever named is «duplicada» (R-90.3).
type Latest = { outcome: Outcome; actor: 'agent' | 'human'; checks: Check[]; created_at: string } | null;
function statusKey(d: Latest): string {
  if (!d) return 'review';
  if (d.outcome === 'PAGAR') return 'approved';
  if (d.outcome === 'ESCALAR') return 'needs_approval';
  if (d.actor === 'human') return 'rejected';
  return d.checks.some((c) => c.id === 'duplicado_exacto' && c.verdict === 'no_cumple') ? 'duplicate' : 'terms';
}
const statusText = (d: Latest, company: string) => both((lang) => say(lang, `portal.status.${statusKey(d)}`, { company }));

const latestDecision = async (db: Db, companyId: string, invoiceId: string): Promise<Latest> =>
  must(await db.from('decisions').select('outcome, actor, checks, created_at').eq('company_id', companyId).eq('invoice_id', invoiceId)
    .order('seq', { ascending: false }).limit(1).maybeSingle());

export async function intake(env: Env, budget: Budget, input: IntakeInput): Promise<IntakeResult> {
  const text = typeof input.text === 'string' ? input.text : '';
  const bytes = input.file?.bytes;
  const kind = bytes instanceof ArrayBuffer && bytes.byteLength && bytes.byteLength <= MAX_BYTES
    ? FILES.find((f) => String.fromCharCode(...new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength))).startsWith(f.magic)) : undefined;
  if (input.file && !kind) return { ok: false, error: 'file' };
  if (text.length > MAX_TEXT || (!kind && !text.trim())) return { ok: false, error: 'text' };

  const db = adminClient(env, budget);
  const company = await companyBySlug(db, input.slug);
  if (!company) return { ok: false, error: 'not_found' };
  const limited: 'ip' | 'company' | null = must(await db.rpc('intake_hit', { p_kind: 'invoice', p_ip: input.ip, p_company: company.id }));
  if (limited) return { ok: false, error: limited === 'ip' ? 'rate_ip' : 'rate_company' };

  const id = crypto.randomUUID();
  let doc: string | null = text;
  let filePath: string | null = null;
  if (kind) {
    filePath = `${company.id}/${id}.${kind.ext}`;
    must(await db.storage.from('files').upload(filePath, bytes!, { contentType: kind.type }));
    if (kind.source === 'image') budget.count(); // the vision call (R-56)
    doc = await documentToText(env, { kind: kind.source, bytes: bytes! });
  }
  budget.count(); // the reader (R-56)
  const fields = await extractFields(env, doc); // the vendor's note is never read (R-90.5)
  must(await db.from('invoices').insert({
    id, company_id: company.id, source: kind?.source ?? 'chat', origin: 'portal', file_path: filePath, raw_text: doc?.slice(0, MAX_TEXT) ?? null,
    fields, sender_note: kind && text.trim() ? text.slice(0, MAX_NOTE) : null,
  }));
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  must(await db.from('portal_status_tokens').insert({ token_hash: await hashToken(token), company_id: company.id, invoice_id: id }));
  // If the agent cannot run, the invoice stays pending and the cron decides it (R-60); the reply then says «en revisión».
  await runAgent({ db, env, budget }, company.id, [id], 'ingest', null, 'portal')
    .catch((e) => console.error('portal: intake not decided', id, e instanceof Error ? e.message : e));
  const name = company.name ?? '';
  const status = statusText(await latestDecision(db, company.id, id), name);
  const unread = fields.read_error === 'lector_no_disponible';
  return {
    ok: true,
    reply: both((lang) => [
      ...(unread ? [say(lang, 'portal.reply.unread', { company: name })] : [say(lang, 'portal.reply.read'), ...readLines(fields, lang)]),
      say(lang, 'portal.reply.status', { status: status[lang].replace(/^(rechazada|rejected): (.*)$/, '$1 ($2)') }), // «Estado: rechazada (duplicada)»: one colon
    ]),
    status_path: `/estado/${token}`,
  };
}

// The status link (AC-84): only the company name, what was read, the status words and the time of the last change.
export async function portalStatus(env: Env, budget: Budget, token: string, ip: string): Promise<StatusResult> {
  if (typeof token !== 'string' || !TOKEN.test(token)) return { ok: false, error: 'invalid' };
  const db = adminClient(env, budget);
  if (must(await db.rpc('intake_hit', { p_kind: 'status', p_ip: ip, p_company: null }))) return { ok: false, error: 'rate_status' };
  const t: { company_id: string; invoice_id: string } | null =
    must(await db.from('portal_status_tokens').select('company_id, invoice_id').eq('token_hash', await hashToken(token)).maybeSingle());
  if (!t) return { ok: false, error: 'invalid' };
  const [invoice, latest, company]: [{ fields: InvoiceFields | null; received_at: string }, Latest, Company] = await Promise.all([
    db.from('invoices').select('fields, received_at').eq('company_id', t.company_id).eq('id', t.invoice_id).single().then(must),
    latestDecision(db, t.company_id, t.invoice_id),
    db.from('companies').select('id, name').eq('id', t.company_id).single().then(must),
  ]);
  const fields = recordedFields(invoice.fields, latest?.checks);
  const name = company.name ?? '';
  return {
    ok: true, company: name, status: statusText(latest, name),
    read: both((lang) => readLines(fields ?? UNKNOWN, lang)), // pending and never read: every field unknown
    updated_at: latest?.created_at ?? invoice.received_at,
  };
}

const UNKNOWN: InvoiceFields = { payee_name: null, amount: null, currency: null, invoice_number: null, issue_date: null, due_date: null,
  concept: null, bank_account: null, confidence: {} };
