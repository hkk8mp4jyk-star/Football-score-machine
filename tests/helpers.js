// Hulpmiddelen voor de tests: voorspelbare willekeur, een nep-klok en een
// speler die een volledig spel doorloopt zoals de app dat doet.
import { createInitialState, createReducer, isTurnReleased } from '../src/game/engine.js'
import { releaseDelay } from '../src/game/timeline.js'

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

export function makeGame({ seed = 1, randomInt } = {}) {
  const reducer = createReducer({ randomInt: randomInt ?? seededRandomInt(seed), newId: counterIds() })
  let state = createInitialState()
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
