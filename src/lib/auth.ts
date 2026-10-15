import type { MiddlewareHandler } from 'hono'
import type { Env } from '../app'
import { adminClient } from './db'

export type Role = 'dispatcher' | 'courier'
export type AuthUser = { id: string; role: Role; full_name: string }
export type AuthEnv = { Bindings: Env; Variables: { user: AuthUser } }

export const requireRole =
  (...roles: Role[]): MiddlewareHandler<AuthEnv> =>
  async (c, next) => {
    const token = /^Bearer (.+)$/.exec(c.req.header('Authorization') ?? '')?.[1]
    let user: AuthUser | null = null
    if (token) {
      try {
        const db = adminClient(c.env)
        const { data, error } = await db.auth.getUser(token)
        if (!error && data.user) {
          const { data: p } = await db
            .from('profiles')
            .select('role, full_name')
            .eq('id', data.user.id)
            .maybeSingle()
          if (p) user = { id: data.user.id, role: p.role, full_name: p.full_name }
        }
      } catch (e) {
        console.error('auth lookup failed', e) // fail closed: 401, never 500
      }
    }
    if (!user) return c.json({ error: 'no autenticado' }, 401)
    if (roles.length && !roles.includes(user.role)) return c.json({ error: 'sin permiso' }, 403)
    c.set('user', user)
    await next()
  }
