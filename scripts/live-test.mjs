#!/usr/bin/env node
// Live test van de uitgerolde Edge Function 'game' met echte anonieme
// Supabase-logins, in drie afzonderlijke fasen. Elke fase moet expliciet
// gestart worden; een fase start nooit een andere.
//
//   npm run fn:test:5a                 basis: login, kamer, namen, één SPIN, herstel
//   npm run fn:test:5b                 2 gelijktijdige SPIN's (PT409 via PostgREST)
//   npm run fn:test:5c -- --bevestig   10 gelijktijdige SPIN's (alleen na akkoord)
//
// Werkwijze per fase:
// 1. Vooraf: juiste project, alle diensten gezond, geen hangende transacties.
// 2. Tijdelijke hulpfunctie 'fsm-testlogin' doet `signInAnonymously()` met de
//    publieke sleutel uit de eigen functie-omgeving; dit script ziet nooit een
//    API-sleutel. De hulpfunctie antwoordt alleen op een eenmalige code.
// 3. Stappen lopen na elkaar; bij de eerste fout stopt de fase.
// 4. Opruimen (testkamers, testgebruikers, hulpfunctie) draait altijd, met een
//    eigen tijdslimiet, en wordt gecontroleerd.
//
// Veiligheid: elk verzoek heeft een tijdslimiet, elke herhaling is begrensd,
// elke fase heeft een totale tijdslimiet, en een fase wordt nooit automatisch
// opnieuw gestart. Alleen project twzjsmxydnfmowrmffsl is toegestaan.
//
// Eindstatus (exitcode): 0 geslaagd · 1 test mislukt · 2 verkeerd gestart of
// verkeerd project · 3 opruimen onvolledig · 4 voorcontrole mislukt (niets
// aangemaakt) · 5 tijdslimiet van de fase overschreden.

import { randomBytes } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { estimateOffset } from '../src/game/clock.js'
import { releaseDelay } from '../src/game/timeline.js'
import { deriveView } from '../src/game/view.js'

export const EXPECTED_REF = 'twzjsmxydnfmowrmffsl'
export const HELPER = 'fsm-testlogin'

export const EXIT = { ok: 0, failed: 1, usage: 2, cleanup: 3, preflight: 4, timeout: 5 }

