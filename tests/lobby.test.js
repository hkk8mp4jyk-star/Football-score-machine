// F7: regels van de wachtkamer (lobby/lobbyRules.js) en de nagebootste
// server (online/mock/mockApi.js) met meerdere gelijktijdige "telefoons".
import { describe, expect, it } from 'vitest'
import {
  LobbyError,
  PRESETS,
  blankDraft,
  createRoom,
  draftStatus,
  formatPriceInput,
  choosePool,
  addManualPlayer,
  isMember,
  joinRoom,
  joinSelf,
  lobbyConfig,
  matchName,
  megaCandidates,
  normalizeClub,
  parsePlayerCount,
  setupStatus,
  toggleMegaResult,
  togglePoolResult,
  normalizeDraft,
  parsePrice,
  removePlayer,
  roomSummary,
  roomView,
  setOrder,
  shuffleOrder,
  startGame,
  updateSettings,
} from '../src/lobby/lobbyRules.js'
import { createMockApi } from '../src/online/mock/mockApi.js'
import { ApiError, ERROR_TEXT, errorText, inviteUrl, isValidCode, normalizeCode } from '../src/online/api.js'
import { createRealApi } from '../src/online/realApi.js'
import { countText, issueTexts, missingText, okText, poolIssueTexts } from '../src/online/lobbyText.js'
import { DEFAULT_CONFIG, validateConfig } from '../src/game/gameConfig.js'
import { ALL_RESULTS, MEGA_WIN_IDS, RESULTS } from '../src/game/config.js'

const code = (fn) => {
  try {
    fn()
  } catch (e) {
    if (e instanceof LobbyError || e instanceof ApiError) return e.code
    throw e
  }
  return 'ok'
}
const asyncCode = async (p) => {
  try {
    await p
  } catch (e) {
    if (e instanceof ApiError) return e.code
    throw e
  }
  return 'ok'
}
const STANDARD = RESULTS.map((r) => r.id)
const ORG = 'u-org'
const CLUBS = { home: 'Werder Bremen II', away: 'Bremer SV' }
// Standaard: geldig spel voor 12 deelnemers (2 rondes, 26 uitslagen → 2 veilinguitslagen).
const DRAFT12 = { maxPlayers: 12, rounds: 2, priceCents: 1000, pool: STANDARD, mega: MEGA_WIN_IDS }
const room0 = (draft = DRAFT12) => createRoom({ id: 'r1', code: 'ABCDEF', userId: ORG, name: 'lars', ...CLUBS, draft })
const withPlayers = (n, draft) => {
  let room = room0(draft)
  for (let i = 1; i < n; i++) room = joinRoom(room, { userId: `u${i}`, name: `Speler ${i}` }).room
  return room
}
const valid = (room, draft = DRAFT12) => updateSettings(room, { userId: ORG, draft })

describe('blanco beginstand (B2)', () => {
  it('nieuw spel: geen deelnemers, rondes of prijs, alleen OVERIG, geen MEGA', () => {
    expect(blankDraft()).toEqual({ maxPlayers: null, rounds: null, priceCents: null, pool: ['OVERIG'], mega: [] })
    const s = setupStatus({ name: '', home: '', away: '', draft: blankDraft() })
    expect(s.ok).toBe(false)
    expect(s.missing).toEqual(['name', 'home', 'away', 'players', 'rounds', 'price'])
    expect(s.status).toMatchObject({ fixed: null, auction: null, selected: 1 })
  })
  it('snelkeuzes bestaan maar worden niet toegepast', () => {
    expect(PRESETS.standard()).toEqual(STANDARD)
    expect(PRESETS.all()).toHaveLength(50)
    expect(PRESETS.clear()).toEqual(['OVERIG'])
    expect(PRESETS.standardMega(['0-0', '3-3', 'OVERIG'])).toEqual(['0-0'])
    expect(blankDraft().pool).toEqual(['OVERIG'])
  })
  it('blanco status: deelnemers, rondes en prijs ontbreken; kamer wordt niet aangemaakt', () => {
    const s = draftStatus(blankDraft())
    expect(s.ok).toBe(false)
    expect(s.issues.map((i) => i.code)).toEqual(['players_missing', 'rounds_missing', 'price_missing'])
    expect(code(() => room0(blankDraft()))).toBe('settings_invalid')
  })
  it('de DEMO houdt haar standaardinstellingen', () => {
    expect(DEFAULT_CONFIG.rounds).toBe(2)
    expect(DEFAULT_CONFIG.priceCents).toBe(1000)
    expect(DEFAULT_CONFIG.pool).toHaveLength(26)
  })
})

