// Geluid van de online opening (wachtkamer, BONUSSPEL, Las Vegas) en de
// geluidsvoorkeur. Alles wordt in de app opgewekt (Web Audio), behalve het
// optionele ingesproken fragment "Viva Las Vegas!", dat als lokaal bestand
// wordt meegeleverd (public/sounds/viva-las-vegas.mp3). Ontbreekt dat bestand,
// dan klinkt een herkenbaar tijdelijk testgeluid.
//
// Geluid blokkeert nooit het spel: elke fout wordt genegeerd.

import { audioOut, audioRunning, setSoundEnabled, soundEnabled, unlockAudio } from './sound.js'
import { FLOOR_RATE, casinoFloorSteps } from './casinoFloor.js'

// ---------------------------------------------------------------------------
// Voorkeur (op dit toestel onthouden)
// ---------------------------------------------------------------------------
const PREF_KEY = 'fsm-sound'
const listeners = new Set()

function readPref() {
  try {
    return localStorage.getItem(PREF_KEY) !== 'off'
  } catch {
    return true
  }
}
setSoundEnabled(readPref())

export const soundOn = () => soundEnabled()
// Klinkt het geluid echt? (maakt zo nodig de audiocontext aan; die blijft
// 'suspended' tot de browser geluid toestaat.)
export const soundReady = () => soundEnabled() && !!out() && audioRunning()

export function setSound(on) {
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off')
  } catch {
    /* geen opslag */
  }
  setSoundEnabled(on)
  if (on) unlockAudio()
  else {
    stopAllLoops()
    muteBus() // ook al ingeplande geluiden (BONUSSPEL) direct stil
  }
  notify()
}

// Na een tik (iOS-ontgrendeling) of zichtbaar worden: lus eventueel starten.
export function enableAudioFromTap() {
  if (!soundEnabled()) return setSound(true)
  unlockAudio()
  notify()
}

export function onSoundChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
function notify() {
  ensureLoop()
  listeners.forEach((fn) => {
    try {
      fn()
    } catch {
      /* negeren */
    }
  })
}

if (typeof window !== 'undefined') {
  const wake = () => setTimeout(notify, 30)
  window.addEventListener('pointerdown', wake, true)
  document.addEventListener('visibilitychange', () => (document.hidden ? stopAllLoops() : wake()))
}

// ---------------------------------------------------------------------------
// Bouwstenen
// ---------------------------------------------------------------------------
// Alle geluid van de opening loopt via één eigen bus (achter het hoofdvolume
// van sound.js). Uitzetten = bus direct dicht, ook voor al ingeplande tonen.
let bus = null
function busFor(o) {
  if (!bus || bus.ctx !== o.ctx) {
    const g = o.ctx.createGain()
    g.gain.value = 1
    g.connect(o.out)
    bus = { ctx: o.ctx, g }
  }
  return bus.g
}
function muteBus() {
  if (!bus) return
  const { ctx, g } = bus
  bus = null
  try {
    const t = ctx.currentTime
    g.gain.cancelScheduledValues(t)
    g.gain.setValueAtTime(g.gain.value, t)
    g.gain.linearRampToValueAtTime(0, t + 0.06)
    setTimeout(() => {
      try {
        g.disconnect()
      } catch {
        /* al los */
      }
    }, 200)
  } catch {
    /* negeren */
  }
}

function out() {
  if (!soundEnabled()) return null
  try {
    const o = audioOut()
    // Zodra de browser het geluid vrijgeeft (of weer pauzeert): opnieuw kijken.
    if (o && !o.ctx.__fsmWatch) {
      o.ctx.__fsmWatch = true
      o.ctx.addEventListener?.('statechange', () => notify())
    }
    return o && o.ctx.state === 'running' ? { ctx: o.ctx, out: busFor(o) } : null
  } catch {
    return null
  }
}

