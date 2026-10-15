import { useEffect, useState } from 'react'
import { formatDate } from '../src/lib/format'

// Demo credentials, intentionally public; copied from scripts/seed.mjs (a test keeps them in sync).
export const DEMO_PASSWORD = 'Demo2026!'
export const DEMO_ACCOUNTS = [
  { role: 'Despacho', name: 'Carolina Gómez', email: 'carolina@rutasdelnorte.demo', home: '/' },
  { role: 'Mensajero', name: 'Andrés Pérez', email: 'andres@rutasdelnorte.demo', home: '/mensajero' },
  { role: 'Mensajero', name: 'Luisa Martínez', email: 'luisa@rutasdelnorte.demo', home: '/mensajero' },
]

type Counts = { date: string; entregado: number; fallido: number; pendiente: number }

export function Demo() {
  const [counts, setCounts] = useState<Counts | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    fetch('/api/demo/summary')
      .then((r) => (r.ok ? (r.json() as Promise<Counts>) : Promise.reject(r)))
      .then(setCounts, () => setError(true))
  }, [])

  return (
    <main>
      <p className="eyebrow">Rutas del Norte · Demo</p>
      <h1>Despacho de domicilios sin chats</h1>
      <p>
        Carolina asignaba unos 120 domicilios al día por WhatsApp, un chat por mensajero, y a las 6 p. m. no sabía qué quedó
        pendiente. Ahora carga el CSV de las marcas, asigna cada entrega a un mensajero y ve en una sola pantalla qué se entregó,
        qué falló y por qué. Los mensajeros ven su lista del día en el celular y marcan cada entrega como entregada o fallida con
        un motivo.
      </p>

      <section className="card">
        <h2>Hoy{counts && ` · ${formatDate(counts.date)}`}</h2>
        {error && <p className="error">No se pudieron cargar los datos de hoy.</p>}
        {counts && (
          <dl className="counts">
            <div><dt>Entregados</dt><dd>{counts.entregado}</dd></div>
            <div><dt>Fallidos</dt><dd>{counts.fallido}</dd></div>
            <div><dt>Pendientes</dt><dd>{counts.pendiente}</dd></div>
          </dl>
        )}
      </section>

      <section className="card">
        <h2>Cuentas de demostración</h2>
        <p className="muted">Contraseña para las tres cuentas: <code>{DEMO_PASSWORD}</code></p>
        <div className="scroll">
          <table>
            <thead><tr><th>Rol</th><th>Nombre</th><th>Correo</th></tr></thead>
            <tbody>
              {DEMO_ACCOUNTS.map((a) => (
                <tr key={a.email}><td>{a.role}</td><td>{a.name}</td><td><code>{a.email}</code></td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="row links">
          <a className="button" href="/">Abrir como despacho</a>
          <a className="button alt" href="/mensajero">Abrir como mensajero</a>
        </p>
      </section>
    </main>
  )
}
