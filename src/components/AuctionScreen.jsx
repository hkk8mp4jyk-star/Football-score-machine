import SlotMachine from './SlotMachine.jsx'
import OtherBanner from './OtherBanner.jsx'
import { NavMenuButton, NavRow, OrganizerButton, PlayerSpot } from './Header.jsx'
import { RESULT_BY_ID } from '../game/config.js'
import { auctionRows, configOf, playerName, reelSymbolsFor } from '../game/gameConfig.js'

const euroFormat = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 })
// '€20,00' zonder spatie, zoals op het scherm gewenst.
const euro = (value) => euroFormat.format(value).replace(/\s/g, '')

function Tile({ id, state }) {
  const r = RESULT_BY_ID[id]
  return (
    <div className={`tile tile-${state}`} aria-hidden={state === 'gone'}>
      <div className="tile-face">
        {r.other ? (
          <span className="tile-other">
            Overige
            <br />
            uitslagen
          </span>
        ) : (
          <span className="tile-score">
            {r.home}
            <i>-</i>
            {r.away}
          </span>
        )}
      </div>
    </div>
  )
}

export default function AuctionScreen({
  state,
  reelSpin,
  reveal,
  tileStage,
  showOther,
  isOrganizer,
  canSpinFor,
  onSpin,
  onSettled,
  onPrepare,
  onFinish,
  onOverview,
  onMenu,
}) {
  const config = configOf(state)
  const spinning = !!state.spin
  const board = state.auctionBoard ?? []
  const lots = board.length
  const lastId = state.draws.at(-1)?.resultId
  const busy = spinning || !!tileStage
  // Lopende draai of door de organisator vrijgegeven beurt.
  const current = state.spin ?? state.auctionTurn
  const lot = Math.min(lots - state.remaining.length + 1, lots)

  // Een vak verandert pas ná de onthulling: tijdens het draaien blijft
  // het bord ongewijzigd, zodat de uitslag niet vooraf uitlekt.
  const tileState = (id) => {
    if (tileStage?.resultId === id) return tileStage.stage
    return state.remaining.includes(id) ? 'live' : 'gone'
  }

  // Vaste posities: 1–4 kavels op één rij boven de machine; 5–10 boven en
  // onder (5 = 3+2 … 8 = 4+4 … 10 = 5+5). Alle tegels even breed, nooit breder
  // dan bij 4 per rij. De standaardindeling (4+4) gebruikt de oorspronkelijke opmaak.
  const rows = auctionRows(lots)
  const top = board.slice(0, rows.top)
  const bottom = board.slice(rows.top)
  const rowProps = (count) =>
    count === 4 && rows.cols === 4
      ? { className: '', style: { '--lots': count } }
      : { className: ' lot-row-fixed', style: { '--lots': count, '--cols': rows.cols } }
  const topRow = rowProps(top.length)
  const bottomRow = rowProps(bottom.length)

  // SPIN alleen voor de vrijgegeven deelnemer, en pas als er niets meer loopt.
  const spinVisible = !busy && state.auctionTurn && canSpinFor(state.auctionTurn.participant)
  const finished = state.phase === 'finished' && reveal && !tileStage

  let action = null
  if (finished) {
    action = (
      <button type="button" className="gold-btn gold-btn-next" onClick={onFinish}>
        Bekijk de eindstand
      </button>
    )
  } else {
    action = (
      <button
        type="button"
        className={`gold-btn spin-btn spin-btn-compact ${spinVisible ? '' : 'is-hidden'}`}
        onClick={onSpin}
        disabled={!spinVisible}
      >
        <span>Spin</span>
      </button>
    )
  }

  return (
    <div className="screen screen-auction">
      <header className="top">
        <NavRow onOverview={onOverview} disabled={busy} extra={<NavMenuButton onClick={onMenu} />}>
          <span className="auction-badge">Veiling</span>
          {/* Organisatorbediening: alleen voor de organisator, bovenaan. */}
          {isOrganizer && !finished && <OrganizerButton onClick={onPrepare} disabled={busy} attention={!current && !busy} />}
        </NavRow>
        {current ? (
          <PlayerSpot name={playerName(config, current.participant)} sub={`Draait voor ${euro(current.bid ?? 0)}`} />
        ) : (
          <PlayerSpot name={`Kavel ${lot}`} sub={`van ${lots}`} />
        )}
      </header>

      <main className="stage stage-auction">
        <div className="stage-glow" aria-hidden="true" />
        <div className={`lot-row lot-row-top${topRow.className}`} style={topRow.style}>
          {top.map((id) => (
            <Tile key={id} id={id} state={tileState(id)} />
          ))}
        </div>
        {/* Zelfde machine als in ronde 1 en 2: zelfde breedte en verhoudingen. */}
        <div className="machine-holder">
          <SlotMachine spin={reelSpin} restResultId={lastId} onSettled={onSettled} symbols={reelSymbolsFor(config)} />
          <OtherBanner show={showOther} />
        </div>
        {bottom.length > 0 && (
          <div className={`lot-row lot-row-bottom${bottomRow.className}`} style={bottomRow.style}>
            {bottom.map((id) => (
              <Tile key={id} id={id} state={tileState(id)} />
            ))}
          </div>
        )}

        <div className="stage-action">{action}</div>
      </main>
    </div>
  )
}