function tone(o, { freq, type = 'sine', at = 0, dur = 0.2, gain = 0.15, to = null, attack = 0.01, filter = null }) {
  const { ctx, out: dest } = o
  const t = ctx.currentTime + Math.max(0, at)
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(gain, t + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  let node = osc
  if (filter) {
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = filter
    osc.connect(f)
    node = f
  }
  node.connect(g).connect(dest)
  osc.start(t)
  osc.stop(t + dur + 0.05)
}

function noise(o, { at = 0, dur = 0.1, gain = 0.08, freq = 3000, q = 1, type = 'bandpass' }) {
  const { ctx, out: dest } = o
  const t = ctx.currentTime + Math.max(0, at)
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur))
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len)
  const src = ctx.createBufferSource()
  src.buffer = buf
  const f = ctx.createBiquadFilter()
  f.type = type
  f.frequency.value = freq
  f.Q.value = q
  const g = ctx.createGain()
  g.gain.value = gain
  src.connect(f).connect(g).connect(dest)
  src.start(t)
}

// ---------------------------------------------------------------------------
// Rolgeluid voor BONUSSPEL (draaiende rollen tot de munten vallen)
// ---------------------------------------------------------------------------
// Drie snel draaiende rollen (zoemende strip + ratelende nokken) met een
// zachte motorbrom. Alle periodieke delen passen precies in de lus en filters
// lopen "rond". De wachtkamer gebruikt sinds 02-11-2026 "Las Vegas Casino
// Floor" (casinoFloor.js, keuze B).
export const LOOP_SECONDS = 4.8
const REELS = [
  { rate: 8.75, pan: -0.55, whir: 640, click: 2650 },
  { rate: 10, pan: 0, whir: 780, click: 3050 },
  { rate: 11.25, pan: 0.55, whir: 920, click: 3450 },
]

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

// Bandfilter (RBJ), twee keer rond de lus: de filterstand aan het eind sluit
// aan op het begin (geen tik bij het herhalen).
function bandpassCircular(x, sr, freq, q) {
  const w = (2 * Math.PI * freq) / sr
  const alpha = Math.sin(w) / (2 * q)
  const a0 = 1 + alpha
  const b0 = alpha / a0
  const b2 = -alpha / a0
  const a1 = (-2 * Math.cos(w)) / a0
  const a2 = (1 - alpha) / a0
  const y = new Float32Array(x.length)
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < x.length; i++) {
      const v = b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2
      x2 = x1
      x1 = x[i]
      y2 = y1
      y1 = v
      if (pass) y[i] = v
    }
  }
  return y
}

// Sinus optellen via een draaiende vector (veel sneller dan Math.sin per monster).
function addSine(arr, sr, freq, amp, phase) {
  const w = (2 * Math.PI * freq) / sr
  const c = Math.cos(w)
  const sn = Math.sin(w)
  let x = Math.cos(phase)
  let y = Math.sin(phase)
  for (let i = 0; i < arr.length; i++) {
    arr[i] += amp * y
    const nx = x * c - y * sn
    y = x * sn + y * c
    x = nx
  }
}

// Opwekken op 24 kHz: ruim genoeg voor deze klanken; de browser rekent om
// naar de eigen frequentie. Half zoveel werk (sneller klaar op telefoons).
export const LOOP_RATE = 24000

