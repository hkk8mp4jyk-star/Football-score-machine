import { describe, expect, it } from 'vitest'
import { DRAW_TURNS, RESULTS, TURN_ORDER } from '../src/game/config.js'
import { createInitialState, reducer, settle } from '../src/game/engine.js'
import { STOP_DELAY, commitDelay, isMegaWin, releaseDelay } from '../src/game/timeline.js'
import { secureRandomInt } from '../src/game/random.js'
import { makeGame } from './helpers.js'

const ALL = RESULTS.map((r) => r.id)

function playRounds(game) {
  for (let i = 0; i < DRAW_TURNS; i++) game.spin()
  game.finishPending()
  return game.state
}

function playAuction(game, bids) {
  const lots = game.state.auctionBoard.length
  for (let i = 0; i < lots; i++) {
    const [participant, bid] = bids[i % bids.length]
    game.prepare(participant, bid)
    game.spin()
  }
  game.finishPending()
  return game.state
}

describe('twee reguliere rondes', () => {
  it('volgt de beurtvolgorde en geeft iedereen 2 uitslagen', () => {
    const game = makeGame({ seed: 7 })
    const s = playRounds(game)
    expect(s.draws).toHaveLength(18)
    expect(s.draws.map((d) => d.participant)).toEqual(TURN_ORDER.map((t) => t.participant))
    expect(s.draws.map((d) => d.round)).toEqual(TURN_ORDER.map((t) => t.round))
    for (let p = 0; p < 9; p++) expect(s.draws.filter((d) => d.participant === p)).toHaveLength(2)
  })

  it('gaat na 18 trekkingen naar de veiling met 8 vaste kavels', () => {
    const s = playRounds(makeGame({ seed: 3 }))
    expect(s.phase).toBe('auction')
    expect(s.remaining).toHaveLength(8)
    expect(s.auctionBoard).toHaveLength(8)
    // Vaste posities in de volgorde van het overzicht.
    expect(s.auctionBoard).toEqual(ALL.filter((id) => s.remaining.includes(id)))
  })

  it('de beurt schuift pas op als de trekking is vastgelegd', () => {
    const game = makeGame()
    game.spin()
    const spin = game.state.spin
    expect(game.state.turn).toBe(0)
    game.at(spin.startedAt + STOP_DELAY - 1).dispatch({ type: 'NOOP' })
    expect(game.state.turn).toBe(0)
    game.at(spin.startedAt + STOP_DELAY).dispatch({ type: 'NOOP' })
    expect(game.state.turn).toBe(1)
  })
})

describe('veiling', () => {
  it('verkoopt alle 8 kavels aan de vrijgegeven kopers en eindigt het spel', () => {
    const game = makeGame({ seed: 11 })
    playRounds(game)
    const board = game.state.auctionBoard
    const s = playAuction(game, [[0, 20], [4, 0.5], [8, 12.25]])
    expect(s.phase).toBe('finished')
    expect(s.remaining).toEqual([])
    const sold = s.draws.filter((d) => d.round === 'veiling')
    expect(sold).toHaveLength(8)
    expect(sold.map((d) => d.resultId).sort()).toEqual([...board].sort())
    expect(sold[0]).toMatchObject({ participant: 0, bid: 20 })
    expect(sold[1]).toMatchObject({ participant: 4, bid: 0.5 })
    expect(s.auctionBoard).toEqual(board) // posities veranderen nooit
  })

  it('zonder vrijgegeven beurt kan niemand draaien', () => {
    const game = makeGame()
    playRounds(game)
    const before = game.state
    game.dispatch({ type: 'SPIN_START' })
    expect(game.state.spin).toBeNull()
    expect(game.state).toEqual(before)
  })

  it('kan geen nieuwe veiling klaarzetten zolang de vorige draai loopt', () => {
    const game = makeGame()
    playRounds(game)
    game.prepare(2, 10)
    game.spin()
    const spin = game.state.spin
    game.at(spin.startedAt + commitDelay(spin) - 1).dispatch({ type: 'AUCTION_PREPARE', participant: 5, bid: 99 })
    expect(game.state.auctionTurn).toEqual({ participant: 2, bid: 10 })
    game.at(spin.startedAt + commitDelay(spin)).dispatch({ type: 'AUCTION_PREPARE', participant: 5, bid: 99 })
    expect(game.state.auctionTurn).toEqual({ participant: 5, bid: 99 })
    expect(game.state.draws.at(-1)).toMatchObject({ participant: 2, bid: 10 })
  })
})