export const LIMITS = {
  mgmtTimeoutMs: 30_000, // elk verzoek aan de beheer-API
  functionTimeoutMs: 20_000, // elk verzoek aan een Edge Function
  max429Retries: 5, // beheer-API zegt "te veel verzoeken"
  maxSignInAttempts: 6, // net uitgerolde hulpfunctie kan even 404/503 geven
  signInRetryDelayMs: 2_000,
  phaseDeadlineMs: { '5a': 240_000, '5b': 180_000, '5c': 180_000 },
  cleanupStepTimeoutMs: 30_000,
  cleanupDeadlineMs: 120_000,
  logPolls: 6, // logs komen met vertraging binnen
  logPollIntervalMs: 5_000,
  loopCheckDelayMs: 10_000, // daarna mag het aantal conflicten niet meer stijgen
  maxReleaseWaitMs: 15_000,
  maxExtraRollbacks: 50,
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ---------------------------------------------------------------------------
// Logtellingen (fase 5B/5C)
// ---------------------------------------------------------------------------
// De API-gateway logt elk verzoek van de Edge Function aan PostgREST als
//   POST | 409 | https://<ref>.supabase.co/rest/v1/rpc/commit_room_state | Deno/…
// en Postgres logt elk PT409-conflict als bericht 'version_conflict'.
//
// Let op: de log-SQL van Supabase verwijdert backslashes uit tekst. Een
// patroon met '\|' wordt dan '|' (regex-alternatief) en telt elke POST-regel
// mee (zo telde 5xx er eerder 29 in plaats van 0). Daarom bevatten deze
// patronen geen backslashes: '[|]' en '[.]' zijn letterlijke tekens.
const RPC_URL = 'https://[^ ]+[.]supabase[.]co/rest/v1/rpc/commit_room_state( |[?]|$)'
export const LOG_PATTERNS = {
  rpcAll: `^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS) [|] [0-9][0-9][0-9] [|] ${RPC_URL}`, // elke RPC-aanroep, elke status
  rpc200: `^POST [|] 200 [|] ${RPC_URL}`,
  rpc409: `^POST [|] 409 [|] ${RPC_URL}`, // PT409 → HTTP 409
  rpc5xx: `^POST [|] 5[0-9][0-9] [|] ${RPC_URL}`,
}
export const VERSION_CONFLICT_MESSAGE = 'version_conflict'

export function logStatsSql() {
  const counts = Object.entries(LOG_PATTERNS).map(([name, pattern]) => {
    if (/['\\]/.test(pattern)) throw new Error(`logpatroon ${name} mag geen quote of backslash bevatten`)
    return `countIf(match(event_message, '${pattern}')) as ${name}`
  })
  return `select ${counts.join(', ')}, countIf(event_message = '${VERSION_CONFLICT_MESSAGE}') as versionConflicts from logs`
}

// Dezelfde telling in JavaScript, voor de lokale tests. De patronen gebruiken
// alleen tekenklassen, ankers, groepen en alternatieven: die werken in RE2
// (ClickHouse) en JavaScript gelijk.
export function countLogLines(messages) {
  const res = Object.fromEntries(Object.entries(LOG_PATTERNS).map(([k, p]) => [k, new RegExp(p)]))
  const out = { rpcAll: 0, rpc200: 0, rpc409: 0, rpc5xx: 0, versionConflicts: 0 }
  for (const m of messages) {
    for (const [k, re] of Object.entries(res)) if (re.test(m)) out[k]++
    if (m === VERSION_CONFLICT_MESSAGE) out.versionConflicts++
  }
  return out
}

export class UsageError extends Error {}
export class TimeoutError extends Error {}

// ---------------------------------------------------------------------------
// Start: welke fase, welk project
// ---------------------------------------------------------------------------
export function parseArgs(argv, env = {}) {
  const ref = env.SUPABASE_PROJECT_REF || EXPECTED_REF
  if (ref !== EXPECTED_REF) throw new UsageError(`alleen project ${EXPECTED_REF} is toegestaan, niet ${ref}`)
  const args = argv.filter((a) => a !== '--bevestig')
  const confirmed = argv.includes('--bevestig')
  if (args.length !== 1 || !['5a', '5b', '5c'].includes(args[0])) {
    throw new UsageError('gebruik: node scripts/live-test.mjs 5a | 5b | 5c --bevestig  (precies één fase)')
  }
  const phase = args[0]
  if (phase === '5c' && !confirmed) throw new UsageError('fase 5c draait alleen met --bevestig (na afzonderlijke toestemming)')
  return { phase, ref }
}

// ---------------------------------------------------------------------------
// Tijdslimieten
// ---------------------------------------------------------------------------
export function withDeadline(promise, ms, label) {
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`${label}: tijdslimiet van ${ms} ms overschreden`)), ms)
  })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}

// Eén verzoek met harde tijdslimiet voor het hele verzoek, inclusief het
// lezen van het antwoord; ook als de onderliggende fetch het afbreeksignaal
// negeert. `parent` kan alle lopende verzoeken tegelijk afbreken.
export async function fetchWithTimeout(fetchImpl, url, init, ms, parent) {
  if (parent?.aborted) throw new Error('afgebroken')
  const controller = new AbortController()
  const onAbort = () => controller.abort(parent.reason)
  parent?.addEventListener('abort', onAbort, { once: true })
  const aborted = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('afgebroken')), { once: true }))
  const request = (async () => {
    const res = await fetchImpl(url, { ...init, signal: controller.signal })
    return { status: res.status, ok: res.ok, text: await res.text() }
  })()
  try {
    return await withDeadline(Promise.race([request, aborted]), ms, `${init?.method ?? 'GET'} ${new URL(url).pathname}`)
  } catch (e) {
    controller.abort()
    throw e
  } finally {
    parent?.removeEventListener('abort', onAbort)
  }
}

