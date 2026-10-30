#!/usr/bin/env node
// Live test van de uitgerolde Edge Function 'game' met echte anonieme
// Supabase-logins, precies zoals de telefoons dat straks doen.
//
//   npm run fn:test
//
// Werkwijze:
// 1. Er wordt tijdelijk een hulpfunctie 'fsm-testlogin' uitgerold die
//    `signInAnonymously()` uitvoert met de publieke sleutel uit de eigen
//    omgeving van de functie. Zo ziet dit script nooit een API-sleutel. De
//    hulpfunctie antwoordt alleen met een eenmalige, willekeurige code.
// 2. Met die echte tokens worden alle scenario's tegen 'game' gespeeld.
// 3. Na afloop (ook bij een fout) worden de hulpfunctie, de testkamers en de
//    anonieme testgebruikers verwijderd.
//
// Nodig: netwerktoegang tot https://<ref>.supabase.co (functies) en
// api.supabase.com (beheer).

import { randomBytes } from 'node:crypto'
import { estimateOffset } from '../src/game/clock.js'
import { TURN_ORDER } from '../src/game/config.js'
import { releaseDelay } from '../src/game/timeline.js'
import { deriveView } from '../src/game/view.js'

const REF = process.env.SUPABASE_PROJECT_REF || 'twzjsmxydnfmowrmffsl'
const API = `https://api.supabase.com/v1/projects/${REF}`
const FUNCTIONS = `https://${REF}.supabase.co/functions/v1`
const HELPER = 'fsm-testlogin'
const NONCE = randomBytes(24).toString('hex')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function mgmtHeaders(extra = {}) {
  const h = { ...extra }
  if (process.env.SUPABASE_ACCESS_TOKEN) h.Authorization = `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`
  return h
}

async function sql(query) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}/database/query`, {
      method: 'POST',
      headers: mgmtHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ query }),
    })
    if (res.status === 429 && attempt < 8) {
      await sleep(2000 * (attempt + 1))
      continue
    }
    const data = await res.json()
    if (!res.ok) throw new Error(`sql → HTTP ${res.status}: ${data.message}`)
    return data
  }
}

const HELPER_SOURCE = `
import { createClient } from 'npm:@supabase/supabase-js@2.118.0'
const NONCE = '${NONCE}'
Deno.serve(async (req) => {
  if (req.method !== 'POST' || req.headers.get('x-test-nonce') !== NONCE) return new Response('not found', { status: 404 })
  const sb = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_ANON_KEY'), { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await sb.auth.signInAnonymously()
  if (error) return Response.json({ error: error.message, code: error.code ?? null }, { status: 400 })
  return Response.json({ access_token: data.session.access_token, user_id: data.user.id, is_anonymous: data.user.is_anonymous })
})
`

async function deployHelper() {
  const form = new FormData()
  form.append('metadata', JSON.stringify({ name: HELPER, entrypoint_path: 'index.ts', verify_jwt: false }))
  form.append('file', new Blob([HELPER_SOURCE]), 'index.ts')
  const res = await fetch(`${API}/functions/deploy?slug=${HELPER}`, { method: 'POST', headers: mgmtHeaders(), body: form })
  if (!res.ok) throw new Error(`hulpfunctie uitrollen → HTTP ${res.status}: ${await res.text()}`)
}

async function deleteHelper() {
  const res = await fetch(`${API}/functions/${HELPER}`, { method: 'DELETE', headers: mgmtHeaders() })
  if (!res.ok && res.status !== 404) throw new Error(`hulpfunctie verwijderen → HTTP ${res.status}`)
}

const users = []
async function signInAnonymously() {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${FUNCTIONS}/${HELPER}`, { method: 'POST', headers: { 'x-test-nonce': NONCE } })
    // Net uitgerolde functie kan de eerste seconden nog 404/503 geven.
    if (!res.ok && attempt < 10 && res.status !== 400) {
      await sleep(1500)
      continue
    }
    const data = await res.json()
    if (!res.ok) throw new Error(`anonieme login mislukt: ${data.error} (${data.code})`)
    users.push(data.user_id)
    return { token: data.access_token, id: data.user_id, isAnonymous: data.is_anonymous }
  }
}

