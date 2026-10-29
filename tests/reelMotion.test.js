import { describe, expect, it } from 'vitest'
import { REEL_SYMBOLS, TIMING } from '../src/game/config.js'
import { buildProfile, mod } from '../src/game/reelMotion.js'

describe('beweging van de cijferrollen', () => {
  for (const total of [TIMING.reel1Stop, TIMING.reel2Stop]) {
    it(`stopt na ${total} ms exact op het doelsymbool, vanaf elke startpositie`, () => {
      for (let p0 = 0; p0 < 12; p0++) {
        for (let target = 0; target < REEL_SYMBOLS; target++) {
          const prof = buildProfile(p0, target, total)
          expect(prof.T).toBe(total / 1000)
          const end = prof.at(prof.T).p
          expect(mod(end, REEL_SYMBOLS)).toBe(target)
          expect(Math.abs(prof.at(prof.T - 1e-9).p - end)).toBeLessThan(1e-3)
        }
      }
    })
  }

  it('draait vooruit tot de stop, schiet licht door en veert terug', () => {
    const prof = buildProfile(3, 2, TIMING.reel2Stop)
    let prev = -Infinity
    for (let t = 0; t <= prof.Tm; t += 0.01) {
      const { p, v } = prof.at(t)
      expect(p).toBeGreaterThanOrEqual(prev)
      expect(v).toBeGreaterThanOrEqual(0)
      prev = p
    }
    const atStop = prof.at(prof.Tm).p
    expect(atStop).toBeGreaterThan(prof.land) // doorgeschoten
    expect(prof.at(prof.T).p).toBe(prof.land) // teruggeveerd
    expect(prof.Tm * 1000).toBeCloseTo(TIMING.reel2Stop - TIMING.reelSettle, 6)
  })

  it('draait op volle snelheid ruim rond (geen simpel wisselen van cijfers)', () => {
    const prof = buildProfile(0, 0, TIMING.reel2Stop)
    expect(prof.at(2).v).toBeGreaterThan(15) // symbolen per seconde
    expect(prof.land).toBeGreaterThan(5 * REEL_SYMBOLS)
  })
})
