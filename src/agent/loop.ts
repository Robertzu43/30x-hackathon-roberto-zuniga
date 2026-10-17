// The agent (D22, AC-61): per invoice, in arrival order, the stages percibe -> lee -> consulta -> decide -> actua, then
// rindeCuentas once per run. No model picks a tool, the order or an outcome: the only model call is the reader at `lee`.
// Every path that decides an invoice calls runAgent: ingest, "Ejecutar agente", login, "Reevaluar", "Reiniciar demo", cron.
import { z } from 'zod';
import { headline } from '../engine/explain';
import type { Decision, Invoice, InvoiceFields, Outcome } from '../engine/types';
import type { Env } from '../env';
import { escalationEmail, sendEmail } from '../lib/email';
import { documentToText, extractFields } from '../lib/llm';
import { must, type Budget, type Db } from '../lib/supabase';
import { hashToken, signToken, TOKEN_TTL_MS } from '../lib/tokens';
import { escalationQuestion } from './question';
import { recorder, type Counts, type DecisionInput, type Recorder, type Trigger } from './record';
import type { StoredDecision } from './trace';
import { decide, directorio, duplicados, findBeneficiary, periodo, politica } from './tools';

// db reads under the caller's authority: the user's JWT client (RLS) in a request, the service-role client in the cron.
// budget is the invocation's one subrequest counter (R-56): db and the recorder's client count through it.
export interface AgentDeps { db: Db; env: Env; budget: Budget }
export type RunResult = Counts & { errors: number; remaining: number; cursor: string | null };
type Row = Omit<Invoice, 'fields'> & { fields: InvoiceFields | null; raw_text: string | null; seq: number | null; outcome: Outcome | null };

const RETRIES = 3; // STALE_PERIOD = another decision changed the month's committed amount meanwhile (AC-24)
// Counted subrequests (R-56). An attempt: period state, duplicates, the ownership re-read and insert_decision. A new
// escalation's mail: the token pair's ownership re-read, its insert and the email. The reader: one Workers AI call. A run:
// invoices, company, directory and policy, then its run row.
const ATTEMPT = 4, MAIL = 3, READ = 1, RUN_ROW = 1;
// The worst case for a run to decide one invoice; the cron starts a company only if this fits.
export const FIRST_INVOICE = 4 + READ + ATTEMPT + MAIL + RUN_ROW;
const TOO_MANY = /too many subrequests/i; // the Workers limit itself, should anything uncounted push past the budget

// The cursor (R-56): (received_at in microseconds, id) of the last invoice a call attempted. Opaque to clients.
export type Cursor = [number, string];
const CursorJson = z.tuple([z.number().int().nonnegative(), z.string()]);
export const decodeCursor = (s: string): Cursor | null => { try { return CursorJson.parse(JSON.parse(atob(s))); } catch { return null; } };
const encodeCursor = (c: Cursor) => btoa(JSON.stringify(c));
// Postgres keeps microseconds and Date.parse milliseconds, so the 4th to 6th fraction digits are added back.
const keyOf = (r: { received_at: string; id: string }): Cursor =>
  [Date.parse(r.received_at) * 1000 + Number((/\.\d{3}(\d{1,3})/.exec(r.received_at)?.[1] ?? '').padEnd(3, '0')), r.id];
const isAfter = (a: Cursor, b: Cursor) => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);

