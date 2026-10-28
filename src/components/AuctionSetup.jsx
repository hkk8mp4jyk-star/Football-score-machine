import { useRef, useState } from 'react'
import { PARTICIPANTS } from '../game/config.js'

// Compact invoervenster voor de organisator: deelnemer en winnend bod.
export default function AuctionSetup({ initial, onConfirm, onClose }) {
  const [participant, setParticipant] = useState(initial?.participant ?? null)
  const [bid, setBid] = useState(initial?.bid != null ? String(initial.bid).replace('.', ',') : '')
  const inputRef = useRef(null)
  const amount = parseFloat(bid.replace(',', '.'))
  const valid = participant != null && amount > 0

  const submit = (e) => {
    e.preventDefault()
    if (!valid) return
    inputRef.current?.blur() // toetsenbord sluiten
    onConfirm(participant, Math.round(amount * 100) / 100)
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <form className="sheet setup-sheet" onClick={(e) => e.stopPropagation()} onSubmit={submit} aria-label="Volgende veiling">
        <div className="sheet-head">
          <h2>Volgende veiling</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Sluiten">
            ✕
          </button>
        </div>

        <span className="info-label">Deelnemer</span>
        <div className="name-grid" role="radiogroup" aria-label="Deelnemer">
          {PARTICIPANTS.map((name, i) => (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={participant === i}
              className={`name-chip ${participant === i ? 'is-active' : ''}`}
              onClick={() => setParticipant(i)}
            >
              {name}
            </button>
          ))}
        </div>

        <label className="setup-amount">
          <span className="info-label">Winnend bod</span>
          <span className="money-input">
            <span>€</span>
            <input
              ref={inputRef}
              id="bid"
              inputMode="decimal"
              enterKeyHint="done"
              autoComplete="off"
              placeholder="0,00"
              value={bid}
              onChange={(e) => setBid(e.target.value.replace(/[^0-9.,]/g, ''))}
            />
          </span>
        </label>

        <button type="submit" className="gold-btn setup-confirm" disabled={!valid}>
          Beurt vrijgeven
        </button>
      </form>
    </div>
  )
}
