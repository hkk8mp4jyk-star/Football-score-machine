// Servertests (fase 3): de logica van de Edge Function met een geheugenopslag
// die dezelfde regels afdwingt als de database. Tijd is een nep-klok.
import { describe, expect, it } from 'vitest'
import { DRAW_TURNS, RESULTS, TURN_ORDER } from '../src/game/config.js'
import { settle } from '../src/game/engine.js'
import { releaseDelay } from '../src/game/timeline.js'
import { deriveView } from '../src/game/view.js'
import { ActionError, CODE_RE, MAX_ROOMS_PER_USER, StoreConflict, createGameServer, generateRoomCode } from '../src/server/actions.js'
import { createHttpHandler } from '../src/server/http.js'
import { createSupabaseStore } from '../src/server/supabaseStore.js'
import { seededRandomInt } from './helpers.js'
import { createMemoryStore } from './memoryStore.js'

const user = (i) => `00000000-0000-4000-a000-${String(i).padStart(12, '0')}`
const ORG = user(100) // organisator, speelt zelf als deelnemer 0
const P = Array.from({ length: 9 }, (_, i) => (i === 0 ? ORG : user(i))) // telefoon per deelnemer
const OUTSIDER = user(999)

const CHI2_DF25 = 59.7 // chi-kwadraat, 25 vrijheidsgraden, p = 0,0001

function setup({ randomInt = seededRandomInt(7), store = createMemoryStore() } = {}) {
  const clock = { t: 1_800_000_000_000 }
  const server = createGameServer({ store, randomInt, now: () => clock.t })
  const call = (uid, body) => server.handle(uid, body)
  const fails = async (promise, code) => {
    const e = await promise.then(
      (r) => ({ unexpected: r }),
      (err) => err,
    )
    expect(e).toBeInstanceOf(ActionError)
    expect(e.code).toBe(code)
    return e
  }
  return { store, clock, server, call, fails }
}

// Kamer met alle 9 namen geclaimd; organisator is deelnemer 0.
async function fullRoom(opts) {
  const ctx = setup(opts)
  const created = await ctx.call(ORG, { action: 'create_room', participant: 0 })
  const { id: roomId, code } = created.room
  for (let p = 1; p < 9; p++) await ctx.call(P[p], { action: 'claim_seat', code, participant: p })
  const room = () => ctx.store.rooms.get(roomId)
  // Wacht tot de vorige draai is afgerond en de volgende beurt vrij is.
  const waitRelease = () => {
    const s = room().state
    const last = s.spin ?? s.lastSpin
    if (last) ctx.clock.t = Math.max(ctx.clock.t, last.startedAt + releaseDelay(last))
  }
  const whoseTurn = () => {
    const s = settle(room().state, ctx.clock.t)
    return s.phase === 'draw' ? TURN_ORDER[s.turn].participant : s.auctionTurn?.participant
  }
  return { ...ctx, roomId, code, room, waitRelease, whoseTurn }
}

describe('server: toegang en invoer', () => {
  it('weigert verzoeken zonder geldige gebruiker of met onbekende actie', async () => {
    const { call, fails } = setup()
    await fails(call(null, { action: 'time' }), 'unauthorized')
    await fails(call('niet-een-uuid', { action: 'time' }), 'unauthorized')
    await fails(call(ORG, null), 'invalid_input')
    await fails(call(ORG, [1]), 'invalid_input')
    await fails(call(ORG, { action: 'RESET' }), 'unknown_action')
    await fails(call(ORG, { action: 'DEMO_SKIP_TO_AUCTION' }), 'unknown_action')
    await fails(call(ORG, { action: 'SPIN_START' }), 'unknown_action')
    await fails(call(ORG, { action: '__proto__' }), 'unknown_action')
  })

  it('geeft bij elk antwoord de servertijd mee (voor de gedeelde klok)', async () => {
    const { call, clock } = setup()
    expect(await call(ORG, { action: 'time' })).toEqual({ ok: true, serverNow: clock.t })
  })

  it('controleert kamer-id, code, deelnemer en bod', async () => {
    const r = await fullRoom()
    await r.fails(r.call(ORG, { action: 'get_room', roomId: 'x' }), 'invalid_input')
    await r.fails(r.call(ORG, { action: 'lookup_room', code: 'ABC' }), 'invalid_input')
    await r.fails(r.call(ORG, { action: 'lookup_room', code: 'ABCDE0' }), 'invalid_input') // 0 bestaat niet
    for (const participant of [-1, 9, 1.5, '1', null]) {
      await r.fails(r.call(OUTSIDER, { action: 'claim_seat', code: r.code, participant }), 'invalid_input')
    }
    for (const bidCents of [-1, 12.5, '100', null, 1_000_001]) {
      await r.fails(r.call(ORG, { action: 'auction_prepare', roomId: r.roomId, participant: 1, bidCents }), 'invalid_input')
    }
    await r.fails(r.call(ORG, { action: 'spin', roomId: r.roomId, onBehalf: 'ja' }), 'invalid_input')
  })
})

