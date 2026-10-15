import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { reset } from './fakeDb'
import { bogotaToday, formatDate } from '../src/lib/format'

const getUserById = vi.fn(async (id: string) => ({ data: { user: { email: `${id}@empresa.co` } }, error: null }))
vi.mock('../src/lib/db', async () => {
  const { fakeClient } = await import('./fakeDb')
  return { adminClient: () => ({ ...fakeClient(), auth: { admin: { getUserById } } }) }
})

import { scheduled } from '../src/cron'

const DISP = '00000000-0000-4000-8000-000000000001'
const C1 = '00000000-0000-4000-8000-000000000002'
const today = bogotaToday()
const d = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`, delivery_date: today, pedido: `P-${n}`,
  cliente: `Cliente ${n}`, telefono: '+573001234567', direccion: `Calle ${n}`, valor: 1, ...extra,
})
const env = { RESEND_API_KEY: 'k', RESEND_FROM: 'a@b.co', SUPABASE_URL: '', SUPABASE_ANON_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '' }
const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'e1' })))

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockClear()
  reset(
    [{ id: DISP, role: 'dispatcher', full_name: 'Carolina' }, { id: C1, role: 'courier', full_name: 'Mensajero 1' }],
    [
      d(1), d(2, { status: 'asignado', courier_id: C1 }), d(3, { status: 'entregado', courier_id: C1 }),
      d(4, { status: 'fallido', courier_id: C1, failure_reason: 'no_estaba' }),
      d(5, { status: 'fallido', courier_id: C1, failure_reason: 'direccion_errada' }),
    ],
  )
})
afterEach(() => vi.unstubAllGlobals())

it('AC-28 emails the dispatcher the day summary through Resend', async () => {
  await scheduled({} as ScheduledController, env)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
  expect(url).toBe('https://api.resend.com/emails')
  const b = JSON.parse(init.body as string)
  expect(b.to).toEqual([`${DISP}@empresa.co`])
  expect(b.subject).toBe(`Cierre del día ${formatDate(today)}`)
  expect(b.html).toMatch(/Entregados?:?\D*1\b/)
  expect(b.html).toMatch(/Fallidos?:?\D*2\b/)
  expect(b.html).toMatch(/Pendientes?:?\D*2\b/)
  expect(b.html).toContain('P-4')
  expect(b.html).toContain('No estaba')
  expect(b.html).toContain('P-5')
  expect(b.html).toContain('Dirección errada')
})
