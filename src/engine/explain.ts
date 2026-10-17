// Record sentences (AC-27, AC-28, D7): fixed templates filled with stored values, never written by a model.
import { t, type Lang } from '../i18n';
import { validFields } from './checks';
import { outcomeOf } from './decide';
import type { Beneficiary, Check, Decision, Invoice } from './types';

const locale = (lang: Lang) => (lang === 'es' ? 'es-CO' : 'en-US');
const date = (lang: Lang, iso: string, o: Intl.DateTimeFormatOptions) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat(locale(lang), o).format(d);
};

// Whole amounts without decimals (2.500), others with two (367,50).
export const money = (n: number, lang: Lang) =>
  new Intl.NumberFormat(locale(lang), Number.isInteger(n) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

// Template with every {placeholder} filled; a value that is not there prints "desconocido" / "unknown".
export const fill = (lang: Lang, key: string, vars: Record<string, string | number | null | undefined> = {}) =>
  t(lang, key).replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? t(lang, 'value.unknown')));

export const list = (lang: Lang, items: string[]) => new Intl.ListFormat(locale(lang), { type: 'conjunction' }).format(items);
// Bogotá month name of an ISO timestamp (R-45: the budget month is the invoice's arrival month).
const monthName = (lang: Lang, iso: string) => date(lang, iso, { month: 'long', timeZone: 'America/Bogota' });

const READ_FIELDS = ['payee_name', 'amount', 'currency', 'invoice_number'];
export const fieldList = (lang: Lang, fields: string[]) => list(lang, fields.map((f) => t(lang, `field.${f}`)));
const missingOf = (c: Check) => (c.values.missing ? String(c.values.missing).split(', ') : ['amount']); // null missing = amount <= 0
const illegible = (c: Check) => READ_FIELDS.every((f) => missingOf(c).includes(f));

// R-75: no answer came from the reader for this invoice; its Lectura check carries the reason, overridden or not.
const unreadCheck = (c: Check) => c.id === 'lectura' && c.values.reason === 'lector_no_disponible';
export const unread = (checks: Check[]) => checks.some(unreadCheck);

// R-73: a changed account whose last 4 digits read the same on both sides (or are missing) is named by both accounts
// as read: no record ever says two identical endings differ. '' or the '_text' template suffix.
export const asRead = (c: Check) => {
  const a = c.values.invoice_account_last4, b = c.values.directory_account_last4;
  return c.id === 'beneficiario_cuenta' && c.verdict === 'no_cumple' && (!a || !b || a === b) ? '_text' : '';
};

export function agreementText(values: Check['values'], lang: Lang): string {
  const type = values.agreement_type;
  const key = `agreement.${type}`;
  if (!type || t(lang, key) === key) return t(lang, 'agreement.none'); // t returns the key when it has no entry: unknown types read "sin acuerdo registrado" (R-52)
  return fill(lang, key, { ...vars(values, lang), period: values.period === 'monthly' ? t(lang, 'agreement.monthly') : '' });
}

function vars(values: Check['values'], lang: Lang): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(values)) {
    out[k] = v === null ? null
      : k === 'rate' ? new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 10 }).format(Number(v))
      : ['due_date', 'today', 'valid_until'].includes(k) ? date(lang, `${v}T00:00:00Z`, { dateStyle: 'long', timeZone: 'UTC' })
      : ['invoice_month', 'current_month'].includes(k) ? date(lang, `${v}-01T00:00:00Z`, { month: 'long', year: 'numeric', timeZone: 'UTC' })
      : typeof v === 'number' ? money(v, lang) : v;
  }
  return out;
}

const checkVars = (c: Check, lang: Lang, receivedAt: string, policyVersion?: number | null) => ({
  ...vars(c.values, lang),
  actual: c.actual || null,
  version: policyVersion == null ? '' : ` v${policyVersion}`, // R-49: the stored decision's version (R-29), left out when it has none
  month: monthName(lang, receivedAt),
  missing: fieldList(lang, missingOf(c)),
  agreement: agreementText(c.values, lang),
  valid: c.values.valid_until ? fill(lang, 'agreement.valid_until', vars(c.values, lang)) : '',
  billed: fill(lang, c.values.month_total_usd != null ? 'agreement.billed_month' : 'agreement.billed', vars(c.values, lang)),
});