describe('unieke trekkingen', () => {
  it('nooit een uitslag twee keer, over 300 volledige spellen met echte willekeur', () => {
    for (let g = 0; g < 300; g++) {
      const game = makeGame({ randomInt: secureRandomInt })
      playRounds(game)
      const s = playAuction(game, [[g % 9, 5]])
      const ids = s.draws.map((d) => d.resultId)
      expect(ids).toHaveLength(26)
      expect(new Set(ids).size).toBe(26)
      expect([...ids].sort()).toEqual([...ALL].sort())
    }
  })

  it('kiest alleen uit uitslagen die er nog zijn', () => {
    const game = makeGame({ seed: 5 })
    for (let i = 0; i < DRAW_TURNS; i++) {
      game.spin()
      const spin = game.state.spin
      expect(game.state.remaining).toContain(spin.resultId)
      expect(game.state.draws.map((d) => d.resultId)).not.toContain(spin.resultId)
    }
  })
})

describe('één geldige SPIN per beurt', () => {
  it('een tweede SPIN tijdens een lopende draai wordt genegeerd', () => {
    const game = makeGame()
    game.spin()
    const first = game.state.spin
    game.dispatch({ type: 'SPIN_START' })
    game.advance(1000).dispatch({ type: 'SPIN_START' })
    expect(game.state.spin).toEqual(first)
  })

  it('na de trekking pas weer SPIN als de beurt is vrijgegeven', () => {
    const game = makeGame()
    game.spin()
    const spin = game.state.spin
    const release = spin.startedAt + releaseDelay(spin)
    game.at(release - 1).dispatch({ type: 'SPIN_START' })
    expect(game.state.spin).toBeNull()
    expect(game.state.draws).toHaveLength(1)
    game.at(release).dispatch({ type: 'SPIN_START' })
    expect(game.state.spin).not.toBeNull()
  })

  it('bij een MEGA WIN wacht de volgende beurt tot de animatie voorbij is', () => {
    const megaFirst = (n) => 0 // eerste resterende uitslag: 0-0 (MEGA WIN)
    const game = makeGame({ randomInt: megaFirst })
    game.spin()
    const spin = game.state.spin
    expect(isMegaWin(spin.resultId)).toBe(true)
    expect(releaseDelay(spin)).toBe(STOP_DELAY + 4200)
    game.at(spin.startedAt + STOP_DELAY + 3000).dispatch({ type: 'SPIN_START' })
    expect(game.state.spin).toBeNull()
  })

  it('na het einde van het spel kan niemand meer draaien', () => {
    const game = makeGame()
    playRounds(game)
    playAuction(game, [[1, 1]])
    game.advance(60_000).dispatch({ type: 'SPIN_START' })
    expect(game.state.phase).toBe('finished')
    expect(game.state.spin).toBeNull()
  })
})

describe('vastleggen en herstel', () => {
  it('een geaccepteerde draai ligt direct vast: uitslag, deelnemer en starttijd', () => {
    const game = makeGame()
    game.spin()
    expect(game.state.spin).toMatchObject({ participant: 0, round: 1, startedAt: game.now })
    expect(ALL).toContain(game.state.spin.resultId)
  })

  it('verwerken is puur en idempotent: elke telefoon komt op hetzelfde uit', () => {
    const game = makeGame()
    game.spin()
    const raw = JSON.parse(JSON.stringify(game.state)) // zoals opgeslagen of verstuurd
    const t = raw.spin.startedAt + STOP_DELAY + 10
    expect(settle(raw, t)).toEqual(settle(game.state, t))
    expect(settle(settle(raw, t), t)).toEqual(settle(raw, t))
  })

  it('demo: direct naar de veiling', () => {
    const s = reducer(createInitialState(), { type: 'DEMO_SKIP_TO_AUCTION', now: 5 })
    expect(s.phase).toBe('auction')
    expect(s.draws).toHaveLength(18)
    expect(s.lastSpin).toBeNull()
    expect(new Set(s.draws.map((d) => d.resultId)).size).toBe(18)
  })

  it('reset zet alles terug', () => {
    const game = makeGame()
    game.spin()
    expect(reducer(game.state, { type: 'RESET' })).toEqual(createInitialState())
  })
})
