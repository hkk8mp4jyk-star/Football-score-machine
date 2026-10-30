// Lokale tests van het live-testscript (zonder netwerk): fasekeuze, project-
// bewaking, tijdslimieten, begrensde herhalingen, opruimen en eindstatus.
// De fasen draaien tegen de echte serverlogica met een geheugenopslag.
import { describe, expect, it } from 'vitest'
import { createGameServer } from '../src/server/actions.js'
import { createHttpHandler } from '../src/server/http.js'
import { EXIT, EXPECTED_REF, LIMITS, UsageError, createLiveClient, fetchWithTimeout, parseArgs, runPhase } from '../scripts/live-test.mjs'
import { createMemoryStore } from './memoryStore.js'

const OLD_REF = 'nptulnnuejivwcgcltuy'
const uuid = (i) => `00000000-0000-4000-c000-${String(i).padStart(12, '0')}`

const FAST = {
  ...LIMITS,
  mgmtTimeoutMs: 100,
  functionTimeoutMs: 100,
  max429Retries: 2,
  maxSignInAttempts: 3,
  signInRetryDelayMs: 0,
  phaseDeadlineMs: { '5a': 2_000, '5b': 2_000, '5c': 2_000 },
  cleanupStepTimeoutMs: 200,
  cleanupDeadlineMs: 1_000,
  logPolls: 2,
  logPollIntervalMs: 0,
  loopCheckDelayMs: 0,
}

describe('live test: fase kiezen en project bewaken', () => {
  it('start alleen precies één bekende fase', () => {
    expect(parseArgs(['5a'])).toEqual({ phase: '5a', ref: EXPECTED_REF })
    expect(parseArgs(['5b'])).toEqual({ phase: '5b', ref: EXPECTED_REF })
    for (const argv of [[], ['5d'], ['5a', '5b'], ['alles'], ['--bevestig']]) {
      expect(() => parseArgs(argv)).toThrow(UsageError)
    }
  })

  it('fase 5C alleen met expliciete bevestiging', () => {
    expect(() => parseArgs(['5c'])).toThrow(/--bevestig/)
    expect(parseArgs(['5c', '--bevestig']).phase).toBe('5c')
  })

  it('weigert elk ander project, ook via de omgeving', () => {
    expect(() => parseArgs(['5a'], { SUPABASE_PROJECT_REF: OLD_REF })).toThrow(UsageError)
    expect(() => parseArgs(['5a'], { SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst' })).toThrow(UsageError)
    expect(parseArgs(['5a'], { SUPABASE_PROJECT_REF: EXPECTED_REF }).ref).toBe(EXPECTED_REF)
    expect(() => createLiveClient({ ref: OLD_REF, fetchImpl: () => Promise.reject(new Error('mag niet')) })).toThrow(UsageError)
  })
})

// Nep-fetch die elk verzoek registreert; `handler(url, init, n)` bepaalt het antwoord.
function recordingFetch(handler) {
  const calls = []
  const fetchImpl = (url, init) => {
    calls.push({ url: String(url), method: init?.method })
    return handler(String(url), init, calls.length)
  }
  return { calls, fetchImpl }
}
const respond = (status, body) => Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }))
const never = () => new Promise(() => {})

