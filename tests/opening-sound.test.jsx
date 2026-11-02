// F13b: geluid en opbouw van de opening (zonder echte audio).
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LOOP_RATE, LOOP_SECONDS, bonusEvents, prepareSlot, slotLoopChannels } from '../src/audio/openingSound.js'
import { introTimeline } from '../src/lobby/playRules.js'
import { BonusTrigger, bonusStage } from '../src/online/intro/StartIntro.jsx'

const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length)

describe('wachtkamer: casino-fruitautomaat (lus)', () => {
  const [L, R] = slotLoopChannels(LOOP_RATE)

  it('stereo, juiste lengte, vaste luidheid en geen oversturing', () => {
    expect(L.length).toBe(Math.round(LOOP_RATE * LOOP_SECONDS))
    expect(R.length).toBe(L.length)
    for (const ch of [L, R]) {
      expect(rms(ch)).toBeGreaterThan(0.12)
      expect(rms(ch)).toBeLessThan(0.2)
      expect(ch.every((v) => Math.abs(v) <= 1)).toBe(true)
    }
    // links en rechts verschillen (rollen en casinolaag verdeeld over de ruimte)
    let diff = 0
    for (let i = 0; i < L.length; i++) diff += Math.abs(L[i] - R[i])
    expect(diff / L.length).toBeGreaterThan(0.01)
  })

  it('naadloos: de overgang van einde naar begin is niet groter dan sprongen binnen de lus', () => {
    for (const ch of [L, R]) {
      const steps = []
      for (let i = 1; i < ch.length; i++) steps.push(Math.abs(ch[i] - ch[i - 1]))
      steps.sort((a, b) => a - b)
      const wrap = Math.abs(ch[0] - ch[ch.length - 1])
      expect(wrap).toBeLessThanOrEqual(steps.at(-1))
    }
  })

  it('herkenbare ratel: per rol een vast aantal tikken per lus (hoorbare pieken)', () => {
    // Energie in korte vensters: de tikken steken duidelijk boven de rest uit.
    const win = Math.round(LOOP_RATE * 0.004)
    const e = []
    for (let i = 0; i + win < L.length; i += win) e.push(rms(L.subarray(i, i + win)))
    const sorted = [...e].sort((a, b) => a - b)
    expect(sorted.at(-1) / sorted[Math.floor(sorted.length / 2)]).toBeGreaterThan(2)
  })

  it('reproduceerbaar (zelfde lus op elk toestel) en zonder casinolaag rustiger', () => {
    const [L2] = slotLoopChannels(LOOP_RATE)
    expect(L2).toEqual(L)
    const [Lq] = slotLoopChannels(LOOP_RATE, { ambience: false })
    expect(Lq).not.toEqual(L)
  })

  it('opwekken in stapjes (geen lange blokkade) levert dezelfde lus', async () => {
    const [a] = await prepareSlot(true)
    expect(a).toEqual(L)
  })
})

describe('BONUSSPEL v2: opbouw', () => {
  const tl = introTimeline(4, 2)

  it('stappen lopen alleen op: lampjes → 3 munten → BONUSSPEL! → intenser → fanfare → finale', () => {
    let last = -1
    const seen = new Set()
    for (let t = 0; t < tl.namesAt; t += 50) {
      const s = bonusStage(t, tl)
      expect(s).toBeGreaterThanOrEqual(last)
      last = s
      seen.add(s)
    }
    expect([...seen]).toEqual([0, 1, 2, 4, 5, 6, 7, 8]) // derde munt = BONUSSPEL! (stap 4)
    expect(bonusStage(0, tl)).toBe(0)
    expect(bonusStage(tl.bonusAt, tl)).toBe(4)
    expect(bonusStage(tl.fanfareAt, tl)).toBe(7)
    expect(bonusStage(1000, introTimeline(4, 1))).toBeNull() // versie 1 ongewijzigd
  })

  it('scherm per stap: munten blijven, titel pas na de derde munt, finale met extra confetti', () => {
    const html = (t) => renderToStaticMarkup(<BonusTrigger t={t} tl={tl} matchName="A – B" />)
    const start = html(200)
    expect(start).toContain('is-lights-on')
    expect(start).toContain('WARMING UP')
    expect(start).not.toContain('aria-label="BONUSSPEL!"')
    const bonus = html(tl.bonusAt + 10)
    expect(bonus).toContain('aria-label="BONUSSPEL!"')
    expect(bonus).toContain('bonus-stage-4')
    expect((bonus.match(/mini-reel is-landed/g) ?? []).length).toBe(3) // drie gouden munten
    expect(html(tl.buildSteps[0] + 10)).toContain('bonus-rays-2')
    const finale = html(tl.finaleAt + 10)
    expect(finale).toContain('bonus-stage-8')
    expect(finale).toContain('bonus-flash-3')
    // versie 1: zelfde opmaak als voorheen (geen v2-klassen)
    expect(renderToStaticMarkup(<BonusTrigger t={3000} tl={introTimeline(4, 1)} matchName="A – B" />)).not.toContain('bonus-v2')
  })

  it('geluid: alles binnen BONUSSPEL, op volgorde; versie 1 ongewijzigd', () => {
    const ev = bonusEvents(tl)
    const ats = ev.map((e) => e.at)
    expect(ats).toEqual([...ats].sort((a, b) => a - b))
    expect(ats[0]).toBe(0)
    expect(ats.at(-1)).toBeLessThan(tl.namesAt)
    expect(ev.filter((e) => tl.coinStops.includes(e.at))).toHaveLength(4) // 3 munten + bonus-inslag op de derde
    expect(ev.some((e) => e.at === tl.fanfareAt)).toBe(true)
    expect(ev.some((e) => e.at === tl.finaleAt)).toBe(true)
    expect(bonusEvents(introTimeline(4, 1))).toHaveLength(5) // 3 munten, opbouw, fanfare
  })
})
