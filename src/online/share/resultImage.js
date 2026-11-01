// Deelbare einduitslag (F10): PNG van 1080 px breed van het actieve tabblad
// ("Uitslagen" = raster, zie gridModel; "Per deelnemer" = hieronder), hoogte volgt de
// inhoud. Bovenaan titel, wedstrijd, speeldatum en totale pot; daaronder
// direct per deelnemer (definitieve gelote volgorde) alle getrokken
// uitslagen met het betaalde bedrag en het totaal. Alle uitslagblokjes zijn
// gelijk: geen MEGA-, veiling- of OVERIG-markering, geen legenda, geen
// winnaar. Alleen bestaande spelgegevens en de bestaande geldfuncties.

import { OTHER_ID } from '../../game/config.js'
import { configOf, gridGoalsFor } from '../../game/gameConfig.js'
import { drawValueCents, formatCents, potCents, totalCents } from '../../game/money.js'

// ---------------------------------------------------------------------------
// Gegevens (puur, getest)
// ---------------------------------------------------------------------------
const dateFmt = new Intl.DateTimeFormat('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
export const playDate = (ms) => dateFmt.format(new Date(ms))

// Zoals de chips in de app: "Overig" als gewone tekst.
const label = (id) => (id === OTHER_ID ? 'Overig' : id)

// `state` = afgeronde spelstatus (settle op de huidige tijd).
export function shareModel(room, state) {
  const config = configOf(state)
  return {
    matchName: room.matchName,
    date: playDate(room.startedAt),
    potCents: potCents(state),
    // Definitieve gelote volgorde; trekkingen in volgorde van trekken.
    players: config.players.map((p, i) => {
      const mine = state.draws.filter((d) => d.participant === p.id)
      return {
        num: i + 1,
        name: p.name,
        draws: mine.map((d) => ({ label: label(d.resultId), cents: drawValueCents(d, config.priceCents) })),
        totalCents: totalCents(mine, config.priceCents),
      }
    }),
  }
}

// Raster (tabblad "Uitslagen"): dezelfde indeling als in de app. Per vak de
// uitslag en, als hij getrokken is, de deelnemer. Uitslagen die niet in de
// pool zitten blijven gedimd zichtbaar; OVERIG staat onder het raster.
export function gridModel(room, state) {
  const config = configOf(state)
  const goals = gridGoalsFor(config)
  const inPool = new Set(config.pool)
  const nameOf = new Map(config.players.map((p) => [p.id, p.name]))
  const owner = new Map(state.draws.map((d) => [d.resultId, nameOf.get(d.participant) ?? '']))
  const cell = (id) => ({ id, inPool: inPool.has(id), name: owner.get(id) ?? null })
  return {
    matchName: room.matchName,
    date: playDate(room.startedAt),
    potCents: potCents(state),
    goals,
    rows: goals.map((h) => goals.map((a) => cell(`${h}-${a}`))),
    other: cell(OTHER_ID),
  }
}

// einduitslag-werder-bremen-ii-bremer-sv-2026-11-01.png (per deelnemer)
// uitslagen-werder-bremen-ii-bremer-sv-2026-11-01.png (raster)
export function shareFileName(matchName, startedAt, kind = 'people') {
  const slug = matchName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  const d = new Date(startedAt)
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return `${kind === 'grid' ? 'uitslagen' : 'einduitslag'}-${slug || 'wedstrijd'}-${ymd}.png`
}

// ---------------------------------------------------------------------------
// Tekenen
// ---------------------------------------------------------------------------
export const IMAGE_WIDTH = 1080
const PAD = 56
const INNER = IMAGE_WIDTH - 2 * PAD
const C = {
  bgTop: '#0b2152',
  bgBottom: '#030a1d',
  card: 'rgba(22, 50, 118, 0.42)',
  cardLine: 'rgba(159, 176, 214, 0.18)',
  ivory: '#f8f1de',
  mist: '#9fb0d6',
  ink: '#0a1736',
  gold200: '#fbeec4',
  gold300: '#f4dc95',
  gold400: '#e5bf63',
  gold500: '#c7973a',
}
const F = {
  display: (px) => `${px}px Anton, Impact, "Arial Narrow Bold", sans-serif`,
  cond: (px, w = 600) => `${w} ${px}px "Barlow Condensed", "Arial Narrow", sans-serif`,
}

function goldGradient(ctx, y, h) {
  const g = ctx.createLinearGradient(0, y, 0, y + h)
  g.addColorStop(0, C.gold200)
  g.addColorStop(0.38, C.gold400)
  g.addColorStop(0.62, C.gold500)
  g.addColorStop(1, C.gold300)
  return g
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
function spaced(ctx, text, x, y, spacing) {
  // letterafstand, gecentreerd (canvas-letterSpacing is niet overal beschikbaar)
  const chars = [...text]
  const widths = chars.map((c) => ctx.measureText(c).width)
  let cx = x - (widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1)) / 2
  ctx.textAlign = 'left'
  chars.forEach((c, i) => {
    ctx.fillText(c, cx, y)
    cx += widths[i] + spacing
  })
}
function fit(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text
  let t = text
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1)
  return `${t}…`
}
function wrapLines(ctx, text, maxW, maxLines) {
  const lines = []
  let line = ''
  for (const w of text.split(/\s+/)) {
    const next = line ? `${line} ${w}` : w
    if (ctx.measureText(next).width <= maxW || !line) line = next
    else {
      lines.push(line)
      line = w
    }
  }
  if (line) lines.push(line)
  if (lines.length > maxLines) return [...lines.slice(0, maxLines - 1), fit(ctx, lines.slice(maxLines - 1).join(' '), maxW)]
  return lines.map((l) => fit(ctx, l, maxW))
}