const parseJson = (text) => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// Verbindingen: beheer-API, hulpfunctie, Edge Function 'game'
// ---------------------------------------------------------------------------
export function createLiveClient({ fetchImpl = fetch, ref = EXPECTED_REF, limits = LIMITS, sleep = defaultSleep, accessToken } = {}) {
  if (ref !== EXPECTED_REF) throw new UsageError(`alleen project ${EXPECTED_REF} is toegestaan`)
  const api = `https://api.supabase.com/v1/projects/${ref}`
  const functions = `https://${ref}.supabase.co/functions/v1`
  const nonce = randomBytes(24).toString('hex')
  const phaseAbort = new AbortController() // breekt testverzoeken af, niet het opruimen
  const users = []
  const state = { helperDeployAttempted: false }

  const mgmtHeaders = (extra = {}) => (accessToken ? { ...extra, Authorization: `Bearer ${accessToken}` } : extra)

  async function mgmt(method, route, { body, form, headers } = {}) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetchWithTimeout(
        fetchImpl,
        api + route,
        { method, headers: mgmtHeaders(headers), body: form ?? (body ? JSON.stringify(body) : undefined) },
        limits.mgmtTimeoutMs,
      )
      if (res.status === 429 && attempt < limits.max429Retries) {
        await sleep(2_000 * (attempt + 1))
        continue
      }
      const data = parseJson(res.text) ?? res.text
      if (!res.ok) throw new Error(`${method} ${route.split('?')[0]} → HTTP ${res.status}: ${data?.message ?? String(data).slice(0, 200)}`)
      return data
    }
  }

  const helperSource = `
import { createClient } from 'npm:@supabase/supabase-js@2.118.0'
const NONCE = '${nonce}'
Deno.serve(async (req) => {
  if (req.method !== 'POST' || req.headers.get('x-test-nonce') !== NONCE) return new Response('not found', { status: 404 })
  const sb = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_ANON_KEY'), { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await sb.auth.signInAnonymously()
  if (error) return Response.json({ error: error.message, code: error.code ?? null }, { status: 400 })
  return Response.json({ access_token: data.session.access_token, user_id: data.user.id, is_anonymous: data.user.is_anonymous })
})
`

  return {
    ref,
    users,
    state,
    sql: (query) => mgmt('POST', '/database/query', { body: { query }, headers: { 'Content-Type': 'application/json' } }),
    health: () => mgmt('GET', '/health?services=db&services=rest&services=auth&services=realtime'),
    async deployHelper() {
      state.helperDeployAttempted = true
      const form = new FormData()
      form.append('metadata', JSON.stringify({ name: HELPER, entrypoint_path: 'index.ts', verify_jwt: false }))
      form.append('file', new Blob([helperSource]), 'index.ts')
      await mgmt('POST', `/functions/deploy?slug=${HELPER}`, { form })
    },
    async deleteHelper() {
      try {
        await mgmt('DELETE', `/functions/${HELPER}`)
      } catch (e) {
        if (!/HTTP 404/.test(e.message)) throw e
      }
    },
    async helperExists() {
      const list = await mgmt('GET', '/functions')
      return list.some((f) => f.slug === HELPER)
    },
    // Tellingen uit de logs tussen `sinceIso` en `untilIso` (standaard nu):
    // wat PostgREST met de RPC deed en hoeveel PT409-conflicten Postgres meldde.
    async logStats(sinceIso, untilIso = new Date(Date.now() + 60_000).toISOString()) {
      const data = await mgmt('GET', `/analytics/endpoints/logs?sql=${encodeURIComponent(logStatsSql())}&iso_timestamp_start=${sinceIso}&iso_timestamp_end=${untilIso}`)
      if (data?.error || !data?.result?.[0]) throw new Error(`logs niet beschikbaar: ${JSON.stringify(data?.error ?? data).slice(0, 200)}`)
      const r = data.result[0]
      const out = {}
      for (const k of ['rpcAll', 'rpc200', 'rpc409', 'rpc5xx', 'versionConflicts']) {
        out[k] = Number(r[k])
        if (!Number.isInteger(out[k])) throw new Error(`logtelling ${k} ontbreekt: ${JSON.stringify(r)}`)
      }
      return out
    },
    async signIn() {
      for (let attempt = 1; ; attempt++) {
        const res = await fetchWithTimeout(
          fetchImpl,
          `${functions}/${HELPER}`,
          { method: 'POST', headers: { 'x-test-nonce': nonce } },
          limits.functionTimeoutMs,
          phaseAbort.signal,
        )
        // Alleen "nog niet klaar" (404/503) opnieuw; een echte weigering niet.
        if ((res.status === 404 || res.status === 503) && attempt < limits.maxSignInAttempts) {
          await sleep(limits.signInRetryDelayMs)
          continue
        }
        const data = parseJson(res.text) ?? {}
        if (!res.ok) throw new Error(`anonieme login mislukt: HTTP ${res.status} ${data.error ?? ''} ${data.code ?? ''}`.trim())
        if (!UUID_RE.test(data.user_id ?? '')) throw new Error('anonieme login gaf geen geldig gebruikers-id')
        users.push(data.user_id)
        return { token: data.access_token, id: data.user_id, isAnonymous: data.is_anonymous }
      }
    },
    // Eén verzoek aan 'game', nooit herhaald. `auth`: null = geen header.
    async game(token, body, { auth } = {}) {
      const headers = { 'Content-Type': 'application/json' }
      const authorization = auth === undefined ? `Bearer ${token}` : auth
      if (authorization) headers.Authorization = authorization
      const res = await fetchWithTimeout(
        fetchImpl,
        `${functions}/game`,
        { method: 'POST', headers, body: JSON.stringify(body) },
        limits.functionTimeoutMs,
        phaseAbort.signal,
      )
      return { status: res.status, body: parseJson(res.text) }
    },
    abortAll(reason = 'fase afgebroken') {
      phaseAbort.abort(new Error(reason))
    },
  }
}