describe('server: kamer en namen', () => {
  it('kamer maken: geldige code, maker is organisator, nieuwe spelstatus', async () => {
    const { call, store } = setup()
    const res = await call(ORG, { action: 'create_room', participant: 0 })
    expect(res.room.code).toMatch(CODE_RE)
    expect(res.room.version).toBe(0)
    expect(res.room.state).toMatchObject({ phase: 'draw', turn: 0, draws: [], spin: null })
    expect(res.room.state.remaining).toHaveLength(26)
    expect(res).toMatchObject({ mySeat: 0, isOrganizer: true })
    expect(store.seats).toEqual([{ room_id: res.room.id, participant: 0, user_id: ORG, is_organizer: true }])
  })

  it('kamercodes: alleen toegestane tekens, nieuwe code bij een botsing', async () => {
    for (let i = 0; i < 200; i++) expect(generateRoomCode()).toMatch(CODE_RE)
    let n = 0
    const repeat = () => (n++ < 12 ? 0 : 5) // eerste 2 codes 'AAAAAA', daarna anders
    const { call } = setup({ randomInt: repeat })
    const a = await call(user(1), { action: 'create_room' })
    const b = await call(user(2), { action: 'create_room' })
    expect(a.room.code).toBe('AAAAAA')
    expect(b.room.code).not.toBe('AAAAAA')
  })

  it('maximaal aantal kamers per telefoon', async () => {
    const { call, fails } = setup()
    for (let i = 0; i < MAX_ROOMS_PER_USER; i++) await call(ORG, { action: 'create_room' })
    await fails(call(ORG, { action: 'create_room' }), 'too_many_rooms')
  })

  it('kamer opzoeken: vrije en bezette namen, zonder gebruikers-id’s', async () => {
    const { call, fails } = setup()
    const { room } = await call(ORG, { action: 'create_room', participant: 0 })
    const res = await call(OUTSIDER, { action: 'lookup_room', code: room.code.toLowerCase() })
    expect(res).toMatchObject({ roomId: room.id, phase: 'draw', mySeat: null, isOrganizer: false })
    expect(res.seats).toEqual([{ participant: 0, isOrganizer: true, mine: false }])
    expect(JSON.stringify(res)).not.toContain(ORG)
    await fails(call(OUTSIDER, { action: 'lookup_room', code: 'ZZZZZZ' }), 'room_not_found')
  })

  it('naam claimen: bezet, al een naam, dubbel verzoek', async () => {
    const { call, fails } = setup()
    const { room } = await call(ORG, { action: 'create_room', participant: 0 })
    await fails(call(user(1), { action: 'claim_seat', code: room.code, participant: 0 }), 'seat_taken')
    expect(await call(user(1), { action: 'claim_seat', code: room.code, participant: 1 })).toMatchObject({ mySeat: 1, isOrganizer: false })
    expect(await call(user(1), { action: 'claim_seat', code: room.code, participant: 1 })).toMatchObject({ mySeat: 1 }) // opnieuw: zelfde antwoord
    await fails(call(user(1), { action: 'claim_seat', code: room.code, participant: 2 }), 'already_seated')
    await fails(call(user(1), { action: 'claim_seat', code: 'ZZZZZZ', participant: 2 }), 'room_not_found')
  })

  it('organisator zonder naam kan later zijn naam claimen', async () => {
    const { call, store } = setup()
    const { room } = await call(ORG, { action: 'create_room' })
    expect(await call(ORG, { action: 'claim_seat', code: room.code, participant: 4 })).toMatchObject({ mySeat: 4, isOrganizer: true })
    expect(store.seats[0]).toMatchObject({ participant: 4, is_organizer: true })
  })

  it('10 telefoons claimen tegelijk dezelfde naam: precies één krijgt hem', async () => {
    const { call, store } = setup()
    const { room } = await call(ORG, { action: 'create_room', participant: 0 })
    const out = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => call(user(i + 1), { action: 'claim_seat', code: room.code, participant: 5 })))
    expect(out.filter((o) => o.status === 'fulfilled')).toHaveLength(1)
    expect(out.filter((o) => o.reason?.code === 'seat_taken')).toHaveLength(9)
    expect(store.seats.filter((s) => s.participant === 5)).toHaveLength(1)
  })

  it('één telefoon claimt tegelijk twee namen: hij krijgt er maar één', async () => {
    const { call, store } = setup()
    const { room } = await call(ORG, { action: 'create_room', participant: 0 })
    const out = await Promise.allSettled([3, 4].map((participant) => call(user(1), { action: 'claim_seat', code: room.code, participant })))
    expect(out.filter((o) => o.status === 'fulfilled')).toHaveLength(1)
    expect(out.find((o) => o.status === 'rejected').reason.code).toBe('already_seated')
    expect(store.seats.filter((s) => s.user_id === user(1))).toHaveLength(1)
  })

  it('kamer bekijken: alleen voor leden', async () => {
    const r = await fullRoom()
    const res = await r.call(P[3], { action: 'get_room', roomId: r.roomId })
    expect(res).toMatchObject({ mySeat: 3, isOrganizer: false, room: { id: r.roomId, version: 0 } })
    expect(res.seats).toHaveLength(9)
    expect(res.seats.filter((s) => s.mine)).toEqual([{ participant: 3, isOrganizer: false, mine: true }])
    await r.fails(r.call(OUTSIDER, { action: 'get_room', roomId: r.roomId }), 'room_not_found')
    await r.fails(r.call(OUTSIDER, { action: 'get_room', roomId: user(5) }), 'room_not_found')
  })

  it('plek vrijgeven: alleen de organisator; daarna kan een nieuwe telefoon de naam claimen', async () => {
    const r = await fullRoom()
    await r.fails(r.call(P[3], { action: 'release_seat', roomId: r.roomId, participant: 4 }), 'not_organizer')
    await r.fails(r.call(OUTSIDER, { action: 'release_seat', roomId: r.roomId, participant: 4 }), 'room_not_found')
    expect(await r.call(ORG, { action: 'release_seat', roomId: r.roomId, participant: 4 })).toMatchObject({ participant: 4 })
    await r.fails(r.call(ORG, { action: 'release_seat', roomId: r.roomId, participant: 4 }), 'seat_not_found')
    await r.fails(r.call(P[4], { action: 'get_room', roomId: r.roomId }), 'room_not_found') // oude telefoon is geen lid meer
    const newPhone = user(44)
    await r.call(newPhone, { action: 'claim_seat', code: r.code, participant: 4 })
    expect(r.store.seats.find((s) => s.participant === 4).user_id).toBe(newPhone)
  })
})

