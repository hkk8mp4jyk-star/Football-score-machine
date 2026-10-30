// F1: instelbare spellen — instellingen, validatie, slangvolgorde en namen.
import { describe, expect, it } from 'vitest'
import { ALL_RESULTS, MEGA_WIN_IDS, OTHER_ID, PARTICIPANTS, RESULTS, TURN_ORDER } from '../src/game/config.js'
import {
  DEFAULT_CONFIG,
  auctionLots,
  drawTurns,
  nameKey,
  normalizeConfig,
  normalizePlayerName,
  sortResults,
  turnOrder,
  validateConfig,
} from '../src/game/gameConfig.js'
import { SCORES, makeConfig, players } from './helpers.js'

const codes = (config) => validateConfig(config).map((e) => e.code)

describe('uitslagen: 0-0 t/m 6-6 plus Overige', () => {
  it('50 unieke uitslagen, OVERIG als laatste', () => {
    const ids = ALL_RESULTS.map((r) => r.id)
    expect(ids).toHaveLength(50)
    expect(new Set(ids).size).toBe(50)
    expect(ids).toContain('6-6')
    expect(ids.at(-1)).toBe(OTHER_ID)
    expect(ids.filter((id) => /[7-9]/.test(id))).toEqual([])
  })

  it('de standaardpool is precies de DEMO-pool, in dezelfde volgorde', () => {
    expect(DEFAULT_CONFIG.pool).toEqual(RESULTS.map((r) => r.id))
    expect(sortResults([...DEFAULT_CONFIG.pool].reverse())).toEqual(RESULTS.map((r) => r.id))
  })
})

describe('standaardinstellingen (DEMO)', () => {
  it('9 deelnemers, 2 rondes, €10, 26 uitslagen, vaste MEGA-lijst, 8 kavels', () => {
    expect(DEFAULT_CONFIG.players.map((p) => p.name)).toEqual(PARTICIPANTS)
    expect(DEFAULT_CONFIG.players.map((p) => p.id)).toEqual(PARTICIPANTS.map((_, i) => i))
    expect(DEFAULT_CONFIG).toMatchObject({ rounds: 2, priceCents: 1000 })
    expect([...DEFAULT_CONFIG.mega].sort()).toEqual([...MEGA_WIN_IDS].sort())
    expect(DEFAULT_CONFIG.mega).toEqual(sortResults(MEGA_WIN_IDS)) // in overzichtsvolgorde
    expect(drawTurns(DEFAULT_CONFIG)).toBe(18)
    expect(auctionLots(DEFAULT_CONFIG)).toBe(8)
    expect(validateConfig(DEFAULT_CONFIG)).toEqual([])
  })

  it('beurtvolgorde is identiek aan de bestaande TURN_ORDER', () => {
    expect(turnOrder(DEFAULT_CONFIG)).toEqual(TURN_ORDER)
  })
})

describe('slangvolgorde', () => {
  it('voor alle 1–12 spelers en 1–4 rondes: vooruit, achteruit, vooruit, achteruit', () => {
    for (let n = 1; n <= 12; n++) {
      for (let r = 1; r <= 4; r++) {
        const order = turnOrder({ players: players(n), rounds: r })
        expect(order).toHaveLength(n * r)
        for (let round = 1; round <= r; round++) {
          const seq = order.filter((t) => t.round === round).map((t) => t.participant)
          const forward = players(n).map((p) => p.id)
          expect(seq).toEqual(round % 2 ? forward : [...forward].reverse())
        }
      }
    }
  })

  it('volgt de vastgelegde speelvolgorde, niet de id’s', () => {
    const config = { players: [{ id: 7, name: 'Sanne' }, { id: 2, name: 'Bas' }, { id: 0, name: 'Lars' }], rounds: 3 }
    expect(turnOrder(config).map((t) => t.participant)).toEqual([7, 2, 0, 0, 2, 7, 7, 2, 0])
  })
})

