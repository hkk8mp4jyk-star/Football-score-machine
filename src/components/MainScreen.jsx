import SlotMachine from './SlotMachine.jsx'
import OtherBanner from './OtherBanner.jsx'
import { MenuButton, PlayerSpot, RoundBadges } from './Header.jsx'
import { DRAW_TURNS, PARTICIPANTS, TURN_ORDER } from '../game/config.js'

export default function MainScreen({ state, reveal, showOther, spinVariant, onSpin, onSettled, onNext, onOverview, onMenu }) {
  const spinning = !!state.spin
  // Tijdens de onthulling is de trekking al vastgelegd (turn is opgehoogd),
  // maar blijft de deelnemer van deze trekking in beeld.
  const turnIndex = reveal ? state.turn - 1 : state.turn
  const shownTurn = TURN_ORDER[turnIndex]
  const upcoming = TURN_ORDER[turnIndex + 1]
  const drawNumber = reveal ? state.draws.length : state.turn + 1
  const lastId = state.draws.at(-1)?.resultId
  const nextTurn = TURN_ORDER[state.turn]

  let nextLabel = 'Veiling'
  if (upcoming) {
    nextLabel = PARTICIPANTS[upcoming.participant]
    if (upcoming.round !== shownTurn.round) nextLabel += ` · Ronde ${upcoming.round}`
  }

  return (
    <div className="screen screen-main">
      <header className="top">
        <div className="top-row top-row-center">
          <span aria-hidden="true" />
          <RoundBadges round={shownTurn.round} />
          <MenuButton onClick={onMenu} />
        </div>
        <PlayerSpot participant={shownTurn.participant} next={nextLabel} />
      </header>

      <main className="stage">
        <div className="stage-glow" aria-hidden="true" />
        <div className="machine-holder">
          <SlotMachine spin={state.spin} restResultId={lastId} onSettled={onSettled} />
          <OtherBanner show={showOther} />
        </div>

        {reveal ? (
          <button type="button" className="gold-btn gold-btn-next" onClick={onNext}>
            {state.phase === 'draw' ? (
              <>
                Volgende: <strong>{PARTICIPANTS[nextTurn.participant]}</strong>
              </>
            ) : (
              'Start de veiling'
            )}
          </button>
        ) : (
          <button
            type="button"
            className={`gold-btn spin-btn ${spinVariant === 'B' && spinning ? 'is-hidden' : ''}`}
            onClick={onSpin}
            disabled={spinning}
          >
            <span>Spin</span>
          </button>
        )}
      </main>

      <footer className="bottom">
        <div className="counter">
          <span className="counter-num">{state.remaining.length}</span>
          <span className="counter-text">
            uitslagen in de machine
            <small>
              Trekking {Math.min(drawNumber, DRAW_TURNS)} van {DRAW_TURNS}
            </small>
          </span>
        </div>
        <button type="button" className="ghost-btn" onClick={onOverview} disabled={spinning}>
          Uitslagen bekijken
        </button>
      </footer>
    </div>
  )
}
