import { describe, expect, it } from 'vitest'
import { AUCTION_LOTS, DRAW_TURNS, OTHER_ID, PARTICIPANTS, RESULTS, ROUNDS, TURN_ORDER } from '../src/game/config.js'

describe('spelregels', () => {
  it('heeft 26 unieke uitslagen: 0-0 t/m 4-4 plus Overige, geen 5 goals', () => {
    const ids = RESULTS.map((r) => r.id)
    expect(ids).toHaveLength(26)
    expect(new Set(ids).size).toBe(26)
    expect(ids).toContain(OTHER_ID)
    expect(ids.filter((id) => id.includes('5'))).toEqual([])
  })

  it('heeft 9 deelnemers, 2 rondes, 18 vaste trekkingen en 8 veilingkavels', () => {
    expect(PARTICIPANTS).toHaveLength(9)
    expect(ROUNDS).toBe(2)
    expect(DRAW_TURNS).toBe(18)
    expect(AUCTION_LOTS).toBe(8)
  })

  it('beurtvolgorde: ronde 1 van 1 t/m 9, ronde 2 van 9 t/m 1', () => {
    expect(TURN_ORDER.slice(0, 9).map((t) => t.participant)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(TURN_ORDER.slice(9).map((t) => t.participant)).toEqual([8, 7, 6, 5, 4, 3, 2, 1, 0])
    expect(TURN_ORDER.slice(0, 9).every((t) => t.round === 1)).toBe(true)
    expect(TURN_ORDER.slice(9).every((t) => t.round === 2)).toBe(true)
  })

  it('iedere deelnemer heeft precies 2 vaste beurten', () => {
    const counts = PARTICIPANTS.map((_, i) => TURN_ORDER.filter((t) => t.participant === i).length)
    expect(counts).toEqual(Array(9).fill(2))
  })
})
