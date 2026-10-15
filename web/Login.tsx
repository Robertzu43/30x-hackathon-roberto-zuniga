import { useEffect, useState, type ReactNode } from 'react'
import { api, supabase } from './supabase'

type Role = 'dispatcher' | 'courier'
// Role probe: each endpoint answers 403 to the other role.
const PROBE: Record<Role, string> = { dispatcher: '/couriers', courier: '/me/deliveries' }
export const HOME: Record<Role, string> = { dispatcher: '/', courier: '/mensajero' }

export const signOut = () => supabase.auth.signOut()

// Gate: login form -> role check -> children.
export function Login({ role, children }: { role: Role; children: ReactNode }) {
  const [session, setSession] = useState<'loading' | 'out' | 'in'>('loading')
  const [ok, setOk] = useState<boolean | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ? 'in' : 'out'))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s ? 'in' : 'out'))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session !== 'in') return setOk(null)
    api(PROBE[role]).then(
      () => setOk(true),
      (e) => {
        setOk(e.status === 403 ? false : null)
        // Wrong role: send the user to their own screen (AC-02).
        if (e.status === 403) location.replace(HOME[role === 'dispatcher' ? 'courier' : 'dispatcher'])
      },
    )
  }, [session, role])

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const { error } = await supabase.auth.signInWithPassword({ email: String(f.get('email')), password: String(f.get('password')) })
    setError(error ? 'Correo o contraseña incorrectos' : '')
  }

  if (session === 'loading') return <main><p>Cargando…</p></main>
  if (session === 'out')
    return (
      <main>
        <p className="eyebrow">Rutas del Norte</p>
        <h1>Iniciar sesión</h1>
        <form onSubmit={submit} className="card stack">
          <label>Correo<input name="email" type="email" required autoComplete="username" /></label>
          <label>Contraseña<input name="password" type="password" required autoComplete="current-password" /></label>
          {error && <p role="alert" className="error">{error}</p>}
          <button type="submit">Entrar</button>
        </form>
      </main>
    )
  return ok ? <>{children}</> : <main><p>{ok === false ? 'Redirigiendo…' : 'Cargando…'}</p></main>
}
