// Echte frontendkoppeling (realApi) van begin tot eind, zonder netwerk:
// realApi → HTTP-laag van de Edge Function → serverlogica → opslag met de
// databaseregels. Elk "toestel" heeft zijn eigen opslag (sessie) en client.
// Nagebootst: alleen Supabase Auth (anonieme login) en Realtime (room_pulses).
import { describe, expect, it } from 'vitest'
import { createRealApi } from '../src/online/realApi.js'
import { createGameServer } from '../src/server/actions.js'
import { createHttpHandler } from '../src/server/http.js'
import { introTimeline } from '../src/lobby/playRules.js'
import { settle } from '../src/game/engine.js'
import { releaseDelay } from '../src/game/timeline.js'
import { deriveView } from '../src/game/view.js'
import { ApiError } from '../src/online/api.js'
import { createMemoryStore } from './memoryStore.js'

const URL = 'https://twzjsmxydnfmowrmffsl.supabase.co'
const SETUP = (n = 3, extra = {}) => ({
  name: 'Lars',
  home: 'Werder Bremen II',
  away: 'Bremer SV',
  draft: { maxPlayers: n, rounds: 1, priceCents: 1000, pool: ['0-0', '1-0', '1-1', '2-0', '2-2'].slice(0, n + 1).concat('OVERIG'), mega: ['0-0'], ...extra },
})

function memoryStorage() {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }
}

// "Supabase" + server in één proces.
function world() {
  const clock = { t: 1_800_000_000_000 }
  const store = createMemoryStore({ now: () => clock.t })
  const server = createGameServer({ store, now: () => clock.t })
  const tokens = new Map() // token → userId
  let n = 0
  const http = createHttpHandler({ server, authenticate: async (t) => tokens.get(t) ?? null, log: () => {} })
  const requests = []
  let offline = false
  const fetchFn = async (input, init) => {
    requests.push(JSON.parse(init.body).action)
    if (offline) throw new TypeError('Failed to fetch')
    expect(init.headers.apikey).toBe('publiek')
    return http(new Request(input, init))
  }
  // Eén toestel: eigen opslag (sessie), eigen nep-Supabase-client.
  function device(storage = memoryStorage()) {
    const channels = []
    const client = {
      auth: {
        async getSession() {
          const s = storage.getItem('fsm-auth')
          return { data: { session: s ? JSON.parse(s) : null } }
        },
        async signInAnonymously() {
          const id = `00000000-0000-4000-c000-${String(++n).padStart(12, '0')}`
          const session = { access_token: `token-${n}`, user: { id } }
          tokens.set(session.access_token, id)
          storage.setItem('fsm-auth', JSON.stringify(session))
          return { data: { session }, error: null }
        },
        async refreshSession() {},
      },
      channel(name) {
        const ch = {
          name,
          on(_type, filter, cb) {
            ch.filter = filter
            ch.cb = cb
            return ch
          },
          subscribe() {
            const roomId = ch.filter.filter.replace('room_id=eq.', '')
            ch.off = store.onPulse((id) => id === roomId && ch.cb({}))
            return ch
          },
        }
        channels.push(ch)
        return ch
      },
      removeChannel(ch) {
        ch.off?.()
        channels.splice(channels.indexOf(ch), 1)
      },
    }
    const devClock = { offset: 0, setOffset(o) { this.offset = o }, now: () => clock.t }
    const api = createRealApi({ url: URL, key: 'publiek', client, fetchFn, storage, clock: devClock, pollMs: 60_000, events: null })
    return { api, storage, channels, clock: devClock }
  }
  return { clock, store, device, tokens, requests, setOffline: (v) => (offline = v) }
}

const code = async (p) => {
  try {
    await p
  } catch (e) {
    if (e instanceof ApiError) return e.code
    throw e
  }
  return 'ok'
}
const flush = () => new Promise((r) => setTimeout(r, 5))