// Databasecontroles en opruimen via de beheer-API (alleen eigen testgegevens).
function idList(ids) {
  if (!ids.length || !ids.every((id) => UUID_RE.test(id))) throw new Error('ongeldige id-lijst')
  return ids.map((id) => `'${id}'`).join(', ')
}

export function createDb(sql) {
  return {
    async activity() {
      const [r] = await sql(`select (select count(*) from pg_stat_activity)::int as conns,
        (select count(*) from pg_stat_activity where state like 'idle in transaction%')::int as idle_tx,
        (select xact_rollback from pg_stat_database where datname = current_database())::text as rollbacks`)
      return { conns: r.conns, idleTx: r.idle_tx, rollbacks: Number(r.rollbacks) }
    },
    async anonUsers(ids) {
      const [r] = await sql(`select count(*)::int as n, coalesce(bool_and(is_anonymous), false) as anon from auth.users where id in (${idList(ids)})`)
      return r
    },
    async roomStats(roomId) {
      const id = idList([roomId])
      const [r] = await sql(`select r.version,
        (select count(*) from public.draws d where d.room_id = r.id)::int as draws,
        (select count(distinct d.result_id) from public.draws d where d.room_id = r.id)::int as unique_results,
        (select coalesce(json_agg(json_build_object('participant', d.participant, 'spun_by', d.spun_by, 'on_behalf', d.on_behalf)), '[]') from public.draws d where d.room_id = r.id) as rows
        from public.rooms r where r.id = ${id}`)
      return r ?? null
    },
    deleteRooms: (ids) => sql(`delete from public.rooms where organizer_id in (${idList(ids)})`),
    deleteUsers: (ids) => sql(`delete from auth.users where is_anonymous and id in (${idList(ids)})`),
    async leftovers(ids) {
      if (!ids.length) return { rooms: 0, users: 0 }
      const [r] = await sql(`select (select count(*) from public.rooms where organizer_id in (${idList(ids)}))::int as rooms,
        (select count(*) from auth.users where id in (${idList(ids)}))::int as users`)
      return r
    },
  }
}

// ---------------------------------------------------------------------------
// Fasen
// ---------------------------------------------------------------------------
function assert(cond, message) {
  if (!cond) throw new Error(message)
}

const show = (r) => `${r.status}:${r.body?.error ?? ''}`

async function setupRoom({ client, step, ctx, users: count }) {
  await step('hulpfunctie voor anonieme login uitrollen', () => client.deployHelper())
  await step(`anoniem aanmelden via Supabase Auth (${count}×, na elkaar)`, async () => {
    ctx.phones = []
    for (let i = 0; i < count; i++) ctx.phones.push(await client.signIn())
    assert(ctx.phones.every((p) => p.isAnonymous === true), 'niet alle gebruikers zijn anoniem')
    const r = await ctx.db.anonUsers(ctx.phones.map((p) => p.id))
    assert(r.n === count && r.anon === true, `auth.users: ${JSON.stringify(r)}`)
  })
  await step('kamer aanmaken (organisator = deelnemer 0)', async () => {
    const c = await client.game(ctx.phones[0].token, { action: 'create_room', participant: 0 })
    assert(c.status === 200 && /^[A-HJ-NP-Z2-9]{6}$/.test(c.body?.room?.code ?? ''), `${show(c)} ${JSON.stringify(c.body)}`)
    ctx.roomId = c.body.room.id
    ctx.code = c.body.room.code
  })
}

