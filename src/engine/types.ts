// Decision engine contract (D1, D2, D15, R-05, R-06, R-22, R-29). Consumed by Tasks 5-9.

export type Outcome = 'PAGAR' | 'FRENAR' | 'ESCALAR';
export type Verdict = 'cumple' | 'no_cumple' | 'no_verificado';

// The 13 checks, in record order. The database refuses an agent PAGAR unless all 13 are 'cumple' (AC-69).
export const CHECK_IDS = [
  'lectura', 'beneficiario_permitido', 'beneficiario_cuenta', 'acuerdo', 'duplicado_exacto', 'duplicado_probable',
  'limite_pago', 'umbral_aprobacion', 'presupuesto_periodo', 'saldo_cuenta', 'vencimiento', 'periodo', 'moneda',
] as const;
export type CheckId = (typeof CHECK_IDS)[number];

export interface InvoiceFields {
  payee_name: string | null;
  amount: number | null;
  currency: string | null;
  invoice_number: string | null;
  issue_date: string | null; // YYYY-MM-DD
  due_date: string | null; // YYYY-MM-DD
  concept: string | null;
  bank_account: string | null;
  confidence: Record<string, number>;
}

export interface Invoice {
  id: string;
  received_at: string; // ISO timestamp
  source: 'pdf' | 'image' | 'email' | 'chat';
  fields: InvoiceFields;
}

export interface Beneficiary {
  id: string;
  name: string;
  bank_account: string | null;
  currency: string | null;
  route: string | null;
  category: string | null;
  agreement: {
    type: 'retainer' | 'hourly' | 'subscription' | 'one_off';
    amount_usd?: number;
    cap_usd?: number;
    period?: 'monthly';
    valid_until?: string; // YYYY-MM-DD
  } | null;
}

// Every key optional: a missing or empty rule makes its check 'no_verificado' (AC-18).
export interface PolicyRules {
  per_payment_limit_usd?: number | null;
  approval_threshold_usd?: number | null;
  period_budget_usd?: number | null;
  account_balance_usd?: number | null;
  duplicate_window_days?: number | null;
  agreement_tolerance_pct?: number | null;
  due_grace_days?: number | null;
  fx_rates?: Record<string, number> | null;
  allowed_beneficiaries_only?: boolean | null;
}

export interface PreviousInvoice {
  invoice_id: string;
  invoice_number: string | null;
  beneficiary_id: string | null;
  payee_name: string | null;
  amount_usd: number | null;
  concept: string | null;
  received_at: string;
  outcome: Outcome;
}

// Already computed by the caller, without the invoice being decided (period_state(..., p_exclude_invoice)).
// committed_usd / paid_usd: the invoice's own Bogotá month. previous: every decided, non-archived invoice received
// within duplicate_window_days OR in the invoice's month (probable duplicates and hourly caps need the whole month).
export interface PeriodState {
  committed_usd: number;
  paid_usd: number;
  previous: PreviousInvoice[];
}

export interface Check {
  id: CheckId;
  verdict: Verdict;
  actual: string;
  threshold: string;
  values: Record<string, string | number | null>;
  // Set only by decideWithOverrides; the verdict stays as it was (R-22).
  overridden?: { by: string; channel: 'link' | 'dashboard' };
}

export interface Decision {
  outcome: Outcome;
  checks: Check[];
  amount_usd: number | null;
  payment: { beneficiary: string; route: string | null; currency: string; amount: number } | null;
}
