// Integratietests: de serverlogica van de Edge Function
// (src/server/actions.js) tegen de echte database, met de rechten van de
// server (rol service_role) en echte gelijktijdige transacties.
// Alle testkamers worden na afloop verwijderd. Onderdeel van `npm run db:test`.

import { randomUUID } from 'node:crypto'
import { ALL_RESULTS } from '../src/game/config.js'
import { settle } from '../src/game/engine.js'
import { turnOrder } from '../src/game/gameConfig.js'
import { releaseDelay } from '../src/game/timeline.js'
import { introTimeline } from '../src/lobby/playRules.js'
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
    async countRoomsByOrganizerSince(userId, sinceIso) {
      return (await q(`select count(*)::int as n from public.rooms where organizer_id = ${text(userId)} and created_at >= ${text(sinceIso)}`))[0].n
    },
    async insertRoom({ id, code, organizer_id, state }) {
      return (await q(`insert into public.rooms (id, code, organizer_id, state) values (${text(id)}, ${text(code)}, ${text(organizer_id)}, ${jsonb(state)}) returning ${cols}`))[0]
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
  const e = await promise.then(
    () => null,
    (err) => err,
  )
  assert(e?.code === code, `verwacht ${code}, kreeg ${e ? (e.code ?? e.message) : 'succes'}`)
}

const NAMES = ['Lars', 'Sanne', 'Bas', 'Marieke', 'Dennis', 'Frank', 'Esther', 'Patrick', 'Jeroen', 'Noor', 'Ahmed', 'Ruud']
const ALL = ALL_RESULTS.map((r) => r.id)

