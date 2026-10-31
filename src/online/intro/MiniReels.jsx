import { reelPosition, visibleItems } from './slotMath.js'

// Symbolen op de kleine fruitautomaatrollen. De munt is het doel van de
// BONUS TRIGGER.
export const MINI_SYMBOLS = ['seven', 'bar', 'star', 'diamond', 'coin', 'cherry']
export const COIN = MINI_SYMBOLS.indexOf('coin')

function Symbol({ kind }) {
  switch (kind) {
    case 'seven':
      return <span className="mr-sym mr-seven">7</span>
    case 'bar':
      return <span className="mr-sym mr-bar">BAR</span>
    case 'star':
      return <span className="mr-sym mr-star">★</span>
    case 'diamond':
      return <span className="mr-sym mr-diamond">◆</span>
    case 'cherry':
      return (
        <span className="mr-sym mr-cherry" aria-hidden="true">
          <i />
          <i />
        </span>
      )
    default:
      return (
        <span className="mr-sym mr-coin" aria-hidden="true">
          <b>★</b>
        </span>
      )
  }
}

// Drie kleine rollen. `positions`: positie per rol (in vakjes, zie slotMath).
// `landed`: rollen die stilstaan (krijgen een korte gouden gloed).
export function MiniReels({ positions, landed = [], size = 'small', lit = false }) {
  const n = MINI_SYMBOLS.length
  return (
    <div className={`mini-reels is-${size} ${lit ? 'is-lit' : ''}`.trim()} aria-hidden="true">
      {positions.map((p, r) => (
        <div key={r} className={`mini-reel ${landed[r] ? 'is-landed' : ''}`.trim()}>
          <div className="mini-reel-window">
            {visibleItems(p, n).map(({ index, offset, key }) => (
              <div key={key} className="mini-item" style={{ transform: `translateY(${offset * 100}%)` }}>
                <Symbol kind={MINI_SYMBOLS[index]} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// Wachtkamer: rustig en continu draaien (eigen klok, niet gesynchroniseerd).
export const warmingPositions = (t) => [0, 1, 2].map((r) => reelPosition(t, { vmax: 0.0016 + r * 0.0003, accel: 1, phase: r * 2.3 }))

// BONUS TRIGGER: versnellen en één voor één stoppen op de munt.
export const bonusPositions = (t, coinStops) =>
  coinStops.map((stopAt, r) => reelPosition(t, { accel: 700, vmax: 0.022, stopAt, decel: 650, target: COIN, count: MINI_SYMBOLS.length, phase: r * 2 }))
