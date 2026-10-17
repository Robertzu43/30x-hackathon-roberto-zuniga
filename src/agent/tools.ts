// The deterministic tools the agent consults (D22, AC-61): directorio, política, periodo, duplicados, and the engine's
// pure decide(). Every query names the company explicitly: the cron's client bypasses RLS (R-23).
import { bogotaDay, findBeneficiary } from '../engine/checks';
import type { Beneficiary, Invoice, PeriodState, PolicyRules, PreviousInvoice } from '../engine/types';
import { must, type Db } from '../lib/supabase';

export { decide } from '../engine/decide';
export { findBeneficiary }; // directory lookup by name: case, accents, punctuation and legal suffixes ignored

const monthOf = (inv: Invoice) => bogotaDay(inv.received_at).slice(0, 7);

export const directorio = async (db: Db, companyId: string): Promise<Beneficiary[]> =>
  must(await db.from('beneficiaries').select('*').eq('company_id', companyId).eq('archived', false)); // a reset archives, never deletes (AC-47)

export const politica = async (db: Db, companyId: string): Promise<{ version: number; rules: PolicyRules } | null> =>
  must(await db.from('policies').select('version, rules').eq('company_id', companyId)
    .order('version', { ascending: false }).limit(1).maybeSingle());

// The invoice's own Bogotá month, without the invoice itself, as insert_decision recomputes it (R-45).
export async function periodo(db: Db, companyId: string, inv: Invoice): Promise<Omit<PeriodState, 'previous'>> {
  const p = must(await db.rpc('period_state', { p_company_id: companyId, p_month: `${monthOf(inv)}-01`, p_exclude_invoice: inv.id }));
  return { committed_usd: Number(p.committed_usd), paid_usd: Number(p.paid_usd) };
}

// Decided, non-archived invoices of the duplicate window and of the invoice's whole Bogotá month (Bogotá is UTC-5, no DST).
export async function duplicados(db: Db, companyId: string, inv: Invoice, rules: PolicyRules | null, directory: Beneficiary[]): Promise<PreviousInvoice[]> {
  const from = Math.min(Date.parse(`${monthOf(inv)}-01T00:00:00-05:00`), Date.parse(inv.received_at) - (rules?.duplicate_window_days ?? 0) * 864e5);
  const rows = must(await db.from('invoice_current').select('id, fields, amount_usd, outcome, received_at')
    .eq('company_id', companyId).not('outcome', 'is', null).gte('received_at', new Date(from).toISOString()));
  return rows.map((r: { id: string; fields: Invoice['fields'] | null; amount_usd: number | string | null; outcome: PreviousInvoice['outcome']; received_at: string }) => ({
    invoice_id: r.id, invoice_number: r.fields?.invoice_number ?? null, payee_name: r.fields?.payee_name ?? null, concept: r.fields?.concept ?? null,
    beneficiary_id: findBeneficiary(r.fields?.payee_name ?? null, directory)?.id ?? null,
    amount_usd: r.amount_usd === null ? null : Number(r.amount_usd), received_at: r.received_at, outcome: r.outcome,
  }));
}
