// Spelinstellingen van één spel: wie speelt mee (in speelvolgorde), hoeveel
// vaste rondes, de prijs per vaste trekking, de uitslagenpool en de MEGA
// WIN-uitslagen. De instellingen staan in de spelstatus (`state.config`), zodat
// engine, server en alle telefoons met precies dezelfde regels rekenen.
//
// De DEMO en het standaardspel gebruiken DEFAULT_CONFIG: 9 deelnemers, 2
// rondes, €10, 0-0 t/m 4-4 + Overige en de vaste MEGA WIN-lijst. Daarmee
// gedraagt de engine zich exact zoals vóór de instelbare spellen.
//
// Afgeleid:  vaste trekkingen = N × R,  veilingkavels A = P − N × R,
// met P = aantal uitslagen in de pool (inclusief OVERIG) en 0 ≤ A ≤ 10.

import {
  ALL_RESULTS,
  GOALS,
  REEL_SYMBOLS,
  REEL_SYMBOLS_EXTENDED,
  RESULT_BY_ID,
  MAX_AUCTION_LOTS,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  MAX_PRICE_CENTS,
  MAX_ROUNDS,
  MEGA_WIN_IDS,
  MIN_PLAYERS,
  MIN_ROUNDS,
  OTHER_ID,
  PARTICIPANTS,
  RESULTS,
  ROUNDS,
} from './config.js'
import { REGULAR_VALUE_CENTS } from './money.js'

const ORDER = new Map(ALL_RESULTS.map((r, i) => [r.id, i])) // vaste volgorde, als in het overzicht

export const DEFAULT_CONFIG = Object.freeze({
  players: Object.freeze(PARTICIPANTS.map((name, id) => Object.freeze({ id, name }))),
  rounds: ROUNDS,
  priceCents: REGULAR_VALUE_CENTS,
  pool: Object.freeze(RESULTS.map((r) => r.id)),
  mega: Object.freeze(sortResults(MEGA_WIN_IDS)),
})

export const configOf = (state) => state?.config ?? DEFAULT_CONFIG

// Uitslagen in de vaste volgorde van het overzicht (0-0, 0-1 … 6-6, Overige).
export function sortResults(ids) {
  return [...ids].sort((a, b) => ORDER.get(a) - ORDER.get(b))
}

export const drawTurns = (config) => config.players.length * config.rounds
export const auctionLots = (config) => config.pool.length - drawTurns(config)

// Slangvolgorde: oneven rondes van de eerste naar de laatste speler, even
// rondes terug. `participant` is het vaste id van de speler.
const orderCache = new WeakMap()
export function turnOrder(config) {
  let order = orderCache.get(config)
  if (!order) {
    const ids = config.players.map((p) => p.id)
    order = []
    for (let round = 1; round <= config.rounds; round++) {
      const seq = round % 2 === 1 ? ids : [...ids].reverse()
      for (const participant of seq) order.push({ round, participant })
    }
    orderCache.set(config, order)
  }
  return order
}

export function playerName(config, id) {
  return config.players.find((p) => p.id === id)?.name ?? ''
}

// Hoogste aantal goals in de pool (OVERIG telt niet mee).
export function maxGoalsIn(config) {
  return config.pool.reduce((m, id) => {
    const r = RESULT_BY_ID[id]
    return r?.other ? m : Math.max(m, r.home, r.away)
  }, 0)
}

// Rollen: standaard 0–4 + ★; met uitslagen boven 4 goals 0–6 + ★.
export const reelSymbolsFor = (config) => (maxGoalsIn(config) > GOALS.length - 1 ? REEL_SYMBOLS_EXTENDED : REEL_SYMBOLS)

// Overzichtsraster: 0 t/m het hoogste aantal goals in de pool, minimaal 0–4.
export function gridGoalsFor(config) {
  const max = Math.max(GOALS.length - 1, maxGoalsIn(config))
  return Array.from({ length: max + 1 }, (_, i) => i)
}

// Veilingtegels: 1–4 op één rij boven de machine; daarna boven + onder
// (5 = 3+2, 6 = 3+3, 7 = 4+3, 8 = 4+4, 9 = 5+4, 10 = 5+5). `cols` = aantal
// kolommen dat de tegelbreedte bepaalt: nooit minder dan 4 (dus nooit grotere
// tegels dan bij 4 per rij), bij 5 per rij smaller.
export function auctionRows(count) {
  const top = count <= 4 ? count : Math.ceil(count / 2)
  return { top, bottom: count - top, cols: Math.max(4, top) }
}

