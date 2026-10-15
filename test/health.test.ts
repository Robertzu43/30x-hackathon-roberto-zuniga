import { describe, expect, it } from 'vitest'
import { app } from '../src/app'

// Registered before the first request builds the router.
app.get('/api/__boom', () => {
  throw new Error('secret detail')
})

describe('api shell (AC-22)', () => {
  it('GET /api/health returns { ok: true }', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('unknown /api route returns JSON 404', async () => {
    const res = await app.request('/api/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not found' })
  })

  it('unhandled error returns JSON 500 without leaking the message', async () => {
    const res = await app.request('/api/__boom')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'internal error' })
  })
})