// Gelijktijdige SPIN's door de organisator op dezelfde spelversie, met
// controle van de client-antwoorden, de database en de PostgREST-logs.
async function concurrentSpins({ client, step, ctx, limits, sleep, log, n }) {
  const since = new Date(Date.now() - 5_000).toISOString()
  let base
  await step('uitgangssituatie: kamer op versie 0, geen trekkingen', async () => {
    const s = await ctx.db.roomStats(ctx.roomId)
    assert(s?.version === 0 && s.draws === 0, JSON.stringify(s))
    base = await ctx.db.activity()
  })
  await step(`${n} gelijktijdige SPIN-verzoeken: precies één HTTP 200, de rest HTTP 409`, async () => {
    const org = ctx.phones[0]
    const r = await Promise.all(Array.from({ length: n }, () => client.game(org.token, { action: 'spin', roomId: ctx.roomId })))
    const summary = r.map(show).join(', ')
    assert(r.filter((x) => x.status === 200).length === 1, summary)
    assert(r.every((x) => x.status === 200 || (x.status === 409 && ['turn_not_released', 'conflict'].includes(x.body?.error))), `onverwacht antwoord: ${summary}`)
    log(`      client (Edge Function): ${summary}`)
  })
  await step('database: precies één definitieve trekking, versie 1', async () => {
    const s = await ctx.db.roomStats(ctx.roomId)
    assert(s?.version === 1 && s.draws === 1 && s.unique_results === 1, JSON.stringify(s))
  })
  let stats
  await step('PostgREST: RPC één keer 200, conflicten als 409, nooit 5xx', async () => {
    // Logs komen met vertraging binnen: wacht (begrensd) tot de winnende RPC
    // en de bijbehorende conflictmeldingen zichtbaar zijn.
    for (let i = 0; i < limits.logPolls; i++) {
      stats = await client.logStats(since)
      if (stats.rpc200 >= 1 && stats.versionConflicts >= stats.rpc409) break
      await sleep(limits.logPollIntervalMs)
    }
    assert(stats.rpc200 === 1, `RPC 200: ${stats.rpc200} (verwacht 1) ${JSON.stringify(stats)}`)
    assert(stats.rpc5xx === 0, `RPC 5xx: ${stats.rpc5xx} ${JSON.stringify(stats)}`)
    assert(stats.rpcAll === stats.rpc200 + stats.rpc409, `RPC met andere status dan 200/409: ${JSON.stringify(stats)}`)
    // Begrensd: elk verliezend verzoek doet hoogstens 3 pogingen.
    assert(stats.rpc409 <= (n - 1) * 3, `meer interne conflicten dan begrensd mogelijk: ${JSON.stringify(stats)}`)
    // Intern conflict ≠ antwoord aan de client: een PT409 wordt door de
    // server opnieuw geprobeerd en eindigt bij de client meestal als
    // 'turn_not_released'. Hier tellen we wat PostgREST echt teruggaf.
    log(`      intern (PostgREST): commit_room_state 200×${stats.rpc200}, 409 (PT409)×${stats.rpc409}, 5xx×${stats.rpc5xx}; version_conflict in logs: ${stats.versionConflicts}`)
    if (stats.rpc409 === 0) {
      ctx.warnings.push('Geen intern PT409 opgetreden: de verzoeken overlapten niet in de database. Correcte afhandeling van PT409 is in deze run dus niet aangetoond.')
    }
  })
  await step('geen herhaallus: na wachten geen nieuwe conflicten, geen hangende transacties', async () => {
    await sleep(limits.loopCheckDelayMs)
    const later = await client.logStats(since)
    assert(JSON.stringify(later) === JSON.stringify(stats), `logs liepen op: ${JSON.stringify(stats)} → ${JSON.stringify(later)}`)
    // Elk PT409 is precies één 'version_conflict' in de databaselog.
    assert(later.versionConflicts === later.rpc409, `version_conflict (${later.versionConflicts}) ≠ RPC 409 (${later.rpc409})`)
    const a = await ctx.db.activity()
    assert(a.idleTx === 0, `hangende transacties: ${a.idleTx}`)
    assert(a.rollbacks - base.rollbacks <= limits.maxExtraRollbacks, `rollbacks opgelopen met ${a.rollbacks - base.rollbacks}`)
  })
}