describe('kamer maken en aanmelden', () => {
  it('organisator is speler 1 met genormaliseerde naam (B1)', () => {
    const room = room0()
    expect(room.players).toEqual([{ slot: 0, userId: ORG, name: 'Lars' }])
    expect(room.order).toEqual([0])
    expect(room.organizerId).toBe(ORG)
    expect(room.match).toEqual({ home: 'Werder Bremen II', away: 'Bremer SV' })
    expect(room.draft).toEqual({ ...DRAFT12, mega: ['0-0', '0-1', '0-2', '1-0', '1-1', '1-2', '2-0', '2-1'] })
    const mk = (extra) => code(() => createRoom({ id: 'x', code: 'ABCDEF', userId: 'u', name: 'Lars', ...CLUBS, draft: DRAFT12, ...extra }))
    expect(mk({ name: '   ' })).toBe('name_empty')
    expect(mk({ name: 'a'.repeat(21) })).toBe('name_too_long')
    expect(mk({ home: '  ' })).toBe('club_empty')
    expect(mk({ away: '' })).toBe('club_empty')
    expect(mk({ away: 'x'.repeat(31) })).toBe('club_too_long')
    expect(mk({ home: 'A\u0007' })).toBe('club_invalid')
    expect(mk({})).toBe('ok')
  })
  it('aanmelden: unieke naam ongeacht hoofdletters, achteraan in de volgorde', () => {
    let room = room0()
    const r = joinRoom(room, { userId: 'u1', name: ' sanne ' })
    expect(r.player).toEqual({ slot: 1, userId: 'u1', name: 'Sanne' })
    room = r.room
    expect(room.order).toEqual([0, 1])
    expect(room.version).toBe(2)
    expect(code(() => joinRoom(room, { userId: 'u2', name: 'LARS' }))).toBe('name_taken')
    expect(code(() => joinRoom(room, { userId: 'u2', name: 'SANNE' }))).toBe('name_taken')
    expect(code(() => joinRoom(room, { userId: 'u2', name: 'x\u0007' }))).toBe('name_invalid')
  })
  it('terugkeren: zelfde gebruiker krijgt zijn plek terug, zonder nieuwe naam', () => {
    const room = joinRoom(room0(), { userId: 'u1', name: 'Sanne' }).room
    const again = joinRoom(room, { userId: 'u1', name: '' })
    expect(again.rejoined).toBe(true)
    expect(again.room).toBe(room)
    expect(again.player.name).toBe('Sanne')
    expect(joinRoom(room, { userId: ORG, name: 'Lars' }).rejoined).toBe(true)
  })
  it('ingesteld maximum: geen extra deelnemers zodra het vol is', () => {
    const room = withPlayers(3, { maxPlayers: 3, rounds: 1, priceCents: 0, pool: ['0-0', '1-1', 'OVERIG'], mega: [] })
    expect(code(() => joinRoom(room, { userId: 'u99', name: 'Vier' }))).toBe('room_full')
    expect(roomSummary(room, 'u99')).toMatchObject({ full: true, maxPlayers: 3, playerCount: 3 })
    expect(roomView(room, ORG)).toMatchObject({ maxPlayers: 3, matchName: 'Werder Bremen II – Bremer SV' })
    // na verwijderen is er weer plek
    expect(joinRoom(removePlayer(room, { userId: ORG, slot: 2 }), { userId: 'u99', name: 'Vier' }).player.slot).toBe(2)
  })
  it('maximaal 12 spelers', () => {
    const room = withPlayers(12)
    expect(room.players).toHaveLength(12)
    expect(code(() => joinRoom(room, { userId: 'u99', name: 'Dertien' }))).toBe('room_full')
    expect(roomSummary(room, 'u99').full).toBe(true)
  })
  it('vrije slots worden hergebruikt na verwijderen', () => {
    let room = withPlayers(4)
    room = removePlayer(room, { userId: ORG, slot: 2 })
    room = joinRoom(room, { userId: 'u9', name: 'Nieuw' }).room
    expect(room.players.find((p) => p.name === 'Nieuw').slot).toBe(2)
    expect(room.order).toEqual([0, 1, 3, 2])
  })
})

