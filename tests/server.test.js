// Servertests: de logica van de Edge Function (online spel) met een
// geheugenopslag die dezelfde regels afdwingt als de database. Tijd is een
// nep-klok. Meerdere "telefoons" = verschillende gebruikers-id's.
import { describe, expect, it } from 'vitest'
import { ALL_RESULTS, RESULTS } from '../src/game/config.js'
import { settle } from '../src/game/engine.js'
import { turnOrder } from '../src/game/gameConfig.js'
import { releaseDelay } from '../src/game/timeline.js'
import { deriveView } from '../src/game/view.js'
import { introTimeline } from '../src/lobby/playRules.js'
import { ACTIONS, ActionError, CODE_RE, MAX_ROOMS_PER_DAY, StoreConflict, createGameServer, generateRoomCode } from '../src/server/actions.js'
import { createHttpHandler } from '../src/server/http.js'
import { createSupabaseStore } from '../src/server/supabaseStore.js'
import { seededRandomInt } from './helpers.js'
import { createMemoryStore } from './memoryStore.js'

const user = (i) => `00000000-0000-4000-a000-${String(i).padStart(12, '0')}`
const ORG = user(100) // organisator, speelt standaard zelf mee
const P = Array.from({ length: 12 }, (_, i) => (i === 0 ? ORG : user(i))) // telefoon per deelnemer
const OUTSIDER = user(999)
const NAMES = ['Lars', 'Sanne', 'Bas', 'Marieke', 'Dennis', 'Frank', 'Esther', 'Patrick', 'Jeroen', 'Noor', 'Ahmed', 'Ruud']
const STANDARD = RESULTS.map((r) => r.id) // 26: 0-0 … 4-4 + OVERIG
const CLUBS = { home: 'Werder Bremen II', away: 'Bremer SV' }
const CHI2_DF10 = 35.6 // chi-kwadraat, 10 vrijheidsgraden, p = 0,0001

// Geldig spel voor n deelnemers: 1 ronde en n+2 uitslagen (2 veilinguitslagen).
function setupFor(n, extra = {}) {
  const pool = ALL_RESULTS.map((r) => r.id).filter((id) => id !== 'OVERIG').slice(0, n + 1).concat('OVERIG')
  return { name: 'lars', ...CLUBS, draft: { maxPlayers: n, rounds: 1, priceCents: 1000, pool, mega: [pool[0]], ...extra } }
}

function setup({ randomInt = seededRandomInt(7), store } = {}) {
  const clock = { t: 1_800_000_000_000 }
  const st = store ?? createMemoryStore({ now: () => clock.t })
  const server = createGameServer({ store: st, randomInt, now: () => clock.t })
  const call = (uid, body) => server.handle(uid, body)
  const fails = async (promise, code, status) => {
    const e = await promise.then(
      (r) => ({ unexpected: r }),
      (err) => err,
    )
    expect(e).toBeInstanceOf(ActionError)
    expect(e.code).toBe(code)
    if (status) expect(e.status).toBe(status)
    return e
  }
  return { store: st, clock, server, call, fails }
}

// Kamer met n aangemelde deelnemers (organisator = P[0]); optioneel gestart.
async function lobby(n, { opts, setupExtra, start = false } = {}) {
  const ctx = setup(opts)
  const { room } = await ctx.call(ORG, { action: 'create_room', ...setupFor(n, setupExtra) })
  for (let i = 1; i < n; i++) await ctx.call(P[i], { action: 'join_room', code: room.code, name: NAMES[i] })
  const roomId = room.id
  const raw = () => ctx.store.rooms.get(roomId)
  const view = (uid) => ctx.call(uid, { action: 'get_room', roomId }).then((r) => r.room)
  const r = { ...ctx, roomId, code: room.code, raw, view }
  if (start) await startAndSkipIntro(r)
  return r
}
// Starten, opening tot het Las Vegas-scherm, "START SPEL", tot het vertrekmoment.
async function startAndSkipIntro(r) {
  const res = await r.call(ORG, { action: 'start_game', roomId: r.roomId })
  r.clock.t = res.room.startedAt + introTimeline(res.room.players.length).vegasAt + 1
  const play = await r.call(ORG, { action: 'start_play', roomId: r.roomId })
  r.clock.t = play.room.playAt
  return res
}
// Wacht tot de vorige draai is afgerond en de volgende beurt vrij is.
function waitRelease(r) {
  const s = r.raw().state.state
  const last = s.spin ?? s.lastSpin
  if (last) r.clock.t = Math.max(r.clock.t, last.startedAt + releaseDelay(last) + 1)
}
function whoseTurn(r) {
  const s = settle(r.raw().state.state, r.clock.t)
  return s.phase === 'draw' ? turnOrder(s.config)[s.turn].participant : s.auctionTurn?.participant
}
const phoneOf = (slot) => P[slot]

