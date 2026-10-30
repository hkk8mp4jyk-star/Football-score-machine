// F1: de engine met instelbare spellen — volledige spellen voor alle
// combinaties, veiling 0–10, geld, MEGA WIN/OVERIG, willekeur en de
// onveranderde DEMO (referentie van de engine vóór F1).
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ALL_RESULTS, DRAW_TURNS, OTHER_ID, TIMING } from '../src/game/config.js'
import { STATE_VERSION, createInitialState, createReducer, currentTurn } from '../src/game/engine.js'
import { DEFAULT_CONFIG, auctionLots, drawTurns, turnOrder } from '../src/game/gameConfig.js'
import { potCents, totalCents } from '../src/game/money.js'
import { secureRandomInt } from '../src/game/random.js'
import { STOP_DELAY, releaseDelay, spinIsMega } from '../src/game/timeline.js'
import { restoreState } from '../src/game/useGame.js'
import { deriveView } from '../src/game/view.js'
import { SCORES, makeConfig, makeGame, seededRandomInt } from './helpers.js'

const ALL_IDS = ALL_RESULTS.map((r) => r.id)

// Kies een pool van `size` uitslagen (altijd met OVERIG) en willekeurige MEGA's.
function randomPool(size, rnd) {
  const scores = [...SCORES]
  for (let i = scores.length - 1; i > 0; i--) {
    const j = rnd(i + 1)
    ;[scores[i], scores[j]] = [scores[j], scores[i]]
  }
  const pool = [...scores.slice(0, size - 1), OTHER_ID]
  const mega = pool.filter((id) => id !== OTHER_ID && rnd(3) === 0)
  return { pool, mega }
}

// Speelt een volledig spel zoals de app: elke beurt na vrijgave, in de veiling
// per kavel een koper + bod. Houdt alle draaien bij.
function playFullGame(config, { seed = 1, bidFor = (i) => (i % 3) + 0.5 } = {}) {
  const game = makeGame({ seed, config })
  const spins = []
  for (;;) {
    game.waitForRelease() // legt de vorige draai vast; daarna kan het spel klaar zijn
    if (game.state.phase !== 'draw') break
    game.dispatch({ type: 'SPIN_START' })
    spins.push(game.state.spin)
  }
  const lots = game.state.auctionBoard?.length ?? 0
  for (let i = 0; i < lots; i++) {
    const buyer = config.players[i % config.players.length].id
    game.prepare(buyer, bidFor(i))
    game.spin()
    spins.push(game.state.spin)
  }
  game.finishPending()
  return { state: game.state, spins, lots }
}

function checkFinishedGame(config, { state, spins, lots }) {
  const n = config.players.length
  const fixed = n * config.rounds
  expect(state.phase).toBe('finished')
  expect(state.remaining).toEqual([])
  expect(state.draws).toHaveLength(config.pool.length)
  // Elke uitslag precies één keer, en alleen uit de pool.
  expect(new Set(state.draws.map((d) => d.resultId)).size).toBe(config.pool.length)
  expect(new Set(state.draws.map((d) => d.resultId))).toEqual(new Set(config.pool))
  // Vaste rondes: slangvolgorde, ieder precies één keer per ronde.
  const regular = state.draws.filter((d) => d.round !== 'veiling')
  expect(regular).toHaveLength(fixed)
  expect(regular.map((d) => [d.participant, d.round])).toEqual(turnOrder(state.config).map((t) => [t.participant, t.round]))
  for (const p of config.players) {
    for (let r = 1; r <= config.rounds; r++) expect(regular.filter((d) => d.participant === p.id && d.round === r)).toHaveLength(1)
  }
  // Veiling: precies A kavels.
  expect(state.draws.filter((d) => d.round === 'veiling')).toHaveLength(lots)
  expect(lots).toBe(config.pool.length - fixed)
  // MEGA WIN vastgelegd bij elke draai, nooit bij OVERIG.
  for (const s of spins) {
    expect(s.mega).toBe(state.config.mega.includes(s.resultId))
    if (s.resultId === OTHER_ID) expect(s.mega).toBe(false)
  }
}