// Each stage is logged, so `wrangler tail` shows the agent working on its own.
const stage = (name: string, invoiceId = '') => console.log(`agent ${name}`, invoiceId);
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Decides the target invoices after `from`, oldest first, as many as the budget fits (AC-70). Throws only before the
// first invoice (nothing changed); after that it always answers what it did (R-57).
export async function runAgent(deps: AgentDeps, companyId: string, invoiceIds: string[] | 'pending', trigger: Trigger, from: Cursor | null = null): Promise<RunResult> {
  const { db, env, budget } = deps;
  const record = recorder(env, companyId, budget);
  // Only "Reevaluar" re-decides an ESCALAR (R-24); PAGAR and FRENAR are final (D16).
  const open = (r: Row) => r.outcome === null || (r.outcome === 'ESCALAR' && trigger === 'reevaluate');
  const q = db.from('invoice_current').select('*').eq('company_id', companyId);
  const all: Row[] = must(await (invoiceIds !== 'pending' ? q.in('id', invoiceIds) : trigger === 'reevaluate' ? q : q.is('outcome', null))
    .order('received_at').order('id'));
  const rows = all.filter((r) => open(r) && (!from || isAfter(keyOf(r), from)));
  const company: { approver_email: string | null; is_demo: boolean } =
    must(await db.from('companies').select('approver_email, is_demo').eq('id', companyId).single());
  const [directory, policy] = await Promise.all([directorio(db, companyId), politica(db, companyId)]);
  const rules = policy?.rules ?? null;
  const counts: Counts = { PAGAR: 0, FRENAR: 0, ESCALAR: 0 };
  let errors = 0;
  let pos: Cursor = from ?? [0, ''];
  let attempted = 0;

  invoices: for (const row of rows) {
    // R-15, R-16: mail only a new escalation (the previous latest decision was not ESCALAR) of a non-demo company.
    const mailable = row.outcome !== 'ESCALAR' && !company.is_demo;
    // R-56: write only if the attempt, its mail when due and the run row all fit; otherwise the invoice stays untouched.
    const fits = ATTEMPT + (mailable ? MAIL : 0) + RUN_ROW;
    if (budget.left() < (row.fields ? 0 : READ) + fits) break;
    try {
      stage('percibe', row.id);
      stage('lee', row.id);
      if (!row.fields) budget.count(READ);
      // ponytail: reads raw_text only; a stored file without fields is decided as illegible (ingest reads files first).
      const fields = row.fields ?? await extractFields(env, await documentToText(env, { kind: 'text', text: row.raw_text ?? '' }));
      const invoice: Invoice = { id: row.id, received_at: row.received_at, source: row.source, fields };
      const beneficiary = findBeneficiary(fields.payee_name, directory);
      for (let attempt = 0; ; attempt++) {
        if (attempt > 0 && budget.left() < fits) break invoices; // a STALE_PERIOD retry only as a whole attempt
        stage('consulta', row.id);
        const period = { ...await periodo(db, companyId, invoice), previous: await duplicados(db, companyId, invoice, rules, directory) };
        stage('decide', row.id);
        const d = decide(invoice, beneficiary, rules, period, new Date().toISOString());
        stage('actua', row.id);
        const question = (lang: 'es' | 'en') => escalationQuestion({ approverEmail: company.approver_email ?? '', invoice, decision: d }, lang);
        const esc = d.outcome === 'ESCALAR';
        const input: DecisionInput = {
          outcome: d.outcome, actor: 'agent', checks: d.checks, amount_usd: d.amount_usd, payment: d.payment, policy_version: policy?.version ?? null,
          headline_es: headline(d, invoice, beneficiary, 'es'), headline_en: headline(d, invoice, beneficiary, 'en'),
          question_es: esc ? question('es') : null, question_en: esc ? question('en') : null,
        };
        let stored: StoredDecision;
        try {
          stored = await record.decision(row.id, period.committed_usd, input, row.seq ?? 0);
        } catch (e) {
          // R-25: someone else decided it first; R-69: a member archived it meanwhile. Either way: no tokens, no mail.
          if (['ALREADY_DECIDED', 'ARCHIVED'].includes(messageOf(e))) break;
          if (messageOf(e) !== 'STALE_PERIOD' || attempt === RETRIES) throw e;
          continue;
        }
        counts[d.outcome]++;
        if (esc && mailable) await notify(env, budget, record, company.approver_email, invoice, d, stored, input.question_es!);
        break;
      }
    } catch (e) {
      if (TOO_MANY.test(messageOf(e))) { console.error('agent: subrequest limit reached', row.id); break; } // R-57: stop, report what was done
      errors++;
      console.error('agent: invoice not decided', row.id, messageOf(e));
    }
    pos = keyOf(row);
    attempted++;
  }
  stage('rindeCuentas');
  try {
    await record.run(trigger, counts, errors);
  } catch (e) {
    console.error('agent: run not recorded', companyId, messageOf(e)); // the decisions above are real and still reported (R-57)
  }
  const remaining = rows.length - attempted;
  return { ...counts, errors, remaining, cursor: remaining ? encodeCursor(pos) : null };
}

// One approve/reject pair sharing the escalation's decision_id, one Spanish mail to the approver, then the pair's hashes
// with the send result (R-29). Never throws: a failed send is recorded and never changes the decision (AC-39).
async function notify(env: Env, budget: Budget, record: Recorder, to: string | null, invoice: Invoice, d: Decision, stored: StoredDecision, question: string) {
  try {
    if (!to || !env.APP_URL) throw new Error('no approver_email or APP_URL');
    const exp = Date.now() + TOKEN_TTL_MS;
    const [approve, reject] = await Promise.all((['approve', 'reject'] as const).map((action) =>
      signToken(env.APPROVAL_HMAC_SECRET, { invoice_id: invoice.id, decision_id: stored.id, action, exp })));
    const link = (token: string) => `${env.APP_URL}/approve/${token}`;
    const mail = escalationEmail({ lang: 'es', question, invoice, decision: d, approveUrl: link(approve!), rejectUrl: link(reject!) });
    budget.count(); // the email: one outbound fetch outside the Supabase clients
    const { sent } = await sendEmail(env, { to, ...mail });
    await record.tokens(await Promise.all([approve!, reject!].map(async (token) => ({
      token_hash: await hashToken(token), invoice_id: invoice.id, decision_id: stored.id, expires_at: new Date(exp).toISOString(), email_sent: sent, sent_to: to,
    }))));
  } catch (e) {
    console.error('agent: escalation not notified', invoice.id, messageOf(e));
  }
}
