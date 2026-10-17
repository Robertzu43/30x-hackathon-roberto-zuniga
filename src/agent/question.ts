// The escalation question (AC-65, D25): one template filled with the checks still blocking the payment. Generated once
// per language at decision time and stored (R-28); the Spanish text is the email subject and first line (AC-39).
import { validFields } from '../engine/checks';
import { HUMAN_OVERRIDABLE } from '../engine/decide';
import { asRead, fill, list, money, unread, whatWouldPay } from '../engine/explain';
import type { Decision, Invoice } from '../engine/types';
import { t, type Lang } from '../i18n';

// R-26: first segment of the email's local part, capitalised; none when it is empty or has digits.
const nameOf = (email: string) => {
  const s = email.split(/[@._+-]/)[0] ?? '';
  return !s || /\d/.test(s) ? null : s.charAt(0).toUpperCase() + s.slice(1);
};

export function escalationQuestion(args: { approverEmail: string; invoice: Invoice; decision: Pick<Decision, 'checks'> }, lang: Lang): string {
  const f = validFields(args.invoice.fields); // R-71
  const failing = args.decision.checks.filter((c) => c.verdict !== 'cumple' && !c.overridden);
  const motives = failing.map((c) => fill(lang, `question.motive.${c.id}.${c.verdict}${asRead(c)}`,
    Object.fromEntries(Object.entries(c.values).map(([k, v]) => [k, typeof v === 'number' ? money(v, lang) : v]))));
  // R-27: approving cannot unlock these, so the agent says what would and offers to reject.
  const fix = whatWouldPay({ checks: failing.filter((c) => !HUMAN_OVERRIDABLE.includes(c.id)) }, lang)
    .map((l) => (lang === 'es' ? l.replace(/^Que /, '') : l.charAt(0).toLowerCase() + l.slice(1)));
  const s = unread(args.decision.checks) // R-75: no answer from the reader, whatever was approved since
    ? fill(lang, 'lector.question', { source: t(lang, `lector.source.${args.invoice.source}`) })
    : `${fill(lang, 'question.sentence', {
      number: f.invoice_number ? fill(lang, 'question.number', { n: f.invoice_number }) : t(lang, 'question.number_unknown'),
      payee: f.payee_name ? fill(lang, 'question.payee', { payee: f.payee_name }) : t(lang, 'question.payee_unknown'),
      amount: f.amount === null ? t(lang, 'question.amount_unknown') : fill(lang, 'question.amount', { amount: `${money(f.amount, lang)} ${f.currency ?? ''}`.trim() }),
      motives: list(lang, motives),
    })} ${fix.length ? fill(lang, 'question.blocked', { fix: list(lang, fix) }) : t(lang, 'question.ask')}`;
  const name = nameOf(args.approverEmail);
  // One line: it is an email subject, and values read from a document may carry newlines.
  return (name ? `${name}, ${s}` : s.charAt(0).toUpperCase() + s.slice(1)).replace(/\s+/g, ' ');
}
