// Online spel: SPIN-autorisatie, "draai namens", deelnemer zonder telefoon,
// "Bevestig veiling", gezamenlijke startanimatie (tijdlijn) en de mock met
// meerdere telefoons tot het einde van een spel.
import { describe, expect, it } from 'vitest'
import { LobbyError, addManualPlayer, createRoom, joinRoom, startGame } from '../src/lobby/lobbyRules.js'
import { ANNOUNCE_MS, INTRO, PLAY_DELAY, advancePhase, announceVisible, confirmAuction, introEnd, introPhase, introTimeline, nextStep, playOpensAt, spinTurn, startPlay, turnInfo } from '../src/lobby/playRules.js'
import { deriveView } from '../src/game/view.js'
import { settle } from '../src/game/engine.js'
import { releaseDelay } from '../src/game/timeline.js'
import { createMockApi } from '../src/online/mock/mockApi.js'
import { ApiError } from '../src/online/api.js'
import { COIN, bonusPositions, warmingPositions } from '../src/online/intro/MiniReels.jsx'
import { reelPosition, visibleItems } from '../src/online/intro/slotMath.js'

const CLUBS = { home: 'Werder Bremen II', away: 'Bremer SV' }
const ORG = 'org'
const code = (fn) => {
  try {
    fn()
  } catch (e) {
    if (e instanceof LobbyError || e instanceof ApiError) return e.code
    throw e
  }
  return 'ok'
}
const asyncCode = async (p) => {
  try {
    await p
  } catch (e) {
    if (e instanceof ApiError) return e.code
    throw e
  }
  return 'ok'
}

// 3 deelnemers (Lars = organisator, Sanne, Opa zonder telefoon), 1 ronde,
// 5 uitslagen → 3 vaste trekkingen + 2 veilinguitslagen.
const DRAFT = { maxPlayers: 3, rounds: 1, priceCents: 500, pool: ['0-0', '1-0', '1-1', '2-2', 'OVERIG'], mega: ['1-0'] }
function startedRoom(now = 1000) {
  let room = createRoom({ id: 'r', code: 'ABCDEF', userId: ORG, name: 'Lars', ...CLUBS, draft: DRAFT })
  room = joinRoom(room, { userId: 'sanne', name: 'Sanne' }).room
  room = addManualPlayer(room, { userId: ORG, name: 'Opa' }).room
  return withPlay(startGame(room, { userId: ORG, now }))
}
// Organisator drukt "START SPEL" zodra het Las Vegas-scherm er staat.
const withPlay = (room) => startPlay(room, { userId: ORG, now: room.startedAt + introTimeline(room.state.config.players.length).vegasAt })
const afterIntro = (room) => playOpensAt(room)
// Volgende moment waarop de beurt weer vrij is.
const released = (room) => room.state.spin.startedAt + releaseDelay(room.state.spin) + 1

