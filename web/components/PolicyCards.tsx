// Política cards (AC-105): the card shell, one plain sentence per rule and the «qué cambiaría» diff list. The page mounts them.
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../i18n';
import OutcomeChip, { type Outcome } from './OutcomeChip';
import { tu } from './User';

export type RuleKey = 'allowed_beneficiaries_only' | 'per_payment_limit_usd' | 'approval_threshold_usd' | 'period_budget_usd' | 'account_balance_usd' | 'duplicate_window_days' | 'agreement_tolerance_pct' | 'due_grace_days';
export const RULE_GROUPS: Array<{ id: string; rules: RuleKey[] }> = [
  { id: 'beneficiaries', rules: ['allowed_beneficiaries_only', 'agreement_tolerance_pct'] },
  { id: 'limits', rules: ['per_payment_limit_usd', 'approval_threshold_usd'] },
  { id: 'budget', rules: ['period_budget_usd', 'account_balance_usd'] },
  { id: 'dates', rules: ['duplicate_window_days', 'due_grace_days'] },
  { id: 'currency', rules: [] }, // the market table (AC-76) and the pins
];

export function RuleCard({ group, children }: { group: string; children: ReactNode }) {
  const { t } = useT();
  return (
    <section className="card" aria-labelledby={`${group}-h`}>
      <h2 id={`${group}-h`}>{t(`policy.group.${group}`)}</h2>
      {children}
    </section>
  );
}

// The sentence is the rule's hint: the input points at it with aria-describedby={`${rule}-hint`}. An empty or half-typed box has no value (AC-18).
export function RuleSentence({ rule, value }: { rule: RuleKey; value: string | boolean }) {
  const { t, locale } = useT();
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  const text = typeof value === 'boolean' ? t(`policy.s.${rule}.${value ? 'on' : 'off'}`)
    : Number.isNaN(n) ? t('policy.s.empty') : t(`policy.s.${rule}`, { v: n.toLocaleString(locale) });
  return <span id={`${rule}-hint`} className="muted hint">{text}</span>;
}

export type DiffRow = { invoice_id: string; headline: string; from: Outcome | null; to: Outcome | null; payee?: string; amount?: number; currency?: string; reason?: string };

// from null: the invoice is pending (R-68). to null: pending and not read yet, so there is no outcome to show.
export function DiffList({ rows, unchanged }: { rows: DiffRow[]; unchanged?: number }) {
  const { t, locale } = useT();
  return (
    <>
      <ul className="diff">
        {rows.map((r) => (
          <li key={r.invoice_id}>
            <Link to={`/invoices/${r.invoice_id}`}>{r.payee ? tu('{p}', { p: r.payee }) : r.headline || t('policy.diff.unread')}</Link>
            {r.amount !== undefined && <span className="mono">{`${r.amount.toLocaleString(locale)} ${r.currency ?? ''}`.trim()}</span>}
            {r.to ? <span className="diff-chips"><OutcomeChip outcome={r.from} /> <span aria-hidden="true">→</span> <OutcomeChip outcome={r.to} /></span> : <span>{t('policy.row_unread')}</span>}
            {r.reason && <span className="muted">{r.reason}</span>}
          </li>
        ))}
      </ul>
      {unchanged !== undefined && <p className="muted">{t(`policy.diff.same.${new Intl.PluralRules(locale).select(unchanged) === 'one' ? 'one' : 'other'}`, { n: unchanged })}</p>}
    </>
  );
}
