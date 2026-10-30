// F2: de schermcomponenten met instelbare spellen, gerenderd naar HTML.
// Plus de harde eis: de DEMO-schermen zijn exact gelijk aan vóór F2.
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import MainScreen from '../src/components/MainScreen.jsx'
import AuctionScreen from '../src/components/AuctionScreen.jsx'
import Overview from '../src/components/Overview.jsx'
import AuctionSetup from '../src/components/AuctionSetup.jsx'
import { ALL_RESULTS, OTHER_ID, REEL_SYMBOLS, REEL_SYMBOLS_EXTENDED, reelTargets } from '../src/game/config.js'
import { auctionRows, gridGoalsFor, reelSymbolsFor, turnOrder } from '../src/game/gameConfig.js'
import { buildProfile, mod } from '../src/game/reelMotion.js'
import { STOP_DELAY } from '../src/game/timeline.js'
import { deriveView } from '../src/game/view.js'
import { demoMarkup } from './demoMarkup.jsx'
import { SCORES, makeConfig, makeGame } from './helpers.js'

const ALL_IDS = ALL_RESULTS.map((r) => r.id)
const noop = () => {}

function render(state, now, { ack = {}, canSpinFor = () => true } = {}) {
  const v = deriveView(state, now, ack)
  const game = v.state
  const onMain = game.phase === 'draw' || (v.reveal && v.reveal.round !== 'veiling')
  const common = { state: game, reelSpin: v.reelSpin, reveal: v.reveal, showOther: false, canSpinFor, onSpin: noop, onSettled: noop, onOverview: noop, onMenu: noop }
  return onMain
    ? renderToStaticMarkup(<MainScreen {...common} locked={v.locked} onNext={noop} />)
    : renderToStaticMarkup(<AuctionScreen {...common} tileStage={v.tileStage} isOrganizer onPrepare={noop} onFinish={noop} />)
}
const count = (html, re) => (html.match(re) ?? []).length
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('DEMO: schermen exact gelijk aan vóór F2', () => {
  const before = JSON.parse(readFileSync(new URL('./fixtures/demo-markup-v2.json', import.meta.url), 'utf8')).screens
  const after = demoMarkup()
  for (const name of Object.keys(before)) {
    it(`identieke HTML: ${name}`, () => expect(after[name]).toBe(before[name]))
  }
  it('alle referentieschermen gecontroleerd', () => expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort()))
})

describe('rollen met 5 en 6 goals', () => {
  it('standaard 0–4 + ★ (6 symbolen); met scores boven 4: 0–6 + ★ (8 symbolen)', () => {
    expect(REEL_SYMBOLS).toBe(6)
    expect(REEL_SYMBOLS_EXTENDED).toBe(8)
    expect(reelSymbolsFor(makeConfig({ n: 2, rounds: 2, pool: ['4-4', '0-0', '1-2', OTHER_ID] }))).toBe(6)
    expect(reelSymbolsFor(makeConfig({ n: 1, rounds: 1, pool: ['5-0', OTHER_ID] }))).toBe(8)
    expect(reelSymbolsFor(makeConfig({ n: 1, rounds: 1, pool: ['0-6', OTHER_ID] }))).toBe(8)
  })

  it('doelen per rol: cijfers blijven cijfers, OVERIG = ster (altijd het laatste symbool)', () => {
    expect(reelTargets('2-3')).toEqual([2, 3])
    expect(reelTargets(OTHER_ID)).toEqual([5, 5]) // standaard: ster op plek 5 (DEMO)
    expect(reelTargets('5-6', 8)).toEqual([5, 6]) // een 5 is géén ster op de grote rol
    expect(reelTargets('6-0', 8)).toEqual([6, 0])
    expect(reelTargets(OTHER_ID, 8)).toEqual([7, 7])
  })

  it('beweging: zelfde timing, landt exact op het doel, ook bij 8 symbolen', () => {
    for (const symbols of [6, 8]) {
      for (const target of Array.from({ length: symbols }, (_, i) => i)) {
        for (const p0 of [0, 3, 17, 42]) {
          for (const ms of [3000, 4500]) {
            const prof = buildProfile(p0, target, ms, symbols)
            expect(mod(prof.land, symbols)).toBe(target)
            expect(prof.T).toBe(ms / 1000)
            expect(prof.at(prof.T).p).toBe(prof.land)
            expect(prof.land).toBeGreaterThan(p0 + 40) // draait voluit, geen sprong
          }
        }
      }
    }
    // Standaard (6 symbolen) exact gelijk aan het oorspronkelijke profiel.
    const a = buildProfile(4, 2, 4500)
    const b = buildProfile(4, 2, 4500, 6)
    for (const t of [0, 0.2, 1, 2.5, 4.2, 4.4, 4.5]) expect(a.at(t)).toEqual(b.at(t))
  })

  it('machine geeft de rollen het juiste aantal symbolen mee via de instellingen', () => {
    const config = makeConfig({ n: 2, rounds: 1, lots: 1, pool: ['6-6', '5-2', OTHER_ID] })
    const game = makeGame({ config })
    expect(render(game.state, game.now)).toContain('reel-window') // rendert zonder fout
    expect(reelSymbolsFor(game.state.config)).toBe(8)
  })
})

