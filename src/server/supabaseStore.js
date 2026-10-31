// Opslag via supabase-js met de service_role-sleutel (alleen in de Edge
// Function). De kamer is één document in rooms.state; wijzigen gebeurt
// uitsluitend via commit_room_state (versiecontrole, trekking in dezelfde
// transactie). Een trigger werkt daarbij room_pulses bij (Realtime-signaal).

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
    // Kamers die deze gebruiker sinds `sinceIso` heeft aangemaakt (misbruikgrens).
    async countRoomsByOrganizerSince(userId, sinceIso) {
      const res = await db.from('rooms').select('id', { count: 'exact', head: true }).eq('organizer_id', userId).gte('created_at', sinceIso)
      check(res)
      return res.count ?? 0
    },
    async insertRoom(room) {
      return check(await db.from('rooms').insert(room).select(ROOM_COLUMNS).single())
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
