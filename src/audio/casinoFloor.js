// Wachtkamergeluid "Las Vegas Casino Floor" (keuze B, 02-11-2026): alsof je
// tussen tientallen spelende fruitautomaten staat. Langzaam draaiende rollen
// vooraan, andere automaten verspreid door de zaal, korte elektronische
// casinotonen, af en toe een kleine winst met munten, zacht geroezemoes en
// galm. Alles wordt hier opgewekt (geen opnames, geen bestanden) en is
// "rond" opgebouwd: geluiden die over het einde lopen komen vooraan terug en
// ook filters en galm lopen rond -> naadloze lus zonder bromtoon.
//
// Puur (geen Web Audio): ook in tests en Node te gebruiken. Als generator in
// stappen, zodat een telefoon tussendoor kan blijven tekenen.

export const FLOOR_SECONDS = 18
export const FLOOR_RATE = 32000 // ruim genoeg voor deze klanken; de browser rekent om

function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const mtof = (m) => 440 * 2 ** ((m - 69) / 12)
const PENTA = [0, 2, 4, 7, 9]

export function* casinoFloorSteps(SR = FLOOR_RATE, { seconds = FLOOR_SECONDS, seed = 202, target = -18 } = {}) {
  const LEN = Math.round(SR * seconds)
  const r = rng(seed) // opbouw: welke automaat, wanneer, waar
  const nz = rng(seed * 7 + 1) // ruis (los van de opbouw)

  const bus = () => ({ L: new Float32Array(LEN), R: new Float32Array(LEN) })
  const place = (b, sig, t, gain, pan = 0) => {
    const a = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4
    const gl = Math.cos(a) * gain
    const gr = Math.sin(a) * gain
    let i = ((Math.round(t * SR) % LEN) + LEN) % LEN
    for (let k = 0; k < sig.length; k++) {
      b.L[i] += sig[k] * gl
      b.R[i] += sig[k] * gr
      if (++i === LEN) i = 0
    }
  }
  const biquad = (x, type, f, q = 0.707, gainDb = 0, loop = false) => {
    const w = (2 * Math.PI * Math.min(f, SR * 0.45)) / SR
    const cs = Math.cos(w)
    const al = Math.sin(w) / (2 * q)
    const A = 10 ** (gainDb / 40)
    let c
    if (type === 'lp') c = [(1 - cs) / 2, 1 - cs, (1 - cs) / 2, 1 + al, -2 * cs, 1 - al]
    else if (type === 'hp') c = [(1 + cs) / 2, -(1 + cs), (1 + cs) / 2, 1 + al, -2 * cs, 1 - al]
    else if (type === 'bp') c = [al, 0, -al, 1 + al, -2 * cs, 1 - al]
    else {
      const sq = 2 * Math.sqrt(A) * al
      c = [A * (A + 1 + (A - 1) * cs + sq), -2 * A * (A - 1 + (A + 1) * cs), A * (A + 1 + (A - 1) * cs - sq), A + 1 - (A - 1) * cs + sq, 2 * (A - 1 - (A + 1) * cs), A + 1 - (A - 1) * cs - sq]
    }
    const [b0, b1, b2, a0, a1, a2] = c.map((v) => v / c[3])
    const y = new Float32Array(x.length)
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0
    // `loop`: twee keer rond, zodat de filterstand aan het eind op het begin aansluit
    for (let pass = loop ? 0 : 1; pass < 2; pass++)
      for (let i = 0; i < x.length; i++) {
        const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2 = x1
        x1 = x[i]
        y2 = y1
        y1 = v
        if (pass) y[i] = v
      }
    return y
  }

  // --- klankbouwstenen (kort, mono) ---
  // Tikjes: een vaste set sjablonen (toonhoogte in kleine stapjes, een paar
  // ruisvarianten); scheelt duizenden losse berekeningen.
  const tickCache = new Map()
  const tick = ({ body, decay, bright }) => {
    const step = Math.round(Math.log2(body / 600) * 24) // ~halve toon
    const key = `${step}:${Math.floor(nz() * 3)}`
    let s = tickCache.get(key)
    if (!s) {
      const f = 600 * 2 ** (step / 24)
      const n = Math.round(0.03 * SR)
      s = new Float32Array(n)
      const w = (2 * Math.PI * f) / SR
      const dk = Math.exp(-1 / (decay * SR))
      const dn = Math.exp(-1 / (0.0015 * SR))
      let e = 1
      let en = bright
      for (let k = 0; k < n; k++) {
        s[k] = ((nz() * 2 - 1) * en + Math.sin(w * k) * 0.8) * e
        e *= dk
        en *= dn
      }
      s = biquad(s, 'hp', 300)
      tickCache.set(key, s)
    }
    return s
  }
  const thud = ({ freq, decay, click }) => {
    const n = Math.round(Math.min(0.25, decay * 3.5) * SR)
    const s = new Float32Array(n)
    let ph = 0
    for (let k = 0; k < n; k++) {
      const t = k / SR
      ph += (2 * Math.PI * freq * (1 + 0.6 * Math.exp(-t / 0.01))) / SR
      s[k] = Math.sin(ph) * Math.exp(-t / decay) + (nz() * 2 - 1) * click * Math.exp(-t / 0.002)
    }
    return biquad(s, 'lp', 3500)
  }
  const blips = (notes, { dur, gap, timbre, lp, decay = 0.08 }) => {
    const n = Math.round((gap * notes.length + dur + 0.25) * SR)
    const s = new Float32Array(n)
    const att = 0.006 * SR
    const dd = Math.exp(-1 / (decay * SR))
    notes.forEach((m, j) => {
      const w = (2 * Math.PI * mtof(m)) / SR
      const c = Math.cos(w)
      const sn = Math.sin(w)
      let x = 1
      let y = 0
      const st = Math.round(j * gap * SR)
      const len = Math.round((dur + 0.2) * SR)
      const hold = dur * SR
      let e = 1
      for (let k = 0; k < len && st + k < n; k++) {
        // sin(3p) en sin(5p) uit sin(p) (geen extra sinusberekeningen)
        const y2 = y * y
        const v = timbre === 'sine' ? y : timbre === 'tri' ? y - (3 * y - 4 * y * y2) / 9 + (5 * y - 20 * y * y2 + 16 * y * y2 * y2) / 25 : y + (3 * y - 4 * y * y2) / 4 + (5 * y - 20 * y * y2 + 16 * y * y2 * y2) / 9
        if (k > hold) e *= dd
        s[st + k] += v * Math.min(1, k / att) * e * 0.5
        const nx = x * c - y * sn
        y = x * sn + y * c
        x = nx
      }
    })
    return biquad(s, 'lp', lp)
  }
  const coin = () => {
    const n = Math.round(0.9 * SR)
    const s = new Float32Array(n)
    const parts = Array.from({ length: 5 }, () => [2600 + r() * 3600, 0.4 + r() * 0.6])
    const len = Math.round(0.35 * SR)
    const one = new Float32Array(len)
    const d = Math.exp(-1 / (0.08 * SR))
    for (const [f, a] of parts) {
      const w = (2 * Math.PI * f) / SR
      const c = Math.cos(w) * d
      const sn = Math.sin(w) * d
      let x = a
      let y = 0
      for (let k = 0; k < len; k++) {
        one[k] += y
        const nx = x * c - y * sn
        y = x * sn + y * c
        x = nx
      }
    }
    let t0 = 0
    let g = 1
    let gap = 0.11 + r() * 0.05
    for (let b = 0; b < 4; b++) {
      const st = Math.round(t0 * SR)
      for (let k = 0; st + k < n && k < len; k++) {
        const click = k < 0.008 * SR ? (nz() * 2 - 1) * Math.exp(-k / (0.001 * SR)) * 0.6 : 0
        s[st + k] += (one[k] + click) * g * 0.35
      }
      t0 += gap
      gap *= 0.62
      g *= 0.55
    }
    return biquad(s, 'lp', 8000)
  }
  const motif = (root, len, step) => {
    const out = []
    let d = Math.floor(r() * 3)
    for (let i = 0; i < len; i++) {
      out.push(root + PENTA[d % 5] + 12 * Math.floor(d / 5))
      d = Math.max(0, d + (r() < 0.7 ? step : -1))
    }
    return out
  }
  // Eén fruitautomaat: rollen draaien rustig (tikken), vallen één voor één stil.
  const machine = (b, { start, pan, gain, rate, spin, stopGap, body, thudF, whirr = 0, thudGain = 1, thudDecay = 1 }) => {
    for (let reel = 0; reel < 3; reel++) {
      const stopAt = spin + reel * stopGap
      const rr = rate * (0.92 + reel * 0.06)
      let t = r() / rr
      while (t < stopAt - 0.05) {
        const slow = t > stopAt - 0.5 ? 1 + 2.2 * (1 - (stopAt - t) / 0.5) : 1
        const g = gain * (0.55 + 0.25 * r()) * (t < 0.25 ? t / 0.25 : 1)
        place(b, tick({ body: body * (0.9 + reel * 0.08) * (0.9 + 0.2 * r()), decay: 0.005, bright: 0.45 }), start + t, g, pan + (reel - 1) * 0.08)
        t += 1 / (rr / slow)
      }
      place(b, thud({ freq: thudF * (1 - reel * 0.05) * (0.9 + 0.2 * r()), decay: 0.06 * thudDecay, click: 0.5 }), start + stopAt, gain * 1.3 * thudGain, pan + (reel - 1) * 0.08)
    }
    if (whirr) {
      const dur = spin + 2 * stopGap
      const n = Math.round(dur * SR)
      const s = new Float32Array(n)
      for (let k = 0; k < n; k++) {
        const t = k / SR
        const e = Math.min(1, t / 0.3) * Math.min(1, Math.max(0, (dur - t) / 0.6))
        s[k] = (nz() * 2 - 1) * e * (0.6 + 0.4 * Math.max(0, Math.sin(2 * Math.PI * rate * t)))
      }
      place(b, biquad(biquad(s, 'bp', 900, 0.8), 'lp', 2000), start, gain * whirr, pan)
    }
  }

  const dry = bus()
  const send = bus()
  // Voorgrond: één automaat, langzaam draaiend.
  for (let c = 0, t = 0.2; c < 5; c++, t += 3.7) {
    machine(dry, { start: t, pan: -0.25, gain: 0.45, rate: 4.5, spin: 2.1, stopGap: 0.45, body: 1300, thudF: 175, whirr: 0.06 })
    yield
    machine(send, { start: t, pan: -0.25, gain: 0.08, rate: 4.5, spin: 2.1, stopGap: 0.45, body: 1300, thudF: 175 })
  }
  yield
  // Achtergrond: 14 andere automaten verspreid door de zaal, elk met eigen ritme.
  for (let m = 0; m < 14; m++) {
    const pan = r() * 1.8 - 0.9
    const dist = 0.12 + r() * 0.16
    const period = 3.2 + r() * 2.5
    const body = 1100 + r() * 700
    for (let t = r() * period; t < seconds; t += period * (0.85 + r() * 0.3)) {
      machine(send, { start: t, pan, gain: dist, rate: 4 + r() * 3, spin: 1.6 + r(), stopGap: 0.35 + r() * 0.15, body, thudF: 150 + r() * 60, thudGain: 0.35, thudDecay: 0.5 })
    }
    if (m % 2 === 1) yield
  }
  yield
  // Korte, zachte elektronische casinotonen door de hele zaal.
  const timbres = ['tri', 'sine', 'chip']
  for (let k = 0; k < 34; k++) {
    const t = r() * seconds
    const root = 64 + Math.floor(r() * 18)
    const len = 2 + Math.floor(r() * 4)
    const s = blips(motif(root, len, r() < 0.5 ? 1 : 2), { dur: 0.05 + r() * 0.05, gap: 0.07 + r() * 0.05, timbre: timbres[k % 3], lp: 2000 + r() * 1200 })
    const pan = r() * 1.8 - 0.9
    place(send, s, t, 0.05 + r() * 0.05, pan)
    place(dry, s, t, 0.02, pan)
    if (k % 12 === 11) yield
  }
  // Af en toe een kleine winst ergens in de zaal (oplopend loopje + munten).
  for (const t of [4.1, 9.3, 14.6]) {
    const pan = r() * 1.6 - 0.8
    place(send, blips([72, 76, 79, 84, 88], { dur: 0.08, gap: 0.08, timbre: 'chip', lp: 2800 }), t, 0.09, pan)
    for (let c = 0; c < 4; c++) place(send, coin(), t + 0.45 + c * 0.13, 0.06, pan + (r() - 0.5) * 0.2)
  }
  yield
  // Zacht geroezemoes: gefilterde ruis met trage golving (geen toon).
  for (const ch of ['L', 'R']) {
    const w = new Float32Array(LEN)
    for (let i = 0; i < LEN; i++) w[i] = nz() * 2 - 1
    yield
    const m0 = biquad(w, 'bp', 520, 0.6, 0, true)
    yield
    const m = biquad(m0, 'lp', 1400, 0.7, 0, true)
    const ph = r() * 6.28
    for (let i = 0; i < LEN; i++) {
      const sway = 0.75 + 0.25 * Math.sin((2 * Math.PI * 3 * i) / LEN + ph) * Math.sin((2 * Math.PI * 7 * i) / LEN + ph * 2)
      dry[ch][i] += m[i] * 0.07 * sway
    }
    yield
  }
  // Galm van de zaal (alleen boven ~260 Hz: geen dreun), loopt rond.
  const k = SR / 44100
  const combs = [1557, 1617, 1491, 1422, 1277, 1356].map((d) => Math.round(d * 1.25 * k))
  const damp = 1 - Math.exp((-2 * Math.PI * 4200) / SR)
  for (const [ch, off] of [
    ['L', 0],
    ['R', Math.round(23 * k)],
  ]) {
    const x0 = biquad(send[ch], 'hp', 260, 0.7, 0, true)
    yield
    const x = biquad(x0, 'hp', 260, 0.7, 0, true)
    yield
    const acc = new Float32Array(LEN)
    for (const d0 of combs) {
      const d = d0 + off
      const buf = new Float32Array(d)
      let lp = 0
      let idx = 0
      for (let pass = 0; pass < 2; pass++)
        for (let i = 0; i < LEN; i++) {
          const y = buf[idx]
          lp += (y - lp) * damp
          buf[idx] = x[i] + lp * 0.8
          if (++idx === d) idx = 0
          if (pass) acc[i] += y / combs.length
        }
      yield
    }
    let y = acc
    for (const d0 of [225, 556]) {
      const d = Math.round(d0 * k) + off
      const buf = new Float32Array(d)
      const z = new Float32Array(LEN)
      let idx = 0
      for (let pass = 0; pass < 2; pass++)
        for (let i = 0; i < LEN; i++) {
          const bo = buf[idx]
          buf[idx] = y[i] + bo * 0.5
          if (++idx === d) idx = 0
          if (pass) z[i] = -y[i] * 0.5 + bo
        }
      y = z
      yield
    }
    for (let i = 0; i < LEN; i++) dry[ch][i] += y[i] * 1.1
    yield
  }
  // Afronden: geen subsonische rommel, vaste luidheid, geen oversturing.
  for (const ch of ['L', 'R']) {
    dry[ch] = biquad(dry[ch], 'hp', 45, 0.7, 0, true)
    yield
  }
  const eL = kEnergy(dry.L, SR)
  yield
  const eR = kEnergy(dry.R, SR)
  yield
  const g = 10 ** ((target - (10 * Math.log10((eL + eR) / LEN) - 0.691)) / 20)
  for (const ch of ['L', 'R']) {
    const a = dry[ch]
    for (let i = 0; i < LEN; i++) {
      const v = a[i] * g
      a[i] = Math.abs(v) > 0.7 ? Math.sign(v) * (0.7 + 0.25 * Math.tanh((Math.abs(v) - 0.7) / 0.25)) : v
    }
  }
  return [dry.L, dry.R]
}