// ---------------------------------------------------------------------------
// Spelersnamen: 1–20 tekens, spaties aan begin en eind weg, eerste letter een
// hoofdletter, de rest zoals ingevoerd. Uniek binnen een spel, ongeacht
// hoofdletters. Geen stuurtekens (onzichtbaar en onbedoeld).
// ---------------------------------------------------------------------------
export function normalizePlayerName(raw) {
  if (typeof raw !== 'string') return { error: 'name_invalid' }
  const trimmed = raw.trim()
  if (/\p{Cc}/u.test(trimmed)) return { error: 'name_invalid' }
  const chars = [...trimmed]
  if (chars.length < 1) return { error: 'name_empty' }
  if (chars.length > MAX_NAME_LENGTH) return { error: 'name_too_long' }
  return { name: chars[0].toLocaleUpperCase('nl-NL') + chars.slice(1).join('') }
}

export const nameKey = (name) => name.toLocaleLowerCase('nl-NL')

// ---------------------------------------------------------------------------
// Controle van een volledige set instellingen (vóór het starten van een spel).
// Geeft een lijst fouten terug; leeg = geldig.
// ---------------------------------------------------------------------------
export function validateConfig(config) {
  const errors = []
  const fail = (code, detail) => errors.push(detail ? { code, detail } : { code })
  if (!config || typeof config !== 'object') return [{ code: 'config_invalid' }]

  const players = Array.isArray(config.players) ? config.players : null
  if (!players || players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) fail('players_count')
  else {
    const ids = new Set()
    const names = new Set()
    for (const p of players) {
      if (!Number.isInteger(p?.id) || p.id < 0 || p.id >= MAX_PLAYERS || ids.has(p.id)) fail('player_id', p?.id)
      ids.add(p?.id)
      const n = normalizePlayerName(p?.name)
      if (n.error || n.name !== p.name) fail('player_name', p?.name)
      else if (names.has(nameKey(p.name))) fail('player_duplicate', p.name)
      names.add(nameKey(p?.name ?? ''))
    }
  }

  if (!Number.isInteger(config.rounds) || config.rounds < MIN_ROUNDS || config.rounds > MAX_ROUNDS) fail('rounds')

  if (config.priceCents == null) fail('price_missing')
  else if (!Number.isInteger(config.priceCents) || config.priceCents < 0 || config.priceCents > MAX_PRICE_CENTS) fail('price_invalid')

  const pool = Array.isArray(config.pool) ? config.pool : null
  if (!pool) fail('pool_invalid')
  else {
    if (pool.some((id) => !ORDER.has(id))) fail('pool_unknown_id')
    if (new Set(pool).size !== pool.length) fail('pool_duplicate')
    if (!pool.includes(OTHER_ID)) fail('pool_missing_overig')
  }

  const mega = Array.isArray(config.mega) ? config.mega : null
  if (!mega) fail('mega_invalid')
  else {
    if (mega.includes(OTHER_ID)) fail('mega_overig')
    if (new Set(mega).size !== mega.length) fail('mega_duplicate')
    if (pool && mega.some((id) => id !== OTHER_ID && !pool.includes(id))) fail('mega_not_in_pool')
  }

  if (players && pool && Number.isInteger(config.rounds) && !errors.some((e) => e.code === 'players_count' || e.code === 'rounds')) {
    const lots = pool.length - players.length * config.rounds
    if (lots < 0) fail('pool_too_small', lots)
    if (lots > MAX_AUCTION_LOTS) fail('pool_too_large', lots)
  }
  return errors
}

export class ConfigError extends Error {
  constructor(errors) {
    super(`ongeldige spelinstellingen: ${errors.map((e) => e.code).join(', ')}`)
    this.errors = errors
  }
}

// Geldige instellingen in vaste vorm: pool en MEGA in overzichtsvolgorde,
// kopieën (geen gedeelde verwijzingen met de invoer).
export function normalizeConfig(config) {
  const errors = validateConfig(config)
  if (errors.length) throw new ConfigError(errors)
  return {
    players: config.players.map(({ id, name }) => ({ id, name })),
    rounds: config.rounds,
    priceCents: config.priceCents,
    pool: sortResults(config.pool),
    mega: sortResults(config.mega),
  }
}