// Pure functie (ook getest): [links, rechts] voor één lus. Als generator in
// stappen, zodat de telefoon tussendoor kan blijven tekenen (zie prepareSlot).
export function slotLoopChannels(sr, opts = {}) {
  const it = slotLoopSteps(sr, opts)
  for (;;) {
    const r = it.next()
    if (r.done) return r.value
  }
}
function* slotLoopSteps(sr, { seconds = LOOP_SECONDS, seed = 7 } = {}) {
  const len = Math.round(sr * seconds)
  const L = new Float32Array(len)
  const R = new Float32Array(len)
  const rand = rng(seed)
  const add = (i, v, pan) => {
    const k = ((i % len) + len) % len
    L[k] += v * (1 - Math.max(0, pan))
    R[k] += v * (1 + Math.min(0, pan))
  }
  const white = () => {
    const w = new Float32Array(len)
    for (let i = 0; i < len; i++) w[i] = rand() * 2 - 1
    return w
  }

  for (const reel of REELS) {
    // Zoemende rolstrip: gefilterde ruis die meeslingert met elk symbool.
    const noiseIn = white()
    yield
    const whir = bandpassCircular(noiseIn, sr, reel.whir, 1.3)
    const gl = 1 - Math.max(0, reel.pan)
    const gr = 1 + Math.min(0, reel.pan)
    const env = new Float32Array(len)
    addSine(env, sr, reel.rate, 0.38, Math.PI / 2)
    for (let i = 0; i < len; i++) {
      const v = 0.55 * whir[i] * (0.62 + env[i])
      L[i] += v * gl
      R[i] += v * gr
    }
    yield
    // Ratelende nokken: scherpe tik + korte naklik van de pal.
    const n = Math.round(reel.rate * seconds)
    for (let j = 0; j < n; j++) {
      const at = Math.round(((j + 0.5 * rand() * 0.15) * len) / n)
      const accent = j % 4 === 0 ? 1.35 : 0.85 + rand() * 0.2
      for (const [delay, f, amp, decay] of [
        [0, reel.click, 0.34, 0.0022],
        [0.009, reel.click * 0.62, 0.13, 0.003],
      ]) {
        const s = at + Math.round(delay * sr)
        const m = Math.round(sr * 0.014)
        for (let k = 0; k < m; k++) {
          const t = k / sr
          const env = Math.exp(-t / decay)
          const body = Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(2 * Math.PI * f * 1.93 * t)
          const snap = k < sr * 0.0012 ? (rand() * 2 - 1) * 0.8 : 0
          add(s + k, amp * accent * env * (body + snap), reel.pan * 0.8)
        }
      }
    }
    yield
  }
  // Motorbrom (hele perioden per lus).
  {
    const hum = new Float32Array(len)
    addSine(hum, sr, 100, 0.035, 0)
    addSine(hum, sr, 150, 0.018, 1)
    for (let i = 0; i < len; i++) (L[i] += hum[i]), (R[i] += hum[i])
  }

  yield
  // Niet te hard: vaste luidheid, zachte begrenzing van pieken.
  let sum = 0
  for (let i = 0; i < len; i++) sum += L[i] * L[i] + R[i] * R[i]
  const rms = Math.sqrt(sum / (2 * len)) || 1
  const g = 0.16 / rms
  // zachte begrenzing (alleen zichtbaar bij pieken)
  for (const ch of [L, R]) for (let i = 0; i < len; i++) {
    const v = ch[i] * g
    ch[i] = v > 0.6 || v < -0.6 ? Math.tanh(v) : v
  }
  return [L, R]
}

// Lusgegevens worden in stapjes opgewekt (geen hapering van de animaties) en
// daarna bewaard; de AudioBuffer wordt per audiocontext gemaakt.
//   'floor' = wachtkamer (Las Vegas Casino Floor), 'reels' = rollen BONUSSPEL
const SOURCES = {
  floor: { rate: FLOOR_RATE, steps: () => casinoFloorSteps(FLOOR_RATE), worker: true },
  reels: { rate: LOOP_RATE, steps: () => slotLoopSteps(LOOP_RATE) },
}
const slotData = new Map() // soort → { data: [L, R] | null, ready: Promise }

// In stapjes op de hoofdthread (terugval, en in tests).
async function inSteps(kind) {
  const it = SOURCES[kind].steps()
  for (;;) {
    const r = it.next()
    if (r.done) return r.value
    await new Promise((ok) => setTimeout(ok, 0))
  }
}
// Liefst in een achtergrondthread: het scherm hapert dan nooit.
function inWorker() {
  return new Promise((ok, fail) => {
    let w
    try {
      w = new Worker(new URL('./casinoFloorWorker.js', import.meta.url), { type: 'module' })
    } catch (e) {
      return fail(e)
    }
    const done = (fn, v) => {
      try {
        w.terminate()
      } catch {
        /* al weg */
      }
      fn(v)
    }
    w.onmessage = (e) => (e.data?.L ? done(ok, [e.data.L, e.data.R]) : done(fail, new Error(e.data?.error)))
    w.onerror = (e) => {
      e.preventDefault?.()
      done(fail, new Error('worker'))
    }
    w.postMessage('go')
  })
}

