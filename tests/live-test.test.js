// Lokale tests van het live-testscript (zonder netwerk): fasekeuze, project-
// bewaking, tijdslimieten, begrensde herhalingen, opruimen en eindstatus.
// De fasen draaien tegen de echte serverlogica met een geheugenopslag.
import { describe, expect, it } from 'vitest'
import { createGameServer } from '../src/server/actions.js'
import { createHttpHandler } from '../src/server/http.js'
import { BIDS_5D, EXIT, EXPECTED_REF, LIMITS, LOG_PATTERNS, SETUP_5D, UsageError, countLogLines, createLiveClient, fetchWithTimeout, logStatsSql, parseArgs, runPhase } from '../scripts/live-test.mjs'
import { StoreConflict } from '../src/server/actions.js'
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
  phaseDeadlineMs: { '5a': 2_000, '5b': 2_000, '5c': 2_000, '5d': 5_000 },
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
    expect(parseArgs(['5d'])).toEqual({ phase: '5d', ref: EXPECTED_REF })
    for (const argv of [[], ['5e'], ['5a', '5b'], ['5a', '5d'], ['alles'], ['--bevestig']]) {
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
function fakeEnv({ hangGame = false, hangCleanup = false, failCleanup = false, unhealthy = false, logStats, liveStats = false, realtime = {}, tamper } = {}) {
  const clock = { t: 1_800_000_000_000 }
  const store = createMemoryStore()
  // Wat PostgREST zou loggen: geslaagde commits (200) en versieconflicten (PT409).
  const rpc = { ok: 0, conflict: 0 }
  const commitState = store.commitState
  store.commitState = async (...args) => {
    try {
      const v = await commitState(...args)
      rpc.ok++
      return v
    } catch (e) {
      if (e instanceof StoreConflict && e.message === 'version') rpc.conflict++
      throw e
    }
  }
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
  const stats =
    logStats ??
    (liveStats
      ? () => ({ rpcAll: rpc.ok + rpc.conflict, rpc200: rpc.ok, rpc409: rpc.conflict, rpc5xx: 0, versionConflicts: rpc.conflict })
      : () => ({ rpcAll: 2, rpc200: 1, rpc409: 1, rpc5xx: 0, versionConflicts: 1 }))
  // Realtime nabootsen zoals de database het doorlaat: alleen leden van de
  // kamer (organisator of deelnemer in de status) krijgen het signaal (RLS).
  const listens = []
  const listenOne = (token, roomId, { untilVersion, waitMs }) => {
    const userId = tokens.get(token)
    const out = { pulses: [], statuses: ['SUBSCRIBED'], readyVia: 'system', reason: null, errors: [] }
    listens.push({ userId, roomId, waitMs, out })
    let resolve
    const done = new Promise((r) => (resolve = r))
    const finish = (reason) => {
      if (out.reason) return
      out.reason = reason
      off()
      resolve(out)
    }
    const off = store.onPulse((id, version) => {
      if (id !== roomId || realtime.drop) return
      const room = store.rooms.get(id)
      const member = room.organizer_id === userId || room.state.players?.some((p) => p.userId === userId)
      if (!member && !realtime.leak) return
      out.pulses.push(version)
      if (realtime.double) out.pulses.push(version)
      if (untilVersion != null && version >= untilVersion) finish('version')
    })
    setTimeout(() => finish('timeout'), 30)
    return done
  }
  // Zoals de hulpfunctie: één verzoek, per luisteraar een eigen verbinding.
  const listen = (roomId, listeners, { untilVersion }) => {
    const all = listeners.map((l) => listenOne(l.token, roomId, { untilVersion, waitMs: l.waitMs }))
    const done = Promise.all(all).then((outs) => Object.fromEntries(listeners.map((l, i) => [l.id, outs[i]])))
    return { ready: Promise.resolve(['system']), done }
  }

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
      const out = { status: res.status, body: await res.json() }
      return tamper ? tamper(body, out, tokens.get(token)) : out
    }),
    listen: (...args) => {
      track.calls.push('listen')
      return listen(...args)
    },
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
    drawRows: wrap('db.drawRows', async (roomId) =>
      store.draws
        .filter((x) => x.room_id === roomId)
        .map(({ participant, round, result_id, bid_cents, spun_by, on_behalf, spin_id }) => ({ participant, round, result_id, bid_cents, spun_by, on_behalf, spin_id })),
    ),
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
  return { run, track, store, lines, client, listens, rpc }
}

