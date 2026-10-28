import { useEffect, useRef } from 'react'
import { TIMING } from '../game/config.js'

// Jackpotmoment over het hele scherm: flits, lichtstralen, muntenregen en
// grote MEGA WIN-letters. De munten worden op een canvas getekend.

const COIN_COUNT = 150

function makeCoin(w, h, i) {
  const fountain = i % 3 !== 0
  const size = 9 + Math.random() * 13
  if (fountain) {
    // Uitbarsting vanaf het midden van de machine, omhoog en naar buiten.
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.9
    const speed = 520 + Math.random() * 620
    return {
      x: w / 2 + (Math.random() - 0.5) * 60,
      y: h * 0.55,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size,
      spin: Math.random() * Math.PI * 2,
      spinSpeed: 6 + Math.random() * 10,
      delay: Math.random() * 0.9,
    }
  }
  // Regen van boven.
  return {
    x: Math.random() * w,
    y: -30 - Math.random() * h * 0.6,
    vx: (Math.random() - 0.5) * 60,
    vy: 120 + Math.random() * 160,
    size,
    spin: Math.random() * Math.PI * 2,
    spinSpeed: 5 + Math.random() * 8,
    delay: 0.15 + Math.random() * 1.6,
    rain: true,
  }
}

function drawCoin(ctx, c) {
  const flip = Math.cos(c.spin)
  const rx = Math.max(0.12, Math.abs(flip)) * c.size
  const front = flip > 0
  const g = ctx.createLinearGradient(c.x - rx, c.y - c.size, c.x + rx, c.y + c.size)
  g.addColorStop(0, front ? '#fff3c4' : '#d8a945')
  g.addColorStop(0.45, front ? '#e8bf5c' : '#a8761f')
  g.addColorStop(1, front ? '#9a6c1a' : '#6b4810')
  ctx.beginPath()
  ctx.ellipse(c.x, c.y, rx, c.size, 0, 0, Math.PI * 2)
  ctx.fillStyle = g
  ctx.fill()
  ctx.lineWidth = 1.4
  ctx.strokeStyle = '#5c3f0e'
  ctx.stroke()
  if (rx > c.size * 0.45) {
    ctx.beginPath()
    ctx.ellipse(c.x, c.y, rx * 0.66, c.size * 0.66, 0, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(255, 244, 200, 0.75)'
    ctx.lineWidth = 1.2
    ctx.stroke()
  }
}

function CoinShower() {
  const ref = useRef(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas.getContext('2d')
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    canvas.width = w * dpr
    canvas.height = h * dpr
    ctx.scale(dpr, dpr)

    const coins = Array.from({ length: COIN_COUNT }, (_, i) => makeCoin(w, h, i))
    const sparkles = Array.from({ length: 40 }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      phase: Math.random() * Math.PI * 2,
      size: 2 + Math.random() * 4,
    }))
    const gravity = 900
    const start = performance.now()
    let last = start
    let raf = 0

    const frame = (now) => {
      const t = (now - start) / 1000
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      ctx.clearRect(0, 0, w, h)

      // Twinkelende sterretjes
      for (const s of sparkles) {
        const a = Math.max(0, Math.sin(t * 7 + s.phase))
        if (a < 0.05) continue
        // Vierpuntige glinstering
        const r = s.size * 2.2 * (0.6 + a * 0.4)
        ctx.save()
        ctx.globalAlpha = a
        ctx.fillStyle = '#fff6d6'
        ctx.translate(s.x, s.y)
        ctx.beginPath()
        ctx.moveTo(0, -r)
        ctx.quadraticCurveTo(0, 0, r, 0)
        ctx.quadraticCurveTo(0, 0, 0, r)
        ctx.quadraticCurveTo(0, 0, -r, 0)
        ctx.quadraticCurveTo(0, 0, 0, -r)
        ctx.fill()
        ctx.restore()
      }

      for (const c of coins) {
        if (t < c.delay) continue
        c.vy += gravity * dt * (c.rain ? 0.35 : 1)
        c.x += c.vx * dt
        c.y += c.vy * dt
        c.spin += c.spinSpeed * dt
        if (c.y - c.size < h) drawCoin(ctx, c)
      }
      if (t < TIMING.megaWin / 1000) raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  return <canvas ref={ref} className="mega-coins" aria-hidden="true" />
}

export default function MegaWin({ show }) {
  if (!show) return null
  return (
    <div className="mega" role="status" aria-label="Mega win">
      <div className="mega-flash" aria-hidden="true" />
      <div className="mega-rays" aria-hidden="true" />
      <CoinShower />
      <div className="mega-title">
        <span className="mega-word">Mega win</span>
      </div>
    </div>
  )
}
