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

// Bovenste navigatieregel: links de fase, rechts het uitslagenoverzicht
// (en optioneel extra knoppen, zoals het demo-menu in de veiling).
export function NavRow({ children, onOverview, disabled, extra }) {
  return (
    <div className="nav-row">
      <div className="nav-left">{children}</div>
      <div className="nav-right">
        <button type="button" className="nav-link" onClick={onOverview} disabled={disabled}>
          Uitslagen<span className="nav-link-long"> bekijken</span>
          <span aria-hidden="true" className="nav-chevron">
            ›
          </span>
        </button>
        {extra}
      </div>
    </div>
  )
}

// Klein rond icoon voor de organisator: volgende veiling klaarzetten.
export function OrganizerButton({ onClick, disabled, attention }) {
  return (
    <button
      type="button"
      className={`nav-icon nav-icon-org ${attention ? 'is-attention' : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label="Volgende veiling klaarzetten"
      title="Volgende veiling"
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        {/* veilinghamer */}
        <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13.5 4.5l6 6M11 7l6 6M12.2 5.8l4.9 4.9" />
          <path d="M14 10L5.5 18.5" />
          <path d="M3.5 21h8" />
        </g>
      </svg>
    </button>
  )
}

// Compact demo-menuknopje voor in de navigatieregel.
export function NavMenuButton({ onClick }) {
  return (
    <button type="button" className="nav-icon" onClick={onClick} aria-label="Demo-instellingen">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <circle cx="5" cy="12" r="2" fill="currentColor" />
        <circle cx="12" cy="12" r="2" fill="currentColor" />
        <circle cx="19" cy="12" r="2" fill="currentColor" />
      </svg>
    </button>
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
