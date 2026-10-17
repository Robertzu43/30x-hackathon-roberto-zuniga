// The member route chain (AC-38, AC-43), "when did the agent last run" (AC-63) and the activity panel's replay (AC-78).
import { Hono } from 'hono';
import type { LecturaCheck } from '../agent/record';
import { recordedFields, type StoredDecision } from '../agent/trace';
import type { InvoiceFields } from '../engine/types';
import { format, t, type Lang } from '../i18n';
import { en as activityEn, es as activityEs } from '../i18n/features/activity';
import { requireUser, type AppEnv } from '../lib/auth';
import type { ReadFields } from '../lib/llm';
import { must } from '../lib/supabase';

// Every member route: a verified JWT and the user's own company (requireUser), then at most 60 POSTs a minute per user
// (AC-43, R-72): the database counter rate_limit_hit, keyed on the JWT's auth.uid(), one counted subrequest (R-56). The
// Workers ratelimit binding refused nothing live, so it is gone. A failing counter lets the request through, logged.
export const memberRoutes = () => new Hono<AppEnv>().use('*', requireUser, async (c, next) => {
  if (c.req.method === 'POST') {
    const r = await c.var.db.rpc('rate_limit_hit').then((x) => x, (e: unknown) => ({ data: null, error: e }));
    if (r.error) console.error('rate limit: counter failed, request allowed', r.error);
    else if (r.data === false) return c.json({ error: 'Demasiadas solicitudes, intenta en un minuto' }, 429);
  }
  await next();
});

type Run = { created_at: string; trigger: string; via: 'portal' | 'email' | null } | null;

// Newest run of the member's company or cron tick (company null). Both filters are explicit on top of RLS: never
// another company's run (AC-63).
export const agent = memberRoutes().get('/last-run', async (c) => {
  const runs = () => c.var.db.from('agent_runs').select('created_at, trigger, via');
  const newest = await Promise.all([runs().eq('company_id', c.var.companyId), runs().is('company_id', null)]
    .map(async (q): Promise<Run> => must(await q.order('created_at', { ascending: false }).limit(1).maybeSingle())));
  const run = newest.filter((r) => r !== null).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  return c.json(run ? { at: run.created_at, trigger: run.trigger, via: run.via ?? null } : null);
})

  // AC-78, R-89: the newest 10 invoices whose latest decision is the agent's, replayed from that stored decision (R-29),
  // never a model. One query (requireUser's two plus this = 3 subrequests). `since` keeps decisions at or after it; the
  // panel drops what it already played.
  .get('/activity', async (c) => {
    const since = c.req.query('since');
    if (since !== undefined && Number.isNaN(Date.parse(since))) return c.json({ error: 'Fecha no válida' }, 400);
    let q = c.var.db.from('invoice_current').select('id, fields, seq, decided_at, decisions(checks, outcome, actor, created_at)')
      .eq('company_id', c.var.companyId).eq('actor', 'agent')
      .order('seq', { referencedTable: 'decisions', ascending: false }).limit(1, { referencedTable: 'decisions' });
    if (since !== undefined) q = q.gte('decided_at', new Date(since).toISOString());
    const rows: Activity[] = must(await q.order('decided_at', { ascending: false }).limit(10));
    return c.json({ items: rows.flatMap((r) => r.decisions.map((d) => replay(r, d, c.var.lang))) });
  });

type Decided = Pick<StoredDecision, 'checks' | 'outcome' | 'actor' | 'created_at'>;
type Activity = { id: string; fields: ReadFields | null; seq: number; decisions: Decided[] };
const words = { es: activityEs, en: activityEn };

// "Leyendo … con IA" only when a model read it in that run: the run's own read (on the Lectura check, R-97), or the
// ingest read right before the invoice's first decision (fields.read_by). Payee as recorded (R-29).
function replay(r: Activity, d: Decided, lang: Lang) {
  const lectura = d.checks.find((x) => x.id === 'lectura') as LecturaCheck | undefined;
  const read_by_ai = typeof lectura?.read_by?.provider === 'string' || (r.seq === 1 && typeof r.fields?.read_by?.provider === 'string');
  const payee = recordedFields(r.fields as InvoiceFields | null, d.checks)?.payee_name ?? t(lang, 'value.unknown_payee');
  const w = (key: string, vars?: Record<string, string | number>) => format(words[lang], `activity.step.${key}`, vars);
  return {
    invoice_id: r.id, payee, outcome: d.outcome, decided_at: d.created_at, actor: d.actor, read_by_ai,
    steps: [
      { stage: 'lee', text: w(read_by_ai ? 'read_ai' : 'read_stored', { payee }) },
      { stage: 'consulta', text: w('directory') },
      { stage: 'consulta', text: w('rules', { n: d.checks.length }) },
      { stage: 'decide', text: w('decided', { outcome: t(lang, `outcome.${d.outcome}`) }) },
    ],
  };
}
