// Opslag via supabase-js met de service_role-sleutel (alleen in de Edge
// Function). De spelstatus wordt uitsluitend via commit_room_state gewijzigd.

import { StoreConflict } from './actions.js'

const ROOM_COLUMNS = 'id, code, organizer_id, state, version'

function check({ data, error }) {
  if (!error) return data
  if (error.code === '23505') throw new StoreConflict('unique', error.message)
  // commit_room_state meldt een verouderde versie met PT409 (PostgREST → HTTP 409).
  if (error.code === 'PT409' || /version_conflict/.test(error.message ?? '')) throw new StoreConflict('version', error.message)
  throw new Error(`database: ${error.code ?? ''} ${error.message ?? ''}`.trim())
}

export function createSupabaseStore(db) {
  return {
    async findRoomById(id) {
      return check(await db.from('rooms').select(ROOM_COLUMNS).eq('id', id).maybeSingle())
    },
    async findRoomByCode(code) {
      return check(await db.from('rooms').select(ROOM_COLUMNS).eq('code', code).maybeSingle())
    },
    async countRoomsByOrganizer(userId) {
      const res = await db.from('rooms').select('id', { count: 'exact', head: true }).eq('organizer_id', userId)
      check(res)
      return res.count ?? 0
    },
    async insertRoom(room) {
      return check(await db.from('rooms').insert(room).select(ROOM_COLUMNS).single())
    },
    async listSeats(roomId) {
      return check(await db.from('seats').select('participant, user_id, is_organizer').eq('room_id', roomId))
    },
    async insertSeat(seat) {
      check(await db.from('seats').insert(seat))
    },
    async deleteSeat(roomId, participant) {
      const rows = check(await db.from('seats').delete().eq('room_id', roomId).eq('participant', participant).select('participant'))
      return rows.length > 0
    },
    async commitState(roomId, expectedVersion, state, draw) {
      return check(
        await db.rpc('commit_room_state', {
          p_room_id: roomId,
          p_expected_version: expectedVersion,
          p_state: state,
          p_draw: draw,
        }),
      )
    },
  }
}
