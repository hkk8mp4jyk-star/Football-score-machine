import { useEffect, useState } from 'react'
import { Logo } from '../../components/Header.jsx'
import { MAX_NAME_LENGTH } from '../../game/config.js'

// Opbouw van een online scherm: logo bovenaan, optioneel "‹ Terug",
// daaronder de inhoud (scrollt als die langer is dan het scherm).
export function OnlineScreen({ children, onBack, backLabel = 'Terug', compact = false, className = '' }) {
  return (
    <div className={`screen ol-screen ${className}`.trim()}>
      <header className={`ol-top ${compact ? 'is-compact' : ''}`.trim()}>
        {onBack && (
          <button type="button" className="ol-back" onClick={onBack} aria-label={backLabel === 'Terug' ? 'Terug naar beginscherm' : undefined}>
            ‹ {backLabel}
          </button>
        )}
        <Logo compact={compact} />
      </header>
      <div className="ol-scroll">{children}</div>
    </div>
  )
}

export function Toast({ toast }) {
  if (!toast) return null
  return (
    <div key={toast.id} className={`ol-toast ${toast.bad ? 'is-bad' : ''}`.trim()} role="status">
      {toast.text}
    </div>
  )
}

// Korte meldingen onderin ("Link gekopieerd", foutmeldingen).
export function useToast() {
  const [toast, setToast] = useState(null)
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), toast.bad ? 3600 : 2200)
    return () => clearTimeout(id)
  }, [toast])
  const show = (text, bad = false) => setToast({ text, bad, id: Date.now() + Math.random() })
  return [toast, show]
}

export function NameInput({ value, onChange, autoFocus, id = 'ol-name', placeholder, ariaLabel }) {
  return (
    <input
      id={id}
      className="ol-input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      maxLength={MAX_NAME_LENGTH}
      autoComplete="off"
      autoCapitalize="words"
      enterKeyHint="go"
      placeholder={placeholder}
      aria-label={ariaLabel}
      autoFocus={autoFocus}
    />
  )
}

export function Status({ kind, children }) {
  const icon = kind === 'ok' ? '✓' : kind === 'bad' ? '!' : '…'
  return (
    <div className={`ol-status is-${kind}`}>
      <i aria-hidden="true">{icon}</i>
      <div>{children}</div>
    </div>
  )
}

// Bevestigingsvenster onderin (starten, verwijderen).
export function ConfirmSheet({ title, children, confirmLabel, cancelLabel = 'Annuleren', danger = false, busy = false, confirmDisabled = false, onConfirm, onCancel }) {
  return (
    <div className="sheet-backdrop" onClick={busy ? undefined : onCancel}>
      <div className="sheet ol-confirm" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title}</h2>
        </div>
        {children}
        <div className="ol-confirm-row">
          <button type="button" className="ghost-btn" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button type="button" className={danger ? 'danger-btn' : 'gold-btn ol-btn-confirm'} onClick={onConfirm} disabled={busy || confirmDisabled}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
