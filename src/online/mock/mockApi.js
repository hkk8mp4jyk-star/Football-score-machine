// NAGEBOOTSTE SERVER (alleen ontwikkelen en testen, nooit in productie).
//
// Gedraagt zich als de toekomstige echte server: dezelfde regels
// (lobby/lobbyRules.js), dezelfde foutcodes, de server bepaalt alles. De
// kamers staan in localStorage, zodat meerdere tabbladen in dezelfde browser
// samen spelen: elk tabblad is een eigen "telefoon" (identiteit in
// sessionStorage, blijft bij herladen behouden). Wijzigingen gaan naar de
// andere tabbladen via BroadcastChannel.
//
// Voor de tests zijn opslag, kanaal, willekeur en vertraging in te stellen.

import { ApiError, CODE_ALPHABET, isValidCode, normalizeCode } from '../api.js'
import {
  LobbyError,
  addManualPlayer,
  createRoom,
  isMember,
  joinSelf,
  joinRoom,
  removePlayer,
  roomSummary,
  roomView,
  setOrder,
  shuffleOrder,
  startGame,
  updateSettings,
} from '../../lobby/lobbyRules.js'
import { advancePhase, confirmAuction, spinTurn } from '../../lobby/playRules.js'
import { secureId, secureRandomInt } from '../../game/random.js'

const SERVER_KEY = 'fsm-mock-server'
const USER_KEY = 'fsm-mock-user'
const SESSION_KEY = 'fsm-mock-session'
const LOCK = 'fsm-mock-lock'
const FAKE_NAMES = ['Sanne', 'Bas', 'Marieke', 'Dennis', 'Frank', 'Esther', 'Patrick', 'Jeroen', 'Noor', 'Ahmed', 'Ruud', 'Lotte']

function browserDeps() {
  return {
    shared: window.localStorage,
    local: window.sessionStorage,
    channel: typeof BroadcastChannel === 'function' ? new BroadcastChannel('fsm-mock') : null,
    onStorage: (fn) => {
      const handler = (e) => e.key === SERVER_KEY && fn()
      window.addEventListener('storage', handler)
      return () => window.removeEventListener('storage', handler)
    },
  }
}

// Eén actie tegelijk over alle tabbladen (Web Locks), zodat lezen–wijzigen–
// schrijven niet door een ander tabblad wordt onderbroken. Zo geven twee
// gelijktijdige SPIN's (deelnemer + organisator) ook in de mock precies één
// trekking, net als met de versiecontrole van de echte server.
const browserLock = () =>
  typeof navigator !== 'undefined' && navigator.locks ? (fn) => navigator.locks.request(LOCK, fn) : (fn) => fn()