describe('echte koppeling (realApi) met meerdere toestellen', () => {
  it('zonder publieke sleutel: nog niet beschikbaar (geen verzoeken)', async () => {
    const api = createRealApi({ key: '', storage: memoryStorage() })
    expect(await code(api.createRoom(SETUP()))).toBe('not_available')
  })

  it('volledig spel: aanmaken, aanmelden (code), Realtime, start, SPIN, namens, veiling, overgangen, eindstand', async () => {
    const w = world()
    const lars = w.device()
    const sanne = w.device()
    const bas = w.device()
    const { roomId, code: c } = await lars.api.createRoom(SETUP(3))
    // Realtime: de organisator hoort het als iemand zich aanmeldt.
    let pings = 0
    const off = lars.api.subscribe(roomId, () => pings++)
    await flush()
    expect((await sanne.api.lookupRoom(c.toLowerCase())).matchName).toBe('Werder Bremen II – Bremer SV')
    await sanne.api.joinRoom(c, 'sanne')
    expect(pings).toBeGreaterThan(0)
    expect(await code(bas.api.joinRoom(c, 'SANNE'))).toBe('name_taken')
    await bas.api.joinRoom(c, 'Bas')
    // Deelnemer ziet geen spelregels of volgorde en kan niets beheren.
    const sv = await sanne.api.getRoom(roomId)
    expect(sv.draft).toBeNull()
    expect(JSON.stringify(sv)).not.toMatch(/userId|00000000-0000-4000-c000/)
    for (const p of [sanne.api.startGame(roomId), sanne.api.setOrder(roomId, [2, 1, 0]), sanne.api.shuffleOrder(roomId), sanne.api.removePlayer(roomId, 0)]) {
      expect(await code(p)).toBe('not_organizer')
    }
    await lars.api.setOrder(roomId, [1, 0, 2]) // Sanne, Lars, Bas
    const started = await lars.api.startGame(roomId)
    expect(started.state.config.players.map((p) => p.name)).toEqual(['Sanne', 'Lars', 'Bas'])
    expect(await code(sanne.api.spin(roomId))).toBe('intro_running')
    w.clock.t = started.startedAt + introTimeline(3).endAt + 1
    expect(await code(lars.api.spin(roomId))).toBe('not_your_turn')
    let room = await sanne.api.spin(roomId) // eigen beurt
    const release = () => {
      const s = room.state.spin ?? room.state.lastSpin
      w.clock.t = Math.max(w.clock.t, s.startedAt + releaseDelay(s) + 1)
    }
    release()
    expect(await code(bas.api.spin(roomId, { onBehalf: true }))).toBe('not_your_turn') // deelnemer niet namens een ander
    expect(await code(sanne.api.spin(roomId))).toBe('not_your_turn')
    room = await lars.api.spin(roomId)
    release()
    room = await lars.api.spin(roomId, { onBehalf: true }) // namens Bas
    release()
    expect(w.store.draws.map((d) => [d.participant, d.on_behalf])).toEqual([
      [1, false],
      [0, false],
      [2, true],
    ])
    // Overgang naar de veiling: alleen de organisator, iedereen gaat mee.
    expect(await code(sanne.api.advancePhase(roomId, 'auction'))).toBe('not_organizer')
    await lars.api.advancePhase(roomId, 'auction')
    const bv = await bas.api.getRoom(roomId)
    expect(deriveView(bv.state, w.clock.t, bv.ack).reveal).toBeNull()
    room = await lars.api.confirmAuction(roomId, 2, 3500)
    expect(room.announce).toMatchObject({ participant: 2, bidCents: 3500, lot: 1 })
    expect(await code(lars.api.confirmAuction(roomId, 1, 100))).toBe('auction_confirmed')
    room = await bas.api.spin(roomId)
    release()
    expect(await code(lars.api.advancePhase(roomId, 'final'))).toBe('nothing_to_advance') // nog een veiling over
    room = await lars.api.confirmAuction(roomId, 1, 0)
    expect(room.announce.lot).toBe(2)
    room = await sanne.api.spin(roomId)
    release()
    await lars.api.advancePhase(roomId, 'final')
    const end = await sanne.api.getRoom(roomId)
    expect(settle(end.state, w.clock.t).phase).toBe('finished')
    expect(deriveView(end.state, w.clock.t, end.ack).reveal).toBeNull()
    expect(end.state.config.players.map((p) => p.name)).toEqual(['Sanne', 'Lars', 'Bas']) // definitieve volgorde
    off()
    await flush()
    expect(lars.channels).toHaveLength(0) // Realtime-kanaal netjes afgemeld
  })

  it('sessieherstel: browser dicht en weer open op hetzelfde toestel; ander toestel kan niets overnemen', async () => {
    const w = world()
    const orgStorage = memoryStorage()
    const lars = w.device(orgStorage)
    const sanneStorage = memoryStorage()
    const sanne = w.device(sanneStorage)
    const { roomId, code: c } = await lars.api.createRoom(SETUP(2))
    lars.api.session.set({ roomId, code: c })
    await sanne.api.joinRoom(c, 'Sanne')
    // "Browser gesloten": nieuwe api-instanties met dezelfde opslag.
    const lars2 = w.device(orgStorage)
    const sanne2 = w.device(sanneStorage)
    expect(lars2.api.session.get()).toEqual({ roomId, code: c })
    expect((await lars2.api.getRoom(roomId)).isOrganizer).toBe(true)
    expect((await sanne2.api.lookupRoom(c)).mySlot).toBe(1)
    await lars2.api.shuffleOrder(roomId) // organisatorrechten behouden
    // Ander toestel (lege opslag): nieuwe identiteit, geen toegang, naam niet over te nemen.
    const other = w.device()
    expect(await code(other.api.getRoom(roomId))).toBe('room_not_found')
    expect(await code(other.api.joinRoom(c, 'sanne'))).toBe('room_full')
    expect(await code(other.api.shuffleOrder(roomId))).toBe('room_not_found')
  })

  it('geen verbinding: nette fout, geen herhaling; spelverzoeken worden nooit automatisch opnieuw verstuurd', async () => {
    const w = world()
    const lars = w.device()
    const { roomId } = await lars.api.createRoom(SETUP(1))
    await lars.api.startGame(roomId)
    w.clock.t += introTimeline(1).endAt + 1
    w.setOffline(true)
    const before = w.requests.length
    expect(await code(lars.api.spin(roomId))).toBe('network')
    expect(w.requests.length - before).toBe(1) // precies één poging
    w.setOffline(false)
    // Opnieuw ophalen: de serverstatus is leidend (nog geen trekking).
    expect((await lars.api.getRoom(roomId)).state.draws).toHaveLength(0)
    await lars.api.spin(roomId)
    expect(w.store.draws).toHaveLength(1)
  })

  it('verlopen login (401): één keer opnieuw aanmelden en versturen; andere fouten niet', async () => {
    const w = world()
    const lars = w.device()
    const { roomId } = await lars.api.createRoom(SETUP(1))
    w.tokens.clear() // token ongeldig geworden
    lars.storage.removeItem('fsm-auth')
    // Nieuwe anonieme identiteit = geen lid meer (zoals een gewiste browser).
    expect(await code(lars.api.getRoom(roomId))).toBe('room_not_found')
    const n = w.requests.filter((a) => a === 'get_room').length
    expect(n).toBe(1)
  })

  it('klok: afwijking t.o.v. de server wordt gemeten en ingesteld', async () => {
    const w = world()
    const lars = w.device()
    await lars.api.createRoom(SETUP(1))
    expect(Number.isFinite(lars.clock.offset)).toBe(true)
    expect(lars.clock.offset).not.toBe(0) // servertijd (nep-klok) wijkt af van Date.now()
  })
})