// Maten van de deelnemerskaarten.
const CARD_PAD = 26
const HEAD_H = 70
const CHIP_H = 62
const CHIP_GAP = 10
const CARD_GAP = 16
const CHIP_LABEL = 40
const CHIP_AMOUNT = 30

// Kop (beide afbeeldingen): titel, wedstrijd, speeldatum, totale pot.
// Geeft de y-positie onder de kop terug.
function paintHeader(ctx, m, draw) {
  ctx.textBaseline = 'alphabetic'
  let y = 72
  // --- kop ---
  if (draw) {
    ctx.font = F.cond(26, 600)
    ctx.fillStyle = C.gold300
    spaced(ctx, 'FOOTBALL', IMAGE_WIDTH / 2, y, 12)
  }
  y += 62
  if (draw) {
    ctx.font = F.display(64)
    ctx.fillStyle = goldGradient(ctx, y - 56, 64)
    ctx.textAlign = 'center'
    ctx.fillText('SCORE MACHINE', IMAGE_WIDTH / 2, y)
  }
  ctx.font = F.display(56)
  for (const l of wrapLines(ctx, m.matchName.toUpperCase(), INNER, 2)) {
    y += 76
    if (draw) {
      ctx.font = F.display(56)
      ctx.fillStyle = C.ivory
      ctx.textAlign = 'center'
      ctx.fillText(l, IMAGE_WIDTH / 2, y)
    }
  }
  y += 48
  if (draw) {
    ctx.font = F.cond(32, 600)
    ctx.fillStyle = C.mist
    ctx.textAlign = 'center'
    ctx.fillText(m.date, IMAGE_WIDTH / 2, y)
  }
  // totale pot: één regel in een gouden kader
  y += 30
  const potH = 100
  if (draw) {
    const potTxt = formatCents(m.potCents)
    ctx.font = F.display(64)
    const pw = ctx.measureText(potTxt).width
    ctx.font = F.cond(30, 700)
    const label = 'TOTALE POT'
    const lw = [...label].reduce((a, c) => a + ctx.measureText(c).width, 0) + 5 * (label.length - 1)
    const boxW = Math.min(INNER, lw + 28 + pw + 96)
    const bx = (IMAGE_WIDTH - boxW) / 2
    roundRect(ctx, bx, y, boxW, potH, 24)
    ctx.fillStyle = 'rgba(3, 10, 29, 0.55)'
    ctx.fill()
    ctx.lineWidth = 3
    ctx.strokeStyle = goldGradient(ctx, y, potH)
    ctx.stroke()
    const startX = bx + 48
    ctx.fillStyle = C.gold300
    spaced(ctx, label, startX + lw / 2, y + 61, 5)
    ctx.font = F.display(64)
    ctx.fillStyle = goldGradient(ctx, y + 18, 66)
    ctx.textAlign = 'left'
    ctx.fillText(potTxt, startX + lw + 28, y + 76)
  }
  return y + potH + 40
}