describe('spelers, beurten en rondes in de interface', () => {
  it('1–12 spelers × 1–4 rondes: juiste naam, slangvolgorde, rondebadges en teller', () => {
    for (let n = 1; n <= 12; n++) {
      for (let r = 1; r <= 4; r++) {
        const config = { ...makeConfig({ n, rounds: r, lots: 0 }), players: makeConfig({ n }).players.map((p) => ({ ...p, name: `Speler ${String.fromCharCode(65 + p.id)}` })) }
        const game = makeGame({ config })
        const order = turnOrder(game.state.config)
        for (let i = 0; i < order.length; i++) {
          game.waitForRelease() // vorige draai vastgelegd en beurt vrij
          const html = render(game.state, game.now)
          const name = `Speler ${String.fromCharCode(65 + order[i].participant)}`
          expect(html).toContain(`<span class="player-name">${name}</span>`)
          expect(count(html, /class="round[ "]/g)).toBe(r)
          expect(html).toContain(`aria-label="Ronde ${order[i].round} van ${r}"`)
          expect(text(html)).toContain(`Trekking ${i + 1} van ${n * r}`)
          const next = order[i + 1] ? `Speler ${String.fromCharCode(65 + order[i + 1].participant)}` : 'Eindstand'
          expect(text(html)).toContain(`Hierna: ${next}`)
          game.dispatch({ type: 'SPIN_START' })
        }
      }
    }
  })

  it('3 en 4 rondes krijgen compactere badges; 1 en 2 rondes ongewijzigd', () => {
    const at = (r) => {
      const game = makeGame({ config: makeConfig({ n: 2, rounds: r }) })
      return render(game.state, game.now)
    }
    expect(at(1)).toContain('class="rounds"')
    expect(at(2)).toContain('class="rounds"')
    expect(at(3)).toContain('class="rounds rounds-many"')
    expect(at(4)).toContain('class="rounds rounds-many"')
  })

  it('lange namen: alleen boven 12 tekens kleiner; tot 12 tekens ongewijzigd', () => {
    const named = (name) => {
      const config = { ...makeConfig({ n: 1, rounds: 1, pool: [OTHER_ID] }), players: [{ id: 0, name }] }
      const game = makeGame({ config })
      return render(game.state, game.now)
    }
    expect(named('Marieke')).toContain('<span class="player-name">Marieke</span>')
    expect(named('Abcdefghijkl')).toContain('<span class="player-name">Abcdefghijkl</span>') // 12
    expect(named('Abcdefghijklm')).toContain('class="player-name is-long"') // 13
    expect(named('Maximiliaan van Dijk')).toContain('class="player-name is-xlong"') // 20
  })

  it('zonder veiling: na de laatste vaste trekking "Bekijk de eindstand" in plaats van "Start de veiling"', () => {
    const game = makeGame({ config: makeConfig({ n: 2, rounds: 1, lots: 0 }) })
    game.spin()
    game.spin()
    const spin = game.state.spin
    const html = render(game.state, spin.startedAt + STOP_DELAY + 300)
    expect(text(html)).toContain('Bekijk de eindstand')
    expect(text(html)).not.toContain('Start de veiling')
    expect(deriveView(game.state, spin.startedAt + STOP_DELAY + 300).state.phase).toBe('finished')
  })

  it('met veiling blijft het "Start de veiling" (zoals in de DEMO)', () => {
    const game = makeGame({ config: makeConfig({ n: 2, rounds: 1, lots: 1 }) })
    game.spin()
    game.spin()
    const html = render(game.state, game.state.spin.startedAt + STOP_DELAY + 300)
    expect(text(html)).toContain('Start de veiling')
  })
})

