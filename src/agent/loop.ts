// The agent (D22, AC-61): per invoice, in arrival order, the stages percibe -> lee -> consulta -> decide -> actua, then
// rindeCuentas once per run. No model picks a tool, the order or an outcome: the only model call is the reader at `lee`.
// Every path that decides an invoice calls runAgent: ingest, "Ejecutar agente", login, "Reevaluar", "Reiniciar demo", cron.
import { headline } from '../engine/explain';
import type { Decision, Invoice, InvoiceFields, Outcome } from '../engine/types';
import type { Env } from '../env';
import { escalationEmail, sendEmail } from '../lib/email';
import { documentToText, extractFields } from '../lib/llm';
import { must, type Db } from '../lib/supabase';
import { hashToken, signToken, TOKEN_TTL_MS } from '../lib/tokens';
import { escalationQuestion } from './question';
import { recorder, type Counts, type DecisionInput, type Recorder, type Trigger } from './record';
import type { StoredDecision } from './trace';
import { decide, directorio, duplicados, findBeneficiary, periodo, politica } from './tools';

// db reads under the caller's authority: the user's JWT client (RLS) in a request, the service-role client in the cron.
export interface AgentDeps { db: Db; env: Env }
type Row = Omit<Invoice, 'fields'> & { fields: InvoiceFields | null; raw_text: string | null; seq: number | null; outcome: Outcome | null };

const RETRIES = 3; // STALE_PERIOD = another decision changed the month's committed amount meanwhile (AC-24)
// Each stage is logged, so `wrangler tail` shows the agent working on its own.
const stage = (name: string, invoiceId = '') => console.log(`agent ${name}`, invoiceId);
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function runAgent(deps: AgentDeps, companyId: string, invoiceIds: string[] | 'pending', trigger: Trigger): Promise<Counts & { errors: number }> {
  const { db, env } = deps;
  const record = recorder(env, companyId);
  const q = db.from('invoice_current').select('*').eq('company_id', companyId);
  const rows: Row[] = must(await (invoiceIds === 'pending' ? q.is('outcome', null) : q.in('id', invoiceIds)).order('received_at').order('id'));
  const company: { approver_email: string | null; is_demo: boolean } =
    must(await db.from('companies').select('approver_email, is_demo').eq('id', companyId).single());
  const [directory, policy] = await Promise.all([directorio(db, companyId), politica(db, companyId)]);
  const rules = policy?.rules ?? null;
  const counts: Counts = { PAGAR: 0, FRENAR: 0, ESCALAR: 0 };
  let errors = 0;

  for (const row of rows) {
    try {
      stage('percibe', row.id);
      // Only "Reevaluar" re-decides an ESCALAR (R-24); PAGAR and FRENAR are final (D16).
      if (row.outcome && !(row.outcome === 'ESCALAR' && trigger === 'reevaluate')) continue;
      stage('lee', row.id);
      // ponytail: reads raw_text only; a stored file without fields is decided as illegible (ingest reads files first).
      const fields = row.fields ?? await extractFields(env, await documentToText(env, { kind: 'text', text: row.raw_text ?? '' }));
      const invoice: Invoice = { id: row.id, received_at: row.received_at, source: row.source, fields };
      const beneficiary = findBeneficiary(fields.payee_name, directory);
      for (let attempt = 0; ; attempt++) {
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
          if (messageOf(e) === 'ALREADY_DECIDED') break; // R-25: someone else decided it first; no tokens, no mail
          if (messageOf(e) !== 'STALE_PERIOD' || attempt === RETRIES) throw e;
          continue;
        }
        counts[d.outcome]++;
        // R-15, R-16: mail only a new escalation (the previous latest decision was not ESCALAR) of a non-demo company.
        if (esc && row.outcome !== 'ESCALAR' && !company.is_demo) await notify(env, record, company.approver_email, invoice, d, stored, input.question_es!);
        break;
      }
    } catch (e) {
      errors++;
      console.error('agent: invoice not decided', row.id, messageOf(e));
    }
  }
  stage('rindeCuentas');
  await record.run(trigger, counts, errors);
  return { ...counts, errors };
}

// One approve/reject pair sharing the escalation's decision_id, one Spanish mail to the approver, then the pair's hashes
// with the send result (R-29). Never throws: a failed send is recorded and never changes the decision (AC-39).
async function notify(env: Env, record: Recorder, to: string | null, invoice: Invoice, d: Decision, stored: StoredDecision, question: string) {
  try {
    if (!to || !env.APP_URL) throw new Error('no approver_email or APP_URL');
    const exp = Date.now() + TOKEN_TTL_MS;
    const [approve, reject] = await Promise.all((['approve', 'reject'] as const).map((action) =>
      signToken(env.APPROVAL_HMAC_SECRET, { invoice_id: invoice.id, decision_id: stored.id, action, exp })));
    const link = (token: string) => `${env.APP_URL}/approve/${token}`;
    const mail = escalationEmail({ lang: 'es', question, invoice, decision: d, approveUrl: link(approve!), rejectUrl: link(reject!) });
    const { sent } = await sendEmail(env, { to, ...mail });
    await record.tokens(await Promise.all([approve!, reject!].map(async (token) => ({
      token_hash: await hashToken(token), invoice_id: invoice.id, decision_id: stored.id, expires_at: new Date(exp).toISOString(), email_sent: sent, sent_to: to,
    }))));
  } catch (e) {
    console.error('agent: escalation not notified', invoice.id, messageOf(e));
  }
}
