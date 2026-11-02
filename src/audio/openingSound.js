// Geluid van de online opening (wachtkamer, BONUSSPEL, Las Vegas) en de
// geluidsvoorkeur. Alles wordt in de app opgewekt (Web Audio), behalve het
// optionele ingesproken fragment "Viva Las Vegas!", dat als lokaal bestand
// wordt meegeleverd (public/sounds/viva-las-vegas.mp3). Ontbreekt dat bestand,
// dan klinkt een herkenbaar tijdelijk testgeluid.
//
// Geluid blokkeert nooit het spel: elke fout wordt genegeerd.

import { audioOut, audioRunning, setSoundEnabled, soundEnabled, unlockAudio } from './sound.js'

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
  else stopAllLoops()
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
function out() {
  if (!soundEnabled()) return null
  try {
    const o = audioOut()
    // Zodra de browser het geluid vrijgeeft (of weer pauzeert): opnieuw kijken.
    if (o && !o.ctx.__fsmWatch) {
      o.ctx.__fsmWatch = true
      o.ctx.addEventListener?.('statechange', () => notify())
    }
    return o && o.ctx.state === 'running' ? o : null
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
// Wachtkamer: zacht mechanisch rolgeluid (één lus, nooit dubbel)
// ---------------------------------------------------------------------------
let loopUsers = 0
let loop = null
let loopBuffer = null

function reelBuffer(ctx) {
  if (loopBuffer && loopBuffer.sampleRate === ctx.sampleRate) return loopBuffer
  const sr = ctx.sampleRate
  const len = Math.floor(sr * 1.6) // 1,6 s, naadloos herhaald
  const buf = ctx.createBuffer(1, len, sr)
  const d = buf.getChannelData(0)
  // Zacht gezoem van de motor + gefilterde ruis.
  let lp = 0
  for (let i = 0; i < len; i++) {
    const t = i / sr
    lp += ((Math.random() * 2 - 1) - lp) * 0.04
    d[i] = 0.05 * Math.sin(2 * Math.PI * 60 * t) + 0.025 * Math.sin(2 * Math.PI * 120 * t) + 0.18 * lp
  }
  // Tikjes van de rolnokken (drie rollen, licht verschillend tempo).
  const tick = (at, amp) => {
    const s = Math.floor(at * sr)
    for (let k = 0; k < sr * 0.012 && s + k < len; k++) {
      d[s + k] += amp * Math.exp(-k / (sr * 0.0025)) * Math.sin(2 * Math.PI * 2400 * (k / sr))
    }
  }
  for (const [rate, amp, phase] of [
    [10, 0.22, 0],
    [12.5, 0.16, 0.031],
    [15, 0.12, 0.017],
  ]) {
    const n = Math.round(1.6 * rate)
    for (let j = 0; j < n; j++) tick(phase + (j * 1.6) / n, amp * (0.85 + ((j * 7) % 5) * 0.05))
  }
  loopBuffer = buf
  return buf
}

function ensureLoop() {
  if (loop || loopUsers <= 0 || typeof document === 'undefined' || document.hidden) return
  const o = out()
  if (!o) return
  try {
    const src = o.ctx.createBufferSource()
    src.buffer = reelBuffer(o.ctx)
    src.loop = true
    const g = o.ctx.createGain()
    const t = o.ctx.currentTime
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.6) // zacht
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

// `events`: [{ at (ms vanaf startedAt), play(o, delaySeconds) }]
function scheduleOnce(key, startedAt, now, events) {
  if (playedKeys.has(key)) return false
  const o = out()
  if (!o) return false
  playedKeys.add(key)
  for (const e of events) {
    const delay = startedAt + e.at - now
    if (delay < -LATE_MS) continue
    try {
      e.play(o, Math.max(0, delay) / 1000)
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

export function playBonus(roomKey, startedAt, tl, now) {
  return scheduleOnce(`bonus:${roomKey}`, startedAt, now, bonusEvents(tl))
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