export function prepareSlot(kind = 'floor') {
  if (!slotData.has(kind)) {
    const entry = { data: null, buffers: new WeakMap() }
    const viaWorker = SOURCES[kind].worker && typeof Worker !== 'undefined' && typeof window !== 'undefined'
    entry.ready = (viaWorker ? inWorker().catch(() => inSteps(kind)) : inSteps(kind)).then((d) => (entry.data = d))
    slotData.set(kind, entry)
  }
  return slotData.get(kind).ready
}
function slotBuffer(ctx, kind = 'floor') {
  prepareSlot(kind)
  const entry = slotData.get(kind)
  if (!entry.data) return null
  let buf = entry.buffers.get(ctx)
  if (!buf) {
    const [l, r] = entry.data
    buf = ctx.createBuffer(2, l.length, SOURCES[kind].rate)
    buf.getChannelData(0).set(l)
    buf.getChannelData(1).set(r)
    entry.buffers.set(ctx, buf)
  }
  return buf
}

let loopUsers = 0
let loop = null

function ensureLoop() {
  if (loop || loopUsers <= 0 || typeof document === 'undefined' || document.hidden) return
  const o = out()
  if (!o) return
  const buffer = slotBuffer(o.ctx)
  if (!buffer) {
    prepareSlot().then(() => ensureLoop()) // klaar → alsnog starten (als nog nodig)
    return
  }
  try {
    const src = o.ctx.createBufferSource()
    src.buffer = buffer
    src.loop = true
    const g = o.ctx.createGain()
    const t = o.ctx.currentTime
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.28, t + 1.2) // ~ -29 LUFS: achtergrond, BONUSSPEL steekt erbovenuit
    src.connect(g).connect(o.out)
    src.start(t)
    loop = { src, g, ctx: o.ctx }
  } catch {
    loop = null
  }
}

function stopAllLoops() {
  if (!loop) return
  const { src, g, ctx } = loop
  loop = null
  try {
    const t = ctx.currentTime
    g.gain.cancelScheduledValues(t)
    g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2)
    src.stop(t + 0.25)
  } catch {
    /* al gestopt */
  }
}

// Aanroepen bij het tonen en verlaten van de wachtkamer (telt gebruikers).
export function startReelLoop() {
  loopUsers++
  prepareSlot() // alvast opwekken, ook als de browser het geluid nog blokkeert
  ensureLoop()
  return () => {
    loopUsers = Math.max(0, loopUsers - 1)
    if (!loopUsers) stopAllLoops()
  }
}
export const reelLoopRunning = () => !!loop

// ---------------------------------------------------------------------------
// BONUSSPEL: munten, opbouw en fanfare, gepland op de gezamenlijke tijdlijn
// ---------------------------------------------------------------------------
const LATE_MS = 1500 // te late geluiden overslaan (bijv. na herladen)
const playedKeys = new Set()

// `events`: [{ at (ms vanaf startedAt), until?, play(o, delaySeconds, skipSeconds) }]
// Korte geluiden die > 1,5 s te laat zijn, vallen weg; langere lagen (met
// `until`) vallen in op het juiste punt (bijv. na herladen).
function scheduleOnce(key, startedAt, now, events, level = 1) {
  if (playedKeys.has(key)) return false
  let o = out()
  if (!o) return false
  playedKeys.add(key)
  if (level !== 1) {
    // eigen volumeknop voor deze reeks (achter de bus: uitzetten blijft direct)
    const g = o.ctx.createGain()
    g.gain.value = level
    g.connect(o.out)
    o = { ctx: o.ctx, out: g }
  }
  for (const e of events) {
    const delay = startedAt + e.at - now
    if (delay < -LATE_MS && !(e.until != null && now < startedAt + e.until - 300)) continue
    try {
      e.play(o, Math.max(0, delay) / 1000, Math.max(0, -delay) / 1000)
    } catch {
      /* negeren */
    }
  }
  return true
}

const NOTE = (n) => 440 * 2 ** ((n - 69) / 12)
function brass(o, at, midi, dur, gain = 0.07) {
  tone(o, { freq: NOTE(midi), type: 'sawtooth', at, dur, gain, attack: 0.03, filter: 2400 })
  tone(o, { freq: NOTE(midi) * 1.005, type: 'sawtooth', at, dur, gain: gain * 0.6, attack: 0.03, filter: 1800 })
}

