// The agent: per invoice, in arrival order, percibe -> lee -> consulta -> decide -> actua, then
// rindeCuentas once per run. Every path that decides an invoice calls runAgent: ingest, "Ejecutar agente",
// login, "Reevaluar", "Reiniciar demo", cron.
//
// Safety invariants:
// - No model picks a tool, the order or an outcome. The only model call on this path is the reader at `lee`
//   (`extractFields` in src/lib/llm.ts). The outcome written here is always `decide()`'s return value.
// - PAGAR and FRENAR are final: only trigger 'reevaluate' re-decides an ESCALAR. A failed mail never
//   changes the decision (`notify` catches and returns).
// - The company lock lives in insert_decision (pg_advisory_xact_lock on the company id). A STALE_PERIOD
//   retry re-reads the month before writing, so two invoices cannot both commit the same budget.
// - A write starts only when the whole attempt fits the subrequest budget. Otherwise the invoice stays untouched.
import { z } from 'zod';
import { validFields } from '../engine/checks';
import { headline } from '../engine/explain';
import type { Check, Decision, Invoice, InvoiceFields, MarketRates, Outcome } from '../engine/types';
import type { Env } from '../env';
import { escalationEmail, sendEmail } from '../lib/email';
import { fetchChain, providers } from '../lib/fx';
import { documentToText, extractFields } from '../lib/llm';
import { must, type Budget, type Db } from '../lib/supabase';
import { hashToken, signToken, TOKEN_TTL_MS } from '../lib/tokens';
import { escalationQuestion } from './question';
import { recorder, type Counts, type DecisionInput, type LecturaCheck, type Recorder, type Trigger, type Via } from './record';
import { recordedFields, type StoredDecision } from './trace';
import { decide, directorio, duplicados, findBeneficiary, periodo, politica, tasas } from './tools';

// db reads under the caller's authority: the user's JWT client (RLS) in a request, the service-role client in the cron.
// budget is the invocation's one subrequest counter (R-56): db and the recorder's client count through it.
export interface AgentDeps { db: Db; env: Env; budget: Budget }
export type RunResult = Counts & { errors: number; remaining: number; cursor: string | null };
type Row = Omit<Invoice, 'fields'> & { fields: InvoiceFields | null; raw_text: string | null; seq: number | null; outcome: Outcome | null;
  decisions?: Array<{ checks: Check[] }> };