// "Límite por pago: 2.500 USD ≤ 5.000 USD → cumple"; overridden: "… → no cumple · aprobado por <correo> <canal>" (R-22).
export function explainCheck(check: Check, lang: Lang, receivedAt: string, policyVersion?: number | null): string {
  const v = checkVars(check, lang, receivedAt, policyVersion);
  const variant = check.verdict !== 'cumple' ? asRead(check)
    : check.id === 'moneda' && check.values.currency === 'USD' ? '_usd'
    : check.id === 'beneficiario_permitido' && !check.values.directory_name ? '_open' : '';
  const verdict = t(lang, `verdict.${check.verdict}`);
  const shown = check.overridden
    ? fill(lang, 'verdict.overridden', { verdict, by: check.overridden.by, channel: t(lang, `channel.${check.overridden.channel}`) })
    : verdict;
  const body = unreadCheck(check) ? t(lang, 'lector.check') : fill(lang, `check.${check.id}.${check.verdict}${variant}`, v);
  return `${fill(lang, `check.${check.id}.name`, v)}: ${body} → ${shown}`;
}

// Checks still blocking the payment: not passing and not unlocked by a person. A FRENAR trigger comes first.
const blocking = (checks: Check[]) => checks.filter((c) => c.verdict !== 'cumple' && !c.overridden)
  .sort((a, b) => Number(outcomeOf([b]) === 'FRENAR') - Number(outcomeOf([a]) === 'FRENAR'));

export const motives = (checks: Check[], lang: Lang, receivedAt: string) => unread(checks) ? [t(lang, 'lector.motive')] : blocking(checks).map((c) =>
  c.id === 'lectura' && illegible(c) ? t(lang, 'motive.lectura.illegible') : fill(lang, `motive.${c.id}.${c.verdict}${asRead(c)}`, checkVars(c, lang, receivedAt)));

// "Qué tendría que pasar para pagarla": one line per blocking check. Spanish lines start with "Que " (R-27).
export const whatWouldPay = (decision: Pick<Decision, 'checks'>, lang: Lang): string[] =>
  blocking(decision.checks).map((c) => (unreadCheck(c) ? t(lang, 'lector.fix') : fill(lang, `fix.${c.id}.${c.verdict}`, vars(c.values, lang))));

// "ESCALAR · 4.200 USD a Nube Sur LLC: supera el umbral de aprobación de 2.500 USD".
export function headline(decision: Pick<Decision, 'outcome' | 'checks'>, invoice: Invoice, beneficiary: Beneficiary | null, lang: Lang): string {
  const { amount, currency, payee_name } = validFields(invoice.fields); // R-71: an untrusted value is never printed as read
  const base = {
    outcome: t(lang, `outcome.${decision.outcome}`),
    amount: amount === null ? t(lang, 'value.unknown_amount') : `${money(amount, lang)} ${currency ?? ''}`.trim(),
    payee: beneficiary?.name ?? payee_name ?? t(lang, 'value.unknown_payee'),
  };
  if (decision.outcome === 'PAGAR') {
    const type = decision.checks.find((c) => c.id === 'acuerdo')?.values.agreement_type;
    const known = `headline.agreement.${type}`; // t returns the key itself when it has no entry: null or unknown types read "sin acuerdo registrado" (R-52)
    const agreement = fill(lang, t(lang, known) === known ? 'headline.agreement.none' : known, { month: monthName(lang, invoice.received_at) });
    const by = decision.checks.find((c) => c.overridden)?.overridden?.by;
    return fill(lang, by ? 'headline.pay_approved' : 'headline.pay', { ...base, agreement, by });
  }
  if (unread(decision.checks)) return fill(lang, 'lector.headline', base); // R-75: one reason, no "y n motivos más"
  const [first = '', ...rest] = motives(decision.checks, lang, invoice.received_at);
  const reason = rest.length ? fill(lang, `headline.more.${new Intl.PluralRules(locale(lang)).select(rest.length)}`, { reason: first, n: rest.length }) : first;
  return fill(lang, 'headline.other', { ...base, reason });
}
