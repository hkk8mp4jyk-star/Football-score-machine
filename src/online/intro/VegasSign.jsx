// "Welcome to Fabulous Las Vegas Nevada" — het klassieke welkomstbord bij de
// ingang van Las Vegas (ontwerp Betty Willis, 1959; bewust nooit
// auteursrechtelijk beschermd). Wit ruitvormig bord, rode ster met gele rand
// bovenaan, WELCOME in rode letters op zeven witte "zilveren dollars",
// "to Fabulous" in blauw schrift, LAS VEGAS groot in rood, NEVADA in blauw,
// rondom gele lampjes. De lampjes gaan bij binnenkomst één voor één aan.

const RED = '#d8232a'
const BLUE = '#1f4fa6'
const W = 320
const TOP = { x: 160, y: 24 }
const RIGHT = { x: 310, y: 206 }
const BOTTOM = { x: 160, y: 352 }
const LEFT = { x: 10, y: 206 }

// Lampjes op een iets kleinere ruit binnen de rand.
function bulbPoints(perEdge = 13) {
  const inset = [
    { x: 160, y: 47 },
    { x: 289, y: 206 },
    { x: 160, y: 331 },
    { x: 31, y: 206 },
  ]
  const pts = []
  for (let e = 0; e < 4; e++) {
    const a = inset[e]
    const b = inset[(e + 1) % 4]
    for (let i = 0; i < perEdge; i++) {
      const u = i / perEdge
      pts.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u })
    }
  }
  return pts
}
const BULBS = bulbPoints()

function starPath(cx, cy, outer, inner, points = 8) {
  let d = ''
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer
    const a = (Math.PI * i) / points - Math.PI / 2
    d += `${i ? 'L' : 'M'}${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`
  }
  return `${d}Z`
}

const WELCOME = 'WELCOME'.split('')

export function VegasSign() {
  const outline = `M${TOP.x} ${TOP.y} L${RIGHT.x} ${RIGHT.y} L${BOTTOM.x} ${BOTTOM.y} L${LEFT.x} ${LEFT.y} Z`
  return (
    <svg className="vegas-sign" viewBox={`0 0 ${W} 372`} role="img" aria-label="Welcome to Fabulous Las Vegas Nevada">
      <defs>
        <radialGradient id="vg-face" cx="50%" cy="45%" r="65%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#ece9de" />
        </radialGradient>
        <radialGradient id="vg-dollar" cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="75%" stopColor="#f1f1ec" />
          <stop offset="100%" stopColor="#b9bab4" />
        </radialGradient>
        <filter id="vg-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* bord */}
      <path d={outline} fill="url(#vg-face)" stroke="#9a9a92" strokeWidth="9" strokeLinejoin="round" />
      <path d={outline} fill="none" stroke={RED} strokeWidth="3.5" strokeLinejoin="round" />

      {/* lampjes rondom */}
      <g filter="url(#vg-glow)">
        {BULBS.map((b, i) => (
          <circle key={i} className="vg-bulb" cx={b.x} cy={b.y} r="4.2" style={{ '--i': i }} />
        ))}
      </g>

      {/* ster bovenaan */}
      <g className="vg-star">
        <path d={starPath(160, 62, 38, 15)} fill="#ffd23a" filter="url(#vg-glow)" />
        <path d={starPath(160, 62, 33, 12.5)} fill={RED} />
      </g>

      {/* WELCOME op zeven zilveren dollars, licht in een boog */}
      {WELCOME.map((ch, i) => {
        const x = 76 + i * 28
        const y = 160 - 7 * Math.sin((Math.PI * i) / 6)
        return (
          <g key={i}>
            <circle cx={x} cy={y} r="13.2" fill="url(#vg-dollar)" stroke="#8d8e88" strokeWidth="1.4" />
            <text x={x} y={y + 6.2} textAnchor="middle" className="vg-welcome" fill={RED}>
              {ch}
            </text>
          </g>
        )
      })}

      <text x="96" y="204" className="vg-to" fill={BLUE}>
        to
      </text>
      <text x="174" y="210" textAnchor="middle" className="vg-fabulous" fill={BLUE}>
        Fabulous
      </text>
      <text x="160" y="254" textAnchor="middle" className="vg-lasvegas" fill={RED} textLength="196" lengthAdjust="spacingAndGlyphs">
        LAS VEGAS
      </text>
      <text x="160" y="288" textAnchor="middle" className="vg-nevada" fill={BLUE} textLength="96" lengthAdjust="spacing">
        NEVADA
      </text>
    </svg>
  )
}