describe('spelregels', () => {
  it('opslaan in de wachtkamer: OVERIG altijd mee, gesorteerd; alleen de organisator', () => {
    const room = updateSettings(room0(), { userId: ORG, draft: { maxPlayers: 2, rounds: 1, priceCents: 0, pool: ['1-1', '0-0'], mega: ['1-1'] } })
    expect(room.draft).toEqual({ maxPlayers: 2, rounds: 1, priceCents: 0, pool: ['0-0', '1-1', 'OVERIG'], mega: ['1-1'] })
    expect(code(() => updateSettings(room, { userId: 'u1', draft: DRAFT12 }))).toBe('not_organizer')
  })
  it('aantal deelnemers in de wachtkamer: verplicht en niet lager dan aangemeld', () => {
    const room = withPlayers(5)
    expect(code(() => updateSettings(room, { userId: ORG, draft: { ...DRAFT12, maxPlayers: 4 } }))).toBe('max_below_players')
    expect(code(() => updateSettings(room, { userId: ORG, draft: { ...DRAFT12, maxPlayers: null } }))).toBe('invalid_settings')
    expect(updateSettings(room, { userId: ORG, draft: { ...DRAFT12, maxPlayers: 5 } }).draft.maxPlayers).toBe(5)
  })
  it('ongeldige vorm wordt geweigerd', () => {
    const bad = (draft) => code(() => normalizeDraft(draft))
    expect(bad({ ...blankDraft(), rounds: 5 })).toBe('invalid_settings')
    expect(bad({ ...blankDraft(), maxPlayers: 0 })).toBe('invalid_settings')
    expect(bad({ ...blankDraft(), maxPlayers: 13 })).toBe('invalid_settings')
    expect(bad({ ...blankDraft(), maxPlayers: 2.5 })).toBe('invalid_settings')
    expect(bad({ ...blankDraft(), rounds: 0 })).toBe('invalid_settings')
    expect(bad({ ...blankDraft(), priceCents: -1 })).toBe('invalid_settings')
    expect(bad({ ...blankDraft(), priceCents: 1_000_001 })).toBe('invalid_settings')
    expect(bad({ ...blankDraft(), priceCents: 2.5 })).toBe('invalid_settings')
    expect(bad({ ...blankDraft(), pool: ['7-7'] })).toBe('invalid_settings')
    expect(bad({ ...blankDraft(), pool: ['0-0', '0-0'] })).toBe('invalid_settings')
    expect(bad({ ...blankDraft(), pool: ['0-0', 'OVERIG'], mega: ['OVERIG'] })).toBe('invalid_settings')
    expect(bad({ ...blankDraft(), pool: ['OVERIG'], mega: ['0-0'] })).toBe('invalid_settings')
    expect(bad(null)).toBe('invalid_settings')
  })
  it('status: te weinig, te veel, klopt; rekent met het actuele aantal spelers', () => {
    const draft = { rounds: 2, priceCents: 1000, pool: STANDARD, mega: [] }
    expect(draftStatus(draft, 9)).toMatchObject({ ok: true, fixed: 18, min: 18, max: 28, lots: 8, selected: 26 })
    expect(draftStatus(draft, 13)).toMatchObject({ ok: true, fixed: 26, lots: 0 })
    expect(draftStatus({ ...draft, rounds: 3 }, 9)).toMatchObject({ ok: false, issues: [{ code: 'too_few', count: 1 }], min: 27, max: 37 })
    expect(draftStatus(draft, 2)).toMatchObject({ ok: false, issues: [{ code: 'too_many', count: 12 }], min: 4, max: 14 })
    expect(draftStatus({ ...draft, pool: ALL_RESULTS.map((r) => r.id), rounds: 4 }, 12)).toMatchObject({ ok: true, fixed: 48, max: 50, lots: 2 })
    expect(draftStatus({ ...draft, priceCents: 0 }, 9).ok).toBe(true) // €0 mag
  })
  it('rekent met het ingestelde aantal deelnemers; aantallen ook als het niet klopt', () => {
    const d = (extra) => ({ maxPlayers: 9, rounds: 2, priceCents: 1000, pool: STANDARD, mega: [], ...extra })
    expect(draftStatus(d())).toMatchObject({ ok: true, players: 9, fixed: 18, auction: 8, lots: 8 })
    expect(draftStatus(d({ maxPlayers: 4 }))).toMatchObject({ ok: false, fixed: 8, auction: 18, issues: [{ code: 'too_many', count: 8 }] })
    expect(draftStatus(d({ rounds: 3 }))).toMatchObject({ ok: false, fixed: 27, auction: -1, issues: [{ code: 'too_few', count: 1 }] })
    expect(draftStatus(d({ maxPlayers: null }))).toMatchObject({ ok: false, fixed: null, auction: null })
    expect(draftStatus(d({ maxPlayers: 4 }), 9).ok).toBe(true) // start: met de aangemelde deelnemers
  })
  it('veilinguitslagen: 0 t/m 10 geldig, 11 niet; precies genoeg = geen veiling', () => {
    const pool = (n) => ['OVERIG', ...ALL_RESULTS.map((r) => r.id).filter((id) => id !== 'OVERIG').slice(0, n - 1)]
    const st = (n) => draftStatus({ maxPlayers: 6, rounds: 2, priceCents: 0, pool: pool(n), mega: [] })
    expect(st(11)).toMatchObject({ ok: false, auction: -1, issues: [{ code: 'too_few', count: 1 }] })
    expect(st(12)).toMatchObject({ ok: true, auction: 0, lots: 0 })
    expect(st(22)).toMatchObject({ ok: true, auction: 10, lots: 10 })
    expect(st(23)).toMatchObject({ ok: false, auction: 11, issues: [{ code: 'too_many', count: 1 }] })
    // 12 × 4 met alle 50 uitslagen → 2 veilinguitslagen
    expect(draftStatus({ maxPlayers: 12, rounds: 4, priceCents: 0, pool: ALL_RESULTS.map((r) => r.id), mega: [] })).toMatchObject({ ok: true, fixed: 48, auction: 2 })
  })
  it('meldingen in gewone taal (definitieve teksten)', () => {
    const d = { maxPlayers: 9, rounds: 2, priceCents: 1000, pool: STANDARD, mega: [] }
    expect(issueTexts(draftStatus(blankDraft()))).toEqual([
      'Vul het aantal deelnemers in.',
      'Kies het aantal vaste rondes.',
      'Vul de prijs per trekking in (€0 mag ook).',
    ])
    expect(issueTexts(draftStatus({ ...d, rounds: 3 }))).toEqual(['Selecteer nog 1 uitslag om alle vaste trekkingen mogelijk te maken.'])
    expect(issueTexts(draftStatus({ ...d, rounds: 4 }))).toEqual(['Selecteer nog 10 uitslagen om alle vaste trekkingen mogelijk te maken.'])
    expect(issueTexts(draftStatus({ ...d, maxPlayers: 2 }))).toEqual(['Verwijder 12 uitslagen om maximaal 10 veilinguitslagen over te houden.'])
    expect(issueTexts(draftStatus({ ...d, maxPlayers: 7 }))).toEqual(['Verwijder 2 uitslagen om maximaal 10 veilinguitslagen over te houden.'])
    expect(poolIssueTexts(draftStatus({ ...blankDraft(), maxPlayers: 9, rounds: 1 }))).toEqual(['Selecteer nog 8 uitslagen om alle vaste trekkingen mogelijk te maken.'])
    expect(okText(draftStatus(d))).toBe('Alles klopt: 18 vaste trekkingen en 8 veilinguitslagen.')
    expect(okText(draftStatus({ ...d, maxPlayers: 12, rounds: 2, pool: STANDARD.slice(0, 23).concat('OVERIG') }))).toBe('Alles klopt: 24 vaste trekkingen en geen veiling.')
    expect(okText(draftStatus({ ...d, maxPlayers: 1, rounds: 1, pool: ['0-0', 'OVERIG'] }))).toBe('Alles klopt: 1 vaste trekking en 1 veilinguitslag.')
    expect(missingText(['rounds', 'name', 'away'])).toBe('Nog invullen: jouw naam, uitploeg en vaste rondes.')
    expect(missingText(['price'])).toBe('Nog invullen: prijs.')
    expect(missingText([])).toBeNull()
    expect(countText(null)).toBe('–')
    expect(countText(0)).toBe('0')
  })
  it('formulier Nieuw spel: alles verplicht, zelfde regels als de server', () => {
    const ok = { name: 'lars', ...CLUBS, draft: { ...DRAFT12, maxPlayers: 9 } }
    expect(setupStatus(ok)).toMatchObject({ ok: true, missing: [], errors: {} })
    expect(setupStatus({ ...ok, name: ' ' }).missing).toEqual(['name'])
    expect(setupStatus({ ...ok, home: '' }).missing).toEqual(['home'])
    expect(setupStatus({ ...ok, away: 'x'.repeat(31) }).errors).toEqual({ away: 'club_too_long' })
    expect(setupStatus({ ...ok, name: 'a\u0007' }).errors).toEqual({ name: 'name_invalid' })
    expect(setupStatus({ ...ok, draft: { ...ok.draft, priceCents: null } }).missing).toEqual(['price'])
    expect(setupStatus({ ...ok, draft: { ...ok.draft, priceCents: 0 } }).ok).toBe(true) // €0 mag
    expect(setupStatus({ ...ok, draft: { ...ok.draft, rounds: 3 } }).ok).toBe(false)
    // server: alleen een geldig spel wordt aangemaakt
    expect(code(() => createRoom({ id: 'x', code: 'ABCDEF', userId: 'u', ...ok, draft: { ...ok.draft, rounds: 3 } }))).toBe('settings_invalid')
    expect(code(() => createRoom({ id: 'x', code: 'ABCDEF', userId: 'u', ...ok, draft: { ...ok.draft, maxPlayers: 2 } }))).toBe('settings_invalid')
    expect(code(() => createRoom({ id: 'x', code: 'ABCDEF', userId: 'u', ...ok, draft: { ...ok.draft, priceCents: null } }))).toBe('settings_invalid')
  })
  it('clubnamen, wedstrijdnaam en aantal deelnemers', () => {
    expect(normalizeClub('  Werder   Bremen II ')).toEqual({ name: 'Werder Bremen II' })
    expect(normalizeClub('bremer sv')).toEqual({ name: 'bremer sv' }) // zoals ingevoerd
    expect(normalizeClub('').error).toBe('club_empty')
    expect(normalizeClub('x'.repeat(30)).name).toHaveLength(30)
    expect(normalizeClub('x'.repeat(31)).error).toBe('club_too_long')
    expect(matchName({ home: 'Werder Bremen II', away: 'Bremer SV' })).toBe('Werder Bremen II – Bremer SV')
    expect(parsePlayerCount('')).toEqual({ count: null })
    expect(parsePlayerCount('1')).toEqual({ count: 1 })
    expect(parsePlayerCount(' 12 ')).toEqual({ count: 12 })
    for (const bad of ['0', '13', '99', '-1', '2,5', 'x']) expect(parsePlayerCount(bad).error, bad).toBe('players_invalid')
  })
  it('selecteren: OVERIG altijd, MEGA alleen op gekozen uitslagen en vervalt bij uitzetten', () => {
    let sel = { pool: ['OVERIG'], mega: [] }
    sel = togglePoolResult(sel, '1-0')
    sel = togglePoolResult(sel, '0-0')
    expect(sel.pool).toEqual(['0-0', '1-0', 'OVERIG'])
    expect(togglePoolResult(sel, 'OVERIG')).toEqual(sel) // OVERIG kan niet uit
    expect(toggleMegaResult(sel, 'OVERIG')).toEqual(sel) // OVERIG nooit MEGA
    expect(toggleMegaResult(sel, '3-3')).toEqual(sel) // niet gekozen → geen MEGA
    sel = toggleMegaResult(sel, '1-0')
    sel = toggleMegaResult(sel, '0-0')
    expect(sel.mega).toEqual(['0-0', '1-0'])
    sel = togglePoolResult(sel, '1-0') // uitzetten → MEGA vervalt
    expect(sel).toEqual({ pool: ['0-0', 'OVERIG'], mega: ['0-0'] })
    expect(megaCandidates(sel.pool)).toEqual(['0-0'])
    sel = toggleMegaResult(sel, '0-0')
    expect(sel.mega).toEqual([])
    // snelkeuzes houden OVERIG en laten MEGA alleen op gekozen uitslagen
    sel = choosePool({ pool: STANDARD, mega: ['4-4', '0-0'] }, ['0-0', '1-1'])
    expect(sel).toEqual({ pool: ['0-0', '1-1', 'OVERIG'], mega: ['0-0'] })
    expect(choosePool(sel, PRESETS.clear())).toEqual({ pool: ['OVERIG'], mega: [] })
    expect(megaCandidates(PRESETS.all())).toHaveLength(49)
  })
  it('prijsinvoer', () => {
    expect(parsePrice('')).toEqual({ cents: null })
    expect(parsePrice('10')).toEqual({ cents: 1000 })
    expect(parsePrice('7,50')).toEqual({ cents: 750 })
    expect(parsePrice('7.5')).toEqual({ cents: 750 })
    expect(parsePrice('€ 0')).toEqual({ cents: 0 })
    expect(parsePrice('10000')).toEqual({ cents: 1_000_000 })
    expect(parsePrice('10000,01').error).toBe('price_invalid')
    expect(parsePrice('1,234').error).toBe('price_invalid')
    expect(parsePrice('-1').error).toBe('price_invalid')
    expect(parsePrice('abc').error).toBe('price_invalid')
    expect(formatPriceInput(null)).toBe('')
    expect(formatPriceInput(750)).toBe('7,50')
    expect(formatPriceInput(1000)).toBe('10')
    expect(formatPriceInput(5)).toBe('0,05')
  })
})

