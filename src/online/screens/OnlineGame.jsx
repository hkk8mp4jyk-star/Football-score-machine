import { useEffect, useReducer, useRef, useState } from 'react'
import MainScreen from '../../components/MainScreen.jsx'
import AuctionScreen from '../../components/AuctionScreen.jsx'
import Overview from '../../components/Overview.jsx'
import MegaWin from '../../components/MegaWin.jsx'
import AuctionSetup from '../../components/AuctionSetup.jsx'
import { MenuButton } from '../../components/Header.jsx'
import { RESULT_BY_ID, TIMING } from '../../game/config.js'
import { configOf, playerName, turnOrder } from '../../game/gameConfig.js'
import { deriveView } from '../../game/view.js'
import { STOP_DELAY, spinIsMega } from '../../game/timeline.js'
import { clock } from '../../game/clock.js'
import { buzz, setSoundEnabled, sfx, unlockAudio } from '../../audio/sound.js'
import { announceVisible, introPhase } from '../../lobby/playRules.js'
import { errorText } from '../api.js'
import { StartIntro } from '../intro/StartIntro.jsx'
import { AuctionAnnounce } from '../intro/AuctionAnnounce.jsx'
import { ConfirmSheet } from './common.jsx'
import { FinalScreen } from './FinalScreen.jsx'

