// "Lo que hice" (AC-64, D24): the agent's steps, rendered only from what was recorded (R-29): the stored decisions,
// the invoice, the company's demo flag and the recorded send result. Templates only, no model.
import { agreementText, fieldList, fill, list, money, motives } from '../engine/explain';
import { outcomeOf } from '../engine/decide';
import type { Check, CheckId, Decision, Invoice, Outcome } from '../engine/types';
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

export interface TraceStep { stage: 'lee' | 'consulta' | 'decide' | 'actua'; text: string }

export interface TraceArgs {
  invoice: Invoice;
  decisions: StoredDecision[]; // timeline, oldest first
  isDemo: boolean;
  notification: { email_sent: boolean; sent_to: string } | null; // the approval_tokens row of the escalation, if any
}

const READ = ['payee_name', 'amount', 'currency', 'invoice_number'] as const;

function read({ source, fields: f }: Invoice, lang: Lang): string {
  const src = t(lang, `trace.source.${source}`);
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
  if (checks.find((c) => c.id === 'beneficiario_cuenta')?.verdict === 'no_cumple') {
    return fill(lang, 'trace.directory_account', { invoice: account.invoice_account_last4, account: account.directory_account_last4 });
  }
  return fill(lang, 'trace.directory', { agreement: agreementText(v('acuerdo'), lang), account: account.directory_account_last4 });
}

function counts(checks: Check[], lang: Lang): string {
  const plural = new Intl.PluralRules(lang === 'es' ? 'es-CO' : 'en-US');
  const parts = (['cumple', 'no_cumple', 'no_verificado'] as const).map((v) => [v, checks.filter((c) => c.verdict === v).length] as const)
    .filter(([v, n]) => v === 'cumple' || n > 0)
    .map(([v, n]) => fill(lang, `trace.count.${v}.${plural.select(n)}`, { n }));
  return fill(lang, 'trace.rules', { total: checks.length, counts: parts.join(', ') });
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

// A person's answer. Rejection = a human FRENAR whose own checks do not trigger FRENAR (an approval that re-checks
// into a fresh duplicate or limit breach is still an approval).
function human(d: StoredDecision, lang: Lang): string {
  const rejected = d.outcome === 'FRENAR' && outcomeOf(d.checks) !== 'FRENAR';
  return fill(lang, rejected ? 'trace.human.rejected' : 'trace.human.approved',
    { email: d.actor_email, channel: t(lang, `channel.${d.channel}`), outcome: t(lang, `outcome.${d.outcome}`) });
}

// Steps from the latest agent decision, then one step per later human answer.
export function agentTrace(a: TraceArgs, lang: Lang): TraceStep[] {
  const i = a.decisions.map((d) => d.actor).lastIndexOf('agent');
  const d = a.decisions[i]; // [-1] = undefined: no agent decision yet
  if (!d) return [];
  const why = motives(d.checks, lang, a.invoice.received_at);
  const outcome = t(lang, `outcome.${d.outcome}`);
  return [
    { stage: 'lee', text: read(a.invoice, lang) },
    { stage: 'consulta', text: consult(d.checks, lang) },
    { stage: 'consulta', text: counts(d.checks, lang) },
    { stage: 'decide', text: fill(lang, why.length ? 'trace.decided_reason' : 'trace.decided', { outcome, reason: list(lang, why) }) },
    { stage: 'actua', text: act(d, a, lang) },
    ...a.decisions.slice(i + 1).filter((h) => h.actor === 'human').map((h) => ({ stage: 'actua' as const, text: human(h, lang) })),
  ];
}