describe('volgorde en verwijderen (B5, B6)', () => {
  it('volgorde aanpassen: alleen een herschikking, alleen organisator', () => {
    const room = withPlayers(4)
    expect(setOrder(room, { userId: ORG, order: [3, 1, 0, 2] }).order).toEqual([3, 1, 0, 2])
    expect(code(() => setOrder(room, { userId: ORG, order: [0, 1, 2] }))).toBe('invalid_order')
    expect(code(() => setOrder(room, { userId: ORG, order: [0, 1, 2, 2] }))).toBe('invalid_order')
    expect(code(() => setOrder(room, { userId: ORG, order: [0, 1, 2, 9] }))).toBe('invalid_order')
    expect(code(() => setOrder(room, { userId: ORG, order: 'x' }))).toBe('invalid_order')
    expect(code(() => setOrder(room, { userId: 'u1', order: [3, 2, 1, 0] }))).toBe('not_organizer')
  })
  it('loten: Fisher–Yates met serverwillekeur, zelfde spelers, alle volgordes mogelijk', () => {
    const room = withPlayers(4)
    const seen = new Set()
    for (let i = 0; i < 400; i++) {
      const order = shuffleOrder(room, { userId: ORG }).order
      expect([...order].sort()).toEqual([0, 1, 2, 3])
      seen.add(order.join())
    }
    expect(seen.size).toBe(24)
    expect(shuffleOrder(room, { userId: ORG, randomInt: () => 0 }).order).toEqual([1, 2, 3, 0])
    expect(code(() => shuffleOrder(room, { userId: 'u2' }))).toBe('not_organizer')
  })
  it('verwijderen (met bevestiging in het scherm), alleen organisator, opnieuw aanmelden mag', () => {
    let room = withPlayers(3)
    expect(code(() => removePlayer(room, { userId: 'u1', slot: 2 }))).toBe('not_organizer')
    expect(code(() => removePlayer(room, { userId: ORG, slot: 7 }))).toBe('player_not_found')
    room = removePlayer(room, { userId: ORG, slot: 1 })
    expect(room.players.map((p) => p.slot)).toEqual([0, 2])
    expect(room.order).toEqual([0, 2])
    expect(roomSummary(room, 'u1').removed).toBe(true)
    room = joinRoom(room, { userId: 'u1', name: 'Speler 1' }).room
    expect(roomSummary(room, 'u1')).toMatchObject({ removed: false, mySlot: 1 })
  })
  it('organisator kan zichzelf verwijderen en blijft organisator; weer meedoen als er plek is', () => {
    let room = withPlayers(3, { ...DRAFT12, maxPlayers: 3, rounds: 1, pool: ['0-0', '1-1', '2-2', 'OVERIG'], mega: [] })
    room = removePlayer(room, { userId: ORG, slot: 0 })
    expect(isMember(room, ORG)).toBe(true)
    expect(roomSummary(room, ORG)).toMatchObject({ removed: false, mySlot: null, isOrganizer: true })
    expect(roomView(room, ORG)).toMatchObject({ isOrganizer: true, mySlot: null, organizerName: 'Lars' })
    // organisatorrechten blijven
    expect(setOrder(room, { userId: ORG, order: [2, 1] }).order).toEqual([2, 1])
    room = joinRoom(room, { userId: 'u9', name: 'Derde' }).room // plek is weer vrij
    expect(code(() => joinSelf(room, { userId: ORG }))).toBe('room_full')
    room = removePlayer(room, { userId: ORG, slot: 0 })
    room = joinSelf(room, { userId: ORG }).room
    expect(roomView(room, ORG).players.at(-1)).toMatchObject({ name: 'Lars', isOrganizer: true, isMe: true })
    expect(code(() => joinSelf(room, { userId: 'u1' }))).toBe('not_organizer')
  })
  it('deelnemer zonder telefoon: hoort bij het toestel van de organisator', () => {
    let room = withPlayers(2, { ...DRAFT12, maxPlayers: 4, rounds: 1, pool: ['0-0', '1-1', '2-2', 'OVERIG'], mega: [] })
    expect(code(() => addManualPlayer(room, { userId: 'u1', name: 'Opa' }))).toBe('not_organizer')
    expect(code(() => addManualPlayer(room, { userId: ORG, name: 'LARS' }))).toBe('name_taken')
    const r = addManualPlayer(room, { userId: ORG, name: 'opa' })
    room = r.room
    expect(r.player).toEqual({ slot: 2, userId: null, name: 'Opa', manual: true })
    expect(roomView(room, ORG).controlSlots).toEqual([0, 2]) // eigen plek + Opa
    expect(roomView(room, 'u1').controlSlots).toEqual([1])
    expect(code(() => joinRoom(room, { userId: 'u7', name: 'Opa' }))).toBe('name_taken') // niet via een eigen toestel
    room = addManualPlayer(room, { userId: ORG, name: 'Oma' }).room
    expect(code(() => addManualPlayer(room, { userId: ORG, name: 'Neef' }))).toBe('room_full')
    room = removePlayer(room, { userId: ORG, slot: 2 })
    expect(room.removedUserIds).toEqual([])
  })
})

