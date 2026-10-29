// Spel-engine als pure reducer. De volledige spelstatus is serialiseerbaar
// en elke wijziging loopt via een actie met een tijdstip (`now`).
//
// Tijdgestuurd: een geaccepteerde SPIN legt meteen de uitslag en het
// starttijdstip vast in `spin`. Het verdere verloop (rollen stoppen, vak
// groen, vastleggen, beurt vrijgeven) volgt daarna uitsluitend uit de tijd,
// via game/timeline.js. Dezelfde reducer draait straks ook op de server.

import { AUCTION_LOTS, DRAW_TURNS, RESULTS, TURN_ORDER } from './config.js'
import { secureId, secureRandomInt } from './random.js'
import { commitDelay, releaseDelay } from './timeline.js'

export const STATE_VERSION = 2 // 2: 26 uitslagen, 2 rondes, 8 kavels

export function createInitialState() {
  return {
    version: STATE_VERSION,
    phase: 'draw', // 'draw' | 'auction' | 'finished'
    turn: 0, // index in TURN_ORDER tijdens de trekkingen
    remaining: RESULTS.map((r) => r.id),
    draws: [], // { resultId, participant, round, bid, at }
    auctionBoard: null, // vaste volgorde van de veilingvakken
    auctionTurn: null, // door de organisator vrijgegeven beurt: { participant, bid }
    spin: null, // lopende draai: { id, resultId, participant, round, bid, startedAt }
    lastSpin: null, // laatst vastgelegde draai (voor onthulling en beurtvrijgave)
  }
}

// Kiest uniform één uitslag uit de resterende uitslagen. `randomInt(n)` geeft
// een geheel getal in [0, n); standaard cryptografisch veilig.
export function pickRandomResult(remaining, randomInt = secureRandomInt) {
  return remaining[randomInt(remaining.length)]
}

export function currentTurn(state) {
  return state.phase === 'draw' ? TURN_ORDER[state.turn] : null
}

function commit(state, spin) {
  const remaining = state.remaining.filter((id) => id !== spin.resultId)
  const draws = [
    ...state.draws,
    { resultId: spin.resultId, participant: spin.participant, round: spin.round, bid: spin.bid ?? null, at: spin.startedAt },
  ]
  const next = { ...state, remaining, draws, spin: null, auctionTurn: null, lastSpin: spin }

  if (state.phase === 'draw') {
    next.turn = state.turn + 1
    if (next.turn >= DRAW_TURNS) {
      next.phase = 'auction'
      // Vaste posities: oplopend gesorteerd zoals in het overzicht.
      next.auctionBoard = RESULTS.map((r) => r.id).filter((id) => remaining.includes(id))
    }
  } else if (state.phase === 'auction' && remaining.length === 0) {
    next.phase = 'finished'
  }
  return next
}

// Verwerkt een lopende draai zodra zijn moment van vastleggen is bereikt.
// Puur en idempotent: elke telefoon (en de server) komt op hetzelfde uit.
export function settle(state, now) {
  const spin = state.spin
  if (!spin || now < spin.startedAt + commitDelay(spin)) return state
  return commit(state, spin)
}

// Mag er op tijdstip `now` een nieuwe draai starten? (Na de vorige draai
// moet eerst de beurt zijn vrijgegeven.)
export function isTurnReleased(state, now) {
  const last = state.lastSpin
  return !state.spin && (!last || now >= last.startedAt + releaseDelay(last))
}

// Maakt een reducer. Server en tests kunnen eigen willekeur en ID's
// meegeven; de app gebruikt de standaard (cryptografisch veilig).
export function createReducer({ randomInt = secureRandomInt, newId = secureId } = {}) {
  return function reducer(rawState, action) {
    if (action.type === 'RESET') return createInitialState()

    const now = action.now ?? Date.now()
    const state = settle(rawState, now)

    switch (action.type) {
      case 'SPIN_START': {
        // Maximaal één draai tegelijk, en pas als de beurt is vrijgegeven.
        if (state.phase === 'finished' || !isTurnReleased(state, now)) return state
        let participant, round
        let bid = null
        if (state.phase === 'draw') {
          ;({ participant, round } = TURN_ORDER[state.turn])
        } else {
          // De organisator heeft de beurt vrijgegeven met deelnemer en bod.
          const turn = state.auctionTurn
          if (turn?.participant == null) return state
          participant = turn.participant
          round = 'veiling'
          bid = turn.bid ?? null
        }
        const resultId = pickRandomResult(state.remaining, randomInt)
        return {
          ...state,
          spin: { id: newId(), resultId, participant, round, bid, startedAt: now },
        }
      }

      // Organisator zet de volgende veiling klaar en geeft de beurt vrij.
      case 'AUCTION_PREPARE': {
        if (state.phase !== 'auction' || state.spin) return state
        return { ...state, auctionTurn: { participant: action.participant, bid: action.bid } }
      }

      // Demo: vul alle vaste trekkingen direct, zodat de veiling te testen is.
      case 'DEMO_SKIP_TO_AUCTION': {
        let s = { ...state, spin: null }
        while (s.phase === 'draw') {
          const { participant, round } = TURN_ORDER[s.turn]
          s = commit(s, { id: newId(), resultId: pickRandomResult(s.remaining, randomInt), participant, round, bid: null, startedAt: now })
        }
        return { ...s, lastSpin: null }
      }

      default:
        return state
    }
  }
}

export const reducer = createReducer()

export { AUCTION_LOTS }
