// F13b: geluid en opbouw van de opening (zonder echte audio).
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LOOP_RATE, LOOP_SECONDS, bonusEvents, prepareSlot, slotLoopChannels } from '../src/audio/openingSound.js'
import { FLOOR_RATE, FLOOR_SECONDS, casinoFloorChannels, floorLoudness } from '../src/audio/casinoFloor.js'
import { introTimeline } from '../src/lobby/playRules.js'
import { BonusTrigger, bonusStage } from '../src/online/intro/StartIntro.jsx'

const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length)

// Aandeel aanhoudende toon (bromtoon/zoem): per frequentie de kleinste energie
// over alle tijdvensters (alleen een toon die steeds klinkt blijft over),
// rond de sterkste piek, t.o.v. de gemiddelde totale energie per venster.
function sustainedToneDb(L, sr) {
  const N = 4096
  const power = (x) => {
    const re = Float64Array.from(x)
    const im = new Float64Array(N)
    for (let i = 1, j = 0; i < N; i++) {
      let bit = N >> 1
      for (; j & bit; bit >>= 1) j ^= bit
      j ^= bit
      if (i < j) [re[i], re[j]] = [re[j], re[i]]
    }
    for (let len = 2; len <= N; len <<= 1) {
      const a = (-2 * Math.PI) / len
      for (let i = 0; i < N; i += len)
        for (let k = 0; k < len / 2; k++) {
          const c = Math.cos(a * k)
          const s = Math.sin(a * k)
          const p = i + k
          const q = p + len / 2
          const vr = re[q] * c - im[q] * s
          const vi = re[q] * s + im[q] * c
          re[q] = re[p] - vr
          im[q] = im[p] - vi
          re[p] += vr
          im[p] += vi
        }
    }
    return Array.from({ length: N / 2 }, (_, k) => re[k] ** 2 + im[k] ** 2)
  }
  const mins = new Float64Array(N / 2).fill(Infinity)
  let tot = 0
  let frames = 0
  for (let s = 0; s + N < L.length; s += N / 2) {
    const p = power(Array.from({ length: N }, (_, i) => L[s + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N))))
    p.forEach((v, k) => {
      mins[k] = Math.min(mins[k], v)
      tot += v
    })
    frames++
  }
  const lo = Math.round((30 * N) / sr)
  const hi = Math.round((6000 * N) / sr)
  let k0 = lo
  for (let k = lo; k < hi; k++) if (mins[k] > mins[k0]) k0 = k
  let sus = 0
  for (let k = k0 - 2; k <= k0 + 2; k++) sus += mins[k]
  return 10 * Math.log10(sus / (tot / frames))
}

describe('wachtkamer: Las Vegas Casino Floor (keuze B)', () => {
  const [L, R] = casinoFloorChannels(FLOOR_RATE)

  it('stereo, 18 s, vaste luidheid (−18 LUFS) en geen oversturing', () => {
    expect(L.length).toBe(FLOOR_RATE * FLOOR_SECONDS)
    expect(R.length).toBe(L.length)
    expect(floorLoudness(L, R, FLOOR_RATE)).toBeCloseTo(-18, 1)
    for (const ch of [L, R]) expect(ch.every((v) => Math.abs(v) < 0.96)).toBe(true)
    // ruimtelijk: links en rechts verschillen (automaten verspreid door de zaal)
    let diff = 0
    for (let i = 0; i < L.length; i++) diff += Math.abs(L[i] - R[i])
    expect(diff / L.length).toBeGreaterThan(0.01)
  })

  it('naadloos: de overgang van einde naar begin is niet groter dan sprongen binnen de lus', () => {
    for (const ch of [L, R]) {
      let max = 0
      for (let i = 1; i < ch.length; i++) max = Math.max(max, Math.abs(ch[i] - ch[i - 1]))
      expect(Math.abs(ch[0] - ch[ch.length - 1])).toBeLessThanOrEqual(max)
    }
  })

  it('geen bromtoon of zoem: aanhoudende toon ver onder het rolgeluid met motorbrom', () => {
    const floor = sustainedToneDb(L, FLOOR_RATE)
    const [reels] = slotLoopChannels(LOOP_RATE) // vorige wachtkamerlus: motorbrom 100/150 Hz
    expect(floor).toBeLessThan(-40)
    expect(sustainedToneDb(reels, LOOP_RATE)).toBeGreaterThan(floor + 10)
  })

  it('reproduceerbaar (zelfde lus op elk toestel); opwekken in stapjes levert dezelfde lus', async () => {
    expect(casinoFloorChannels(FLOOR_RATE)[0]).toEqual(L)
    const [a] = await prepareSlot('floor')
    expect(a).toEqual(L)
  }, 30_000)
})

describe('BONUSSPEL: rolgeluid (draaiende rollen tot de munten vallen)', () => {
  const [L, R] = slotLoopChannels(LOOP_RATE)

  it('stereo, juiste lengte, vaste luidheid, geen oversturing, naadloos', () => {
    expect(L.length).toBe(Math.round(LOOP_RATE * LOOP_SECONDS))
    expect(R.length).toBe(L.length)
    for (const ch of [L, R]) {
      expect(rms(ch)).toBeGreaterThan(0.12)
      expect(rms(ch)).toBeLessThan(0.2)
      expect(ch.every((v) => Math.abs(v) <= 1)).toBe(true)
      let max = 0
      for (let i = 1; i < ch.length; i++) max = Math.max(max, Math.abs(ch[i] - ch[i - 1]))
      expect(Math.abs(ch[0] - ch[ch.length - 1])).toBeLessThanOrEqual(max)
    }
  })

  it('herkenbare ratel en in stapjes opgewekt = dezelfde lus', async () => {
    const win = Math.round(LOOP_RATE * 0.004)
    const e = []
    for (let i = 0; i + win < L.length; i += win) e.push(rms(L.subarray(i, i + win)))
    const sorted = [...e].sort((a, b) => a - b)
    expect(sorted.at(-1) / sorted[Math.floor(sorted.length / 2)]).toBeGreaterThan(2)
    const [a] = await prepareSlot('reels')
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