describe('volledige spellen voor alle combinaties', () => {
  it('1–12 spelers × 1–4 rondes, met veiling 0, middelste en maximaal aantal kavels', () => {
    const rnd = seededRandomInt(2026)
    let games = 0
    for (let n = 1; n <= 12; n++) {
      for (let r = 1; r <= 4; r++) {
        const fixed = n * r
        const maxLots = Math.min(10, 50 - fixed)
        for (const lots of new Set([0, Math.floor(maxLots / 2), maxLots])) {
          const { pool, mega } = randomPool(fixed + lots, rnd)
          const config = makeConfig({ n, rounds: r, pool, mega, priceCents: 250 })
          checkFinishedGame(config, playFullGame(config, { seed: games + 1 }))
          games++
        }
      }
    }
    expect(games).toBe(144)
  })

  it('12 spelers × 4 rondes met alle 50 uitslagen: 48 vaste trekkingen, 2 kavels', () => {
    const config = makeConfig({ n: 12, rounds: 4, pool: ALL_IDS, mega: ['0-0', '6-6'] })
    const result = playFullGame(config)
    checkFinishedGame(config, result)
    expect(result.lots).toBe(2)
  })

  it('1 speler, 1 ronde, alleen OVERIG: één trekking, klaar', () => {
    const config = makeConfig({ n: 1, rounds: 1, pool: [OTHER_ID] })
    const { state } = playFullGame(config)
    expect(state.draws).toEqual([expect.objectContaining({ resultId: OTHER_ID, participant: 0, round: 1 })])
    expect(state.phase).toBe('finished')
  })

  it('variabele namen en speelvolgorde: beurten volgen de volgorde, id’s blijven vast', () => {
    const config = { ...makeConfig({ n: 3, rounds: 2 }), players: [{ id: 5, name: 'Sanne' }, { id: 0, name: 'Lars' }, { id: 11, name: 'Bas' }] }
    const { state } = playFullGame(config)
    expect(state.draws.map((d) => d.participant)).toEqual([5, 0, 11, 11, 0, 5])
    expect(state.config.players.map((p) => p.name)).toEqual(['Sanne', 'Lars', 'Bas'])
  })
})

describe('veiling: 0 tot en met 10 kavels', () => {
  it('0 kavels: na de laatste vaste trekking direct klaar, geen veiling mogelijk', () => {
    const config = makeConfig({ n: 3, rounds: 2, lots: 0 })
    const game = makeGame({ config })
    for (let i = 0; i < 5; i++) game.spin()
    expect(game.state.phase).toBe('draw')
    game.spin()
    game.at(game.state.spin.startedAt + STOP_DELAY).dispatch({ type: 'NOOP' })
    expect(game.state).toMatchObject({ phase: 'finished', auctionBoard: null, remaining: [] })
    expect(deriveView(game.state, game.now).state.phase).toBe('finished')
    const before = game.state
    game.advance(60_000).dispatch({ type: 'AUCTION_PREPARE', participant: 0, bid: 5 })
    game.dispatch({ type: 'SPIN_START' })
    expect(game.state).toEqual(before)
  })

  it('10 kavels: bord met 10 vaste posities in overzichtsvolgorde', () => {
    const config = makeConfig({ n: 4, rounds: 2, lots: 10, pool: [...SCORES.slice(20, 37), OTHER_ID] })
    const game = makeGame({ config })
    while (game.state.phase === 'draw') game.spin()
    game.finishPending()
    const board = game.state.auctionBoard
    expect(board).toHaveLength(10)
    expect(board).toEqual(ALL_IDS.filter((id) => game.state.remaining.includes(id)))
    for (let i = 0; i < 10; i++) {
      game.prepare(i % 4, 1)
      game.spin()
      expect(game.state.auctionBoard).toEqual(board) // posities veranderen nooit
    }
    game.finishPending()
    expect(game.state.phase).toBe('finished')
  })

  it('veiling klaarzetten alleen voor een bestaande speler en een geldig bod', () => {
    const config = makeConfig({ n: 2, rounds: 1, lots: 2 })
    const game = makeGame({ config })
    game.spin()
    game.spin()
    game.finishPending()
    const before = game.state
    for (const [participant, bid] of [[5, 1], [0, -1], [0, NaN], [0, '5'], [0, Infinity]]) {
      game.dispatch({ type: 'AUCTION_PREPARE', participant, bid })
      expect(game.state).toEqual(before)
    }
    game.dispatch({ type: 'AUCTION_PREPARE', participant: 1, bid: 0 })
    expect(game.state.auctionTurn).toEqual({ participant: 1, bid: 0 })
  })
})