describe('server: SPIN en autorisatie', () => {
  it('alleen wie aan de beurt is mag draaien; de server kiest en legt meteen vast', async () => {
    const r = await fullRoom()
    await r.fails(r.call(P[1], { action: 'spin', roomId: r.roomId }), 'not_your_turn')
    await r.fails(r.call(OUTSIDER, { action: 'spin', roomId: r.roomId }), 'room_not_found')
    expect(r.store.draws).toHaveLength(0)

    const res = await r.call(ORG, { action: 'spin', roomId: r.roomId }) // organisator is deelnemer 0
    expect(res.onBehalf).toBe(false)
    expect(res.spin).toMatchObject({ participant: 0, round: 1, bid: null, startedAt: r.clock.t })
    expect(res.room.version).toBe(1)
    expect(r.room().state.spin).toEqual(res.spin)
    expect(r.store.draws).toEqual([
      {
        room_id: r.roomId,
        spin_id: res.spin.id,
        result_id: res.spin.resultId,
        participant: 0,
        round: '1',
        bid_cents: null,
        started_at: new Date(r.clock.t).toISOString(),
        spun_by: ORG,
        on_behalf: false,
      },
    ])
  })

  it('negeert wat de telefoon over de uitslag of deelnemer meestuurt', async () => {
    const r = await fullRoom()
    const res = await r.call(ORG, { action: 'spin', roomId: r.roomId, resultId: '1-0', participant: 5, round: 'veiling', bid: 0, now: 0 })
    expect(res.spin).toMatchObject({ participant: 0, round: 1, startedAt: r.clock.t })
  })

  it('dubbele SPIN van dezelfde telefoon: de tweede wordt geweigerd, één trekking', async () => {
    const r = await fullRoom()
    await r.call(ORG, { action: 'spin', roomId: r.roomId })
    r.clock.t += 500
    await r.fails(r.call(ORG, { action: 'spin', roomId: r.roomId }), 'turn_not_released')
    // De volgende deelnemer moet wachten tot de beurt is vrijgegeven.
    await r.fails(r.call(P[1], { action: 'spin', roomId: r.roomId }), 'turn_not_released')
    expect(r.store.draws).toHaveLength(1)
    r.waitRelease()
    await r.fails(r.call(ORG, { action: 'spin', roomId: r.roomId }), 'not_your_turn')
    expect((await r.call(P[1], { action: 'spin', roomId: r.roomId })).spin.participant).toBe(1)
  })

  it('10 gelijktijdige SPIN-verzoeken: precies één trekking', async () => {
    const r = await fullRoom()
    const out = await Promise.allSettled(Array.from({ length: 10 }, () => r.call(ORG, { action: 'spin', roomId: r.roomId })))
    expect(out.filter((o) => o.status === 'fulfilled')).toHaveLength(1)
    for (const o of out.filter((o) => o.status === 'rejected')) expect(['turn_not_released', 'conflict']).toContain(o.reason.code)
    expect(r.store.draws).toHaveLength(1)
    expect(r.room().version).toBe(1)
  })

  it('deelnemer en organisator (namens) tegelijk: precies één trekking', async () => {
    const r = await fullRoom()
    r.waitRelease()
    // Beurt 0 is van de organisator zelf; ga naar beurt 1 (deelnemer 1).
    await r.call(ORG, { action: 'spin', roomId: r.roomId })
    r.waitRelease()
    const out = await Promise.allSettled([
      r.call(P[1], { action: 'spin', roomId: r.roomId }),
      r.call(ORG, { action: 'spin', roomId: r.roomId, onBehalf: true }),
      r.call(P[1], { action: 'spin', roomId: r.roomId }),
    ])
    expect(out.filter((o) => o.status === 'fulfilled')).toHaveLength(1)
    expect(r.store.draws.filter((d) => d.round === '1' && d.participant === 1)).toHaveLength(1)
  })

  it('noodfunctie: alleen de organisator, alleen expliciet, vastgelegd als on_behalf', async () => {
    const r = await fullRoom()
    await r.call(ORG, { action: 'spin', roomId: r.roomId })
    r.waitRelease() // deelnemer 1 is aan de beurt
    await r.fails(r.call(ORG, { action: 'spin', roomId: r.roomId }), 'not_your_turn') // zonder onBehalf: nee
    await r.fails(r.call(P[2], { action: 'spin', roomId: r.roomId, onBehalf: true }), 'not_your_turn') // geen organisator
    await r.fails(r.call(OUTSIDER, { action: 'spin', roomId: r.roomId, onBehalf: true }), 'room_not_found')
    const res = await r.call(ORG, { action: 'spin', roomId: r.roomId, onBehalf: true })
    expect(res).toMatchObject({ onBehalf: true, spin: { participant: 1 } })
    expect(r.store.draws[1]).toMatchObject({ participant: 1, spun_by: ORG, on_behalf: true })
  })

  it('namens draaien kan ook voor een (nog) lege plek', async () => {
    const r = await fullRoom()
    await r.call(ORG, { action: 'spin', roomId: r.roomId })
    await r.call(ORG, { action: 'release_seat', roomId: r.roomId, participant: 1 })
    r.waitRelease()
    expect((await r.call(ORG, { action: 'spin', roomId: r.roomId, onBehalf: true })).spin.participant).toBe(1)
  })

  it('wie zelf aan de beurt is en onBehalf meestuurt, draait gewoon zelf', async () => {
    const r = await fullRoom()
    const res = await r.call(ORG, { action: 'spin', roomId: r.roomId, onBehalf: true })
    expect(res.onBehalf).toBe(false)
    expect(r.store.draws[0].on_behalf).toBe(false)
  })
})