describe('server: toegang en invoer', () => {
  it('weigert verzoeken zonder geldige gebruiker of met onbekende actie; oude acties bestaan niet meer', async () => {
    const { call, fails } = setup()
    await fails(call('niet-een-uuid', { action: 'time' }), 'unauthorized', 401)
    await fails(call(ORG, null), 'invalid_input')
    for (const action of ['RESET', 'DEMO_SKIP_TO_AUCTION', 'claim_seat', 'release_seat', 'auction_prepare', 'nope']) {
      await fails(call(ORG, { action }), 'unknown_action', 400)
    }
    expect(ACTIONS).toContain('advance_phase')
  })
  it('geeft bij elk antwoord de servertijd mee (gedeelde klok)', async () => {
    const { call, clock } = setup()
    expect(await call(ORG, { action: 'time' })).toEqual({ ok: true, serverNow: clock.t })
  })
  it('controleert de vorm van alle invoer', async () => {
    const r = await lobby(2)
    const bad = [
      { action: 'get_room', roomId: 'x' },
      { action: 'lookup_room', code: 'ABC' },
      { action: 'join_room', code: 'ABCDE1', name: 'x' },
      { action: 'create_room', name: 'x', home: 'a', away: 'b', draft: 'x' },
      { action: 'create_room', name: 'x'.repeat(101), home: 'a', away: 'b', draft: setupFor(1).draft },
      { action: 'set_order', roomId: r.roomId, order: 'x' },
      { action: 'set_order', roomId: r.roomId, order: [0, 13] },
      { action: 'remove_player', roomId: r.roomId, slot: 12 },
      { action: 'confirm_auction', roomId: r.roomId, participant: 1, bidCents: 1.5 },
      { action: 'confirm_auction', roomId: r.roomId, participant: 1, bidCents: 1_000_001 },
      { action: 'advance_phase', roomId: r.roomId, step: 'eind' },
      { action: 'spin', roomId: r.roomId, onBehalf: 'ja' },
      { action: 'start_game', roomId: r.roomId, expectedVersion: 'x' },
    ]
    for (const body of bad) await r.fails(r.call(ORG, body), 'invalid_input', 400)
  })
})

describe('server: kamer aanmaken', () => {
  it('alleen een volledig en geldig ingesteld spel; maker is organisator en speler 1', async () => {
    const { call, fails, store } = setup()
    await fails(call(ORG, { action: 'create_room', ...setupFor(2, { priceCents: null }) }), 'settings_invalid', 409)
    await fails(call(ORG, { action: 'create_room', ...setupFor(2), name: ' ' }), 'name_empty', 400)
    await fails(call(ORG, { action: 'create_room', ...setupFor(2), away: '' }), 'club_empty', 400)
    await fails(call(ORG, { action: 'create_room', ...setupFor(2, { rounds: 4 }) }), 'settings_invalid')
    expect(store.rooms.size).toBe(0)
    const { room } = await call(ORG, { action: 'create_room', ...setupFor(2) })
    expect(room).toMatchObject({ phase: 'lobby', isOrganizer: true, mySlot: 0, matchName: 'Werder Bremen II – Bremer SV', maxPlayers: 2, organizerName: 'Lars' })
    expect(CODE_RE.test(room.code)).toBe(true)
    expect(room.players).toEqual([{ slot: 0, name: 'Lars', isOrganizer: true, isMe: true, manual: false }])
    expect(store.pulses.get(room.id)).toBe(0) // Realtime-signaal bestaat meteen
  })
  it('kamercodes: alleen toegestane tekens, nieuwe code bij een botsing', async () => {
    for (let i = 0; i < 200; i++) expect(generateRoomCode()).toMatch(CODE_RE)
    const store = createMemoryStore()
    const insert = store.insertRoom
    let collisions = 2
    store.insertRoom = async (row) => {
      if (collisions-- > 0) throw new StoreConflict('unique')
      return insert(row)
    }
    const { call } = setup({ store })
    expect((await call(ORG, { action: 'create_room', ...setupFor(1) })).room.code).toMatch(CODE_RE)
  })
  it(`misbruikgrens: max. ${MAX_ROOMS_PER_DAY} nieuwe kamers per gebruiker per 24 uur`, async () => {
    const { call, fails, clock } = setup()
    for (let i = 0; i < MAX_ROOMS_PER_DAY; i++) await call(ORG, { action: 'create_room', ...setupFor(1) })
    await fails(call(ORG, { action: 'create_room', ...setupFor(1) }), 'too_many_rooms', 429)
    await call(user(55), { action: 'create_room', ...setupFor(1) }) // andere gebruiker wel
    clock.t += 24 * 60 * 60 * 1000 + 1
    await call(ORG, { action: 'create_room', ...setupFor(1) }) // na 24 uur weer wel
  })
})

