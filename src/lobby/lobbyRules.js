// Regels van de wachtkamer (multiplayer): kamer aanmaken, aanmelden,
// spelregels als concept, volgorde, verwijderen en starten.
//
// Puur en zonder opslag of netwerk: de nagebootste server (mock, F7) én de
// echte server (Edge Function, F3) gebruiken dezelfde regels. Elke functie
// krijgt een kamer-object en geeft een nieuw object terug, of gooit een
// LobbyError met een vaste code.
//
// Kamer:
//   { id, code, organizerId, phase: 'lobby' | 'started', version,
//     match: { home, away },               // wedstrijd (vast na aanmaken)
//     organizerName,                       // naam van de organisator (ook als hij niet meespeelt)
//     players: [{ slot, userId, name, manual? }],  // deelnemers in aanmeldvolgorde (slot = vast id 0–11);
//                                          // manual: zonder eigen telefoon, op het toestel van de organisator
//     order: [slot],                       // speelvolgorde (ronde 1)
//     draft: { maxPlayers, rounds, priceCents, pool, mega },  // spelregels
//     removedUserIds: [userId],            // voor de melding "je bent verwijderd"
//     state,                               // spelstatus van de engine, na de start
//     startedAt,                           // servertijd van de start (gezamenlijke startanimatie)
//     announce,                            // laatste bevestigde veiling { participant, bidCents, lot, at }
//     ack }                                // faseovergangen door de organisator { auctionStart, finish }

import { MAX_AUCTION_LOTS, MAX_PLAYERS, MIN_PLAYERS, MAX_PRICE_CENTS, MAX_ROUNDS, MEGA_WIN_IDS, OTHER_ID, RESULTS, ALL_RESULTS } from '../game/config.js'
import { createInitialState } from '../game/engine.js'
import { nameKey, normalizePlayerName, sortResults, validateConfig } from '../game/gameConfig.js'
import { secureRandomInt } from '../game/random.js'

// Tijdlijnversie van de gezamenlijke opening voor nieuwe spellen (zie
// playRules.js → introTimeline); per kamer vastgelegd bij de start.
export const INTRO_VERSION = 2

export class LobbyError extends Error {
  constructor(code, detail) {
    super(code)
    this.code = code
    this.detail = detail
  }
}

const ALL_IDS = new Set(ALL_RESULTS.map((r) => r.id))
export const MAX_POOL = ALL_RESULTS.length // 50
export const MAX_CLUB_LENGTH = 30

// B2: een nieuw spel begint blanco: geen aantal deelnemers, geen rondes,
// geen prijs. Alleen OVERIG is (altijd) geselecteerd, geen MEGA.
export function blankDraft() {
  return { maxPlayers: null, rounds: null, priceCents: null, pool: [OTHER_ID], mega: [] }
}

// Clubnaam: spaties aan begin en eind weg, verder zoals ingevoerd.
export function normalizeClub(raw) {
  if (typeof raw !== 'string') return { error: 'club_invalid' }
  const trimmed = raw.trim().replace(/\s+/g, ' ')
  if (/\p{Cc}/u.test(trimmed)) return { error: 'club_invalid' }
  const n = [...trimmed].length
  if (n < 1) return { error: 'club_empty' }
  if (n > MAX_CLUB_LENGTH) return { error: 'club_too_long' }
  return { name: trimmed }
}

// Speltitel: "Thuisploeg – Uitploeg".
export const matchName = (match) => (match ? `${match.home} – ${match.away}` : '')

// Aantal deelnemers uit een invoerveld: "9" → 9; leeg → null.
export function parsePlayerCount(text) {
  const t = String(text ?? '').trim()
  if (t === '') return { count: null }
  if (!/^\d{1,2}$/.test(t)) return { error: 'players_invalid' }
  const count = Number(t)
  if (count < MIN_PLAYERS || count > MAX_PLAYERS) return { error: 'players_invalid' }
  return { count }
}

// Snelkeuzes (worden nooit automatisch toegepast).
export const PRESETS = {
  standard: () => RESULTS.map((r) => r.id), // 0-0 t/m 4-4 + Overige
  all: () => ALL_RESULTS.map((r) => r.id),
  clear: () => [OTHER_ID],
  standardMega: (pool) => MEGA_WIN_IDS.filter((id) => pool.includes(id)),
}

