import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { bogotaToday } from '../src/lib/format';

const env = process.env;
describe.skipIf(!env.SUPABASE_SERVICE_ROLE_KEY)('seed (live Supabase)', () => {
  it('is idempotent, splits statuses, and anon sees nothing', async () => {
    for (let i = 0; i < 2; i++) execFileSync('node', ['scripts/seed.mjs'], { env, stdio: 'pipe' });
    const admin = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data, error } = await admin.from('deliveries').select('status').like('pedido', 'RDN-%').eq('delivery_date', bogotaToday());
    expect(error).toBeNull();
    const counts: Record<string, number> = {};
    for (const r of data!) counts[r.status] = (counts[r.status] ?? 0) + 1;
    expect(data).toHaveLength(12);
    expect(counts).toEqual({ pendiente: 2, asignado: 4, entregado: 4, fallido: 2 });
    const anon = createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!);
    const res = await anon.from('deliveries').select('id');
    expect(res.data ?? []).toHaveLength(0);
  }, 60000);
});
