// Gesynthetiseerde show-geluiden via Web Audio. Geen audiobestanden nodig.

let ctx = null
let master = null
let enabled = true
let lastTick = 0

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
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

export function setSoundEnabled(on) {
  enabled = on
}

// Moet vanuit een tik/klik aangeroepen worden (iOS ontgrendelt dan audio).
export function unlockAudio() {
  ac()
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
