import { Hono, type Context } from 'hono'
import { requireRole, type AuthEnv } from '../lib/auth'
import { adminClient } from '../lib/db'
import { parseDeliveriesCsv } from '../lib/csv'
import { bogotaToday } from '../lib/format'
import { canAssign, canCourierMark, REASONS, type Reason, type Status } from '../lib/status'

export type Delivery = {
  id: string; delivery_date: string; pedido: string; cliente: string; telefono: string; direccion: string
  barrio: string; valor: number; status: Status; courier_id: string | null; courier_name: string | null
  failure_reason: Reason | null; updated_at: string
}

type C = Context<AuthEnv>
const COLS = '*, courier:profiles(full_name)'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const bad = (c: C, error: string, code: 400 | 403 | 404 | 409 = 400) => c.json({ error }, code)

// Supabase returns errors instead of throwing; throw so app.onError answers 500.
const must = <T>({ data, error }: { data: T; error: unknown }): T => {
  if (error) throw error
  return data
}
const toDelivery = ({ courier, ...r }: Record<string, unknown>) =>
  ({ ...r, courier_name: (courier as { full_name: string } | null)?.full_name ?? null }) as Delivery

const dateParam = (c: C): string | null => {
  const d = c.req.query('date') ?? bogotaToday()
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d)) && new Date(d).toISOString().startsWith(d) ? d : null
}
const body = (c: C): Promise<Record<string, unknown>> =>
  c.req.json().then((b) => (b && typeof b === 'object' ? b : {}), () => ({}))
const dayRows = async (c: C, date: string, courierId?: string) => {
  let q = adminClient(c.env).from('deliveries').select(COLS).eq('delivery_date', date)
  if (courierId) q = q.eq('courier_id', courierId)
  return (must(await q.order('pedido')) as Record<string, unknown>[]).map(toDelivery)
}
const findDelivery = async (c: C, id: string) =>
  UUID.test(id)
    ? (must(await adminClient(c.env).from('deliveries').select('status, courier_id').eq('id', id).maybeSingle()) as
        | { status: Status; courier_id: string | null }
        | null)
    : null
// Guarded on the old status so a concurrent change cannot slip past the check.
const updateDelivery = async (c: C, id: string, from: Status, patch: Record<string, unknown>) => {
  const row = must(
    await adminClient(c.env)
      .from('deliveries')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', from)
      .select(COLS)
      .maybeSingle(),
  ) as Record<string, unknown> | null
  return row ? c.json(toDelivery(row)) : bad(c, 'la entrega cambió, recargue', 409)
}

// Import date is always today's Bogotá date (R-07); a client-sent date is ignored.
const parseImport = async (c: C) => {
  const { csv } = await body(c)
  if (typeof csv !== 'string') return { res: bad(c, 'falta el CSV') }
  const date = bogotaToday()
  const existing = must(await adminClient(c.env).from('deliveries').select('pedido').eq('delivery_date', date)) as { pedido: string }[]
  const parsed = parseDeliveriesCsv(csv, new Set(existing.map((r) => r.pedido)))
  if ('error' in parsed) return { res: bad(c, parsed.error) }
  return { date, ...parsed }
}

export const deliveries = new Hono<AuthEnv>()
const dispatcher = requireRole('dispatcher')
const courier = requireRole('courier')

deliveries.post('/import/preview', dispatcher, async (c) => {
  const p = await parseImport(c)
  return 'res' in p ? p.res : c.json({ date: p.date, valid: p.valid, skipped: p.skipped })
})

deliveries.post('/import/confirm', dispatcher, async (c) => {
  const p = await parseImport(c)
  if ('res' in p) return p.res
  // ponytail: a concurrent confirm of the same pedidos hits unique(delivery_date, pedido) and answers 500; nothing is duplicated.
  if (p.valid.length)
    must(await adminClient(c.env).from('deliveries').insert(p.valid.map((r) => ({ ...r, delivery_date: p.date, status: 'pendiente' }))))
  return c.json({ inserted: p.valid.length, skipped: p.skipped })
})

deliveries.get('/deliveries', dispatcher, async (c) => {
  const date = dateParam(c)
  return date ? c.json(await dayRows(c, date)) : bad(c, 'fecha inválida')
})

deliveries.get('/couriers', dispatcher, async (c) =>
  c.json(must(await adminClient(c.env).from('profiles').select('id, full_name').eq('role', 'courier').order('full_name'))),
)

deliveries.patch('/deliveries/:id/assign', dispatcher, async (c) => {
  const id = c.req.param('id')
  const { courier_id } = await body(c)
  const d = await findDelivery(c, id)
  if (!d) return bad(c, 'entrega no encontrada', 404)
  const isCourier =
    typeof courier_id === 'string' &&
    UUID.test(courier_id) &&
    must(await adminClient(c.env).from('profiles').select('id').eq('id', courier_id).eq('role', 'courier').maybeSingle())
  if (!isCourier) return bad(c, 'mensajero inválido')
  if (!canAssign(d.status)) return bad(c, 'una entrega entregada no se reasigna', 409)
  return updateDelivery(c, id, d.status, { status: 'asignado', courier_id, failure_reason: null })
})

deliveries.get('/me/deliveries', courier, async (c) => {
  const date = dateParam(c)
  return date ? c.json(await dayRows(c, date, c.get('user').id)) : bad(c, 'fecha inválida')
})

deliveries.patch('/deliveries/:id/status', courier, async (c) => {
  const id = c.req.param('id')
  const { status, reason } = await body(c)
  if (status !== 'entregado' && status !== 'fallido') return bad(c, 'estado inválido')
  if (status === 'fallido' && !REASONS.includes(reason as Reason)) return bad(c, 'motivo inválido')
  const d = await findDelivery(c, id)
  if (!d) return bad(c, 'entrega no encontrada', 404)
  if (d.courier_id !== c.get('user').id) return bad(c, 'sin permiso', 403)
  if (!canCourierMark(d.status)) return bad(c, 'la entrega ya fue marcada', 409)
  return updateDelivery(c, id, d.status, { status, failure_reason: status === 'fallido' ? reason : null })
})

deliveries.get('/summary', dispatcher, async (c) => {
  const date = dateParam(c)
  if (!date) return bad(c, 'fecha inválida')
  const rows = await dayRows(c, date)
  const count = (s: Status) => rows.filter((r) => r.status === s).length
  return c.json({
    date,
    entregado: count('entregado'),
    fallido: count('fallido'),
    pendiente: count('pendiente'),
    asignado: count('asignado'),
    failed: rows
      .filter((r) => r.status === 'fallido')
      .map(({ pedido, cliente, direccion, courier_name, failure_reason }) => ({ pedido, cliente, direccion, courier_name, failure_reason })),
  })
})

// Public, no session (AC-23): counts only, never rows or PII. Pendiente = pendiente + asignado (R-05).
deliveries.get('/demo/summary', async (c) => {
  const date = bogotaToday()
  const rows = must(await adminClient(c.env).from('deliveries').select('status').eq('delivery_date', date)) as { status: Status }[]
  const count = (s: Status) => rows.filter((r) => r.status === s).length
  return c.json({ date, entregado: count('entregado'), fallido: count('fallido'), pendiente: count('pendiente') + count('asignado') })
})
