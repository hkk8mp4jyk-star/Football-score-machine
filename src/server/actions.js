// Serverlogica voor multiplayer: alle acties die de spelstatus of de kamer
// wijzigen. Draait in de Supabase Edge Function (Deno) en in de tests (Node).
//
// Principes:
// - De server is leidend. Telefoons sturen alleen een verzoek ("ik druk op
//   SPIN"); de server controleert wie het vraagt, past de spelregels toe met
//   dezelfde engine als de app en kiest zelf de uitslag (secureRandomInt).
// - Alles wordt vastgelegd met optimistische vergrendeling (commit_room_state):
//   twee gelijktijdige verzoeken op dezelfde versie → precies één slaagt.
//   Na een versieconflict wordt opnieuw geladen en opnieuw gecontroleerd, dus
//   een tweede SPIN voor dezelfde beurt wordt daarna gewoon geweigerd.
// - Opslag is injecteerbaar (`store`), zodat dezelfde code tegen Supabase, de
//   echte database (integratietest) en een geheugenopslag (unittests) draait.

import { PARTICIPANTS, TURN_ORDER } from '../game/config.js'
import { createInitialState, createReducer, isTurnReleased, settle } from '../game/engine.js'
import { secureId, secureRandomInt } from '../game/random.js'

export const ACTIONS = ['time', 'create_room', 'lookup_room', 'claim_seat', 'get_room', 'release_seat', 'spin', 'auction_prepare']

// Kamercode: 6 tekens zonder verwarrende I, O, 0 en 1 (zie migratie).
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const MAX_ROOMS_PER_USER = 5
export const MAX_BID_CENTS = 1_000_000 // €10.000
const MAX_ATTEMPTS = 3 // opnieuw proberen na een versieconflict

// Fout met een vaste code voor de app en een HTTP-status.
export class ActionError extends Error {
  constructor(code, status = 400, message = code) {
    super(message)
    this.code = code
    this.status = status
  }
}

// Door de opslag te gooien bij een unieke-sleutelfout (23505) of een
// verouderde versie (commit_room_state → version_conflict, 40001).
export class StoreConflict extends Error {
  constructor(kind, message = kind) {
    super(message)
    this.kind = kind // 'unique' | 'version'
  }
}

export function generateRoomCode(randomInt = secureRandomInt) {
  return Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')
}

// ---------------------------------------------------------------------------
// Invoercontrole
// ---------------------------------------------------------------------------
const invalid = (field) => new ActionError('invalid_input', 400, `ongeldige invoer: ${field}`)

function roomIdOf(input) {
  if (typeof input.roomId !== 'string' || !UUID_RE.test(input.roomId)) throw invalid('roomId')
  return input.roomId.toLowerCase()
}

function codeOf(input) {
  const code = typeof input.code === 'string' ? input.code.trim().toUpperCase() : ''
  if (!CODE_RE.test(code)) throw invalid('code')
  return code
}

function participantOf(value, field = 'participant') {
  if (!Number.isInteger(value) || value < 0 || value >= PARTICIPANTS.length) throw invalid(field)
  return value
}

function bidCentsOf(value) {
  if (!Number.isInteger(value) || value < 0 || value > MAX_BID_CENTS) throw invalid('bidCents')
  return value
}

// ---------------------------------------------------------------------------
// Weergave naar de app (nooit user_id's van anderen)
// ---------------------------------------------------------------------------
const publicRoom = (room) => ({ id: room.id, code: room.code, version: room.version, state: room.state })

function publicSeats(seats, userId) {
  return seats
    .map((s) => ({ participant: s.participant, isOrganizer: s.is_organizer, mine: s.user_id === userId }))
    .sort((a, b) => a.participant - b.participant)
}

function membership(room, seats, userId) {
  const seat = seats.find((s) => s.user_id === userId) ?? null
  const isOrganizer = room.organizer_id === userId
  return { seat, isOrganizer, isMember: Boolean(seat) || isOrganizer }
}

// Wie is er nu (op tijdstip `now`) aan de beurt, of waarom kan er niet
// gedraaid worden? Leest de status zoals de engine die na `settle` ziet.
export function turnStatus(rawState, now) {
  const state = settle(rawState, now)
  if (state.phase === 'finished') return { state, error: 'game_finished' }
  if (!isTurnReleased(state, now)) return { state, error: 'turn_not_released' }
  if (state.phase === 'draw') return { state, participant: TURN_ORDER[state.turn].participant }
  if (state.auctionTurn?.participant == null) return { state, error: 'no_auction_turn' }
  return { state, participant: state.auctionTurn.participant }
}

