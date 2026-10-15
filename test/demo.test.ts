import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reset } from './fakeDb'
import { bogotaToday } from '../src/lib/format'

vi.mock('../src/lib/db', async () => ({ adminClient: (await import('./fakeDb')).fakeClient }))

import { app } from '../src/app'

const today = bogotaToday()
const d = (n: number, status: string, delivery_date = today) => ({
  id: `d${n}`, delivery_date, pedido: `P-${n}`, cliente: 'Secreto', telefono: '+573001234567', direccion: 'Calle 1', valor: 1, status,
})

beforeEach(() =>
  reset([], [d(1, 'pendiente'), d(2, 'asignado'), d(3, 'asignado'), d(4, 'entregado'), d(5, 'fallido'), d(6, 'entregado', '2020-01-01')]),
)

describe('GET /api/demo/summary (AC-23)', () => {
  it('answers without a session with today counts only, pendiente = pendiente + asignado (R-05)', async () => {
    const res = await app.request('/api/demo/summary')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ date: today, entregado: 1, fallido: 1, pendiente: 3 })
  })
})
