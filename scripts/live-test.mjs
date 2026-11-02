#!/usr/bin/env node
// Live test van de uitgerolde Edge Function 'game' met echte anonieme
// Supabase-logins, in drie afzonderlijke fasen. Elke fase moet expliciet
// gestart worden; een fase start nooit een andere.
//
//   npm run fn:test:5a                 basis: login, kamer, namen, één SPIN, herstel
//   npm run fn:test:5b                 2 gelijktijdige SPIN's (PT409 via PostgREST)
//   npm run fn:test:5c -- --bevestig   10 gelijktijdige SPIN's (alleen na akkoord)
//   npm run fn:test:5d                 volledig spel met 3 toestellen: deelnemer en
//                                      organisator tegelijk, Realtime, veilingen, bedragen
//
// Werkwijze per fase:
// 1. Vooraf: juiste project, alle diensten gezond, geen hangende transacties.
// 2. Tijdelijke hulpfunctie 'fsm-testlogin' doet `signInAnonymously()` met de
//    publieke sleutel uit de eigen functie-omgeving; dit script ziet nooit een
//    API-sleutel. De hulpfunctie antwoordt alleen op een eenmalige code.
//    Voor 5D luistert dezelfde hulpfunctie ook naar echte Realtime-signalen
//    (room_pulses) met het token van een testgebruiker, zoals de telefoon dat
//    doet (RLS geldt dus voor die gebruiker), en stuurt ze terug.
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
import { introTimeline, turnInfo } from '../src/lobby/playRules.js'
import { potCents, totalCents } from '../src/game/money.js'
import { settle } from '../src/game/engine.js'

export const EXPECTED_REF = 'twzjsmxydnfmowrmffsl'
export const HELPER = 'fsm-testlogin'

export const EXIT = { ok: 0, failed: 1, usage: 2, cleanup: 3, preflight: 4, timeout: 5 }

export const LIMITS = {
  mgmtTimeoutMs: 30_000, // elk verzoek aan de beheer-API
  functionTimeoutMs: 20_000, // elk verzoek aan een Edge Function
  max429Retries: 5, // beheer-API zegt "te veel verzoeken"
  maxSignInAttempts: 6, // net uitgerolde hulpfunctie kan even 404/503 geven
  signInRetryDelayMs: 2_000,
  phaseDeadlineMs: { '5a': 240_000, '5b': 180_000, '5c': 180_000, '5d': 420_000 },
  cleanupStepTimeoutMs: 30_000,
  cleanupDeadlineMs: 120_000,
  logPolls: 6, // logs komen met vertraging binnen
  logPollIntervalMs: 5_000,
  loopCheckDelayMs: 10_000, // daarna mag het aantal conflicten niet meer stijgen
  maxReleaseWaitMs: 15_000,
  maxIntroWaitMs: 20_000, // gezamenlijke startanimatie (max. ~16 s bij 12 deelnemers)
  maxExtraRollbacks: 50,
  realtimeWaitMs: 15_000, // lid wacht hoogstens zo lang op het Realtime-signaal
  outsiderWaitMs: 6_000, // buitenstaander luistert zo lang (mag niets ontvangen)
  maxSettleWaitMs: 25_000, // wachten tot een draai is afgerond en de beurt vrij is
  slowRequestMs: 5_000, // langzamer verzoek → waarschuwing
  listenRetries: 3, // starten van Realtime-luisteraars bij 503/504
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
  if (args.length !== 1 || !['5a', '5b', '5c', '5d'].includes(args[0])) {
    throw new UsageError('gebruik: node scripts/live-test.mjs 5a | 5b | 5c --bevestig | 5d  (precies één fase)')
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
  const ctx503 = [] // begrensd herhaalde 503/504 bij het starten van luisteraars

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
const SB_URL = Deno.env.get('SUPABASE_URL')
const SB_KEY = Deno.env.get('SUPABASE_ANON_KEY')
Deno.serve(async (req) => {
  if (req.method !== 'POST' || req.headers.get('x-test-nonce') !== NONCE) return new Response('not found', { status: 404 })
  if (new URL(req.url).searchParams.get('mode') === 'listen') return listen(await req.json())
  const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await sb.auth.signInAnonymously()
  if (error) return Response.json({ error: error.message, code: error.code ?? null }, { status: 400 })
  return Response.json({ access_token: data.session.access_token, user_id: data.user.id, is_anonymous: data.user.is_anonymous })
})
// Realtime zoals de telefoon: postgres_changes op room_pulses, per luisteraar
// een eigen verbinding met het token van die testgebruiker (RLS geldt per
// gebruiker). Eén verzoek voor alle luisteraars. Regels (NDJSON, met id):
// status, ready, pulse, error, end.
function listen({ listeners, roomId, untilVersion }) {
  const enc = new TextEncoder()
  let closed = false
  return new Response(new ReadableStream({
    start(ctrl) {
      const send = (o) => { if (!closed) ctrl.enqueue(enc.encode(JSON.stringify(o) + '\\n')) }
      let open = listeners.length
      for (const l of listeners) {
        const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
        sb.realtime.setAuth(l.token)
        const pulses = []
        let ready = false
        let ended = false
        let ch = null
        const end = (reason) => {
          if (ended) return
          ended = true
          clearTimeout(timer)
          send({ type: 'end', id: l.id, reason, pulses })
          if (ch) sb.removeChannel(ch).catch(() => {})
          if (--open === 0) { closed = true; ctrl.close() }
        }
        const markReady = (via) => { if (!ready && !ended) { ready = true; send({ type: 'ready', id: l.id, via }) } }
        const timer = setTimeout(() => end('timeout'), Math.min(Number(l.waitMs) || 10000, 30000))
        ch = sb.channel('fsm-test-' + crypto.randomUUID())
          .on('postgres_changes', { event: '*', schema: 'public', table: 'room_pulses', filter: 'room_id=eq.' + roomId }, (p) => {
            const v = p.new ? p.new.version : null
            pulses.push(v)
            send({ type: 'pulse', id: l.id, version: v })
            if (untilVersion != null && v >= untilVersion) end('version')
          })
          .on('system', {}, (p) => {
            if (p && p.extension === 'postgres_changes') {
              if (p.status === 'ok') markReady('system')
              else send({ type: 'error', id: l.id, message: String(p.message ?? p.status) })
            }
          })
          .subscribe((status) => {
            send({ type: 'status', id: l.id, status })
            if (status === 'SUBSCRIBED') setTimeout(() => markReady('subscribed'), 2000)
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') end(status)
          })
      }
    },
  }), { headers: { 'content-type': 'application/x-ndjson' } })
}
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
    // Realtime-luisteraars (via de hulpfunctie, één verzoek voor allemaal):
    // `ready` zodra elk abonnement actief is, `done` met per luisteraar de
    // ontvangen signalen (stopt bij `untilVersion` of na `waitMs`). Starten
    // wordt bij 503/504 (platform nog niet klaar) begrensd opnieuw geprobeerd;
    // luisteren wijzigt niets.
    listen(roomId, listeners, { untilVersion = null }) {
      const ctrl = new AbortController()
      const onAbort = () => ctrl.abort()
      phaseAbort.signal.addEventListener('abort', onAbort, { once: true })
      const waitMs = Math.max(...listeners.map((l) => l.waitMs))
      let readyResolve
      let readyReject
      const ready = new Promise((res, rej) => {
        readyResolve = res
        readyReject = rej
      })
      ready.catch(() => {})
      const outs = Object.fromEntries(listeners.map((l) => [l.id, { pulses: [], statuses: [], readyVia: null, reason: null, errors: [] }]))
      const done = (async () => {
        const timer = setTimeout(() => ctrl.abort(), waitMs + limits.functionTimeoutMs + limits.listenRetries * limits.signInRetryDelayMs)
        try {
          let res
          for (let attempt = 1; ; attempt++) {
            if (phaseAbort.signal.aborted) throw new Error('afgebroken')
            res = await fetchImpl(`${functions}/${HELPER}?mode=listen`, {
              method: 'POST',
              headers: { 'x-test-nonce': nonce, 'Content-Type': 'application/json' },
              body: JSON.stringify({ roomId, untilVersion, listeners }),
              signal: ctrl.signal,
            })
            if (res.ok) break
            const text = (await res.text().catch(() => '')).slice(0, 300)
            if ((res.status === 503 || res.status === 504) && attempt < limits.listenRetries) {
              ctx503.push({ status: res.status, text })
              await sleep(limits.signInRetryDelayMs)
              continue
            }
            throw new Error(`Realtime luisteren: HTTP ${res.status} ${text}`.trim())
          }
          const readyIds = new Set()
          await parseListenStreamFrom(readStream(res.body), outs, (id) => {
            readyIds.add(id)
            if (readyIds.size === listeners.length) readyResolve([...new Set(Object.values(outs).map((o) => o.readyVia))])
          })
          return outs
        } catch (e) {
          throw ctrl.signal.aborted && !phaseAbort.signal.aborted ? new TimeoutError('Realtime luisteren: tijdslimiet') : e
        } finally {
          clearTimeout(timer)
          phaseAbort.signal.removeEventListener('abort', onAbort)
        }
      })()
      done.then(
        () => readyReject(new Error(`Realtime: niet alle abonnementen actief ${JSON.stringify(outs)}`)),
        (e) => readyReject(e),
      )
      return { ready, done }
    },
    retries: ctx503,
    abortAll(reason = 'fase afgebroken') {
      phaseAbort.abort(new Error(reason))
    },
  }
}