export function bonusEvents(tl) {
  if (tl.reelsAt != null) return bonusEventsV2(tl)
  const ev = []
  // munt valt (drie keer)
  tl.coinStops.forEach((s, i) =>
    ev.push({
      at: s,
      play: (o, d) => {
        tone(o, { freq: 1568 + i * 220, type: 'triangle', at: d, dur: 0.35, gain: 0.12 })
        tone(o, { freq: 2093 + i * 220, type: 'sine', at: d + 0.05, dur: 0.4, gain: 0.08 })
        noise(o, { at: d, dur: 0.06, gain: 0.08, freq: 5000, q: 2 })
      },
    }),
  )
  // opbouw: stijgende toon + versnellende casino-arpeggio
  const riseFrom = tl.bonusAt
  const riseLen = (tl.fanfareAt - tl.bonusAt) / 1000
  ev.push({
    at: riseFrom,
    play: (o, d) => {
      tone(o, { freq: 220, to: 880, type: 'sawtooth', at: d, dur: riseLen, gain: 0.035, attack: 0.3, filter: 1600 })
      noise(o, { at: d, dur: 0.5, gain: 0.07, freq: 1200, q: 0.6 })
      const arp = [72, 76, 79, 84]
      let t = 0
      let step = 0.18
      for (let k = 0; t < riseLen - 0.05; k++) {
        tone(o, { freq: NOTE(arp[k % 4] + Math.floor(k / 8) * 2), type: 'square', at: d + t, dur: 0.09, gain: 0.03, filter: 3000 })
        t += step
        step = Math.max(0.07, step * 0.93)
      }
    },
  })
  // korte feestelijke fanfare
  ev.push({
    at: tl.fanfareAt,
    play: (o, d) => {
      brass(o, d, 67, 0.14)
      brass(o, d + 0.13, 72, 0.14)
      brass(o, d + 0.26, 76, 0.14)
      for (const m of [72, 76, 79, 84]) brass(o, d + 0.4, m, 0.6, 0.05)
      noise(o, { at: d + 0.4, dur: 0.6, gain: 0.06, freq: 7000, q: 0.5, type: 'highpass' })
    },
  })
  return ev
}

