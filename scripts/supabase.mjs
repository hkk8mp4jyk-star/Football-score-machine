#!/usr/bin/env node
// Beheer van de Supabase-database via de Management API.
//
//   npm run db:status   project, migraties en tabellen tonen (alleen lezen)
//   npm run db:migrate  nog niet uitgevoerde migraties uit supabase/migrations uitvoeren
//   npm run db:test     beveiligings- en databasetests uit supabase/tests draaien,
//                       plus de serverlogica tegen de echte database
//   npm run fn:deploy   Edge Function 'game' uitrollen (supabase/functions/game)
//
// Toegang: het access token wordt in de Claude Code-omgeving door de beveiligde
// proxy toegevoegd (Network secret voor api.supabase.com). Lokaal kun je
// SUPABASE_ACCESS_TOKEN zetten. Project: SUPABASE_PROJECT_REF of de standaard.

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serverIntegrationTests } from './server-integration.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REF = process.env.SUPABASE_PROJECT_REF || 'twzjsmxydnfmowrmffsl'
const API = `https://api.supabase.com/v1/projects/${REF}`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function call(method, route, body) {
  const headers = { 'Content-Type': 'application/json' }
  if (process.env.SUPABASE_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`
  let res
  // De Management API begrenst het aantal verzoeken (HTTP 429): even wachten.
  for (let attempt = 0; ; attempt++) {
    res = await fetch(API + route, { method, headers, body: body ? JSON.stringify(body) : undefined })
    if (res.status !== 429 || attempt >= 8) break
    await sleep(Number(res.headers.get('retry-after')) * 1000 || 2000 * (attempt + 1))
  }
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = text
  }
  if (!res.ok) {
    const msg = typeof data === 'object' ? data.message || JSON.stringify(data) : data
    throw new Error(`${method} ${route} → HTTP ${res.status}: ${msg}`)
  }
  return data
}

const sql = (query) => call('POST', '/database/query', { query })

// Supabase registreert een migratie met een eigen tijdstempel; de naam
// (bestandsnaam zonder tijdstempel) is daarom de sleutel.
const appliedNames = async () => new Set((await call('GET', '/database/migrations')).map((m) => m.name))

const migrationFiles = () =>
  readdirSync(path.join(ROOT, 'supabase/migrations'))
    .filter((f) => /^\d{14}_.+\.sql$/.test(f))
    .sort()
    .map((f) => ({ file: f, version: f.slice(0, 14), name: f.slice(15, -4) }))

async function status() {
  const project = await call('GET', '')
  console.log(`Project: ${project.name} (${REF}), ${project.region}, ${project.status}`)
  const done = await appliedNames()
  for (const m of migrationFiles()) console.log(`  ${done.has(m.name) ? '✓' : '·'} ${m.file}`)
  const tables = await sql(
    `select table_name from information_schema.tables where table_schema = 'public' order by 1`,
  )
  console.log(`Tabellen in public: ${tables.map((t) => t.table_name).join(', ') || '(geen)'}`)
}

async function migrate() {
  const done = await appliedNames()
  const pending = migrationFiles().filter((m) => !done.has(m.name))
  if (!pending.length) return console.log('Geen openstaande migraties.')
  for (const m of pending) {
    const query = readFileSync(path.join(ROOT, 'supabase/migrations', m.file), 'utf8')
    process.stdout.write(`Migratie ${m.file} … `)
    await call('POST', '/database/migrations', { query, name: m.name })
    console.log('uitgevoerd')
  }
  const after = await appliedNames()
  const missing = pending.filter((m) => !after.has(m.name))
  if (missing.length) throw new Error(`Niet geregistreerd: ${missing.map((m) => m.file).join(', ')}`)
}

async function test() {
  const dir = path.join(ROOT, 'supabase/tests')
  let failed = 0
  let total = 0
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    console.log(`\n${f}`)
    const rows = await sql(readFileSync(path.join(dir, f), 'utf8'))
    for (const r of rows) {
      total++
      if (!r.ok) failed++
      console.log(`  ${r.ok ? '✓' : '✗'} ${r.test}${r.ok ? '' : `\n      ${r.detail}`}`)
    }
  }
  for (const t of [...extraTests, ...serverIntegrationTests(sql)]) {
    total++
    try {
      await t.run()
      console.log(`  ✓ ${t.name}`)
    } catch (e) {
      failed++
      console.log(`  ✗ ${t.name}\n      ${e.message}`)
    }
  }
  console.log(`\n${total - failed} van ${total} tests geslaagd.`)
  if (failed) process.exit(1)
}

// Tests die echte, gelijktijdige verzoeken nodig hebben. Ze gebruiken een
// tijdelijke testkamer die na afloop altijd wordt verwijderd.
const extraTests = [
  {
    name: 'gelijktijdige SPIN-verzoeken: precies één slaagt (10 tegelijk)',
    async run() {
      const [room] = await sql(
        `insert into public.rooms (code, organizer_id, state) values ('ZZTEST', gen_random_uuid(), '{"test":true}') returning id`,
      )
      try {
        const attempts = Array.from({ length: 10 }, (_, i) =>
          sql(
            `select public.commit_room_state('${room.id}', 0, '{"test":true,"winner":${i}}',
               json_build_object('spin_id', gen_random_uuid(), 'result_id', '${['0-0', '1-1', '2-2', '3-3', '4-4', '0-1', '1-0', '2-1', '1-2', '3-4'][i]}',
                 'participant', ${i % 9}, 'round', 'veiling', 'bid_cents', 100, 'started_at', now(), 'spun_by', gen_random_uuid())::jsonb) as v`,
          ).then(
            () => 'ok',
            (e) => (/version_conflict/.test(e.message) ? 'conflict' : `fout: ${e.message}`),
          ),
        )
        const outcomes = await Promise.all(attempts)
        const ok = outcomes.filter((o) => o === 'ok').length
        const conflicts = outcomes.filter((o) => o === 'conflict').length
        const [check] = await sql(
          `select (select version from public.rooms where id = '${room.id}') as version,
                  (select count(*) from public.draws where room_id = '${room.id}')::int as draws`,
        )
        if (ok !== 1 || conflicts !== 9 || check.version !== 1 || check.draws !== 1) {
          throw new Error(`geslaagd ${ok}, geweigerd ${conflicts}, versie ${check.version}, trekkingen ${check.draws} (${outcomes.join(', ')})`)
        }
      } finally {
        await sql(`delete from public.rooms where id = '${room.id}'`)
        const [left] = await sql(`select count(*)::int as n from public.rooms where code = 'ZZTEST'`)
        if (left.n !== 0) throw new Error('testkamer is niet opgeruimd')
      }
    },
  },
]

// Edge Function uitrollen via de Management API. De functie importeert de
// gedeelde spelregels uit src/; die bestanden gaan mee met hun eigen pad.
// verify_jwt staat uit: de functie controleert het token zelf bij Supabase
// Auth (werkt ook met de nieuwe JWT-sleutels) en weigert alles zonder token.
const FUNCTION = {
  slug: 'game',
  entrypoint: 'supabase/functions/game/index.ts',
  files: [
    'supabase/functions/game/index.ts',
    'src/server/actions.js',
    'src/server/http.js',
    'src/server/supabaseStore.js',
    'src/game/config.js',
    'src/game/engine.js',
    'src/game/random.js',
    'src/game/timeline.js',
  ],
}

async function deploy() {
  const form = new FormData()
  form.append('metadata', JSON.stringify({ name: FUNCTION.slug, entrypoint_path: FUNCTION.entrypoint, verify_jwt: false }))
  for (const f of FUNCTION.files) form.append('file', new Blob([readFileSync(path.join(ROOT, f))]), f)
  const headers = {}
  if (process.env.SUPABASE_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`
  const res = await fetch(`${API}/functions/deploy?slug=${FUNCTION.slug}`, { method: 'POST', headers, body: form })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`deploy → HTTP ${res.status}: ${data.message || JSON.stringify(data)}`)
  console.log(`Edge Function '${data.slug}' versie ${data.version}: ${data.status} (verify_jwt ${data.verify_jwt})`)
}

const command = process.argv[2]
const commands = { status, migrate, test, deploy }
if (!commands[command]) {
  console.error('Gebruik: node scripts/supabase.mjs status|migrate|test|deploy')
  process.exit(2)
}
commands[command]().catch((e) => {
  console.error(`\nFout: ${e.message}`)
  process.exit(1)
})