export function serverIntegrationTests(sql) {
  const organizers = new Set()
  const store = createSqlStore(sql)
  const clock = { t: Date.now() }
  const server = createGameServer({ store, now: () => clock.t })
  const call = (uid, body) => server.handle(uid, body)

  // Spel: n deelnemers, `rounds` rondes, pool van n·rounds + `lots` uitslagen.
  const setup = (n, rounds = 1, lots = 2) => {
    const pool = n * rounds + lots >= 50 ? ALL : ALL.filter((id) => id !== 'OVERIG').slice(0, n * rounds + lots - 1).concat('OVERIG')
    return { name: NAMES[0], home: 'Testclub', away: 'Tegenstander', draft: { maxPlayers: n, rounds, priceCents: 1000, pool, mega: [pool[0]] } }
  }
  async function newRoom(n, rounds, lots) {
    const phones = Array.from({ length: n }, () => randomUUID()) // telefoon 0 = organisator
    organizers.add(phones[0])
    const { room } = await call(phones[0], { action: 'create_room', ...setup(n, rounds, lots) })
    for (let i = 1; i < n; i++) await call(phones[i], { action: 'join_room', code: room.code, name: NAMES[i] })
    return { phones, roomId: room.id, code: room.code }
  }
  async function start(r) {
    const { room } = await call(r.phones[0], { action: 'start_game', roomId: r.roomId })
    // Opening tot het Las Vegas-scherm, dan "START SPEL" (organisator) en het vertrekmoment.
    clock.t = Math.max(clock.t, room.startedAt + introTimeline(room.players.length).vegasAt + 1)
    const { room: played } = await call(r.phones[0], { action: 'start_play', roomId: r.roomId })
    clock.t = Math.max(clock.t, played.playAt)
    return room
  }
  const row = async (roomId) => (await sql(`select state, version from public.rooms where id = ${text(roomId)}`))[0]
  const dbCounts = async (roomId) =>
    (
      await sql(`select (select version from public.rooms where id = ${text(roomId)}) as version,
                        (select version from public.room_pulses where room_id = ${text(roomId)}) as pulse,
                        (select count(*) from public.draws where room_id = ${text(roomId)})::int as draws`)
    )[0]
  const waitRelease = (state) => {
    const last = state.spin ?? state.lastSpin
    if (last) clock.t = Math.max(clock.t, last.startedAt + releaseDelay(last) + 1)
  }

  return [
    {
      name: 'server: kamer met volledig ingesteld spel, 12 deelnemers, Realtime-signaal volgt de versie',
      async run() {
        const r = await newRoom(12)
        const c = await dbCounts(r.roomId)
        assert(c.version === 11 && c.pulse === 11 && c.draws === 0, JSON.stringify(c))
        const doc = (await row(r.roomId)).state
        assert(doc.players.length === 12 && doc.match.home === 'Testclub', 'kamerdocument onvolledig')
      },
    },
    {
      name: 'server: 10 telefoons melden zich tegelijk met dezelfde naam → precies één',
      async run() {
        const org = randomUUID()
        organizers.add(org)
        const { room } = await call(org, { action: 'create_room', ...setup(3) })
        const out = await Promise.allSettled(Array.from({ length: 10 }, () => call(randomUUID(), { action: 'join_room', code: room.code, name: 'Sanne' })))
        const ok = out.filter((o) => o.status === 'fulfilled').length
        const rest = out.filter((o) => o.status === 'rejected' && !['name_taken', 'conflict'].includes(o.reason.code))
        assert(ok === 1 && !rest.length, `geslaagd ${ok}, overig ${rest.map((o) => o.reason.code)}`)
      },
    },
    {
      name: 'server: 10 telefoons melden zich tegelijk aan bij 1 vrije plek → nooit te veel deelnemers',
      async run() {
        const org = randomUUID()
        organizers.add(org)
        const { room } = await call(org, { action: 'create_room', ...setup(2) })
        await Promise.allSettled(Array.from({ length: 10 }, (_, i) => call(randomUUID(), { action: 'join_room', code: room.code, name: `Speler ${i}` })))
        const doc = (await row(room.id)).state
        assert(doc.players.length <= 2, `${doc.players.length} deelnemers`)
      },
    },
    {
      name: 'server: aanmelden en starten tegelijk → consistente stand (D8)',
      async run() {
        for (let k = 0; k < 5; k++) {
          const r = await newRoom(3)
          await call(r.phones[0], { action: 'remove_player', roomId: r.roomId, slot: 2 })
          const out = await Promise.allSettled([
            call(r.phones[0], { action: 'start_game', roomId: r.roomId }),
            call(randomUUID(), { action: 'join_room', code: r.code, name: 'Laat' }),
          ])
          const doc = (await row(r.roomId)).state
          if (doc.phase === 'started') {
            assert(out[0].status === 'fulfilled' && doc.state.config.players.length === 3, 'gestart met verkeerde deelnemers')
          } else {
            assert(out[0].status === 'rejected' && ['players_incomplete', 'conflict'].includes(out[0].reason.code), `start: ${out[0].reason?.code}`)
          }
        }
      },
    },
    {
      name: 'server: 10 gelijktijdige SPIN-verzoeken → precies één trekking',
      async run() {
        const r = await newRoom(2)
        await start(r)
        const before = (await dbCounts(r.roomId)).version
        const out = await Promise.allSettled(Array.from({ length: 10 }, () => call(r.phones[0], { action: 'spin', roomId: r.roomId })))
        const ok = out.filter((o) => o.status === 'fulfilled').length
        const other = out.filter((o) => o.status === 'rejected' && !['spin_in_progress', 'turn_not_released', 'conflict'].includes(o.reason.code))
        const c = await dbCounts(r.roomId)
        assert(ok === 1 && !other.length && c.draws === 1 && c.version === before + 1, `geslaagd ${ok}, ${JSON.stringify(c)}, ${other.map((o) => o.reason.message)}`)
      },
    },
    {
      name: 'server: deelnemer en organisator (namens) tegelijk → precies één trekking',
      async run() {
        const r = await newRoom(2)
        await start(r)
        waitRelease((await call(r.phones[0], { action: 'spin', roomId: r.roomId })).room.state)
        await Promise.allSettled([call(r.phones[1], { action: 'spin', roomId: r.roomId }), call(r.phones[0], { action: 'spin', roomId: r.roomId, onBehalf: true })])
        const c = await dbCounts(r.roomId)
        assert(c.draws === 2, JSON.stringify(c))
      },
    },
    {
      name: 'server: geweigerde acties veranderen niets in de database',
      async run() {
        const r = await newRoom(3)
        const v0 = (await dbCounts(r.roomId)).version
        for (const body of [
          { action: 'start_game', roomId: r.roomId },
          { action: 'set_order', roomId: r.roomId, order: [2, 1, 0] },
          { action: 'shuffle_order', roomId: r.roomId },
          { action: 'remove_player', roomId: r.roomId, slot: 0 },
          { action: 'update_settings', roomId: r.roomId, draft: setup(3).draft },
          { action: 'add_manual_player', roomId: r.roomId, name: 'Opa' },
        ]) {
          await expectError(call(r.phones[2], body), 'not_organizer')
        }
        await expectError(call(randomUUID(), { action: 'get_room', roomId: r.roomId }), 'room_not_found')
        await start(r)
        await expectError(call(r.phones[2], { action: 'spin', roomId: r.roomId }), 'not_your_turn')
        await expectError(call(r.phones[2], { action: 'spin', roomId: r.roomId, onBehalf: true }), 'not_your_turn')
        await expectError(call(r.phones[2], { action: 'advance_phase', roomId: r.roomId, step: 'auction' }), 'not_organizer')
        await expectError(call(r.phones[2], { action: 'confirm_auction', roomId: r.roomId, participant: 2, bidCents: 100 }), 'not_organizer')
        await expectError(call(r.phones[2], { action: 'start_play', roomId: r.roomId }), 'not_organizer')
        await expectError(call(r.phones[0], { action: 'start_play', roomId: r.roomId }), 'nothing_to_advance') // al gedrukt
        const c = await dbCounts(r.roomId)
        assert(c.draws === 0 && c.version === v0 + 2, JSON.stringify(c)) // alleen de start en "START SPEL"
      },
    },
    {
      name: 'server: volledig spel 12 × 4 met alle 50 uitslagen, namens, veilingen en faseovergangen',
      async run() {
        const r = await newRoom(12, 4, 2)
        await call(r.phones[0], { action: 'shuffle_order', roomId: r.roomId })
        await start(r)
        let state = (await row(r.roomId)).state.state
        for (let i = 0; i < 48; i++) {
          waitRelease(state)
          const s = settle(state, clock.t)
          const p = turnOrder(s.config)[s.turn].participant
          const onBehalf = p === 5 && i >= 24
          state = (await call(onBehalf ? r.phones[0] : r.phones[p], { action: 'spin', roomId: r.roomId, onBehalf })).room.state
        }
        waitRelease(state)
        await expectError(call(r.phones[0], { action: 'confirm_auction', roomId: r.roomId, participant: 3, bidCents: 100 }), 'auction_not_open')
        await call(r.phones[0], { action: 'advance_phase', roomId: r.roomId, step: 'auction' })
        for (const [buyer, bid] of [
          [3, 2500],
          [7, 1250],
        ]) {
          const c = await call(r.phones[0], { action: 'confirm_auction', roomId: r.roomId, participant: buyer, bidCents: bid })
          assert(c.room.announce.participant === buyer, 'aankondiging klopt niet')
          state = (await call(r.phones[buyer], { action: 'spin', roomId: r.roomId })).room.state
          waitRelease(state)
        }
        await call(r.phones[0], { action: 'advance_phase', roomId: r.roomId, step: 'final' })
        const doc = (await row(r.roomId)).state
        const final = settle(doc.state, clock.t)
        const draws = await sql(`select result_id, participant, round, bid_cents, on_behalf from public.draws where room_id = ${text(r.roomId)} order by id`)
        assert(final.phase === 'finished' && doc.ack.finish, `fase ${final.phase}`)
        assert(draws.length === 50 && new Set(draws.map((d) => d.result_id)).size === 50, `${draws.length} trekkingen`)
        assert(
          JSON.stringify(draws.map((d) => [d.result_id, d.participant, d.round])) ===
            JSON.stringify(final.draws.map((d) => [d.resultId, d.participant, String(d.round)])),
          'database en spelstatus verschillen',
        )
        assert(draws.filter((d) => d.on_behalf).length >= 1, 'namens-trekking niet vastgelegd')
        assert(JSON.stringify(draws.filter((d) => d.round === 'veiling').map((d) => d.bid_cents)) === '[2500,1250]', 'biedingen kloppen niet')
        await expectError(call(r.phones[0], { action: 'spin', roomId: r.roomId }), 'game_finished')
      },
    },
    {
      name: 'server: testkamers opgeruimd',
      async run() {
        const ids = [...organizers].map(text).join(', ')
        await sql(`delete from public.rooms where organizer_id in (${ids})`)
        const [left] = await sql(`select (select count(*) from public.rooms)::int as rooms, (select count(*) from public.draws)::int as draws,
          (select count(*) from public.room_pulses)::int as pulses`)
        assert(left.rooms === 0 && left.draws === 0 && left.pulses === 0, `achtergebleven: ${JSON.stringify(left)}`)
      },
    },
  ]
}
