// «Pregúntale a Thesaurus» (AC-67, R-87): one question about the record, answered through src/lib/llm.ts from the context
// built here and nothing else. Read-only: the record is read with the user's JWT, the only write is the quota through
// record.ts (AC-38), no answer is ever an action and no conversation is stored. A non-answer is a 200 with a reason.
import type { Context } from 'hono';
import { z } from 'zod';
import { takeQuestion, type Quota } from '../agent/record';
import type { Outcome } from '../engine/types';
import { format, t, type Lang } from '../i18n';
import { en, es } from '../i18n/features/ask';
import * as periodText from '../i18n/features/period';
import type { AppEnv } from '../lib/auth';
import { answerQuestion } from '../lib/llm';
import { isUuid, must } from '../lib/supabase';
import { memberRoutes } from './agent';
import { invoiceDetail, READ } from './invoices';
import { period } from './period';

// R-98: no (or an unknown) lang falls back to the stored language, then Spanish; the 400 is for a bad question only.
const Body = z.object({ question: z.string().trim().min(1).max(500), lang: z.enum(['es', 'en']).optional().catch(undefined), invoice_id: z.string().optional() });
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

type Usd = 'budget' | 'committed' | 'available' | 'paid' | 'balance';
type Figures = Record<`${Usd}_usd`, number | null> & {
  month: string; count_by_outcome: Record<Outcome, number>; autonomy: { n: number; m: number }; autonomy_pct: number | null;
  violations: number; explained_pct: number; by_beneficiary: Array<{ beneficiary: string | null; paid_usd: number; committed_usd: number; count: number }>;
};
// QA (AC-67): the model quoted the Saldo as what is left of the budget. Each figure says what it is, as GET /api/period computes it.
const MEANING: Record<Lang, Record<Usd, string>> = {
  es: {
    budget: 'presupuesto del periodo', committed: 'lo pagado más lo escalado del mes',
    available: 'presupuesto del periodo menos lo comprometido: lo que queda del presupuesto', paid: 'lo pagado en el mes',
    balance: 'saldo de la cuenta según la política menos lo pagado; no es lo que queda del presupuesto',
  },
  en: {
    budget: 'the period budget', committed: 'what was paid plus what was escalated this month',
    available: 'the period budget minus what is committed: what is left of the budget', paid: 'what was paid this month',
    balance: "the policy's account balance minus what was paid; not what is left of the budget",
  },
};
const PENDING = { es: 'Pendiente: el agente aún no la decidió', en: 'Pending: the agent has not decided it yet' };

// Periodo's figures as "<label Periodo shows>: <value as Periodo prints it>", one per line (web/pages/Period.tsx).
function periodLines(p: Figures, lang: Lang): string[] {
  const l = (key: string, vars?: Record<string, string | number>) => format(periodText[lang], `period.${key}`, vars);
  const usd = (n: number | null) =>
    n === null ? '—' : new Intl.NumberFormat(lang === 'es' ? 'es-CO' : 'en-US', { style: 'currency', currency: 'USD', currencyDisplay: 'code' }).format(n);
  return [
    `${l('month')}: ${p.month}`,
    ...(['budget', 'committed', 'available', 'paid', 'balance'] as const).map((k) => `${l(k)}: ${usd(p[`${k}_usd`])} (${MEANING[lang][k]})`),
    `${l('outcomes')}: ${(['PAGAR', 'FRENAR', 'ESCALAR'] as const).map((o) => `${t(lang, `outcome.${o}`)} ${p.count_by_outcome[o]}`).join(', ')}`,
    `${l('autonomy', { v: p.autonomy_pct === null ? '—' : `${p.autonomy_pct}\u00a0%` })}: ${l('autonomy_of', p.autonomy)}`,
    l('violations', { n: p.violations }),
    l('explained', { pct: p.explained_pct }),
    `${l('beneficiaries')}:`,
    ...p.by_beneficiary.map((b) => `- ${b.beneficiary ?? l('unread')}: ${l('invoices')} ${b.count}; ${l('paid')} ${usd(b.paid_usd)}; ${l('committed')} ${usd(b.committed_usd)}`),
  ];
}

// Bandeja: AC-44's period figures, exactly as Periodo shows them, and each non-archived invoice's outcome and headline.
// ponytail: Periodo is asked in-process (its auth runs again: 2 subrequests); export its computation if the budget gets tight.
async function inboxContext(c: Context<AppEnv>, lang: Lang): Promise<string> {
  const [figures, rows] = await Promise.all([
    Promise.resolve(period.request('/', { headers: { Authorization: c.req.header('Authorization') ?? '' } }, c.env))
      .then((r) => (r.ok ? r.json() as Promise<Figures> : Promise.reject(new Error(`period ${r.status}`)))),
    c.var.db.from('invoice_current').select('outcome, headline_es, headline_en').eq('company_id', c.var.companyId)
      .order('received_at', { ascending: false }).then(must) as Promise<Array<{ outcome: string | null; headline_es: string | null; headline_en: string | null }>>,
  ]);
  return [...periodLines(figures, lang), `${periodText[lang]['period.invoices']}:`,
    ...rows.map((r) => `- ${r[`headline_${lang}`] ?? PENDING[lang]}`)].join('\n');
}

export const ask = memberRoutes().post('/', async (c) => {
  const body = Body.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: es['ask.bad_question'] }, 400);
  const { question, invoice_id: id } = body.data;
  const lang = body.data.lang ?? c.var.lang;
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
