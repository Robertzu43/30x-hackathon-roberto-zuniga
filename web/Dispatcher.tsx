import { useCallback, useEffect, useState } from 'react'
import { formatCOP, formatDate } from '../src/lib/format'
import { SKIP_LABELS, type ImportRow, type Skipped } from '../src/lib/csv'
import { REASON_LABELS, type Reason, type Status } from '../src/lib/status'
import type { Delivery } from '../src/routes/deliveries'
import { signOut } from './Login'
import { api } from './supabase'

type Summary = {
  date: string; entregado: number; fallido: number; pendiente: number; asignado: number
  failed: Pick<Delivery, 'pedido' | 'cliente' | 'direccion' | 'courier_name' | 'failure_reason'>[]
}
type Preview = { valid: ImportRow[]; skipped: Skipped[] }

// API codes -> Spanish UI text (R-11); Pendientes = pendiente + asignado (R-05).
export const skipText = (code: string) => SKIP_LABELS[code as Skipped['reason']] ?? code
export const reasonText = (code: string | null) => (code ? (REASON_LABELS[code as Reason] ?? code) : '')
export const pendientes = (s: { pendiente: number; asignado: number }) => s.pendiente + s.asignado
const STATUS_TEXT: Record<Status, string> = { pendiente: 'Pendiente', asignado: 'Asignado', entregado: 'Entregado', fallido: 'Fallido' }

const today = () => new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10) // Bogotá, UTC-5

export function Dispatcher() {
  const [rows, setRows] = useState<Delivery[]>([])
  const [couriers, setCouriers] = useState<{ id: string; full_name: string }[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const [r, s] = await Promise.all([api<Delivery[]>('/deliveries'), api<Summary>('/summary')])
      setRows(r)
      setSummary(s)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  useEffect(() => {
    load()
    api<typeof couriers>('/couriers').then(setCouriers, () => {})
  }, [load])

  async function assign(id: string, courier_id: string) {
    try {
      await api(`/deliveries/${id}/assign`, { method: 'PATCH', body: { courier_id } })
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
    load()
  }

  return (
    <main>
      <header className="bar">
        <p className="eyebrow">Rutas del Norte · {formatDate(today())}</p>
        <button onClick={signOut}>Cerrar sesión</button>
      </header>
      <h1>Despacho</h1>
      {error && <p role="alert" className="error">{error}</p>}
      <Closing s={summary} />
      <ImportCsv onDone={load} />
      <section>
        <h2>Entregas</h2>
        <div className="scroll">
          <table>
            <thead>
              <tr>{['Pedido', 'Cliente', 'Teléfono', 'Dirección', 'Barrio', 'Valor', 'Estado', 'Motivo', 'Mensajero'].map((h) => <th key={h}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id}>
                  <td>{d.pedido}</td><td>{d.cliente}</td><td>{d.telefono}</td><td>{d.direccion}</td><td>{d.barrio}</td>
                  <td>{formatCOP(d.valor)}</td>
                  <td><span className={`badge ${d.status}`}>{STATUS_TEXT[d.status]}</span></td>
                  <td>{reasonText(d.failure_reason)}</td>
                  <td>
                    <select
                      aria-label={`Mensajero del pedido ${d.pedido}`}
                      value={d.courier_id ?? ''}
                      disabled={d.status === 'entregado'}
                      onChange={(e) => assign(d.id, e.target.value)}
                    >
                      <option value="" disabled>Sin asignar</option>
                      {couriers.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <p className="muted">No hay entregas para hoy.</p>}
        </div>
      </section>
    </main>
  )
}

function Closing({ s }: { s: Summary | null }) {
  if (!s) return null
  return (
    <section className="card">
      <h2>Cierre del día</h2>
      <dl className="counts">
        <div><dt>Entregados</dt><dd>{s.entregado}</dd></div>
        <div><dt>Fallidos</dt><dd>{s.fallido}</dd></div>
        <div><dt>Pendientes</dt><dd>{pendientes(s)}</dd></div>
      </dl>
      {s.failed.length > 0 && (
        <div className="scroll">
          <table>
            <thead><tr>{['Pedido', 'Cliente', 'Dirección', 'Mensajero', 'Motivo'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {s.failed.map((f) => (
                <tr key={f.pedido}>
                  <td>{f.pedido}</td><td>{f.cliente}</td><td>{f.direccion}</td><td>{f.courier_name}</td><td>{reasonText(f.failure_reason)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function ImportCsv({ onDone }: { onDone: () => void }) {
  const [csv, setCsv] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const reset = () => { setCsv(''); setPreview(null); setError('') }

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    reset()
    setDone('')
    if (!file) return
    const text = await file.text()
    setCsv(text)
    try {
      setPreview(await api<Preview>('/import/preview', { method: 'POST', body: { csv: text } }))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function confirm() {
    try {
      const r = await api<{ inserted: number }>('/import/confirm', { method: 'POST', body: { csv } })
      reset()
      setDone(`${r.inserted} entregas importadas`)
      onDone()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <section className="card">
      <h2>Importar CSV</h2>
      <p className="muted">Columnas: pedido, cliente, telefono, direccion, barrio, valor. Se importa con la fecha de hoy.</p>
      <input type="file" accept=".csv,text/csv" aria-label="Archivo CSV" onChange={pick} />
      {done && <p role="status">{done}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {preview && (
        <>
          <h3>Filas válidas ({preview.valid.length})</h3>
          {preview.valid.length > 0 && (
            <div className="scroll">
              <table>
                <thead><tr>{['Pedido', 'Cliente', 'Teléfono', 'Dirección', 'Barrio', 'Valor'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>
                  {preview.valid.map((r) => (
                    <tr key={r.pedido}><td>{r.pedido}</td><td>{r.cliente}</td><td>{r.telefono}</td><td>{r.direccion}</td><td>{r.barrio}</td><td>{formatCOP(r.valor)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h3>Filas omitidas ({preview.skipped.length})</h3>
          <ul>
            {preview.skipped.map((s) => <li key={s.line}>Fila {s.line}{s.pedido && ` (pedido ${s.pedido})`}: {skipText(s.reason)}</li>)}
          </ul>
          {preview.valid.length > 0 && <button onClick={confirm}>Confirmar</button>}
        </>
      )}
    </section>
  )
}
