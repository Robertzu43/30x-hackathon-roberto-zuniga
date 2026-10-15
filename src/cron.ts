import type { Env } from './app'
import { adminClient } from './lib/db'
import { sendEmail } from './lib/email'
import { bogotaToday, formatDate } from './lib/format'
import { REASON_LABELS } from './lib/status'
import { summary } from './routes/deliveries'

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)

// Cron 0 23 * * * UTC = 18:00 Bogotá (AC-28).
export const scheduled = async (_c: ScheduledController, env: Env): Promise<void> => {
  const date = bogotaToday()
  const db = adminClient(env)
  const { data: ps, error } = await db.from('profiles').select('id').eq('role', 'dispatcher')
  const p = ps?.[0] as { id: string } | undefined
  if (error || !p) throw error ?? new Error('no dispatcher profile')
  const { data: u, error: ue } = await db.auth.admin.getUserById(p.id)
  const to = u.user?.email
  if (ue || !to) throw ue ?? new Error('dispatcher has no email')
  const s = await summary(env, date)
  const failed = s.failed
    .map((f) => `<li>${esc(f.pedido)} - ${esc(f.cliente)}, ${esc(f.direccion)}: ${f.failure_reason ? REASON_LABELS[f.failure_reason] : 'Sin motivo'}</li>`)
    .join('')
  const html =
    `<p>Entregados: ${s.entregado}</p><p>Fallidos: ${s.fallido}</p><p>Pendientes: ${s.pendiente + s.asignado}</p>` +
    (failed ? `<p>Pedidos fallidos:</p><ul>${failed}</ul>` : '')
  await sendEmail(env, { to, subject: `Cierre del día ${formatDate(date)}`, html })
}