describe('geld: prijs per vaste trekking en biedingen', () => {
  it('€0 per vaste trekking: alleen biedingen tellen', () => {
    const config = makeConfig({ n: 3, rounds: 2, lots: 2, priceCents: 0 })
    const { state } = playFullGame(config, { bidFor: (i) => [12.5, 0.25][i] })
    expect(potCents(state)).toBe(1275)
    for (const p of config.players) {
      const mine = state.draws.filter((d) => d.participant === p.id)
      const bids = mine.filter((d) => d.round === 'veiling').reduce((s, d) => s + Math.round(d.bid * 100), 0)
      expect(totalCents(mine, 0)).toBe(bids)
    }
  })

  it('€7,50 per vaste trekking: pot = N × R × prijs + biedingen', () => {
    const config = makeConfig({ n: 5, rounds: 3, lots: 4, priceCents: 750 })
    const { state } = playFullGame(config, { bidFor: (i) => i * 2.5 })
    expect(potCents(state)).toBe(15 * 750 + (0 + 250 + 500 + 750))
  })

  it('DEMO: standaard €10 (ook zonder instellingen in de status)', () => {
    const { state } = playFullGame(DEFAULT_CONFIG, { bidFor: () => 3 })
    expect(potCents(state)).toBe(18 * 1000 + 8 * 300)
    expect(totalCents(state.draws)).toBe(potCents(state))
    const { config: _, ...withoutConfig } = state
    expect(potCents(withoutConfig)).toBe(potCents(state))
  })
})

describe('MEGA WIN en OVERIG', () => {
  it('eigen MEGA-uitslagen bepalen de wachttijd; andere uitslagen niet', () => {
    const config = makeConfig({ n: 1, rounds: 1, lots: 0, pool: [OTHER_ID] })
    const mega = { id: 'x', resultId: '3-3', participant: 0, round: 1, bid: null, startedAt: 0, mega: true }
    const plain = { ...mega, resultId: '0-0', mega: false } // 0-0 is standaard MEGA, hier uit
    expect(spinIsMega(mega)).toBe(true)
    expect(spinIsMega(plain)).toBe(false)
    expect(releaseDelay(mega)).toBe(STOP_DELAY + TIMING.megaWin)
    expect(releaseDelay(plain)).toBe(STOP_DELAY + TIMING.nextTurnDelay)
    expect(validateConfigCodes(config)).toEqual([])
  })

  it('oudere draai zonder MEGA-vlag valt terug op de standaardlijst', () => {
    expect(spinIsMega({ resultId: '0-0', round: 1, startedAt: 0 })).toBe(true)
    expect(spinIsMega({ resultId: '4-4', round: 1, startedAt: 0 })).toBe(false)
  })

  it('OVERIG wordt nooit MEGA WIN, ook niet via de instellingen', () => {
    expect(() => createInitialState(makeConfig({ n: 1, rounds: 1, pool: [OTHER_ID], mega: [OTHER_ID] }))).toThrow(/mega_overig/)
  })
})

function validateConfigCodes(config) {
  return createInitialStateErrors(config)
}
function createInitialStateErrors(config) {
  try {
    createInitialState(config)
    return []
  } catch (e) {
    return e.errors.map((x) => x.code)
  }
}

