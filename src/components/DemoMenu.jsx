import { useState } from 'react'
import { PARTICIPANTS } from '../game/config.js'

export default function DemoMenu({ phase, sound, onSound, role, onRole, onSkip, onReset, onClose }) {
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
          <div className="menu-group">
            <span>
              Weergave
              <small>Bekijk het scherm als organisator of als deelnemer</small>
            </span>
            <div className="segmented" role="radiogroup" aria-label="Weergave">
              <button
                type="button"
                role="radio"
                aria-checked={role.kind === 'organizer'}
                className={role.kind === 'organizer' ? 'is-active' : ''}
                onClick={() => onRole({ kind: 'organizer' })}
              >
                Organisator
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={role.kind === 'participant'}
                className={role.kind === 'participant' ? 'is-active' : ''}
                onClick={() => onRole({ kind: 'participant', participant: role.participant ?? 0 })}
              >
                Deelnemer
              </button>
            </div>
            {role.kind === 'participant' && (
              <div className="name-grid name-grid-small" role="radiogroup" aria-label="Bekijk als">
                {PARTICIPANTS.map((name, i) => (
                  <button
                    key={name}
                    type="button"
                    role="radio"
                    aria-checked={role.participant === i}
                    className={`name-chip ${role.participant === i ? 'is-active' : ''}`}
                    onClick={() => onRole({ kind: 'participant', participant: i })}
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
          </div>
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