// ---------------------------------------------------------------------------
// Selecteren (scherm "Nieuw spel" / spelregels): pure hulpfuncties op
// { pool, mega }. OVERIG zit altijd in de pool en is nooit MEGA WIN; een
// uitslag die uit de pool gaat, verliest zijn MEGA WIN.
// ---------------------------------------------------------------------------
export function togglePoolResult({ pool, mega }, id) {
  if (id === OTHER_ID || !ALL_IDS.has(id)) return { pool, mega }
  if (pool.includes(id)) return { pool: pool.filter((x) => x !== id), mega: mega.filter((x) => x !== id) }
  return { pool: sortResults([...pool, id]), mega }
}
export function toggleMegaResult({ pool, mega }, id) {
  if (id === OTHER_ID || !pool.includes(id)) return { pool, mega }
  return { pool, mega: mega.includes(id) ? mega.filter((x) => x !== id) : sortResults([...mega, id]) }
}
export function choosePool({ mega }, ids) {
  const pool = sortResults([...new Set([...ids.filter((id) => ALL_IDS.has(id)), OTHER_ID])])
  return { pool, mega: mega.filter((x) => pool.includes(x) && x !== OTHER_ID) }
}
// Uitslagen die op het tabblad MEGA WIN staan: alleen de gekozen gewone uitslagen.
export const megaCandidates = (pool) => pool.filter((id) => id !== OTHER_ID)

const playerName = (raw) => {
  const n = normalizePlayerName(raw)
  if (n.error) throw new LobbyError(n.error)
  return n.name
}

export const isOrganizer = (room, userId) => room.organizerId === userId
export const playerOf = (room, userId) => (userId ? (room.players.find((p) => p.userId === userId) ?? null) : null)
// Lid van de kamer: deelnemer, of organisator (ook als hij zelf niet meespeelt).
export const isMember = (room, userId) => isOrganizer(room, userId) || !!playerOf(room, userId)
const requireLobby = (room) => {
  if (room.phase !== 'lobby') throw new LobbyError('registration_closed')
}
const requireOrganizer = (room, userId) => {
  if (!isOrganizer(room, userId)) throw new LobbyError('not_organizer')
}
const bump = (room, changes) => ({ ...room, ...changes, version: room.version + 1 })

const clubName = (raw, field) => {
  const c = normalizeClub(raw)
  if (c.error) throw new LobbyError(c.error, field)
  return c.name
}

// ---------------------------------------------------------------------------
// Kamer aanmaken: de organisator stelt eerst het volledige spel in (naam,
// thuisploeg, uitploeg, aantal deelnemers, prijs, rondes, uitslagen, MEGA).
// Alleen een geldig spel wordt aangemaakt; de organisator is meteen speler 1.
// De clubnamen liggen daarna vast.
// ---------------------------------------------------------------------------
export function createRoom({ id, code, userId, name, home, away, draft }) {
  const organizer = playerName(name)
  const match = { home: clubName(home, 'home'), away: clubName(away, 'away') }
  const clean = normalizeDraft(draft)
  const status = draftStatus(clean)
  if (!status.ok) throw new LobbyError('settings_invalid', status.issues.map((i) => i.code))
  return {
    id,
    code,
    organizerId: userId,
    phase: 'lobby',
    version: 1,
    match,
    organizerName: organizer,
    players: [{ slot: 0, userId, name: organizer }],
    order: [0],
    draft: clean,
    removedUserIds: [],
    state: null,
  }
}

// Maximum aantal deelnemers van deze kamer (ingesteld door de organisator).
export const maxPlayersOf = (room) => room.draft.maxPlayers ?? MAX_PLAYERS

// ---------------------------------------------------------------------------
// Aanmelden: unieke naam (D4), max. 12, alleen vóór de start. Wie al
// meedoet, krijgt zijn eigen plek terug (terugkeren, geen nieuwe naam nodig).
// ---------------------------------------------------------------------------
export function joinRoom(room, { userId, name }) {
  const existing = playerOf(room, userId)
  if (existing) return { room, player: existing, rejoined: true }
  requireLobby(room)
  const player = newPlayer(room, { userId, name })
  const next = bump(room, {
    players: [...room.players, player],
    order: [...room.order, player.slot],
    removedUserIds: room.removedUserIds.filter((u) => u !== userId), // opnieuw aanmelden mag (B6)
  })
  return { room: next, player, rejoined: false }
}