// BONUSSPEL ~10 s (tijdlijn v2): lampjes → draaiende rollen → drie munten →
// BONUSSPEL! → steeds intenser → fanfare en finale.
function coinShower(o, d, dur, perSecondFrom, perSecondTo, gain = 0.028) {
  let t = 0
  while (t < dur) {
    const rate = perSecondFrom + ((perSecondTo - perSecondFrom) * t) / dur
    tone(o, { freq: NOTE(91 + Math.floor(Math.random() * 10)), type: 'sine', at: d + t, dur: 0.16, gain: gain * (0.6 + Math.random() * 0.6) })
    t += (0.6 + Math.random() * 0.8) / rate
  }
}
function bonusEventsV2(tl) {
  const s = (ms) => ms / 1000
  const ev = []
  // 1. De lampjes gaan aan: zachte opstart + een klikje per lampje.
  ev.push({
    at: 0,
    play: (o, d) => {
      tone(o, { freq: 70, to: 150, type: 'sine', at: d, dur: s(tl.reelsAt) + 0.4, gain: 0.05, attack: 0.4 })
      for (let i = 0; i < 18; i++) tone(o, { freq: 2200 + (i % 6) * 180, type: 'triangle', at: d + i * 0.07, dur: 0.05, gain: 0.018 })
    },
  })
  // 2. De rollen draaien (zelfde opgewekte rolgeluid als de wachtkamer, zonder
  //    casinolaag); na elke munt een rol minder, tot de derde munt valt.
  const last = tl.coinStops.at(-1)
  ev.push({
    at: tl.reelsAt,
    until: last,
    play: (o, d, skip) => {
      // Absolute begintijd op de audioklok; is het rolgeluid nog niet klaar,
      // dan valt de laag later in op het juiste punt.
      const start = o.ctx.currentTime + d - skip
      const run = () => {
        const buf = slotBuffer(o.ctx, 'reels')
        if (!buf || !bus || bus.ctx !== o.ctx) return
        const now = o.ctx.currentTime
        const lateBy = Math.max(0, now - start)
        const end = start + s(last - tl.reelsAt)
        if (now > end - 0.3) return
        const src = o.ctx.createBufferSource()
        src.buffer = buf
        src.loop = true
        src.playbackRate.value = 1.15
        const g = o.ctx.createGain()
        const t0 = Math.max(now, start)
        const at = (ms) => Math.max(t0, start + s(ms - tl.reelsAt))
        g.gain.setValueAtTime(0.0001, t0)
        g.gain.exponentialRampToValueAtTime(0.27, t0 + (lateBy ? 0.1 : 0.9))
        tl.coinStops.forEach((stop, i) => g.gain.setTargetAtTime(0.27 * (1 - (i + 1) / 3) + 0.0001, at(stop), 0.05))
        src.connect(g).connect(o.out)
        src.start(t0)
        src.stop(end + 0.3)
      }
      if (slotBuffer(o.ctx, 'reels')) run()
      else prepareSlot('reels').then(run)
    },
  })
  prepareSlot('reels')
  // 3. Munten: mechanische klonk + ding, de derde het grootst.
  tl.coinStops.forEach((stop, i) =>
    ev.push({
      at: stop,
      play: (o, d) => {
        tone(o, { freq: 120, to: 60, type: 'sine', at: d, dur: 0.18, gain: 0.12 })
        noise(o, { at: d, dur: 0.05, gain: 0.09, freq: 900, q: 1.2 })
        tone(o, { freq: 1568 + i * 262, type: 'triangle', at: d + 0.02, dur: 0.45, gain: 0.11 + i * 0.02 })
        tone(o, { freq: 2093 + i * 262, type: 'sine', at: d + 0.07, dur: 0.5, gain: 0.07 })
      },
    }),
  )
  // 4. BONUSSPEL!: inslag + akkoordstoot.
  ev.push({
    at: tl.bonusAt,
    play: (o, d) => {
      tone(o, { freq: 90, to: 40, type: 'sine', at: d, dur: 0.6, gain: 0.16 })
      noise(o, { at: d, dur: 0.7, gain: 0.08, freq: 6000, q: 0.4, type: 'highpass' })
      for (const m of [72, 76, 79]) brass(o, d + 0.02, m, 0.35, 0.05)
    },
  })
  // 5. Steeds intenser tot de fanfare: stijgende toon, versnellende arpeggio,
  //    tromgeroffel en een muntenregen die dichter wordt.
  const riseLen = s(tl.fanfareAt - tl.bonusAt)
  ev.push({
    at: tl.bonusAt + 250,
    until: tl.fanfareAt,
    play: (o, d, skip) => {
      const len = Math.max(0.3, riseLen - 0.25 - skip)
      tone(o, { freq: 196 * 2 ** (skip / riseLen * 2), to: 784, type: 'sawtooth', at: d, dur: len, gain: 0.04, attack: 0.5, filter: 2000 })
      const arp = [72, 76, 79, 84]
      let t = 0
      let step = 0.2
      for (let k = 0; t < len - 0.05; k++) {
        tone(o, { freq: NOTE(arp[k % 4] + Math.floor(k / 8) * 2), type: 'square', at: d + t, dur: 0.08, gain: 0.026 + 0.03 * (t / len), filter: 3200 })
        t += step
        step = Math.max(0.065, step * 0.94)
      }
      // tromgeroffel (vanaf de tweede stap), steeds sneller
      const rollFrom = Math.max(0, s(tl.buildSteps[0] - tl.bonusAt - 250) - skip)
      for (let t2 = rollFrom, gap = 0.09; t2 < len; t2 += gap, gap = Math.max(0.035, gap * 0.95)) {
        noise(o, { at: d + t2, dur: 0.04, gain: 0.03 + 0.09 * (t2 / len), freq: 1800, q: 0.7 })
      }
      coinShower(o, d, len, 3, 14)
    },
  })
  // tweede, hogere stijgende toon in het laatste stuk (nog intenser)
  ev.push({
    at: tl.buildSteps[1],
    play: (o, d) => {
      const len = s(tl.fanfareAt - tl.buildSteps[1])
      tone(o, { freq: 392, to: 1568, type: 'sawtooth', at: d, dur: len, gain: 0.035, attack: 0.3, filter: 2600 })
      tone(o, { freq: 98, to: 196, type: 'triangle', at: d, dur: len, gain: 0.06, attack: 0.2 })
    },
  })
  // 6. Finale: fanfare, bekkens, muntenregen en een slotakkoord.
  ev.push({
    at: tl.fanfareAt,
    play: (o, d) => {
      noise(o, { at: d, dur: 1.4, gain: 0.07, freq: 7000, q: 0.5, type: 'highpass' })
      brass(o, d, 67, 0.13)
      brass(o, d + 0.13, 67, 0.13)
      brass(o, d + 0.26, 67, 0.13)
      brass(o, d + 0.4, 72, 0.45)
      for (const m of [72, 76, 79]) brass(o, d + 0.4, m, 0.45, 0.04)
      coinShower(o, d, 1.6, 14, 8, 0.03)
    },
  })
  ev.push({
    at: tl.finaleAt,
    play: (o, d) => {
      noise(o, { at: d, dur: 0.9, gain: 0.06, freq: 6000, q: 0.5, type: 'highpass' })
      brass(o, d, 74, 0.12)
      brass(o, d + 0.12, 77, 0.12)
      for (const m of [72, 76, 79, 84, 88]) brass(o, d + 0.26, m, 0.7, 0.042)
      for (let k = 0; k < 8; k++) tone(o, { freq: NOTE(96 + (k % 4) * 3), type: 'sine', at: d + 0.3 + k * 0.06, dur: 0.2, gain: 0.03 })
    },
  })
  return ev
}

