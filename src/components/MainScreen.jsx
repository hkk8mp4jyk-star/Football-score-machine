import SlotMachine from './SlotMachine.jsx'
import OtherBanner from './OtherBanner.jsx'
import { Footer, NavRow, PlayerSpot, RoundBadges } from './Header.jsx'
import { DRAW_TURNS, PARTICIPANTS, TURN_ORDER } from '../game/config.js'

export default function MainScreen({ state, reveal, locked, canSpinFor, showOther, onSpin, onSettled, onNext, onOverview, onMenu }) {
  const spinning = !!state.spin
  // Tijdens de onthulling is de trekking al vastgelegd (turn is opgehoogd),
  // maar blijft de deelnemer van deze trekking in beeld.
  const turnIndex = reveal ? state.turn - 1 : state.turn
  const shownTurn = TURN_ORDER[turnIndex]
  const upcoming = TURN_ORDER[turnIndex + 1]
  const drawNumber = reveal ? state.draws.length : state.turn + 1
  const lastId = state.draws.at(-1)?.resultId

  // Alleen wie aan de beurt is (of de organisator) krijgt de SPIN-knop.
  const spinHidden = spinning || locked || !canSpinFor(shownTurn.participant)

  let nextLabel = 'Veiling'
  if (upcoming) {
    nextLabel = PARTICIPANTS[upcoming.participant]
    if (upcoming.round !== shownTurn.round) nextLabel += ` · Ronde ${upcoming.round}`
  }

  return (
    <div className="screen screen-main">
      <header className="top">
        <NavRow onOverview={onOverview} disabled={spinning}>
          <RoundBadges round={shownTurn.round} />
        </NavRow>
        <PlayerSpot name={PARTICIPANTS[shownTurn.participant]} sub={`Hierna: ${nextLabel}`} />
      </header>

      <main className="stage">
        <div className="stage-glow" aria-hidden="true" />
        <div className="machine-holder">
          <SlotMachine spin={state.spin} restResultId={lastId} onSettled={onSettled} />
          <OtherBanner show={showOther} />
        </div>

        {/* De knop verschijnt pas weer als de volgende beurt is vrijgegeven.
            Na de laatste trekking volgt de overstap naar de veiling. */}
        <div className="stage-action">
          {reveal && state.phase !== 'draw' ? (
            <button
              type="button"
              className={`gold-btn gold-btn-next ${locked ? 'is-hidden' : ''}`}
              onClick={onNext}
              disabled={locked}
            >
              Start de veiling
            </button>
          ) : (
            <button
              type="button"
              className={`gold-btn spin-btn ${spinHidden ? 'is-hidden' : ''}`}
              onClick={onSpin}
              disabled={spinHidden}
            >
              <span>Spin</span>
            </button>
          )}
        </div>
      </main>

      <Footer
        count={state.remaining.length}
        label="uitslagen in de machine"
        sub={`Trekking ${Math.min(drawNumber, DRAW_TURNS)} van ${DRAW_TURNS}`}
        onMenu={onMenu}
      />
    </div>
  )
}