describe('startanimatie: tijdlijn', () => {
  it('fases in vaste volgorde; één naam per 380 ms; ~3 s bord', () => {
    const tl = introTimeline(9)
    expect(tl.coinStops).toEqual([1500, 2100, 2700])
    expect(tl.bonusAt).toBe(tl.coinStops[2])
    expect(tl.nameStops).toHaveLength(9)
    expect(tl.nameStops[1] - tl.nameStops[0]).toBe(INTRO.nameGap)
    expect(tl.namesAt).toBeGreaterThan(tl.bonusAt)
    expect(tl.orderAt).toBe(tl.nameStops[8])
    expect(tl.vegasAt).toBeGreaterThan(tl.orderAt)
    expect(tl.endAt - tl.vegasAt).toBe(3200) // alleen nog voor oude spellen (zonder awaitPlay)
    expect(introTimeline(12).vegasAt).toBeLessThan(15000) // ook met 12 namen staat het bord er binnen 15 s
  })
  it('BONUSSPEL duurt ~6 s: munten, BONUSSPEL!, fanfare, dan pas de namen', () => {
    const tl = introTimeline(4)
    expect(tl.namesAt).toBe(6000)
    expect(tl.bonusAt).toBeLessThan(tl.fanfareAt)
    expect(tl.fanfareAt).toBeLessThan(tl.namesAt)
  })
  it('Las Vegas-wachtfase: het bord blijft staan tot het gezamenlijke vertrekmoment', () => {
    const tl = introTimeline(4)
    const wait = { awaitPlay: true, playAt: null }
    expect(introPhase(1000, 4, 1000 + tl.endAt + 3_600_000, wait)).toMatchObject({ phase: 'vegas', waiting: true })
    const playAt = 1000 + tl.vegasAt + 20_000
    expect(introPhase(1000, 4, playAt - 1, { awaitPlay: true, playAt }).phase).toBe('vegas') // iedereen nog op het bord
    expect(introPhase(1000, 4, playAt, { awaitPlay: true, playAt })).toBeNull() // iedereen tegelijk door
    // herladen of opnieuw verbinden: zelfde fase uit dezelfde gegevens
    expect(introPhase(1000, 4, 1000 + tl.namesAt + 10, wait).phase).toBe('names')
  })
  it('START SPEL: alleen organisator, alleen op het bord, eenmalig; SPIN pas vanaf het vertrekmoment', () => {
    let room = createRoom({ id: 'r', code: 'ABCDEF', userId: ORG, name: 'Lars', ...CLUBS, draft: DRAFT })
    room = joinRoom(room, { userId: 'sanne', name: 'Sanne' }).room
    room = addManualPlayer(room, { userId: ORG, name: 'Opa' }).room
    room = startGame(room, { userId: ORG, now: 1000 })
    const vegas = 1000 + introTimeline(3).vegasAt
    expect(code(() => startPlay(room, { userId: ORG, now: vegas - 1 }))).toBe('intro_running')
    expect(code(() => startPlay(room, { userId: 'sanne', now: vegas }))).toBe('not_organizer')
    expect(code(() => spinTurn(room, { userId: ORG, now: vegas + 600_000 }))).toBe('intro_running')
    const played = startPlay(room, { userId: ORG, now: vegas + 5000 })
    expect(played.playAt).toBe(vegas + 5000 + PLAY_DELAY)
    expect(played.version).toBe(room.version + 1)
    expect(code(() => startPlay(played, { userId: ORG, now: vegas + 5001 }))).toBe('nothing_to_advance')
    expect(code(() => spinTurn(played, { userId: ORG, now: played.playAt - 1 }))).toBe('intro_running')
    expect(spinTurn(played, { userId: ORG, now: played.playAt }).spin).toBeTruthy()
    expect(played.state.config.players.map((p) => p.name)).toEqual(room.state.config.players.map((p) => p.name)) // volgorde ongewijzigd
  })
  it('elke telefoon rekent dezelfde fase uit de starttijd; na afloop geen herhaling', () => {
    const tl = introTimeline(4)
    expect(introPhase(1000, 4, 1000).phase).toBe('bonus')
    expect(introPhase(1000, 4, 1000 + tl.namesAt).phase).toBe('names')
    expect(introPhase(1000, 4, 1000 + tl.vegasAt).phase).toBe('vegas')
    expect(introPhase(1000, 4, 1000 + tl.endAt)).toBeNull() // oud spel: later binnenkomen → direct scoremachine
    expect(introPhase(1000, 4, 1000 + tl.namesAt + 500).t).toBe(tl.namesAt + 500)
  })
  it('rollen stoppen exact op de munt en op de definitieve naam', () => {
    const tl = introTimeline(3)
    for (const t of [tl.coinStops[2], tl.coinStops[2] + 5000]) {
      for (const p of bonusPositions(t, tl.coinStops)) expect(((p % 6) + 6) % 6).toBe(COIN)
    }
    // vóór de stop draait hij nog
    const before = bonusPositions(tl.coinStops[0] - 300, tl.coinStops)[0]
    expect(((before % 6) + 6) % 6).not.toBe(COIN)
    // continu en monotoon (geen sprong terug)
    let last = -Infinity
    for (let t = 0; t <= tl.coinStops[2]; t += 16) {
      const p = bonusPositions(t, tl.coinStops)[2]
      expect(p).toBeGreaterThanOrEqual(last)
      last = p
    }
    const opts = { startAt: 100, stopAt: 2000, decel: 700, target: 4, count: 7, vmax: 0.02 }
    expect(reelPosition(2000, opts) % 7).toBe(4)
    expect(reelPosition(9999, opts)).toBe(reelPosition(2000, opts))
    expect(visibleItems(4, 7).find((v) => v.offset === 0).index).toBe(4)
    expect(warmingPositions(1000)).toHaveLength(3)
  })
})

