import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { bogotaToday } from '../src/lib/format';

const env = process.env;
describe.skipIf(!env.SUPABASE_SERVICE_ROLE_KEY)('seed (live Supabase)', () => {
  it('is idempotent, replaces all of today, keeps other days, and anon sees nothing (R-08, R-11)', async () => {
    const admin = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!);
    const today = bogotaToday();
    const old = '2020-01-02';
    const extra = { cliente: 'Prueba', telefono: '+573001234567', direccion: 'Calle 1', valor: 1000 };
    // a CSV-imported row today must go; a row on another day must stay
    const ins = await admin.from('deliveries').upsert([
      { ...extra, delivery_date: today, pedido: 'SEEDTEST-CSV' },
      { ...extra, delivery_date: old, pedido: 'SEEDTEST-OLD' },
    ], { onConflict: 'delivery_date,pedido' });
    expect(ins.error).toBeNull();
    for (let i = 0; i < 2; i++) execFileSync('node', ['scripts/seed.mjs'], { env, stdio: 'pipe' });
    const { data, error } = await admin.from('deliveries').select('status').eq('delivery_date', today);
    expect(error).toBeNull();
    const counts: Record<string, number> = {};
    for (const r of data!) counts[r.status] = (counts[r.status] ?? 0) + 1;
    expect(data).toHaveLength(12);
    expect(counts).toEqual({ pendiente: 2, asignado: 4, entregado: 4, fallido: 2 });
    const kept = await admin.from('deliveries').delete().eq('delivery_date', old).eq('pedido', 'SEEDTEST-OLD').select('id');
    expect(kept.data).toHaveLength(1);
    const anon = createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!);
    const res = await anon.from('deliveries').select('id');
    expect(res.data ?? []).toHaveLength(0);
  }, 60000);
});