// Antwoord van de luisteraar: regels met JSON (status, ready, pulse, end).
// `readStream` levert de regels zodra ze binnenkomen (ready vóór end).
async function* readStream(body) {
  const dec = new TextDecoder()
  let buf = ''
  for await (const chunk of body) {
    buf += typeof chunk === 'string' ? chunk : dec.decode(chunk, { stream: true })
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (line) yield line
    }
  }
  if (buf.trim()) yield buf.trim()
}

export async function parseListenStreamFrom(lines, outs, onReady) {
  for await (const line of lines) {
    const m = parseJson(line)
    const out = m && outs[m.id]
    if (!out) continue
    if (m.type === 'status') out.statuses.push(m.status)
    else if (m.type === 'ready') {
      out.readyVia = m.via
      onReady(m.id)
    } else if (m.type === 'pulse') out.pulses.push(m.version)
    else if (m.type === 'error') out.errors.push(m.message)
    else if (m.type === 'end') out.reason = m.reason
  }
  return outs
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
    // Alle definitieve trekkingen van een kamer (5D: bedragen en dubbelingen).
    async drawRows(roomId) {
      const id = idList([roomId])
      return sql(`select participant, round, result_id, bid_cents, spun_by, on_behalf, spin_id::text as spin_id
        from public.draws where room_id = ${id} order by started_at`)
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

// Testspel: `players` deelnemers, 1 ronde, players + 1 uitslagen (1 veiling).
function testSetup(players) {
  const pool = ['0-0', '0-1', '1-0', '1-1', '2-0', '0-2', '2-1', '1-2', '2-2', '3-0', '0-3', '3-1'].slice(0, players).concat('OVERIG')
  return { name: 'Organisator', home: 'Testclub', away: 'Tegenstander', draft: { maxPlayers: players, rounds: 1, priceCents: 0, pool, mega: [] } }
}

async function setupRoom({ client, step, ctx, users: count, players, setup = testSetup(players) }) {
  await step('hulpfunctie voor anonieme login uitrollen', () => client.deployHelper())
  await step(`anoniem aanmelden via Supabase Auth (${count}×, na elkaar)`, async () => {
    ctx.phones = []
    for (let i = 0; i < count; i++) ctx.phones.push(await client.signIn())
    assert(ctx.phones.every((p) => p.isAnonymous === true), 'niet alle gebruikers zijn anoniem')
    const r = await ctx.db.anonUsers(ctx.phones.map((p) => p.id))
    assert(r.n === count && r.anon === true, `auth.users: ${JSON.stringify(r)}`)
  })
  await step(`kamer aanmaken met volledig ingesteld spel (${players} deelnemer${players === 1 ? '' : 's'}, organisator speelt mee)`, async () => {
    const c = await client.game(ctx.phones[0].token, { action: 'create_room', ...setup })
    assert(c.status === 200 && /^[A-HJ-NP-Z2-9]{6}$/.test(c.body?.room?.code ?? '') && c.body.room.mySlot === 0, `${show(c)} ${JSON.stringify(c.body)}`)
    ctx.roomId = c.body.room.id
    ctx.code = c.body.room.code
  })
}

// Starten (organisator) en wachten tot de gezamenlijke startanimatie voorbij is.
async function startGame({ client, step, ctx, sleep, now, limits }) {
  await step('spel starten: één gezamenlijke starttijd (servertijd)', async () => {
    const r = await client.game(ctx.phones[0].token, { action: 'start_game', roomId: ctx.roomId })
    assert(r.status === 200 && r.body.room.phase === 'started' && Number.isFinite(r.body.room.startedAt), show(r))
    ctx.startedAt = r.body.room.startedAt
    const tl = introTimeline(r.body.room.state.config.players.length)
    ctx.introEnd = ctx.startedAt + tl.endAt
    const offset = r.body.serverNow - now()
    const again = await client.game(ctx.phones[0].token, { action: 'start_game', roomId: ctx.roomId })
    assert(again.status === 409 && again.body?.error === 'registration_closed', `tweede start: ${show(again)}`)
    const early = await client.game(ctx.phones[0].token, { action: 'spin', roomId: ctx.roomId })
    assert(early.status === 409 && early.body?.error === 'intro_running', `SPIN tijdens de animatie: ${show(early)}`)
    if (r.body.room.awaitPlay) {
      // game v3: wachten tot het Las Vegas-scherm, dan "START SPEL" (organisator).
      await sleep(Math.min(Math.max(ctx.startedAt + tl.vegasAt - (now() + offset) + 300, 0), limits.maxIntroWaitMs))
      const play = await client.game(ctx.phones[0].token, { action: 'start_play', roomId: ctx.roomId })
      assert(play.status === 200 && Number.isFinite(play.body.room.playAt), `START SPEL: ${show(play)}`)
      ctx.introEnd = play.body.room.playAt
    }
    await sleep(Math.min(Math.max(ctx.introEnd - (now() + offset) + 500, 0), limits.maxIntroWaitMs))
  })
}

// Gelijktijdige SPIN's door de organisator op dezelfde spelversie, met
// controle van de client-antwoorden, de database en de PostgREST-logs.
async function concurrentSpins({ client, step, ctx, limits, sleep, log, n }) {
  const since = new Date(Date.now() - 5_000).toISOString()
  let base
  let baseVersion
  await step('uitgangssituatie: gestart, nog geen trekkingen', async () => {
    const s = await ctx.db.roomStats(ctx.roomId)
    assert(s && s.draws === 0, JSON.stringify(s))
    baseVersion = s.version
    base = await ctx.db.activity()
  })
  await step(`${n} gelijktijdige SPIN-verzoeken: precies één HTTP 200, de rest HTTP 409`, async () => {
    const org = ctx.phones[0]
    const r = await Promise.all(Array.from({ length: n }, () => client.game(org.token, { action: 'spin', roomId: ctx.roomId })))
    const summary = r.map(show).join(', ')
    assert(r.filter((x) => x.status === 200).length === 1, summary)
    assert(
      r.every((x) => x.status === 200 || (x.status === 409 && ['spin_in_progress', 'turn_not_released', 'conflict'].includes(x.body?.error))),
      `onverwacht antwoord: ${summary}`,
    )
    log(`      client (Edge Function): ${summary}`)
  })
  await step('database: precies één definitieve trekking, versie +1', async () => {
    const s = await ctx.db.roomStats(ctx.roomId)
    assert(s?.version === baseVersion + 1 && s.draws === 1 && s.unique_results === 1, JSON.stringify(s))
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


// ---------------------------------------------------------------------------
// Fase 5D: volledig spel met drie toestellen (organisator, A, B) en een
// buitenstaander. Deelnemer en organisator (namens) tegelijk, Realtime per
// toestel, dezelfde stand op alle toestellen, veilingen, bedragen en pot.
// ---------------------------------------------------------------------------
export const SETUP_5D = {
  name: 'Organisator',
  home: 'Testclub',
  away: 'Tegenstander',
  // 3 deelnemers × 2 rondes = 6 vaste trekkingen, 8 uitslagen → 2 veilingen.
  draft: { maxPlayers: 3, rounds: 2, priceCents: 250, pool: ['0-0', '0-1', '1-0', '1-1', '2-0', '0-2', '2-1', 'OVERIG'], mega: ['1-1'] },
}
export const BIDS_5D = [
  { phone: 'A', bidCents: 1234 }, // €12,34 (met centen)
  { phone: 'B', bidCents: 3500 }, // €35,00, namens B gedraaid door de organisator
]
const NAMES_5D = { org: 'Organisator', A: 'Deelnemer A', B: 'Deelnemer B' }
const READ_ACTIONS = new Set(['time', 'get_room', 'lookup_room', 'create_room']) // create_room = insert, geen RPC

async function phase5d(env) {
  const { client, step, ctx, limits, sleep, now, log } = env
  const sinceIso = new Date(Date.now() - 5_000).toISOString()
  ctx.commits = 0 // geslaagde wijzigingen = commit_room_state 200
  ctx.losers = 0 // verliezers van gelijktijdige verzoeken (elk ≤ 3 interne PT409)
  ctx.durations = []
  ctx.ledger = [] // wat de test zelf deed: { resultId, participant, round, bidCents, spunBy, onBehalf }
  ctx.realtime = []
  await setupRoom({ ...env, users: 4, players: 3, setup: SETUP_5D })
  const [org, A, B, outsider] = ctx.phones
  const phones = { org, A, B }
  const devices = [['organisator', org], ['A', A], ['B', B]]
  const byName = { [NAMES_5D.org]: org, [NAMES_5D.A]: A, [NAMES_5D.B]: B }
  const label = (phone) => ({ org: 'organisator', A: 'A', B: 'B' })[Object.keys(phones).find((k) => phones[k] === phone)]

  // Eén verzoek, met tijdmeting; geslaagde wijzigingen worden geteld.
  const call = async (phone, body) => {
    const t = now()
    const r = await client.game(phone.token, { roomId: ctx.roomId, ...body })
    ctx.durations.push({ action: body.action, ms: now() - t })
    if (r.status === 200 && !READ_ACTIONS.has(body.action)) ctx.commits++
    return r
  }
  const ok = async (phone, body) => {
    const r = await call(phone, body)
    assert(r.status === 200, `${body.action} (${label(phone)}): ${show(r)}`)
    return r.body
  }
  const refused = async (phone, body, status, error) => {
    const r = await call(phone, body)
    assert(r.status === status && r.body?.error === error, `${body.action} (${label(phone)}): verwacht ${status}:${error}, kreeg ${show(r)}`)
  }

  // Echte Realtime: luisteraars actief vóór de wijziging; leden ontvangen het
  // signaal met de nieuwe versie, de buitenstaander niets.
  const realtime = async (what, members, outsiders, mutate) => {
    const { version } = await ctx.db.roomStats(ctx.roomId)
    const until = version + 1
    const subs = [
      ...members.map((p) => ({ id: label(p), member: true, token: p.token, waitMs: limits.realtimeWaitMs })),
      ...outsiders.map((p) => ({ id: 'buitenstaander', member: false, token: p.token, waitMs: limits.outsiderWaitMs })),
    ]
    const l = client.listen(ctx.roomId, subs.map(({ id, token, waitMs }) => ({ id, token, waitMs })), { untilVersion: until })
    const vias = await l.ready
    const t = now()
    const result = await mutate()
    const outs = await l.done
    const ms = now() - t
    const summary = subs.map((s) => `${s.id}: ${outs[s.id].pulses.length ? `versie ${outs[s.id].pulses.join(',')}` : 'niets'}`).join(', ')
    for (const s of subs) {
      const o = outs[s.id]
      assert(!o.errors.length, `Realtime ${s.id}: ${o.errors.join('; ')}`)
      if (s.member) assert(o.reason === 'version' && JSON.stringify(o.pulses) === JSON.stringify([until]), `Realtime ${s.id} ontving niet precies versie ${until} (${what}): ${JSON.stringify(o)}`)
      else assert(o.pulses.length === 0, `buitenstaander ontving een signaal (${what}): ${JSON.stringify(o)}`)
    }
    ctx.realtime.push({ what, until, ms, vias })
    log(`      Realtime (${what}): ${summary}`)
    return result
  }

  // Dezelfde stand op alle toestellen (actuele serverstatus ophalen).
  const sameEverywhere = async (what) => {
    const views = []
    for (const [name, p] of devices) views.push({ name, ...(await ok(p, { action: 'get_room' })) })
    // De opgeslagen status is tijdgestuurd: elke telefoon rekent hem uit op de
    // servertijd (settle). Hier voor alle toestellen op hetzelfde tijdstip.
    const T = Math.max(...views.map((v) => v.serverNow))
    const proj = views.map(({ room }) => ({ room, s: room.state ? settle(room.state, T) : null })).map(({ room, s }) => ({
      version: room.version,
      phase: room.phase,
      matchName: room.matchName,
      names: room.phase === 'started' ? room.players.map((p) => p.name) : room.players.slice().sort((a, b) => a.slot - b.slot).map((p) => p.name),
      order: room.state?.config.players.map((p) => p.name) ?? null,
      draws: s?.draws.map((d) => [d.participant, String(d.round), d.resultId, d.bid ?? null]) ?? [],
      spin: s?.spin?.id ?? null,
      enginePhase: s?.phase ?? null,
      startedAt: room.startedAt,
      announce: room.announce,
      ack: room.ack,
      awaitPlay: room.awaitPlay ?? null,
      playAt: room.playAt ?? null,
    }))
    for (let i = 1; i < proj.length; i++) {
      assert(JSON.stringify(proj[i]) === JSON.stringify(proj[0]), `${what}: ${views[i].name} ziet iets anders dan ${views[0].name}\n${JSON.stringify(proj[i])}\n${JSON.stringify(proj[0])}`)
    }
    return { room: views[0].room, serverNow: T, proj: proj[0] }
  }

  // Wachten tot de draai is afgerond en de volgende beurt vrij is (servertijd).
  const settleTurn = async () => {
    const until = now() + limits.maxSettleWaitMs
    for (;;) {
      const r = await ok(org, { action: 'get_room' })
      const v = deriveView(r.room.state, r.serverNow, r.room.ack)
      if (!v.state.spin && !v.locked && !v.tileStage) return r
      const s = v.state.spin ?? r.room.state.lastSpin
      assert(now() < until, `draai niet afgerond binnen ${limits.maxSettleWaitMs} ms`)
      await sleep(Math.min(Math.max((s ? s.startedAt + releaseDelay(s) - r.serverNow : 0) + 300, 200), 3_000))
    }
  }
  const dbMatchesLedger = async () => {
    const rows = await ctx.db.drawRows(ctx.roomId)
    assert(rows.length === ctx.ledger.length, `database: ${rows.length} trekkingen, verwacht ${ctx.ledger.length}`)
    return rows
  }
  const record = (spin, spunBy, onBehalf) =>
    ctx.ledger.push({ resultId: spin.resultId, participant: spin.participant, round: String(spin.round), bidCents: spin.round === 'veiling' ? Math.round(spin.bid * 100) : null, spunBy, onBehalf })

  // --- Wachtkamer: drie toestellen --------------------------------------
  await step('A meldt zich aan; Realtime-signaal bij de organisator, niet bij een buitenstaander', async () => {
    const r = await realtime('A meldt zich aan', [org], [outsider], () => call(A, { action: 'join_room', code: ctx.code, name: 'deelnemer A' }))
    assert(r.status === 200 && r.body.room.mySlot === 1, show(r))
  })
  await step('B meldt zich aan; Realtime-signaal bij organisator en A', async () => {
    const r = await realtime('B meldt zich aan', [org, A], [outsider], () => call(B, { action: 'join_room', code: ctx.code, name: 'Deelnemer B' }))
    assert(r.status === 200 && r.body.room.mySlot === 2, show(r))
  })
  await step('alle toestellen zien dezelfde deelnemers (wachtkamer, aanmeldvolgorde)', async () => {
    const { proj } = await sameEverywhere('wachtkamer')
    assert(JSON.stringify(proj.names) === JSON.stringify([NAMES_5D.org, NAMES_5D.A, NAMES_5D.B]), JSON.stringify(proj.names))
  })
  await step('volgorde loten op de server (afwijkend van de aanmeldvolgorde)', async () => {
    let order = [0, 1, 2]
    for (let i = 0; i < 10 && order.join() === '0,1,2'; i++) order = (await ok(org, { action: 'shuffle_order' })).room.players.map((p) => p.slot)
    assert(order.join() !== '0,1,2', 'loting gaf 10× de aanmeldvolgorde')
    ctx.order = order.map((slot) => [NAMES_5D.org, NAMES_5D.A, NAMES_5D.B][slot])
    log(`      gelote volgorde: ${ctx.order.join(', ')}`)
  })

  // --- Start ---------------------------------------------------------------
  await step('spel starten: Realtime op alle toestellen, buitenstaander niets; tweede start en vroege SPIN geweigerd', async () => {
    const r = await realtime('start', [org, A, B], [outsider], () => ok(org, { action: 'start_game' }))
    ctx.startedAt = r.room.startedAt
    const tl = introTimeline(3)
    ctx.introEnd = ctx.startedAt + tl.endAt
    await refused(org, { action: 'start_game' }, 409, 'registration_closed')
    await refused(A, { action: 'spin' }, 409, 'intro_running')
    if (r.room.awaitPlay) {
      // game v3: Las Vegas-scherm blijft staan; alleen de organisator gaat verder.
      await sleep(Math.min(Math.max(ctx.startedAt + tl.vegasAt - r.serverNow + 300, 0), limits.maxIntroWaitMs))
      // Las Vegas-wachtfase (ook na herladen): overal wachten, nog geen vertrekmoment.
      const wait = (await sameEverywhere('Las Vegas-wachtfase')).proj
      assert(wait.awaitPlay === true && wait.playAt === null, `wachtfase: ${JSON.stringify(wait)}`)
      await refused(A, { action: 'start_play' }, 403, 'not_organizer')
      await refused(A, { action: 'spin' }, 409, 'intro_running')
      const play = await realtime('START SPEL', [org, A, B], [], () => ok(org, { action: 'start_play' }))
      await refused(org, { action: 'start_play' }, 409, 'nothing_to_advance')
      // Alle toestellen: hetzelfde vertrekmoment (synchrone overgang).
      const go = (await sameEverywhere('na START SPEL')).proj
      assert(go.playAt === play.room.playAt, `vertrekmoment ${go.playAt} ≠ ${play.room.playAt}`)
      ctx.introEnd = play.room.playAt
      await sleep(Math.min(Math.max(ctx.introEnd - play.serverNow + 300, 0), limits.maxIntroWaitMs))
    } else await sleep(Math.min(Math.max(ctx.introEnd - r.serverNow + 500, 0), limits.maxIntroWaitMs))
  })
  await step('alle toestellen zien dezelfde definitieve (gelote) spelersvolgorde', async () => {
    const { proj } = await sameEverywhere('na de start')
    assert(JSON.stringify(proj.order) === JSON.stringify(ctx.order), `volgorde ${JSON.stringify(proj.order)} ≠ geloot ${JSON.stringify(ctx.order)}`)
    assert(JSON.stringify(proj.names) === JSON.stringify(ctx.order), `deelnemers ${JSON.stringify(proj.names)}`)
  })

  // --- Vaste trekkingen ----------------------------------------------------
  const raced = new Set()
  for (let i = 0; i < 6; i++) {
    const r = await settleTurn()
    const info = turnInfo(r.room.state, r.serverNow)
    assert(info.participant != null, `geen beurt: ${info.error}`)
    const player = r.room.state.config.players.find((p) => p.id === info.participant)
    const phone = byName[player.name]
    const who = label(phone)
    const race = who !== 'organisator' && !raced.has(who)
    await step(`vaste trekking ${i + 1}/6: ${player.name}${race ? ' en organisator (namens) tegelijk → precies één' : ''}`, async () => {
      const others = devices.map(([, p]) => p).filter((p) => p !== phone)
      if (who !== 'organisator') await refused(org, { action: 'spin' }, 403, 'not_your_turn') // organisator alleen expliciet namens
      await refused(others.find((p) => p !== org) ?? others[0], { action: 'spin' }, 403, 'not_your_turn')
      if (race) {
        raced.add(who)
        const both = await realtime(`gelijktijdige SPIN ${who}`, [org, A, B], [], () =>
          Promise.all([call(phone, { action: 'spin' }), call(org, { action: 'spin', onBehalf: true })]),
        )
        const summary = both.map(show).join(', ')
        assert(both.filter((x) => x.status === 200).length === 1, `${who} + organisator: ${summary}`)
        const loser = both.find((x) => x.status !== 200)
        assert(loser.status === 409 && ['spin_in_progress', 'turn_not_released', 'conflict'].includes(loser.body?.error), `verliezer: ${summary}`)
        ctx.losers++
        const winnerIsOrg = both[1].status === 200
        const spin = (winnerIsOrg ? both[1] : both[0]).body.room.state.spin
        assert(spin.participant === info.participant, `trekking voor ${spin.participant}, verwacht ${info.participant}`)
        record(spin, winnerIsOrg ? org.id : phone.id, winnerIsOrg)
        log(`      ${who} ${show(both[0])} · organisator namens ${show(both[1])} → gewonnen door ${winnerIsOrg ? 'organisator (namens)' : who}`)
      } else {
        const res = await ok(phone, { action: 'spin' })
        record(res.room.state.spin, phone.id, false)
      }
      const rows = await dbMatchesLedger()
      const last = rows.find((x) => x.result_id === ctx.ledger.at(-1).resultId)
      assert(last && last.spun_by === ctx.ledger.at(-1).spunBy && last.on_behalf === ctx.ledger.at(-1).onBehalf && last.bid_cents === null, `trekking in database: ${JSON.stringify(last)}`)
      await settleTurn()
      const { proj } = await sameEverywhere(`na trekking ${i + 1}`)
      assert(proj.draws.length === ctx.ledger.length, `toestellen zien ${proj.draws.length} trekkingen`)
    })
  }
  assert(raced.size === 2, `gelijktijdige SPIN alleen getest voor ${[...raced].join(', ')}`)

  // --- Veiling ---------------------------------------------------------------
  await step('faseovergang naar de veiling: alleen de organisator, eenmalig, op alle toestellen', async () => {
    await refused(A, { action: 'advance_phase', step: 'auction' }, 403, 'not_organizer')
    await refused(org, { action: 'confirm_auction', participant: 1, bidCents: 100 }, 409, 'auction_not_open')
    await realtime('start de veiling', [org, A, B], [], () => ok(org, { action: 'advance_phase', step: 'auction' }))
    await refused(org, { action: 'advance_phase', step: 'auction' }, 409, 'nothing_to_advance')
    const { proj } = await sameEverywhere('veiling geopend')
    assert(proj.ack?.auctionStart && proj.enginePhase === 'auction', JSON.stringify(proj.ack))
  })
  for (const [k, bid] of BIDS_5D.entries()) {
    const winner = phones[bid.phone]
    const byOrg = k === 1
    await step(`veiling #${k + 1}: ${NAMES_5D[bid.phone]} wint met ${bid.bidCents} cent${byOrg ? ', organisator draait namens' : ''}`, async () => {
      const r = await settleTurn()
      const participant = r.room.state.config.players.find((p) => p.name === NAMES_5D[bid.phone]).id
      await refused(A, { action: 'confirm_auction', participant, bidCents: bid.bidCents }, 403, 'not_organizer')
      const c = await realtime(`veiling #${k + 1} bevestigd`, [org, A, B], [], () => ok(org, { action: 'confirm_auction', participant, bidCents: bid.bidCents }))
      assert(c.room.announce?.lot === k + 1 && c.room.announce.participant === participant && c.room.announce.bidCents === bid.bidCents, JSON.stringify(c.room.announce))
      await refused(org, { action: 'confirm_auction', participant, bidCents: 1 }, 409, 'auction_confirmed')
      const other = devices.map(([, p]) => p).find((p) => p !== winner && p !== org)
      await refused(other, { action: 'spin' }, 403, 'not_your_turn')
      await refused(org, { action: 'spin' }, 403, 'not_your_turn')
      const res = await ok(byOrg ? org : winner, { action: 'spin', ...(byOrg ? { onBehalf: true } : {}) })
      const spin = res.room.state.spin
      assert(spin.round === 'veiling' && spin.participant === participant && Math.round(spin.bid * 100) === bid.bidCents, JSON.stringify(spin))
      record(spin, byOrg ? org.id : winner.id, byOrg)
      const rows = await dbMatchesLedger()
      const row = rows.find((x) => x.result_id === spin.resultId)
      assert(row.round === 'veiling' && row.participant === participant && row.bid_cents === bid.bidCents && row.on_behalf === byOrg, `veilingtrekking in database: ${JSON.stringify(row)}`)
      await settleTurn()
      if (k === 0) await refused(org, { action: 'advance_phase', step: 'final' }, 409, 'nothing_to_advance') // nog een veiling over
      const { proj } = await sameEverywhere(`na veiling #${k + 1}`)
      assert(proj.announce?.lot === k + 1, JSON.stringify(proj.announce))
    })
  }
  await step('faseovergang naar de eindstand: alleen de organisator, eenmalig, op alle toestellen', async () => {
    await refused(B, { action: 'advance_phase', step: 'final' }, 403, 'not_organizer')
    await realtime('bekijk de eindstand', [org, A, B], [], () => ok(org, { action: 'advance_phase', step: 'final' }))
    await refused(org, { action: 'advance_phase', step: 'final' }, 409, 'nothing_to_advance')
    await refused(org, { action: 'spin' }, 409, 'game_finished')
    const { proj, room, serverNow } = await sameEverywhere('eindstand')
    assert(proj.enginePhase === 'finished' && proj.ack?.finish, JSON.stringify(proj.ack))
    ctx.final = { ...room, state: settle(room.state, serverNow) }
  })

  // --- Bedragen, dubbelingen, eindstand ---------------------------------------
  await step('bedragen: vaste trekkingen, biedingen, totaal per deelnemer en pot (alle toestellen + database)', async () => {
    const price = SETUP_5D.draft.priceCents
    const expected = Object.fromEntries(Object.values(NAMES_5D).map((n) => [n, 0]))
    const nameOf = (id) => ctx.final.state.config.players.find((p) => p.id === id).name
    for (const e of ctx.ledger) expected[nameOf(e.participant)] += e.round === 'veiling' ? e.bidCents : price
    const pot = 6 * price + BIDS_5D.reduce((s, b) => s + b.bidCents, 0)
    assert(Object.values(expected).reduce((a, b) => a + b, 0) === pot, `pot ${pot} ≠ ${JSON.stringify(expected)}`)
    assert(expected[NAMES_5D.org] === 2 * price && expected[NAMES_5D.A] === 2 * price + 1234 && expected[NAMES_5D.B] === 2 * price + 3500, JSON.stringify(expected))
    for (const [name, p] of devices) {
      const { room, serverNow } = await ok(p, { action: 'get_room' })
      const st = settle(room.state, serverNow)
      assert(potCents(st) === pot, `${name}: pot ${potCents(st)} ≠ ${pot}`)
      for (const pl of st.config.players) {
        const t = totalCents(st.draws.filter((d) => d.participant === pl.id), st.config.priceCents)
        assert(t === expected[pl.name], `${name}: totaal ${pl.name} ${t} ≠ ${expected[pl.name]}`)
      }
    }
    const rows = await ctx.db.drawRows(ctx.roomId)
    const dbTotals = {}
    for (const r of rows) dbTotals[nameOf(r.participant)] = (dbTotals[nameOf(r.participant)] ?? 0) + (r.round === 'veiling' ? r.bid_cents : price)
    assert(JSON.stringify(Object.keys(expected).map((n) => dbTotals[n])) === JSON.stringify(Object.keys(expected).map((n) => expected[n])), `database: ${JSON.stringify(dbTotals)}`)
    log(`      totaal: ${Object.entries(expected).map(([n, c]) => `${n} ${c}`).join(', ')} · pot ${pot} cent`)
  })
  await step('database: geen dubbele trekkingen, draaien of betalingen; alles klopt met wat er gebeurde', async () => {
    const rows = await dbMatchesLedger()
    assert(rows.length === 8, `${rows.length} trekkingen`)
    assert(new Set(rows.map((r) => r.result_id)).size === 8, 'dubbele uitslag')
    assert(new Set(rows.map((r) => r.spin_id)).size === 8, 'dubbele draai')
    const fixed = rows.filter((r) => r.round !== 'veiling')
    assert(fixed.length === 6 && fixed.every((r) => r.bid_cents === null), 'vaste trekkingen met bod')
    assert(new Set(fixed.map((r) => `${r.participant}/${r.round}`)).size === 6, 'deelnemer trok twee keer in dezelfde ronde')
    const auction = rows.filter((r) => r.round === 'veiling')
    assert(auction.length === 2 && JSON.stringify(auction.map((r) => r.bid_cents)) === JSON.stringify(BIDS_5D.map((b) => b.bidCents)), JSON.stringify(auction))
    for (const e of ctx.ledger) {
      const r = rows.find((x) => x.result_id === e.resultId)
      assert(r && r.participant === e.participant && r.round === e.round && r.bid_cents === e.bidCents && r.spun_by === e.spunBy && r.on_behalf === e.onBehalf, `${JSON.stringify(e)} ↔ ${JSON.stringify(r)}`)
    }
    const st = ctx.final.state.draws.map((d) => d.resultId).sort()
    assert(JSON.stringify(st) === JSON.stringify(rows.map((r) => r.result_id).sort()), 'spelstatus en database verschillen')
  })
  await step('eindstand in de definitieve gelote volgorde (niet de aanmeldvolgorde)', async () => {
    const names = ctx.final.state.config.players.map((p) => p.name)
    assert(JSON.stringify(names) === JSON.stringify(ctx.order), `${JSON.stringify(names)} ≠ ${JSON.stringify(ctx.order)}`)
    assert(JSON.stringify(names) !== JSON.stringify([NAMES_5D.org, NAMES_5D.A, NAMES_5D.B]), 'eindstand in aanmeldvolgorde')
  })
  await step('logs: commit_room_state alleen 200/409, geen 5xx, conflicten begrensd, geen herhaallus', async () => {
    let stats
    for (let i = 0; i < limits.logPolls; i++) {
      stats = await client.logStats(sinceIso)
      if (stats.rpc200 >= ctx.commits && stats.versionConflicts >= stats.rpc409) break
      await sleep(limits.logPollIntervalMs)
    }
    assert(stats.rpc200 === ctx.commits, `RPC 200: ${stats.rpc200}, verwacht ${ctx.commits} ${JSON.stringify(stats)}`)
    assert(stats.rpc5xx === 0, `RPC 5xx: ${JSON.stringify(stats)}`)
    assert(stats.rpcAll === stats.rpc200 + stats.rpc409, `RPC met andere status: ${JSON.stringify(stats)}`)
    assert(stats.rpc409 <= ctx.losers * 3, `meer interne conflicten dan begrensd mogelijk: ${JSON.stringify(stats)}`)
    await sleep(limits.loopCheckDelayMs)
    const later = await client.logStats(sinceIso)
    assert(JSON.stringify(later) === JSON.stringify(stats), `logs liepen op: ${JSON.stringify(stats)} → ${JSON.stringify(later)}`)
    assert(later.versionConflicts === later.rpc409, `version_conflict (${later.versionConflicts}) ≠ RPC 409 (${later.rpc409})`)
    log(`      fouten: RPC 5xx×${stats.rpc5xx} · versieconflicten (bedoeld, gelijktijdige SPIN): PT409×${stats.rpc409}, version_conflict×${stats.versionConflicts} · geslaagde wijzigingen ${stats.rpc200}`)
  })
  await step('reactietijden', async () => {
    const max = ctx.durations.reduce((m, d) => (d.ms > m.ms ? d : m), { ms: -1, action: '-' })
    const slow = ctx.durations.filter((d) => d.ms > limits.slowRequestMs)
    const rt = ctx.realtime.map((r) => r.ms)
    log(`      ${ctx.durations.length} verzoeken, langzaamste ${max.ms} ms (${max.action}); Realtime na wijziging ≤ ${Math.max(...rt)} ms; abonnement via ${[...new Set(ctx.realtime.flatMap((r) => r.vias))].join('/')}`)
    if (client.retries?.length) ctx.warnings.push(`Realtime-luisteraar ${client.retries.length}× opnieuw gestart na ${client.retries.map((r) => `HTTP ${r.status} ${r.text}`).join('; ')}`)
    if (slow.length) ctx.warnings.push(`${slow.length} verzoek(en) langzamer dan ${limits.slowRequestMs} ms: ${slow.map((d) => `${d.action} ${d.ms} ms`).join(', ')}`)
  })
}

export const PHASES = {
  '5a': {
    title: 'Fase 5A — basisfunctionaliteit (geen gelijktijdige verzoeken)',
    async run(env) {
      const { client, step, ctx, limits, sleep, now, log } = env
      await setupRoom({ ...env, users: 3, players: 2 })
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
      await step('kamer opzoeken met code: wedstrijd en plaatsen, geen gebruikers-id’s', async () => {
        const l = await client.game(outsider.token, { action: 'lookup_room', code: ctx.code })
        assert(l.status === 200 && l.body.summary?.playerCount === 1 && l.body.summary.maxPlayers === 2 && !JSON.stringify(l.body).includes(org.id), JSON.stringify(l.body))
      })
      await step('dubbele naam (hoofdletterongevoelig) geweigerd; deelnemer meldt zich aan', async () => {
        const a = await client.game(outsider.token, { action: 'join_room', code: ctx.code, name: 'ORGANISATOR' })
        assert(a.status === 409 && a.body?.error === 'name_taken', show(a))
        const r = await client.game(p1.token, { action: 'join_room', code: ctx.code, name: 'Deelnemer' })
        assert(r.status === 200 && r.body.room?.mySlot === 1 && r.body.room.draft === null, show(r))
      })
      await step('vol: buitenstaander kan niet meer aansluiten en de kamer niet bekijken', async () => {
        const a = await client.game(outsider.token, { action: 'join_room', code: ctx.code, name: 'Derde' })
        assert(a.status === 409 && a.body?.error === 'room_full', show(a))
        const b = await client.game(outsider.token, { action: 'get_room', roomId: ctx.roomId })
        assert(b.status === 404, show(b))
      })
      await step('deelnemer kan geen organisatoracties uitvoeren (na elkaar)', async () => {
        const got = []
        for (const body of [
          { action: 'start_game', roomId: ctx.roomId },
          { action: 'set_order', roomId: ctx.roomId, order: [1, 0] },
          { action: 'shuffle_order', roomId: ctx.roomId },
          { action: 'remove_player', roomId: ctx.roomId, slot: 0 },
          { action: 'advance_phase', roomId: ctx.roomId, step: 'auction' },
          { action: 'confirm_auction', roomId: ctx.roomId, participant: 1, bidCents: 100 },
          { action: 'RESET', roomId: ctx.roomId },
        ]) {
          got.push(show(await client.game(p1.token, body)))
        }
        const want = ['403:not_organizer', '403:not_organizer', '403:not_organizer', '403:not_organizer', '403:not_organizer', '403:not_organizer', '400:unknown_action']
        assert(JSON.stringify(got) === JSON.stringify(want), got.join(', '))
        const s = await ctx.db.roomStats(ctx.roomId)
        assert(s.draws === 0, JSON.stringify(s))
      })
      await startGame(env)
      await step('één gewone SPIN door wie aan de beurt is (deelnemer niet)', async () => {
        const no = await client.game(p1.token, { action: 'spin', roomId: ctx.roomId })
        assert(no.status === 403 && no.body?.error === 'not_your_turn', show(no))
        const r = await client.game(org.token, { action: 'spin', roomId: ctx.roomId })
        assert(r.status === 200 && r.body.room?.state?.spin?.participant === 0, show(r))
        ctx.spin = r.body.room.state.spin
        const s = await ctx.db.roomStats(ctx.roomId)
        assert(s.draws === 1 && s.rows[0].spun_by === org.id && s.rows[0].on_behalf === false, JSON.stringify(s))
      })
      await step('spelstatus ophalen: lopende draai zichtbaar en synchroon', async () => {
        const r = await client.game(p1.token, { action: 'get_room', roomId: ctx.roomId })
        assert(r.status === 200 && r.body.room.state.spin?.id === ctx.spin.id, show(r))
        const view = deriveView(r.body.room.state, r.body.serverNow, r.body.room.ack)
        assert(view.reelSpin?.id === ctx.spin.id, 'lopende draai ontbreekt in de weergave')
      })
      await step('herstel: verzoek opnieuw versturen (antwoord kwijt) geeft geen tweede trekking', async () => {
        const r = await client.game(org.token, { action: 'spin', roomId: ctx.roomId })
        assert(r.status === 409 && ['spin_in_progress', 'turn_not_released'].includes(r.body?.error), show(r))
        const s = await ctx.db.roomStats(ctx.roomId)
        assert(s.draws === 1, JSON.stringify(s))
      })
      await step('herstel: later opnieuw ophalen → uitslag vastgelegd, volgende beurt vrij', async () => {
        const wait = ctx.spin.startedAt + releaseDelay(ctx.spin) - (now() + (ctx.offset ?? 0)) + 500
        await sleep(Math.min(Math.max(wait, 0), limits.maxReleaseWaitMs))
        const r = await client.game(p1.token, { action: 'get_room', roomId: ctx.roomId })
        assert(r.status === 200, show(r))
        const view = deriveView(r.body.room.state, r.body.serverNow, r.body.room.ack)
        assert(view.state.draws.length === 1 && view.state.draws[0].resultId === ctx.spin.resultId, 'uitslag niet vastgelegd')
        assert(view.state.turn === 1 && view.locked === false, `beurt ${view.state.turn}, locked ${view.locked}`)
      })
      await step('organisator draait expliciet namens de deelnemer: vastgelegd als on_behalf', async () => {
        const no = await client.game(org.token, { action: 'spin', roomId: ctx.roomId })
        assert(no.status === 403 && no.body?.error === 'not_your_turn', show(no))
        const r = await client.game(org.token, { action: 'spin', roomId: ctx.roomId, onBehalf: true })
        assert(r.status === 200 && r.body.room.state.spin?.participant === 1, show(r))
        const s = await ctx.db.roomStats(ctx.roomId)
        assert(s.draws === 2 && s.rows.some((x) => x.participant === 1 && x.spun_by === org.id && x.on_behalf === true), JSON.stringify(s))
      })
    },
  },
  '5b': {
    title: 'Fase 5B — beperkte gelijktijdigheid (2 gelijktijdige SPIN-verzoeken)',
    async run(env) {
      await setupRoom({ ...env, users: 1, players: 1 })
      await startGame(env)
      await concurrentSpins({ ...env, n: 2 })
    },
  },
  '5c': {
    title: 'Fase 5C — uitgebreide gelijktijdigheid (10 gelijktijdige SPIN-verzoeken)',
    async run(env) {
      await setupRoom({ ...env, users: 1, players: 1 })
      await startGame(env)
      await concurrentSpins({ ...env, n: 10 })
    },
  },
  '5d': {
    title: 'Fase 5D — volledig spel met 3 toestellen: gelijktijdig, Realtime, veilingen en bedragen',
    run: phase5d,
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
