import { useEffect, useLayoutEffect, useRef } from 'react'
import { REEL_SYMBOLS } from '../game/config.js'
import { buildProfile, mod } from '../game/reelMotion.js'
import { clock } from '../game/clock.js'

// Eén cijferrol. De rol is een eindeloze band 0..4,★ (of 0..6,★ bij spellen
// met uitslagen boven 4 goals; de ster is altijd het laatste symbool) die per
// frame via requestAnimationFrame wordt getekend (geen React-render per frame).
// Het bewegingsprofiel staat in game/reelMotion.js.

const STAR_SVG =
  '<svg viewBox="0 0 100 100" class="reel-star" aria-hidden="true"><path d="M50 4 L62.4 36.6 L97.6 38.2 L70.1 60.4 L79.4 94.4 L50 75 L20.6 94.4 L29.9 60.4 L2.4 38.2 L37.6 36.6 Z"/></svg>'

const CELLS = 5

function symbolHtml(i, symbols) {
  const s = mod(i, symbols)
  return s === symbols - 1 ? STAR_SVG : String(s)
}

export default function Reel({ spin, target, stopAfter, restSymbol, onStop, onTick, label, symbols = REEL_SYMBOLS }) {
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
      const html = symbolHtml(i, symbols)
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
    posRef.current = p + mod(restSymbol - p, symbols)
    paint(posRef.current)
  }, [restSymbol, spin])

  useEffect(() => {
    if (!spin) return
    const profile = buildProfile(Math.round(posRef.current), target, stopAfter, symbols)
    let raf = 0
    let stopped = false
    let lastCell = Math.floor(posRef.current)
    windowRef.current?.classList.remove('is-landed')

    const frame = () => {
      const t = (clock.now() - spin.startedAt) / 1000
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
