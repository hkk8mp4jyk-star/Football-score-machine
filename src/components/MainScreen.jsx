import SlotMachine from './SlotMachine.jsx'
import OtherBanner from './OtherBanner.jsx'
import { Footer, NavRow, PlayerSpot, RoundBadges } from './Header.jsx'
import { auctionLots, configOf, drawTurns, playerName, reelSymbolsFor, turnOrder } from '../game/gameConfig.js'

// Online (optioneel): `teams` (clubnamen op de rollen) en `altAction` (knop
// in plaats van de verborgen SPIN-knop, bijv. "Draai namens …") en
// `canAdvance` (false: geen knop "Start de veiling"/"Bekijk de eindstand";
// die overgang is aan de organisator).
export default function MainScreen({ state, reelSpin, reveal, locked, canSpinFor, showOther, onSpin, onSettled, onNext, onOverview, onMenu, teams, altAction, canAdvance = true }) {
  const config = configOf(state)
  const order = turnOrder(config)
  const totalTurns = drawTurns(config)
  const spinning = !!state.spin
  // Tijdens de onthulling is de trekking al vastgelegd (turn is opgehoogd),
  // maar blijft de deelnemer van deze trekking in beeld.
  const turnIndex = reveal ? state.turn - 1 : state.turn
  const shownTurn = order[turnIndex]
  const upcoming = order[turnIndex + 1]
  const drawNumber = reveal ? state.draws.length : state.turn + 1
  const lastId = state.draws.at(-1)?.resultId

  // Alleen wie zelf aan de beurt is krijgt de SPIN-knop (zie canSpinFor).
  const spinHidden = spinning || locked || !canSpinFor(shownTurn.participant)

  // Na de laatste vaste trekking: de veiling, of (zonder veiling) de eindstand.
  let nextLabel = auctionLots(config) > 0 ? 'Veiling' : 'Eindstand'
  if (upcoming) {
    nextLabel = playerName(config, upcoming.participant)
    if (upcoming.round !== shownTurn.round) nextLabel += ` · Ronde ${upcoming.round}`
  }

  return (
    <div className="screen screen-main">
      <header className="top">
        <NavRow onOverview={onOverview} disabled={spinning}>
          <RoundBadges round={shownTurn.round} rounds={config.rounds} />
        </NavRow>
        <PlayerSpot name={playerName(config, shownTurn.participant)} sub={`Hierna: ${nextLabel}`} />
      </header>

      <main className="stage">
        <div className="stage-glow" aria-hidden="true" />
        <div className="machine-holder">
          <SlotMachine spin={reelSpin} restResultId={lastId} onSettled={onSettled} symbols={reelSymbolsFor(config)} teams={teams} />
          <OtherBanner show={showOther} />
        </div>

        {/* De knop verschijnt pas weer als de volgende beurt is vrijgegeven.
            Na de laatste trekking volgt de overstap naar de veiling, of
            zonder veiling naar de eindstand. */}
        <div className="stage-action">
          {reveal && state.phase !== 'draw' ? (
            <button
              type="button"
              className={`gold-btn gold-btn-next ${locked || !canAdvance ? 'is-hidden' : ''}`}
              onClick={onNext}
              disabled={locked || !canAdvance}
            >
              {state.phase === 'finished' ? 'Bekijk de eindstand' : 'Start de veiling'}
            </button>
          ) : altAction && spinHidden ? (
            altAction
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
        sub={`Trekking ${Math.min(drawNumber, totalTurns)} van ${totalTurns}`}
        onMenu={onMenu}
      />
    </div>
  )
}