describe('server: veiling', () => {
  async function toAuction() {
    const r = await fullRoom()
    for (let i = 0; i < DRAW_TURNS; i++) {
      r.waitRelease()
      await r.call(P[r.whoseTurn()], { action: 'spin', roomId: r.roomId })
    }
    r.waitRelease()
    return r
  }

  it('alleen in de veiling, alleen de organisator, niet tijdens een draai', async () => {
    const r = await fullRoom()
    await r.fails(r.call(ORG, { action: 'auction_prepare', roomId: r.roomId, participant: 1, bidCents: 500 }), 'not_auction')

    const a = await toAuction()
    expect(settle(a.room().state, a.clock.t).phase).toBe('auction')
    await a.fails(a.call(P[2], { action: 'spin', roomId: a.roomId }), 'no_auction_turn')
    await a.fails(a.call(P[2], { action: 'auction_prepare', roomId: a.roomId, participant: 2, bidCents: 1 }), 'not_organizer')
    await a.fails(a.call(OUTSIDER, { action: 'auction_prepare', roomId: a.roomId, participant: 2, bidCents: 1 }), 'room_not_found')

    const prep = await a.call(ORG, { action: 'auction_prepare', roomId: a.roomId, participant: 2, bidCents: 1250 })
    expect(prep.auctionTurn).toEqual({ participant: 2, bid: 12.5 })
    await a.fails(a.call(P[3], { action: 'spin', roomId: a.roomId }), 'not_your_turn')
    const res = await a.call(P[2], { action: 'spin', roomId: a.roomId })
    expect(res.spin).toMatchObject({ participant: 2, round: 'veiling', bid: 12.5 })
    expect(a.store.draws.at(-1)).toMatchObject({ round: 'veiling', bid_cents: 1250, participant: 2, on_behalf: false })
    await a.fails(a.call(ORG, { action: 'auction_prepare', roomId: a.roomId, participant: 3, bidCents: 100 }), 'spin_in_progress')
    a.waitRelease()
    await a.fails(a.call(P[2], { action: 'spin', roomId: a.roomId }), 'no_auction_turn') // vrijgave is per kavel
  })

  it('organisator kan een klaargezette beurt nog corrigeren vóór de SPIN', async () => {
    const a = await toAuction()
    await a.call(ORG, { action: 'auction_prepare', roomId: a.roomId, participant: 2, bidCents: 500 })
    await a.call(ORG, { action: 'auction_prepare', roomId: a.roomId, participant: 6, bidCents: 700 })
    await a.fails(a.call(P[2], { action: 'spin', roomId: a.roomId }), 'not_your_turn')
    expect((await a.call(P[6], { action: 'spin', roomId: a.roomId })).spin).toMatchObject({ participant: 6, bid: 7 })
  })

  it('volledig spel: 26 unieke uitslagen, administratie klopt, daarna klaar', async () => {
    const a = await toAuction()
    for (let lot = 0; lot < 8; lot++) {
      a.waitRelease()
      const buyer = (lot * 4) % 9
      await a.call(ORG, { action: 'auction_prepare', roomId: a.roomId, participant: buyer, bidCents: 100 * (lot + 1) + 50 })
      // Kavel 3: de koper heeft geen telefoon meer → organisator draait namens.
      if (lot === 3 && buyer !== 0) await a.call(ORG, { action: 'spin', roomId: a.roomId, onBehalf: true })
      else await a.call(P[buyer], { action: 'spin', roomId: a.roomId })
    }
    a.waitRelease()
    const state = settle(a.room().state, a.clock.t)
    expect(state.phase).toBe('finished')
    expect(state.draws).toHaveLength(26)
    expect(new Set(state.draws.map((d) => d.resultId)).size).toBe(26)
    expect(new Set(a.store.draws.map((d) => d.result_id))).toEqual(new Set(RESULTS.map((r) => r.id)))
    // Database en spelstatus vertellen hetzelfde verhaal.
    expect(a.store.draws.map((d) => [d.result_id, d.participant, d.round])).toEqual(state.draws.map((d) => [d.resultId, d.participant, String(d.round)]))
    expect(a.store.draws.filter((d) => d.on_behalf)).toHaveLength(1)
    expect(a.store.draws.filter((d) => d.round === 'veiling').map((d) => d.bid_cents)).toEqual([150, 250, 350, 450, 550, 650, 750, 850])
    await a.fails(a.call(P[0], { action: 'spin', roomId: a.roomId }), 'game_finished')
    await a.fails(a.call(ORG, { action: 'auction_prepare', roomId: a.roomId, participant: 1, bidCents: 1 }), 'not_auction')
  })
})

