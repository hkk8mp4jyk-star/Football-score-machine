import { useEffect, useLayoutEffect, useRef } from 'react'
import { REEL_SYMBOLS, STAR } from '../game/config.js'

// Eén cijferrol. De rol is een eindeloze band 0,1,2,3,4,5,★ die per frame
// via requestAnimationFrame wordt getekend (geen React-render per frame).
// Het bewegingsprofiel: optrekken -> topsnelheid -> afremmen -> kleine
// terugveer in de "inkeping", zoals bij een mechanische rol.

const STAR_SVG =
  '<svg viewBox="0 0 100 100" class="reel-star" aria-hidden="true"><path d="M50 4 L62.4 36.6 L97.6 38.2 L70.1 60.4 L79.4 94.4 L50 75 L20.6 94.4 L29.9 60.4 L2.4 38.2 L37.6 36.6 Z"/></svg>'

const ACCEL = 0.35 // s
const DECEL = 1.15 // s
const SETTLE = 0.22 // s terugveren
const OVERSHOOT = 0.16 // in symbolen
const TOP_SPEED = 21 // symbolen per seconde (richtwaarde)
const CELLS = 5

const mod = (n, m) => ((n % m) + m) % m
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)

function symbolHtml(i) {
  const s = mod(i, REEL_SYMBOLS)
  return s === STAR ? STAR_SVG : String(s)
}

function buildProfile(p0, target, totalMs) {
  const T = totalMs / 1000
  const Tm = T - SETTLE
  const effective = Tm - ACCEL / 2 - DECEL / 2
  const wanted = p0 + TOP_SPEED * effective - OVERSHOOT
  let land = Math.ceil(wanted)
  land += mod(target - land, REEL_SYMBOLS)
  const pEnd = land + OVERSHOOT
  const v = (pEnd - p0) / effective
  const pA = p0 + (v * ACCEL) / 2
  const pD = pA + v * (Tm - DECEL - ACCEL)
  return {
    T,
    Tm,
    land,
    at(t) {
      if (t <= 0) return { p: p0, v: 0 }
      if (t < ACCEL) return { p: p0 + (v * t * t) / (2 * ACCEL), v: (v * t) / ACCEL }
      if (t < Tm - DECEL) return { p: pA + v * (t - ACCEL), v }
      if (t < Tm) {
        const s = t - (Tm - DECEL)
        return { p: pD + v * s - (v * s * s) / (2 * DECEL), v: v * (1 - s / DECEL) }
      }
      if (t < T) return { p: pEnd - OVERSHOOT * easeInOut((t - Tm) / SETTLE), v: 0 }
      return { p: land, v: 0 }
    },
  }
}

export default function Reel({ spin, target, stopAfter, restSymbol, onStop, onTick, label }) {
  const windowRef = useRef(null)
  const cellsRef = useRef([])
  const posRef = useRef(restSymbol ?? 0)
  const htmlCache = useRef([])
  const heightRef = useRef(100)
  const fastRef = useRef(false)
  const cbRef = useRef({ onStop, onTick })
  cbRef.current = { onStop, onTick }

  const paint = (p) => {
    const H = heightRef.current
    const base = Math.floor(p)
    for (let k = 0; k < CELLS; k++) {
      const i = base + k - 2
      const el = cellsRef.current[k]
      if (!el) continue
      const html = symbolHtml(i)
      if (htmlCache.current[k] !== html) {
        el.innerHTML = html
        htmlCache.current[k] = html
      }
      el.style.transform = `translate3d(0, ${((p - i) * H).toFixed(2)}px, 0)`
    }
  }

  const setFast = (fast) => {
    if (fastRef.current === fast) return
    fastRef.current = fast
    windowRef.current?.classList.toggle('is-fast', fast)
  }

  // Meet de symboolhoogte en herteken bij schermrotatie.
  useLayoutEffect(() => {
    const el = windowRef.current
    const measure = () => {
      heightRef.current = el.clientHeight / 1.55
      el.style.setProperty('--sym-h', `${heightRef.current}px`)
      paint(posRef.current)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Rustpositie (bijv. na herladen) zonder animatie.
  useEffect(() => {
    if (spin || restSymbol == null) return
    const p = Math.round(posRef.current)
    posRef.current = p + mod(restSymbol - p, REEL_SYMBOLS)
    paint(posRef.current)
  }, [restSymbol, spin])

  useEffect(() => {
    if (!spin) return
    const profile = buildProfile(Math.round(posRef.current), target, stopAfter)
    let raf = 0
    let stopped = false
    let lastCell = Math.floor(posRef.current)
    windowRef.current?.classList.remove('is-landed')

    const frame = () => {
      const t = (Date.now() - spin.startedAt) / 1000
      const { p, v } = profile.at(t)
      posRef.current = p
      paint(p)
      setFast(v > 7)
      const cell = Math.floor(p)
      if (cell !== lastCell) {
        lastCell = cell
        cbRef.current.onTick?.()
      }
      if (!stopped && t >= profile.Tm) {
        stopped = true
        setFast(false)
        windowRef.current?.classList.add('is-landed')
        cbRef.current.onStop?.()
      }
      if (t < profile.T) raf = requestAnimationFrame(frame)
      else posRef.current = profile.land
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [spin?.id])

  return (
    <div className="reel-wrap">
      {label && <div className="reel-label">{label}</div>}
      <div ref={windowRef} className="reel-window">
        <div className="reel-strip">
          {Array.from({ length: CELLS }, (_, k) => (
            <div key={k} ref={(el) => (cellsRef.current[k] = el)} className="reel-cell" />
          ))}
        </div>
        <div className="reel-shade" />
        <div className="reel-glass" />
      </div>
    </div>
  )
}