describe('live test: fase 5A (basis)', () => {
  it('slaagt, met één SPIN en zonder gelijktijdige verzoeken', async () => {
    const env = fakeEnv()
    const out = await env.run('5a')
    expect(out.results.filter((r) => !r.ok)).toEqual([])
    expect(out.exitCode).toBe(EXIT.ok)
    expect(env.track.max).toBe(1) // nooit twee verzoeken tegelijk
    expect(env.store.draws).toHaveLength(2) // één eigen SPIN + één expliciet namens
    expect(env.store.draws.map((d) => d.on_behalf)).toEqual([false, true])
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
    // kamer, start, tweede start (geweigerd), SPIN tijdens animatie (geweigerd), 2 gelijktijdige SPIN's
    expect(env.track.calls.filter((c) => c === 'game').length).toBe(6) // kamer maken + 2 SPIN's
    expect(env.store.draws).toHaveLength(1)
    const text = env.lines.join('\n')
    expect(text).toMatch(/client \(Edge Function\): (200:, 409:(spin_in_progress|turn_not_released)|409:(spin_in_progress|turn_not_released), 200:)/)
    expect(text).toContain('intern (PostgREST): commit_room_state 200×1, 409 (PT409)×1')
  })

  it('5B: geen intern PT409 opgetreden → geslaagd, maar met waarschuwing "niet aangetoond"', async () => {
    const env = fakeEnv({ logStats: () => ({ rpcAll: 1, rpc200: 1, rpc409: 0, rpc5xx: 0, versionConflicts: 0 }) })
    const out = await env.run('5b')
    expect(out.exitCode).toBe(EXIT.ok)
    expect(out.warnings[0]).toMatch(/niet aangetoond/)
  })

  it('5B: een 5xx van PostgREST op de RPC laat de fase mislukken', async () => {
    const env = fakeEnv({ logStats: () => ({ rpcAll: 2, rpc200: 1, rpc409: 0, rpc5xx: 1, versionConflicts: 0 }) })
    const out = await env.run('5b')
    expect(out.exitCode).toBe(EXIT.failed)
    expect(out.cleanup.every((c) => c.ok)).toBe(true)
  })

  it('5B: oplopende conflicten na afloop (herhaallus) laten de fase mislukken', async () => {
    let k = 0
    const env = fakeEnv({ logStats: () => (++k, { rpcAll: 1 + k, rpc200: 1, rpc409: k, rpc5xx: 0, versionConflicts: k }) })
    const out = await env.run('5b')
    expect(out.exitCode).toBe(EXIT.failed)
    expect(out.results.find((r) => !r.ok).name).toMatch(/herhaallus/)
  })

  it('5B: RPC met een andere status dan 200/409 (bijv. 404) laat de fase mislukken', async () => {
    const env = fakeEnv({ logStats: () => ({ rpcAll: 3, rpc200: 1, rpc409: 1, rpc5xx: 0, versionConflicts: 1 }) })
    const out = await env.run('5b')
    expect(out.exitCode).toBe(EXIT.failed)
    expect(out.results.find((r) => !r.ok).error).toMatch(/andere status/)
  })

  it('5B: meer PT409 dan begrensde herhalingen toestaan laat de fase mislukken', async () => {
    const env = fakeEnv({ logStats: () => ({ rpcAll: 5, rpc200: 1, rpc409: 4, rpc5xx: 0, versionConflicts: 4 }) })
    const out = await env.run('5b') // n = 2: hoogstens 3 conflicten mogelijk
    expect(out.exitCode).toBe(EXIT.failed)
    expect(out.results.find((r) => !r.ok).error).toMatch(/begrensd/)
  })

  it('5B: version_conflict in de database wijkt af van RPC 409 → mislukt', async () => {
    const env = fakeEnv({ logStats: () => ({ rpcAll: 2, rpc200: 1, rpc409: 1, rpc5xx: 0, versionConflicts: 3 }) })
    const out = await env.run('5b')
    expect(out.exitCode).toBe(EXIT.failed)
    expect(out.results.find((r) => !r.ok).error).toMatch(/version_conflict \(3\) ≠ RPC 409 \(1\)/)
  })

  it('5C: tien gelijktijdige SPIN-verzoeken, één trekking', async () => {
    const env = fakeEnv()
    const out = await env.run('5c')
    expect(out.exitCode).toBe(EXIT.ok)
    expect(env.track.spinBatchMax).toBe(10)
    expect(env.store.draws).toHaveLength(1)
  })
})