describe('server: cryptografische trekking', () => {
  it('10.000 proeftrekkingen via de server: elke uitslag even vaak (chi-kwadraat)', async () => {
    const store = createMemoryStore()
    const server = createGameServer({ store }) // standaard: secureRandomInt
    const counts = Object.fromEntries(RESULTS.map((r) => [r.id, 0]))
    const N = 10_000
    for (let i = 0; i < N; i++) {
      const uid = `00000000-0000-4000-b000-${String(i).padStart(12, '0')}`
      const { room } = await server.handle(uid, { action: 'create_room', participant: 0 })
      const { spin } = await server.handle(uid, { action: 'spin', roomId: room.id })
      counts[spin.resultId]++
    }
    const expected = N / RESULTS.length
    const chi2 = Object.values(counts).reduce((s, c) => s + (c - expected) ** 2 / expected, 0)
    expect(Object.values(counts).every((c) => c > 0)).toBe(true)
    expect(chi2).toBeLessThan(CHI2_DF25)
    expect(new Set(store.draws.map((d) => d.spin_id)).size).toBe(N) // unieke draai-id’s
  }, 60_000)
})

describe('server: foutafhandeling en herstel', () => {
  it('antwoord kwijt (verbinding weg): opnieuw versturen geeft geen tweede trekking', async () => {
    const r = await fullRoom()
    const first = await r.call(ORG, { action: 'spin', roomId: r.roomId })
    r.clock.t += 1200 // telefoon was even weg en verstuurt het verzoek opnieuw
    await r.fails(r.call(ORG, { action: 'spin', roomId: r.roomId }), 'turn_not_released')
    // Status opnieuw ophalen: de lopende draai loopt verder op de juiste plek.
    const { room, serverNow } = await r.call(ORG, { action: 'get_room', roomId: r.roomId })
    const view = deriveView(room.state, serverNow)
    expect(view.reelSpin).toEqual(first.spin)
    expect(r.store.draws).toHaveLength(1)
    // Veel later terug: uitslag ongewijzigd en de volgende beurt is vrij.
    r.clock.t += 60_000
    const later = deriveView((await r.call(P[5], { action: 'get_room', roomId: r.roomId })).room.state, r.clock.t)
    expect(later.state.draws.map((d) => d.resultId)).toEqual([first.spin.resultId])
    expect(later.state.turn).toBe(1)
    expect(later.locked).toBe(false)
  })

  it('versieconflict door een gelijktijdige wijziging: opnieuw controleren en vastleggen', async () => {
    const store = createMemoryStore()
    const commit = store.commitState
    let failures = 1
    store.commitState = async (...args) => {
      if (failures-- > 0) throw new StoreConflict('version')
      return commit(...args)
    }
    const r = await fullRoom({ store })
    const res = await r.call(ORG, { action: 'spin', roomId: r.roomId })
    expect(res.spin.participant).toBe(0)
    expect(store.draws).toHaveLength(1)
  })

  it('blijvend conflict: nette fout, niets gewijzigd, begrensd aantal pogingen', async () => {
    const store = createMemoryStore()
    const r = await fullRoom({ store })
    let attempts = 0
    store.commitState = async () => {
      attempts++
      throw new StoreConflict('version')
    }
    const e = await r.fails(r.call(ORG, { action: 'spin', roomId: r.roomId }), 'conflict')
    expect(e.status).toBe(409)
    expect(attempts).toBe(3) // nooit onbeperkt opnieuw
    expect(store.draws).toHaveLength(0)
    expect(r.room().version).toBe(0)
    expect(r.room().state.spin).toBeNull()
  })

  it('databasefout tijdens vastleggen: geen half vastgelegde trekking', async () => {
    const store = createMemoryStore()
    const r = await fullRoom({ store })
    store.commitState = async () => {
      throw new Error('verbinding met database verbroken')
    }
    await expect(r.call(ORG, { action: 'spin', roomId: r.roomId })).rejects.toThrow('verbroken')
    expect(store.draws).toHaveLength(0)
    expect(r.room().state.spin).toBeNull()
  })
})