export const PHASES = {
  '5a': {
    title: 'Fase 5A — basisfunctionaliteit (geen gelijktijdige verzoeken)',
    async run({ client, step, ctx, limits, sleep, now, log }) {
      await setupRoom({ client, step, ctx, users: 3 })
      const [org, p1, outsider] = ctx.phones

      await step('zonder, met ongeldig of met vervalst token: 401', async () => {
        const a = await client.game(null, { action: 'time' }, { auth: null })
        const b = await client.game(null, { action: 'time' }, { auth: 'Bearer onzin' })
        const parts = org.token.split('.')
        const forged = [parts[0], Buffer.from(JSON.stringify({ sub: outsider.id, role: 'authenticated' })).toString('base64url'), parts[2]].join('.')
        const c = await client.game(forged, { action: 'time' })
        assert(a.status === 401 && b.status === 401 && c.status === 401, `${a.status} ${b.status} ${c.status}`)
      })
      await step('servertijd en klokafwijking', async () => {
        const sent = now()
        const r = await client.game(org.token, { action: 'time' })
        const received = now()
        assert(r.status === 200 && Number.isFinite(r.body?.serverNow), show(r))
        ctx.offset = estimateOffset(sent, r.body.serverNow, received)
        assert(Math.abs(ctx.offset) < 60_000, `afwijking ${ctx.offset} ms`)
        log(`      afwijking t.o.v. server ${Math.round(ctx.offset)} ms, rondreis ${received - sent} ms`)
      })
      await step('kamer opzoeken met code: vrije en bezette namen, geen gebruikers-id’s', async () => {
        const l = await client.game(outsider.token, { action: 'lookup_room', code: ctx.code })
        assert(l.status === 200 && l.body.seats.length === 1 && !JSON.stringify(l.body).includes(org.id), JSON.stringify(l.body))
      })
      await step('deelnemer sluit aan en claimt een naam', async () => {
        const r = await client.game(p1.token, { action: 'claim_seat', code: ctx.code, participant: 1 })
        assert(r.status === 200 && r.body.mySeat === 1, show(r))
      })
      await step('bezette naam claimen en kamer bekijken als buitenstaander: geweigerd', async () => {
        const a = await client.game(outsider.token, { action: 'claim_seat', code: ctx.code, participant: 1 })
        assert(a.status === 409 && a.body?.error === 'seat_taken', show(a))
        const b = await client.game(outsider.token, { action: 'get_room', roomId: ctx.roomId })
        assert(b.status === 404, show(b))
      })
      await step('deelnemer kan geen organisatoracties of andermans SPIN uitvoeren (na elkaar)', async () => {
        const got = []
        for (const body of [
          { action: 'spin', roomId: ctx.roomId },
          { action: 'spin', roomId: ctx.roomId, onBehalf: true },
          { action: 'release_seat', roomId: ctx.roomId, participant: 0 },
          { action: 'auction_prepare', roomId: ctx.roomId, participant: 1, bidCents: 100 },
          { action: 'RESET', roomId: ctx.roomId },
        ]) {
          got.push(show(await client.game(p1.token, body)))
        }
        const want = ['403:not_your_turn', '403:not_your_turn', '403:not_organizer', '403:not_organizer', '400:unknown_action']
        assert(JSON.stringify(got) === JSON.stringify(want), got.join(', '))
        const s = await ctx.db.roomStats(ctx.roomId)
        assert(s.version === 0 && s.draws === 0, JSON.stringify(s))
      })
      await step('één gewone SPIN door wie aan de beurt is', async () => {
        const r = await client.game(org.token, { action: 'spin', roomId: ctx.roomId })
        assert(r.status === 200 && r.body.spin?.participant === 0 && r.body.onBehalf === false, show(r))
        ctx.spin = r.body.spin
        const s = await ctx.db.roomStats(ctx.roomId)
        assert(s.version === 1 && s.draws === 1 && s.rows[0].spun_by === org.id && s.rows[0].on_behalf === false, JSON.stringify(s))
      })
      await step('spelstatus ophalen: lopende draai zichtbaar en synchroon', async () => {
        const r = await client.game(p1.token, { action: 'get_room', roomId: ctx.roomId })
        assert(r.status === 200 && r.body.room.state.spin?.id === ctx.spin.id, show(r))
        const view = deriveView(r.body.room.state, r.body.serverNow)
        assert(view.reelSpin?.id === ctx.spin.id, 'lopende draai ontbreekt in de weergave')
      })
      await step('herstel: verzoek opnieuw versturen (antwoord kwijt) geeft geen tweede trekking', async () => {
        const r = await client.game(org.token, { action: 'spin', roomId: ctx.roomId })
        assert(r.status === 409 && r.body?.error === 'turn_not_released', show(r))
        const s = await ctx.db.roomStats(ctx.roomId)
        assert(s.version === 1 && s.draws === 1, JSON.stringify(s))
      })
      await step('herstel: later opnieuw ophalen → uitslag vastgelegd, volgende beurt vrij', async () => {
        const wait = ctx.spin.startedAt + releaseDelay(ctx.spin) - (now() + (ctx.offset ?? 0)) + 500
        await sleep(Math.min(Math.max(wait, 0), limits.maxReleaseWaitMs))
        const r = await client.game(p1.token, { action: 'get_room', roomId: ctx.roomId })
        assert(r.status === 200, show(r))
        const view = deriveView(r.body.room.state, r.body.serverNow)
        assert(view.state.draws.length === 1 && view.state.draws[0].resultId === ctx.spin.resultId, 'uitslag niet vastgelegd')
        assert(view.state.turn === 1 && view.locked === false, `beurt ${view.state.turn}, locked ${view.locked}`)
      })
    },
  },
  '5b': {
    title: 'Fase 5B — beperkte gelijktijdigheid (2 gelijktijdige SPIN-verzoeken)',
    async run(env) {
      await setupRoom({ ...env, users: 1 })
      await concurrentSpins({ ...env, n: 2 })
    },
  },
  '5c': {
    title: 'Fase 5C — uitgebreide gelijktijdigheid (10 gelijktijdige SPIN-verzoeken)',
    async run(env) {
      await setupRoom({ ...env, users: 1 })
      await concurrentSpins({ ...env, n: 10 })
    },
  },
}

