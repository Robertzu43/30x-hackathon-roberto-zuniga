// Beneficiarios: the directory the agent consults (AC-33). Rows are never deleted; a reset archives them (AC-47).
import { z } from 'zod';
import type { Context } from 'hono';
import type { AppEnv } from '../lib/auth';
import { must } from '../lib/supabase';
import { memberRoutes } from './agent';

const text = z.string().trim().max(200).nullish();
const Beneficiary = z.object({
  name: z.string().trim().min(1).max(200),
  country: z.string().regex(/^[A-Z]{2}$/).nullish(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullish(),
  bank_account: text,
  route: text,
  category: text,
  agreement: z.object({
    type: z.enum(['retainer', 'hourly', 'subscription', 'one_off']),
    amount_usd: z.number().positive().optional(),
    cap_usd: z.number().positive().optional(),
    period: z.literal('monthly').optional(),
    valid_until: z.iso.date().optional(),
  }).nullish(),
});

// The parsed body, or the 400 answer naming the first bad field.
async function parse(c: Context<AppEnv>) {
  const p = Beneficiary.safeParse(await c.req.json().catch(() => null));
  return p.success ? p.data : c.json({ error: 'Revisa el beneficiario: hay un dato no válido', field: String(p.error.issues[0]!.path[0] ?? 'name') }, 400);
}

export const beneficiaries = memberRoutes()
  .get('/', async (c) => c.json(must(await c.var.db.from('beneficiaries').select('*').eq('company_id', c.var.companyId)
    .eq('archived', false).order('name'))))
  .post('/', async (c) => {
    const b = await parse(c);
    if (b instanceof Response) return b;
    return c.json(must(await c.var.db.from('beneficiaries').insert({ ...b, company_id: c.var.companyId }).select().single()), 201);
  })
  .put('/:id', async (c) => {
    const b = await parse(c);
    if (b instanceof Response) return b;
    const row = must(await c.var.db.from('beneficiaries').update({ ...b, updated_at: new Date().toISOString() })
      .eq('id', c.req.param('id')).eq('company_id', c.var.companyId).select().maybeSingle());
    return row ? c.json(row) : c.json({ error: 'Beneficiario no encontrado' }, 404);
  });
