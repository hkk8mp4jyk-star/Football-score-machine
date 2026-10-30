// Geheugenopslag voor de servertests met dezelfde regels als de database:
// unieke kamercode, één telefoon per naam en één naam per telefoon, één
// organisator per kamer, versiecontrole en unieke uitslag per kamer.
// Elke aanroep wacht een macrotaak, zodat gelijktijdige verzoeken door elkaar lopen.
import { StoreConflict } from '../src/server/actions.js'

const tick = () => new Promise((r) => (globalThis.setImmediate ?? setTimeout)(r))
const clone = (x) => (x == null ? x : structuredClone(x))

export function createMemoryStore() {
  const rooms = new Map()
  const seats = []
  const draws = []
  let nextId = 1

  return {
    rooms,
    seats,
    draws,
    async findRoomById(id) {
      await tick()
      return clone(rooms.get(id) ?? null)
    },
    async findRoomByCode(code) {
      await tick()
      return clone([...rooms.values()].find((r) => r.code === code) ?? null)
    },
    async countRoomsByOrganizer(userId) {
      await tick()
      return [...rooms.values()].filter((r) => r.organizer_id === userId).length
    },
    async insertRoom({ code, organizer_id, state }) {
      await tick()
      if ([...rooms.values()].some((r) => r.code === code)) throw new StoreConflict('unique')
      const id = `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`
      const room = { id, code, organizer_id, state: clone(state), version: 0 }
      rooms.set(id, room)
      return clone(room)
    },
    async listSeats(roomId) {
      await tick()
      return clone(seats.filter((s) => s.room_id === roomId))
    },
    async insertSeat(seat) {
      await tick()
      const same = seats.filter((s) => s.room_id === seat.room_id)
      if (same.some((s) => s.participant === seat.participant || s.user_id === seat.user_id || (seat.is_organizer && s.is_organizer))) {
        throw new StoreConflict('unique')
      }
      seats.push({ ...seat })
    },
    async deleteSeat(roomId, participant) {
      await tick()
      const i = seats.findIndex((s) => s.room_id === roomId && s.participant === participant)
      if (i < 0) return false
      seats.splice(i, 1)
      return true
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
        draws.push({ room_id: roomId, ...draw })
      }
      room.state = clone(state)
      room.version += 1
      return room.version
    },
  }
}
