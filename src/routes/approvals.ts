// A person's answer to an escalation (AC-34..37, R-02, R-03, R-55): the emailed approve/reject links (public, by signed
// token, read with the service-role client scoped by the token's stored row; the approval-by-token handler of AC-38) and
// the dashboard buttons (requireUser, read with the user's JWT). Both re-check on fresh data and write only via record.ts.
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { escalationQuestion } from '../agent/question';
import { recorder, type DecisionInput, type Recorder } from '../agent/record';
import { directorio, duplicados, findBeneficiary, periodo, politica } from '../agent/tools';
import type { StoredDecision } from '../agent/trace';
import { decideWithOverrides } from '../engine/decide';
import { headline } from '../engine/explain';
import type { Decision, Invoice } from '../engine/types';
import type { Env } from '../env';
import { adminClient } from '../lib/admin';
import { requireUser, type AppEnv } from '../lib/auth';
import { documentToText, extractFields } from '../lib/llm';
import { must, type Db } from '../lib/supabase';
import { hashToken, verifyToken } from '../lib/tokens';

const ERRORS = {
  bad_request: [400, 'Solicitud inválida'],
  invalid_token: [404, 'Este enlace no es válido o venció'],
  not_found: [404, 'Factura no encontrada'],
  token_used: [409, 'Este enlace ya se usó'],
  already_decided: [409, 'Esta factura ya fue decidida'],
  changed: [409, 'Esta factura cambió desde que abriste el enlace; ábrelo de nuevo.'],
  busy: [503, 'No pude registrar la respuesta; inténtalo de nuevo.'],
} as const;
type Refusal = keyof typeof ERRORS;
const refuse = (c: Context, r: Refusal) => c.json({ error: r, message: ERRORS[r][1] }, ERRORS[r][0]);

// seq = the ESCALAR decision the person was shown (R-55). Anything else in the body (actor_email, channel) is ignored.
const Body = z.object({ seq: z.number().int().positive(), note: z.string().max(1000).optional() });
const bodyOf = async (c: Context) => Body.safeParse(await c.req.json().catch(() => null)).data ?? null;

const RETRIES = 3; // STALE_PERIOD, as in the agent loop (AC-24)
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

const latestOf = async (db: Db, companyId: string, invoiceId: string): Promise<StoredDecision | null> =>
  must(await db.from('decisions').select('*').eq('company_id', companyId).eq('invoice_id', invoiceId)
    .order('seq', { ascending: false }).limit(1).maybeSingle());
const approverOf = async (db: Db, companyId: string): Promise<string | null> =>
  (must(await db.from('companies').select('approver_email').eq('id', companyId).single()) as { approver_email: string | null }).approver_email;

interface Answer {
  env: Env; db: Db; record: Recorder; companyId: string; invoiceId: string; approverEmail: string;
  by: { email: string; channel: 'link' | 'dashboard' }; action: 'approve' | 'reject'; seq: number; note: string | null;
}

// Approve: the checks not passing in the escalation as it stands now ∩ the 8 overridable ones are overridden, the rest
// re-run on fresh period state (R-02, R-21); PAGAR or ESCALAR again (FRENAR on a fresh duplicate or limit breach).
// Reject: FRENAR by the person, with the escalation's own checks (R-48): no re-check, the budget is released.
async function answer(a: Answer): Promise<StoredDecision | Refusal> {
  const { env, db, companyId, invoiceId } = a;
  const row: (Omit<Invoice, 'fields'> & { fields: Invoice['fields'] | null; raw_text: string | null }) | null =
    must(await db.from('invoices').select('id, source, received_at, fields, raw_text').eq('company_id', companyId).eq('id', invoiceId).maybeSingle());
  if (!row) return 'not_found';
  const esc = await latestOf(db, companyId, invoiceId);
  if (esc?.outcome !== 'ESCALAR') return 'already_decided';
  if (esc.seq !== a.seq) return 'changed';
  // The same `lee` as the agent loop: an invoice stored without fields is read from its text.
  const fields = row.fields ?? await extractFields(env, await documentToText(env, { kind: 'text', text: row.raw_text ?? '' }));
  const invoice: Invoice = { id: row.id, received_at: row.received_at, source: row.source, fields };
  const [directory, policy] = await Promise.all([directorio(db, companyId), politica(db, companyId)]);
  const beneficiary = findBeneficiary(fields.payee_name, directory);
  const failing = esc.checks.filter((c) => c.verdict !== 'cumple').map((c) => c.id);
  for (let attempt = 0; ; attempt++) {
    const period = { ...await periodo(db, companyId, invoice), previous: await duplicados(db, companyId, invoice, policy?.rules ?? null, directory) };
    const d: Decision = a.action === 'approve'
      ? decideWithOverrides(failing, a.by, invoice, beneficiary, policy?.rules ?? null, period, new Date().toISOString())
      : { outcome: 'FRENAR', checks: esc.checks, amount_usd: esc.amount_usd, payment: null };
    const esc2 = d.outcome === 'ESCALAR';
    const question = (lang: 'es' | 'en') => (esc2 ? escalationQuestion({ approverEmail: a.approverEmail, invoice, decision: d }, lang) : null);
    const input: DecisionInput = {
      outcome: d.outcome, actor: 'human', actor_email: a.by.email, channel: a.by.channel, note: a.note,
      checks: d.checks, amount_usd: d.amount_usd, payment: d.payment,
      policy_version: a.action === 'approve' ? policy?.version ?? null : esc.policy_version,
      headline_es: headline(d, invoice, beneficiary, 'es'), headline_en: headline(d, invoice, beneficiary, 'en'),
      question_es: question('es'), question_en: question('en'),
    };
    try {
      return await a.record.decision(invoiceId, period.committed_usd, input, a.seq);
    } catch (e) {
      const m = messageOf(e);
      if (m === 'ALREADY_DECIDED') return 'changed'; // appended after the page was shown (R-25, R-55)
      if (m === 'NOT_ESCALATED' || m === 'FINAL_DECISION') return 'already_decided';
      if (m !== 'STALE_PERIOD') throw e;
      if (attempt === RETRIES) return 'busy';
    }
  }
}

