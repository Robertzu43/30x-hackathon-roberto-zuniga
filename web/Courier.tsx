import { useCallback, useEffect, useState } from 'react'
import { bogotaToday, formatCOP, formatDate } from '../src/lib/format'
import { REASONS, REASON_LABELS, canCourierMark, type Reason, type Status } from '../src/lib/status'
import type { Delivery } from '../src/routes/deliveries'
import { signOut } from './Login'
import { api } from './supabase'

export const telHref = (telefono: string) => `tel:${telefono}`
const STATUS_TEXT: Record<Status, string> = { pendiente: 'Pendiente', asignado: 'Asignado', entregado: 'Entregado', fallido: 'Fallido' }

type Action = { id: string; kind: 'entregado' | 'fallido' }

export function Courier() {
  const [rows, setRows] = useState<Delivery[]>([])
  const [action, setAction] = useState<Action | null>(null)
  const [reason, setReason] = useState<Reason | ''>('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setRows(await api<Delivery[]>('/me/deliveries'))
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  useEffect(() => { load() }, [load])

  const open = (id: string, kind: Action['kind']) => { setAction({ id, kind }); setReason('') }

  async function save() {
    if (!action || (action.kind === 'fallido' && !reason)) return
    try {
      await api(`/deliveries/${action.id}/status`, { method: 'PATCH', body: { status: action.kind, reason: action.kind === 'fallido' ? reason : undefined } })
      setAction(null)
    } catch (e) {
      setError((e as Error).message)
    }
    load()
  }

  return (
    <main className="courier">
      <header className="bar">
        <p className="eyebrow">Rutas del Norte · {formatDate(bogotaToday())}</p>
        <button onClick={signOut}>Salir</button>
      </header>
      <h1>Mis entregas</h1>
      <button onClick={load}>Actualizar</button>
      {error && <p role="alert" className="error">{error}</p>}
      {!rows.length && <p className="muted">No tienes entregas para hoy.</p>}
      <ul className="deliveries">
        {rows.map((d) => (
          <li key={d.id} className="card">
            <p className="row"><strong>{d.pedido}</strong><span className={`badge ${d.status}`}>{STATUS_TEXT[d.status]}</span></p>
            <p>{d.cliente}</p>
            <p><a className="tap" href={telHref(d.telefono)}>{d.telefono}</a></p>
            <p>{d.direccion}, {d.barrio}</p>
            <p>{formatCOP(d.valor)}</p>
            {d.failure_reason && <p className="muted">Motivo: {REASON_LABELS[d.failure_reason]}</p>}
            {canCourierMark(d.status) && action?.id !== d.id && (
              <div className="row">
                <button onClick={() => open(d.id, 'entregado')}>Entregado</button>
                <button className="alt" onClick={() => open(d.id, 'fallido')}>Fallido</button>
              </div>
            )}
            {action?.id === d.id && (
              <div className="stack">
                {action.kind === 'fallido' ? (
                  <fieldset>
                    <legend>Motivo</legend>
                    {REASONS.map((r) => (
                      <label key={r} className="tap"><input type="radio" name={`m-${d.id}`} checked={reason === r} onChange={() => setReason(r)} />{REASON_LABELS[r]}</label>
                    ))}
                  </fieldset>
                ) : (
                  <p>¿Confirmas la entrega del pedido {d.pedido}?</p>
                )}
                <div className="row">
                  <button disabled={action.kind === 'fallido' && !reason} onClick={save}>Confirmar</button>
                  <button className="alt" onClick={() => setAction(null)}>Cancelar</button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </main>
  )
}