// ---------------------------------------------------------------------------
// Uitvoeren van één fase, met voorcontrole, opruimen en eindstatus
// ---------------------------------------------------------------------------
async function healthCheck({ client, db }) {
  const health = await client.health()
  const unhealthy = health.filter((s) => s.status !== 'ACTIVE_HEALTHY').map((s) => `${s.name}=${s.status}`)
  if (unhealthy.length) throw new Error(`niet gezond: ${unhealthy.join(', ')}`)
  const a = await db.activity()
  if (a.idleTx > 0) throw new Error(`${a.idleTx} hangende transactie(s)`)
  return a
}

export async function runCleanup({ client, db, limits = LIMITS }) {
  const ids = client.users.slice()
  const steps = []
  const run = async (name, fn) => {
    try {
      await withDeadline(Promise.resolve().then(fn), limits.cleanupStepTimeoutMs, name)
      steps.push({ name, ok: true })
    } catch (e) {
      steps.push({ name, ok: false, error: e.message })
    }
  }
  try {
    await withDeadline(
      (async () => {
        if (ids.length) {
          await run('testkamers verwijderen', () => db.deleteRooms(ids))
          await run(`anonieme testgebruikers verwijderen (${ids.length})`, () => db.deleteUsers(ids))
        }
        if (client.state.helperDeployAttempted) await run('hulpfunctie verwijderen', () => client.deleteHelper())
        await run('controle: niets achtergebleven', async () => {
          const left = await db.leftovers(ids)
          const helper = client.state.helperDeployAttempted ? await client.helperExists() : false
          if (left.rooms || left.users || helper) {
            throw new Error(`achtergebleven: ${left.rooms} kamer(s), ${left.users} gebruiker(s), hulpfunctie ${helper ? 'nog aanwezig' : 'weg'}`)
          }
        })
      })(),
      limits.cleanupDeadlineMs,
      'opruimen',
    )
  } catch (e) {
    steps.push({ name: 'opruimen binnen tijdslimiet', ok: false, error: e.message })
  }
  return steps
}

