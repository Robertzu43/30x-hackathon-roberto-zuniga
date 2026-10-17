// "Lo que hice" (AC-64, D24): the agent's steps, rendered only from what was recorded (R-29): the stored decisions,
// the invoice, the company's demo flag and the recorded send result. Templates only, no model.
import { agreementText, asRead, fieldList, fill, list, money, motives, readReason, reasonText } from '../engine/explain';
import { validFields } from '../engine/checks';
import { outcomeOf } from '../engine/decide';
import type { Check, CheckId, Decision, Invoice, InvoiceFields, Outcome } from '../engine/types';
import { t, type Lang } from '../i18n';

// One row of `decisions` (also the decision columns of `invoice_current`).
export interface StoredDecision {
  id: string;
  seq: number;
  outcome: Outcome;
  actor: 'agent' | 'human';
  actor_email: string | null;
  channel: 'link' | 'dashboard' | null;
  checks: Check[];
  headline_es: string | null;
  headline_en: string | null;
  question_es: string | null;
  question_en: string | null;
  policy_version: number | null;
  amount_usd: number | null;
  payment: Decision['payment'];
  note: string | null;
  created_at: string;
}

// An invoice stored without fields (a REST insert the loop read at `lee`; the loop never writes `invoices`, AC-38) is
// shown as its decision's checks recorded the reading (R-29): validFields' output, so every recorded value is trusted.
// Null when there is no decision yet (pending, not read).
export function recordedFields(fields: InvoiceFields | null, checks: Check[]): InvoiceFields;
export function recordedFields(fields: InvoiceFields | null, checks: Check[] | null | undefined): InvoiceFields | null;
export function recordedFields(fields: InvoiceFields | null, checks: Check[] | null | undefined): InvoiceFields | null {
  if (fields || !checks) return fields;
  const c = (id: CheckId) => checks.find((x) => x.id === id);
  const s = (v: unknown) => (typeof v === 'string' && v ? v : null);
  const m = c('moneda')?.values;
  const read = {
    payee_name: s(c('beneficiario_permitido')?.values.payee_name), amount: typeof m?.amount === 'number' ? m.amount : null,
    currency: s(m?.currency), invoice_number: s(c('duplicado_exacto')?.actual), issue_date: null, due_date: s(c('vencimiento')?.actual),
    concept: s(c('duplicado_probable')?.actual), bank_account: s(c('beneficiario_cuenta')?.values.invoice_account),
  };
  const confidence = Object.fromEntries(Object.entries(read).filter(([, v]) => v !== null).map(([k]) => [k, 1]));
  const reason = readReason(checks);
  if (!reason) return { ...read, confidence };
  // R-75, R-80: the reason, and the guard's values (the Lectura values but `missing` and `reason`)
  const detail = Object.fromEntries(Object.entries(c('lectura')!.values).filter(([k]) => k !== 'missing' && k !== 'reason'));
  return { ...read, confidence, read_error: reason, ...(reason === 'lector_no_disponible' ? {} : { read_detail: detail }) };
}

export interface TraceStep { stage: 'lee' | 'consulta' | 'decide' | 'actua'; text: string }

export interface TraceArgs {
  invoice: Invoice;
  decisions: StoredDecision[]; // timeline, oldest first
  isDemo: boolean;
  notification: { email_sent: boolean; sent_to: string } | null; // the approval_tokens row of the escalation, if any
}

const READ = ['payee_name', 'amount', 'currency', 'invoice_number'] as const;

function read({ source, fields }: Invoice, checks: Check[], lang: Lang): string {
  const src = t(lang, `trace.source.${source}`);
  const f = validFields(fields); // R-71: what the engine could not trust was not read
  const reason = reasonText(checks, 'trace.read', lang, { source: src }, f); // R-75, R-80: why no amount was taken
  if (reason) return reason;
  const found = [
    f.payee_name && fill(lang, 'trace.payee', { payee: f.payee_name }),
    f.amount !== null && `${money(f.amount, lang)} ${f.currency ?? ''}`.trim(),
    f.invoice_number && fill(lang, 'trace.invoice_number', { number: f.invoice_number }),
  ].filter((x): x is string => !!x);
  const missing = READ.filter((k) => f[k] === null);
  if (!found.length) return fill(lang, 'trace.read_none', { source: src });
  return fill(lang, missing.length ? 'trace.read_missing' : 'trace.read', { source: src, found: found.join(', '), missing: fieldList(lang, missing) });
}

