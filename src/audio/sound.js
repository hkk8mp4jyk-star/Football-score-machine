// Gesynthetiseerde show-geluiden via Web Audio. Geen audiobestanden nodig.

let ctx = null
let master = null
let enabled = true
let lastTick = 0

let unlocked = false
let keepAlive = null

function ac() {
  if (!enabled) return null
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    ctx = new AC()
    master = ctx.createGain()
    master.gain.value = 0.55
    master.connect(ctx.destination)
  }
  // iOS zet de context op 'suspended' of 'interrupted' (bijv. na wisselen van app).
  if (ctx.state !== 'running') ctx.resume().catch(() => {})
  return ctx
}

export function setSoundEnabled(on) {
  enabled = on
}

// Een seconde stilte als WAV, voor het HTML-audio-trucje hieronder.
function silentWav() {
  const rate = 8000
  const n = rate
  const buf = new ArrayBuffer(44 + n)
  const v = new DataView(buf)
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  v.setUint32(4, 36 + n, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, rate, true)
  v.setUint32(28, rate, true)
  v.setUint16(32, 1, true)
  v.setUint16(34, 8, true)
  str(36, 'data')
  v.setUint32(40, n, true)
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128)
  let bin = ''
  new Uint8Array(buf).forEach((b) => (bin += String.fromCharCode(b)))
  return `data:audio/wav;base64,${btoa(bin)}`
}

// Moet vanuit een tik/klik aangeroepen worden (iOS ontgrendelt dan audio).
export function unlockAudio() {
  if (!enabled) return
  // iOS 17+: speel af als "media", zodat de stille-modus-schakelaar het niet dempt.
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'playback'
  } catch {
    /* niet ondersteund */
  }
  // Oudere iOS: een (stil) HTML-audio-element zet de sessie ook op media.
  try {
    if (!keepAlive) {
      keepAlive = new Audio(silentWav())
      keepAlive.loop = true
      keepAlive.setAttribute('playsinline', '')
    }
    keepAlive.play().catch(() => {})
  } catch {
    /* niet ondersteund */
  }
  const c = ac()
  if (!c || unlocked) return
  // Eén lege sample afspelen binnen de tik ontgrendelt Web Audio op iOS.
  const src = c.createBufferSource()
  src.buffer = c.createBuffer(1, 1, 22050)
  src.connect(c.destination)
  src.start(0)
  unlocked = true
}

// Ontgrendel bij de allereerste aanraking, waar dan ook op het scherm.
if (typeof window !== 'undefined') {
  const first = () => {
    unlockAudio()
    if (unlocked) {
      window.removeEventListener('pointerdown', first, true)
      window.removeEventListener('touchend', first, true)
    }
  }
  window.addEventListener('pointerdown', first, true)
  window.addEventListener('touchend', first, true)
}

function tone({ freq, type = 'sine', start = 0, dur = 0.2, gain = 0.2, to = null, attack = 0.005 }) {
  const c = ac()
  if (!c) return
  const t = c.currentTime + start
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, t)
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(gain, t + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g).connect(master)
  o.start(t)
  o.stop(t + dur + 0.02)
}

function noise({ start = 0, dur = 0.05, gain = 0.1, freq = 2000, q = 1, type = 'bandpass' }) {
  const c = ac()
  if (!c) return
  const t = c.currentTime + start
  const len = Math.max(1, Math.floor(c.sampleRate * dur))
  const buf = c.createBuffer(1, len, c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len)
  const src = c.createBufferSource()
  src.buffer = buf
  const f = c.createBiquadFilter()
  f.type = type
  f.frequency.value = freq
  f.Q.value = q
  const g = c.createGain()
  g.gain.value = gain
  src.connect(f).connect(g).connect(master)
  src.start(t)
}

export const sfx = {
  spinStart() {
    noise({ dur: 0.5, gain: 0.12, freq: 900, q: 0.7 })
    tone({ freq: 180, to: 520, type: 'sawtooth', dur: 0.45, gain: 0.05 })
  },
  tick() {
    if (!ctx) return
    const now = ctx.currentTime
    if (now - lastTick < 0.045) return
    lastTick = now
    noise({ dur: 0.018, gain: 0.09, freq: 3200, q: 4 })
  },
  reelStop() {
    tone({ freq: 140, to: 55, dur: 0.22, gain: 0.35 })
    noise({ dur: 0.06, gain: 0.2, freq: 1400, q: 1.5 })
  },
  win() {
    ;[523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      tone({ freq: f, type: 'triangle', start: i * 0.09, dur: 0.6, gain: 0.16 }),
    )
    tone({ freq: 2093, type: 'sine', start: 0.36, dur: 0.9, gain: 0.05 })
  },
  fanfare() {
    const chord = (fs, start, dur) =>
      fs.forEach((f) => tone({ freq: f, type: 'sawtooth', start, dur, gain: 0.05, attack: 0.03 }))
    chord([392, 493.88, 587.33], 0, 0.22)
    chord([392, 493.88, 587.33], 0.24, 0.12)
    chord([523.25, 659.25, 783.99], 0.4, 1.1)
    noise({ start: 0.4, dur: 1.0, gain: 0.05, freq: 6000, q: 0.5, type: 'highpass' })
  },
  highlight() {
    tone({ freq: 880, type: 'sine', dur: 0.5, gain: 0.12 })
    tone({ freq: 1318.5, type: 'sine', start: 0.08, dur: 0.6, gain: 0.08 })
  },
  remove() {
    tone({ freq: 660, to: 220, type: 'triangle', dur: 0.5, gain: 0.08 })
  },
}

export function buzz(ms) {
  try {
    navigator.vibrate?.(ms)
  } catch {
    /* niet ondersteund */
  }
}
