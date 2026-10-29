import { describe, expect, it } from 'vitest'
import { clock, estimateOffset } from '../src/game/clock.js'
import { createInitialState } from '../src/game/engine.js'
import { STOP_DELAY, releaseDelay } from '../src/game/timeline.js'
import { restoreState } from '../src/game/useGame.js'
import { deriveView } from '../src/game/view.js'
import { makeGame } from './helpers.js'

describe('herstel van een onderbroken draai', () => {
  const game = makeGame({ seed: 9 })
  game.spin() // eerste draai loopt nog
  const saved = JSON.stringify(game.state)
  const spin = game.state.spin

  it('herladen tijdens het draaien: de draai loopt op de juiste plek verder', () => {
    const restored = restoreState(saved)
    const view = deriveView(restored, spin.startedAt + 2000)
    expect(view.reelSpin).toEqual(spin)
    expect(view.state.spin).toEqual(spin)
    expect(view.state.draws).toHaveLength(0)
  })

  it('herladen na het stoppen: de uitslag is vastgelegd en wordt nog getoond', () => {
    const view = deriveView(restoreState(saved), spin.startedAt + STOP_DELAY + 500)
    expect(view.state.draws.map((d) => d.resultId)).toEqual([spin.resultId])
    expect(view.reveal).toEqual(spin)
  })

  it('later terugkomen: alles verwerkt, volgende beurt vrij', () => {
    const view = deriveView(restoreState(saved), spin.startedAt + releaseDelay(spin) + 3_600_000)
    expect(view.state.turn).toBe(1)
    expect(view.locked).toBe(false)
    expect(view.reveal).toBeNull()
  })

  it('dezelfde uitslag, hoe vaak er ook wordt hersteld', () => {
    const a = deriveView(restoreState(saved), spin.startedAt + 10_000).state
    const b = deriveView(restoreState(saved), spin.startedAt + 10_000).state
    expect(a).toEqual(b)
    expect(a.draws[0].resultId).toBe(spin.resultId)
  })

  it('onbekende, oude of beschadigde opslag geeft een nieuw spel', () => {
    expect(restoreState(null)).toEqual(createInitialState())
    expect(restoreState('{kapot')).toEqual(createInitialState())
    expect(restoreState(JSON.stringify({ version: 1, phase: 'auction' }))).toEqual(createInitialState())
  })

  it('opslag van vóór deze versie (zonder lastSpin) blijft bruikbaar', () => {
    const old = { ...createInitialState(), turn: 3 }
    delete old.lastSpin
    const restored = restoreState(JSON.stringify(old))
    expect(restored.lastSpin).toBeNull()
    expect(restored.turn).toBe(3)
  })
})

describe('gedeelde klok', () => {
  it('corrigeert voor het verschil met de serverklok', () => {
    const before = clock.now()
    clock.setOffset(5000)
    expect(clock.now() - before).toBeGreaterThanOrEqual(5000)
    clock.setOffset(0)
  })

  it('schat de afwijking uit één meting (halve looptijd)', () => {
    // verzonden op 1000, server zegt 6050, ontvangen op 1100 -> afwijking 5000
    expect(estimateOffset(1000, 6050, 1100)).toBe(5000)
  })
})
