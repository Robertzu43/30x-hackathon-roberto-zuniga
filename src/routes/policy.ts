// Política and the company section (AC-30, AC-31, AC-32; R-14, R-31, R-34, R-41).
import { z } from 'zod';
import { runAgent } from '../agent/loop';
import { decide, directorio, duplicados, findBeneficiary, periodo } from '../agent/tools';
import { headline } from '../engine/explain';
import type { Invoice, Outcome, PolicyRules } from '../engine/types';
import { must } from '../lib/supabase';
import { memberRoutes } from './agent';
import type { Current } from './invoices';

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
    const now = new Date().toISOString();
    // One read of earlier invoices covers both windows: the checks filter by their own policy's window.
    const window = { duplicate_window_days: Math.max(previous?.rules.duplicate_window_days ?? 0, rules.duplicate_window_days ?? 0) };
    const would_change: Array<{ invoice_id: string; headline: string; from: Outcome; to: Outcome }> = [];
    for (const row of rows.filter((r) => reopenable(r) && r.fields)) {
      const invoice = { ...row, fields: row.fields! } as Invoice;
      const beneficiary = findBeneficiary(invoice.fields.payee_name, directory);
      const period = { ...await periodo(db, companyId, invoice), previous: await duplicados(db, companyId, invoice, window, directory) };
      const next = decide(invoice, beneficiary, rules, period, now);
      const from = row.outcome ?? decide(invoice, beneficiary, previous?.rules ?? null, period, now).outcome;
      if (from !== next.outcome) would_change.push({ invoice_id: row.id, headline: headline(next, invoice, beneficiary, lang), from, to: next.outcome });
    }
    return c.json({ policy: saved, would_change });
  })

  .post('/reevaluate', async (c) => {
    const { db, companyId } = c.var;
    const rows: Array<Pick<Current, 'id' | 'outcome'>> = must(await db.from('invoice_current').select('id, outcome').eq('company_id', companyId));
    return c.json(await runAgent({ db, env: c.env }, companyId, rows.filter(reopenable).map((r) => r.id), 'reevaluate'));
  });

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