describe('SPIN: wie mag drukken?', () => {
  it('niet tijdens de startanimatie', () => {
    const room = startedRoom()
    expect(code(() => spinTurn(room, { userId: ORG, now: 1000 + 500 }))).toBe('intro_running')
  })
  it('alleen wie aan de beurt is; anderen niet; organisator alleen expliciet namens', () => {
    const room = startedRoom()
    const t = afterIntro(room)
    // volgorde: Lars (0), Sanne (1), Opa (2)
    expect(turnInfo(room.state, t).participant).toBe(0)
    expect(code(() => spinTurn(room, { userId: 'sanne', now: t }))).toBe('not_your_turn')
    expect(code(() => spinTurn(room, { userId: 'vreemde', now: t }))).toBe('not_your_turn')
    const r1 = spinTurn(room, { userId: ORG, now: t }).room // eigen beurt
    expect(r1.spinLog.at(-1)).toMatchObject({ participant: 0, spunBy: ORG, onBehalf: false })
    // tweede SPIN voor dezelfde beurt (deelnemer én organisator vrijwel tegelijk): geweigerd
    expect(code(() => spinTurn(r1, { userId: ORG, now: t + 5 }))).toBe('spin_in_progress')
    // Sanne: de organisator mag niet zomaar, wel expliciet namens
    const t2 = released(r1)
    expect(turnInfo(r1.state, t2).participant).toBe(1)
    expect(code(() => spinTurn(r1, { userId: ORG, now: t2 }))).toBe('not_your_turn')
    const r2 = spinTurn(r1, { userId: ORG, onBehalf: true, now: t2 }).room
    expect(r2.spinLog.at(-1)).toMatchObject({ participant: 1, spunBy: ORG, onBehalf: true })
    expect(code(() => spinTurn(r2, { userId: 'sanne', now: t2 + 1 }))).toBe('spin_in_progress') // geen tweede trekking
    // Opa (zonder telefoon): organisator drukt zelf, zonder "namens"
    const t3 = released(r2)
    const r3 = spinTurn(r2, { userId: ORG, now: t3 }).room
    expect(r3.spinLog.at(-1)).toMatchObject({ participant: 2, onBehalf: false })
    expect(code(() => spinTurn(r3, { userId: 'sanne', now: released(r3) }))).toBe('no_auction_turn')
    // drie verschillende uitslagen, elk één keer
    const s = settle(r3.state, released(r3))
    expect(new Set(s.draws.map((d) => d.resultId)).size).toBe(3)
    expect(s.phase).toBe('auction')
  })
})