// R-55 (1): HMAC valid, under 48 h, hash stored; invoice and company come from the stored token row. Then the pair must
// be unspent and the invoice's latest decision ESCALAR, in that order (a spent pair reads "ya se usó" even if re-escalated).
async function link(env: Env, token: string) {
  const p = await verifyToken(env.APPROVAL_HMAC_SECRET, token);
  if (!p) return 'invalid_token' as const;
  const db = adminClient(env);
  const hash = await hashToken(token);
  const t: { invoice_id: string; decision_id: string; company_id: string } | null =
    must(await db.from('approval_tokens').select('invoice_id, decision_id, company_id').eq('token_hash', hash).maybeSingle());
  if (!t || t.invoice_id !== p.invoice_id || t.decision_id !== p.decision_id) return 'invalid_token' as const;
  const used: unknown = must(await db.from('approval_uses').select('token_hash').eq('decision_id', t.decision_id).maybeSingle());
  if (used) return 'token_used' as const;
  const esc = await latestOf(db, t.company_id, t.invoice_id);
  if (esc?.outcome !== 'ESCALAR') return 'already_decided' as const;
  return { db, hash, action: p.action, exp: p.exp, ...t, esc };
}

export const approvals = new Hono<AppEnv>();

// Writes nothing, so a mail scanner's GET never answers (AC-35). Shows the LATEST ESCALAR decision; its seq goes in the form.
approvals.get('/approve/:token', async (c) => {
  const l = await link(c.env, c.req.param('token'));
  if (typeof l === 'string') return refuse(c, l);
  const invoice = must(await l.db.from('invoices').select('id, source, received_at, fields')
    .eq('company_id', l.company_id).eq('id', l.invoice_id).single());
  return c.json({ action: l.action, expires_at: new Date(l.exp).toISOString(), invoice, decision: l.esc });
});

approvals.post('/approve/:token', async (c) => {
  const body = await bodyOf(c);
  if (!body) return refuse(c, 'bad_request');
  const l = await link(c.env, c.req.param('token'));
  if (typeof l === 'string') return refuse(c, l);
  const approver = await approverOf(l.db, l.company_id);
  if (!approver) return refuse(c, 'invalid_token'); // nobody to record as the answering person (AC-37)
  const record = recorder(c.env, l.company_id);
  const r = await answer({ env: c.env, db: l.db, record, companyId: l.company_id, invoiceId: l.invoice_id, approverEmail: approver,
    by: { email: approver, channel: 'link' }, action: l.action, seq: body.seq, note: body.note ?? null });
  if (typeof r === 'string') return refuse(c, r);
  // Spends the pair of the token's OWN escalation (R-55 (4)). Written after the decision so a stale form spends nothing.
  // ponytail: a re-escalated approval leaves a window of milliseconds before this row in which the other link could answer
  // the new ESCALAR; the unique decision_id then refuses the second use. Close it inside insert_decision if it ever matters.
  try {
    await record.approvalUse(l.invoice_id, l.hash, l.decision_id);
  } catch (e) {
    if (messageOf(e) !== 'TOKEN_USED') throw e;
    return refuse(c, 'token_used');
  }
  return c.json({ decision: r });
});

// Dashboard "Aprobar" / "Rechazar": actor_email from the verified JWT (AC-37); writes no approval_uses row (AC-36).
for (const action of ['approve', 'reject'] as const) {
  approvals.post(`/invoices/:id/${action}`, requireUser, async (c) => {
    const body = await bodyOf(c);
    if (!body) return refuse(c, 'bad_request');
    const { db, companyId, user } = c.var;
    if (!user.email) return c.json({ error: 'No autorizado' }, 401);
    const r = await answer({ env: c.env, db, record: recorder(c.env, companyId), companyId, invoiceId: c.req.param('id'),
      approverEmail: (await approverOf(db, companyId)) ?? '', by: { email: user.email, channel: 'dashboard' }, action, seq: body.seq, note: body.note ?? null });
    return typeof r === 'string' ? refuse(c, r) : c.json({ decision: r });
  });
}