describe('server: deelnemen', () => {
  it('via code (en dus link): unieke naam (hoofdletterongevoelig), aanmeldvolgorde', async () => {
    const r = await lobby(3)
    const look = await r.call(OUTSIDER, { action: 'lookup_room', code: r.code.toLowerCase() })
    expect(look.summary).toMatchObject({ phase: 'lobby', matchName: 'Werder Bremen II – Bremer SV', playerCount: 3, maxPlayers: 3, full: true, mySlot: null })
    expect(JSON.stringify(look)).not.toMatch(/userId|00000000-0000-4000-a000/)
    const r2 = await lobby(2, { setupExtra: { maxPlayers: 4, pool: STANDARD.slice(0, 5).concat('OVERIG') } })
    await r2.fails(r2.call(user(7), { action: 'join_room', code: r2.code, name: 'SANNE' }), 'name_taken', 409)
    await r2.fails(r2.call(user(7), { action: 'join_room', code: r2.code, name: 'lars' }), 'name_taken')
    const { room } = await r2.call(user(7), { action: 'join_room', code: r2.code, name: ' esther ' })
    expect(room.players).toEqual([
      { slot: 0, name: 'Lars' },
      { slot: 1, name: 'Sanne' },
      { slot: 2, name: 'Esther' },
    ])
  })
  it('maximaal het ingestelde aantal; ook bij gelijktijdige aanmeldingen', async () => {
    const r = await lobby(1, { setupExtra: { maxPlayers: 3, pool: STANDARD.slice(0, 4).concat('OVERIG') } })
    const res = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => r.call(user(20 + i), { action: 'join_room', code: r.code, name: `Speler ${i}` })))
    expect(res.filter((x) => x.status === 'fulfilled')).toHaveLength(2)
    expect(res.filter((x) => x.status === 'rejected').every((x) => ['room_full', 'conflict'].includes(x.reason.code))).toBe(true)
    expect(r.raw().state.players).toHaveLength(3)
  })
  it('terugkeren op hetzelfde toestel: zelfde plek; ander toestel kan de naam niet overnemen', async () => {
    const r = await lobby(2, { setupExtra: { maxPlayers: 3, pool: STANDARD.slice(0, 4).concat('OVERIG') } })
    const again = await r.call(P[1], { action: 'join_room', code: r.code, name: '' })
    expect(again.room.mySlot).toBe(1)
    expect(r.raw().version).toBe(1) // geen nieuwe wijziging
    await r.fails(r.call(user(77), { action: 'join_room', code: r.code, name: 'Sanne' }), 'name_taken')
    await r.fails(r.call(user(77), { action: 'get_room', roomId: r.roomId }), 'room_not_found', 404)
  })
  it('deelnemer ziet alleen namen in aanmeldvolgorde; geen spelregels, volgorde of id’s', async () => {
    const r = await lobby(3)
    await r.call(ORG, { action: 'set_order', roomId: r.roomId, order: [2, 0, 1] })
    const p = await r.view(P[1])
    expect(p.draft).toBeNull()
    expect(p.players).toEqual([
      { slot: 0, name: 'Lars' },
      { slot: 1, name: 'Sanne' },
      { slot: 2, name: 'Bas' },
    ])
    expect(JSON.stringify(p)).not.toMatch(/userId|00000000-0000-4000-a000|"order"|"pool"|"mega"|"priceCents"/)
    const o = await r.view(ORG)
    expect(o.players.map((x) => x.name)).toEqual(['Bas', 'Lars', 'Sanne'])
    expect(o.draft.maxPlayers).toBe(3)
  })
})

