import SlotMachine from './SlotMachine.jsx'
import OtherBanner from './OtherBanner.jsx'
import { Logo, MenuButton, PlayerSpot, RoundBadges } from './Header.jsx'
import { DRAW_TURNS, PARTICIPANTS, RESULT_BY_ID, TURN_ORDER } from '../game/config.js'

export default function MainScreen({ state, reveal, showOther, onSpin, onSettled, onNext, onOverview, onMenu }) {
  const spinning = !!state.spin
  // Tijdens de onthulling blijft de deelnemer van deze trekking in beeld.
  const shownTurn = reveal ? { round: reveal.round, participant: reveal.participant } : TURN_ORDER[state.turn]
  const drawNumber = reveal ? state.draws.length : state.turn + 1
  const lastId = state.draws.at(-1)?.resultId
  const result = reveal ? RESULT_BY_ID[reveal.resultId] : null
  const nextTurn = TURN_ORDER[state.turn]

  return (
    <div className="screen screen-main">
      <header className="top">
        <div className="top-row top-row-center">
          <span aria-hidden="true" />
          <Logo />
          <MenuButton onClick={onMenu} />
        </div>
        <RoundBadges round={shownTurn.round} />
        <PlayerSpot label={reveal ? 'Uitslag voor' : 'Aan de beurt'} participant={shownTurn.participant} />
      </header>

      <main className="stage">
        <div className="stage-glow" aria-hidden="true" />
        <div className="machine-holder">
          <SlotMachine spin={state.spin} restResultId={lastId} onSettled={onSettled} />
          <OtherBanner show={showOther} />
        </div>

        <div className="result-plate" aria-live="polite">
          {result ? (
            <div key={reveal.resultId} className="result-plate-inner is-in">
              <span className="result-plate-label">{PARTICIPANTS[reveal.participant]} krijgt</span>
              <span className={`result-plate-value ${result.other ? 'is-other' : ''}`}>
                {result.other ? 'Overige uitslagen' : `${result.home} – ${result.away}`}
              </span>
            </div>
          ) : (
            <span className="result-plate-hint">{spinning ? 'De machine draait…' : 'Druk op SPIN'}</span>
          )}
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
          <button type="button" className="gold-btn spin-btn" onClick={onSpin} disabled={spinning}>
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