describe('willekeur: pas bij SPIN, uniform, geen vooraf bepaalde volgorde', () => {
  it('de beginstatus bevat geen willekeur en geen volgorde: pool in vaste overzichtsvolgorde', () => {
    const config = makeConfig({ n: 4, rounds: 2, lots: 5, pool: [OTHER_ID, '6-6', ...SCORES.slice(0, 12)] })
    const a = createInitialState(config)
    const b = createInitialState(config)
    expect(a).toEqual(b)
    expect(a.remaining).toEqual(ALL_IDS.filter((id) => config.pool.includes(id)))
  })

  it('alleen SPIN raadpleegt de willekeur, precies één keer, uit de resterende uitslagen', () => {
    const calls = []
    const randomInt = (n) => (calls.push(n), secureRandomInt(n))
    const reducer = createReducer({ randomInt })
    const config = makeConfig({ n: 2, rounds: 1, lots: 3 })
    let s = createInitialState(config)
    let t = 1_000
    s = reducer(s, { type: 'NOOP', now: t })
    expect(calls).toEqual([])
    s = reducer(s, { type: 'SPIN_START', now: t })
    expect(calls).toEqual([5])
    s = reducer(s, { type: 'SPIN_START', now: t + 10 }) // tweede tik tijdens de draai
    expect(calls).toEqual([5])
    t += releaseDelay(s.spin)
    s = reducer(s, { type: 'NOOP', now: t })
    s = reducer(s, { type: 'SPIN_START', now: t })
    t += releaseDelay(s.spin)
    s = reducer(s, { type: 'AUCTION_PREPARE', participant: 0, bid: 1, now: t })
    expect(calls).toEqual([5, 4])
    s = reducer(s, { type: 'SPIN_START', now: t })
    expect(calls).toEqual([5, 4, 3])
  })

  it('10.000 eerste trekkingen uit een pool van 50: uniform (chi-kwadraat)', () => {
    const config = makeConfig({ n: 12, rounds: 4, pool: ALL_IDS })
    const reducer = createReducer({ randomInt: secureRandomInt })
    const start = createInitialState(config)
    const counts = Object.fromEntries(ALL_IDS.map((id) => [id, 0]))
    const N = 10_000
    for (let i = 0; i < N; i++) counts[reducer(start, { type: 'SPIN_START', now: 1 }).spin.resultId]++
    const e = N / 50
    const chi2 = Object.values(counts).reduce((s, c) => s + (c - e) ** 2 / e, 0)
    expect(chi2).toBeLessThan(94.8) // 49 vrijheidsgraden, p = 0,0001
  })

  it('veiling: elke kavel even grote kans bij elke SPIN (10.000 × uit 10)', () => {
    const config = makeConfig({ n: 2, rounds: 1, lots: 10 })
    const game = makeGame({ config })
    game.spin()
    game.spin()
    game.prepare(1, 4)
    const atAuction = game.state
    const reducer = createReducer({ randomInt: secureRandomInt })
    const counts = Object.fromEntries(atAuction.remaining.map((id) => [id, 0]))
    const N = 10_000
    for (let i = 0; i < N; i++) counts[reducer(atAuction, { type: 'SPIN_START', now: game.now }).spin.resultId]++
    const e = N / 10
    const chi2 = Object.values(counts).reduce((s, c) => s + (c - e) ** 2 / e, 0)
    expect(Object.keys(counts)).toHaveLength(10)
    expect(chi2).toBeLessThan(33.7) // 9 vrijheidsgraden, p = 0,0001
  })
})

// ---------------------------------------------------------------------------
// DEMO ongewijzigd: referentie van de engine vóór F1 (commit 0692bdf).
// ---------------------------------------------------------------------------
const golden = JSON.parse(readFileSync(new URL('./fixtures/engine-v2-golden.json', import.meta.url), 'utf8'))
const hash = (s) => createHash('sha256').update(JSON.stringify(s)).digest('hex').slice(0, 16)

// De nieuwe status minus wat F1 toevoegt (instellingen, versie, MEGA-vlag).
function asV2(state) {
  const { config: _c, ...rest } = state
  const strip = (spin) => {
    if (!spin) return spin
    const { mega: _m, ...s } = spin
    return s
  }
  return { ...rest, version: 2, spin: strip(rest.spin), lastSpin: strip(rest.lastSpin) }
}

