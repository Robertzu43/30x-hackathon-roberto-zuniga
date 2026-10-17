// The record writer (R-32, AC-38, AC-68): the only code that writes `decisions` (through insert_decision),
// `approval_tokens` and `agent_runs`. Members cannot write them, so it uses the service-role client; to stay inside the
// caller's authority it re-reads the invoice before each invoice write and refuses another company's invoice.
import type { Outcome } from '../engine/types';
import type { Env } from '../env';
import { adminClient } from '../lib/admin';
import { must } from '../lib/supabase';
import type { StoredDecision } from './trace';

export type Trigger = 'cron' | 'ingest' | 'manual' | 'login' | 'reevaluate' | 'reset';
export type Counts = Record<Outcome, number>;
// insert_decision's p_decision; the database sets id, seq, company_id and created_at.
export type DecisionInput = Pick<StoredDecision, 'outcome' | 'actor' | 'checks' | 'amount_usd' | 'payment' | 'policy_version'
  | 'headline_es' | 'headline_en' | 'question_es' | 'question_en'> & Partial<Pick<StoredDecision, 'actor_email' | 'channel' | 'note'>>;
// Only the hash of a token is stored; the row is inserted after the send attempt (R-29).
export interface TokenRow { token_hash: string; invoice_id: string; decision_id: string; expires_at: string; email_sent: boolean; sent_to: string }

// companyId = the company the caller was authorised for: the requireUser membership (user JWT), a verified approval
// token's invoice, or the cron's explicit company filter. null = the cron tick itself, which may write only its run row.
export function recorder(env: Env, companyId: string | null) {
  const admin = adminClient(env);
  const owned = async (invoiceId: string) => {
    const inv = must(await admin.from('invoices').select('company_id').eq('id', invoiceId).maybeSingle());
    if (!companyId || inv?.company_id !== companyId) throw new Error('COMPANY_MISMATCH');
  };
  return {
    // Throws the database's refusal by name: ALREADY_DECIDED, STALE_PERIOD, FINAL_DECISION, NOT_ESCALATED, PAGAR_OUTSIDE_RULES.
    async decision(invoiceId: string, expectedCommittedUsd: number, decision: DecisionInput, expectedSeq: number): Promise<StoredDecision> {
      await owned(invoiceId);
      return must(await admin.rpc('insert_decision', {
        p_invoice_id: invoiceId, p_expected_committed_usd: expectedCommittedUsd, p_decision: decision, p_expected_seq: expectedSeq,
      }));
    },
    async tokens(rows: TokenRow[]): Promise<void> {
      for (const id of new Set(rows.map((r) => r.invoice_id))) await owned(id);
      must(await admin.from('approval_tokens').insert(rows.map((r) => ({ ...r, company_id: companyId }))));
    },
    async run(trigger: Trigger, decided: Counts | null, errors: number): Promise<void> {
      must(await admin.from('agent_runs').insert({ company_id: companyId, trigger, decided, errors }));
    },
  };
}
export type Recorder = ReturnType<typeof recorder>;
