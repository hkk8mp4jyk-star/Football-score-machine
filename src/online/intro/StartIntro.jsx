import { auctionLots } from '../../game/gameConfig.js'
import { formatCents } from '../../game/money.js'
import { introPhase } from '../../lobby/playRules.js'
import { MiniReels, bonusPositions } from './MiniReels.jsx'
import { reelPosition, visibleItems } from './slotMath.js'
import { VegasSign } from './VegasSign.jsx'

// Gezamenlijke startanimatie na "Start het spel". Alles volgt uit
// `t = now − startedAt` (servertijd), dus elke telefoon toont hetzelfde
// moment; wie later binnenkomt valt in op het juiste punt.

const CONFETTI_COLORS = ['#ffd23a', '#e5262e', '#2fd27c', '#3aa0ff', '#ff5fd2', '#fff3c9']

function Confetti({ count = 34 }) {
  return (
    <div className="bonus-confetti" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <i
          key={i}
          style={{
            left: `${(i * 37) % 100}%`,
            background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
            animationDelay: `${(i % 9) * 70}ms`,
            animationDuration: `${1600 + ((i * 53) % 900)}ms`,
            '--drift': `${((i * 29) % 60) - 30}px`,
            '--spin': `${((i * 71) % 720) - 360}deg`,
          }}
        />
      ))}
    </div>
  )
}

// Casinoverlichting rondom het scherm (lopende lampjes, gekleurd na de flits).
function ChaseLights({ party }) {
  const per = 14
  return (
    <div className={`chase-lights ${party ? 'is-party' : ''}`.trim()} aria-hidden="true">
      {['top', 'right', 'bottom', 'left'].map((side) => (
        <div key={side} className={`chase chase-${side}`}>
          {Array.from({ length: per }, (_, i) => (
            <span key={i} style={{ '--i': i }} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function BonusTrigger({ t, tl, matchName }) {
  const bonus = t >= tl.bonusAt
  return (
    <div className={`intro intro-bonus ${bonus ? 'is-bonus' : ''}`.trim()}>
      <ChaseLights party={bonus} />
      <p className="intro-match">{matchName}</p>
      <div className="bonus-stage">
        {bonus && <div className="bonus-rays" aria-hidden="true" />}
        <MiniReels positions={bonusPositions(t, tl.coinStops)} landed={tl.coinStops.map((s) => t >= s)} size="large" lit={bonus} />
        {bonus ? (
          <h1 className="bonus-title" data-text="BONUSSPEL!">
            BONUSSPEL!
          </h1>
        ) : (
          <p className="intro-caption">WARMING UP</p>
        )}
      </div>
      {bonus && <div className="bonus-flash" aria-hidden="true" />}
      {bonus && <Confetti />}
    </div>
  )
}

// Elke rij is een venster van een grote "namen-fruitautomaat". Alle rijen
// draaien eerst razendsnel en vallen daarna één voor één op de definitieve
// naam. De volgorde staat al vast (door de organisator vóór de start); deze
// animatie onthult hem alleen.
export function NamesReveal({ t, tl, players }) {
  const n = players.length
  const names = players.map((p) => p.name)
  const done = t >= tl.orderAt
  return (
    <div className={`intro intro-names ${done ? 'is-done' : ''}`.trim()}>
      <ChaseLights party={done} />
      <h2 className="names-title">Speelvolgorde</h2>
      <ol className="names-list" style={{ '--rows': n }}>
        {players.map((p, i) => {
          // Per rij een andere startvolgorde, zodat alles door elkaar draait.
          const shift = (i * 5 + 3) % n
          const strip = names.map((_, k) => names[(k + shift) % n])
          const target = strip.indexOf(p.name)
          const stopAt = tl.nameStops[i]
          const landed = t >= stopAt
          const pos = reelPosition(t, { startAt: tl.namesAt, accel: 350, vmax: 0.02, stopAt, decel: tl.nameDecel, target, count: n, phase: i * 1.7 })
          return (
            <li key={p.id} className={`names-row ${landed ? 'is-landed' : ''}`.trim()}>
              <span className="names-num">{i + 1}</span>
              <div className="names-window">
                {landed ? (
                  <span className="names-item" style={{ transform: 'translateY(0)' }}>
                    {p.name}
                  </span>
                ) : (
                  visibleItems(pos, n).map(({ index, offset, key }) => (
                    <span key={key} className="names-item is-moving" style={{ transform: `translateY(${offset * 100}%)` }}>
                      {strip[index]}
                    </span>
                  ))
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

export function VegasWelcome({ room }) {
  const config = room.state.config
  const lots = auctionLots(config)
  return (
    <div className="intro intro-vegas">
      <div className="vegas-sky" aria-hidden="true" />
      <VegasSign />
      <div className="vegas-summary">
        <h2>{room.matchName}</h2>
        <dl>
          <div>
            <dt>Deelnemers</dt>
            <dd>{config.players.length}</dd>
          </div>
          <div>
            <dt>Vaste trekkingen per deelnemer</dt>
            <dd>{config.rounds}</dd>
          </div>
          <div>
            <dt>Prijs per vaste trekking</dt>
            <dd>{formatCents(config.priceCents)}</dd>
          </div>
          <div>
            <dt>Veilinguitslagen</dt>
            <dd>{lots}</dd>
          </div>
        </dl>
      </div>
    </div>
  )
}

export function StartIntro({ room, now }) {
  const players = room.state.config.players
  const ip = introPhase(room.startedAt, players.length, now)
  if (!ip) return null
  if (ip.phase === 'bonus') return <BonusTrigger t={ip.t} tl={ip.tl} matchName={room.matchName} />
  if (ip.phase === 'names') return <NamesReveal t={ip.t} tl={ip.tl} players={players} />
  return <VegasWelcome room={room} />
}
