// The deterministic tools the agent consults (D22, AC-61): directorio, política, periodo, duplicados, and the engine's
// pure decide(). Every query names the company explicitly: the cron's client bypasses RLS (R-23).
import { bogotaDay, findBeneficiary } from '../engine/checks';
import type { Beneficiary, Check, Invoice, PeriodState, PolicyRules, PreviousInvoice } from '../engine/types';
import { round2 } from '../lib/money';
import { must, type Db } from '../lib/supabase';
import { recordedFields } from './trace';

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

// A row of invoice_current as the tools read it (a decided row has outcome and amount_usd), with its latest decision's
// checks embedded when the row may have no stored fields (R-77).
type CurrentRow = { id: string; fields: Invoice['fields'] | null; amount_usd: number | string | null; outcome: PreviousInvoice['outcome'] | null; received_at: string;
  decisions?: Array<{ checks: Check[] }> };

// period_state over invoice_current rows already read (R-59): the decided invoices of the invoice's Bogotá month, without it.
export function periodFrom(rows: CurrentRow[], inv: Invoice): Omit<PeriodState, 'previous'> {
  const month = rows.filter((r) => r.outcome && r.id !== inv.id && bogotaDay(r.received_at).slice(0, 7) === monthOf(inv));
  const sum = (o: string[]) => round2(month.filter((r) => o.includes(r.outcome!)).reduce((s, r) => s + Number(r.amount_usd ?? 0), 0));
  return { committed_usd: sum(['PAGAR', 'ESCALAR']), paid_usd: sum(['PAGAR']) };
}

// Decided, non-archived invoices of the duplicate window and of the invoice's whole Bogotá month (Bogotá is UTC-5, no DST).
const windowStart = (inv: Invoice, rules: PolicyRules | null) =>
  Math.min(Date.parse(`${monthOf(inv)}-01T00:00:00-05:00`), Date.parse(inv.received_at) - (rules?.duplicate_window_days ?? 0) * 864e5);

export async function duplicados(db: Db, companyId: string, inv: Invoice, rules: PolicyRules | null, directory: Beneficiary[]): Promise<PreviousInvoice[]> {
  // The latest decision's checks come embedded in the same request (R-56: still one read per invoice).
  const rows = must(await db.from('invoice_current').select('id, fields, amount_usd, outcome, received_at, decisions(checks)')
    .eq('company_id', companyId).not('outcome', 'is', null).gte('received_at', new Date(windowStart(inv, rules)).toISOString())
    .order('seq', { referencedTable: 'decisions', ascending: false }).limit(1, { referencedTable: 'decisions' }));
  return previousFrom(rows, inv, rules, directory);
}

// The same filter over rows already read (R-59); on duplicados' own rows it keeps them all. A decided invoice counts with
// the fields it was decided on: stored, or else recorded in its latest decision (R-77, AC-20).
export function previousFrom(rows: CurrentRow[], inv: Invoice, rules: PolicyRules | null, directory: Beneficiary[]): PreviousInvoice[] {
  const from = windowStart(inv, rules);
  return rows.filter((r) => r.outcome && Date.parse(r.received_at) >= from).map((r) => {
    const f = recordedFields(r.fields, r.decisions?.[0]?.checks);
    return {
      invoice_id: r.id, invoice_number: f?.invoice_number ?? null, payee_name: f?.payee_name ?? null, concept: f?.concept ?? null,
      beneficiary_id: findBeneficiary(f?.payee_name ?? null, directory)?.id ?? null,
      amount_usd: r.amount_usd === null ? null : Number(r.amount_usd), received_at: r.received_at, outcome: r.outcome!,
    };
  });
}