export function createMockApi({
  shared,
  local,
  channel,
  onStorage,
  randomInt = secureRandomInt,
  newId = secureId,
  latency = 120,
  now = () => Date.now(),
  withLock = browserLock(),
} = browserDeps()) {
  const listeners = new Set()
  const notifyLocal = (roomId) => listeners.forEach((l) => l(roomId))
  channel?.addEventListener('message', (e) => notifyLocal(e.data?.roomId))
  onStorage?.(() => notifyLocal(null))

  const userId = (() => {
    let id = local.getItem(USER_KEY)
    if (!id) {
      id = newId()
      local.setItem(USER_KEY, id)
    }
    return id
  })()

  const load = () => {
    try {
      return JSON.parse(shared.getItem(SERVER_KEY)) ?? { rooms: {} }
    } catch {
      return { rooms: {} }
    }
  }
  const save = (db, roomId) => {
    shared.setItem(SERVER_KEY, JSON.stringify(db))
    channel?.postMessage({ roomId })
    notifyLocal(roomId)
  }
  const wait = () => (latency ? new Promise((r) => setTimeout(r, latency)) : Promise.resolve())

  // Voert een serveractie uit: vertraging, regels toepassen, opslaan.
  async function run(fn) {
    await wait()
    return withLock(() => {
      try {
        return fn(load())
      } catch (e) {
        if (e instanceof LobbyError) throw new ApiError(e.code, e.detail)
        throw e
      }
    })
  }
  const findByCode = (db, code) => Object.values(db.rooms).find((r) => r.code === code) ?? null
  const roomOrThrow = (db, roomId) => {
    const room = db.rooms[roomId]
    if (!room) throw new ApiError('room_not_found')
    return room
  }
  const memberOrThrow = (room, uid = userId) => {
    if (!isMember(room, uid)) {
      throw new ApiError(room.removedUserIds.includes(uid) ? 'removed' : 'room_not_found')
    }
  }
  const mutate = (roomId, change) =>
    run((db) => {
      const room = roomOrThrow(db, roomId)
      memberOrThrow(room)
      db.rooms[roomId] = change(room)
      save(db, roomId)
      return roomView(db.rooms[roomId], userId)
    })
  const newCode = (db) => {
    for (;;) {
      const code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')
      if (!findByCode(db, code)) return code
    }
  }

  return {
    isMock: true,
    userId,
    now,
    session: {
      get() {
        try {
          return JSON.parse(local.getItem(SESSION_KEY))
        } catch {
          return null
        }
      },
      set(value) {
        local.setItem(SESSION_KEY, JSON.stringify(value))
      },
      clear() {
        local.removeItem(SESSION_KEY)
      },
    },

    // setup = { name, home, away, draft }: het volledig ingestelde spel.
    createRoom: (setup) =>
      run((db) => {
        const room = createRoom({ id: newId(), code: newCode(db), userId, ...setup })
        db.rooms[room.id] = room
        save(db, room.id)
        return { roomId: room.id, code: room.code }
      }),

    lookupRoom: (rawCode) =>
      run((db) => {
        const code = normalizeCode(rawCode)
        if (!isValidCode(code)) throw new ApiError('invalid_code')
        const room = findByCode(db, code)
        if (!room) throw new ApiError('room_not_found')
        return roomSummary(room, userId)
      }),

    joinRoom: (rawCode, name) =>
      run((db) => {
        const code = normalizeCode(rawCode)
        if (!isValidCode(code)) throw new ApiError('invalid_code')
        const room = findByCode(db, code)
        if (!room) throw new ApiError('room_not_found')
        const { room: next } = joinRoom(room, { userId, name })
        db.rooms[room.id] = next
        save(db, room.id)
        return { roomId: room.id, code }
      }),

    getRoom: (roomId) =>
      run((db) => {
        const room = roomOrThrow(db, roomId)
        memberOrThrow(room)
        return roomView(room, userId)
      }),

    subscribe(roomId, onChange) {
      const l = (changed) => (changed == null || changed === roomId) && onChange()
      listeners.add(l)
      return () => listeners.delete(l)
    },

    updateSettings: (roomId, draft) => mutate(roomId, (room) => updateSettings(room, { userId, draft })),
    setOrder: (roomId, order) => mutate(roomId, (room) => setOrder(room, { userId, order })),
    shuffleOrder: (roomId) => mutate(roomId, (room) => shuffleOrder(room, { userId, randomInt })),
    removePlayer: (roomId, slot) => mutate(roomId, (room) => removePlayer(room, { userId, slot })),
    startGame: (roomId, expectedVersion) => mutate(roomId, (room) => startGame(room, { userId, expectedVersion, now: now() })),
    addManualPlayer: (roomId, name) => mutate(roomId, (room) => addManualPlayer(room, { userId, name }).room),
    joinSelf: (roomId) => mutate(roomId, (room) => joinSelf(room, { userId }).room),
    spin: (roomId, { onBehalf = false } = {}) => mutate(roomId, (room) => spinTurn(room, { userId, onBehalf, now: now(), randomInt, newId }).room),
    confirmAuction: (roomId, participant, bidCents) => mutate(roomId, (room) => confirmAuction(room, { userId, participant, bidCents, now: now() })),
    advancePhase: (roomId, step) => mutate(roomId, (room) => advancePhase(room, { userId, step, now: now() })),

    // Alleen testmodus: een nagebootste deelnemer (met eigen "telefoon") meldt zich aan.
    addFakePlayer: (roomId) =>
      run((db) => {
        const room = roomOrThrow(db, roomId)
        const taken = new Set(room.players.map((p) => p.name.toLowerCase()))
        const name = FAKE_NAMES.find((n) => !taken.has(n.toLowerCase())) ?? `Speler ${room.players.length + 1}`
        const { room: next } = joinRoom(room, { userId: `nep-${newId()}`, name })
        db.rooms[roomId] = next
        save(db, roomId)
        return name
      }),
  }
}