// Eén pas: met `draw = false` alleen meten (hoogte), daarna echt tekenen.
function paint(ctx, m, draw) {
  let y = paintHeader(ctx, m, draw)

  // --- per deelnemer ---
  const innerX = PAD + CARD_PAD
  const innerW = INNER - 2 * CARD_PAD
  for (const p of m.players) {
    // chips plaatsen (meten)
    const chips = []
    let cx = innerX
    let row = 0
    for (const d of p.draws) {
      ctx.font = F.display(CHIP_LABEL)
      const lw = ctx.measureText(d.label).width
      ctx.font = F.cond(CHIP_AMOUNT, 700)
      const aw = ctx.measureText(formatCents(d.cents)).width
      const w = 18 + lw + 14 + 2 + 14 + aw + 18
      if (cx + w > innerX + innerW && cx > innerX) {
        row++
        cx = innerX
      }
      chips.push({ d, x: cx, row, w, lw })
      cx += w + CHIP_GAP
    }
    const rows = Math.max(1, chips.length ? row + 1 : 1)
    const cardH = CARD_PAD - 4 + HEAD_H + rows * (CHIP_H + CHIP_GAP) - CHIP_GAP + CARD_PAD
    if (draw) {
      roundRect(ctx, PAD, y, INNER, cardH, 22)
      ctx.fillStyle = C.card
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = C.cardLine
      ctx.stroke()
      const base = y + CARD_PAD - 4 + 50
      // positie + naam links, totaal rechts
      ctx.textAlign = 'left'
      ctx.font = F.display(40)
      ctx.fillStyle = C.gold500
      const num = String(p.num)
      ctx.fillText(num, innerX, base)
      const numW = ctx.measureText(num).width
      const totalTxt = formatCents(p.totalCents)
      ctx.font = F.display(52)
      const totW = ctx.measureText(totalTxt).width
      ctx.textAlign = 'right'
      ctx.fillStyle = goldGradient(ctx, base - 46, 52)
      ctx.fillText(totalTxt, innerX + innerW, base + 2)
      ctx.textAlign = 'left'
      ctx.font = F.display(48)
      ctx.fillStyle = C.ivory
      ctx.fillText(fit(ctx, p.name.toUpperCase(), innerW - numW - 22 - totW - 28), innerX + numW + 22, base)
      // uitslagblokjes: allemaal gelijk (goud, uitslag | bedrag)
      for (const c of chips) {
        const top = y + CARD_PAD - 4 + HEAD_H + c.row * (CHIP_H + CHIP_GAP)
        roundRect(ctx, c.x, top, c.w, CHIP_H, 12)
        ctx.fillStyle = goldGradient(ctx, top, CHIP_H)
        ctx.fill()
        ctx.fillStyle = C.ink
        ctx.textAlign = 'left'
        ctx.font = F.display(CHIP_LABEL)
        ctx.fillText(c.d.label, c.x + 18, top + 47)
        ctx.fillStyle = 'rgba(10, 23, 54, 0.35)'
        ctx.fillRect(c.x + 18 + c.lw + 14, top + 16, 2, CHIP_H - 32)
        ctx.font = F.cond(CHIP_AMOUNT, 700)
        ctx.fillStyle = 'rgba(10, 23, 54, 0.85)'
        ctx.fillText(formatCents(c.d.cents), c.x + 18 + c.lw + 30, top + 42)
      }
      if (!chips.length) {
        ctx.font = F.cond(30, 500)
        ctx.fillStyle = C.mist
        ctx.fillText('Geen uitslagen', innerX, y + CARD_PAD - 4 + HEAD_H + 40)
      }
    }
    y += cardH + CARD_GAP
  }
  return y - CARD_GAP + 48
}