describe('live test: fase 5D (volledig spel, 3 toestellen)', () => {
  it('slaagt: gelijktijdig deelnemer + organisator, Realtime, veilingen, bedragen, eindstand', async () => {
    const env = fakeEnv({ liveStats: true })
    const out = await env.run('5d')
    expect(out.results.filter((r) => !r.ok)).toEqual([])
    expect(out.exitCode).toBe(EXIT.ok)
    expect(out.cleanup.every((c) => c.ok)).toBe(true)
    expect(env.store.rooms.size).toBe(0)
    const text = env.lines.join('\n')
    expect(text).toContain('Fase 5D')
    // 4 onafhankelijke identiteiten: organisator, A, B, buitenstaander
    expect(new Set(env.listens.map((l) => l.userId)).size).toBe(4)
    expect(text).toMatch(/anonieme testgebruikers verwijderen \(4\)/)
    // twee keer deelnemer en organisator tegelijk → telkens precies één
    expect(text.match(/gewonnen door/g)).toHaveLength(2)
    expect(env.rpc.conflict).toBeGreaterThan(0) // de gelijktijdige verzoeken botsten echt
    expect(text).toMatch(/versieconflicten \(bedoeld, gelijktijdige SPIN\): PT409×[1-6]/)
    expect(text).toMatch(/Realtime \(start\): organisator: versie \d+, A: versie \d+, B: versie \d+, buitenstaander: niets/)
    expect(text).toContain('totaal: Organisator 500, Deelnemer A 1734, Deelnemer B 4000 · pot 6234 cent')
  })

  it('database na afloop van het spel (vóór opruimen): 6 vaste trekkingen, 2 veilingen, biedingen bij de juiste winnaar', async () => {
    let snapshot
    const env = fakeEnv({ liveStats: true })
    const origDelete = env.store.rooms.delete.bind(env.store.rooms)
    env.store.rooms.delete = (id) => {
      snapshot ??= env.store.draws.filter((d) => d.room_id === id).map((d) => ({ ...d }))
      return origDelete(id)
    }
    expect((await env.run('5d')).exitCode).toBe(EXIT.ok)
    expect(snapshot).toHaveLength(8)
    expect(snapshot.filter((d) => d.round !== 'veiling').every((d) => d.bid_cents === null)).toBe(true)
    expect(snapshot.filter((d) => d.round === 'veiling').map((d) => d.bid_cents)).toEqual(BIDS_5D.map((b) => b.bidCents))
    expect(snapshot.filter((d) => d.round === 'veiling').map((d) => d.on_behalf)).toEqual([false, true])
    expect(SETUP_5D.draft.priceCents).toBeGreaterThan(0)
    expect(SETUP_5D.draft.rounds).toBeGreaterThanOrEqual(2)
  })

  it('herhaalbaar: twee runs na elkaar slagen, telkens alles opgeruimd', async () => {
    for (let i = 0; i < 2; i++) {
      const env = fakeEnv({ liveStats: true })
      expect((await env.run('5d')).exitCode).toBe(EXIT.ok)
      expect(env.store.rooms.size).toBe(0)
    }
  })

  it('mislukt als een lid het Realtime-signaal niet ontvangt', async () => {
    const env = fakeEnv({ liveStats: true, realtime: { drop: true } })
    const out = await env.run('5d')
    expect(out.exitCode).toBe(EXIT.failed)
    expect(out.results.find((r) => !r.ok).error).toMatch(/Realtime organisator ontving niet precies versie/)
    expect(out.cleanup.every((c) => c.ok)).toBe(true)
  })

  it('mislukt als een lid een signaal dubbel ontvangt', async () => {
    const env = fakeEnv({ liveStats: true, realtime: { double: true } })
    const out = await env.run('5d')
    expect(out.exitCode).toBe(EXIT.failed)
    expect(out.results.find((r) => !r.ok).error).toMatch(/ontving niet precies versie/)
  })

  it('mislukt als een buitenstaander een Realtime-signaal ontvangt (RLS-lek)', async () => {
    const env = fakeEnv({ liveStats: true, realtime: { leak: true } })
    const out = await env.run('5d')
    expect(out.exitCode).toBe(EXIT.failed)
    expect(out.results.find((r) => !r.ok).error).toMatch(/buitenstaander ontving een signaal/)
  })

  it('mislukt als een toestel een andere stand ziet', async () => {
    // Toestel B (derde identiteit) krijgt één keer een stand zonder trekkingen.
    let done = false
    const env = fakeEnv({
      liveStats: true,
      tamper: (body, out, userId) => {
        if (!done && userId === uuid(3) && body.action === 'get_room' && out.body?.room?.state?.draws.length) {
          done = true
          out.body.room.state.draws = []
          out.body.room.state.lastSpin = null
        }
        return out
      },
    })
    const out = await env.run('5d')
    expect(out.exitCode).toBe(EXIT.failed)
    expect(out.results.find((r) => !r.ok).error).toMatch(/ziet iets anders dan/)
  })

  it('mislukt als beide gelijktijdige SPIN-verzoeken slagen (dubbele trekking)', async () => {
    const env = fakeEnv({
      liveStats: true,
      tamper: (body, out) => (body.action === 'spin' && body.onBehalf && out.status === 409 ? { status: 200, body: out.body } : out),
    })
    const out = await env.run('5d')
    expect(out.exitCode).toBe(EXIT.failed)
    expect(out.results.find((r) => !r.ok).error).toMatch(/organisator: 200/)
  })

  it('mislukt bij een 5xx op de RPC in de logs', async () => {
    const env = fakeEnv({ logStats: () => ({ rpcAll: 99, rpc200: 98, rpc409: 0, rpc5xx: 1, versionConflicts: 0 }) })
    const out = await env.run('5d')
    expect(out.exitCode).toBe(EXIT.failed)
    expect(out.results.find((r) => !r.ok).name).toMatch(/^logs:/)
  })
})

