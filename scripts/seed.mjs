import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'node:url';

export const DEMO_PASSWORD = 'Demo2026!';
export const DEMO_USERS = [
  { email: 'carolina@rutasdelnorte.demo', full_name: 'Carolina Gómez', role: 'dispatcher' },
  { email: 'andres@rutasdelnorte.demo', full_name: 'Andrés Pérez', role: 'courier' },
  { email: 'luisa@rutasdelnorte.demo', full_name: 'Luisa Martínez', role: 'courier' },
];

// [cliente, telefono, direccion, barrio, valor]
const ROWS = [
  ['Juliana Ríos', '+573001110001', 'Calle 127 # 15-40', 'Santa Bárbara', 85000],
  ['Camilo Torres', '+573001110002', 'Carrera 7 # 72-10', 'Chapinero', 120000],
  ['Marta Quintero', '+573001110003', 'Calle 140 # 11-25', 'Cedritos', 64000],
  ['Felipe Salazar', '+573001110004', 'Carrera 19 # 100-20', 'Chicó', 230000],
  ['Diana Ortega', '+573001110005', 'Calle 134 # 7B-83', 'Usaquén', 47500],
  ['Sebastián Mora', '+573001110006', 'Avenida 19 # 118-30', 'Santa Bárbara', 98000],
  ['Paola Herrera', '+573001110007', 'Carrera 15 # 85-12', 'Chicó Norte', 150000],
  ['Nicolás Vega', '+573001110008', 'Calle 116 # 18-60', 'Santa Bárbara', 72000],
  ['Laura Mejía', '+573001110009', 'Carrera 11 # 93-45', 'El Nogal', 310000],
  ['Héctor Cárdenas', '+573001110010', 'Calle 147 # 13-20', 'Cedritos', 56000],
  ['Natalia Rojas', '+573001110011', 'Carrera 9 # 80-05', 'Chapinero Alto', 89000],
  ['Andrés Bernal', '+573001110012', 'Calle 152 # 54-10', 'Colina Campestre', 133000],
];
// pedido index -> [status, courier index (null = unassigned), failure_reason]
const PLAN = [
  ['pendiente'], ['pendiente'],
  ['asignado', 0], ['asignado', 1], ['asignado', 0], ['asignado', 1],
  ['entregado', 0], ['entregado', 1], ['entregado', 0], ['entregado', 1],
  ['fallido', 0, 'no_estaba'], ['fallido', 1, 'direccion_errada'],
];

export async function seed(url, key) {
  const db = createClient(url, key, { auth: { persistSession: false } });
  const ids = [];
  for (const u of DEMO_USERS) {
    let { data, error } = await db.auth.admin.createUser({ email: u.email, password: DEMO_PASSWORD, email_confirm: true });
    if (error) {
      // already registered: find it
      const { data: list, error: e2 } = await db.auth.admin.listUsers({ perPage: 1000 });
      if (e2) throw e2;
      data = { user: list.users.find((x) => x.email === u.email) };
      if (!data.user) throw error;
    }
    ids.push(data.user.id);
    const { error: pe } = await db.from('profiles').upsert({ id: data.user.id, full_name: u.full_name, role: u.role });
    if (pe) throw pe;
  }
  const today = new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10); // Bogota UTC-5
  const { error: de } = await db.from('deliveries').delete().like('pedido', 'RDN-%');
  if (de) throw de;
  const rows = ROWS.map(([cliente, telefono, direccion, barrio, valor], i) => ({
    delivery_date: today, pedido: `RDN-${1001 + i}`, cliente, telefono, direccion: `${direccion}, Bogotá`, barrio, valor,
    status: PLAN[i][0], courier_id: PLAN[i][1] === undefined ? null : ids[1 + PLAN[i][1]], failure_reason: PLAN[i][2] ?? null,
  }));
  const { error: ie } = await db.from('deliveries').insert(rows);
  if (ie) throw ie;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  await seed(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  console.log('seeded 12 deliveries');
}
