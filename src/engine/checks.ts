// The 13 checks (D15, AC-16..AC-23). Each is pure: (ctx) => Check. Missing input or rule = 'no_verificado' (AC-18).
import { round2 } from '../lib/money';
import type { Beneficiary, Check, CheckId, Invoice, PeriodState, PolicyRules, PreviousInvoice, Verdict } from './types';

export interface CheckContext {
  invoice: Invoice;
  beneficiary: Beneficiary | null;
  rules: PolicyRules | null;
  period: PeriodState;
  now: string;
  amountUsd: number | null;
}
type Values = Check['values'];

const BOGOTA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' });
export const bogotaDay = (iso: string): string => BOGOTA.format(new Date(iso)); // YYYY-MM-DD
const month = (iso: string) => bogotaDay(iso).slice(0, 7);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

// Case, accents and punctuation ignored (AC-19, AC-20).
const norm = (s: string | null) =>
  (s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[.,]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const nameKey = (s: string | null) => norm(s).replace(/ (sas|ltda|inc|llc)$/, '');
const accountKey = (s: string | null) => norm(s).replace(/ /g, '');
const last4 = (s: string | null) => (s ? s.replace(/\D/g, '').slice(-4) || null : null);

export const findBeneficiary = (payee: string | null, directory: Beneficiary[]): Beneficiary | null =>
  (nameKey(payee) && directory.find((b) => nameKey(b.name) === nameKey(payee))) || null;

const num = (r: PolicyRules | null, k: keyof PolicyRules) => (typeof r?.[k] === 'number' ? (r[k] as number) : null);
const make = (id: CheckId, verdict: Verdict, actual: unknown, threshold: unknown, values: Values = {}): Check =>
  ({ id, verdict, actual: actual == null ? '' : String(actual), threshold: threshold == null ? '' : String(threshold), values });

// Earlier invoices (arrival <= this one, never itself) of the same party: the directory id, or the read name when unknown.
function earlier({ invoice, beneficiary, period }: CheckContext): PreviousInvoice[] {
  const t = Date.parse(invoice.received_at);
  return period.previous.filter((p) => p.invoice_id !== invoice.id && Date.parse(p.received_at) <= t &&
    (beneficiary ? p.beneficiary_id === beneficiary.id : !p.beneficiary_id && nameKey(p.payee_name) === nameKey(invoice.fields.payee_name)));
}

const READ = ['payee_name', 'amount', 'currency', 'invoice_number'] as const;
export function lectura({ invoice: { fields: f } }: CheckContext): Check {
  const missing = READ.filter((k) => f[k] === null || (f.confidence?.[k] ?? 1) < 0.8);
  const bad = missing.length > 0 || !(f.amount !== null && f.amount > 0);
  return make('lectura', bad ? 'no_verificado' : 'cumple', missing.join(', ') || f.amount, null, { missing: missing.join(', ') || null });
}

export function beneficiario_permitido({ invoice, beneficiary, rules }: CheckContext): Check {
  const only = rules?.allowed_beneficiaries_only;
  const v: Verdict = typeof only !== 'boolean' || !invoice.fields.payee_name ? 'no_verificado' : beneficiary || !only ? 'cumple' : 'no_cumple';
  return make('beneficiario_permitido', v, invoice.fields.payee_name, beneficiary?.name,
    { payee_name: invoice.fields.payee_name, directory_name: beneficiary?.name ?? null });
}

export function beneficiario_cuenta({ invoice, beneficiary }: CheckContext): Check {
  const inv = invoice.fields.bank_account, dir = beneficiary?.bank_account ?? null;
  const v: Verdict = !inv || !dir ? 'no_verificado' : accountKey(inv) === accountKey(dir) ? 'cumple' : 'no_cumple';
  return make('beneficiario_cuenta', v, last4(inv), last4(dir), {
    invoice_account_last4: last4(inv), directory_account_last4: last4(dir), reason: v === 'no_cumple' ? 'cuenta cambiada' : null,
  });
}

export function acuerdo(ctx: CheckContext): Check {
  const { beneficiary, rules, amountUsd, invoice, now } = ctx;
  const a = beneficiary?.agreement ?? null;
  const values: Values = {
    agreement_type: a?.type ?? null, agreement_amount_usd: a?.amount_usd ?? null, cap_usd: a?.cap_usd ?? null,
    period: a?.period ?? null, valid_until: a?.valid_until ?? null, amount_usd: amountUsd,
  };
  const out = (v: Verdict, threshold?: unknown) => make('acuerdo', v, amountUsd, threshold, values);
  if (!a || amountUsd === null) return out('no_verificado');
  if (a.valid_until && a.valid_until < bogotaDay(now)) return out('no_cumple', a.valid_until);
  if (a.type === 'one_off') return out('cumple');
  if (a.type === 'hourly') {
    if (typeof a.cap_usd !== 'number') return out('no_verificado');
    const m = month(invoice.received_at);
    const total = round2(earlier(ctx).filter((p) => p.outcome !== 'FRENAR' && month(p.received_at) === m)
      .reduce((s, p) => s + (p.amount_usd ?? 0), amountUsd));
    values.month_total_usd = total;
    return out(total <= a.cap_usd ? 'cumple' : 'no_cumple', a.cap_usd);
  }
  const tol = num(rules, 'agreement_tolerance_pct');
  if (typeof a.amount_usd !== 'number' || tol === null) return out('no_verificado');
  values.tolerance_pct = tol;
  return out(round2(Math.abs(amountUsd - a.amount_usd)) <= round2((a.amount_usd * tol) / 100) ? 'cumple' : 'no_cumple', a.amount_usd);
}

export function duplicado_exacto(ctx: CheckContext): Check {
  const days = num(ctx.rules, 'duplicate_window_days');
  const { payee_name, invoice_number } = ctx.invoice.fields;
  if (days === null || !payee_name || !invoice_number) return make('duplicado_exacto', 'no_verificado', invoice_number, days);
  const from = Date.parse(ctx.invoice.received_at) - days * 864e5;
  const dup = earlier(ctx).find((p) => Date.parse(p.received_at) >= from && norm(p.invoice_number) === norm(invoice_number));
  return make('duplicado_exacto', dup ? 'no_cumple' : 'cumple', invoice_number, days,
    { duplicate_of: dup?.invoice_id ?? null, window_days: days });
}

export function duplicado_probable(ctx: CheckContext): Check {
  const { payee_name, invoice_number, concept } = ctx.invoice.fields;
  if (!payee_name || !invoice_number || !concept) return make('duplicado_probable', 'no_verificado', concept, null);
  const m = month(ctx.invoice.received_at);
  const dup = earlier(ctx).find((p) => month(p.received_at) === m && norm(p.concept) === norm(concept) &&
    norm(p.invoice_number) !== norm(invoice_number));
  return make('duplicado_probable', dup ? 'no_cumple' : 'cumple', concept, null,
    { duplicate_of: dup?.invoice_id ?? null, duplicate_number: dup?.invoice_number ?? null });
}

// amount_usd against a USD limit (a zero or negative amount is never verifiable: lectura is overridable, limits are not); base = what is already counted (committed or paid), 0 for per-invoice limits.
function limit(id: CheckId, key: keyof PolicyRules, { rules, amountUsd }: CheckContext, base?: { key: string; usd: number }): Check {
  const max = num(rules, key);
  if (max === null || amountUsd === null || !(amountUsd > 0)) return make(id, 'no_verificado', amountUsd, max, { amount_usd: amountUsd, limit_usd: max });
  const total = round2((base?.usd ?? 0) + amountUsd);
  const values: Values = base
    ? { [base.key]: base.usd, amount_usd: amountUsd, total_usd: total, [key === 'period_budget_usd' ? 'budget_usd' : 'balance_usd']: max }
    : { amount_usd: amountUsd, limit_usd: max };
  return make(id, total <= max ? 'cumple' : 'no_cumple', total, max, values);
}
export const limite_pago = (ctx: CheckContext) => limit('limite_pago', 'per_payment_limit_usd', ctx);
export const umbral_aprobacion = (ctx: CheckContext) => limit('umbral_aprobacion', 'approval_threshold_usd', ctx);
export const presupuesto_periodo = (ctx: CheckContext) =>
  limit('presupuesto_periodo', 'period_budget_usd', ctx, { key: 'committed_usd', usd: ctx.period.committed_usd });
export const saldo_cuenta = (ctx: CheckContext) =>
  limit('saldo_cuenta', 'account_balance_usd', ctx, { key: 'paid_usd', usd: ctx.period.paid_usd });

export function vencimiento({ invoice, rules, now }: CheckContext): Check {
  const grace = num(rules, 'due_grace_days'), due = invoice.fields.due_date;
  if (grace === null || !due) return make('vencimiento', 'no_verificado', due, grace);
  const cutoff = addDays(bogotaDay(now), -grace);
  return make('vencimiento', due >= cutoff ? 'cumple' : 'no_cumple', due, cutoff, { due_date: due, today: bogotaDay(now), grace_days: grace });
}

// The current period is the Bogotá month of `now`; the invoice belongs to the month it arrived in (D5).
export function periodo({ invoice, now }: CheckContext): Check {
  const got = month(invoice.received_at), cur = month(now);
  return make('periodo', got === cur ? 'cumple' : 'no_cumple', got, cur, { invoice_month: got, current_month: cur });
}

export function moneda({ invoice: { fields: f }, rules, amountUsd }: CheckContext): Check {
  const rate = f.currency === 'USD' ? 1 : (rules?.fx_rates?.[f.currency ?? ''] ?? null);
  const v: Verdict = !f.currency || (!rules?.fx_rates && f.currency !== 'USD') ? 'no_verificado' : rate !== null && rate > 0 ? 'cumple' : 'no_cumple';
  return make('moneda', v, f.currency, rate, { amount: f.amount, currency: f.currency, rate, amount_usd: amountUsd });
}
