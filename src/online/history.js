// Geschiedenis (F12): de laatste 10 afgeronde wedstrijden op dit toestel.
//
// Opslag: in de browser (localStorage; in de testmodus per tabblad), net als
// de anonieme identiteit. Blijft bewaard na het sluiten van de browser; een
// ander toestel of gewiste gegevens = geen geschiedenis (zoals D6).
//
// Per wedstrijd bewaren we een volledige, alleen-lezen kopie van de
// eindstand (de kamer zoals de server hem gaf, met de spelstatus afgerond).
// Terugkijken heeft dus geen server nodig en kan niets wijzigen.
//
// Daarnaast een korte lijst van lopende spellen op dit toestel
// (`fsm-my-rooms`): bij het beginscherm worden die één keer opgehaald, zodat
// een spel dat intussen is afgerond ook in de geschiedenis komt.

import { settle } from '../game/engine.js'
import { potCents } from '../game/money.js'
import { deriveView } from '../game/view.js'

export const HISTORY_KEY = 'fsm-history'
export const MY_ROOMS_KEY = 'fsm-my-rooms'
export const MAX_HISTORY = 10
const MAX_MY_ROOMS = 10

// Afgerond = de eindstand staat voor iedereen in beeld: spel klaar én de
// organisator heeft "Bekijk de eindstand" gedaan (zelfde regel als het scherm).
export function isRoomFinished(room, now) {
  if (!room || room.phase !== 'started' || !room.state) return false
  const v = deriveView(room.state, now, room.ack ?? {})
  return v.state.phase === 'finished' && !v.reveal
}

// Eén geschiedenisregel uit een afgeronde kamer.
export function historyEntry(room, now) {
  const state = settle(room.state, now)
  return {
    roomId: room.id,
    code: room.code,
    matchName: room.matchName,
    startedAt: room.startedAt,
    potCents: potCents(state),
    savedAt: now,
    // Alleen-lezen kopie: alles wat het eindscherm en de afbeelding nodig hebben.
    room: {
      id: room.id,
      code: room.code,
      phase: room.phase,
      match: room.match,
      matchName: room.matchName,
      organizerName: room.organizerName,
      startedAt: room.startedAt,
      announce: room.announce ?? null,
      ack: room.ack ?? {},
      state,
    },
  }
}

const validEntry = (e) =>
  e && typeof e.roomId === 'string' && typeof e.matchName === 'string' && Number.isFinite(e.startedAt) && e.room?.state?.config?.players

// Nieuw toevoegen: geen dubbele wedstrijd, nieuwste eerst (speeldatum), max 10.
export function addEntry(list, entry) {
  return [entry, ...list.filter((e) => e.roomId !== entry.roomId)]
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, MAX_HISTORY)
}

function readJson(storage, key) {
  try {
    const v = JSON.parse(storage?.getItem(key))
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}
function writeJson(storage, key, value) {
  try {
    storage?.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false // geen opslag of vol: het spel zelf werkt gewoon door
  }
}

export function createHistoryStore(storage) {
  const list = () => readJson(storage, HISTORY_KEY).filter(validEntry).sort((a, b) => b.startedAt - a.startedAt)
  const myRooms = () => readJson(storage, MY_ROOMS_KEY).filter((r) => r && typeof r.roomId === 'string')
  return {
    list,
    get: (roomId) => list().find((e) => e.roomId === roomId) ?? null,
    has: (roomId) => list().some((e) => e.roomId === roomId),
    // Afgeronde kamer bewaren (en uit de lopende spellen halen).
    save(room, now) {
      if (!isRoomFinished(room, now)) return false
      const ok = writeJson(storage, HISTORY_KEY, addEntry(list(), historyEntry(room, now)))
      this.forget(room.id)
      return ok
    },
    // Lopende spellen op dit toestel (om later afgeronde spellen te vinden).
    myRooms,
    remember(roomId, code) {
      writeJson(storage, MY_ROOMS_KEY, [{ roomId, code }, ...myRooms().filter((r) => r.roomId !== roomId)].slice(0, MAX_MY_ROOMS))
    },
    forget(roomId) {
      writeJson(storage, MY_ROOMS_KEY, myRooms().filter((r) => r.roomId !== roomId))
    },
  }
}

// Lopende spellen van dit toestel nalopen: afgerond → geschiedenis; bestaat
// niet meer of verwijderd → vergeten; geen verbinding → later opnieuw.
export async function collectFinished(api, now = () => api.now()) {
  for (const { roomId } of api.history.myRooms()) {
    if (api.history.has(roomId)) {
      api.history.forget(roomId)
      continue
    }
    try {
      const room = await api.getRoom(roomId)
      if (isRoomFinished(room, now())) api.history.save(room, now())
    } catch (e) {
      if (e?.code && e.code !== 'network') api.history.forget(roomId)
    }
  }
}