async function game(token, body, { signal, rawAuth } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (rawAuth !== undefined) {
    if (rawAuth) headers.Authorization = rawAuth
  } else headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${FUNCTIONS}/game`, { method: 'POST', headers, body: JSON.stringify(body), signal: signal ?? AbortSignal.timeout(30_000) })
  return { status: res.status, body: await res.json().catch(() => null) }
}

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

const results = []
async function step(name, fn) {
  try {
    await fn()
    results.push(true)
    console.log(`  ✓ ${name}`)
  } catch (e) {
    results.push(false)
    console.log(`  ✗ ${name}\n      ${e.message}`)
  }
}

async function main() {
  console.log(`Live test Edge Function 'game' (${REF})\n`)
  await deployHelper()
  const ctx = {}
  try {
    await step('anonieme login werkt (echte Supabase Auth) en levert een anonieme gebruiker op', async () => {
      ctx.phones = []
      for (let i = 0; i < 10; i++) ctx.phones.push(await signInAnonymously()) // 9 deelnemers + 1 buitenstaander
      assert(ctx.phones.every((p) => p.isAnonymous === true), 'niet alle gebruikers zijn anoniem')
      const ids = ctx.phones.map((p) => `'${p.id}'`).join(',')
      const [row] = await sql(`select count(*)::int as n, bool_and(is_anonymous) as anon from auth.users where id in (${ids})`)
      assert(row.n === 10 && row.anon === true, `auth.users: ${JSON.stringify(row)}`)
    })
    if (!ctx.phones) throw new Error('zonder anonieme login kunnen de overige tests niet draaien')
    const [org, ...rest] = ctx.phones
    const outsider = rest.pop()
    const P = [org, ...rest] // deelnemer 0 = organisator

    await step('zonder, met ongeldig of met vervalst token: 401', async () => {
      const a = await game(null, { action: 'time' }, { rawAuth: null })
      const b = await game(null, { action: 'time' }, { rawAuth: 'Bearer onzin' })
      const parts = org.token.split('.')
      const forged = [parts[0], Buffer.from(JSON.stringify({ sub: outsider.id, role: 'authenticated' })).toString('base64url'), parts[2]].join('.')
      const c = await game(forged, { action: 'time' })
      assert(a.status === 401 && b.status === 401 && c.status === 401, `${a.status} ${b.status} ${c.status}`)
    })

    await step('servertijd en klokafwijking', async () => {
      const sent = Date.now()
      const r = await game(org.token, { action: 'time' })
      const received = Date.now()
      assert(r.status === 200 && Number.isFinite(r.body.serverNow), JSON.stringify(r))
      ctx.offset = estimateOffset(sent, r.body.serverNow, received)
      assert(Math.abs(ctx.offset) < 60_000, `afwijking ${ctx.offset} ms`)
      console.log(`      (afwijking t.o.v. server ${Math.round(ctx.offset)} ms, rondreis ${received - sent} ms)`)
    })

    await step('kamer maken, opzoeken en 9 namen claimen', async () => {
      const c = await game(org.token, { action: 'create_room', participant: 0 })
      assert(c.status === 200 && /^[A-HJ-NP-Z2-9]{6}$/.test(c.body.room.code), JSON.stringify(c.body))
      ctx.roomId = c.body.room.id
      ctx.code = c.body.room.code
      const l = await game(outsider.token, { action: 'lookup_room', code: ctx.code })
      assert(l.status === 200 && l.body.seats.length === 1 && !JSON.stringify(l.body).includes(org.id), JSON.stringify(l.body))
      const claims = await Promise.all(P.slice(1).map((p, i) => game(p.token, { action: 'claim_seat', code: ctx.code, participant: i + 1 })))
      assert(claims.every((r) => r.status === 200), claims.map((r) => r.status).join(','))
    })

    await step('naam van een ander claimen of kamer bekijken als buitenstaander: geweigerd', async () => {
      const a = await game(outsider.token, { action: 'claim_seat', code: ctx.code, participant: 3 })
      const b = await game(outsider.token, { action: 'get_room', roomId: ctx.roomId })
      assert(a.status === 409 && a.body.error === 'seat_taken', JSON.stringify(a.body))
      assert(b.status === 404, JSON.stringify(b.body))
    })

    await step('deelnemer mag geen organisatoracties of andermans SPIN uitvoeren', async () => {
      const r = await Promise.all([
        game(P[3].token, { action: 'spin', roomId: ctx.roomId }),
        game(P[3].token, { action: 'spin', roomId: ctx.roomId, onBehalf: true }),
        game(P[3].token, { action: 'release_seat', roomId: ctx.roomId, participant: 4 }),
        game(P[3].token, { action: 'auction_prepare', roomId: ctx.roomId, participant: 3, bidCents: 100 }),
        game(P[3].token, { action: 'RESET', roomId: ctx.roomId }),
        game(outsider.token, { action: 'spin', roomId: ctx.roomId, onBehalf: true }),
      ])
      const got = r.map((x) => `${x.status}:${x.body?.error}`)
      const want = ['403:not_your_turn', '403:not_your_turn', '403:not_organizer', '403:not_organizer', '400:unknown_action', '404:room_not_found']
      assert(JSON.stringify(got) === JSON.stringify(want), got.join(', '))
      const [c] = await sql(`select version, (select count(*) from public.draws where room_id = '${ctx.roomId}')::int as draws from public.rooms where id = '${ctx.roomId}'`)
      assert(c.version === 0 && c.draws === 0, JSON.stringify(c))
    })

    await step('10 gelijktijdige SPIN-verzoeken via HTTP: precies één trekking', async () => {
      const r = await Promise.all(Array.from({ length: 10 }, () => game(org.token, { action: 'spin', roomId: ctx.roomId })))
      const ok = r.filter((x) => x.status === 200)
      const summary = r.map((x) => `${x.status}:${x.body?.error ?? ''}${x.status === 500 ? ' ' + x.body?.message : ''}`).join(', ')
      assert(ok.length === 1, summary)
      ctx.spin = ok[0].body.spin
      assert(r.every((x) => x.status === 200 || ['turn_not_released', 'conflict'].includes(x.body?.error)), `onverwachte fout: ${summary}`)
      const [c] = await sql(`select count(*)::int as n, bool_and(spun_by = '${org.id}') as by from public.draws where room_id = '${ctx.roomId}'`)
      assert(c.n === 1 && c.by, JSON.stringify(c))
    })

    await step('herstel: status opnieuw ophalen tijdens de draai, rollen lopen synchroon verder', async () => {
      const r = await game(P[6].token, { action: 'get_room', roomId: ctx.roomId })
      const now = r.body.serverNow
      const view = deriveView(r.body.room.state, now)
      assert(view.reelSpin?.id === ctx.spin.id, 'lopende draai ontbreekt')
      assert(now - ctx.spin.startedAt >= 0 && now - ctx.spin.startedAt < 10_000, `tijd ${now - ctx.spin.startedAt}`)
    })

    await step('verbinding valt weg tijdens SPIN: opnieuw versturen geeft geen tweede trekking', async () => {
      // Wacht tot deelnemer 1 aan de beurt is.
      await sleep(Math.max(0, ctx.spin.startedAt + releaseDelay(ctx.spin) - (Date.now() + ctx.offset)) + 300)
      const abort = new AbortController()
      const lost = game(P[1].token, { action: 'spin', roomId: ctx.roomId }, { signal: abort.signal }).catch(() => 'afgebroken')
      setTimeout(() => abort.abort(), 5)
      await lost
      await sleep(1500)
      const retry = await game(P[1].token, { action: 'spin', roomId: ctx.roomId })
      const r = await game(P[1].token, { action: 'get_room', roomId: ctx.roomId })
      const draws = await sql(`select participant from public.draws where room_id = '${ctx.roomId}' and participant = 1`)
      // Ofwel de afgebroken aanvraag is toch verwerkt (retry geweigerd), ofwel
      // niet (retry slaagt). Nooit twee trekkingen.
      assert(draws.length === 1, `${draws.length} trekkingen voor deelnemer 1 (retry ${retry.status} ${retry.body?.error ?? ''})`)
      assert(r.body.room.state.spin?.participant === 1, 'draai van deelnemer 1 niet zichtbaar')
      ctx.spin = r.body.room.state.spin
    })

    await step('noodfunctie: organisator draait expliciet namens deelnemer 2', async () => {
      await sleep(Math.max(0, ctx.spin.startedAt + releaseDelay(ctx.spin) - (Date.now() + ctx.offset)) + 300)
      assert(TURN_ORDER[2].participant === 2, 'beurtvolgorde')
      const without = await game(org.token, { action: 'spin', roomId: ctx.roomId })
      const withFlag = await game(org.token, { action: 'spin', roomId: ctx.roomId, onBehalf: true })
      assert(without.status === 403 && without.body.error === 'not_your_turn', JSON.stringify(without.body))
      assert(withFlag.status === 200 && withFlag.body.onBehalf === true && withFlag.body.spin.participant === 2, JSON.stringify(withFlag.body))
      const [d] = await sql(`select on_behalf, spun_by from public.draws where room_id = '${ctx.roomId}' and participant = 2`)
      assert(d.on_behalf === true && d.spun_by === org.id, JSON.stringify(d))
    })

    await step('plek vrijgeven door organisator, nieuwe telefoon claimt de naam', async () => {
      const r = await game(org.token, { action: 'release_seat', roomId: ctx.roomId, participant: 4 })
      const old = await game(P[4].token, { action: 'get_room', roomId: ctx.roomId })
      const claim = await game(outsider.token, { action: 'claim_seat', code: ctx.code, participant: 4 })
      assert(r.status === 200 && old.status === 404 && claim.status === 200, `${r.status} ${old.status} ${claim.status}`)
    })

    await step('verwijderde (uitgelogde) gebruiker: token wordt geweigerd', async () => {
      await sql(`delete from auth.users where id = '${P[8].id}'`)
      const r = await game(P[8].token, { action: 'time' })
      assert(r.status === 401, `status ${r.status}`)
    })
  } finally {
    const ids = users.map((u) => `'${u}'`).join(',') || `'00000000-0000-0000-0000-000000000000'`
    await sql(`delete from public.rooms where organizer_id in (${ids})`).catch((e) => console.log(`  ! kamers opruimen: ${e.message}`))
    await sql(`delete from auth.users where id in (${ids})`).catch((e) => console.log(`  ! gebruikers opruimen: ${e.message}`))
    await deleteHelper().catch((e) => console.log(`  ! ${e.message}`))
  }
  await step('opgeruimd: geen testkamers, testgebruikers of hulpfunctie meer', async () => {
    const ids = users.map((u) => `'${u}'`).join(',') || `'00000000-0000-0000-0000-000000000000'`
    const [c] = await sql(`select (select count(*) from public.rooms)::int as rooms, (select count(*) from auth.users where id in (${ids}))::int as users`)
    const fns = await (await fetch(`${API}/functions`, { headers: mgmtHeaders() })).json()
    assert(c.rooms === 0 && c.users === 0 && !fns.some((f) => f.slug === HELPER), `${JSON.stringify(c)}, functies: ${fns.map((f) => f.slug)}`)
  })

  const failed = results.filter((r) => !r).length
  console.log(`\n${results.length - failed} van ${results.length} live tests geslaagd.`)
  if (failed) process.exit(1)
}

main().catch((e) => {
  console.error(`\nFout: ${e.message}`)
  process.exit(1)
})