describe('live test: verbindingen (tijdslimieten en begrensde herhalingen)', () => {
  it('alle verzoeken gaan naar het nieuwe project', async () => {
    const { calls, fetchImpl } = recordingFetch((url) => {
      if (url.includes('/database/query')) return respond(201, [{ ok: 1 }])
      if (url.includes('/health')) return respond(200, [])
      if (url.includes('fsm-testlogin')) return respond(200, { access_token: 't', user_id: uuid(1), is_anonymous: true })
      return respond(200, { ok: true })
    })
    const client = createLiveClient({ fetchImpl, limits: FAST, sleep: async () => {} })
    await client.sql('select 1')
    await client.health()
    await client.signIn()
    await client.game('t', { action: 'time' })
    expect(calls).toHaveLength(4)
    for (const c of calls) {
      const host = new URL(c.url).host
      expect(host === 'api.supabase.com' ? c.url : host).toContain(EXPECTED_REF)
      expect(c.url).not.toContain(OLD_REF)
    }
  })

  it('verzoek dat niet antwoordt: afgebroken na de tijdslimiet', async () => {
    const client = createLiveClient({ fetchImpl: never, limits: FAST })
    const t = Date.now()
    await expect(client.game('t', { action: 'time' })).rejects.toThrow(/tijdslimiet/)
    expect(Date.now() - t).toBeLessThan(1_000)
  })

  it('antwoord waarvan de inhoud blijft hangen: ook afgebroken', async () => {
    const stuck = { status: 200, ok: true, text: never }
    const client = createLiveClient({ fetchImpl: () => Promise.resolve(stuck), limits: FAST })
    await expect(client.sql('select 1')).rejects.toThrow(/tijdslimiet/)
  })

  it('tijdslimiet geldt ook als fetch het afbreeksignaal negeert', async () => {
    await expect(fetchWithTimeout(never, 'https://api.supabase.com/x', { method: 'POST' }, 50)).rejects.toThrow(/tijdslimiet/)
  })

  it('beheer-API "te veel verzoeken" (429): begrensd aantal herhalingen', async () => {
    const { calls, fetchImpl } = recordingFetch(() => respond(429, { message: 'Too Many Requests' }))
    const client = createLiveClient({ fetchImpl, limits: FAST, sleep: async () => {} })
    await expect(client.sql('select 1')).rejects.toThrow(/HTTP 429/)
    expect(calls).toHaveLength(FAST.max429Retries + 1)
  })

  it('anonieme login: "nog niet klaar" begrensd herhaald, een weigering nooit', async () => {
    const notReady = recordingFetch(() => respond(503, 'starting'))
    const c1 = createLiveClient({ fetchImpl: notReady.fetchImpl, limits: FAST, sleep: async () => {} })
    await expect(c1.signIn()).rejects.toThrow(/HTTP 503/)
    expect(notReady.calls).toHaveLength(FAST.maxSignInAttempts)

    const refused = recordingFetch(() => respond(400, { error: 'Anonymous sign-ins are disabled' }))
    const c2 = createLiveClient({ fetchImpl: refused.fetchImpl, limits: FAST, sleep: async () => {} })
    await expect(c2.signIn()).rejects.toThrow(/HTTP 400/)
    expect(refused.calls).toHaveLength(1)

    const slow = recordingFetch((url, init, n) => (n === 1 ? respond(404, 'not found') : respond(200, { access_token: 't', user_id: uuid(2), is_anonymous: true })))
    const c3 = createLiveClient({ fetchImpl: slow.fetchImpl, limits: FAST, sleep: async () => {} })
    expect((await c3.signIn()).id).toBe(uuid(2))
    expect(c3.users).toEqual([uuid(2)])
  })

  it('verzoeken aan de Edge Function worden nooit herhaald', async () => {
    const { calls, fetchImpl } = recordingFetch(() => respond(500, { ok: false, error: 'server_error' }))
    const client = createLiveClient({ fetchImpl, limits: FAST })
    expect((await client.game('t', { action: 'spin' })).status).toBe(500)
    expect(calls).toHaveLength(1)
  })

  it('afbreken stopt lopende en nieuwe testverzoeken direct', async () => {
    const client = createLiveClient({ fetchImpl: never, limits: { ...FAST, functionTimeoutMs: 10_000 } })
    const pending = client.game('t', { action: 'time' })
    client.abortAll()
    await expect(pending).rejects.toThrow(/afgebroken/)
    await expect(client.game('t', { action: 'time' })).rejects.toThrow(/afgebroken/)
  })
})