describe('veilingtegels: 0–10, vaste posities', () => {
  it('indelingsregels', () => {
    const expected = { 1: [1, 0], 2: [2, 0], 3: [3, 0], 4: [4, 0], 5: [3, 2], 6: [3, 3], 7: [4, 3], 8: [4, 4], 9: [5, 4], 10: [5, 5] }
    for (const [n, [top, bottom]] of Object.entries(expected)) {
      const rows = auctionRows(Number(n))
      expect([rows.top, rows.bottom]).toEqual([top, bottom])
      expect(rows.cols).toBe(Math.max(4, top)) // nooit breder dan bij 4 per rij
    }
  })

  function atAuction(lots, sold = 0) {
    const config = makeConfig({ n: 2, rounds: 1, lots })
    const game = makeGame({ config })
    game.spin()
    game.spin()
    game.finishPending()
    game.regularLastId = game.state.lastSpin.id
    for (let i = 0; i < sold; i++) {
      game.prepare(i % 2, 1)
      game.spin()
      game.finishPending()
    }
    return game
  }
  // Lokale bevestiging 'Start de veiling' (zoals de knop in de app).
  const auctionAck = (game) => ({ auctionStart: game.regularLastId })

  it('1–10 kavels: tegels per rij boven/onder volgens de regels', () => {
    for (let lots = 1; lots <= 10; lots++) {
      const game = atAuction(lots)
      const html = render(game.state, game.now, { ack: auctionAck(game) })
      const rows = auctionRows(lots)
      expect(count(html, /class="tile tile-live"/g)).toBe(lots)
      expect(count(html, /lot-row-top/g)).toBe(1)
      expect(count(html, /lot-row-bottom/g)).toBe(rows.bottom > 0 ? 1 : 0)
      // Volgorde: bovenste rij komt vóór de machine, onderste erna.
      const iTop = html.indexOf('lot-row-top')
      const iMachine = html.indexOf('machine-holder')
      expect(iTop).toBeLessThan(iMachine)
      if (rows.bottom) expect(html.indexOf('lot-row-bottom')).toBeGreaterThan(iMachine)
      // Opmaak: alleen 4 per rij (de DEMO-indeling) zonder vaste breedte.
      const fixed = count(html, /lot-row-fixed/g)
      expect(fixed).toBe([rows.top, rows.bottom].filter((c) => c > 0 && !(c === 4 && rows.cols === 4)).length)
      if (fixed) expect(html).toContain(`--cols:${rows.cols}`)
      expect(text(html)).toContain(`van ${lots}`)
    }
  })

  it('0 kavels: geen veilingscherm, direct klaar', () => {
    const game = makeGame({ config: makeConfig({ n: 2, rounds: 1, lots: 0 }) })
    game.spin()
    game.spin()
    game.finishPending()
    expect(game.state.phase).toBe('finished')
    expect(game.state.auctionBoard).toBeNull()
  })

  it('verkochte kavels verdwijnen op hun plek; de rest schuift niet op', () => {
    const game = atAuction(10)
    const board = game.state.auctionBoard
    const order = (html) => [...html.matchAll(/class="tile tile-(live|gone)"[^>]*><div class="tile-face">(.*?)<\/div><\/div>/g)].map((m) => m[2])
    const before = order(render(game.state, game.now, { ack: auctionAck(game) }))
    const after3 = atAuction(10, 3)
    const html = render(after3.state, after3.now + 60_000, { ack: auctionAck(after3) })
    expect(order(html)).toEqual(before) // zelfde tegels op dezelfde plekken
    expect(count(html, /class="tile tile-gone"/g)).toBe(3)
    expect(count(html, /class="tile tile-live"/g)).toBe(7)
    expect(after3.state.auctionBoard).toEqual(board)
  })
})