// Raster-afbeelding: kleuren en vormen zoals het tabblad "Uitslagen" in de app.
function paintGrid(ctx, m, draw) {
  let y = paintHeader(ctx, m, draw)
  const n = m.goals.length
  const axisW = 44
  const gap = n > 5 ? 10 : 12
  const cw = (INNER - axisW - gap * n) / n
  const ch = n > 5 ? 104 : 118
  const nameFont = n > 5 ? 25 : 28
  const scoreFont = n > 5 ? 38 : 44
  const colX = (i) => PAD + axisW + gap + i * (cw + gap)
  const cellBox = (x, top, w, h, c) => {
    roundRect(ctx, x, top, w, h, 14)
    if (!c.inPool) {
      ctx.setLineDash([7, 6])
      ctx.lineWidth = 2
      ctx.strokeStyle = 'rgba(159, 176, 214, 0.18)'
      ctx.stroke()
      ctx.setLineDash([])
    } else if (!c.name) {
      ctx.fillStyle = goldGradient(ctx, top, h)
      ctx.fill()
    } else {
      ctx.fillStyle = 'rgba(22, 50, 118, 0.55)'
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = 'rgba(159, 176, 214, 0.2)'
      ctx.stroke()
    }
  }
  // kolomkoppen (uitdoelpunten)
  y += 6
  if (draw) {
    ctx.font = F.display(34)
    ctx.fillStyle = C.gold500
    ctx.textAlign = 'center'
    m.goals.forEach((g, i) => ctx.fillText(String(g), colX(i) + cw / 2, y + 30))
  }
  y += 48
  m.rows.forEach((row, r) => {
    const top = y + r * (ch + gap)
    if (!draw) return
    ctx.font = F.display(34)
    ctx.fillStyle = C.gold500
    ctx.textAlign = 'center'
    ctx.fillText(String(m.goals[r]), PAD + axisW / 2, top + ch / 2 + 13)
    row.forEach((c, i) => {
      const x = colX(i)
      cellBox(x, top, cw, ch, c)
      ctx.textAlign = 'center'
      const free = c.inPool && !c.name
      ctx.font = F.display(scoreFont)
      ctx.fillStyle = !c.inPool ? 'rgba(159, 176, 214, 0.3)' : free ? C.ink : 'rgba(159, 176, 214, 0.75)'
      ctx.fillText(c.id, x + cw / 2, c.inPool ? top + ch / 2 + 2 : top + ch / 2 + scoreFont / 2 - 4)
      if (c.inPool) {
        ctx.font = F.cond(free ? nameFont - 6 : nameFont, free ? 700 : 600)
        ctx.fillStyle = free ? 'rgba(10, 23, 54, 0.6)' : C.ivory
        ctx.fillText(free ? 'VRIJ' : fit(ctx, c.name, cw - 12), x + cw / 2, top + ch - 18)
      }
    })
  })
  y += n * (ch + gap)
  // OVERIG onder het raster, zoals in de app
  const oh = 84
  if (draw) {
    const x = colX(0)
    const w = INNER - axisW - gap
    cellBox(x, y, w, oh, m.other)
    const free = !m.other.name
    ctx.font = F.display(40)
    const lab = 'OVERIGE UITSLAGEN'
    const lw = ctx.measureText(lab).width
    ctx.font = F.cond(32, 600)
    const who = free ? 'VRIJ' : fit(ctx, m.other.name, w - lw - 80)
    const ww = ctx.measureText(who).width
    const start = x + (w - (lw + 24 + ww)) / 2
    ctx.textAlign = 'left'
    ctx.font = F.display(40)
    ctx.fillStyle = free ? C.ink : 'rgba(159, 176, 214, 0.75)'
    ctx.fillText(lab, start, y + oh / 2 + 15)
    ctx.font = F.cond(32, 600)
    ctx.fillStyle = free ? 'rgba(10, 23, 54, 0.6)' : C.ivory
    ctx.fillText(who, start + lw + 24, y + oh / 2 + 12)
  }
  return y + oh + 48
}

export async function loadImageFonts() {
  if (typeof document === 'undefined' || !document.fonts?.load) return
  await Promise.all([
    document.fonts.load(F.display(80)),
    document.fonts.load(F.cond(30, 600)),
    document.fonts.load(F.cond(30, 700)),
    document.fonts.load(F.cond(30, 500)),
  ]).catch(() => {})
}

// Tekent de afbeelding op een nieuw canvas en geeft het terug.
export async function renderResultCanvas(model, { kind = 'people', createCanvas = () => document.createElement('canvas') } = {}) {
  const painter = kind === 'grid' ? paintGrid : paint
  await loadImageFonts()
  const probe = createCanvas()
  probe.width = IMAGE_WIDTH
  probe.height = 10
  const height = Math.ceil(painter(probe.getContext('2d'), model, false))
  const canvas = createCanvas()
  canvas.width = IMAGE_WIDTH
  canvas.height = height
  const ctx = canvas.getContext('2d')
  const bg = ctx.createLinearGradient(0, 0, 0, height)
  bg.addColorStop(0, C.bgTop)
  bg.addColorStop(Math.min(1, 700 / height), '#061433')
  bg.addColorStop(1, C.bgBottom)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, IMAGE_WIDTH, height)
  painter(ctx, model, true)
  return canvas
}

// kind: 'people' (tabblad Per deelnemer) of 'grid' (tabblad Uitslagen).
export async function renderResultFile(room, state, kind = 'people') {
  const model = kind === 'grid' ? gridModel(room, state) : shareModel(room, state)
  const canvas = await renderResultCanvas(model, { kind })
  const blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('png'))), 'image/png'))
  return new File([blob], shareFileName(room.matchName, room.startedAt, kind), { type: 'image/png' })
}

// Delen via het deelmenu van de telefoon (WhatsApp e.d.); anders downloaden.
// Uitkomst: 'shared' | 'cancelled' | 'downloaded'.
export async function shareOrDownload(file, { title = 'Einduitslag', nav = globalThis.navigator, doc = globalThis.document } = {}) {
  if (nav?.canShare?.({ files: [file] }) && nav.share) {
    try {
      await nav.share({ files: [file], title })
      return 'shared'
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancelled'
      // anders: terugvallen op downloaden
    }
  }
  const url = URL.createObjectURL(file)
  const a = doc.createElement('a')
  a.href = url
  a.download = file.name
  a.rel = 'noopener'
  doc.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return 'downloaded'
}
