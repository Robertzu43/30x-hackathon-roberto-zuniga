import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reset, tables } from './fakeDb'
import { bogotaToday } from '../src/lib/format'

vi.mock('../src/lib/db', async () => ({ adminClient: (await import('./fakeDb')).fakeClient }))

import { app } from '../src/app'
import type { Delivery } from '../src/routes/deliveries'
import type { ImportRow, Skipped } from '../src/lib/csv'

type Import = { date: string; valid: ImportRow[]; skipped: Skipped[]; inserted: number }

const DISP = '00000000-0000-4000-8000-000000000001'
const C1 = '00000000-0000-4000-8000-000000000002'
const C2 = '00000000-0000-4000-8000-000000000003'
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const today = bogotaToday()
const HEADER = 'pedido,cliente,telefono,direccion,barrio,valor'

const d = (n: number, extra: Record<string, unknown> = {}) => ({
  id: id(n), delivery_date: today, pedido: `P-${String(n).padStart(3, '0')}`, cliente: `Cliente ${n}`,
  telefono: '+573001234567', direccion: `Calle ${n}`, valor: 45000, ...extra,
})

beforeEach(() =>
  reset(
    [
      { id: DISP, role: 'dispatcher', full_name: 'Carolina' },
      { id: C1, role: 'courier', full_name: 'Mensajero 1' },
      { id: C2, role: 'courier', full_name: 'Mensajero 2' },
    ],
    [
      d(1),
      d(2, { status: 'asignado', courier_id: C1 }),
      d(3, { status: 'asignado', courier_id: C2 }),
      d(4, { status: 'entregado', courier_id: C1 }),
      d(5, { status: 'fallido', courier_id: C2, failure_reason: 'no_estaba' }),
      d(6, { delivery_date: '2020-01-01' }),
    ],
  ),
)

