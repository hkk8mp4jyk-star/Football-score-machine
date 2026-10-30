// Hulpmiddelen voor de tests: voorspelbare willekeur, een nep-klok en een
// speler die een volledig spel doorloopt zoals de app dat doet.
import { createInitialState, createReducer, isTurnReleased } from '../src/game/engine.js'
import { releaseDelay } from '../src/game/timeline.js'
import { ALL_RESULTS, OTHER_ID } from '../src/game/config.js'

// Instelbare spellen: 49 losse scores (0-0 … 6-6) en een eenvoudige set instellingen.
export const SCORES = ALL_RESULTS.filter((r) => !r.other).map((r) => r.id)
export const players = (n) => Array.from({ length: n }, (_, i) => ({ id: i, name: `Speler ${i + 1}` }))
export function makeConfig({ n = 4, rounds = 2, lots = 0, priceCents = 1000, mega = [], pool } = {}) {
  const size = n * rounds + lots
  return { players: players(n), rounds, priceCents, pool: pool ?? [...SCORES.slice(0, size - 1), OTHER_ID], mega }
}

// Kleine, voorspelbare generator (mulberry32) voor herhaalbare tests.
export function seededRandomInt(seed = 1) {
  let a = seed >>> 0
  return (n) => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296
    return Math.floor(r * n)
  }
}

export function counterIds() {
  let i = 0
  return () => `spin-${++i}`
}

export function makeGame({ seed = 1, randomInt, config } = {}) {
  const reducer = createReducer({ randomInt: randomInt ?? seededRandomInt(seed), newId: counterIds() })
  let state = config ? createInitialState(config) : createInitialState()
  let now = 1_000_000
  return {
    get state() {
      return state
    },
    get now() {
      return now
    },
    at(t) {
      now = t
      return this
    },
    advance(ms) {
      now += ms
      return this
    },
    dispatch(action) {
      state = reducer(state, { ...action, now })
      return state
    },
    // Wacht tot de volgende beurt vrij is (zoals de SPIN-knop dat doet).
    waitForRelease() {
      const last = state.spin ?? state.lastSpin
      if (last) now = Math.max(now, last.startedAt + releaseDelay(last))
      state = reducer(state, { type: 'NOOP', now }) // lopende draai vastleggen
      if (!isTurnReleased(state, now)) throw new Error('beurt niet vrij')
      return this
    },
    spin() {
      this.waitForRelease()
      return this.dispatch({ type: 'SPIN_START' })
    },
    prepare(participant, bid) {
      this.waitForRelease()
      return this.dispatch({ type: 'AUCTION_PREPARE', participant, bid })
    },
    finishPending() {
      this.waitForRelease()
      return this.dispatch({ type: 'NOOP' })
    },
  }
}
