// Spel-engine als pure reducer. De volledige spelstatus is serialiseerbaar
// en elke wijziging loopt via een actie met een tijdstip (`now`).
//
// Tijdgestuurd: een geaccepteerde SPIN legt meteen de uitslag en het
// starttijdstip vast in `spin`. Het verdere verloop (rollen stoppen, vak
// groen, vastleggen, beurt vrijgeven) volgt daarna uitsluitend uit de tijd,
// via game/timeline.js. Dezelfde reducer draait ook op de server.
//
// Instelbaar (state.config, zie game/gameConfig.js): 1–12 spelers in vaste
// speelvolgorde, 1–4 vaste rondes (slangvolgorde), prijs per vaste trekking,
// een pool uit 0-0 t/m 6-6 + OVERIG en MEGA WIN per uitslag. Na N × R vaste
// trekkingen volgt de veiling met de overige 0–10 uitslagen; bij 0 is het spel
// direct klaar. Zonder opgave gelden de standaardinstellingen van de DEMO.
//
// Willekeur: er bestaat geen vooraf bepaalde volgorde. De pool staat in vaste
// overzichtsvolgorde; pas bij SPIN kiest `randomInt` één van de resterende.

import { secureId, secureRandomInt } from './random.js'
import { commitDelay, releaseDelay } from './timeline.js'
import { DEFAULT_CONFIG, auctionLots, configOf, drawTurns, normalizeConfig, turnOrder } from './gameConfig.js'

export const STATE_VERSION = 3 // 3: instellingen in de status (2: vast 26 uitslagen, 2 rondes, 8 kavels)

export function createInitialState(config = DEFAULT_CONFIG) {
  const cfg = normalizeConfig(config)
  return {
    version: STATE_VERSION,
    config: cfg,
    phase: 'draw', // 'draw' | 'auction' | 'finished'
    turn: 0, // index in de beurtvolgorde (turnOrder) tijdens de vaste rondes
    remaining: [...cfg.pool],
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
  return state.phase === 'draw' ? turnOrder(configOf(state))[state.turn] : null
}

function commit(state, spin) {
  const config = configOf(state)
  const remaining = state.remaining.filter((id) => id !== spin.resultId)
  const draws = [
    ...state.draws,
    { resultId: spin.resultId, participant: spin.participant, round: spin.round, bid: spin.bid ?? null, at: spin.startedAt },
  ]
  const next = { ...state, remaining, draws, spin: null, auctionTurn: null, lastSpin: spin }

  if (state.phase === 'draw') {
    next.turn = state.turn + 1
    if (next.turn >= drawTurns(config)) {
      if (auctionLots(config) > 0) {
        next.phase = 'auction'
        // Vaste posities: oplopend gesorteerd zoals in het overzicht.
        next.auctionBoard = config.pool.filter((id) => remaining.includes(id))
      } else {
        next.phase = 'finished' // geen veiling: klaar na de laatste vaste trekking
      }
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
    if (action.type === 'RESET') return createInitialState(configOf(rawState))

    const now = action.now ?? Date.now()
    const state = settle(rawState, now)
    const config = configOf(state)

    switch (action.type) {
      case 'SPIN_START': {
        // Maximaal één draai tegelijk, en pas als de beurt is vrijgegeven.
        if ((state.phase !== 'draw' && state.phase !== 'auction') || !isTurnReleased(state, now)) return state
        let participant, round
        let bid = null
        if (state.phase === 'draw') {
          ;({ participant, round } = turnOrder(config)[state.turn])
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
          // `mega` ligt vast bij de draai: elke telefoon speelt dezelfde animatie.
          spin: { id: newId(), resultId, participant, round, bid, startedAt: now, mega: config.mega.includes(resultId) },
        }
      }

      // Organisator zet de volgende veiling klaar en geeft de beurt vrij.
      case 'AUCTION_PREPARE': {
        if (state.phase !== 'auction' || state.spin) return state
        // Alleen een bestaande speler en een geldig bod (≥ 0).
        if (!config.players.some((p) => p.id === action.participant)) return state
        if (typeof action.bid !== 'number' || !Number.isFinite(action.bid) || action.bid < 0) return state
        return { ...state, auctionTurn: { participant: action.participant, bid: action.bid } }
      }

      // Demo: vul alle vaste trekkingen direct, zodat de veiling te testen is.
      case 'DEMO_SKIP_TO_AUCTION': {
        let s = { ...state, spin: null }
        while (s.phase === 'draw') {
          const { participant, round } = turnOrder(config)[s.turn]
          const spin = { id: newId(), resultId: pickRandomResult(s.remaining, randomInt), participant, round, bid: null, startedAt: now }
          s = commit(s, { ...spin, mega: config.mega.includes(spin.resultId) })
        }
        return { ...s, lastSpin: null }
      }

      default:
        return state
    }
  }
}

export const reducer = createReducer()
