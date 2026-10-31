// Geheugenopslag voor de servertests met dezelfde regels als de database:
// unieke kamercode, versiecontrole, unieke uitslag en draai per kamer, één
// trekking per deelnemer per vaste ronde, bod alleen bij de veiling, en het
// Realtime-signaal (room_pulses) dat bij elke wijziging de versie volgt.
// Elke aanroep wacht een macrotaak, zodat gelijktijdige verzoeken door elkaar lopen.
import { StoreConflict } from '../src/server/actions.js'

const tick = () => new Promise((r) => (globalThis.setImmediate ?? setTimeout)(r))
const clone = (x) => (x == null ? x : structuredClone(x))

export function createMemoryStore({ now = () => Date.now() } = {}) {
  const rooms = new Map()
  const draws = []
  const pulses = new Map()
  const listeners = new Set()
  const pulse = (room) => {
    pulses.set(room.id, room.version)
    listeners.forEach((l) => l(room.id, room.version))
  }

  return {
    rooms,
    draws,
    pulses,
    // Realtime nabootsen: luisteraar krijgt (roomId, versie) bij elke wijziging.
    onPulse(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async findRoomById(id) {
      await tick()
      return clone(rooms.get(id) ?? null)
    },
    async findRoomByCode(code) {
      await tick()
      return clone([...rooms.values()].find((r) => r.code === code) ?? null)
    },
    async countRoomsByOrganizerSince(userId, sinceIso) {
      await tick()
      const since = Date.parse(sinceIso)
      return [...rooms.values()].filter((r) => r.organizer_id === userId && r.created_at >= since).length
    },
    async insertRoom({ id, code, organizer_id, state }) {
      await tick()
      if (rooms.has(id) || [...rooms.values()].some((r) => r.code === code)) throw new StoreConflict('unique')
      const room = { id, code, organizer_id, state: clone(state), version: 0, created_at: now() }
      rooms.set(id, room)
      pulse(room)
      return clone(room)
    },
    async commitState(roomId, expectedVersion, state, draw) {
      await tick()
      const room = rooms.get(roomId)
      if (!room || room.version !== expectedVersion) throw new StoreConflict('version')
      if (draw) {
        const roomDraws = draws.filter((d) => d.room_id === roomId)
        if (roomDraws.some((d) => d.result_id === draw.result_id || d.spin_id === draw.spin_id)) throw new StoreConflict('unique')
        if (draw.round !== 'veiling' && roomDraws.some((d) => d.round === draw.round && d.participant === draw.participant)) {
          throw new StoreConflict('unique')
        }
        if ((draw.round === 'veiling') !== (draw.bid_cents != null)) throw new Error('check: bid_cents')
        if (!(draw.result_id === 'OVERIG' || /^[0-6]-[0-6]$/.test(draw.result_id))) throw new Error('check: result_id')
        if (!(draw.participant >= 0 && draw.participant <= 11)) throw new Error('check: participant')
        if (!['1', '2', '3', '4', 'veiling'].includes(draw.round)) throw new Error('check: round')
        draws.push({ room_id: roomId, ...draw })
      }
      room.state = clone(state)
      room.version += 1
      pulse(room)
      return room.version
    },
  }
}
