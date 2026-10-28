// Spel-engine als pure reducer. De volledige spelstatus is serialiseerbaar
// en elke wijziging loopt via een actie. Voor realtime multiplayer kan de
// reducer later server-side (Supabase edge function / RPC) draaien, waarna
// clients alleen nog de status uit een realtime kanaal ontvangen.

import { AUCTION_LOTS, DRAW_TURNS, RESULTS, TURN_ORDER } from './config.js'

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
  }
}

// In de demo kiest de client zelf. Later doet de server dit, zodat niemand
// de uitkomst vooraf kan zien of beïnvloeden.
export function pickRandomResult(remaining, random = Math.random) {
  return remaining[Math.floor(random() * remaining.length)]
}

export function currentTurn(state) {
  return state.phase === 'draw' ? TURN_ORDER[state.turn] : null
}

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

function commit(state, spin, at = Date.now()) {
  const remaining = state.remaining.filter((id) => id !== spin.resultId)
  const draws = [
    ...state.draws,
    { resultId: spin.resultId, participant: spin.participant, round: spin.round, bid: spin.bid ?? null, at },
  ]
  const next = { ...state, remaining, draws, spin: null, auctionTurn: null }

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

export function reducer(state, action) {
  switch (action.type) {
    case 'SPIN_START': {
      if (state.spin || state.phase === 'finished') return state
      let participant, round, bid = null
      if (state.phase === 'draw') {
        ;({ participant, round } = TURN_ORDER[state.turn])
      } else {
        // De organisator heeft de beurt vrijgegeven met deelnemer en bod.
        const turn = action.participant != null ? action : state.auctionTurn
        if (turn?.participant == null) return state
        participant = turn.participant
        round = 'veiling'
        bid = turn.bid ?? null
      }
      const resultId = action.resultId ?? pickRandomResult(state.remaining)
      return {
        ...state,
        spin: { id: uid(), resultId, participant, round, bid, startedAt: action.startedAt ?? Date.now() },
      }
    }

    // Organisator zet de volgende veiling klaar en geeft de beurt vrij.
    case 'AUCTION_PREPARE': {
      if (state.phase !== 'auction' || state.spin) return state
      return { ...state, auctionTurn: { participant: action.participant, bid: action.bid } }
    }

    case 'SPIN_COMMIT': {
      if (!state.spin || state.spin.id !== action.spinId) return state
      return commit(state, state.spin)
    }

    // Demo: vul alle vaste trekkingen direct, zodat de veiling te testen is.
    case 'DEMO_SKIP_TO_AUCTION': {
      let s = { ...state, spin: null }
      while (s.phase === 'draw') {
        const { participant, round } = TURN_ORDER[s.turn]
        s = commit(s, { resultId: pickRandomResult(s.remaining), participant, round })
      }
      return s
    }

    case 'RESET':
      return createInitialState()

    default:
      return state
  }
}

export { AUCTION_LOTS }
