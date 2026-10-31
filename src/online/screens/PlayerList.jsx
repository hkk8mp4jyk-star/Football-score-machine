import { useRef, useState } from 'react'

const GAP = 6 // ruimte tussen de rijen (gelijk aan de CSS)

// Spelerslijst in speelvolgorde. Voor de organisator met slepen (⋮⋮),
// pijltjes ▲▼ en verwijderen ✕ (B5, B6; ook de organisator zelf, met bevestiging).
export function PlayerList({ players, editable = false, busy = false, onMove, onRemove }) {
  const listRef = useRef(null)
  const [drag, setDrag] = useState(null) // { from, to, dy, pitch, startY, id }

  const start = (e, index) => {
    if (!editable || busy || players.length < 2) return
    const row = listRef.current?.children[index]
    const pitch = (row?.offsetHeight ?? 44) + GAP
    e.currentTarget.setPointerCapture?.(e.pointerId)
    setDrag({ from: index, to: index, dy: 0, pitch, startY: e.clientY, id: e.pointerId })
  }
  const move = (e) => {
    if (!drag || e.pointerId !== drag.id) return
    const dy = e.clientY - drag.startY
    const to = Math.max(0, Math.min(players.length - 1, drag.from + Math.round(dy / drag.pitch)))
    setDrag({ ...drag, dy, to })
  }
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return
    const { from, to } = drag
    setDrag(null)
    if (to !== from) onMove(from, to)
  }

  // Tijdens het slepen schuiven de andere rijen alvast op.
  const shift = (i) => {
    if (!drag) return 0
    if (i === drag.from) return drag.dy
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return -drag.pitch
    if (drag.from > drag.to && i < drag.from && i >= drag.to) return drag.pitch
    return 0
  }

  return (
    <ul className={`ol-players ${drag ? 'is-dragging' : ''}`.trim()} ref={listRef}>
      {players.map((p, i) => (
        <li
          key={p.slot}
          className={`ol-player ${p.isMe ? 'is-me' : ''} ${drag?.from === i ? 'is-lifted' : ''}`.replace(/\s+/g, ' ').trim()}
          style={drag ? { transform: `translateY(${shift(i)}px)` } : undefined}
        >
          {editable && (
            <span
              className="ol-handle"
              aria-hidden="true"
              onPointerDown={(e) => start(e, i)}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={() => setDrag(null)}
            >
              ⋮⋮
            </span>
          )}
          <span className="ol-num">{i + 1}</span>
          <span className="ol-name">{p.name}</span>
          {p.isOrganizer && (
            <span className="ol-tag">
              <span className="ol-tag-long">Organisator</span>
              <span className="ol-tag-short">Org.</span>
            </span>
          )}
          {p.isMe && !p.isOrganizer && <span className="ol-tag is-soft">Jij</span>}
          {p.manual && (
            <span className="ol-tag is-soft">
              <span className="ol-tag-long">Zonder telefoon</span>
              <span className="ol-tag-short">Geen tel.</span>
            </span>
          )}
          {editable && (
            <>
              <button type="button" className="ol-icon" onClick={() => onMove(i, i - 1)} disabled={busy || i === 0} aria-label={`${p.name} omhoog`}>
                ▲
              </button>
              <button
                type="button"
                className="ol-icon"
                onClick={() => onMove(i, i + 1)}
                disabled={busy || i === players.length - 1}
                aria-label={`${p.name} omlaag`}
              >
                ▼
              </button>
              <button type="button" className="ol-icon ol-icon-remove" onClick={() => onRemove(p)} disabled={busy} aria-label={`${p.name} verwijderen`}>
                ✕
              </button>
            </>
          )}
        </li>
      ))}
    </ul>
  )
}

// Nieuwe volgorde (slots) na verplaatsen van positie `from` naar `to`.
export function moveSlot(order, from, to) {
  if (to < 0 || to >= order.length || from === to) return order
  const next = [...order]
  const [slot] = next.splice(from, 1)
  next.splice(to, 0, slot)
  return next
}
