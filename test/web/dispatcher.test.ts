import { describe, expect, it } from 'vitest'
import { pendientes, reasonText, skipText } from '../../web/Dispatcher'

describe('dispatcher UI mapping (R-11, R-05)', () => {
  it('maps every CSV skip code to its Spanish text', () => {
    expect(['falta_telefono', 'falta_direccion', 'duplicado', 'telefono_invalido', 'valor_invalido'].map((c) => skipText(c))).toEqual([
      'Falta teléfono', 'Falta dirección', 'Pedido duplicado', 'Teléfono inválido', 'Valor inválido',
    ])
  })
  it('maps failure reason codes to Spanish and null to a dash', () => {
    expect(['no_estaba', 'direccion_errada', 'rechazado', 'otro'].map((c) => reasonText(c))).toEqual([
      'No estaba', 'Dirección errada', 'Rechazado', 'Otro',
    ])
    expect(reasonText(null)).toBe('')
  })
  it('sums pendiente and asignado into Pendientes', () => {
    expect(pendientes({ pendiente: 2, asignado: 4 })).toBe(6)
  })
})
