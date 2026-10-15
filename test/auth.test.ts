import { beforeEach, describe, expect, it, vi } from 'vitest'

const stub = vi.hoisted(() => ({
  getUser: vi.fn(),
  profile: vi.fn(),
}))

vi.mock('../src/lib/db', () => ({
  adminClient: () => ({
    auth: { getUser: stub.getUser },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: stub.profile }) }) }),
  }),
}))

import { app } from '../src/app'
import { requireRole } from '../src/lib/auth'

app.get('/api/__dispatcher', requireRole('dispatcher'), (c) => c.json({ ok: true }))

const get = (path: string, token?: string) =>
  app.request(path, token === undefined ? {} : { headers: { Authorization: `Bearer ${token}` } })

const login = (role: 'dispatcher' | 'courier') => {
  stub.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
  stub.profile.mockResolvedValue({ data: { role, full_name: 'Ana Pérez' }, error: null })
}

const noAuth = { error: 'no autenticado' }

describe('auth middleware (AC-03, AC-04)', () => {
  beforeEach(() => {
    stub.getUser.mockReset()
    stub.profile.mockReset()
  })

  it('no Authorization header -> 401', async () => {
    const res = await get('/api/__dispatcher')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual(noAuth)
    expect(stub.getUser).not.toHaveBeenCalled()
  })

  it('non-Bearer scheme -> 401', async () => {
    const res = await app.request('/api/me', { headers: { Authorization: 'Basic abc' } })
    expect(res.status).toBe(401)
  })

  it('garbage token (getUser returns error) -> 401', async () => {
    stub.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad jwt' } })
    const res = await get('/api/__dispatcher', 'garbage')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual(noAuth)
  })

  it('supabase client throws on getUser -> 401, not 500', async () => {
    stub.getUser.mockRejectedValue(new Error('network down'))
    const res = await get('/api/__dispatcher', 'x')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual(noAuth)
  })

  it('valid user without profile -> 401', async () => {
    stub.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    stub.profile.mockResolvedValue({ data: null, error: null })
    expect((await get('/api/__dispatcher', 't')).status).toBe(401)
  })

  it('profile lookup throws -> 401, not 500', async () => {
    stub.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    stub.profile.mockRejectedValue(new Error('db down'))
    expect((await get('/api/__dispatcher', 't')).status).toBe(401)
  })

  it('courier on dispatcher route -> 403', async () => {
    login('courier')
    const res = await get('/api/__dispatcher', 't')
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'sin permiso' })
  })

  it('dispatcher on dispatcher route -> 200', async () => {
    login('dispatcher')
    expect((await get('/api/__dispatcher', 't')).status).toBe(200)
  })

  it('GET /api/me returns the user for any role', async () => {
    login('courier')
    const res = await get('/api/me', 't')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'u1', role: 'courier', full_name: 'Ana Pérez' })
  })

  it('GET /api/me without token -> 401', async () => {
    expect((await get('/api/me')).status).toBe(401)
  })
})