// Nagebootste omgeving: echte serverlogica, geheugenopslag, en een teller die
// bijhoudt hoeveel verzoeken (client + database) tegelijk lopen.
function fakeEnv({ hangGame = false, hangCleanup = false, failCleanup = false, unhealthy = false, logStats } = {}) {
  const clock = { t: 1_800_000_000_000 }
  const store = createMemoryStore()
  const tokens = new Map()
  const server = createGameServer({ store, now: () => clock.t })
  const http = createHttpHandler({ server, authenticate: async (t) => tokens.get(t) ?? null, log: () => {} })
  const track = { inFlight: 0, max: 0, calls: [], spinBatchMax: 0 }
  const wrap = (name, fn) => async (...args) => {
    track.inFlight++
    track.max = Math.max(track.max, track.inFlight)
    track.calls.push(name)
    try {
      return await fn(...args)
    } finally {
      track.inFlight--
    }
  }
  let n = 0
  let helper = false
  const deletedUsers = new Set()
  const users = []
  const state = { helperDeployAttempted: false }
  const stats = logStats ?? (() => ({ rpc200: 1, rpc409: 1, rpc5xx: 0, versionConflicts: 1 }))

  const client = {
    ref: EXPECTED_REF,
    users,
    state,
    health: wrap('health', async () => [{ name: 'db', status: 'ACTIVE_HEALTHY' }, { name: 'rest', status: unhealthy ? 'UNHEALTHY' : 'ACTIVE_HEALTHY' }]),
    deployHelper: wrap('deployHelper', async () => {
      state.helperDeployAttempted = true
      helper = true
    }),
    deleteHelper: wrap('deleteHelper', async () => {
      helper = false
    }),
    helperExists: wrap('helperExists', async () => helper),
    signIn: wrap('signIn', async () => {
      n++
      const id = uuid(n)
      const token = `kop${n}.inhoud${n}.handtekening${n}`
      tokens.set(token, id)
      users.push(id)
      return { token, id, isAnonymous: true }
    }),
    game: wrap('game', async (token, body, { auth } = {}) => {
      if (body.action === 'spin') track.spinBatchMax = Math.max(track.spinBatchMax, track.inFlight)
      if (hangGame) return never()
      const authorization = auth === undefined ? `Bearer ${token}` : auth
      const res = await http(new Request('https://x/functions/v1/game', { method: 'POST', headers: authorization ? { Authorization: authorization } : {}, body: JSON.stringify(body) }))
      return { status: res.status, body: await res.json() }
    }),
    logStats: wrap('logStats', async () => stats()),
    abortAll: () => {
      track.aborted = true
    },
  }
  const db = {
    activity: wrap('db.activity', async () => ({ conns: 13, idleTx: 0, rollbacks: 0 })),
    anonUsers: wrap('db.anonUsers', async (ids) => ({ n: ids.length, anon: true })),
    roomStats: wrap('db.roomStats', async (roomId) => {
      const room = store.rooms.get(roomId)
      if (!room) return null
      const d = store.draws.filter((x) => x.room_id === roomId)
      return { version: room.version, draws: d.length, unique_results: new Set(d.map((x) => x.result_id)).size, rows: d.map(({ participant, spun_by, on_behalf }) => ({ participant, spun_by, on_behalf })) }
    }),
    deleteRooms: wrap('db.deleteRooms', async (ids) => {
      if (hangCleanup) return never()
      if (failCleanup) throw new Error('database niet bereikbaar')
      for (const [id, room] of store.rooms) if (ids.includes(room.organizer_id)) store.rooms.delete(id)
    }),
    deleteUsers: wrap('db.deleteUsers', async (ids) => ids.forEach((id) => deletedUsers.add(id))),
    leftovers: wrap('db.leftovers', async (ids) => ({
      rooms: [...store.rooms.values()].filter((r) => ids.includes(r.organizer_id)).length,
      users: ids.filter((id) => !deletedUsers.has(id)).length,
    })),
  }
  const lines = []
  const run = (phase, limits = FAST) =>
    runPhase({ phase, client, db, limits, log: (l) => lines.push(l), now: () => clock.t, sleep: async (ms) => void (clock.t += ms) })
  return { run, track, store, lines, client }
}

