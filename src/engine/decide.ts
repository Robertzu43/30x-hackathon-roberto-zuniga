// The decision engine (D2, D15). PAGAR exists only as the output of this file, when all 13 checks pass.
import { toUsd } from '../lib/money';
import * as C from './checks';
import { CHECK_IDS, type Beneficiary, type Check, type CheckId, type Decision, type Invoice, type MarketRates, type Outcome, type PeriodState, type PolicyRules } from './types';

// A person may unlock these (AC-34). Budget, balance, per-payment limit, exact duplicate and rate need data or a new policy (R-21).
export const HUMAN_OVERRIDABLE: readonly CheckId[] = [
  'umbral_aprobacion', 'beneficiario_permitido', 'beneficiario_cuenta', 'acuerdo', 'duplicado_probable', 'vencimiento', 'periodo', 'lectura',
];
const FRENAR_ON: readonly CheckId[] = ['duplicado_exacto', 'limite_pago'];

const passes = (c: Check) => c.verdict === 'cumple' || (!!c.overridden && HUMAN_OVERRIDABLE.includes(c.id));

// Fixed consequence table (D15, AC-17): FRENAR wins; PAGAR only when all 13 checks are present and pass.
export function outcomeOf(checks: Check[]): Outcome {
  if (checks.some((c) => c.verdict === 'no_cumple' && FRENAR_ON.includes(c.id))) return 'FRENAR';
  return checks.every(passes) && CHECK_IDS.every((id) => checks.some((c) => c.id === id)) ? 'PAGAR' : 'ESCALAR';
}

function conclude(checks: Check[], amount_usd: number | null, invoice: Invoice, beneficiary: Beneficiary | null): Decision {
  const outcome = outcomeOf(checks);
  const f = invoice.fields;
  // PAGAR implies payee, amount and currency were read: duplicado_exacto, limite_pago and moneda cannot pass otherwise.
  const payment = outcome === 'PAGAR'
    ? { beneficiary: beneficiary?.name ?? (f.payee_name as string), route: beneficiary?.route ?? null, currency: f.currency as string, amount: f.amount as number }
    : null;
  return { outcome, checks, amount_usd, payment };
}

// market: the newest stored rate per currency (AC-73); no entry = no market rate. Never fetched here (R-85.6).
export function decide(read: Invoice, beneficiary: Beneficiary | null, rules: PolicyRules | null, period: PeriodState, now: string,
  market: MarketRates = {}): Decision {
  const invoice = { ...read, fields: C.validFields(read.fields) }; // R-71: every check sees only trusted fields
  const { amount, currency } = invoice.fields;
  const fx = C.pickRate(currency, rules, market, now);
  const amountUsd = amount === null || !currency || fx.rate === null ? null : toUsd(amount, currency, { [currency]: fx.rate });
  const ctx: C.CheckContext = { invoice, beneficiary, rules, period, now, amountUsd, fx };
  return conclude(CHECK_IDS.map((id) => C[id](ctx)), amountUsd, invoice, beneficiary);
}

// Human approval (R-02, R-21, R-22): every check re-runs fresh; only the given ids that still fail and are
// overridable get `overridden` (verdict kept) and count as passing. The caller passes the escalated decision's failing ids.
export function decideWithOverrides(
  overridden: CheckId[], by: { email: string; channel: 'link' | 'dashboard' },
  invoice: Invoice, beneficiary: Beneficiary | null, rules: PolicyRules | null, period: PeriodState, now: string, market: MarketRates = {},
): Decision {
  const d = decide(invoice, beneficiary, rules, period, now, market);
  const checks = d.checks.map((c) => (c.verdict !== 'cumple' && overridden.includes(c.id) && HUMAN_OVERRIDABLE.includes(c.id)
    ? { ...c, overridden: { by: by.email, channel: by.channel } } : c));
  return conclude(checks, d.amount_usd, invoice, beneficiary);
}
