import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../../web/Demo'

// /demo copies the seed credentials literally; this keeps them from drifting (AC-23).
const seed = readFileSync('scripts/seed.mjs', 'utf8')

describe('demo page credentials (AC-23)', () => {
  it('shows the dispatcher and both couriers with the seed password', () => {
    expect(seed).toContain(`DEMO_PASSWORD = '${DEMO_PASSWORD}'`)
    expect(DEMO_ACCOUNTS.map((a) => a.home)).toEqual(['/', '/mensajero', '/mensajero'])
    for (const a of DEMO_ACCOUNTS) expect(seed).toContain(`email: '${a.email}'`)
  })
})
