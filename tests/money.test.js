import { describe, expect, it } from 'vitest'
import { DRAW_TURNS } from '../src/game/config.js'
import { drawValueCents, formatCents, totalCents } from '../src/game/money.js'
import { makeGame } from './helpers.js'

const r = (round) => ({ round, bid: null })
const v = (bid) => ({ round: 'veiling', bid })

describe('financiële berekeningen', () => {
  it('€10 per reguliere uitslag, veiling = betaald bod', () => {
    expect(drawValueCents(r(1))).toBe(1000)
    expect(drawValueCents(r(2))).toBe(1000)
    expect(drawValueCents(v(20))).toBe(2000)
    expect(drawValueCents(v(0.5))).toBe(50)
  })

  it('voorbeelden uit de spelregels', () => {
    expect(formatCents(totalCents([r(1), r(2)]))).toBe('€20')
    expect(formatCents(totalCents([r(1), r(2), v(20)]))).toBe('€40')
    expect(formatCents(totalCents([r(1), r(2), v(0.5), v(0.5)]))).toBe('€21')
    expect(formatCents(totalCents([]))).toBe('€0')
  })

  it('rekent in centen: geen afrondingsfouten', () => {
    expect(formatCents(totalCents([v(0.1), v(0.2)]))).toBe('€0,30')
    expect(formatCents(totalCents([r(1), v(12.25)]))).toBe('€22,25')
    expect(formatCents(totalCents([v(0.01)]))).toBe('€0,01')
  })

  it('totalen na een volledig spel kloppen per deelnemer en in totaal', () => {
    const game = makeGame({ seed: 21 })
    for (let i = 0; i < DRAW_TURNS; i++) game.spin()
    game.finishPending()
    for (let p = 0; p < 9; p++) {
      expect(totalCents(game.state.draws.filter((d) => d.participant === p))).toBe(2000)
    }
    const bids = [20, 0.5, 0.5, 12.25, 1, 30, 0.01, 7.5]
    bids.forEach((bid, i) => {
      game.prepare(i % 3, bid)
      game.spin()
    })
    game.finishPending()
    const s = game.state
    const expected = 18 * 1000 + bids.reduce((sum, b) => sum + Math.round(b * 100), 0)
    expect(totalCents(s.draws)).toBe(expected)
    const perPerson = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((p) => totalCents(s.draws.filter((d) => d.participant === p)))
    expect(perPerson.reduce((a, b) => a + b, 0)).toBe(expected)
    expect(perPerson[0]).toBe(2000 + 2000 + 1225 + 1) // Ruud: 2x €10 + €20 + €12,25 + €0,01
  })
})