export function playBonus(roomKey, startedAt, tl, now) {
  // Versie 2 iets voller dan de wachtkamer (BONUSSPEL moet groter klinken).
  return scheduleOnce(`bonus:${roomKey}`, startedAt, now, bonusEvents(tl), tl.reelsAt != null ? 1.8 : 1)
}

// ---------------------------------------------------------------------------
// Las Vegas: "Viva Las Vegas!" (lokaal bestand, anders tijdelijk testgeluid)
// ---------------------------------------------------------------------------
export const VIVA_FILES = ['sounds/viva-las-vegas.mp3', 'sounds/viva-las-vegas.m4a']
let vivaBuffer // undefined = nog niet geprobeerd, null = geen bestand
let vivaLoading = null

async function loadViva(ctx) {
  if (vivaBuffer !== undefined) return vivaBuffer
  vivaLoading ??= (async () => {
    for (const f of VIVA_FILES) {
      try {
        const res = await fetch(new URL(f, document.baseURI))
        // Alleen echte audio (een ontbrekend bestand kan ook een HTML-pagina geven).
        if (!res.ok || !/^audio\//.test(res.headers.get('content-type') ?? '')) continue
        const data = await res.arrayBuffer()
        return await new Promise((ok, fail) => {
          const p = ctx.decodeAudioData(data, ok, fail)
          if (p && typeof p.catch === 'function') p.catch(fail)
        })
      } catch {
        /* volgende proberen */
      }
    }
    return null
  })()
  vivaBuffer = await vivaLoading
  return vivaBuffer
}

// Tijdelijk testgeluid: duidelijk geen stem, wel "ta-daa!".
function vivaPlaceholder(o, d) {
  brass(o, d, 72, 0.18, 0.06)
  for (const m of [76, 79, 84, 88]) brass(o, d + 0.2, m, 0.8, 0.045)
  for (let k = 0; k < 6; k++) tone(o, { freq: NOTE(96 + (k % 3) * 4), type: 'sine', at: d + 0.25 + k * 0.07, dur: 0.18, gain: 0.04 })
}

// Speel één keer af als het Las Vegas-scherm verschijnt (`vegasAt` = moment
// van verschijnen); te laat (> 1,5 s, bijv. na herladen) = niet meer.
export function playViva(roomKey, vegasAt, now) {
  const key = `viva:${roomKey}`
  if (playedKeys.has(key) || now - vegasAt > LATE_MS) return false
  const o = out()
  if (!o) return false
  playedKeys.add(key)
  loadViva(o.ctx)
    .then((buf) => {
      const o2 = out()
      if (!o2) return
      const d = 0 // direct (het scherm staat er al)
      if (buf) {
        const src = o2.ctx.createBufferSource()
        src.buffer = buf
        const g = o2.ctx.createGain()
        g.gain.value = 1.2
        src.connect(g).connect(o2.out)
        src.start(o2.ctx.currentTime + d)
      } else vivaPlaceholder(o2, d)
    })
    .catch(() => {})
  return true
}

// Alleen voor tests.
export const _resetOpeningSound = () => {
  playedKeys.clear()
  stopAllLoops()
  loopUsers = 0
}
