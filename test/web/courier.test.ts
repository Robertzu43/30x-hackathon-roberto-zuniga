import { describe, expect, it } from 'vitest'
import { telHref } from '../../web/Courier'
import { HOME } from '../../web/Login'

describe('courier screen helpers (AC-02, AC-16)', () => {
  it('sends each role to its own screen', () => {
    expect(HOME).toEqual({ dispatcher: '/', courier: '/mensajero' })
  })
  it('builds a tel: link from the E.164 number', () => {
    expect(telHref('+573001234567')).toBe('tel:+573001234567')
  })
})
