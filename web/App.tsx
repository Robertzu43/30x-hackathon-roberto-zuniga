import { Courier } from './Courier'
import { Dispatcher } from './Dispatcher'
import { Login } from './Login'

// No router lib: the Worker serves index.html for every non-API path (SPA fallback).
export function App() {
  const path = location.pathname.replace(/\/+$/, '') || '/'
  if (path === '/mensajero') return <Login role="courier"><Courier /></Login>
  if (path === '/demo') return <Page title="Demo" />
  if (path === '/') return <Login role="dispatcher"><Dispatcher /></Login>
  return <Page title="Página no encontrada" />
}

function Page({ title }: { title: string }) {
  return (
    <main>
      <p className="eyebrow">Rutas del Norte</p>
      <h1>{title}</h1>
    </main>
  )
}
