// Serverlogica voor het online spel: alle acties die een kamer wijzigen of
// tonen. Draait in de Supabase Edge Function (Deno) en in de tests (Node).
//
// Principes:
// - De server is leidend. Telefoons sturen alleen een verzoek ("ik druk op
//   SPIN", "start het spel"); de server controleert wie het vraagt en past de
//   spelregels toe met precies dezelfde code als de nagebootste server
//   (src/lobby/lobbyRules.js, src/lobby/playRules.js, src/game/engine.js).
//   De uitslag kiest de server (secureRandomInt), pas bij de trekking.
// - De kamer is één document (rooms.state). Alles wordt vastgelegd met
//   optimistische vergrendeling (commit_room_state): twee gelijktijdige
//   verzoeken op dezelfde versie → precies één slaagt. Na een versieconflict
//   wordt opnieuw geladen en opnieuw gecontroleerd (max. 3 pogingen), dus een
//   tweede SPIN, veilingbevestiging of faseovergang wordt daarna geweigerd.
// - Telefoons krijgen alleen de per rol gefilterde weergave (roomView):
//   deelnemers zien in de wachtkamer geen spelregels of volgorde, niemand
//   ziet andermans gebruikers-id. Het user-id komt alleen uit het token.
// - Opslag is injecteerbaar (`store`): Supabase, de echte database
//   (integratietest) of een geheugenopslag (unittests).

import {
  LobbyError,
  addManualPlayer,
  createRoom,
  isMember,
  joinRoom,
  joinSelf,
  removePlayer,
  roomSummary,
  roomView,
  setOrder,
  shuffleOrder,
  startGame,
  updateSettings,
} from '../lobby/lobbyRules.js'
import { advancePhase, confirmAuction, spinTurn } from '../lobby/playRules.js'
import { secureId, secureRandomInt } from '../game/random.js'

export const ACTIONS = [
  'time',
  'create_room',
  'lookup_room',
  'join_room',
  'get_room',
  'update_settings',
  'set_order',
  'shuffle_order',
  'remove_player',
  'add_manual_player',
  'join_self',
  'start_game',
  'spin',
  'confirm_auction',
  'advance_phase',
]

// Kamercode: 6 tekens zonder verwarrende I, O, 0 en 1 (zie migratie).
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Misbruik beperken: een anonieme gebruiker maakt max. 5 nieuwe kamers per 24 uur.
export const MAX_ROOMS_PER_DAY = 5
export const MAX_BID_CENTS = 1_000_000 // €10.000
const MAX_ATTEMPTS = 3 // opnieuw proberen na een versieconflict
const DAY_MS = 24 * 60 * 60 * 1000

// Fout met een vaste code voor de app en een HTTP-status.
export class ActionError extends Error {
  constructor(code, status = 400, message = code) {
    super(message)
    this.code = code
    this.status = status
  }
}

// Door de opslag te gooien bij een unieke-sleutelfout (23505) of een
// verouderde versie (commit_room_state → version_conflict, PT409).
export class StoreConflict extends Error {
  constructor(kind, message = kind) {
    super(message)
    this.kind = kind // 'unique' | 'version'
  }
}

export function generateRoomCode(randomInt = secureRandomInt) {
  return Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')
}

// HTTP-status per foutcode uit de spelregels.
const STATUS = {
  not_organizer: 403,
  not_your_turn: 403,
  removed: 403,
  room_not_found: 404,
  player_not_found: 404,
  name_empty: 400,
  name_too_long: 400,
  name_invalid: 400,
  club_empty: 400,
  club_too_long: 400,
  club_invalid: 400,
  players_invalid: 400,
  invalid_settings: 400,
  invalid_order: 409,
  invalid_bid: 400,
}
const fromLobby = (e) => new ActionError(e.code, STATUS[e.code] ?? 409)

// ---------------------------------------------------------------------------
// Invoercontrole (vorm); de inhoud controleren de spelregels zelf
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
function textOf(value, field, max = 100) {
  if (typeof value !== 'string' || value.length > max) throw invalid(field)
  return value
}
function slotOf(value, field = 'slot') {
  if (!Number.isInteger(value) || value < 0 || value > 11) throw invalid(field)
  return value
}
function draftOf(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('draft')
  const { maxPlayers = null, rounds = null, priceCents = null, pool, mega = [] } = value
  if (!Array.isArray(pool) || pool.length > 60 || !Array.isArray(mega) || mega.length > 60) throw invalid('draft')
  return { maxPlayers, rounds, priceCents, pool, mega }
}
function orderOf(value) {
  if (!Array.isArray(value) || value.length > 12 || !value.every((s) => Number.isInteger(s) && s >= 0 && s <= 11)) throw invalid('order')
  return value
}

