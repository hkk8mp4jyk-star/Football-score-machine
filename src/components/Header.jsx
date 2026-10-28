import { PARTICIPANTS, ROUNDS } from '../game/config.js'

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
    <div className="rounds" aria-label={`Ronde ${round} van ${ROUNDS}`}>
      {Array.from({ length: ROUNDS }, (_, i) => i + 1).map((r) => (
        <span key={r} className={`round ${r === round ? 'is-active' : ''} ${r < round ? 'is-done' : ''}`}>
          Ronde {r}
        </span>
      ))}
    </div>
  )
}

// Grote naam met daaronder een subtiele regel ('Hierna: …' of 'Draait voor …').
export function PlayerSpot({ name, sub }) {
  return (
    <div className="player-spot">
      <span key={name} className="player-name">
        {name}
      </span>
      {sub && <span className="player-next">{sub}</span>}
    </div>
  )
}

// Bovenste navigatieregel: links de fase, rechts het uitslagenoverzicht.
export function NavRow({ children, onOverview, disabled }) {
  return (
    <div className="nav-row">
      <div className="nav-left">{children}</div>
      <button type="button" className="nav-link" onClick={onOverview} disabled={disabled}>
        Uitslagen<span className="nav-link-long"> bekijken</span>
        <span aria-hidden="true" className="nav-chevron">
          ›
        </span>
      </button>
    </div>
  )
}

// Onderbalk: teller links, demo-menu rechts.
export function Footer({ count, label, sub, onMenu }) {
  return (
    <footer className="bottom">
      <div className="counter">
        <span className="counter-num">{count}</span>
        <span className="counter-text">
          {label}
          <small>{sub}</small>
        </span>
      </div>
      <MenuButton onClick={onMenu} />
    </footer>
  )
}