// Online spel: eerst de gezamenlijke startanimatie, daarna de bestaande
// scoremachine. SPIN alleen voor wie aan de beurt is (op eigen telefoon), of
// voor de organisator bij een deelnemer zonder telefoon; daarnaast kan de
// organisator expliciet "Draai namens …".
export function OnlineGame({ room, actions, onHome, notify, onFinished, now: fixedNow }) {
  const [, refresh] = useReducer((n) => n + 1, 0)
  const [sheet, setSheet] = useState(null) // 'overview' | 'menu' | 'setup' | { onBehalf }
  const [pending, setPending] = useState(false)
  const [showOther, setShowOther] = useState(false)
  const [megaWin, setMegaWin] = useState(null)
  const [sound, setSound] = useState(true)
  const timers = useRef([])

  const now = fixedNow ?? clock.now()
  const config = configOf(room.state)
  const intro = introPhase(room.startedAt, config.players.length, now)
  const announcing = announceVisible(room.announce, now)
  // Faseovergangen (veiling, eindstand) legt de organisator centraal vast.
  const ack = room.ack ?? {}
  const view = deriveView(room.state, now, ack)
  const { reveal, locked, tileStage, reelSpin } = view
  const game = view.state

  // Animaties (startanimatie, aankondiging) per beeldje bijwerken.
  const animating = !!intro || announcing
  useEffect(() => {
    if (!animating || fixedNow != null) return
    let id = requestAnimationFrame(function loop() {
      refresh()
      id = requestAnimationFrame(loop)
    })
    return () => cancelAnimationFrame(id)
  }, [animating, fixedNow])

  // Daarna alleen op het volgende overgangsmoment (zoals in de DEMO).
  useEffect(() => {
    if (view.nextChangeAt == null || fixedNow != null) return
    const id = setTimeout(refresh, Math.max(0, view.nextChangeAt - clock.now()) + 15)
    return () => clearTimeout(id)
  }, [view.nextChangeAt, room.version, fixedNow])

  useEffect(() => setSoundEnabled(sound), [sound])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  useEffect(() => {
    if (tileStage?.stage === 'green') sfx.highlight()
    if (tileStage?.stage === 'fade') sfx.remove()
  }, [tileStage?.stage, tileStage?.resultId])

  // Afgerond: de eindstand in de geschiedenis van dit toestel bewaren.
  const done = game.phase === 'finished' && !reveal
  useEffect(() => {
    if (done && fixedNow == null) onFinished?.(room)
  }, [done, room, onFinished, fixedNow])

  if (intro) return <StartIntro room={room} now={now} />

  const later = (ms, fn) => timers.current.push(setTimeout(fn, ms))
  const canSpinFor = (participant) => !pending && room.controlSlots.includes(participant)

  // Effecten op het moment dat de rollen stoppen; te laat = overslaan.
  const announce = (spin) => {
    if (clock.now() - (spin.startedAt + STOP_DELAY) > 1500) return
    if (spinIsMega(spin)) {
      sfx.megaWin()
      buzz([60, 40, 60, 40, 200])
      setMegaWin(spin.id)
      later(TIMING.megaWin, () => setMegaWin(null))
    } else if (RESULT_BY_ID[spin.resultId].other) {
      sfx.fanfare()
      setShowOther(true)
      later(2600, () => setShowOther(false))
    } else {
      sfx.win()
    }
  }

  const doSpin = async (onBehalf = false) => {
    unlockAudio()
    setPending(true)
    try {
      await actions.spin({ onBehalf })
    } catch (e) {
      notify(errorText(e), true)
    } finally {
      setPending(false)
    }
  }

  // Alleen de organisator: "Start de veiling" / "Bekijk de eindstand" voor iedereen.
  const advance = async (step) => {
    try {
      await actions.advancePhase(step)
    } catch (e) {
      notify(errorText(e), true)
    }
  }

  // Wie is er nu aan de beurt, en mag de organisator "namens" draaien?
  const turnParticipant = game.phase === 'draw' ? turnOrder(config)[game.turn]?.participant : game.auctionTurn?.participant
  const released = !game.spin && !locked && !tileStage
  const onBehalfFor =
    room.isOrganizer && released && !pending && turnParticipant != null && !room.controlSlots.includes(turnParticipant) && game.phase !== 'finished'
      ? turnParticipant
      : null
  const altAction =
    onBehalfFor != null ? (
      <button type="button" className="ghost-btn ol-onbehalf" onClick={() => setSheet({ onBehalf: onBehalfFor })}>
        Draai namens {playerName(config, onBehalfFor)}
      </button>
    ) : undefined

  const onMain = game.phase === 'draw' || (reveal && reveal.round !== 'veiling')
  const finished = game.phase === 'finished' && !reveal

  let screen
  if (onMain) {
    screen = (
      <MainScreen
        state={game}
        reelSpin={reelSpin}
        reveal={reveal}
        locked={locked}
        canSpinFor={canSpinFor}
        showOther={showOther}
        onSpin={() => doSpin(false)}
        onSettled={announce}
        onNext={() => advance('auction')}
        canAdvance={room.isOrganizer}
        onOverview={() => setSheet('overview')}
        onMenu={() => setSheet('menu')}
        teams={room.match}
        altAction={game.phase === 'draw' ? altAction : undefined}
      />
    )
  } else if (finished) {
    screen = <FinalScreen room={room} state={game} onBack={onHome} notify={notify} menu={<MenuButton onClick={() => setSheet('menu')} />} />
  } else {
    screen = (
      <AuctionScreen
        state={game}
        reelSpin={reelSpin}
        reveal={reveal}
        tileStage={tileStage}
        showOther={showOther}
        isOrganizer={room.isOrganizer && !game.auctionTurn}
        canSpinFor={canSpinFor}
        onSpin={() => doSpin(false)}
        onSettled={announce}
        onPrepare={() => setSheet('setup')}
        onFinish={() => advance('final')}
        canAdvance={room.isOrganizer}
        onOverview={() => setSheet('overview')}
        onMenu={() => setSheet('menu')}
        teams={room.match}
        altAction={altAction}
      />
    )
  }

  return (
    <div className={`app ${megaWin ? 'is-mega' : ''}`}>
      {screen}
      <MegaWin key={megaWin ?? 'none'} show={!!megaWin} />
      {announcing && <AuctionAnnounce key={room.announce.at} config={config} announce={room.announce} />}
      {sheet === 'overview' && <Overview state={game} onClose={() => setSheet(null)} />}
      {sheet === 'setup' && (
        <AuctionSetup
          players={config.players}
          confirmLabel="Bevestig veiling"
          onConfirm={async (participant, bid) => {
            setSheet(null)
            try {
              await actions.confirmAuction(participant, Math.round(bid * 100))
            } catch (e) {
              notify(errorText(e), true)
            }
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.onBehalf != null && (
        <ConfirmSheet
          title={`Draai namens ${playerName(config, sheet.onBehalf)}?`}
          confirmLabel="Spin"
          onConfirm={() => {
            setSheet(null)
            doSpin(true)
          }}
          onCancel={() => setSheet(null)}
        >
          <p className="ol-intro ol-left">Alleen als {playerName(config, sheet.onBehalf)} niet reageert.</p>
        </ConfirmSheet>
      )}
      {sheet === 'menu' && (
        <div className="sheet-backdrop" onClick={() => setSheet(null)}>
          <div className="sheet ol-confirm" role="dialog" aria-label="Menu" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <h2>{room.matchName}</h2>
              <button type="button" className="icon-btn" onClick={() => setSheet(null)} aria-label="Sluiten">
                ✕
              </button>
            </div>
            <button type="button" className="ol-big-btn" onClick={() => setSound((s) => !s)}>
              Geluid {sound ? 'uit' : 'aan'}
            </button>
            <button type="button" className="ol-big-btn" onClick={onHome}>
              Naar beginscherm
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