export async function runPhase({ phase, client, db, limits = LIMITS, log = console.log, now = Date.now, sleep = defaultSleep }) {
  const def = PHASES[phase]
  if (!def) throw new UsageError(`onbekende fase ${phase}`)
  log(`${def.title}\nProject ${client.ref}\n`)

  try {
    await withDeadline(healthCheck({ client, db }), limits.cleanupStepTimeoutMs, 'voorcontrole')
    log('  ✓ voorcontrole: juiste project, diensten gezond, geen hangende transacties')
  } catch (e) {
    log(`  ✗ voorcontrole mislukt: ${e.message}\n\nNiets aangemaakt. Eindstatus: VOORCONTROLE MISLUKT (exitcode ${EXIT.preflight})`)
    return { exitCode: EXIT.preflight, results: [], cleanup: [], warnings: [] }
  }

  const results = []
  const ctx = { db, warnings: [], stopped: false }
  const step = async (name, fn) => {
    if (ctx.stopped) throw new Error('fase gestopt')
    try {
      await fn()
      results.push({ name, ok: true })
      log(`  ✓ ${name}`)
    } catch (e) {
      results.push({ name, ok: false, error: e.message })
      log(`  ✗ ${name}\n      ${e.message}`)
      ctx.stopped = true // bij de eerste fout stoppen
      throw e
    }
  }

  let timedOut = false
  let cleanup = []
  try {
    await withDeadline(def.run({ client, step, ctx, limits, sleep, now, log }), limits.phaseDeadlineMs[phase], `fase ${phase}`)
  } catch (e) {
    if (e instanceof TimeoutError) {
      timedOut = true
      results.push({ name: 'fase binnen tijdslimiet', ok: false, error: e.message })
      log(`  ✗ ${e.message}`)
    } else if (!results.some((r) => !r.ok)) {
      results.push({ name: 'onverwachte fout', ok: false, error: e.message })
      log(`  ✗ onverwachte fout: ${e.message}`)
    }
  } finally {
    ctx.stopped = true
    client.abortAll()
    log('\nOpruimen:')
    cleanup = await runCleanup({ client, db, limits })
    for (const c of cleanup) log(`  ${c.ok ? '✓' : '✗'} ${c.name}${c.ok ? '' : `\n      ${c.error}`}`)
  }

  try {
    const after = await withDeadline(healthCheck({ client, db }), limits.cleanupStepTimeoutMs, 'nacontrole')
    log(`  ✓ nacontrole: diensten gezond, ${after.conns} verbindingen, geen hangende transacties`)
  } catch (e) {
    results.push({ name: 'nacontrole', ok: false, error: e.message })
    log(`  ✗ nacontrole: ${e.message}`)
  }

  for (const w of ctx.warnings) log(`\n  ⚠ ${w}`)

  const failed = results.filter((r) => !r.ok).length
  const cleanupOk = cleanup.every((c) => c.ok)
  const exitCode = !cleanupOk ? EXIT.cleanup : timedOut ? EXIT.timeout : failed ? EXIT.failed : EXIT.ok
  const label = {
    [EXIT.ok]: 'GESLAAGD',
    [EXIT.failed]: 'MISLUKT',
    [EXIT.cleanup]: 'OPRUIMEN ONVOLLEDIG — controleer handmatig',
    [EXIT.timeout]: 'TIJDSLIMIET OVERSCHREDEN',
  }[exitCode]
  log(`\n${results.length - failed} van ${results.length} stappen geslaagd. Eindstatus: ${label} (exitcode ${exitCode})`)
  return { exitCode, results, cleanup, warnings: ctx.warnings }
}

async function main() {
  let args
  try {
    args = parseArgs(process.argv.slice(2), process.env)
  } catch (e) {
    console.error(e.message)
    process.exit(EXIT.usage)
  }
  const client = createLiveClient({ ref: args.ref, accessToken: process.env.SUPABASE_ACCESS_TOKEN })
  const db = createDb(client.sql)
  const { exitCode } = await runPhase({ phase: args.phase, client, db })
  process.exit(exitCode)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