const RETRIES = 3; // STALE_PERIOD = another decision changed the month's committed amount meanwhile (AC-24)
// Counted subrequests (R-56). An attempt: period state, duplicates, the ownership re-read and insert_decision. A new
// escalation's mail: the token pair's ownership re-read, its insert and the email. The reader: one Workers AI call. A run:
// invoices, company, directory and policy, then its run row. Market rates (AC-73), only for a currency that needs them:
// the stored rates once per call, and a fetch of at most one call per provider of the chain plus the upsert.
const ATTEMPT = 4, MAIL = 3, READ = 1, RATES = 1, FX = 3, RUN_ROW = 1;
// The worst case for a run to decide one invoice; the cron starts a company only if this fits.
export const FIRST_INVOICE = 4 + READ + RATES + FX + ATTEMPT + MAIL + RUN_ROW;
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
// first invoice (nothing changed); after that it always answers what it did (R-57). `via`: the public channel of an
// intake run, written on its run row (AC-63 Clarified).
export async function runAgent(deps: AgentDeps, companyId: string, invoiceIds: string[] | 'pending', trigger: Trigger, from: Cursor | null = null, via?: Via): Promise<RunResult> {
  const { db, env, budget } = deps;
  const record = recorder(env, companyId, budget);
  // Only "Reevaluar" re-decides an ESCALAR (R-24); PAGAR and FRENAR are final (D16).
  const open = (r: Row) => r.outcome === null || (r.outcome === 'ESCALAR' && trigger === 'reevaluate');
  // Each row with its latest decision's checks embedded (R-77), in the same request.
  const q = db.from('invoice_current').select('*, decisions(checks)').eq('company_id', companyId)
    .order('seq', { referencedTable: 'decisions', ascending: false }).limit(1, { referencedTable: 'decisions' });
  const all: Row[] = must(await (invoiceIds !== 'pending' ? q.in('id', invoiceIds) : trigger === 'reevaluate' ? q : q.is('outcome', null))
    .order('received_at').order('id'));
  const rows = all.filter((r) => open(r) && (!from || isAfter(keyOf(r), from)));
  const company: { approver_email: string | null; is_demo: boolean; is_trial: boolean } =
    must(await db.from('companies').select('approver_email, is_demo, is_trial').eq('id', companyId).single());
  const [directory, policy] = await Promise.all([directorio(db, companyId), politica(db, companyId)]);
  const rules = policy?.rules ?? null;
  // AC-73, AC-74: a currency that is not USD and not pinned is decided on the stored market rates, read once per call.
  // If its newest stored rate is not from today (UTC) it is fetched first, once per invocation (budget.fxTried); "Reevaluar" never fetches (R-85.6).
  let market: MarketRates | null = null;
  const today = new Date().toISOString().slice(0, 10);
  const needsMarket = (c: string | null): c is string => !!c && c !== 'USD' && !(Number(rules?.fx_rates?.[c]) > 0);
  const fxCost = (c: string | null) => !needsMarket(c) ? 0 : (market ? 0 : RATES) + (trigger === 'reevaluate' || budget.fxTried.has(c) ? 0 : FX);
  const counts: Counts = { PAGAR: 0, FRENAR: 0, ESCALAR: 0 };
  let errors = 0;
  let pos: Cursor = from ?? [0, ''];
  let attempted = 0;

  invoices: for (const row of rows) {
    // R-15, R-16, R-115: mail only a new escalation (the previous latest decision was not ESCALAR) of a company that is
    // neither the demo nor a trial.
    const mailable = row.outcome !== 'ESCALAR' && !company.is_demo && !company.is_trial;
    // R-56: write only if the attempt, its mail when due and the run row all fit; otherwise the invoice stays untouched.
    const fits = ATTEMPT + (mailable ? MAIL : 0) + RUN_ROW;
    // R-77: stored fields, else those its latest decision recorded; only a never-read, never-decided invoice calls the reader.
    const known = recordedFields(row.fields, row.decisions?.[0]?.checks);
    if (budget.left() < (known ? fxCost(validFields(known).currency) : READ) + fits) break;
    try {
      stage('percibe', row.id);
      stage('lee', row.id);
      if (!known) budget.count(READ);
      // ponytail: reads raw_text only; a stored file without fields is decided as illegible (ingest reads files first).
      const read = known ? null : await extractFields(env, await documentToText(env, { kind: 'text', text: row.raw_text ?? '' }));
      const fields = known ?? read!;
      const invoice: Invoice = { id: row.id, received_at: row.received_at, source: row.source, fields };
      const beneficiary = findBeneficiary(fields.payee_name, directory);
      const currency = validFields(fields).currency;
      // A just-read currency whose rates do not fit: the read is spent, the invoice stays untouched for the next call (R-56).
      if (!known && budget.left() < fxCost(currency) + fits) break;
      if (needsMarket(currency)) {
        market ??= await tasas(db);
        if (trigger !== 'reevaluate' && !budget.fxTried.has(currency) && (market[currency] ? new Date(market[currency].fetched_at).toISOString().slice(0, 10) : null) !== today) {
          budget.fxTried.add(currency);
          const stored = market[currency];
          const rows = await fetchChain(providers(env.FX_PROVIDER, budget.fetch), [currency], stored ? { [currency]: stored.usd_per_unit } : {});
          await record.fxRates(rows);
          for (const r of rows) market[r.currency] = r;
        }
      }
      for (let attempt = 0; ; attempt++) {
        if (attempt > 0 && budget.left() < fits) break invoices; // a STALE_PERIOD retry only as a whole attempt
        stage('consulta', row.id);
        const period = { ...await periodo(db, companyId, invoice), previous: await duplicados(db, companyId, invoice, rules, directory) };
        stage('decide', row.id);
        const d = decide(invoice, beneficiary, rules, period, new Date().toISOString(), market ?? {});
        stage('actua', row.id);
        const question = (lang: 'es' | 'en') => escalationQuestion({ approverEmail: company.approver_email ?? '', invoice, decision: d }, lang);
        const esc = d.outcome === 'ESCALAR';
        const input: DecisionInput = {
          outcome: d.outcome, actor: 'agent', amount_usd: d.amount_usd, payment: d.payment, policy_version: policy?.version ?? null,
          headline_es: headline(d, invoice, beneficiary, 'es'), headline_en: headline(d, invoice, beneficiary, 'en'),
          question_es: esc ? question('es') : null, question_en: esc ? question('en') : null,
          // R-97: this run's read, recorded where the API finds it (LecturaCheck)
          checks: read?.read_by ? d.checks.map((c): LecturaCheck => (c.id === 'lectura' ? { ...c, read_by: read.read_by, confidence: read.confidence } : c)) : d.checks,
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
    await record.run(trigger, counts, errors, via);
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
