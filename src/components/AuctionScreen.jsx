import SlotMachine from './SlotMachine.jsx'
import OtherBanner from './OtherBanner.jsx'
import { Logo, MenuButton } from './Header.jsx'
import { PARTICIPANTS, RESULT_BY_ID } from '../game/config.js'

const euro = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 })

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
  spinVariant,
  bidder,
  bid,
  onBidder,
  onBid,
  onSpin,
  onSettled,
  onNext,
  onOverview,
  onMenu,
}) {
  const spinning = !!state.spin
  const board = state.auctionBoard ?? []
  const lastId = state.draws.at(-1)?.resultId
  const busy = spinning || !!tileStage
  const bidValue = parseFloat(String(bid).replace(',', '.'))
  const canSpin = !busy && bidder !== '' && bidValue > 0
  // Na een verkoop staat het formulier direct weer klaar voor de volgende kavel.
  const active = state.spin

  // Een vak verandert pas ná de onthulling: tijdens het draaien blijft
  // het bord ongewijzigd, zodat de uitslag niet vooraf uitlekt.
  const tileState = (id) => {
    if (tileStage?.resultId === id) return tileStage.stage
    return state.remaining.includes(id) ? 'live' : 'gone'
  }

  const left = board.slice(0, 5)
  const right = board.slice(5, 10)

  return (
    <div className="screen screen-auction">
      <header className="top top-compact">
        <div className="top-row">
          <Logo compact />
          <span className="auction-badge">Veiling</span>
          <MenuButton onClick={onMenu} />
        </div>
      </header>

      <main className="auction-stage">
        <div className="stage-glow" aria-hidden="true" />
        <div className="board">
          <div className="board-col">
            {left.map((id) => (
              <Tile key={id} id={id} state={tileState(id)} />
            ))}
          </div>
          <div className="board-center">
            <div className="machine-holder">
              <SlotMachine compact spin={state.spin} restResultId={lastId} onSettled={onSettled} />
              <OtherBanner show={showOther} />
            </div>
          </div>
          <div className="board-col">
            {right.map((id) => (
              <Tile key={id} id={id} state={tileState(id)} />
            ))}
          </div>
        </div>

        <section className="auction-info" aria-label="Veilinginformatie">
          {active ? (
            <div className="auction-locked">
              <div className="info-cell">
                <span className="info-label">Deelnemer</span>
                <span className="info-value">{PARTICIPANTS[active.participant]}</span>
              </div>
              <div className="info-cell">
                <span className="info-label">Winnend bod</span>
                <span className="info-value info-money">{euro.format(active.bid ?? 0)}</span>
              </div>
              <div className="info-cell">
                <span className="info-label">Resterend</span>
                <span className="info-value">{state.remaining.length}</span>
              </div>
            </div>
          ) : (
            <div className="auction-form">
              <label className="field">
                <span className="info-label">Deelnemer</span>
                <select id="bidder" value={bidder} onChange={(e) => onBidder(e.target.value)}>
                  <option value="">Kies…</option>
                  {PARTICIPANTS.map((name, i) => (
                    <option key={name} value={i}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="info-label">Winnend bod</span>
                <span className="money-input">
                  <span>€</span>
                  <input
                    id="bid"
                    inputMode="decimal"
                    placeholder="0"
                    value={bid}
                    onChange={(e) => onBid(e.target.value.replace(/[^0-9.,]/g, ''))}
                  />
                </span>
              </label>
              <div className="field field-count">
                <span className="info-label">Resterend</span>
                <span className="info-value">{state.remaining.length}</span>
              </div>
            </div>
          )}
        </section>

        {state.phase === 'finished' && reveal && !tileStage ? (
          <button type="button" className="gold-btn gold-btn-next" onClick={onNext}>
            Bekijk de eindstand
          </button>
        ) : (
          <button
            type="button"
            className={`gold-btn spin-btn spin-btn-compact ${spinVariant === 'B' && busy ? 'is-hidden' : ''}`}
            onClick={() => onSpin(Number(bidder), bidValue)}
            disabled={!canSpin}
          >
            <span>Spin</span>
          </button>
        )}
      </main>

      <footer className="bottom bottom-compact">
        <span className="hint">
          {busy
            ? 'De machine bepaalt de uitslag…'
            : canSpin
              ? 'Klaar om te draaien'
              : reveal
                ? `${PARTICIPANTS[reveal.participant]} koopt ${RESULT_BY_ID[reveal.resultId].other ? 'Overige uitslagen' : reveal.resultId}`
                : 'Kies deelnemer en vul het bod in'}
        </span>
        <button type="button" className="ghost-btn" onClick={onOverview} disabled={busy}>
          Uitslagen bekijken
        </button>
      </footer>
    </div>
  )
}
