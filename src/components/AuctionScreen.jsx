import SlotMachine from './SlotMachine.jsx'
import OtherBanner from './OtherBanner.jsx'
import { Footer, NavRow, PlayerSpot } from './Header.jsx'
import { AUCTION_LOTS, PARTICIPANTS, RESULT_BY_ID } from '../game/config.js'

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
  const spinning = !!state.spin
  const board = state.auctionBoard ?? []
  const lastId = state.draws.at(-1)?.resultId
  const busy = spinning || !!tileStage
  // Lopende draai of door de organisator vrijgegeven beurt.
  const current = state.spin ?? state.auctionTurn
  const lot = Math.min(AUCTION_LOTS - state.remaining.length + 1, AUCTION_LOTS)

  // Een vak verandert pas ná de onthulling: tijdens het draaien blijft
  // het bord ongewijzigd, zodat de uitslag niet vooraf uitlekt.
  const tileState = (id) => {
    if (tileStage?.resultId === id) return tileStage.stage
    return state.remaining.includes(id) ? 'live' : 'gone'
  }

  // Helft boven, helft onder de machine (bij 8 kavels: 4 en 4), op vaste posities.
  const half = Math.ceil(board.length / 2)
  const top = board.slice(0, half)
  const bottom = board.slice(half)

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
  } else if (!current && isOrganizer) {
    action = (
      <button type="button" className="org-btn" onClick={onPrepare}>
        Volgende veiling
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
        <NavRow onOverview={onOverview} disabled={busy}>
          <span className="auction-badge">Veiling</span>
        </NavRow>
        {current ? (
          <PlayerSpot name={PARTICIPANTS[current.participant]} sub={`Draait voor ${euro(current.bid ?? 0)}`} />
        ) : (
          <PlayerSpot name={`Kavel ${lot}`} sub={`van ${AUCTION_LOTS}`} />
        )}
      </header>

      <main className="stage stage-auction">
        <div className="stage-glow" aria-hidden="true" />
        <div className="lot-row lot-row-top" style={{ '--lots': half }}>
          {top.map((id) => (
            <Tile key={id} id={id} state={tileState(id)} />
          ))}
        </div>
        {/* Zelfde machine als in ronde 1 en 2: zelfde breedte en verhoudingen. */}
        <div className="machine-holder">
          <SlotMachine spin={state.spin} restResultId={lastId} onSettled={onSettled} />
          <OtherBanner show={showOther} />
        </div>
        <div className="lot-row lot-row-bottom" style={{ '--lots': half }}>
          {bottom.map((id) => (
            <Tile key={id} id={id} state={tileState(id)} />
          ))}
        </div>

        <div className="stage-action">{action}</div>
      </main>

      <Footer
        count={state.remaining.length}
        label="uitslagen in de veiling"
        sub={`Kavel ${lot} van ${AUCTION_LOTS}`}
        onMenu={onMenu}
      />
    </div>
  )
}