const call = (method: string, path: string, token: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
const row = (n: number) => tables.deliveries.find((r) => r.id === id(n))!

describe('CSV import (AC-07..AC-11)', () => {
  const csv = [HEADER, 'P-100,Ana,3001112233,Cra 1,Centro,45.000', 'P-101,Luis,,Cra 2,Norte,1000', 'P-001,Dup,3001112233,Cra 3,Sur,1000'].join('\n')

  it('preview lists valid and skipped rows (incl. DB duplicate) and writes nothing', async () => {
    const res = await call('POST', '/api/import/preview', DISP, { csv })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Import
    expect(body.date).toBe(today)
    expect(body.valid.map((r: { pedido: string }) => r.pedido)).toEqual(['P-100'])
    expect(body.skipped).toEqual([
      { line: 2, pedido: 'P-101', reason: 'falta_telefono' },
      { line: 3, pedido: 'P-001', reason: 'duplicado' },
    ])
    expect(tables.deliveries).toHaveLength(6)
  })

  it('confirm inserts only valid rows as pendiente for today', async () => {
    const res = await call('POST', '/api/import/confirm', DISP, { csv })
    expect(res.status).toBe(200)
    expect(((await res.json()) as Import).inserted).toBe(1)
    const added = tables.deliveries.find((r) => r.pedido === 'P-100')!
    expect(added).toMatchObject({ status: 'pendiente', delivery_date: today, telefono: '+573001112233', valor: 45000 })
    expect(tables.deliveries).toHaveLength(7)
  })

  it('confirming the same file twice skips everything as duplicado (AC-09)', async () => {
    await call('POST', '/api/import/confirm', DISP, { csv })
    const res = await call('POST', '/api/import/confirm', DISP, { csv })
    const body = (await res.json()) as Import
    expect(body.inserted).toBe(0)
    expect(body.skipped.find((s) => s.pedido === 'P-100')?.reason).toBe('duplicado')
    expect(tables.deliveries).toHaveLength(7)
  })

  it('missing columns -> 400 with Spanish error, nothing written (AC-11)', async () => {
    const res = await call('POST', '/api/import/confirm', DISP, { csv: 'pedido,cliente,telefono,direccion\nP-1,a,3001112233,b' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Faltan columnas: barrio, valor' })
    expect(tables.deliveries).toHaveLength(6)
  })

  it('missing csv or malformed JSON -> 400', async () => {
    expect((await call('POST', '/api/import/preview', DISP, {})).status).toBe(400)
    expect((await call('POST', '/api/import/preview', DISP, '{nope')).status).toBe(400)
  })

  it('import ignores a client-sent date and always uses today (R-07)', async () => {
    const res = await call('POST', '/api/import/confirm', DISP, { csv, date: '2020-01-01' })
    expect(res.status).toBe(200)
    expect(tables.deliveries.find((r) => r.pedido === 'P-100')!.delivery_date).toBe(today)
  })
})

describe('dispatcher board (AC-12)', () => {
  it('lists only the date deliveries, ordered by pedido, with courier_name', async () => {
    const res = await call('GET', '/api/deliveries', DISP)
    expect(res.status).toBe(200)
    const list = (await res.json()) as Delivery[]
    expect(list.map((r: { pedido: string }) => r.pedido)).toEqual(['P-001', 'P-002', 'P-003', 'P-004', 'P-005'])
    expect(list[1]).toMatchObject({ courier_id: C1, courier_name: 'Mensajero 1', status: 'asignado' })
    expect(list[0].courier_name).toBeNull()
    expect(list[0]).not.toHaveProperty('courier')
  })

  it('?date= selects another day; bad date -> 400', async () => {
    const res = await call('GET', '/api/deliveries?date=2020-01-01', DISP)
    expect(((await res.json()) as Delivery[]).map((r: { pedido: string }) => r.pedido)).toEqual(['P-006'])
    expect((await call('GET', '/api/deliveries?date=15/10/2026', DISP)).status).toBe(400)
    expect((await call('GET', '/api/deliveries?date=2026-02-30', DISP)).status).toBe(400)
  })

  it('lists couriers only', async () => {
    const res = await call('GET', '/api/couriers', DISP)
    expect(await res.json()).toEqual([
      { id: C1, full_name: 'Mensajero 1' },
      { id: C2, full_name: 'Mensajero 2' },
    ])
  })
})

describe('assign / reassign (AC-13, AC-14, R-03)', () => {
  const assign = (n: number, courier_id: unknown) => call('PATCH', `/api/deliveries/${id(n)}/assign`, DISP, { courier_id })

  it('pendiente -> asignado with courier', async () => {
    const res = await assign(1, C1)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'asignado', courier_id: C1, courier_name: 'Mensajero 1' })
    expect(row(1)).toMatchObject({ status: 'asignado', courier_id: C1 })
  })

  it('reassign fallido -> asignado to new courier, reason cleared', async () => {
    const res = await assign(5, C1)
    expect(res.status).toBe(200)
    expect(row(5)).toMatchObject({ status: 'asignado', courier_id: C1, failure_reason: null })
  })

  it('entregado -> 409, unchanged', async () => {
    expect((await assign(4, C2)).status).toBe(409)
    expect(row(4)).toMatchObject({ status: 'entregado', courier_id: C1 })
  })

  it('unknown delivery -> 404', async () => {
    expect((await assign(99, C1)).status).toBe(404)
    expect((await call('PATCH', '/api/deliveries/not-a-uuid/assign', DISP, { courier_id: C1 })).status).toBe(404)
  })

  it('courier_id that is not a courier -> 400', async () => {
    expect((await assign(1, DISP)).status).toBe(400)
    expect((await assign(1, 'x')).status).toBe(400)
    expect((await assign(1, undefined)).status).toBe(400)
    expect(row(1).status).toBe('pendiente')
  })
})

describe('courier (AC-05, AC-16..AC-19, R-04)', () => {
  const mark = (token: string, n: number, body: unknown) => call('PATCH', `/api/deliveries/${id(n)}/status`, token, body)

  it('my deliveries lists only own deliveries for today', async () => {
    const res = await call('GET', '/api/me/deliveries', C1)
    expect(res.status).toBe(200)
    expect(((await res.json()) as Delivery[]).map((r: { pedido: string }) => r.pedido)).toEqual(['P-002', 'P-004'])
  })

  it('entregado on own asignado -> 200', async () => {
    const res = await mark(C1, 2, { status: 'entregado' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'entregado', failure_reason: null })
    expect(row(2).status).toBe('entregado')
  })

  it("courier A marking courier B's delivery -> 403, unchanged", async () => {
    expect((await mark(C1, 3, { status: 'entregado' })).status).toBe(403)
    expect(row(3).status).toBe('asignado')
  })

  it('fallido without reason -> 400', async () => {
    expect((await mark(C1, 2, { status: 'fallido' })).status).toBe(400)
    expect(row(2).status).toBe('asignado')
  })

  it('fallido + lluvia -> 400', async () => {
    expect((await mark(C1, 2, { status: 'fallido', reason: 'lluvia' })).status).toBe(400)
  })

  it('unknown status -> 400', async () => {
    expect((await mark(C1, 2, { status: 'pendiente' })).status).toBe(400)
  })

  it('fallido + otro -> 200 with reason stored', async () => {
    const res = await mark(C1, 2, { status: 'fallido', reason: 'otro' })
    expect(res.status).toBe(200)
    expect(row(2)).toMatchObject({ status: 'fallido', failure_reason: 'otro' })
  })

  it('re-marking an entregado -> 409', async () => {
    expect((await mark(C1, 4, { status: 'fallido', reason: 'otro' })).status).toBe(409)
    expect(row(4).status).toBe('entregado')
  })

  it('unknown delivery -> 404', async () => {
    expect((await mark(C1, 99, { status: 'entregado' })).status).toBe(404)
  })

  it('dispatcher endpoints -> 403 for courier, nothing changes (AC-04)', async () => {
    const before = JSON.stringify(tables.deliveries)
    const csv = `${HEADER}\nP-200,Ana,3001112233,Cra 1,Centro,1000`
    for (const [m, p, b] of [
      ['POST', '/api/import/preview', { csv }],
      ['POST', '/api/import/confirm', { csv }],
      ['GET', '/api/deliveries'],
      ['GET', '/api/couriers'],
      ['PATCH', `/api/deliveries/${id(1)}/assign`, { courier_id: C1 }],
      ['GET', '/api/summary'],
    ] as const)
      expect((await call(m, p, C1, b)).status, p).toBe(403)
    expect(JSON.stringify(tables.deliveries)).toBe(before)
  })

  it('no token -> 401', async () => {
    expect((await app.request('/api/me/deliveries')).status).toBe(401)
  })
})

describe('summary (AC-20, R-05)', () => {
  it('counts and failed list match fixture', async () => {
    const res = await call('GET', '/api/summary', DISP)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      date: today, entregado: 1, fallido: 1, pendiente: 1, asignado: 2,
      failed: [{ pedido: 'P-005', cliente: 'Cliente 5', direccion: 'Calle 5', courier_name: 'Mensajero 2', failure_reason: 'no_estaba' }],
    })
  })
})