describe('server: alleen de organisator', () => {
  it('deelnemers en buitenstaanders kunnen geen organisatoracties uitvoeren', async () => {
    const r = await lobby(3)
    const orgOnly = [
      { action: 'update_settings', roomId: r.roomId, draft: setupFor(3).draft },
      { action: 'set_order', roomId: r.roomId, order: [2, 1, 0] },
      { action: 'shuffle_order', roomId: r.roomId },
      { action: 'remove_player', roomId: r.roomId, slot: 2 },
      { action: 'add_manual_player', roomId: r.roomId, name: 'Opa' },
      { action: 'join_self', roomId: r.roomId },
      { action: 'start_game', roomId: r.roomId },
    ]
    for (const body of orgOnly) {
      await r.fails(r.call(P[1], body), 'not_organizer', 403)
      await r.fails(r.call(OUTSIDER, body), 'room_not_found', 404)
    }
    expect(r.raw().version).toBe(2) // niets gewijzigd (2 aanmeldingen)
  })
  it('volgorde, loten (serverwillekeur), verwijderen + opnieuw aanmelden', async () => {
    const r = await lobby(3)
    expect((await r.call(ORG, { action: 'set_order', roomId: r.roomId, order: [1, 2, 0] })).room.players.map((p) => p.slot)).toEqual([1, 2, 0])
    await r.fails(r.call(ORG, { action: 'set_order', roomId: r.roomId, order: [0, 1] }), 'invalid_order')
    const shuffled = (await r.call(ORG, { action: 'shuffle_order', roomId: r.roomId })).room.players.map((p) => p.slot)
    expect([...shuffled].sort()).toEqual([0, 1, 2])
    await r.call(ORG, { action: 'remove_player', roomId: r.roomId, slot: 2 })
    await r.fails(r.call(P[2], { action: 'get_room', roomId: r.roomId }), 'removed', 403)
    expect((await r.call(P[2], { action: 'lookup_room', code: r.code })).summary.removed).toBe(true)
    await r.call(P[2], { action: 'join_room', code: r.code, name: 'Bas' })
    expect((await r.view(P[2])).mySlot).toBe(2)
  })
  it('organisator kan zelf niet meespelen en houdt zijn rechten; zelf weer meedoen', async () => {
    const r = await lobby(2)
    await r.call(ORG, { action: 'remove_player', roomId: r.roomId, slot: 0 })
    const o = await r.view(ORG)
    expect(o).toMatchObject({ isOrganizer: true, mySlot: null })
    await r.call(ORG, { action: 'set_order', roomId: r.roomId, order: [1] }) // rechten behouden
    await r.call(user(30), { action: 'join_room', code: r.code, name: 'Frank' })
    await r.fails(r.call(ORG, { action: 'join_self', roomId: r.roomId }), 'room_full')
    // start zonder organisator als speler
    const s = await startAndSkipIntro(r)
    expect(s.room.state.config.players.map((p) => p.name)).toEqual(['Sanne', 'Frank'])
    expect((await r.view(ORG)).controlSlots).toEqual([])
  })
  it('deelnemer zonder telefoon: hoort bij het toestel van de organisator', async () => {
    const r = await lobby(1, { setupExtra: { maxPlayers: 2, pool: STANDARD.slice(0, 3).concat('OVERIG') } })
    const { room } = await r.call(ORG, { action: 'add_manual_player', roomId: r.roomId, name: 'opa' })
    expect(room.players.at(-1)).toMatchObject({ name: 'Opa', manual: true })
    expect(room.controlSlots).toEqual([0, 1])
    expect(r.raw().state.players.at(-1).userId).toBeNull()
  })
})