describe('live test: Realtime-luisteraar (antwoord van de hulpfunctie)', () => {
  const stream = (lines, { delayMs = 0 } = {}) =>
    new ReadableStream({
      async start(c) {
        for (const l of lines) {
          c.enqueue(new TextEncoder().encode(JSON.stringify(l) + '\n'))
          if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
        }
        c.close()
      },
    })
  const L = [
    { id: 'organisator', token: 't1', waitMs: 1_000 },
    { id: 'buitenstaander', token: 't2', waitMs: 1_000 },
  ]

  it('één verzoek voor alle luisteraars; ready pas als iedereen actief is; signalen per luisteraar', async () => {
    const lines = [
      { type: 'status', id: 'organisator', status: 'SUBSCRIBED' },
      { type: 'ready', id: 'organisator', via: 'system' },
      { type: 'status', id: 'buitenstaander', status: 'SUBSCRIBED' },
      { type: 'ready', id: 'buitenstaander', via: 'system' },
      { type: 'pulse', id: 'organisator', version: 7 },
      { type: 'end', id: 'organisator', reason: 'version' },
      { type: 'end', id: 'buitenstaander', reason: 'timeout' },
    ]
    const { calls, fetchImpl } = recordingFetch(() => Promise.resolve(new Response(stream(lines, { delayMs: 5 }), { status: 200 })))
    const client = createLiveClient({ fetchImpl, limits: { ...FAST, functionTimeoutMs: 1_000 } })
    const l = client.listen('kamer', L, { untilVersion: 7 })
    expect(await l.ready).toEqual(['system'])
    const outs = await l.done
    expect(outs.organisator).toEqual({ pulses: [7], statuses: ['SUBSCRIBED'], readyVia: 'system', reason: 'version', errors: [] })
    expect(outs.buitenstaander).toMatchObject({ pulses: [], reason: 'timeout' })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`https://${EXPECTED_REF}.supabase.co/functions/v1/fsm-testlogin?mode=listen`)
  })

  it('503 bij het starten: begrensd opnieuw geprobeerd, met de foutmelding van het platform', async () => {
    const { calls, fetchImpl } = recordingFetch(() => respond(503, { code: 'WORKER_LIMIT', message: 'No more workers' }))
    const client = createLiveClient({ fetchImpl, limits: FAST, sleep: async () => {} })
    const l = client.listen('kamer', L, {})
    await expect(l.done).rejects.toThrow(/HTTP 503 .*WORKER_LIMIT/)
    expect(calls).toHaveLength(FAST.listenRetries)
    expect(client.retries).toHaveLength(FAST.listenRetries - 1)
    const ok = recordingFetch((url, init, n) => (n === 1 ? respond(503, 'bezet') : Promise.resolve(new Response(stream([{ type: 'ready', id: 'organisator', via: 'system' }, { type: 'end', id: 'organisator', reason: 'timeout' }]), { status: 200 }))))
    const c2 = createLiveClient({ fetchImpl: ok.fetchImpl, limits: FAST, sleep: async () => {} })
    const l2 = c2.listen('kamer', [L[0]], {})
    expect(await l2.ready).toEqual(['system'])
    expect(ok.calls).toHaveLength(2)
  })

  it('geen abonnement voor een luisteraar: ready wordt geweigerd', async () => {
    const lines = [{ type: 'ready', id: 'organisator', via: 'system' }, { type: 'status', id: 'buitenstaander', status: 'CHANNEL_ERROR' }, { type: 'end', id: 'buitenstaander', reason: 'CHANNEL_ERROR' }, { type: 'end', id: 'organisator', reason: 'timeout' }]
    const client = createLiveClient({ fetchImpl: () => Promise.resolve(new Response(stream(lines), { status: 200 })), limits: FAST })
    const l = client.listen('kamer', L, {})
    await expect(l.ready).rejects.toThrow(/niet alle abonnementen actief/)
    expect((await l.done).buitenstaander.reason).toBe('CHANNEL_ERROR')
    const c2 = createLiveClient({ fetchImpl: () => Promise.resolve(new Response('nee', { status: 404 })), limits: FAST })
    await expect(c2.listen('kamer', L, {}).ready).rejects.toThrow(/HTTP 404/)
  })

  it('luisteraar die blijft hangen: afgebroken na de tijdslimiet', async () => {
    const hang = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('abort'))))
    const client = createLiveClient({ fetchImpl: hang, limits: { ...FAST, functionTimeoutMs: 50, signInRetryDelayMs: 0 } })
    const l = client.listen('kamer', [{ id: 'x', token: 't', waitMs: 50 }], {})
    await expect(l.done).rejects.toThrow(/tijdslimiet/)
  })
})