function consult(checks: Check[], lang: Lang): string {
  const v = (id: CheckId) => checks.find((c) => c.id === id)?.values ?? {};
  const account = v('beneficiario_cuenta');
  if (!v('beneficiario_permitido').directory_name) return t(lang, 'trace.not_in_directory');
  const cuenta = checks.find((c) => c.id === 'beneficiario_cuenta');
  if (cuenta?.verdict === 'no_cumple') {
    return fill(lang, `trace.directory_account${asRead(cuenta)}`, { ...account, invoice: account.invoice_account_last4, account: account.directory_account_last4 });
  }
  return fill(lang, 'trace.directory', { agreement: agreementText(v('acuerdo'), lang), account: account.directory_account_last4 });
}

// "<a> cumplen[, <b> no cumplen][, <c> no se pudieron verificar]"
function counts(checks: Check[], lang: Lang): string {
  const plural = new Intl.PluralRules(lang === 'es' ? 'es-CO' : 'en-US');
  return (['cumple', 'no_cumple', 'no_verificado'] as const).map((v) => [v, checks.filter((c) => c.verdict === v).length] as const)
    .filter(([v, n]) => v === 'cumple' || n > 0)
    .map(([v, n]) => fill(lang, `trace.count.${v}.${plural.select(n)}`, { n })).join(', ');
}

function act(d: StoredDecision, a: TraceArgs, lang: Lang): string {
  if (d.outcome === 'PAGAR') {
    const { route, currency } = d.payment ?? { route: null, currency: null };
    // "<moneda> · <ruta>"; a directory route may already be composed ("COP · transferencia") or be just the currency ("MXN").
    return fill(lang, 'trace.act.PAGAR', { route: !route || route === currency ? currency : route.includes(' · ') ? route : `${currency} · ${route}` });
  }
  if (d.outcome === 'FRENAR') return t(lang, 'trace.act.FRENAR');
  if (a.isDemo) return t(lang, 'trace.act.demo'); // R-15: the demo company never sends mail
  if (!a.notification) return t(lang, 'trace.act.unsent');
  const { email_sent, sent_to } = a.notification;
  return fill(lang, email_sent ? 'trace.act.sent' : 'trace.act.failed', { email: sent_to, question: d[`question_${lang}`] });
}

// A later decision, from its own stored data (R-64): a person's answer (R-48) or the agent's re-evaluation. Rejection = a
// human FRENAR whose own checks do not trigger FRENAR (an approval that re-checks into a fresh duplicate or limit breach is
// still an approval). Anything but PAGAR states its reason, as the column beside it does.
function later(d: StoredDecision, a: TraceArgs, lang: Lang): TraceStep {
  const why = list(lang, motives(d.checks, lang, a.invoice.received_at));
  const vars = { email: d.actor_email, channel: t(lang, `channel.${d.channel}`), outcome: t(lang, `outcome.${d.outcome}`), reason: why,
    version: d.policy_version, counts: counts(d.checks, lang) };
  if (d.actor === 'agent') return { stage: 'decide', text: fill(lang, why ? 'trace.reevaluated_reason' : 'trace.reevaluated', vars) };
  const rejected = d.outcome === 'FRENAR' && outcomeOf(d.checks) !== 'FRENAR';
  return { stage: 'actua', text: fill(lang, rejected ? 'trace.human.rejected' : why ? 'trace.human.approved_reason' : 'trace.human.approved', vars) };
}

// Steps 1-5 narrate the FIRST agent decision and are never rewritten; each later decision adds one step, in seq order (R-64).
export function agentTrace(a: TraceArgs, lang: Lang): TraceStep[] {
  const i = a.decisions.findIndex((d) => d.actor === 'agent');
  const d = a.decisions[i]; // [-1] = undefined: no agent decision yet
  if (!d) return [];
  const why = motives(d.checks, lang, a.invoice.received_at);
  const outcome = t(lang, `outcome.${d.outcome}`);
  return [
    { stage: 'lee', text: read(a.invoice, d.checks, lang) },
    { stage: 'consulta', text: consult(d.checks, lang) },
    { stage: 'consulta', text: fill(lang, 'trace.rules', { total: d.checks.length, counts: counts(d.checks, lang) }) },
    { stage: 'decide', text: fill(lang, why.length ? 'trace.decided_reason' : 'trace.decided', { outcome, reason: list(lang, why) }) },
    { stage: 'actua', text: act(d, a, lang) },
    ...a.decisions.slice(i + 1).map((h) => later(h, a, lang)),
  ];
}