const DRAFT9 = { ...DRAFT12, maxPlayers: 9 }
describe('starten (D8)', () => {
  it('starten zet spelers, volgorde en spelregels vast; de engine valideert; starttijd vastgelegd', () => {
    let room = valid(withPlayers(9), DRAFT9)
    room = setOrder(room, { userId: ORG, order: [8, 7, 6, 5, 4, 3, 2, 1, 0] })
    const started = startGame(room, { userId: ORG, expectedVersion: room.version, now: 5000 })
    expect(started.phase).toBe('started')
    expect(started.startedAt).toBe(5000)
    expect(started.state.version).toBe(3)
    expect(started.state.phase).toBe('draw')
    expect(started.state.config.players.map((p) => p.id)).toEqual([8, 7, 6, 5, 4, 3, 2, 1, 0])
    expect(started.state.config.players[8].name).toBe('Lars')
    expect(validateConfig(lobbyConfig(room))).toEqual([])
    expect(started.state.remaining).toHaveLength(26)
  })
  it('alleen de organisator, alleen als alles klopt en precies alle deelnemers er zijn', () => {
    const room = valid(withPlayers(9), DRAFT9)
    expect(code(() => startGame(room, { userId: 'u1' }))).toBe('not_organizer')
    // 8 van 9: niet starten, ook al zou het met 8 technisch kunnen (16 vast + 10 veiling)
    expect(code(() => startGame(valid(withPlayers(8), DRAFT9), { userId: ORG }))).toBe('players_incomplete')
    expect(draftStatus(DRAFT9, 8).ok).toBe(true)
    expect(code(() => startGame(valid(withPlayers(2), DRAFT9), { userId: ORG }))).toBe('players_incomplete')
    expect(code(() => startGame(valid(withPlayers(9), { ...DRAFT9, priceCents: null }), { userId: ORG }))).toBe('settings_invalid')
    expect(startGame(room, { userId: ORG }).phase).toBe('started')
  })
  it('gewijzigd intussen (bijv. iemand meldde zich af en een ander aan) → niet gestart; geen dubbele start', () => {
    let room = valid(withPlayers(9), DRAFT9)
    const seen = room.version
    room = removePlayer(room, { userId: ORG, slot: 8 })
    room = joinRoom(room, { userId: 'u99', name: 'Laatkomer' }).room
    expect(code(() => startGame(room, { userId: ORG, expectedVersion: seen }))).toBe('room_changed')
    const started = startGame(room, { userId: ORG, expectedVersion: room.version })
    expect(code(() => startGame(started, { userId: ORG, expectedVersion: started.version }))).toBe('registration_closed')
  })
  it('na de start is de registratie gesloten en alles vast', () => {
    const room = startGame(valid(withPlayers(9), DRAFT9), { userId: ORG })
    expect(code(() => joinRoom(room, { userId: 'u99', name: 'Laat' }))).toBe('registration_closed')
    expect(code(() => removePlayer(room, { userId: ORG, slot: 1 }))).toBe('registration_closed')
    expect(code(() => setOrder(room, { userId: ORG, order: room.order }))).toBe('registration_closed')
    expect(code(() => shuffleOrder(room, { userId: ORG }))).toBe('registration_closed')
    expect(code(() => updateSettings(room, { userId: ORG, draft: DRAFT9 }))).toBe('registration_closed')
    expect(code(() => addManualPlayer(room, { userId: ORG, name: 'Opa' }))).toBe('registration_closed')
    expect(code(() => startGame(room, { userId: ORG }))).toBe('registration_closed')
    // bestaande spelers kunnen wel terugkeren
    expect(joinRoom(room, { userId: 'u3', name: '' }).rejoined).toBe(true)
  })
})