describe('server: starten (D8)', () => {
  it('alleen bij precies het ingestelde aantal en geldige spelregels; starttijd = servertijd; eenmalig', async () => {
    const r = await lobby(2, { setupExtra: { maxPlayers: 3, pool: STANDARD.slice(0, 4).concat('OVERIG') } })
    await r.fails(r.call(ORG, { action: 'start_game', roomId: r.roomId }), 'players_incomplete', 409)
    await r.call(user(40), { action: 'join_room', code: r.code, name: 'Noor' })
    const v = r.raw().version
    await r.fails(r.call(ORG, { action: 'start_game', roomId: r.roomId, expectedVersion: v - 1 }), 'room_changed')
    const { room } = await r.call(ORG, { action: 'start_game', roomId: r.roomId, expectedVersion: v })
    expect(room).toMatchObject({ phase: 'started', startedAt: r.clock.t })
    expect(room.state.config.players.map((p) => p.name)).toEqual(['Lars', 'Sanne', 'Noor'])
    await r.fails(r.call(ORG, { action: 'start_game', roomId: r.roomId }), 'registration_closed')
    await r.fails(r.call(user(41), { action: 'join_room', code: r.code, name: 'Laat' }), 'registration_closed')
  })
  it('aanmelden en starten tegelijk: nooit een inconsistente stand', async () => {
    for (let k = 0; k < 20; k++) {
      const r = await lobby(2, { setupExtra: { maxPlayers: 2 } })
      await r.call(ORG, { action: 'remove_player', roomId: r.roomId, slot: 1 })
      await r.call(user(50), { action: 'join_room', code: r.code, name: 'Sanne' })
      // tegelijk: iemand verwijderen+aanmelden kan niet meer; starten en een extra aanmelding
      const res = await Promise.allSettled([
        r.call(ORG, { action: 'start_game', roomId: r.roomId }),
        r.call(user(60 + k), { action: 'join_room', code: r.code, name: 'Extra' }),
      ])
      const doc = r.raw().state
      if (doc.phase === 'started') expect(doc.state.config.players.map((p) => p.id).sort()).toEqual(doc.players.map((p) => p.slot).sort())
      expect(doc.players.length).toBeLessThanOrEqual(2)
      expect(res[1].status).toBe('rejected')
    }
  })
  it('gezamenlijke startanimatie + Las Vegas-wachtfase: SPIN pas na "START SPEL" en het vertrekmoment', async () => {
    const r = await lobby(2)
    const { room } = await r.call(ORG, { action: 'start_game', roomId: r.roomId })
    expect(room).toMatchObject({ awaitPlay: true, playAt: null })
    await r.fails(r.call(ORG, { action: 'spin', roomId: r.roomId }), 'intro_running')
    // Het bord blijft staan: ook lang na het oude einde van de animatie geen SPIN.
    r.clock.t = room.startedAt + introTimeline(2).endAt + 60_000
    await r.fails(r.call(ORG, { action: 'spin', roomId: r.roomId }), 'intro_running')
    // Deelnemer kan niet verder; organisator wel, één keer.
    await r.fails(r.call(P[1], { action: 'start_play', roomId: r.roomId }), 'not_organizer')
    const { room: played } = await r.call(ORG, { action: 'start_play', roomId: r.roomId })
    expect(played.playAt).toBe(r.clock.t + 1500)
    await r.fails(r.call(ORG, { action: 'start_play', roomId: r.roomId }), 'nothing_to_advance')
    expect((await r.view(P[1])).playAt).toBe(played.playAt) // iedereen hetzelfde moment
    await r.fails(r.call(ORG, { action: 'spin', roomId: r.roomId }), 'intro_running') // nog vóór het vertrekmoment
    r.clock.t = played.playAt
    expect((await r.call(ORG, { action: 'spin', roomId: r.roomId })).room.state.spin).not.toBeNull()
  })

  it('"START SPEL" pas op het Las Vegas-scherm; gelijktijdig dubbelklikken → één overgang', async () => {
    const r = await lobby(2)
    const { room } = await r.call(ORG, { action: 'start_game', roomId: r.roomId })
    r.clock.t = room.startedAt + introTimeline(2).vegasAt - 1
    await r.fails(r.call(ORG, { action: 'start_play', roomId: r.roomId }), 'intro_running') // animatie loopt nog
    r.clock.t += 2
    const before = r.raw().version
    const res = await Promise.allSettled(Array.from({ length: 5 }, () => r.call(ORG, { action: 'start_play', roomId: r.roomId })))
    expect(res.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
    expect(r.raw().version).toBe(before + 1)
  })

  it('oude spellen (gestart vóór game v3, zonder awaitPlay): SPIN na de animatie, geen START SPEL', async () => {
    const r = await lobby(2)
    const { room } = await r.call(ORG, { action: 'start_game', roomId: r.roomId })
    const raw = r.raw()
    delete raw.state.awaitPlay
    delete raw.state.playAt
    await r.fails(r.call(ORG, { action: 'start_play', roomId: r.roomId }), 'nothing_to_advance')
    r.clock.t = room.startedAt + introTimeline(2).endAt + 1
    expect((await r.call(ORG, { action: 'spin', roomId: r.roomId })).room.state.spin).not.toBeNull()
  })
})

describe('server: SPIN en autorisatie', () => {
  it('alleen wie aan de beurt is; anderen niet; de server kiest en legt meteen vast', async () => {
    const r = await lobby(3, { start: true })
    expect(whoseTurn(r)).toBe(0)
    await r.fails(r.call(P[1], { action: 'spin', roomId: r.roomId }), 'not_your_turn', 403)
    await r.fails(r.call(OUTSIDER, { action: 'spin', roomId: r.roomId }), 'room_not_found', 404)
    const { room } = await r.call(ORG, { action: 'spin', roomId: r.roomId, resultId: '0-0', participant: 2 })
    expect(room.state.spin.participant).toBe(0) // meegestuurde uitslag/deelnemer genegeerd
    expect(r.store.draws).toHaveLength(1)
    expect(r.store.draws[0]).toMatchObject({ participant: 0, round: '1', spun_by: ORG, on_behalf: false, bid_cents: null })
    expect(r.store.draws[0].result_id).toBe(room.state.spin.resultId)
  })
  it('organisator: alleen expliciet namens; vastgelegd als on_behalf', async () => {
    const r = await lobby(3, { start: true })
    await r.call(ORG, { action: 'spin', roomId: r.roomId })
    waitRelease(r)
    await r.fails(r.call(ORG, { action: 'spin', roomId: r.roomId }), 'not_your_turn')
    await r.call(ORG, { action: 'spin', roomId: r.roomId, onBehalf: true })
    expect(r.store.draws[1]).toMatchObject({ participant: 1, spun_by: ORG, on_behalf: true })
    waitRelease(r)
    await r.fails(r.call(P[1], { action: 'spin', roomId: r.roomId, onBehalf: true }), 'not_your_turn') // deelnemer niet namens een ander
  })
  it('deelnemer zonder telefoon: organisator drukt SPIN (niet als namens)', async () => {
    const r = await lobby(1, { setupExtra: { maxPlayers: 2, pool: STANDARD.slice(0, 3).concat('OVERIG') } })
    await r.call(ORG, { action: 'add_manual_player', roomId: r.roomId, name: 'Opa' })
    await startAndSkipIntro(r)
    await r.call(ORG, { action: 'spin', roomId: r.roomId })
    waitRelease(r)
    await r.call(ORG, { action: 'spin', roomId: r.roomId })
    expect(r.store.draws[1]).toMatchObject({ participant: 1, on_behalf: false, spun_by: ORG })
  })
  it('10 gelijktijdige SPIN-verzoeken: precies één trekking', async () => {
    const r = await lobby(2, { start: true })
    const res = await Promise.allSettled(Array.from({ length: 10 }, () => r.call(ORG, { action: 'spin', roomId: r.roomId })))
    expect(res.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
    expect(res.filter((x) => x.status === 'rejected').every((x) => ['spin_in_progress', 'turn_not_released', 'conflict'].includes(x.reason.code))).toBe(true)
    expect(r.store.draws).toHaveLength(1)
  })
  it('deelnemer en organisator (namens) tegelijk: precies één trekking', async () => {
    for (let k = 0; k < 10; k++) {
      const r = await lobby(2, { start: true })
      await r.call(ORG, { action: 'spin', roomId: r.roomId })
      waitRelease(r)
      const res = await Promise.allSettled([
        r.call(P[1], { action: 'spin', roomId: r.roomId }),
        r.call(ORG, { action: 'spin', roomId: r.roomId, onBehalf: true }),
      ])
      expect(res.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
      expect(r.store.draws).toHaveLength(2)
    }
  })
})

describe('server: veiling en faseovergangen', () => {
  async function toAuction() {
    const r = await lobby(2, { start: true }) // 2 deelnemers, 1 ronde, 4 uitslagen → 2 veilingen
    for (let i = 0; i < 2; i++) {
      waitRelease(r)
      await r.call(phoneOf(whoseTurn(r)), { action: 'spin', roomId: r.roomId })
    }
    waitRelease(r)
    return r
  }
  it('Start de veiling: alleen organisator, eenmalig, iedereen ziet het', async () => {
    const r = await toAuction()
    await r.fails(r.call(ORG, { action: 'confirm_auction', roomId: r.roomId, participant: 1, bidCents: 3500 }), 'auction_not_open')
    await r.fails(r.call(P[1], { action: 'advance_phase', roomId: r.roomId, step: 'auction' }), 'not_organizer', 403)
    await r.fails(r.call(ORG, { action: 'advance_phase', roomId: r.roomId, step: 'final' }), 'nothing_to_advance')
    const res = await Promise.allSettled([1, 2, 3].map(() => r.call(ORG, { action: 'advance_phase', roomId: r.roomId, step: 'auction' })))
    expect(res.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
    const p = await r.view(P[1])
    expect(p.ack.auctionStart).toBeTruthy()
    expect(deriveView(p.state, r.clock.t, p.ack).reveal).toBeNull() // deelnemer: veilingscherm
  })
  it('Bevestig veiling: alleen organisator, eenmalig, oplopend nummer, start geen trekking; alleen winnaar SPIN', async () => {
    const r = await toAuction()
    await r.call(ORG, { action: 'advance_phase', roomId: r.roomId, step: 'auction' })
    await r.fails(r.call(P[1], { action: 'confirm_auction', roomId: r.roomId, participant: 1, bidCents: 3500 }), 'not_organizer')
    await r.fails(r.call(ORG, { action: 'confirm_auction', roomId: r.roomId, participant: 9, bidCents: 3500 }), 'player_not_found')
    const both = await Promise.allSettled([
      r.call(ORG, { action: 'confirm_auction', roomId: r.roomId, participant: 1, bidCents: 3500 }),
      r.call(ORG, { action: 'confirm_auction', roomId: r.roomId, participant: 0, bidCents: 100 }),
    ])
    expect(both.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
    const a1 = (await r.view(P[1])).announce
    expect(a1.lot).toBe(1)
    expect(r.store.draws).toHaveLength(2) // nog geen trekking
    const winner = a1.participant
    const loser = 1 - winner
    await r.fails(r.call(phoneOf(loser), { action: 'spin', roomId: r.roomId }), 'not_your_turn')
    await r.call(phoneOf(winner), { action: 'spin', roomId: r.roomId })
    expect(r.store.draws.at(-1)).toMatchObject({ round: 'veiling', participant: winner, bid_cents: a1.bidCents })
    waitRelease(r)
    await r.call(ORG, { action: 'confirm_auction', roomId: r.roomId, participant: loser, bidCents: 0 })
    expect((await r.view(ORG)).announce).toMatchObject({ lot: 2, participant: loser, bidCents: 0 })
    await r.call(ORG, { action: 'spin', roomId: r.roomId, onBehalf: loser !== 0 }) // namens de winnaar (of eigen beurt)
    waitRelease(r)
    // eindstand: alleen organisator, eenmalig
    await r.fails(r.call(P[1], { action: 'advance_phase', roomId: r.roomId, step: 'final' }), 'not_organizer')
    await r.call(ORG, { action: 'advance_phase', roomId: r.roomId, step: 'final' })
    await r.fails(r.call(ORG, { action: 'advance_phase', roomId: r.roomId, step: 'final' }), 'nothing_to_advance')
    const end = await r.view(P[1])
    const s = settle(end.state, r.clock.t)
    expect(s.phase).toBe('finished')
    expect(deriveView(end.state, r.clock.t, end.ack).reveal).toBeNull()
    expect(new Set(r.store.draws.map((d) => d.result_id)).size).toBe(4)
    expect(s.config.players.map((p) => p.name)).toEqual(['Lars', 'Sanne']) // definitieve volgorde
  })
  it('volledig spel met 12 deelnemers, 4 rondes, 50 uitslagen: alles uniek, administratie klopt', async () => {
    const all = ALL_RESULTS.map((r) => r.id)
    const r = await lobby(12, { setupExtra: { maxPlayers: 12, rounds: 4, pool: all, mega: ['0-0'] } })
    await r.call(ORG, { action: 'shuffle_order', roomId: r.roomId })
    await startAndSkipIntro(r)
    for (let i = 0; i < 48; i++) {
      waitRelease(r)
      await r.call(phoneOf(whoseTurn(r)), { action: 'spin', roomId: r.roomId })
    }
    waitRelease(r)
    await r.call(ORG, { action: 'advance_phase', roomId: r.roomId, step: 'auction' })
    for (const [who, bid] of [[3, 2500], [7, 1250]]) {
      await r.call(ORG, { action: 'confirm_auction', roomId: r.roomId, participant: who, bidCents: bid })
      await r.call(phoneOf(who), { action: 'spin', roomId: r.roomId })
      waitRelease(r)
    }
    await r.call(ORG, { action: 'advance_phase', roomId: r.roomId, step: 'final' })
    const s = settle(r.raw().state.state, r.clock.t)
    expect(s.phase).toBe('finished')
    expect(r.store.draws).toHaveLength(50)
    expect(new Set(r.store.draws.map((d) => d.result_id)).size).toBe(50)
    expect(r.store.draws.filter((d) => d.round === '4')).toHaveLength(12)
    expect(r.store.draws.filter((d) => d.round === 'veiling').map((d) => [d.participant, d.bid_cents])).toEqual([[3, 2500], [7, 1250]])
    expect(JSON.stringify(r.raw().state).length).toBeLessThan(200_000) // past in rooms.state
  })
})

describe('server: cryptografische trekking', () => {
  it('10.000 proeftrekkingen via de server: elke uitslag even vaak (chi-kwadraat)', async () => {
    const clock = { t: 1_800_000_000_000 }
    const store = createMemoryStore({ now: () => clock.t })
    const server = createGameServer({ store, now: () => clock.t }) // standaard: secureRandomInt
    const pool = setupFor(9).draft.pool // 11 uitslagen
    const counts = Object.fromEntries(pool.map((id) => [id, 0]))
    const N = 10_000
    for (let i = 0; i < N; i++) {
      const uid = `00000000-0000-4000-b000-${String(i).padStart(12, '0')}`
      const { room } = await server.handle(uid, { action: 'create_room', name: 'Lars', ...CLUBS, draft: { maxPlayers: 1, rounds: 1, priceCents: 0, pool, mega: [] } })
      await server.handle(uid, { action: 'start_game', roomId: room.id })
      clock.t += introTimeline(1).vegasAt + 1
      clock.t = (await server.handle(uid, { action: 'start_play', roomId: room.id })).room.playAt
      const res = await server.handle(uid, { action: 'spin', roomId: room.id })
      counts[res.room.state.spin.resultId]++
    }
    const expected = N / pool.length
    const chi2 = Object.values(counts).reduce((s, c) => s + (c - expected) ** 2 / expected, 0)
    expect(Object.values(counts).every((c) => c > 0)).toBe(true)
    expect(chi2).toBeLessThan(CHI2_DF10)
    expect(new Set(store.draws.map((d) => d.spin_id)).size).toBe(N)
  }, 120_000)
})

describe('server: foutafhandeling en herstel', () => {
  it('antwoord kwijt (verbinding weg): opnieuw versturen geeft geen tweede trekking', async () => {
    const r = await lobby(3, { start: true })
    const first = await r.call(ORG, { action: 'spin', roomId: r.roomId })
    r.clock.t += 1200 // telefoon was even weg en verstuurt het verzoek opnieuw
    await r.fails(r.call(ORG, { action: 'spin', roomId: r.roomId }), 'spin_in_progress')
    const { room, serverNow } = await r.call(ORG, { action: 'get_room', roomId: r.roomId })
    expect(deriveView(room.state, serverNow, room.ack).reelSpin).toEqual(first.room.state.spin)
    expect(r.store.draws).toHaveLength(1)
    r.clock.t += 60_000
    const later = deriveView((await r.view(P[2])).state, r.clock.t)
    expect(later.state.draws.map((d) => d.resultId)).toEqual([first.room.state.spin.resultId])
    expect(later.locked).toBe(false)
  })
  it('versieconflict door een gelijktijdige wijziging: opnieuw controleren en vastleggen', async () => {
    const r = await lobby(2, { start: true })
    const commit = r.store.commitState
    let failures = 1
    r.store.commitState = async (...args) => {
      if (failures-- > 0) throw new StoreConflict('version')
      return commit(...args)
    }
    await r.call(ORG, { action: 'spin', roomId: r.roomId })
    expect(r.store.draws).toHaveLength(1)
  })
  it('blijvend conflict: nette fout, niets gewijzigd, begrensd aantal pogingen', async () => {
    const r = await lobby(2, { start: true })
    const before = r.raw().version
    let attempts = 0
    r.store.commitState = async () => {
      attempts++
      throw new StoreConflict('version')
    }
    const e = await r.fails(r.call(ORG, { action: 'spin', roomId: r.roomId }), 'conflict')
    expect(e.status).toBe(409)
    expect(attempts).toBe(3) // nooit onbeperkt opnieuw
    expect(r.store.draws).toHaveLength(0)
    expect(r.raw().version).toBe(before)
  })
  it('databasefout tijdens vastleggen: geen half vastgelegde trekking', async () => {
    const r = await lobby(2, { start: true })
    r.store.commitState = async () => {
      throw new Error('verbinding met database verbroken')
    }
    await expect(r.call(ORG, { action: 'spin', roomId: r.roomId })).rejects.toThrow('verbroken')
    expect(r.store.draws).toHaveLength(0)
    expect(r.raw().state.state.spin).toBeNull()
  })
  it('Realtime-signaal volgt elke wijziging (versie), zonder spelgegevens', async () => {
    const r = await lobby(2)
    const seen = []
    r.store.onPulse((id, v) => seen.push([id, v]))
    await r.call(ORG, { action: 'shuffle_order', roomId: r.roomId })
    await r.call(ORG, { action: 'start_game', roomId: r.roomId })
    expect(seen).toEqual([
      [r.roomId, 2],
      [r.roomId, 3],
    ])
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
    const { room } = await server.handle(ORG, { action: 'create_room', ...setupFor(2) })
    store.commitState = () => createSupabaseStore(failingDb({ code: 'PT409', message: 'version_conflict' })).commitState()
    const http = createHttpHandler({ server, authenticate: async () => ORG, log: () => {} })
    const res = await http(
      new Request('https://x', { method: 'POST', headers: { Authorization: 'Bearer t' }, body: JSON.stringify({ action: 'shuffle_order', roomId: room.id }) }),
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
