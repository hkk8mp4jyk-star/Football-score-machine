import { afterEach, describe, expect, it, vi } from 'vitest'
import { secureId, secureRandomInt } from '../src/game/random.js'
import { pickRandomResult } from '../src/game/engine.js'
import { RESULTS } from '../src/game/config.js'

// Chi-kwadraattoets: is de verdeling over `k` uitkomsten gelijkmatig?
function chiSquare(counts, expected) {
  return counts.reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0)
}
// Kritieke waarde voor 25 vrijheidsgraden bij p = 0,0001 (zeer ruim, om
// toevallige mislukking praktisch uit te sluiten).
const CHI2_DF25 = 59.7

afterEach(() => vi.restoreAllMocks())

describe('veilige willekeur', () => {
  it('geeft altijd een geheel getal binnen het bereik', () => {
    for (const n of [1, 2, 8, 18, 26]) {
      for (let i = 0; i < 2000; i++) {
        const x = secureRandomInt(n)
        expect(Number.isInteger(x) && x >= 0 && x < n).toBe(true)
      }
    }
  })

  it('weigert een ongeldig bereik', () => {
    expect(() => secureRandomInt(0)).toThrow(RangeError)
    expect(() => secureRandomInt(2.5)).toThrow(RangeError)
  })

  it('gebruikt rejection sampling: waarden boven de grens worden opnieuw getrokken', () => {
    const values = [4294967295, 7] // 2^32-1 valt bij n=3 buiten de eerlijke grens
    const spy = vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation((buf) => {
      buf[0] = values.shift()
      return buf
    })
    expect(secureRandomInt(3)).toBe(7 % 3)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('is gelijkmatig verdeeld over 26 uitkomsten (chi-kwadraat)', () => {
    const k = 26
    const samples = 260_000
    const counts = Array(k).fill(0)
    for (let i = 0; i < samples; i++) counts[secureRandomInt(k)]++
    expect(chiSquare(counts, samples / k)).toBeLessThan(CHI2_DF25)
  })

  it('kiest elke resterende uitslag met dezelfde kans', () => {
    const remaining = RESULTS.map((r) => r.id)
    const counts = Object.fromEntries(remaining.map((id) => [id, 0]))
    const samples = 130_000
    for (let i = 0; i < samples; i++) counts[pickRandomResult(remaining)]++
    expect(chiSquare(Object.values(counts), samples / remaining.length)).toBeLessThan(CHI2_DF25)
  })

  it("maakt unieke draai-ID's", () => {
    const ids = new Set(Array.from({ length: 1000 }, secureId))
    expect(ids.size).toBe(1000)
  })
})
