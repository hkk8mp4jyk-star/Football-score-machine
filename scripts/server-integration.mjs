// Integratietests (fase 3): de serverlogica van de Edge Function
// (src/server/actions.js) tegen de echte database, met de rechten van de
// server (rol service_role) en echte gelijktijdige transacties.
// Alle testkamers worden na afloop verwijderd. Onderdeel van `npm run db:test`.

import { randomUUID } from 'node:crypto'
import { DRAW_TURNS, RESULTS, TURN_ORDER } from '../src/game/config.js'
import { settle } from '../src/game/engine.js'
import { releaseDelay } from '../src/game/timeline.js'
import { StoreConflict, createGameServer } from '../src/server/actions.js'

// SQL-waarde veilig als letterlijke tekst (standard_conforming_strings staat aan).
const text = (v) => (v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`)
const jsonb = (v) => (v == null ? 'null' : `${text(JSON.stringify(v))}::jsonb`)

// Opslag met dezelfde queries als supabaseStore.js, als service_role.
export function createSqlStore(sql) {
  const q = async (query) => {
    try {
      return await sql(`set role service_role; ${query}`)
    } catch (e) {
      if (/ERROR:\s+23505/.test(e.message)) throw new StoreConflict('unique', e.message)
      if (/ERROR:\s+PT409/.test(e.message)) throw new StoreConflict('version', e.message)
      throw e
    }
  }
  const cols = 'id, code, organizer_id, state, version'
  return {
    async findRoomById(id) {
      return (await q(`select ${cols} from public.rooms where id = ${text(id)}`))[0] ?? null
    },
    async findRoomByCode(code) {
      return (await q(`select ${cols} from public.rooms where code = ${text(code)}`))[0] ?? null
    },
    async countRoomsByOrganizer(userId) {
      return (await q(`select count(*)::int as n from public.rooms where organizer_id = ${text(userId)}`))[0].n
    },
    async insertRoom({ code, organizer_id, state }) {
      return (await q(`insert into public.rooms (code, organizer_id, state) values (${text(code)}, ${text(organizer_id)}, ${jsonb(state)}) returning ${cols}`))[0]
    },
    async listSeats(roomId) {
      return q(`select participant, user_id, is_organizer from public.seats where room_id = ${text(roomId)}`)
    },
    async insertSeat({ room_id, participant, user_id, is_organizer }) {
      await q(`insert into public.seats (room_id, participant, user_id, is_organizer) values (${text(room_id)}, ${participant}, ${text(user_id)}, ${is_organizer})`)
    },
    async deleteSeat(roomId, participant) {
      return (await q(`delete from public.seats where room_id = ${text(roomId)} and participant = ${participant} returning participant`)).length > 0
    },
    async commitState(roomId, expectedVersion, state, draw) {
      return (await q(`select public.commit_room_state(${text(roomId)}, ${expectedVersion}, ${jsonb(state)}, ${jsonb(draw)}) as v`))[0].v
    },
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

async function expectError(promise, code) {
  const e = await promise.then(() => null, (err) => err)
  assert(e?.code === code, `verwacht ${code}, kreeg ${e ? e.code ?? e.message : 'succes'}`)
}

export function serverIntegrationTests(sql) {
  const organizers = new Set()
  const store = createSqlStore(sql)
  const clock = { t: Date.now() }
  const server = createGameServer({ store, now: () => clock.t })
  const call = (uid, body) => server.handle(uid, body)

  async function newRoom() {
    const phones = Array.from({ length: 9 }, () => randomUUID()) // deelnemer 0 = organisator
    organizers.add(phones[0])
    const { room } = await call(phones[0], { action: 'create_room', participant: 0 })
    await Promise.all(phones.slice(1).map((uid, i) => call(uid, { action: 'claim_seat', code: room.code, participant: i + 1 })))
    return { phones, roomId: room.id, code: room.code }
  }
  const dbCounts = async (roomId) =>
    (
      await sql(`select (select version from public.rooms where id = ${text(roomId)}) as version,
                        (select count(*) from public.draws where room_id = ${text(roomId)})::int as draws,
                        (select count(*) from public.seats where room_id = ${text(roomId)})::int as seats`)
    )[0]

  return [
    {
      name: 'server: kamer maken en 9 namen claimen (echte database)',
      async run() {
        const { roomId } = await newRoom()
        const c = await dbCounts(roomId)
        assert(c.seats === 9 && c.version === 0 && c.draws === 0, JSON.stringify(c))
      },
    },
    {
      name: 'server: 10 telefoons claimen tegelijk dezelfde naam → precies één',
      async run() {
        const org = randomUUID()
        organizers.add(org)
        const { room } = await call(org, { action: 'create_room', participant: 0 })
        const out = await Promise.allSettled(Array.from({ length: 10 }, () => call(randomUUID(), { action: 'claim_seat', code: room.code, participant: 4 })))
        const ok = out.filter((o) => o.status === 'fulfilled').length
        const taken = out.filter((o) => o.reason?.code === 'seat_taken').length
        assert(ok === 1 && taken === 9, `geslaagd ${ok}, bezet ${taken}`)
      },
    },
    {
      name: 'server: 10 gelijktijdige SPIN-verzoeken → precies één trekking',
      async run() {
        const { phones, roomId } = await newRoom()
        const out = await Promise.allSettled(Array.from({ length: 10 }, () => call(phones[0], { action: 'spin', roomId })))
        const ok = out.filter((o) => o.status === 'fulfilled').length
        const other = out.filter((o) => o.status === 'rejected' && !['turn_not_released', 'conflict'].includes(o.reason.code))
        const c = await dbCounts(roomId)
        assert(ok === 1 && !other.length && c.draws === 1 && c.version === 1, `geslaagd ${ok}, ${JSON.stringify(c)}, ${other.map((o) => o.reason.message)}`)
      },
    },
    {
      name: 'server: geweigerde acties veranderen niets in de database',
      async run() {
        const { phones, roomId } = await newRoom()
        await expectError(call(phones[3], { action: 'spin', roomId }), 'not_your_turn')
        await expectError(call(phones[3], { action: 'spin', roomId, onBehalf: true }), 'not_your_turn')
        await expectError(call(randomUUID(), { action: 'spin', roomId }), 'room_not_found')
        await expectError(call(phones[3], { action: 'auction_prepare', roomId, participant: 3, bidCents: 100 }), 'not_organizer')
        await expectError(call(phones[3], { action: 'release_seat', roomId, participant: 4 }), 'not_organizer')
        const c = await dbCounts(roomId)
        assert(c.draws === 0 && c.version === 0 && c.seats === 9, JSON.stringify(c))
      },
    },
    {
      name: 'server: volledig spel (18 + 8, namens draaien) → 26 unieke trekkingen, klopt met status',
      async run() {
        const { phones, roomId } = await newRoom()
        const room = async () => (await sql(`select state, version from public.rooms where id = ${text(roomId)}`))[0]
        let state = (await room()).state
        const waitRelease = () => {
          const last = state.spin ?? state.lastSpin
          if (last) clock.t = Math.max(clock.t, last.startedAt + releaseDelay(last))
        }
        for (let i = 0; i < DRAW_TURNS; i++) {
          waitRelease()
          const p = TURN_ORDER[i].participant
          const body = { action: 'spin', roomId, ...(p === 5 && i >= 9 ? { onBehalf: true } : {}) }
          state = (await call(p === 5 && i >= 9 ? phones[0] : phones[p], body)).room.state
        }
        for (let lot = 0; lot < 8; lot++) {
          waitRelease()
          const buyer = (lot * 2 + 1) % 9
          await call(phones[0], { action: 'auction_prepare', roomId, participant: buyer, bidCents: 250 * (lot + 1) })
          state = (await call(phones[buyer], { action: 'spin', roomId })).room.state
        }
        waitRelease()
        const final = settle((await room()).state, clock.t)
        const draws = await sql(`select result_id, participant, round, bid_cents, on_behalf from public.draws where room_id = ${text(roomId)} order by id`)
        assert(final.phase === 'finished', `fase ${final.phase}`)
        assert(draws.length === 26 && new Set(draws.map((d) => d.result_id)).size === 26, `${draws.length} trekkingen`)
        assert(RESULTS.every((r) => draws.some((d) => d.result_id === r.id)), 'niet alle uitslagen getrokken')
        assert(
          JSON.stringify(draws.map((d) => [d.result_id, d.participant, d.round])) ===
            JSON.stringify(final.draws.map((d) => [d.resultId, d.participant, String(d.round)])),
          'database en spelstatus verschillen',
        )
        assert(draws.filter((d) => d.on_behalf).length === 1, 'namens-trekking niet vastgelegd')
        assert(draws.filter((d) => d.round === 'veiling').every((d, i) => d.bid_cents === 250 * (i + 1)), 'biedingen kloppen niet')
        await expectError(call(phones[0], { action: 'spin', roomId }), 'game_finished')
      },
    },
    {
      name: 'server: testkamers opgeruimd',
      async run() {
        const ids = [...organizers].map(text).join(', ')
        await sql(`delete from public.rooms where organizer_id in (${ids})`)
        const [left] = await sql(`select (select count(*) from public.rooms)::int as rooms, (select count(*) from public.draws)::int as draws, (select count(*) from public.seats)::int as seats`)
        assert(left.rooms === 0 && left.draws === 0 && left.seats === 0, `achtergebleven: ${JSON.stringify(left)}`)
      },
    },
  ]
}
