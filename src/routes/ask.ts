// «Pregúntale a Thesaurus» (AC-67, R-87): one question about the record, answered through src/lib/llm.ts from the context
// built here and nothing else. Read-only: the record is read with the user's JWT, the only write is the quota through
// record.ts (AC-38), no answer is ever an action and no conversation is stored. A non-answer is a 200 with a reason.
import type { Context } from 'hono';
import { z } from 'zod';
import { takeQuestion, type Quota } from '../agent/record';
import type { Lang } from '../i18n';
import { en, es } from '../i18n/features/ask';
import type { AppEnv } from '../lib/auth';
import { answerQuestion } from '../lib/llm';
import { isUuid, must } from '../lib/supabase';
import { memberRoutes } from './agent';
import { invoiceDetail, READ } from './invoices';
import { period } from './period';

const Body = z.object({ question: z.string().trim().min(1).max(500), lang: z.enum(['es', 'en']), invoice_id: z.string().optional() });
const TEXT = { es, en };

// One record: its read fields, the check sentences, "Lo que hice", the stored question and the timeline. null = not the company's.
async function recordContext(c: Context<AppEnv>, id: string, lang: Lang): Promise<string | null> {
  const d = isUuid(id) ? await invoiceDetail(c.var, id, lang) : null;
  return d && JSON.stringify({
    read_fields: Object.fromEntries(READ.map((k) => [k, d.invoice.fields?.[k] ?? null])),
    status: d.headline ?? 'pending',
    checks: d.explanations,
    what_i_did: d.trace.map((s) => s.text),
    pending_question: d.question,
    timeline: d.decisions.map((x) => ({ seq: x.seq, at: x.created_at, outcome: x.outcome, actor: x.actor, by: x.actor_email, channel: x.channel,
      note: x.note, headline: x[`headline_${lang}`] })),
  });
}

// Bandeja: AC-44's period figures, exactly as Periodo shows them, and each non-archived invoice's outcome and headline.
// ponytail: Periodo is asked in-process (its auth runs again: 2 subrequests); export its computation if the budget gets tight.
async function inboxContext(c: Context<AppEnv>, lang: Lang): Promise<string> {
  const [figures, rows] = await Promise.all([
    Promise.resolve(period.request('/', { headers: { Authorization: c.req.header('Authorization') ?? '' } }, c.env))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`period ${r.status}`)))),
    c.var.db.from('invoice_current').select('outcome, headline_es, headline_en').eq('company_id', c.var.companyId)
      .order('received_at', { ascending: false }).then(must) as Promise<Array<{ outcome: string | null; headline_es: string | null; headline_en: string | null }>>,
  ]);
  return JSON.stringify({ period: figures, invoices: rows.map((r) => ({ outcome: r.outcome ?? 'pending', headline: r[`headline_${lang}`] })) });
}

export const ask = memberRoutes().post('/', async (c) => {
  const body = Body.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: es['ask.bad_question'] }, 400);
  const { question, lang, invoice_id: id } = body.data;
  const context = id === undefined ? await inboxContext(c, lang) : await recordContext(c, id, lang);
  if (context === null) return c.json({ error: 'Factura no encontrada' }, 404);
  const no = (reason: 'user_cap' | 'ai_quota' | 'failed') => c.json({ answer: null, reason, message: TEXT[lang][`ask.reason.${reason}`] });
  // R-87: the shared demo user is one person per client IP, so the first judge never spends every later judge's questions.
  const { id: userId, email } = c.var.user;
  const demo = !!email && email.toLowerCase() === c.env.DEMO_EMAIL?.toLowerCase();
  let quota: Quota;
  try {
    quota = await takeQuestion(c.env, `u:${userId}${demo ? `:${c.req.header('CF-Connecting-IP') ?? 'sin-ip'}` : ''}`, c.var.budget);
  } catch (e) {
    console.error('ask: quota not taken', e instanceof Error ? e.message : e);
    return no('failed'); // no count, no model call
  }
  if ('reason' in quota) return no(quota.reason);
  const r = await answerQuestion(c.env, context, question, lang);
  return 'answer' in r ? c.json({ answer: r.answer, provider: r.provider, remaining: quota.remaining }) : no(r.reason);
});
