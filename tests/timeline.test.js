import { describe, expect, it } from 'vitest'
import { TIMING } from '../src/game/config.js'
import { STOP_DELAY, commitDelay, holdDelay, isMegaWin, releaseDelay, tileStageAt } from '../src/game/timeline.js'
import { deriveView } from '../src/game/view.js'
import { makeGame } from './helpers.js'

const drawSpin = (resultId = '3-1') => ({ id: 'x', resultId, participant: 0, round: 1, bid: null, startedAt: 0 })
const auctionSpin = (resultId = '3-1') => ({ ...drawSpin(resultId), round: 'veiling', bid: 10 })

describe('tijdlijn van een draai', () => {
  it('rollen: rol 1 na 3 s, rol 2 staat stil na 4,28 s (4,5 s inclusief terugveren)', () => {
    expect(TIMING.reel1Stop).toBe(3000)
    expect(TIMING.reel2Stop).toBe(4500)
    expect(STOP_DELAY).toBe(4280)
  })

  it('ronde: vastleggen bij stilstand, volgende beurt 3 s later', () => {
    expect(commitDelay(drawSpin())).toBe(4280)
    expect(releaseDelay(drawSpin())).toBe(7280)
  })

  it('ronde met MEGA WIN: volgende beurt pas na de animatie (4,2 s)', () => {
    expect(releaseDelay(drawSpin('2-1'))).toBe(4280 + 4200)
  })

  it('veiling: 0,8 s uitslag, 0,9 s groen, 0,7 s verdwijnen', () => {
    const s = auctionSpin()
    expect(holdDelay(s)).toBe(800)
    expect(tileStageAt(s, 4280 + 799)).toBeNull()
    expect(tileStageAt(s, 4280 + 800)).toBe('green')
    expect(tileStageAt(s, 4280 + 1699)).toBe('green')
    expect(tileStageAt(s, 4280 + 1700)).toBe('fade')
    expect(tileStageAt(s, 4280 + 2399)).toBe('fade')
    expect(commitDelay(s)).toBe(4280 + 2400)
    expect(releaseDelay(s)).toBe(commitDelay(s))
  })

  it('veiling met MEGA WIN: vak licht pas op na de animatie', () => {
    const s = auctionSpin('0-0')
    expect(tileStageAt(s, 4280 + 4199)).toBeNull()
    expect(tileStageAt(s, 4280 + 4200)).toBe('green')
    expect(commitDelay(s)).toBe(4280 + 4200 + 1600)
  })
})

describe('weergave per moment (alle telefoons gelijk)', () => {
  it('ronde: draaien -> onthullen -> beurt vrij', () => {
    const game = makeGame({ seed: 2 })
    game.spin()
    const spin = game.state.spin
    const t0 = spin.startedAt

    const draaien = deriveView(game.state, t0 + 1000)
    expect(draaien.state.spin).toEqual(spin)
    expect(draaien.reelSpin).toEqual(spin)
    expect(draaien.reveal).toBeNull()
    // Geen voortijdige onthulling via overzicht of teller.
    expect(draaien.state.draws).toHaveLength(0)
    expect(draaien.state.remaining).toContain(spin.resultId)
    expect(draaien.nextChangeAt).toBe(t0 + STOP_DELAY)

    const onthuld = deriveView(game.state, t0 + STOP_DELAY)
    expect(onthuld.state.spin).toBeNull()
    expect(onthuld.state.draws.at(-1).resultId).toBe(spin.resultId)
    expect(onthuld.reveal).toEqual(spin)
    expect(onthuld.locked).toBe(true)
    expect(onthuld.reelSpin).toEqual(spin) // rol veert nog terug

    const vrij = deriveView(game.state, t0 + releaseDelay(spin))
    expect(vrij.reveal).toBeNull()
    expect(vrij.locked).toBe(false)
    expect(vrij.reelSpin).toBeNull()
    expect(vrij.nextChangeAt).toBeNull()
  })

  it('na de laatste trekking blijft de uitslag staan tot "Start de veiling"', () => {
    const game = makeGame({ seed: 4 })
    for (let i = 0; i < 18; i++) game.spin()
    const last = game.state.spin
    const t = last.startedAt + releaseDelay(last) + 60_000
    const view = deriveView(game.state, t)
    expect(view.state.phase).toBe('auction')
    expect(view.reveal).toEqual(last)
    expect(view.locked).toBe(false)
    expect(deriveView(game.state, t, { auctionStart: last.id }).reveal).toBeNull()
  })

  it('veiling: vak groen, verdwijnen, dan vastgelegd', () => {
    const game = makeGame({ seed: 6 })
    game.dispatch({ type: 'DEMO_SKIP_TO_AUCTION' })
    // Een niet-MEGA uitslag van het bord, zodat de gewone timing geldt.
    const target = game.state.remaining.find((id) => !isMegaWin(id))
    const t0 = 50_000
    const spin = { id: 'a1', resultId: target, participant: 3, round: 'veiling', bid: 20, startedAt: t0 }
    const s = { ...game.state, auctionTurn: { participant: 3, bid: 20 }, spin }

    expect(deriveView(s, t0 + STOP_DELAY + 100).tileStage).toBeNull()
    expect(deriveView(s, t0 + STOP_DELAY + 800).tileStage).toEqual({ resultId: target, stage: 'green' })
    expect(deriveView(s, t0 + STOP_DELAY + 1700).tileStage).toEqual({ resultId: target, stage: 'fade' })
    const done = deriveView(s, t0 + STOP_DELAY + 2400)
    expect(done.tileStage).toBeNull()
    expect(done.state.remaining).not.toContain(target)
    expect(done.state.draws.at(-1)).toMatchObject({ resultId: target, participant: 3, bid: 20 })
    expect(done.state.auctionTurn).toBeNull()
    // Tijdens draaien en vasthouden staat het vak nog op het bord.
    expect(deriveView(s, t0 + STOP_DELAY + 2399).state.remaining).toContain(target)
  })

  it('plant de volgende verversing op het eerstvolgende overgangsmoment', () => {
    const t0 = 0
    const s = { ...makeGame().state, phase: 'auction', auctionBoard: ['3-1'], remaining: ['3-1'] }
    const spin = { ...auctionSpin('3-1'), startedAt: t0 }
    const st = { ...s, spin }
    const moments = []
    let now = t0
    for (let i = 0; i < 10; i++) {
      const v = deriveView(st, now)
      if (v.nextChangeAt == null) break
      moments.push(v.nextChangeAt - t0)
      now = v.nextChangeAt
    }
    expect(moments).toEqual([4280, 4500, 5080, 5980, 6680])
  })
})