describe('veiling: Bevestig veiling', () => {
  function toAuction() {
    let room = startedRoom()
    let t = afterIntro(room)
    for (const [userId, onBehalf] of [
      [ORG, false],
      ['sanne', false],
      [ORG, false],
    ]) {
      room = spinTurn(room, { userId, onBehalf, now: t }).room
      t = released(room)
    }
    room = advancePhase(room, { userId: ORG, step: 'auction', now: t }) // organisator: "Start de veiling"
    return { room, t }
  }
  it('alleen organisator, alleen in de veiling, start nog geen trekking; geen tweede bevestiging', () => {
    const fresh = startedRoom()
    expect(code(() => confirmAuction(fresh, { userId: ORG, participant: 1, bidCents: 100, now: afterIntro(fresh) }))).toBe('not_auction')
    const { room, t } = toAuction()
    expect(code(() => confirmAuction(room, { userId: 'sanne', participant: 1, bidCents: 3500, now: t }))).toBe('not_organizer')
    expect(code(() => confirmAuction(room, { userId: ORG, participant: 9, bidCents: 3500, now: t }))).toBe('player_not_found')
    expect(code(() => confirmAuction(room, { userId: ORG, participant: 1, bidCents: -1, now: t }))).toBe('invalid_bid')
    expect(code(() => confirmAuction(room, { userId: ORG, participant: 1, bidCents: 12.5, now: t }))).toBe('invalid_bid')
    const c = confirmAuction(room, { userId: ORG, participant: 1, bidCents: 3500, now: t })
    expect(c.announce).toEqual({ participant: 1, bidCents: 3500, lot: 1, at: t })
    expect(c.state.auctionTurn).toEqual({ participant: 1, bid: 35 })
    expect(c.state.spin).toBeNull() // nog geen trekking
    expect(code(() => confirmAuction(c, { userId: ORG, participant: 0, bidCents: 100, now: t + 10 }))).toBe('auction_confirmed')
    // alleen de winnaar drukt SPIN (of de organisator namens hem)
    expect(code(() => spinTurn(c, { userId: ORG, now: t + 10 }))).toBe('not_your_turn')
    const s = spinTurn(c, { userId: 'sanne', now: t + 10 })
    expect(s.spin).toMatchObject({ participant: 1, round: 'veiling', bid: 35 })
    expect(code(() => confirmAuction(s.room, { userId: ORG, participant: 0, bidCents: 100, now: t + 20 }))).toBe('spin_in_progress')
  })
  it('aankondiging ~2,6 s zichtbaar; daarna (ook na opnieuw verbinden) niet meer', () => {
    const a = { participant: 1, bidCents: 3500, at: 10000 }
    expect(announceVisible(a, 9999)).toBe(false)
    expect(announceVisible(a, 10000)).toBe(true)
    expect(announceVisible(a, 10000 + ANNOUNCE_MS - 1)).toBe(true)
    expect(announceVisible(a, 10000 + ANNOUNCE_MS)).toBe(false)
    expect(announceVisible(null, 10000)).toBe(false)
  })
})

