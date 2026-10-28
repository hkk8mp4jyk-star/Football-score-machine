import { useState } from 'react'

export default function DemoMenu({ phase, sound, onSound, onSkip, onReset, onClose }) {
  const [confirmReset, setConfirmReset] = useState(false)
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Demo">
        <div className="sheet-head">
          <h2>Demo</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Sluiten">
            ✕
          </button>
        </div>
        <div className="menu-list">
          <button type="button" className="menu-item" onClick={onSound}>
            <span>Geluid</span>
            <span className={`switch ${sound ? 'is-on' : ''}`} aria-hidden="true" />
          </button>
          {phase === 'draw' && (
            <button type="button" className="menu-item" onClick={onSkip}>
              <span>
                Direct naar de veiling
                <small>Trekt de 27 uitslagen automatisch</small>
              </span>
              <span aria-hidden="true">›</span>
            </button>
          )}
          {confirmReset ? (
            <div className="menu-confirm">
              <span>Alle trekkingen wissen en opnieuw beginnen?</span>
              <div className="menu-confirm-row">
                <button type="button" className="ghost-btn" onClick={() => setConfirmReset(false)}>
                  Annuleren
                </button>
                <button type="button" className="danger-btn" onClick={onReset}>
                  Demo resetten
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="menu-item" onClick={() => setConfirmReset(true)}>
              <span>
                Demo resetten
                <small>Begin opnieuw bij ronde 1</small>
              </span>
              <span aria-hidden="true">›</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
