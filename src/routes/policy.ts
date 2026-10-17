// Política and the company section (AC-30, AC-31, AC-32; R-14, R-31, R-34, R-41).
import { z } from 'zod';
import { decide, directorio, findBeneficiary, periodFrom, previousFrom } from '../agent/tools';
import { recordedFields } from '../agent/trace';
import { headline } from '../engine/explain';
import type { Check, Invoice, Outcome, PolicyRules } from '../engine/types';
import { must } from '../lib/supabase';
import { memberRoutes } from './agent';
import { runFromCursor, type Current } from './invoices';

const usd = z.number().nonnegative().nullish();
const days = z.number().int().nonnegative().nullish();
// Every PolicyRules key; unknown keys (a `version`, say) are dropped. Missing or null = that check "no se pudo verificar".
const Rules = z.object({
  per_payment_limit_usd: usd, approval_threshold_usd: usd, period_budget_usd: usd, account_balance_usd: usd,
  duplicate_window_days: days, agreement_tolerance_pct: usd, due_grace_days: days,
  fx_rates: z.record(z.string().regex(/^[A-Z]{3}$/), z.number().positive()).nullish(),
  allowed_beneficiaries_only: z.boolean().nullish(),
}) satisfies z.ZodType<PolicyRules>;
const NewVersion = z.object({ name: z.string().trim().max(100).optional(), rules: Rules });
const INVALID = 'Valor no válido: los montos y los días deben ser números mayores o iguales a 0, y las tasas mayores que 0';
const RACE = 'Otra versión se guardó al mismo tiempo; recarga y vuelve a intentar';

// "Reevaluar" touches only pending and ESCALAR invoices; PAGAR and FRENAR are final (D16, AC-31).
const reopenable = (r: Pick<Current, 'outcome'>) => r.outcome === null || r.outcome === 'ESCALAR';

export const policy = memberRoutes()
  .get('/', async (c) => c.json(must(await c.var.db.from('policies').select('*').eq('company_id', c.var.companyId)
    .order('version', { ascending: false }))))

  // A new version; the database numbers it (R-41), so no version is sent. Then, without writing any decision, which
  // pending or escalated invoices would end differently under it (R-14).
  .put('/', async (c) => {
    const { db, companyId, lang } = c.var;
    const p = NewVersion.safeParse(await c.req.json().catch(() => null));
    if (!p.success) {
      const [a, b] = p.error.issues[0]!.path;
      return c.json({ error: INVALID, field: String((a === 'rules' ? b : a) ?? 'rules') }, 400);
    }
    const previous: { name: string; rules: PolicyRules } | null = must(await db.from('policies').select('name, rules')
      .eq('company_id', companyId).order('version', { ascending: false }).limit(1).maybeSingle());
    const rules: PolicyRules = p.data.rules;
    const { data: saved, error } = await db.from('policies')
      .insert({ company_id: companyId, name: p.data.name || previous?.name || 'Política general', rules }).select().single();
    if (error?.code === '23505') return c.json({ error: RACE }, 409); // unique (company_id, version): a concurrent save won
    if (error) throw new Error(error.message);

    const [rows, directory] = await Promise.all([
      db.from('invoice_current').select('*').eq('company_id', companyId).order('received_at').order('id').then(must) as Promise<Current[]>,
      directorio(db, companyId),
    ]);
    // A decided invoice stored without fields is simulated from its decision's reading; only a never-decided one is unread.
    const ids = rows.filter((r) => !r.fields && r.decision_id).map((r) => r.decision_id);
    const read: Array<{ id: string; checks: Check[] }> = ids.length ? must(await db.from('decisions').select('id, checks').in('id', ids)) : [];
    for (const r of rows) r.fields = recordedFields(r.fields, read.find((d) => d.id === r.decision_id)?.checks);
    const now = new Date().toISOString();
    // One read of earlier invoices covers both windows: the checks filter by their own policy's window.
    const window = { duplicate_window_days: Math.max(previous?.rules.duplicate_window_days ?? 0, rules.duplicate_window_days ?? 0) };
    // R-61, R-68: the same sequential pass "Reevaluar" runs (oldest first), simulated in memory over these rows (R-59): each
    // simulated decision updates committed, paid and previous invoices before the next, so budget freed by a new FRENAR
    // can turn a later ESCALAR into PAGAR. Every pending invoice is listed (`from` null: nobody saw an old outcome);
    // an ESCALAR only when its outcome changes. A pending invoice not yet read cannot be simulated without the model.
    const would_change: Array<{ invoice_id: string; headline: string; from: Outcome | null; to: Outcome | null }> = [];
    let unread_pending = 0;
    for (const row of rows.filter(reopenable)) {
      if (!row.fields) { unread_pending++; would_change.push({ invoice_id: row.id, headline: '', from: null, to: null }); continue; }
      const invoice = { ...row, fields: row.fields } as Invoice;
      const beneficiary = findBeneficiary(invoice.fields.payee_name, directory);
      const period = { ...periodFrom(rows, invoice), previous: previousFrom(rows, invoice, window, directory) };
      const next = decide(invoice, beneficiary, rules, period, now);
      const from = row.outcome;
      Object.assign(row, { outcome: next.outcome, amount_usd: next.amount_usd });
      if (from !== next.outcome) would_change.push({ invoice_id: row.id, headline: headline(next, invoice, beneficiary, lang), from, to: next.outcome });
    }
    // The banner's "el agente pagará <n> factura(s)" counts pending rows too (AC-31, R-68).
    const will_pay = would_change.filter((w) => w.to === 'PAGAR').length;
    return c.json({ policy: saved, would_change, will_pay, unread_pending });
  })

  // Pending and ESCALAR invoices after the cursor (AC-31, R-60); runAgent picks them for the 'reevaluate' trigger.
  .post('/reevaluate', (c) => runFromCursor(c, 'reevaluate'));

const NAME = 'El nombre de la empresa no puede estar vacío';
const CompanyPatch = z.object({
  name: z.string({ error: NAME }).trim().min(1, { error: NAME }).optional(),
  approver_email: z.email({ error: 'El correo del aprobador no es válido' }).optional(),
  lang: z.enum(['es', 'en'], { error: 'El idioma debe ser es o en' }).optional(),
}, { error: 'Datos de la empresa no válidos' });
const COMPANY = 'id, name, approver_email, lang, is_demo';

// The demo company is read-only for every member (R-31); the database refuses it too.
export const company = memberRoutes()
  .get('/', async (c) => c.json(must(await c.var.db.from('companies').select(COMPANY).eq('id', c.var.companyId).single())))
  .put('/', async (c) => {
    const { db, companyId } = c.var;
    const p = CompanyPatch.safeParse(await c.req.json().catch(() => null));
    if (!p.success) return c.json({ error: p.error.issues[0]!.message }, 400);
    const current: { is_demo: boolean } = must(await db.from('companies').select('is_demo').eq('id', companyId).single());
    if (current.is_demo) return c.json({ error: 'La empresa demo es de solo lectura' }, 403);
    return c.json(must(await db.from('companies').update(p.data).eq('id', companyId).select(COMPANY).single()));
  });
