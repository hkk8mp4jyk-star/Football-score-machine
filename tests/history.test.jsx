// F10 (eindscherm + deelbare PNG-gegevens) en F12 (geschiedenis).
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createMockApi } from '../src/online/mock/mockApi.js'
import { ALL_RESULTS, OTHER_ID } from '../src/game/config.js'
import { settle } from '../src/game/engine.js'
import { potCents, totalCents } from '../src/game/money.js'
import { introTimeline, nextStep } from '../src/lobby/playRules.js'
import { releaseDelay } from '../src/game/timeline.js'
import { HISTORY_KEY, MAX_HISTORY, addEntry, collectFinished, createHistoryStore, historyEntry, isRoomFinished } from '../src/online/history.js'
import { gridModel, shareFileName, shareModel, shareOrDownload } from '../src/online/share/resultImage.js'
import { FinalScreen } from '../src/online/screens/FinalScreen.jsx'
import { HistoryList, HistoryMatch } from '../src/online/screens/History.jsx'
import { Home } from '../src/online/screens/EntryScreens.jsx'

const CLUBS = { home: 'Werder Bremen II', away: 'Bremer SV' }
const NAMES = ['Lars', 'Sanne', 'Bas', 'Marieke', 'Dennis', 'Frank', 'Esther', 'Patrick', 'Jeroen', 'Noor', 'Ahmed', 'Ruud']
const IDS = ALL_RESULTS.map((r) => r.id ?? r).filter((id) => id !== OTHER_ID)

function memoryStorage() {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }
}

function world() {
  const shared = memoryStorage()
  let ids = 0
  const clock = { t: 1_793_000_000_000 }
  const phone = (local = memoryStorage()) => createMockApi({ shared, local, channel: null, latency: 0, newId: () => `id${++ids}`, now: () => clock.t })
  return { phone, clock }
}

const released = (view) => {
  const s = view.state.spin ?? view.state.lastSpin
  return s ? s.startedAt + releaseDelay(s) + 1 : 0
}

// Volledig spel: organisator + (n − 1) deelnemers zonder telefoon (organisator draait).
async function playGame(api, clock, { n = 4, rounds = 2, price = 250, auctions = 2, bids = [1234, 3500], clubs = CLUBS, shuffle = true } = {}) {
  const pool = [...IDS.slice(0, n * rounds + auctions - 1), OTHER_ID]
  const mega = pool.filter((id) => ['0-0', '1-1', '2-1'].includes(id))
  const { roomId } = await api.createRoom({ name: NAMES[0], ...clubs, draft: { maxPlayers: n, rounds, priceCents: price, pool, mega } })
  let view
  for (let i = 1; i < n; i++) view = await api.addManualPlayer(roomId, NAMES[i])
  if (shuffle && n > 1) {
    for (let i = 0; i < 10; i++) {
      view = await api.shuffleOrder(roomId)
      if (view.players.map((p) => p.slot).join() !== [...Array(n).keys()].join()) break
    }
  }
  view = await api.startGame(roomId)
  clock.t += introTimeline(n).vegasAt + 1
  clock.t = (await api.startPlay(roomId)).playAt
  let lot = 0
  for (let guard = 0; guard < 200; guard++) {
    view = await api.getRoom(roomId)
    clock.t = Math.max(clock.t, released(view))
    const st = settle(view.state, clock.t)
    const step = nextStep(view, clock.t)
    if (step === 'final') {
      view = await api.advancePhase(roomId, 'final')
      break
    }
    if (step === 'auction') {
      view = await api.advancePhase(roomId, 'auction')
      continue
    }
    if (st.phase === 'draw') view = await api.spin(roomId)
    else if (st.phase === 'auction' && !st.auctionTurn) {
      const p = st.config.players[(lot + 1) % n].id
      await api.confirmAuction(roomId, p, bids[lot % bids.length])
      lot++
    } else if (st.phase === 'auction') view = await api.spin(roomId)
  }
  clock.t += 10
  return await api.getRoom(roomId)
}