// Nieuwe deelnemer: vrije plek, unieke naam (hoofdletterongevoelig), kleinste vrije slot.
function newPlayer(room, { userId, name, manual = false }) {
  if (room.players.length >= maxPlayersOf(room)) throw new LobbyError('room_full')
  const clean = playerName(name)
  if (room.players.some((p) => nameKey(p.name) === nameKey(clean))) throw new LobbyError('name_taken')
  const used = new Set(room.players.map((p) => p.slot))
  let slot = 0
  while (used.has(slot)) slot++
  return manual ? { slot, userId: null, name: clean, manual: true } : { slot, userId, name: clean }
}

// Organisator voegt een deelnemer zonder eigen telefoon toe. Die blijft het
// hele spel gekoppeld aan het toestel van de organisator (geen userId, dus
// later ook niet via een eigen toestel over te nemen).
export function addManualPlayer(room, { userId, name }) {
  requireOrganizer(room, userId)
  requireLobby(room)
  const player = newPlayer(room, { name, manual: true })
  return { room: bump(room, { players: [...room.players, player], order: [...room.order, player.slot] }), player }
}

// Organisator speelt (weer) zelf mee, met zijn eigen naam, als er plek is.
export function joinSelf(room, { userId }) {
  requireOrganizer(room, userId)
  return joinRoom(room, { userId, name: room.organizerName })
}

// Organisator verwijdert een deelnemer, alleen vóór de start (met bevestiging
// in het scherm). Ook zichzelf: dan blijft hij organisator maar speelt niet mee.
export function removePlayer(room, { userId, slot }) {
  requireOrganizer(room, userId)
  requireLobby(room)
  const target = room.players.find((p) => p.slot === slot)
  if (!target) throw new LobbyError('player_not_found')
  const self = target.userId === room.organizerId
  return bump(room, {
    players: room.players.filter((p) => p.slot !== slot),
    order: room.order.filter((s) => s !== slot),
    removedUserIds: self || !target.userId ? room.removedUserIds : [...room.removedUserIds, target.userId],
  })
}

// B5: volgorde handmatig (slepen/pijltjes) of loten.
export function setOrder(room, { userId, order }) {
  requireOrganizer(room, userId)
  requireLobby(room)
  const current = [...room.order].sort((a, b) => a - b)
  const proposed = Array.isArray(order) ? [...order].sort((a, b) => a - b) : null
  if (!proposed || JSON.stringify(current) !== JSON.stringify(proposed)) throw new LobbyError('invalid_order')
  return bump(room, { order: [...order] })
}

