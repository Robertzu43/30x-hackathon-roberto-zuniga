import { Hono } from 'hono'
import { requireRole, type AuthEnv } from './lib/auth'
import { deliveries } from './routes/deliveries'

export type Env = {
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  SUPABASE_SERVICE_ROLE_KEY: string
  RESEND_API_KEY?: string
  RESEND_FROM: string
}

export const app = new Hono<AuthEnv>()

app.get('/api/health', (c) => c.json({ ok: true }))

app.get('/api/me', requireRole(), (c) => c.json(c.get('user')))

app.route('/api', deliveries)

app.notFound((c) => c.json({ error: 'not found' }, 404))

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: 'internal error' }, 500)
})