// ---------------------------------------------------------------------------
// De server
// ---------------------------------------------------------------------------
export function createGameServer({ store, randomInt = secureRandomInt, newId = secureId, now = () => Date.now() }) {
  const reducer = createReducer({ randomInt, newId })

  async function loadRoom(roomId) {
    const room = await store.findRoomById(roomId)
    if (!room) throw new ActionError('room_not_found', 404)
    return room
  }

  async function loadMembership(roomId, userId) {
    const room = await loadRoom(roomId)
    const seats = await store.listSeats(room.id)
    const m = membership(room, seats, userId)
    // Niet-leden krijgen hetzelfde antwoord als bij een onbekende kamer.
    if (!m.isMember) throw new ActionError('room_not_found', 404)
    return { room, seats, ...m }
  }

  // Laadt de kamer, laat `compute` de nieuwe status bepalen en legt die
  // atomair vast. Bij een versieconflict: alles opnieuw, inclusief controles.
  async function mutateState(roomId, userId, compute) {
    for (let attempt = 1; ; attempt++) {
      const ctx = await loadMembership(roomId, userId)
      const { state, draw, result } = compute(ctx, now())
      try {
        const version = await store.commitState(ctx.room.id, ctx.room.version, state, draw ?? null)
        return { room: publicRoom({ ...ctx.room, state, version }), ...result }
      } catch (e) {
        if (e instanceof StoreConflict && e.kind === 'version' && attempt < MAX_ATTEMPTS) continue
        if (e instanceof StoreConflict) throw new ActionError('conflict', 409, 'gelijktijdige wijziging, probeer opnieuw')
        throw e
      }
    }
  }

  const handlers = {
    // Servertijd voor de gedeelde klok (estimateOffset in game/clock.js).
    async time() {
      return {}
    },

    // Iedere ingelogde telefoon mag een kamer maken en wordt daarvan de
    // organisator. Optioneel meteen de eigen naam (de organisator speelt mee).
    async create_room(userId, input) {
      const participant = input.participant == null ? null : participantOf(input.participant)
      if ((await store.countRoomsByOrganizer(userId)) >= MAX_ROOMS_PER_USER) {
        throw new ActionError('too_many_rooms', 429)
      }
      let room = null
      for (let i = 0; !room; i++) {
        try {
          room = await store.insertRoom({ code: generateRoomCode(randomInt), organizer_id: userId, state: createInitialState() })
        } catch (e) {
          if (!(e instanceof StoreConflict && e.kind === 'unique') || i >= 4) throw e // code al in gebruik: nieuwe code
        }
      }
      let seat = null
      if (participant != null) {
        await store.insertSeat({ room_id: room.id, participant, user_id: userId, is_organizer: true })
        seat = participant
      }
      return { room: publicRoom(room), mySeat: seat, isOrganizer: true }
    },

    // Kamer opzoeken met de code uit de uitnodiging: welke namen zijn vrij?
    async lookup_room(userId, input) {
      const room = await store.findRoomByCode(codeOf(input))
      if (!room) throw new ActionError('room_not_found', 404)
      const seats = await store.listSeats(room.id)
      const { seat, isOrganizer } = membership(room, seats, userId)
      return {
        roomId: room.id,
        code: room.code,
        phase: room.state?.phase ?? null,
        seats: publicSeats(seats, userId),
        mySeat: seat?.participant ?? null,
        isOrganizer,
      }
    },

    // Naam kiezen. Eén telefoon per naam en één naam per telefoon; de
    // database dwingt dat af, ook bij gelijktijdige verzoeken.
    async claim_seat(userId, input) {
      const participant = participantOf(input.participant)
      const room = await store.findRoomByCode(codeOf(input))
      if (!room) throw new ActionError('room_not_found', 404)
      const isOrganizer = room.organizer_id === userId
      const current = (await store.listSeats(room.id)).find((s) => s.user_id === userId)
      if (current) {
        if (current.participant === participant) return { roomId: room.id, mySeat: participant, isOrganizer }
        throw new ActionError('already_seated', 409)
      }
      try {
        await store.insertSeat({ room_id: room.id, participant, user_id: userId, is_organizer: isOrganizer })
      } catch (e) {
        if (!(e instanceof StoreConflict)) throw e
        // Wie was er sneller: dezelfde telefoon (dubbel verzoek) of een ander?
        const seats = await store.listSeats(room.id)
        const mine = seats.find((s) => s.user_id === userId)
        if (mine?.participant === participant) return { roomId: room.id, mySeat: participant, isOrganizer }
        throw new ActionError(mine ? 'already_seated' : 'seat_taken', 409)
      }
      return { roomId: room.id, mySeat: participant, isOrganizer }
    },

    // Volledige kamer voor leden (herstel na herladen of verbindingsverlies).
    async get_room(userId, input) {
      const { room, seats, seat, isOrganizer } = await loadMembership(roomIdOf(input), userId)
      return { room: publicRoom(room), seats: publicSeats(seats, userId), mySeat: seat?.participant ?? null, isOrganizer }
    },

    // Organisator: een geclaimde naam vrijgeven (bijv. nieuwe telefoon).
    async release_seat(userId, input) {
      const participant = participantOf(input.participant)
      const { room, isOrganizer } = await loadMembership(roomIdOf(input), userId)
      if (!isOrganizer) throw new ActionError('not_organizer', 403)
      if (!(await store.deleteSeat(room.id, participant))) throw new ActionError('seat_not_found', 404)
      return { participant }
    },

    // SPIN. Alleen wie aan de beurt is; de organisator alleen met expliciet
    // `onBehalf: true` (noodfunctie, vastgelegd in draws.on_behalf).
    async spin(userId, input) {
      if (input.onBehalf != null && typeof input.onBehalf !== 'boolean') throw invalid('onBehalf')
      const roomId = roomIdOf(input)
      return mutateState(roomId, userId, ({ room, seat, isOrganizer }, t) => {
        const turn = turnStatus(room.state, t)
        if (turn.error) throw new ActionError(turn.error, 409)
        const own = seat?.participant === turn.participant
        if (!own && !(input.onBehalf === true && isOrganizer)) throw new ActionError('not_your_turn', 403)

        const state = reducer(room.state, { type: 'SPIN_START', now: t })
        const spin = state.spin
        if (!spin || spin.startedAt !== t || spin.participant !== turn.participant) {
          throw new ActionError('spin_rejected', 409) // vangnet: engine weigerde
        }
        const draw = {
          spin_id: spin.id,
          result_id: spin.resultId,
          participant: spin.participant,
          round: String(spin.round),
          bid_cents: spin.round === 'veiling' ? Math.round((spin.bid ?? 0) * 100) : null,
          started_at: new Date(spin.startedAt).toISOString(),
          spun_by: userId,
          on_behalf: !own,
        }
        return { state, draw, result: { spin, onBehalf: !own } }
      })
    },

    // Organisator: koper en bod van de volgende kavel klaarzetten en de
    // beurt vrijgeven. Bod in centen (geheel getal); de status bewaart euro's.
    async auction_prepare(userId, input) {
      const participant = participantOf(input.participant)
      const bidCents = bidCentsOf(input.bidCents)
      return mutateState(roomIdOf(input), userId, ({ room, isOrganizer }, t) => {
        if (!isOrganizer) throw new ActionError('not_organizer', 403)
        const current = settle(room.state, t)
        if (current.phase !== 'auction') throw new ActionError('not_auction', 409)
        if (current.spin) throw new ActionError('spin_in_progress', 409)
        const state = reducer(room.state, { type: 'AUCTION_PREPARE', participant, bid: bidCents / 100, now: t })
        return { state, result: { auctionTurn: state.auctionTurn } }
      })
    },
  }

  // Eén ingang voor alle acties. `userId` komt uit het geverifieerde
  // Supabase-token, nooit uit de invoer.
  async function handle(userId, body) {
    if (typeof userId !== 'string' || !UUID_RE.test(userId)) throw new ActionError('unauthorized', 401)
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid('body')
    const { action, ...input } = body
    if (!ACTIONS.includes(action)) throw new ActionError('unknown_action', 400)
    const result = await handlers[action](userId, input)
    return { ok: true, ...result, serverNow: now() }
  }

  return { handle }
}