describe('F12: wanneer is een spel afgerond', () => {
  it('pas na "Bekijk de eindstand"; lopend spel of wachtkamer niet', async () => {
    const { phone, clock } = world()
    const lars = phone()
    const { roomId } = await lars.createRoom({ name: 'Lars', ...CLUBS, draft: { maxPlayers: 1, rounds: 1, priceCents: 100, pool: ['0-0', OTHER_ID], mega: [] } })
    expect(isRoomFinished(await lars.getRoom(roomId), clock.t)).toBe(false) // wachtkamer
    await lars.startGame(roomId)
    clock.t += introTimeline(1).vegasAt + 1
    clock.t = (await lars.startPlay(roomId)).playAt
    const v = await lars.spin(roomId)
    clock.t = released(v)
    expect(isRoomFinished(await lars.getRoom(roomId), clock.t)).toBe(false) // nog geen overgang
    const end = await playGame(lars, clock, { n: 1, rounds: 1, auctions: 1 })
    expect(isRoomFinished(end, clock.t)).toBe(true)
  })
})

describe('F12: opslag van de geschiedenis', () => {
  const entry = (i) => ({ roomId: `r${i}`, matchName: `Wedstrijd ${i}`, startedAt: 1_000 + i, potCents: i, room: { state: { config: { players: [] } } } })

  it('nieuwste eerst, geen dubbele wedstrijd, maximaal 10; de elfde verdringt de oudste', () => {
    let list = []
    for (const i of [3, 1, 2]) list = addEntry(list, entry(i))
    expect(list.map((e) => e.roomId)).toEqual(['r3', 'r2', 'r1'])
    list = addEntry(list, { ...entry(2), potCents: 999 }) // zelfde wedstrijd opnieuw
    expect(list).toHaveLength(3)
    expect(list.find((e) => e.roomId === 'r2').potCents).toBe(999)
    for (let i = 4; i <= 10; i++) list = addEntry(list, entry(i))
    expect(list).toHaveLength(MAX_HISTORY)
    list = addEntry(list, entry(11))
    expect(list).toHaveLength(10)
    expect(list.map((e) => e.roomId)).not.toContain('r1') // oudste weg
    expect(list[0].roomId).toBe('r11')
  })

  it('blijft bewaard na "browser sluiten" (nieuwe store op dezelfde opslag); kapotte gegevens schaden niets', async () => {
    const { phone, clock } = world()
    const storage = memoryStorage()
    const lars = phone(storage)
    const end = await playGame(lars, clock)
    expect(lars.history.save(end, clock.t)).toBe(true)
    const after = createHistoryStore(storage) // "nieuwe sessie"
    expect(after.list()).toHaveLength(1)
    expect(after.get(end.id).matchName).toBe('Werder Bremen II – Bremer SV')
    storage.setItem(HISTORY_KEY, '{kapot')
    expect(createHistoryStore(storage).list()).toEqual([])
    expect(createHistoryStore(null).list()).toEqual([]) // geen opslag beschikbaar
  })

  it('een lopend spel wordt niet opgeslagen en blijft "lopend" (myRooms)', async () => {
    const { phone, clock } = world()
    const lars = phone()
    const { roomId, code } = await lars.createRoom({ name: 'Lars', ...CLUBS, draft: { maxPlayers: 1, rounds: 1, priceCents: 100, pool: ['0-0', OTHER_ID], mega: [] } })
    lars.history.remember(roomId, code)
    expect(lars.history.save(await lars.getRoom(roomId), clock.t)).toBe(false)
    expect(lars.history.list()).toEqual([])
    expect(lars.history.myRooms()).toEqual([{ roomId, code }])
  })

  it('1, 5 en 10 wedstrijden; elfde verdringt de oudste; sortering op speeldatum', async () => {
    const { phone, clock } = world()
    const lars = phone()
    const ids = []
    for (let i = 0; i < 11; i++) {
      clock.t += 3_600_000
      const end = await playGame(lars, clock, { n: 1, rounds: 1, auctions: 0, clubs: { home: `Thuis ${i + 1}`, away: 'Uit' } })
      lars.history.save(end, clock.t)
      ids.push(end.id)
      const n = lars.history.list().length
      if (i === 0) expect(n).toBe(1)
      if (i === 4) expect(n).toBe(5)
      if (i === 9) expect(n).toBe(10)
    }
    const list = lars.history.list()
    expect(list).toHaveLength(10)
    expect(list.map((e) => e.roomId)).toEqual(ids.slice(1).reverse())
    expect(list[0].matchName).toBe('Thuis 11 – Uit')
    expect([...list].sort((a, b) => b.startedAt - a.startedAt)).toEqual(list)
  })

  it('collectFinished: intussen afgeronde spellen van dit toestel komen in de geschiedenis', async () => {
    const { phone, clock } = world()
    const lars = phone()
    const sanne = phone()
    const { roomId, code } = await lars.createRoom({ name: 'Lars', ...CLUBS, draft: { maxPlayers: 2, rounds: 1, priceCents: 100, pool: ['0-0', '1-0', OTHER_ID], mega: [] } })
    await sanne.joinRoom(code, 'Sanne')
    sanne.history.remember(roomId, code)
    sanne.history.remember('bestaat-niet', 'ZZZZZZ')
    await lars.startGame(roomId)
    clock.t += introTimeline(2).vegasAt + 1
    clock.t = (await lars.startPlay(roomId)).playAt
    let v = await lars.spin(roomId)
    clock.t = released(v)
    v = await sanne.spin(roomId)
    clock.t = released(v)
    await collectFinished(sanne) // nog niet afgerond (geen overgang)
    expect(sanne.history.list()).toEqual([])
    await lars.advancePhase(roomId, 'auction')
    await lars.confirmAuction(roomId, 1, 500)
    v = await sanne.spin(roomId)
    clock.t = released(v)
    await lars.advancePhase(roomId, 'final')
    await collectFinished(sanne)
    expect(sanne.history.list().map((e) => e.roomId)).toEqual([roomId])
    expect(sanne.history.myRooms()).toEqual([]) // afgerond en onbekende kamer opgeruimd
  })
})