describe('validatie van de instellingen', () => {
  it('alle 48 combinaties van 1–12 spelers en 1–4 rondes zijn met een passende pool mogelijk', () => {
    for (let n = 1; n <= 12; n++) {
      for (let r = 1; r <= 4; r++) {
        const fixed = n * r
        expect(fixed).toBeLessThanOrEqual(48)
        const maxLots = Math.min(10, 50 - fixed)
        for (const lots of [0, maxLots]) expect(codes(makeConfig({ n, rounds: r, lots }))).toEqual([])
        if (fixed + 11 <= 50) expect(codes(makeConfig({ n, rounds: r, lots: 11 }))).toEqual(['pool_too_large'])
        if (fixed > 1) {
          const pool = [...SCORES.slice(0, fixed - 2), OTHER_ID] // één te weinig
          expect(codes(makeConfig({ n, rounds: r, pool }))).toEqual(['pool_too_small'])
        }
      }
    }
  })

  it('12 spelers × 4 rondes met alle 50 uitslagen: 48 vast, 2 veilingkavels', () => {
    const config = makeConfig({ n: 12, rounds: 4, pool: ALL_RESULTS.map((r) => r.id) })
    expect(codes(config)).toEqual([])
    expect(drawTurns(config)).toBe(48)
    expect(auctionLots(config)).toBe(2)
  })

  it('aantal spelers en rondes binnen de grenzen', () => {
    expect(codes({ ...makeConfig(), players: [] })).toEqual(['players_count'])
    expect(codes({ ...makeConfig(), players: players(13) })).toEqual(['players_count'])
    expect(codes({ ...makeConfig(), rounds: 0 })).toEqual(['rounds'])
    expect(codes({ ...makeConfig(), rounds: 5 })).toEqual(['rounds'])
    expect(codes({ ...makeConfig(), rounds: 1.5 })).toEqual(['rounds'])
  })

  it('spelers: geldige unieke id’s en unieke, genormaliseerde namen', () => {
    const base = makeConfig({ n: 2 })
    expect(codes({ ...base, players: [{ id: 0, name: 'Lars' }, { id: 0, name: 'Bas' }] })).toEqual(['player_id'])
    expect(codes({ ...base, players: [{ id: 0, name: 'Lars' }, { id: 12, name: 'Bas' }] })).toEqual(['player_id'])
    expect(codes({ ...base, players: [{ id: 0, name: 'Lars' }, { id: 1, name: 'LARS' }] })).toEqual(['player_duplicate'])
    expect(codes({ ...base, players: [{ id: 0, name: 'lars' }, { id: 1, name: 'Bas' }] })).toEqual(['player_name']) // niet genormaliseerd
    expect(codes({ ...base, players: [{ id: 0, name: ' ' }, { id: 1, name: 'Bas' }] })).toEqual(['player_name'])
  })

  it('prijs: verplicht, €0 mag, hele centen, niet negatief', () => {
    expect(codes(makeConfig({ priceCents: null }))).toEqual(['price_missing'])
    const { priceCents: _, ...noPrice } = makeConfig()
    expect(codes(noPrice)).toEqual(['price_missing']) // veld ontbreekt
    expect(codes(makeConfig({ priceCents: 0 }))).toEqual([])
    expect(codes(makeConfig({ priceCents: 750 }))).toEqual([])
    expect(codes(makeConfig({ priceCents: -1 }))).toEqual(['price_invalid'])
    expect(codes(makeConfig({ priceCents: 7.5 }))).toEqual(['price_invalid'])
    expect(codes(makeConfig({ priceCents: '500' }))).toEqual(['price_invalid'])
  })

  it('pool: alleen bestaande uitslagen, geen dubbele, OVERIG verplicht', () => {
    const c = makeConfig({ n: 2, rounds: 1 }) // pool van 2: 0-0 + OVERIG
    expect(codes({ ...c, pool: ['0-0', '7-0'] })).toEqual(['pool_unknown_id', 'pool_missing_overig'])
    expect(codes({ ...c, pool: ['0-0', OTHER_ID, '0-0'] })).toEqual(['pool_duplicate'])
    expect(codes({ ...c, pool: ['0-0', '0-1'] })).toEqual(['pool_missing_overig'])
  })

  it('MEGA WIN: alleen uitslagen uit de pool, nooit OVERIG', () => {
    const c = makeConfig({ n: 2, rounds: 2, lots: 2 }) // pool 0-0 … 0-4 + OVERIG
    expect(codes({ ...c, mega: ['0-0', '0-4'] })).toEqual([])
    expect(codes({ ...c, mega: [OTHER_ID] })).toEqual(['mega_overig'])
    expect(codes({ ...c, mega: ['6-6'] })).toEqual(['mega_not_in_pool'])
    expect(codes({ ...c, mega: ['0-0', '0-0'] })).toEqual(['mega_duplicate'])
  })

  it('normaliseren: pool en MEGA in overzichtsvolgorde, kopie van de invoer', () => {
    const input = makeConfig({ n: 1, rounds: 1, pool: [OTHER_ID, '6-6', '0-1'], mega: ['6-6', '0-1'] })
    const cfg = normalizeConfig(input)
    expect(cfg.pool).toEqual(['0-1', '6-6', OTHER_ID])
    expect(cfg.mega).toEqual(['0-1', '6-6'])
    cfg.players[0].name = 'Anders'
    expect(input.players[0].name).toBe('Speler 1')
    expect(() => normalizeConfig({ ...input, rounds: 9 })).toThrow(/rounds/)
  })
})

describe('spelersnamen', () => {
  it('eerste letter een hoofdletter, rest zoals ingevoerd, spaties eraf', () => {
    expect(normalizePlayerName('lars')).toEqual({ name: 'Lars' })
    expect(normalizePlayerName('PATRICK')).toEqual({ name: 'PATRICK' })
    expect(normalizePlayerName('van dijk')).toEqual({ name: 'Van dijk' })
    expect(normalizePlayerName('  sanne  ')).toEqual({ name: 'Sanne' })
    expect(normalizePlayerName('émile')).toEqual({ name: 'Émile' })
    expect(normalizePlayerName('3x Bas')).toEqual({ name: '3x Bas' })
  })

  it('1 tot en met 20 tekens; leeg, te lang of met stuurtekens geweigerd', () => {
    expect(normalizePlayerName('')).toEqual({ error: 'name_empty' })
    expect(normalizePlayerName('   ')).toEqual({ error: 'name_empty' })
    expect(normalizePlayerName('a'.repeat(20))).toEqual({ name: 'A' + 'a'.repeat(19) })
    expect(normalizePlayerName('a'.repeat(21))).toEqual({ error: 'name_too_long' })
    expect(normalizePlayerName('😀'.repeat(20)).name).toBe('😀'.repeat(20)) // tekens, geen bytes
    expect(normalizePlayerName('Lars\u0000')).toEqual({ error: 'name_invalid' })
    expect(normalizePlayerName(12)).toEqual({ error: 'name_invalid' })
  })

  it('uniek ongeacht hoofdletters', () => {
    expect(nameKey('Lars')).toBe(nameKey('LARS'))
    expect(nameKey('Van Dijk')).toBe(nameKey('van dijk'))
  })
})