// ---------------------------------------------------------------------------
// Kamerdocument ↔ databaserij
// ---------------------------------------------------------------------------
// De rij is leidend voor id, code, organisator en versie.
const toRoom = (row) => ({ ...row.state, id: row.id, code: row.code, organizerId: row.organizer_id, version: row.version })
function toState(room) {
  const { id, code, version, ...state } = room
  return state
}

export function createGameServer({ store, randomInt = secureRandomInt, newId = secureId, now = () => Date.now() }) {
  async function loadRoom(roomId) {
    const row = await store.findRoomById(roomId)
    if (!row) throw new ActionError('room_not_found', 404)
    return toRoom(row)
  }

  // Alleen leden (organisator of deelnemer). Verwijderd: 'removed'; anders
  // hetzelfde antwoord als bij een onbekende kamer.
  async function loadMember(roomId, userId) {
    const room = await loadRoom(roomId)
    if (!isMember(room, userId)) {
      throw room.removedUserIds?.includes(userId) ? new ActionError('removed', 403) : new ActionError('room_not_found', 404)
    }
    return room
  }

  // Laadt de kamer, laat `change` de nieuwe kamer bepalen en legt die
  // atomair vast (eventueel met trekking). Bij een versieconflict: alles
  // opnieuw, inclusief alle controles.
  async function mutate(roomId, userId, change) {
    for (let attempt = 1; ; attempt++) {
      const room = await loadMember(roomId, userId)
      let next
      let draw = null
      try {
        const res = change(room, now())
        next = res.room ?? res
        draw = res.draw ?? null
      } catch (e) {
        if (e instanceof LobbyError) throw fromLobby(e)
        throw e
      }
      try {
        const version = await store.commitState(room.id, room.version, toState(next), draw)
        return { room: roomView({ ...next, version }, userId) }
      } catch (e) {
        if (e instanceof StoreConflict && e.kind === 'version' && attempt < MAX_ATTEMPTS) continue
        if (e instanceof StoreConflict) throw new ActionError('conflict', 409, 'gelijktijdige wijziging, probeer opnieuw')
        throw e
      }
    }
  }

  async function byCode(input) {
    const row = await store.findRoomByCode(codeOf(input))
    if (!row) throw new ActionError('room_not_found', 404)
    return toRoom(row)
  }

  const handlers = {
    // Servertijd voor de gedeelde klok (estimateOffset in game/clock.js).
    async time() {
      return {}
    },

    // Volledig ingesteld spel → kamer. De maker wordt organisator en speler 1.
    async create_room(userId, input) {
      const setup = { name: textOf(input.name, 'name'), home: textOf(input.home, 'home'), away: textOf(input.away, 'away'), draft: draftOf(input.draft) }
      if ((await store.countRoomsByOrganizerSince(userId, new Date(now() - DAY_MS).toISOString())) >= MAX_ROOMS_PER_DAY) {
        throw new ActionError('too_many_rooms', 429)
      }
      for (let i = 0; ; i++) {
        let room
        try {
          room = createRoom({ id: newId(), code: generateRoomCode(randomInt), userId, ...setup })
        } catch (e) {
          if (e instanceof LobbyError) throw fromLobby(e)
          throw e
        }
        try {
          const row = await store.insertRoom({ id: room.id, code: room.code, organizer_id: userId, state: toState(room) })
          return { room: roomView(toRoom(row), userId) }
        } catch (e) {
          if (!(e instanceof StoreConflict && e.kind === 'unique') || i >= 4) throw e // code al in gebruik: nieuwe code
        }
      }
    },

    // Kamer opzoeken (code of uitnodigingslink): wedstrijd, vol, gestart, eigen plek.
    async lookup_room(userId, input) {
      return { summary: roomSummary(await byCode(input), userId) }
    },

    // Aanmelden met een unieke naam; wie al meedoet krijgt zijn plek terug.
    async join_room(userId, input) {
      const name = textOf(input.name ?? '', 'name')
      const found = await byCode(input)
      for (let attempt = 1; ; attempt++) {
        const room = attempt === 1 ? found : await loadRoom(found.id)
        let res
        try {
          res = joinRoom(room, { userId, name })
        } catch (e) {
          if (e instanceof LobbyError) throw fromLobby(e)
          throw e
        }
        if (res.rejoined) return { room: roomView(room, userId) }
        try {
          const version = await store.commitState(room.id, room.version, toState(res.room), null)
          return { room: roomView({ ...res.room, version }, userId) }
        } catch (e) {
          if (e instanceof StoreConflict && e.kind === 'version' && attempt < MAX_ATTEMPTS) continue
          if (e instanceof StoreConflict) throw new ActionError('conflict', 409)
          throw e
        }
      }
    },

    // Kamer voor leden (herstel na herladen of verbindingsverlies).
    async get_room(userId, input) {
      return { room: roomView(await loadMember(roomIdOf(input), userId), userId) }
    },

    async update_settings(userId, input) {
      const draft = draftOf(input.draft)
      return mutate(roomIdOf(input), userId, (room) => updateSettings(room, { userId, draft }))
    },
    async set_order(userId, input) {
      const order = orderOf(input.order)
      return mutate(roomIdOf(input), userId, (room) => setOrder(room, { userId, order }))
    },
    // Loten met serverwillekeur.
    async shuffle_order(userId, input) {
      return mutate(roomIdOf(input), userId, (room) => shuffleOrder(room, { userId, randomInt }))
    },
    async remove_player(userId, input) {
      const slot = slotOf(input.slot)
      return mutate(roomIdOf(input), userId, (room) => removePlayer(room, { userId, slot }))
    },
    async add_manual_player(userId, input) {
      const name = textOf(input.name, 'name')
      return mutate(roomIdOf(input), userId, (room) => addManualPlayer(room, { userId, name }).room)
    },
    async join_self(userId, input) {
      return mutate(roomIdOf(input), userId, (room) => joinSelf(room, { userId }).room)
    },
    // Eén keer starten: legt deelnemers, volgorde, spelregels en de
    // gezamenlijke starttijd (servertijd) vast.
    async start_game(userId, input) {
      const expectedVersion = input.expectedVersion == null ? null : input.expectedVersion
      if (expectedVersion !== null && !Number.isInteger(expectedVersion)) throw invalid('expectedVersion')
      return mutate(roomIdOf(input), userId, (room, t) => startGame(room, { userId, expectedVersion, now: t }))
    },

    // SPIN. Wie aan de beurt is; de organisator voor een deelnemer zonder
    // telefoon of expliciet namens (onBehalf). De uitslag kiest de server;
    // status en trekking worden in één transactie vastgelegd.
    async spin(userId, input) {
      if (input.onBehalf != null && typeof input.onBehalf !== 'boolean') throw invalid('onBehalf')
      return mutate(roomIdOf(input), userId, (room, t) => {
        const { room: next, spin } = spinTurn(room, { userId, onBehalf: input.onBehalf === true, now: t, randomInt, newId })
        const log = next.spinLog.at(-1)
        const draw = {
          spin_id: spin.id,
          result_id: spin.resultId,
          participant: spin.participant,
          round: String(spin.round),
          bid_cents: spin.round === 'veiling' ? Math.round((spin.bid ?? 0) * 100) : null,
          started_at: new Date(spin.startedAt).toISOString(),
          spun_by: userId,
          on_behalf: log.onBehalf,
        }
        return { room: next, draw }
      })
    },

    // "Bevestig veiling": winnaar + bod vastleggen (start nog geen trekking).
    async confirm_auction(userId, input) {
      const participant = slotOf(input.participant, 'participant')
      const bidCents = input.bidCents
      if (!Number.isInteger(bidCents) || bidCents < 0 || bidCents > MAX_BID_CENTS) throw invalid('bidCents')
      return mutate(roomIdOf(input), userId, (room, t) => confirmAuction(room, { userId, participant, bidCents, now: t }))
    },

    // Faseovergang (alleen organisator, eenmalig): 'auction' of 'final'.
    async advance_phase(userId, input) {
      if (input.step !== 'auction' && input.step !== 'final') throw invalid('step')
      return mutate(roomIdOf(input), userId, (room, t) => advancePhase(room, { userId, step: input.step, now: t }))
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