// Luidheid (benadering van BS.1770/LUFS): K-weging (hoge plank +4 dB vanaf
// ~1,5 kHz, hoogdoorlaat 38 Hz), dan gemiddelde energie.
function kEnergy(x, SR) {
  const shelf = (() => {
    const w = (2 * Math.PI * 1500) / SR
    const cs = Math.cos(w)
    const al = Math.sin(w) / (2 * 0.707)
    const A = 10 ** (4 / 40)
    const sq = 2 * Math.sqrt(A) * al
    return [A * (A + 1 + (A - 1) * cs + sq), -2 * A * (A - 1 + (A + 1) * cs), A * (A + 1 + (A - 1) * cs - sq), A + 1 - (A - 1) * cs + sq, 2 * (A - 1 - (A + 1) * cs), A + 1 - (A - 1) * cs - sq]
  })()
  const hp = (() => {
    const w = (2 * Math.PI * 38) / SR
    const cs = Math.cos(w)
    const al = Math.sin(w) / (2 * 0.5)
    return [(1 + cs) / 2, -(1 + cs), (1 + cs) / 2, 1 + al, -2 * cs, 1 - al]
  })()
  const [p0, p1, p2, , p4, p5] = shelf.map((v) => v / shelf[3])
  const [q0, q1, q2, , q4, q5] = hp.map((v) => v / hp[3])
  let a1 = 0, a2 = 0, b1 = 0, b2 = 0, c1 = 0, c2 = 0, d1 = 0, d2 = 0
  let e = 0
  for (let i = 0; i < x.length; i++) {
    const u = p0 * x[i] + p1 * a1 + p2 * a2 - p4 * b1 - p5 * b2
    a2 = a1
    a1 = x[i]
    b2 = b1
    b1 = u
    const v = q0 * u + q1 * c1 + q2 * c2 - q4 * d1 - q5 * d2
    c2 = c1
    c1 = u
    d2 = d1
    d1 = v
    e += v * v
  }
  return e
}
export const floorLoudness = (L, R, SR) => 10 * Math.log10((kEnergy(L, SR) + kEnergy(R, SR)) / L.length) - 0.691

// Alles in één keer (tests, Node).
export function casinoFloorChannels(sr = FLOOR_RATE, opts) {
  const it = casinoFloorSteps(sr, opts)
  for (;;) {
    const r = it.next()
    if (r.done) return r.value
  }
}