// Representatieve regels zoals Supabase ze logt (formaat uit de echte 5A-logs).
const BASE = `https://${EXPECTED_REF}.supabase.co`
const DENO = '| Deno/2.1.4 (variant; SupabaseEdgeRuntime/1.77.8; ref=twzjsmxydnfmowrmffsl)'
const line = (method, status, path) => `${method} | ${status} | ${BASE}${path} ${DENO}`

describe('live test: logtellingen voor 5B/5C', () => {
  it('telt een geldige 200, een geldige 409 en een echte 500 en 504 op de RPC', () => {
    const c = countLogLines([
      line('POST', 200, '/rest/v1/rpc/commit_room_state'),
      line('POST', 409, '/rest/v1/rpc/commit_room_state'),
      line('POST', 500, '/rest/v1/rpc/commit_room_state'),
      line('POST', 504, '/rest/v1/rpc/commit_room_state'),
    ])
    expect(c).toEqual({ rpcAll: 4, rpc200: 1, rpc409: 1, rpc5xx: 2, versionConflicts: 0 })
  })

  it('telt geen regels die geen RPC-verzoek zijn (ook niet met status 5xx)', () => {
    const c = countLogLines([
      `POST | 500 | ${BASE}/functions/v1/game`,
      `POST | 409 | ${BASE}/functions/v1/game`,
      `POST | 200 | ${BASE}/functions/v1/fsm-testlogin`,
      line('POST', 201, '/rest/v1/seats'),
      line('POST', 409, '/rest/v1/seats'),
      line('GET', 200, '/rest/v1/rooms?select=id%2Ccode&id=eq.5009a3b2'),
      line('POST', 200, '/auth/v1/signup'),
      `GET | 521 | ${BASE}/rest-admin/v1/ready | @supabase-infra/mgmt-api/v1.639.2`,
      '{"component":"api","duration":21963196,"error":"token is malformed","level":"warning","msg":"request completed","path":"/user","status":500}',
      'Schema cache loaded in 12.7 milliseconds',
    ])
    expect(c).toEqual({ rpcAll: 0, rpc200: 0, rpc409: 0, rpc5xx: 0, versionConflicts: 0 })
  })

  it('laat zich niet misleiden door vergelijkbare cijfers of namen', () => {
    const c = countLogLines([
      line('POST', 200, '/rest/v1/rooms?select=id&code=eq.500409'), // 500/409 in de inhoud
      line('POST', 201, '/rest/v1/rooms?commit_room_state=500'),
      line('POST', 409, '/rest/v1/rpc/commit_room_state_old'), // andere functie
      line('POST', 409, '/rest/v1/rpc/commit_room_states'),
      `POST | 4091 | ${BASE}/rest/v1/rpc/commit_room_state ${DENO}`, // geen 3-cijferige status
      `XPOST | 500 | ${BASE}/rest/v1/rpc/commit_room_state ${DENO}`,
      ` POST | 500 | ${BASE}/rest/v1/rpc/commit_room_state ${DENO}`, // niet aan het begin
      `POST | 500 | https://evil.example/rest/v1/rpc/commit_room_state ${DENO}`, // ander domein
      '127.0.0.1 - service_role [30/Oct/2026:08:53:22 +0000] "POST /rpc/commit_room_state HTTP/1.1" 504 111 "" "Deno/2.1.4"', // PostgREST-eigen log, telt niet dubbel
    ])
    expect(c).toEqual({ rpcAll: 0, rpc200: 0, rpc409: 0, rpc5xx: 0, versionConflicts: 0 })
  })

  it('RPC met querystring of aan het einde van de regel telt wel', () => {
    const c = countLogLines([
      `POST | 200 | ${BASE}/rest/v1/rpc/commit_room_state?select=*`,
      `POST | 409 | ${BASE}/rest/v1/rpc/commit_room_state`,
    ])
    expect(c).toMatchObject({ rpcAll: 2, rpc200: 1, rpc409: 1 })
  })

  it('version_conflict: alleen het exacte databasebericht telt', () => {
    const c = countLogLines(['version_conflict', 'version_conflict', 'ERROR: version_conflict', 'version_conflicts', 'Version_conflict'])
    expect(c.versionConflicts).toBe(2)
  })

  it('patronen zonder backslashes: Supabase-log-SQL kan ze niet verminken', () => {
    for (const p of Object.values(LOG_PATTERNS)) {
      expect(p).not.toMatch(/[\\']/)
      expect(p.replace(/\\/g, '')).toBe(p)
    }
    expect(logStatsSql()).not.toContain('\\')
    expect(logStatsSql()).toContain("countIf(event_message = 'version_conflict') as versionConflicts")
  })

  it('regressie: het oude 5xx-patroon zonder backslashes telde elke POST-regel', () => {
    const oud = new RegExp('^POST | 5[0-9][0-9] | .*/rest/v1/rpc/commit_room_state') // zoals Supabase het uitvoerde
    const regels = [`POST | 200 | ${BASE}/functions/v1/game`, line('POST', 201, '/rest/v1/seats'), line('POST', 200, '/rest/v1/rpc/commit_room_state')]
    expect(regels.filter((r) => oud.test(r))).toHaveLength(3) // de fout
    expect(countLogLines(regels).rpc5xx).toBe(0) // gecorrigeerd
  })
})