describe('server: foutcodes uit Supabase (PT409)', () => {
  // Nep-client die elke aanroep met dezelfde PostgREST-fout laat eindigen.
  function failingDb(error) {
    const result = Promise.resolve({ data: null, error })
    const chain = new Proxy(() => {}, { get: (_, k) => (k === 'then' ? result.then.bind(result) : () => chain) })
    return { from: () => chain, rpc: () => result }
  }
  const commit = (error) => createSupabaseStore(failingDb(error)).commitState('r', 0, {}, null)

  it('PT409 uit commit_room_state is een normaal versieconflict', async () => {
    const e = await commit({ code: 'PT409', message: 'version_conflict' }).catch((x) => x)
    expect(e).toBeInstanceOf(StoreConflict)
    expect(e.kind).toBe('version')
  })

  it('unieke-sleutelfout (23505) is een conflict, andere fouten niet', async () => {
    const unique = await commit({ code: '23505', message: 'duplicate key' }).catch((x) => x)
    expect(unique).toBeInstanceOf(StoreConflict)
    expect(unique.kind).toBe('unique')
    const other = await commit({ code: '42501', message: 'permission denied' }).catch((x) => x)
    expect(other).not.toBeInstanceOf(StoreConflict)
    expect(other.message).toContain('42501')
  })

  it('versieconflict via HTTP: 409 conflict, geen 500', async () => {
    const store = createMemoryStore()
    const server = createGameServer({ store })
    const { room } = await server.handle(ORG, { action: 'create_room', participant: 0 })
    store.commitState = () => createSupabaseStore(failingDb({ code: 'PT409', message: 'version_conflict' })).commitState()
    const http = createHttpHandler({ server, authenticate: async () => ORG, log: () => {} })
    const res = await http(
      new Request('https://x', { method: 'POST', headers: { Authorization: 'Bearer t' }, body: JSON.stringify({ action: 'spin', roomId: room.id }) }),
    )
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ ok: false, error: 'conflict' })
  })
})