describe('F10: gegevens van de einduitslag (PNG)', () => {
  it('4 deelnemers: gelote volgorde, alle trekkingen, kosten, totalen en pot', async () => {
    const { phone, clock } = world()
    const lars = phone()
    const end = await playGame(lars, clock, { n: 4 })
    const st = settle(end.state, clock.t)
    const m = shareModel(end, st)
    expect(m.matchName).toBe('Werder Bremen II – Bremer SV')
    expect(m.players.map((p) => p.name)).toEqual(st.config.players.map((p) => p.name)) // definitieve volgorde
    expect(m.players.map((p) => p.name)).not.toEqual(NAMES.slice(0, 4)) // geloot, niet de aanmeldvolgorde
    expect(m.players.map((p) => p.num)).toEqual([1, 2, 3, 4])
    expect(m).not.toHaveProperty('results') // geen uitslagenraster in de PNG
    expect(m.players.flatMap((p) => p.draws)).toHaveLength(10) // 8 vast + 2 veiling
    expect(m.potCents).toBe(8 * 250 + 1234 + 3500)
    expect(m.potCents).toBe(potCents(st))
    for (const p of m.players) {
      const id = st.config.players.find((x) => x.name === p.name).id
      expect(p.totalCents).toBe(totalCents(st.draws.filter((d) => d.participant === id), 250))
    }
    // Elk uitslagblokje: alleen uitslag + betaald bedrag; geen MEGA-, veiling- of OVERIG-kenmerk.
    const all = m.players.flatMap((p) => p.draws)
    expect(all.every((d) => Object.keys(d).sort().join() === 'cents,label')).toBe(true)
    expect(all.map((d) => d.cents).filter((c) => c !== 250).sort()).toEqual([1234, 3500])
    expect(all.filter((d) => d.label === 'Overig')).toHaveLength(1) // OVERIG als gewone tekst
    // uitslagen per deelnemer = de trekkingen van die deelnemer
    for (const p of m.players) {
      const id = st.config.players.find((x) => x.name === p.name).id
      expect(p.draws.map((d) => d.label)).toEqual(st.draws.filter((d) => d.participant === id).map((d) => (d.resultId === OTHER_ID ? 'Overig' : d.resultId)))
    }
  })

  it('12 deelnemers × 4 rondes met alle 50 uitslagen', async () => {
    const { phone, clock } = world()
    const lars = phone()
    const end = await playGame(lars, clock, { n: 12, rounds: 4, auctions: 2 })
    const st = settle(end.state, clock.t)
    expect(st.config.pool).toHaveLength(50)
    const m = shareModel(end, st)
    expect(m.players.flatMap((p) => p.draws)).toHaveLength(50)
    expect(m.players).toHaveLength(12)
    expect(m.players.reduce((s, p) => s + p.totalCents, 0)).toBe(m.potCents)
    expect(m.potCents).toBe(48 * 250 + 1234 + 3500)
  })

  it('1 deelnemer; €0 per trekking', async () => {
    const { phone, clock } = world()
    const lars = phone()
    const end = await playGame(lars, clock, { n: 1, rounds: 1, price: 0, auctions: 1, bids: [750] })
    const m = shareModel(end, settle(end.state, clock.t))
    expect(m.players).toEqual([expect.objectContaining({ num: 1, name: 'Lars', totalCents: 750 })])
    expect(m.potCents).toBe(750)
  })

  it('raster (tabblad Uitslagen): vaste posities, naam bij elke getrokken uitslag, OVERIG apart, geen markeringen', async () => {
    const { phone, clock } = world()
    const lars = phone()
    const end = await playGame(lars, clock, { n: 4 })
    const st = settle(end.state, clock.t)
    const g = gridModel(end, st)
    expect(g).toMatchObject({ matchName: 'Werder Bremen II – Bremer SV', potCents: 6734 })
    expect(g.goals).toEqual([0, 1, 2, 3, 4, 5, 6]) // pool bevat 0-5/0-6 → raster tot 6, zoals in de app
    expect(g.rows).toHaveLength(7)
    expect(g.rows.every((r) => r.length === 7)).toBe(true)
    expect(g.rows[1][0].id).toBe('1-0') // rij = thuis, kolom = uit
    const nameOf = new Map(st.config.players.map((p) => [p.id, p.name]))
    for (const d of st.draws) {
      const c = d.resultId === OTHER_ID ? g.other : g.rows.flat().find((x) => x.id === d.resultId)
      expect(c).toMatchObject({ inPool: true, name: nameOf.get(d.participant) })
    }
    const cells = [...g.rows.flat(), g.other]
    expect(cells.filter((c) => c.name)).toHaveLength(10) // alle 10 getrokken uitslagen
    expect(cells.filter((c) => !c.inPool).length).toBe(49 - 9) // niet in de pool: gedimd zichtbaar
    expect(cells.every((c) => Object.keys(c).sort().join() === 'id,inPool,name')).toBe(true) // geen MEGA/veiling
  })

  it('nette bestandsnaam met wedstrijd en datum', () => {
    const t = new Date(2026, 10, 1, 20, 30).getTime()
    expect(shareFileName('Werder Bremen II – Bremer SV', t)).toBe('einduitslag-werder-bremen-ii-bremer-sv-2026-11-01.png')
    expect(shareFileName('Fortuna Düsseldorf – 1. FC Köln', t)).toBe('einduitslag-fortuna-dusseldorf-1-fc-koln-2026-11-01.png')
    expect(shareFileName('–', t)).toBe('einduitslag-wedstrijd-2026-11-01.png')
    expect(shareFileName('Werder Bremen II – Bremer SV', t, 'grid')).toBe('uitslagen-werder-bremen-ii-bremer-sv-2026-11-01.png')
  })

  it('delen via het deelmenu; zonder deelmenu downloaden; annuleren is geen fout', async () => {
    const file = new File([new Uint8Array([1])], 'einduitslag.png', { type: 'image/png' })
    const shared = []
    const nav = { canShare: ({ files }) => files[0] === file, share: async (d) => shared.push(d) }
    expect(await shareOrDownload(file, { nav, title: 'X' })).toBe('shared')
    expect(shared[0]).toEqual({ files: [file], title: 'X' })
    const cancel = { canShare: () => true, share: async () => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' })) }
    expect(await shareOrDownload(file, { nav: cancel })).toBe('cancelled')
    const clicks = []
    const doc = { createElement: () => ({ click() { clicks.push(this.download) }, remove() {} }), body: { appendChild() {} } }
    expect(await shareOrDownload(file, { nav: {}, doc })).toBe('downloaded')
    expect(await shareOrDownload(file, { nav: { canShare: () => false, share: async () => {} }, doc })).toBe('downloaded')
    const broken = { canShare: () => true, share: async () => Promise.reject(new Error('NotAllowed')) }
    expect(await shareOrDownload(file, { nav: broken, doc })).toBe('downloaded') // terugval
    expect(clicks).toEqual(['einduitslag.png', 'einduitslag.png', 'einduitslag.png'])
  })
})

describe('F10/F12: schermen', () => {
  it('eindscherm: wedstrijdnaam, totale pot, beide tabbladen, gelote volgorde, twee knoppen, geen winnaar', async () => {
    const { phone, clock } = world()
    const lars = phone()
    const end = await playGame(lars, clock, { n: 4 })
    const st = settle(end.state, clock.t)
    const html = renderToStaticMarkup(<FinalScreen room={end} state={st} onBack={() => {}} />)
    expect(html).toContain('Werder Bremen II – Bremer SV')
    expect(html).toMatch(/Totale pot<\/span><b>€67,34<\/b>/)
    expect(html).toContain('Uitslagen')
    expect(html).toContain('Per deelnemer')
    expect(html).toContain('Deel einduitslag')
    expect(html).toContain('Terug naar beginscherm')
    expect(html).not.toMatch(/winnaar/i)
    const names = [...html.matchAll(/class="person-name">([^<]+)</g)].map((x) => x[1])
    expect(names).toEqual(st.config.players.map((p) => p.name))
  })

  it('beginscherm: icoon Geschiedenis altijd zichtbaar (ook zonder afgeronde wedstrijden)', () => {
    const s = renderToStaticMarkup(<Home onNew={() => {}} onJoin={() => {}} onHistory={() => {}} />)
    expect(s).toContain('aria-label="Geschiedenis"')
    expect(s).toContain('ol-history-btn')
  })
  it('lege geschiedenis: uitleg dat wedstrijden op dit toestel worden bewaard; terugknop', () => {
    const s = renderToStaticMarkup(<HistoryList entries={[]} onOpen={() => {}} onBack={() => {}} />)
    expect(s).toContain('Nog geen afgeronde wedstrijden. Afgeronde wedstrijden worden op dit toestel bewaard.')
    expect(s).toContain('Terug naar beginscherm')
  })

  it('geschiedenis: naam, speeldatum en pot, nieuwste eerst; terugkijken = eindscherm zonder SPIN of beheer', async () => {
    const { phone, clock } = world()
    const lars = phone()
    const a = await playGame(lars, clock, { n: 2, rounds: 1, auctions: 1, clubs: { home: 'Ajax', away: 'PSV' } })
    lars.history.save(a, clock.t)
    clock.t += 86_400_000
    const b = await playGame(lars, clock, { n: 4, clubs: { home: 'Feyenoord', away: 'AZ' } })
    lars.history.save(b, clock.t)
    const list = lars.history.list()
    const html = renderToStaticMarkup(<HistoryList entries={list} onOpen={() => {}} onBack={() => {}} />)
    expect(html.indexOf('Feyenoord – AZ')).toBeLessThan(html.indexOf('Ajax – PSV'))
    expect(html).toContain('€67,34')
    expect(html).toMatch(/(maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag) \d+ \w+ 20\d\d/)
    const match = renderToStaticMarkup(<HistoryMatch entry={list[0]} onBack={() => {}} />)
    expect(match).toContain('Feyenoord – AZ')
    expect(match).toContain('Deel einduitslag')
    expect(match).toContain('Terug naar geschiedenis')
    expect(match).not.toMatch(/spin-btn|Draai namens|Bevestig veiling|Start de veiling/)
    // De kopie is los van de server: alle trekkingen en bedragen staan erin.
    expect(list[0].room.state.draws).toHaveLength(10)
    expect(list[0].potCents).toBe(6734)
    expect(JSON.stringify(list[0])).not.toMatch(/userId/)
  })

  it('historyEntry: afgeronde spelstatus, pot en speeldatum', async () => {
    const { phone, clock } = world()
    const lars = phone()
    const end = await playGame(lars, clock, { n: 3, rounds: 2, auctions: 2, bids: [100, 200] })
    const e = historyEntry(end, clock.t)
    expect(e).toMatchObject({ roomId: end.id, matchName: end.matchName, startedAt: end.startedAt, potCents: 6 * 250 + 300 })
    expect(e.room.state.phase).toBe('finished')
    expect(e.room.state.spin).toBeNull()
  })
})