export function shuffleOrder(room, { userId, randomInt = secureRandomInt }) {
  requireOrganizer(room, userId)
  requireLobby(room)
  const order = [...room.order]
  for (let i = order.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return bump(room, { order })
}

// ---------------------------------------------------------------------------
// Spelregels in concept. Mag ook (nog) niet kloppen: het aantal spelers kan
// nog veranderen. Alleen vorm en grenzen worden hier gecontroleerd.
// ---------------------------------------------------------------------------
export function normalizeDraft(draft) {
  const bad = (field) => new LobbyError('invalid_settings', field)
  if (!draft || typeof draft !== 'object') throw bad('draft')
  const { maxPlayers = null, rounds = null, priceCents = null, pool, mega = [] } = draft
  if (maxPlayers !== null && (!Number.isInteger(maxPlayers) || maxPlayers < MIN_PLAYERS || maxPlayers > MAX_PLAYERS)) throw bad('maxPlayers')
  if (rounds !== null && (!Number.isInteger(rounds) || rounds < 1 || rounds > MAX_ROUNDS)) throw bad('rounds')
  if (priceCents !== null && (!Number.isInteger(priceCents) || priceCents < 0 || priceCents > MAX_PRICE_CENTS)) throw bad('priceCents')
  if (!Array.isArray(pool) || pool.some((id) => !ALL_IDS.has(id)) || new Set(pool).size !== pool.length) throw bad('pool')
  if (!Array.isArray(mega) || mega.some((id) => !pool.includes(id) || id === OTHER_ID) || new Set(mega).size !== mega.length) throw bad('mega')
  const withOther = pool.includes(OTHER_ID) ? pool : [...pool, OTHER_ID] // OVERIG altijd mee
  return { maxPlayers, rounds, priceCents, pool: sortResults(withOther), mega: sortResults(mega) }
}

// In de wachtkamer: het aantal deelnemers blijft verplicht en kan niet lager
// dan het aantal aangemelde deelnemers.
export function updateSettings(room, { userId, draft }) {
  requireOrganizer(room, userId)
  requireLobby(room)
  const clean = normalizeDraft(draft)
  if (clean.maxPlayers == null) throw new LobbyError('invalid_settings', 'maxPlayers')
  if (clean.maxPlayers < room.players.length) throw new LobbyError('max_below_players', room.players.length)
  return bump(room, { draft: clean })
}

// ---------------------------------------------------------------------------
// Controle (B3): klopt het concept?
//   vaste trekkingen = deelnemers × rondes
//   veilinguitslagen = geselecteerde uitslagen (incl. OVERIG) − vaste trekkingen
// Geldig bij 0 t/m 10 veilinguitslagen. `playerCount`: standaard het
// ingestelde aantal deelnemers; de start rekent met de aangemelde spelers.
// Geeft codes en getallen; de schermen maken er gewone taal van.
// ---------------------------------------------------------------------------
export function draftStatus(draft, playerCount = draft.maxPlayers) {
  const issues = []
  const selected = draft.pool.length
  if (playerCount == null) issues.push({ code: 'players_missing' })
  if (!draft.rounds) issues.push({ code: 'rounds_missing' })
  if (draft.priceCents == null) issues.push({ code: 'price_missing' })
  let fixed = null
  let min = null
  let max = null
  let auction = null
  if (draft.rounds && playerCount != null) {
    fixed = playerCount * draft.rounds
    min = fixed
    max = Math.min(fixed + MAX_AUCTION_LOTS, MAX_POOL)
    auction = selected - fixed
    if (selected < min) issues.push({ code: 'too_few', count: min - selected })
    else if (selected > max) issues.push({ code: 'too_many', count: selected - max })
  }
  const ok = issues.length === 0
  return { ok, issues, players: playerCount, rounds: draft.rounds, selected, fixed, min, max, auction, lots: ok ? auction : null }
}

// Volledige controle van het formulier "Nieuw spel" (zelfde regels als de
// server bij createRoom). Velden die leeg zijn staan in `missing`, ongeldige
// invoer in `errors` (per veld), en `status` = draftStatus.
export function setupStatus({ name, home, away, draft }) {
  const missing = []
  const errors = {}
  const n = normalizePlayerName(name ?? '')
  if (n.error === 'name_empty') missing.push('name')
  else if (n.error) errors.name = n.error
  for (const [field, value] of [
    ['home', home],
    ['away', away],
  ]) {
    const c = normalizeClub(value ?? '')
    if (c.error === 'club_empty') missing.push(field)
    else if (c.error) errors[field] = c.error
  }
  const status = draftStatus(draft)
  for (const i of status.issues) {
    if (i.code === 'players_missing') missing.push('players')
    if (i.code === 'price_missing') missing.push('price')
    if (i.code === 'rounds_missing') missing.push('rounds')
  }
  const ok = missing.length === 0 && Object.keys(errors).length === 0 && status.ok
  return { ok, missing, errors, status }
}

// Spelinstellingen voor de engine, in de vastgelegde volgorde.
export function lobbyConfig(room) {
  const bySlot = new Map(room.players.map((p) => [p.slot, p]))
  return {
    players: room.order.map((slot) => ({ id: slot, name: bySlot.get(slot).name })),
    rounds: room.draft.rounds,
    priceCents: room.draft.priceCents,
    pool: room.draft.pool,
    mega: room.draft.mega,
  }
}

// Starten (één druk op "Start het spel", D8): zet deelnemers, volgorde en
// spelregels definitief vast; daarna kan niemand meer aansluiten. Alleen als
// het aantal deelnemers precies gelijk is aan het ingestelde aantal en alle
// spelregels kloppen. `expectedVersion`: de stand die de organisator zag; is
// de kamer intussen gewijzigd, dan start het spel niet (geen dubbele start).
// `now` (servertijd) is het gezamenlijke beginpunt van de startanimatie.
export function startGame(room, { userId, expectedVersion, now = Date.now() }) {
  requireOrganizer(room, userId)
  requireLobby(room)
  if (expectedVersion != null && expectedVersion !== room.version) throw new LobbyError('room_changed')
  if (room.players.length !== maxPlayersOf(room)) throw new LobbyError('players_incomplete', room.players.length)
  const status = draftStatus(room.draft, room.players.length)
  if (!status.ok) throw new LobbyError('settings_invalid', status.issues.map((i) => i.code))
  const config = lobbyConfig(room)
  const errors = validateConfig(config)
  if (errors.length) throw new LobbyError('settings_invalid', errors.map((e) => e.code))
  // awaitPlay: na de opening wachten alle telefoons op "START SPEL" (game v3).
  return bump(room, { phase: 'started', state: createInitialState(config), startedAt: now, announce: null, awaitPlay: true, playAt: null, intro: INTRO_VERSION })
}

// ---------------------------------------------------------------------------
// Wat een telefoon van de kamer te zien krijgt. Deelnemers zien in de
// wachtkamer geen spelregels (B9); niemand ziet andermans gebruikers-id.
// ---------------------------------------------------------------------------
// Deelnemers zien in de wachtkamer alleen de namen, in aanmeldvolgorde
// (geen nummers, geen volgorde, geen spelregels; B9 aangepast).
export function roomView(room, userId) {
  const me = playerOf(room, userId)
  const org = isOrganizer(room, userId)
  const started = room.phase === 'started'
  const byOrder = room.order.map((slot) => room.players.find((x) => x.slot === slot))
  return {
    id: room.id,
    code: room.code,
    phase: room.phase,
    version: room.version,
    match: room.match,
    matchName: matchName(room.match),
    maxPlayers: maxPlayersOf(room),
    organizerName: room.organizerName,
    isOrganizer: org,
    mySlot: me?.slot ?? null,
    // Deelnemers die dit toestel mag bedienen: eigen plek + (organisator)
    // deelnemers zonder telefoon.
    controlSlots: room.players.filter((p) => (p.userId && p.userId === userId) || (org && p.manual)).map((p) => p.slot),
    players:
      org || started
        ? byOrder.map((p) => ({ slot: p.slot, name: p.name, isOrganizer: p.userId === room.organizerId, isMe: !!p.userId && p.userId === userId, manual: !!p.manual }))
        : room.players.map((p) => ({ slot: p.slot, name: p.name })),
    draft: org ? room.draft : null,
    state: started ? room.state : null,
    startedAt: started ? room.startedAt : null,
    announce: started ? (room.announce ?? null) : null,
    ack: started ? (room.ack ?? {}) : null, // faseovergangen, vastgelegd door de organisator
    awaitPlay: started ? !!room.awaitPlay : false, // Las Vegas-scherm wacht op "START SPEL"
    intro: started ? (room.intro ?? 1) : null, // tijdlijnversie van de opening
    playAt: started ? (room.playAt ?? null) : null, // gezamenlijk vertrekmoment na "START SPEL"
  }
}

// Korte informatie bij het opzoeken van een kamer (vóór aanmelden).
export function roomSummary(room, userId) {
  return {
    id: room.id,
    code: room.code,
    phase: room.phase,
    matchName: matchName(room.match),
    organizerName: room.organizerName,
    playerCount: room.players.length,
    maxPlayers: maxPlayersOf(room),
    full: room.players.length >= maxPlayersOf(room),
    mySlot: playerOf(room, userId)?.slot ?? null,
    isOrganizer: isOrganizer(room, userId),
    removed: room.removedUserIds.includes(userId),
  }
}

// ---------------------------------------------------------------------------
// Prijsinvoer: "10", "7,50", "7.5", "€ 0" → centen; leeg → null.
// ---------------------------------------------------------------------------
export function parsePrice(text) {
  const t = String(text ?? '').replace(/€/g, '').replace(/\s/g, '')
  if (t === '') return { cents: null }
  if (!/^\d{1,5}([.,]\d{0,2})?$/.test(t)) return { error: 'price_invalid' }
  const [whole, frac = ''] = t.split(/[.,]/)
  const cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2))
  if (cents > MAX_PRICE_CENTS) return { error: 'price_invalid' }
  return { cents }
}

export function formatPriceInput(cents) {
  if (cents == null) return ''
  const euros = Math.floor(cents / 100)
  const rest = cents % 100
  return rest ? `${euros},${String(rest).padStart(2, '0')}` : String(euros)
}