describe('uitslagenoverzicht', () => {
  it('standaardpool: raster 0–4 (5×5) zonder uitgesloten vakken', () => {
    const game = makeGame()
    const html = renderToStaticMarkup(<Overview state={game.state} onClose={noop} />)
    expect(gridGoalsFor(game.state.config)).toEqual([0, 1, 2, 3, 4])
    expect(count(html, /class="grid-cell /g)).toBe(26)
    expect(html).not.toContain('is-excluded')
    expect(html).not.toContain('--grid-cols')
  })

  it('alle 50 uitslagen: raster 0–6 (7×7) + OVERIG, getrokken vakken met naam', () => {
    const config = { ...makeConfig({ n: 12, rounds: 4, pool: ALL_IDS }), players: makeConfig({ n: 12 }).players.map((p) => ({ ...p, name: `Naam${p.id}` })) }
    const game = makeGame({ config })
    for (let i = 0; i < 20; i++) game.spin()
    game.finishPending()
    const html = renderToStaticMarkup(<Overview state={game.state} onClose={noop} />)
    expect(count(html, /class="grid-cell /g)).toBe(50)
    expect(count(html, /is-taken/g)).toBe(20)
    expect(count(html, /is-free/g)).toBe(30)
    expect(html).toContain('--grid-cols:7')
    expect(html).toContain('grid-wide grid-7')
    for (const d of game.state.draws) expect(html).toContain(`Naam${d.participant}`)
  })

  it('deels geselecteerde pool: niet-geselecteerde uitslagen gedimd en zonder "Vrij"', () => {
    const pool = ['0-0', '1-1', '5-5', '2-5', OTHER_ID]
    const game = makeGame({ config: makeConfig({ n: 1, rounds: 1, lots: 4, pool }) })
    const html = renderToStaticMarkup(<Overview state={game.state} onClose={noop} />)
    expect(gridGoalsFor(game.state.config)).toEqual([0, 1, 2, 3, 4, 5]) // tot de hoogste score in de pool
    expect(count(html, /class="grid-cell is-excluded"/g)).toBe(36 - 4)
    expect(count(html, /is-free/g)).toBe(5)
    expect(count(html, />Vrij</g)).toBe(5)
  })

  it('per deelnemer: spelers in speelvolgorde, bedragen met de spelprijs (€0, €7,50) en biedingen', () => {
    const run = (priceCents) => {
      const config = { ...makeConfig({ n: 3, rounds: 1, lots: 2, priceCents }), players: [{ id: 4, name: 'Sanne' }, { id: 1, name: 'Bas' }, { id: 9, name: 'Lars' }] }
      const game = makeGame({ config })
      for (let i = 0; i < 3; i++) game.spin()
      game.finishPending()
      game.prepare(9, 12.25)
      game.spin()
      game.prepare(4, 0)
      game.spin()
      game.finishPending()
      return renderToStaticMarkup(<Overview state={game.state} inline initialTab="people" />)
    }
    const zero = text(run(0))
    expect(zero.indexOf('Sanne')).toBeLessThan(zero.indexOf('Bas'))
    expect(zero.indexOf('Bas')).toBeLessThan(zero.indexOf('Lars'))
    expect(zero).toMatch(/Sanne 2 uitslagen · €0 /)
    expect(zero).toMatch(/Bas 1 uitslag · €0 /)
    expect(zero).toMatch(/Lars 2 uitslagen · €12,25 /)
    const cents = text(run(750))
    expect(cents).toMatch(/Sanne 2 uitslagen · €7,50 /)
    expect(cents).toMatch(/Bas 1 uitslag · €7,50 /)
    expect(cents).toMatch(/Lars 2 uitslagen · €19,75 /)
  })
})

describe('veilingvenster', () => {
  it('toont de spelers van het spel (id’s, speelvolgorde)', () => {
    const players = [{ id: 7, name: 'Noor' }, { id: 2, name: 'Ahmed' }]
    const html = renderToStaticMarkup(<AuctionSetup players={players} initial={{ participant: 2, bid: 5 }} onConfirm={noop} onClose={noop} />)
    expect(text(html)).toMatch(/Noor Ahmed/)
    expect(html).toMatch(/aria-checked="true"[^>]*>Ahmed/)
  })
})

describe('MEGA WIN en OVERIG in de weergave', () => {
  it('eigen MEGA-lijst: draai krijgt de vlag; OVERIG nooit', () => {
    const config = makeConfig({ n: 1, rounds: 1, lots: 1, pool: ['3-3', OTHER_ID], mega: ['3-3'] })
    for (let seed = 1; seed <= 6; seed++) {
      const game = makeGame({ seed, config })
      game.spin()
      const s = game.state.spin
      expect(s.mega).toBe(s.resultId === '3-3')
    }
    expect(SCORES).toHaveLength(49)
  })
})
