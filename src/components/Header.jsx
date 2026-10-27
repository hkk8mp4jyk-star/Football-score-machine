import { PARTICIPANTS } from '../game/config.js'

export function Logo({ compact }) {
  return (
    <div className={`logo ${compact ? 'logo-compact' : ''}`}>
      <span className="logo-top">Football</span>
      <span className="logo-main">Score Machine</span>
    </div>
  )
}

export function MenuButton({ onClick }) {
  return (
    <button type="button" className="icon-btn" onClick={onClick} aria-label="Demo-instellingen">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <circle cx="5" cy="12" r="2" fill="currentColor" />
        <circle cx="12" cy="12" r="2" fill="currentColor" />
        <circle cx="19" cy="12" r="2" fill="currentColor" />
      </svg>
    </button>
  )
}

export function RoundBadges({ round }) {
  return (
    <div className="rounds" aria-label={`Ronde ${round} van 3`}>
      {[1, 2, 3].map((r) => (
        <span key={r} className={`round ${r === round ? 'is-active' : ''} ${r < round ? 'is-done' : ''}`}>
          Ronde {r}
        </span>
      ))}
    </div>
  )
}

export function PlayerSpot({ label, participant }) {
  return (
    <div className="player-spot">
      <span className="player-label">{label}</span>
      <span key={participant} className="player-name">
        {participant != null ? PARTICIPANTS[participant] : '—'}
      </span>
    </div>
  )
}