describe('DEMO: exact hetzelfde gedrag als vóór F1', () => {
  it('20 volledige spellen (seeds 1–20): elke tussenstand identiek aan de referentie', () => {
    for (const { seed, draws, hashes } of golden.games) {
      const game = makeGame({ seed })
      const got = []
      for (let i = 0; i < DRAW_TURNS; i++) {
        game.spin()
        got.push(hash(asV2(game.state)))
      }
      game.finishPending()
      got.push(hash(asV2(game.state)))
      const bids = [[0, 20], [4, 0.5], [8, 12.25], [2, 0]]
      for (let i = 0; i < 8; i++) {
        const [p, b] = bids[i % bids.length]
        game.prepare(p, b)
        got.push(hash(asV2(game.state)))
        game.spin()
        got.push(hash(asV2(game.state)))
      }
      game.finishPending()
      got.push(hash(asV2(game.state)))
      expect(game.state.draws).toEqual(draws)
      expect(got).toEqual(hashes)
    }
  })

  it('beginstatus: versie 3 met standaardinstellingen, verder gelijk aan versie 2', () => {
    const s = createInitialState()
    expect(s.version).toBe(STATE_VERSION)
    expect(STATE_VERSION).toBe(3)
    expect(s.config.players).toEqual(DEFAULT_CONFIG.players)
    expect(s.config).toMatchObject({ rounds: 2, priceCents: 1000, pool: [...DEFAULT_CONFIG.pool], mega: [...DEFAULT_CONFIG.mega] })
    expect(drawTurns(s.config)).toBe(18)
    expect(auctionLots(s.config)).toBe(8)
    expect(currentTurn(s)).toEqual({ round: 1, participant: 0 })
  })

  it('opgeslagen DEMO-stand van versie 2 (lopende draai) wordt hersteld en speelt verder', () => {
    const saved = JSON.parse(golden.savedV2)
    expect(saved.version).toBe(2)
    const restored = restoreState(golden.savedV2)
    expect(restored.version).toBe(3)
    expect(restored.config.players.map((p) => p.name)).toEqual(DEFAULT_CONFIG.players.map((p) => p.name))
    expect(asV2(restored)).toEqual(saved) // niets van de voortgang gaat verloren
    // De lopende draai loopt op de juiste plek verder.
    const view = deriveView(restored, saved.spin.startedAt + 2000)
    expect(view.reelSpin).toEqual(saved.spin)
    // Spel afmaken: alle 26 uitslagen precies één keer.
    const reducer = createReducer({ randomInt: secureRandomInt })
    let s = restored
    let t = saved.spin.startedAt
    for (let guard = 0; s.phase !== 'finished' && guard < 200; guard++) {
      t += 20_000
      s = reducer(s, { type: 'NOOP', now: t })
      if (s.phase === 'auction' && !s.auctionTurn) s = reducer(s, { type: 'AUCTION_PREPARE', participant: 3, bid: 1, now: t })
      s = reducer(s, { type: 'SPIN_START', now: t })
    }
    s = reducer(s, { type: 'NOOP', now: t + 60_000 })
    expect(s.phase).toBe('finished')
    expect(new Set(s.draws.map((d) => d.resultId)).size).toBe(26)
  })

  it('opgeslagen DEMO-stand van versie 2 in de veiling wordt hersteld', () => {
    const saved = JSON.parse(golden.savedV2Auction)
    const restored = restoreState(golden.savedV2Auction)
    expect(asV2(restored)).toEqual(saved)
    expect(restored.phase).toBe('auction')
    expect(restored.spin).toMatchObject({ round: 'veiling', participant: 3, bid: 7.5 })
  })

  it('versie 3: instellingen blijven bewaard; ongeldige instellingen → nieuw spel', () => {
    const config = makeConfig({ n: 3, rounds: 1, lots: 2, priceCents: 0 })
    const s = createInitialState(config)
    expect(restoreState(JSON.stringify(s))).toEqual(s)
    const broken = { ...s, config: { ...s.config, rounds: 7 } }
    expect(restoreState(JSON.stringify(broken))).toEqual(createInitialState())
    expect(restoreState(JSON.stringify({ ...s, config: undefined }))).toEqual(createInitialState())
  })

  it('reset behoudt de instellingen van het spel', () => {
    const config = makeConfig({ n: 2, rounds: 1, lots: 1 })
    const game = makeGame({ config })
    game.spin()
    expect(createReducer()(game.state, { type: 'RESET' })).toEqual(createInitialState(config))
  })
})