describe('faseovergangen: alleen de organisator, centraal en eenmalig', () => {
  function afterDraws() {
    let room = startedRoom()
    let t = afterIntro(room)
    expect(nextStep(room, t)).toBeNull() // tijdens de rondes niets
    for (const [userId, onBehalf] of [
      [ORG, false],
      ['sanne', false],
      [ORG, false],
    ]) {
      room = spinTurn(room, { userId, onBehalf, now: t }).room
      expect(nextStep(room, t + 100)).toBeNull() // nog niet tijdens de draai
      t = released(room)
    }
    return { room, t }
  }
  it('veiling: pas na de laatste vaste trekking; deelnemers niet; eenmalig', () => {
    const { room, t } = afterDraws()
    expect(nextStep(room, t)).toBe('auction')
    expect(code(() => advancePhase(room, { userId: 'sanne', step: 'auction', now: t }))).toBe('not_organizer')
    expect(code(() => advancePhase(room, { userId: ORG, step: 'final', now: t }))).toBe('nothing_to_advance')
    expect(code(() => confirmAuction(room, { userId: ORG, participant: 1, bidCents: 100, now: t }))).toBe('auction_not_open')
    const open = advancePhase(room, { userId: ORG, step: 'auction', now: t })
    expect(open.ack.auctionStart).toBe(room.state.spin?.id ?? deriveView(room.state, t, {}).reveal.id)
    expect(open.version).toBe(room.version + 1)
    expect(code(() => advancePhase(open, { userId: ORG, step: 'auction', now: t + 1 }))).toBe('nothing_to_advance') // geen tweede keer
    expect(nextStep(open, t + 1)).toBeNull()
    // elke telefoon ziet daarmee het veilingscherm (geen onthulling meer)
    expect(deriveView(open.state, t + 1, open.ack).reveal).toBeNull()
  })
  it('eindstand: na de laatste veilingtrekking; veilingnummers lopen op (#1, #2)', () => {
    let { room, t } = afterDraws()
    room = advancePhase(room, { userId: ORG, step: 'auction', now: t })
    room = confirmAuction(room, { userId: ORG, participant: 1, bidCents: 3500, now: t })
    expect(room.announce.lot).toBe(1)
    room = spinTurn(room, { userId: 'sanne', now: t + 10 }).room
    t = released(room)
    expect(nextStep(room, t)).toBeNull() // nog een kavel over
    room = confirmAuction(room, { userId: ORG, participant: 2, bidCents: 1250, now: t })
    expect(room.announce).toMatchObject({ participant: 2, bidCents: 1250, lot: 2 })
    room = spinTurn(room, { userId: ORG, now: t + 10 }).room // Opa, zonder telefoon
    t = released(room)
    expect(nextStep(room, t)).toBe('final')
    expect(code(() => advancePhase(room, { userId: 'sanne', step: 'final', now: t }))).toBe('not_organizer')
    const fin = advancePhase(room, { userId: ORG, step: 'final', now: t })
    expect(deriveView(fin.state, t, fin.ack)).toMatchObject({ reveal: null })
    expect(settle(fin.state, t).phase).toBe('finished')
    expect(code(() => advancePhase(fin, { userId: ORG, step: 'final', now: t + 1 }))).toBe('nothing_to_advance')
  })
  it('zonder veiling: na de laatste trekking direct "Bekijk de eindstand" (stap auction)', () => {
    let room = createRoom({ id: 'r2', code: 'ABCDEF', userId: ORG, name: 'Lars', ...CLUBS, draft: { maxPlayers: 1, rounds: 1, priceCents: 0, pool: ['OVERIG'], mega: [] } })
    room = withPlay(startGame(room, { userId: ORG, now: 1000 }))
    room = spinTurn(room, { userId: ORG, now: afterIntro(room) }).room
    const t = released(room)
    expect(settle(room.state, t).phase).toBe('finished')
    expect(nextStep(room, t)).toBe('auction')
    expect(deriveView(advancePhase(room, { userId: ORG, step: 'auction', now: t }).state, t, { auctionStart: room.state.spin.id }).reveal).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Mock met meerdere telefoons en een gedeelde, instelbare klok.
// ---------------------------------------------------------------------------
function world() {
  const m = new Map()
  const shared = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }
  let ids = 0
  const clock = { t: 1_000_000 }
  const phone = () => {
    const l = new Map()
    const local = { getItem: (k) => (l.has(k) ? l.get(k) : null), setItem: (k, v) => l.set(k, String(v)), removeItem: (k) => l.delete(k) }
    return createMockApi({ shared, local, channel: null, latency: 0, newId: () => `id${++ids}`, now: () => clock.t })
  }
  return { phone, clock }
}

describe('mock: volledig online spel met meerdere telefoons', () => {
  it('start, intro, SPIN per deelnemer, gelijktijdig drukken, veiling, einde', async () => {
    const { phone, clock } = world()
    const lars = phone()
    const sanne = phone()
    const { roomId, code: c } = await lars.createRoom({ name: 'Lars', ...CLUBS, draft: DRAFT })
    await sanne.joinRoom(c, 'Sanne')
    expect(await asyncCode(lars.startGame(roomId))).toBe('players_incomplete') // 2 van 3
    const opa = await lars.addManualPlayer(roomId, 'Opa')
    expect(opa.players.find((p) => p.name === 'Opa')).toMatchObject({ manual: true })
    expect(await asyncCode(sanne.startGame(roomId))).toBe('not_organizer')
    let view = await lars.startGame(roomId, opa.version)
    expect(view).toMatchObject({ phase: 'started', startedAt: clock.t })
    expect(await asyncCode(lars.startGame(roomId, view.version))).toBe('registration_closed') // geen dubbele start
    const sv = await sanne.getRoom(roomId)
    expect(sv.state.config.players.map((p) => p.name)).toEqual(['Lars', 'Sanne', 'Opa'])
    expect(sv.controlSlots).toEqual([1])
    expect(view.controlSlots).toEqual([0, 2])

    expect(await asyncCode(lars.spin(roomId))).toBe('intro_running')
    clock.t += introTimeline(3).vegasAt + 1
    expect(await asyncCode(sanne.startPlay(roomId))).toBe('not_organizer')
    clock.t = (await lars.startPlay(roomId)).playAt
    expect((await sanne.getRoom(roomId)).playAt).toBe(clock.t) // deelnemer krijgt hetzelfde vertrekmoment
    view = await lars.spin(roomId)
    // deelnemer en organisator drukken vrijwel tegelijk: precies één trekking
    clock.t = released(view) - 0
    clock.t += 1
    const both = await Promise.allSettled([sanne.spin(roomId), lars.spin(roomId, { onBehalf: true })])
    expect(both.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(both.find((r) => r.status === 'rejected').reason.code).toBe('spin_in_progress')
    view = await lars.getRoom(roomId)
    expect(view.state.spin.participant).toBe(1)
    clock.t = released(view)
    view = await lars.spin(roomId) // Opa, zonder telefoon
    clock.t = released(view)
    // overgang naar de veiling: alleen de organisator; daarna ziet iedereen hem
    expect(await asyncCode(sanne.advancePhase(roomId, 'auction'))).toBe('not_organizer')
    expect(await asyncCode(lars.confirmAuction(roomId, 1, 3500))).toBe('auction_not_open')
    await lars.advancePhase(roomId, 'auction')
    expect((await sanne.getRoom(roomId)).ack.auctionStart).toBeTruthy()
    expect(await asyncCode(lars.advancePhase(roomId, 'auction'))).toBe('nothing_to_advance')
    expect(await asyncCode(sanne.confirmAuction(roomId, 1, 3500))).toBe('not_organizer')
    view = await lars.confirmAuction(roomId, 1, 3500)
    expect(view.announce).toMatchObject({ participant: 1, bidCents: 3500, lot: 1 })
    expect(await asyncCode(lars.spin(roomId))).toBe('not_your_turn')
    view = await sanne.spin(roomId)
    clock.t = released(view)
    view = await lars.confirmAuction(roomId, 2, 0) // €0 bod mag
    expect(view.announce.lot).toBe(2)
    view = await lars.spin(roomId)
    clock.t = released(view)
    expect(await asyncCode(sanne.advancePhase(roomId, 'final'))).toBe('not_organizer')
    view = await lars.advancePhase(roomId, 'final')
    expect(view.ack.finish).toBeTruthy()
    expect(deriveView(view.state, clock.t, (await sanne.getRoom(roomId)).ack).reveal).toBeNull() // ook Sanne: eindstand
    const end = settle(view.state, clock.t)
    expect(end.phase).toBe('finished')
    expect(end.draws).toHaveLength(5)
    expect(new Set(end.draws.map((d) => d.resultId)).size).toBe(5)
    expect(end.draws.filter((d) => d.round === 'veiling').map((d) => [d.participant, d.bid])).toEqual([
      [1, 35],
      [2, 0],
    ])
  })
})