describe('wat een telefoon ziet', () => {
  it('deelnemers: alleen namen in aanmeldvolgorde (geen volgorde, nummers, labels of spelregels)', () => {
    let room = valid(withPlayers(3))
    room = setOrder(room, { userId: ORG, order: [2, 0, 1] })
    const org = roomView(room, ORG)
    const p = roomView(room, 'u1')
    expect(org.draft).toEqual(room.draft)
    expect(org.isOrganizer).toBe(true)
    expect(org.players.map((x) => x.name)).toEqual(['Speler 2', 'Lars', 'Speler 1']) // volgorde: alleen organisator
    expect(p.draft).toBeNull()
    expect(p.isOrganizer).toBe(false)
    expect(p.matchName).toBe('Werder Bremen II – Bremer SV')
    expect(p.players).toEqual([
      { slot: 0, name: 'Lars' },
      { slot: 1, name: 'Speler 1' },
      { slot: 2, name: 'Speler 2' },
    ])
    expect(JSON.stringify(p)).not.toMatch(/u-org|"u1"|userId|order/)
    expect(JSON.stringify(roomSummary(room, 'x'))).not.toMatch(/u-org|"u1"|userId/)
    expect(p.state).toBeNull()
    expect(p.startedAt).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Nagebootste server: meerdere telefoons met gedeelde opslag.
// ---------------------------------------------------------------------------
function memoryStorage() {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }
}
function mockWorld() {
  const shared = memoryStorage()
  const subscribers = new Set()
  let ids = 0
  const phone = (local = memoryStorage()) => {
    const handlers = new Set()
    const channel = {
      addEventListener: (_, h) => handlers.add(h),
      postMessage: (data) => subscribers.forEach((s) => s !== handlers && s.forEach((h) => h({ data }))),
    }
    subscribers.add(handlers)
    return createMockApi({ shared, local, channel, latency: 0, newId: () => `id${++ids}` })
  }
  return { shared, phone }
}

describe('nagebootste server (mock)', () => {
  it('volledige flow met meerdere telefoons', async () => {
    const { phone } = mockWorld()
    const lars = phone()
    const sanne = phone()
    const bas = phone()
    expect(await asyncCode(lars.createRoom({ name: 'Lars', ...CLUBS, draft: blankDraft() }))).toBe('settings_invalid')
    const { roomId, code: c } = await lars.createRoom({ name: 'lars', ...CLUBS, draft: DRAFT12 })
    expect(isValidCode(c)).toBe(true)
    const seen = []
    const off = lars.subscribe(roomId, () => seen.push('change'))

    expect(await sanne.lookupRoom(c.toLowerCase())).toMatchObject({ id: roomId, phase: 'lobby', organizerName: 'Lars', matchName: 'Werder Bremen II – Bremer SV', playerCount: 1, maxPlayers: 12, mySlot: null })
    await sanne.joinRoom(c, 'sanne')
    expect(seen.length).toBe(1) // organisator kreeg een melding
    expect(await asyncCode(bas.joinRoom(c, 'SANNE'))).toBe('name_taken')
    await bas.joinRoom(c, 'Bas')

    // deelnemers kunnen geen organisatoracties doen
    for (const p of [sanne.updateSettings(roomId, DRAFT12), sanne.setOrder(roomId, [2, 1, 0]), sanne.shuffleOrder(roomId), sanne.removePlayer(roomId, 2), sanne.startGame(roomId)]) {
      expect(await asyncCode(p)).toBe('not_organizer')
    }
    expect((await sanne.getRoom(roomId)).draft).toBeNull()

    // spelregels instellen terwijl iemand zich aanmeldt
    await lars.updateSettings(roomId, { maxPlayers: 4, rounds: 1, priceCents: 0, pool: ['0-0', '1-1', '2-2'], mega: ['0-0'] })
    const noor = phone()
    await noor.joinRoom(c, 'Noor')
    let view = await lars.getRoom(roomId)
    expect(view.players.map((p) => p.name)).toEqual(['Lars', 'Sanne', 'Bas', 'Noor'])
    expect(draftStatus(view.draft, view.players.length)).toMatchObject({ ok: true, fixed: 4, lots: 0 })
    expect(await asyncCode(phone().joinRoom(c, 'Vijfde'))).toBe('room_full') // maximum 4 bereikt

    view = await lars.setOrder(roomId, [3, 2, 1, 0])
    expect(view.players.map((p) => p.name)).toEqual(['Noor', 'Bas', 'Sanne', 'Lars'])
    view = await lars.shuffleOrder(roomId)
    expect(view.players).toHaveLength(4)

    // verwijderen → melding "removed", opnieuw aanmelden kan
    await lars.removePlayer(roomId, 2)
    expect(await asyncCode(bas.getRoom(roomId))).toBe('removed')
    expect((await bas.lookupRoom(c)).removed).toBe(true)
    await bas.joinRoom(c, 'Bas')
    view = await lars.getRoom(roomId)

    // start met versiecontrole
    expect(await asyncCode(lars.startGame(roomId, view.version - 1))).toBe('room_changed')
    view = await lars.startGame(roomId, view.version)
    expect(view.phase).toBe('started')
    expect(view.state.config.players).toHaveLength(4)
    expect((await sanne.getRoom(roomId)).state.config.pool).toEqual(['0-0', '1-1', '2-2', 'OVERIG'])

    // registratie gesloten
    const late = phone()
    expect((await late.lookupRoom(c)).phase).toBe('started')
    expect(await asyncCode(late.joinRoom(c, 'Laat'))).toBe('registration_closed')
    expect(await asyncCode(late.getRoom(roomId))).toBe('room_not_found')
    // terugkeren: zelfde telefoon (opslag) → zelfde plek, ook na de start
    expect((await sanne.lookupRoom(c)).mySlot).toBe(1)
    expect(await sanne.joinRoom(c, '')).toEqual({ roomId, code: c })
    off()
  })

  it('identiteit en sessie per telefoon blijven bij herladen behouden', async () => {
    const { phone } = mockWorld()
    const local = memoryStorage()
    const a = phone(local)
    const { roomId, code: c } = await a.createRoom({ name: 'Lars', ...CLUBS, draft: DRAFT12 })
    a.session.set({ roomId, code: c })
    const reloaded = phone(local) // zelfde tabblad, opnieuw geladen
    expect(reloaded.userId).toBe(a.userId)
    expect(reloaded.session.get()).toEqual({ roomId, code: c })
    expect((await reloaded.getRoom(roomId)).isOrganizer).toBe(true)
    reloaded.session.clear()
    expect(reloaded.session.get()).toBeNull()
    const other = phone()
    expect(other.userId).not.toBe(a.userId)
  })

  it('maximaal 12 spelers, ook via nep-spelers', async () => {
    const { phone } = mockWorld()
    const org = phone()
    const { roomId, code: c } = await org.createRoom({ name: 'Lars', ...CLUBS, draft: DRAFT12 })
    for (let i = 0; i < 11; i++) await org.addFakePlayer(roomId)
    expect((await org.getRoom(roomId)).players).toHaveLength(12)
    expect(await asyncCode(org.addFakePlayer(roomId))).toBe('room_full')
    const p = phone()
    expect((await p.lookupRoom(c)).full).toBe(true)
    expect(await asyncCode(p.joinRoom(c, 'Dertien'))).toBe('room_full')
  })

  it('codes: ongeldig of onbekend', async () => {
    const { phone } = mockWorld()
    const p = phone()
    expect(await asyncCode(p.lookupRoom('abc'))).toBe('invalid_code')
    expect(await asyncCode(p.lookupRoom('ZZZZZZ'))).toBe('room_not_found')
    expect(await asyncCode(p.joinRoom('ZZZZZZ', 'Lars'))).toBe('room_not_found')
    expect(await asyncCode(p.getRoom('bestaat-niet'))).toBe('room_not_found')
    expect(normalizeCode(' k7q-m2p ')).toBe('K7QM2P')
    expect(isValidCode('K7QM2P')).toBe(true)
    expect(isValidCode('K7QM2O')).toBe(false) // geen O
    expect(isValidCode('K7QM21')).toBe(false) // geen 1
  })

  it('kamercodes uit het juiste alfabet en uniek', async () => {
    const { phone } = mockWorld()
    const p = phone()
    const codes = new Set()
    for (let i = 0; i < 30; i++) codes.add((await p.createRoom({ name: `Org ${i}`, ...CLUBS, draft: DRAFT12 })).code)
    expect(codes.size).toBe(30)
    for (const c of codes) expect(isValidCode(c)).toBe(true)
  })
})

describe('echte server (nog niet beschikbaar) en meldingen', () => {
  it('realApi: elke actie meldt "nog niet beschikbaar", geen mock-functies', async () => {
    const api = createRealApi()
    expect(api.isMock).toBe(false)
    expect(api.addFakePlayer).toBeUndefined()
    expect(await asyncCode(api.createRoom({ name: 'Lars', ...CLUBS, draft: DRAFT12 }))).toBe('not_available')
    expect(await asyncCode(api.joinRoom('ABCDEF', 'Lars'))).toBe('not_available')
    expect(typeof api.subscribe('x', () => {})).toBe('function')
  })
  it('elke foutcode van de regels heeft een tekst in gewone taal', () => {
    for (const c of ['room_not_found', 'registration_closed', 'room_full', 'name_taken', 'name_empty', 'name_too_long', 'name_invalid', 'invalid_code', 'removed', 'not_organizer', 'cannot_remove_self', 'settings_invalid', 'invalid_settings', 'invalid_order', 'player_not_found', 'room_changed', 'club_empty', 'club_too_long', 'club_invalid', 'players_invalid', 'max_below_players', 'not_available', 'network']) {
      expect(ERROR_TEXT[c], c).toBeTruthy()
    }
    expect(errorText({ code: 'iets-anders' })).toMatch(/Probeer het opnieuw/)
  })
  it('uitnodigingslink', () => {
    expect(inviteUrl('K7QM2P', { origin: 'https://x.github.io', pathname: '/repo/' })).toBe('https://x.github.io/repo/?kamer=K7QM2P')
  })
})