describe('live test: fase 5A (basis)', () => {
  it('slaagt, met één SPIN en zonder gelijktijdige verzoeken', async () => {
    const env = fakeEnv()
    const out = await env.run('5a')
    expect(out.results.filter((r) => !r.ok)).toEqual([])
    expect(out.exitCode).toBe(EXIT.ok)
    expect(env.track.max).toBe(1) // nooit twee verzoeken tegelijk
    expect(env.store.draws).toHaveLength(1) // precies één trekking
    expect(env.lines.join('\n')).toContain('Fase 5A')
    expect(env.lines.join('\n')).not.toMatch(/Fase 5B|Fase 5C|gelijktijdige SPIN-verzoeken/)
    expect(env.track.calls).not.toContain('logStats') // geen conflictcontrole: die hoort bij 5B/5C
  })

  it('ruimt altijd op: testkamers, testgebruikers en hulpfunctie', async () => {
    const env = fakeEnv()
    const out = await env.run('5a')
    expect(out.cleanup.every((c) => c.ok)).toBe(true)
    expect(out.cleanup.map((c) => c.name)).toEqual(['testkamers verwijderen', 'anonieme testgebruikers verwijderen (3)', 'hulpfunctie verwijderen', 'controle: niets achtergebleven'])
    expect(env.store.rooms.size).toBe(0)
    expect(await env.client.helperExists()).toBe(false)
  })

  it('voorcontrole mislukt: niets aangemaakt, niets uitgevoerd', async () => {
    const env = fakeEnv({ unhealthy: true })
    const out = await env.run('5a')
    expect(out.exitCode).toBe(EXIT.preflight)
    expect(env.track.calls).toEqual(['health'])
  })

  it('hangende Edge Function: fase stopt op tijdslimiet en ruimt toch op', async () => {
    const env = fakeEnv({ hangGame: true })
    const out = await env.run('5a', { ...FAST, phaseDeadlineMs: { ...FAST.phaseDeadlineMs, '5a': 300 } })
    expect(out.exitCode).toBe(EXIT.timeout)
    expect(env.track.aborted).toBe(true)
    expect(out.cleanup.every((c) => c.ok)).toBe(true)
    expect(env.lines.join('\n')).toMatch(/TIJDSLIMIET OVERSCHREDEN \(exitcode 5\)/)
  })

  it('opruimen dat blijft hangen: eigen tijdslimiet, duidelijk gemeld (exitcode 3)', async () => {
    const env = fakeEnv({ hangCleanup: true })
    const t = Date.now()
    const out = await env.run('5a')
    expect(Date.now() - t).toBeLessThan(5_000)
    expect(out.exitCode).toBe(EXIT.cleanup)
    expect(out.cleanup.find((c) => c.name === 'testkamers verwijderen')).toMatchObject({ ok: false, error: expect.stringMatching(/tijdslimiet/) })
    expect(out.cleanup.find((c) => c.name.startsWith('controle'))).toMatchObject({ ok: false, error: expect.stringMatching(/achtergebleven: 1 kamer/) })
    expect(env.lines.join('\n')).toMatch(/OPRUIMEN ONVOLLEDIG/)
  })

  it('opruimen met fout: gemeld, overige opruimstappen lopen door', async () => {
    const env = fakeEnv({ failCleanup: true })
    const out = await env.run('5a')
    expect(out.exitCode).toBe(EXIT.cleanup)
    expect(out.cleanup.find((c) => c.name === 'hulpfunctie verwijderen').ok).toBe(true)
  })
})

describe('live test: fase 5B en 5C (gelijktijdigheid)', () => {
  it('5B: precies twee gelijktijdige SPIN-verzoeken, één trekking, geslaagd', async () => {
    const env = fakeEnv()
    const out = await env.run('5b')
    expect(out.exitCode).toBe(EXIT.ok)
    expect(env.track.spinBatchMax).toBe(2)
    expect(env.track.calls.filter((c) => c === 'game').length).toBe(3) // kamer maken + 2 SPIN's
    expect(env.store.draws).toHaveLength(1)
    const text = env.lines.join('\n')
    expect(text).toMatch(/client \(Edge Function\): (200:, 409:turn_not_released|409:turn_not_released, 200:)/)
    expect(text).toContain('intern (PostgREST): commit_room_state 200×1, 409 (PT409)×1')
  })

  it('5B: geen intern PT409 opgetreden → geslaagd, maar met waarschuwing "niet aangetoond"', async () => {
    const env = fakeEnv({ logStats: () => ({ rpc200: 1, rpc409: 0, rpc5xx: 0, versionConflicts: 0 }) })
    const out = await env.run('5b')
    expect(out.exitCode).toBe(EXIT.ok)
    expect(out.warnings[0]).toMatch(/niet aangetoond/)
  })

  it('5B: een 5xx van PostgREST op de RPC laat de fase mislukken', async () => {
    const env = fakeEnv({ logStats: () => ({ rpc200: 1, rpc409: 0, rpc5xx: 1, versionConflicts: 0 }) })
    const out = await env.run('5b')
    expect(out.exitCode).toBe(EXIT.failed)
    expect(out.cleanup.every((c) => c.ok)).toBe(true)
  })

  it('5B: oplopende conflicten na afloop (herhaallus) laten de fase mislukken', async () => {
    let k = 0
    const env = fakeEnv({ logStats: () => ({ rpc200: 1, rpc409: ++k, rpc5xx: 0, versionConflicts: k }) })
    const out = await env.run('5b')
    expect(out.exitCode).toBe(EXIT.failed)
    expect(out.results.find((r) => !r.ok).name).toMatch(/herhaallus/)
  })

  it('5C: tien gelijktijdige SPIN-verzoeken, één trekking', async () => {
    const env = fakeEnv()
    const out = await env.run('5c')
    expect(out.exitCode).toBe(EXIT.ok)
    expect(env.track.spinBatchMax).toBe(10)
    expect(env.store.draws).toHaveLength(1)
  })
})