describe('server: HTTP-laag', () => {
  const USER = user(1)
  function handler({ authenticate = async (t) => (t === 'goed' ? USER : null), server } = {}) {
    const logged = []
    const srv = server ?? createGameServer({ store: createMemoryStore(), now: () => 42 })
    return { logged, http: createHttpHandler({ server: srv, authenticate, log: (...a) => logged.push(a) }) }
  }
  const post = (body, token = 'goed', extra = {}) =>
    new Request('https://x/functions/v1/game', {
      method: 'POST',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', ...extra },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })

  it('CORS-voorcontrole en alleen POST', async () => {
    const { http } = handler()
    const pre = await http(new Request('https://x', { method: 'OPTIONS' }))
    expect(pre.status).toBe(204)
    expect(pre.headers.get('access-control-allow-headers')).toContain('authorization')
    expect((await http(new Request('https://x', { method: 'GET' }))).status).toBe(405)
  })

  it('zonder of met ongeldig token: 401, en de actie wordt niet uitgevoerd', async () => {
    let called = 0
    const server = { handle: async () => (called++, { ok: true }) }
    const { http } = handler({ server })
    expect((await http(post({ action: 'time' }, null))).status).toBe(401)
    expect((await http(post({ action: 'time' }, 'fout'))).status).toBe(401)
    expect((await http(post({ action: 'time' }, 'goed', { Authorization: 'Basic goed' }))).status).toBe(401)
    expect(called).toBe(0)
  })

  it('geldige aanvraag geeft JSON met servertijd', async () => {
    const { http } = handler()
    const res = await http(post({ action: 'time' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(await res.json()).toEqual({ ok: true, serverNow: 42 })
  })

  it('kapotte of te grote invoer, onbekende acties en spelfouten', async () => {
    const { http } = handler()
    expect((await http(post('{kapot'))).status).toBe(400)
    expect((await http(post({ action: 'x', pad: 'a'.repeat(5000) }))).status).toBe(413)
    const unknown = await http(post({ action: 'RESET' }))
    expect(unknown.status).toBe(400)
    expect(await unknown.json()).toMatchObject({ ok: false, error: 'unknown_action' })
    const missing = await http(post({ action: 'get_room', roomId: user(9) }))
    expect(missing.status).toBe(404)
    expect(await missing.json()).toMatchObject({ ok: false, error: 'room_not_found' })
  })

  it('onverwachte fout: 500 zonder interne details', async () => {
    const server = { handle: async () => { throw new Error('geheime interne melding') } }
    const { http, logged } = handler({ server })
    const res = await http(post({ action: 'time' }))
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(text).not.toContain('geheim')
    expect(logged).toHaveLength(1)
  })
})
