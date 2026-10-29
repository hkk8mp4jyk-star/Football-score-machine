import { useEffect, useReducer, useRef, useState } from 'react'
import MainScreen from './components/MainScreen.jsx'
import AuctionScreen from './components/AuctionScreen.jsx'
import Overview from './components/Overview.jsx'
import DemoMenu from './components/DemoMenu.jsx'
import MegaWin from './components/MegaWin.jsx'
import AuctionSetup from './components/AuctionSetup.jsx'
import { Logo, MenuButton } from './components/Header.jsx'
import { useGame } from './game/useGame.js'
import { RESULTS, RESULT_BY_ID, TIMING } from './game/config.js'
import { deriveView } from './game/view.js'
import { STOP_DELAY, isMegaWin } from './game/timeline.js'
import { clock } from './game/clock.js'
import { buzz, setSoundEnabled, sfx, unlockAudio } from './audio/sound.js'

const ACK_KEY = 'fsm-demo-ack'
function loadAck() {
  try {
    return JSON.parse(localStorage.getItem(ACK_KEY)) ?? {}
  } catch {
    return {}
  }
}

export default function App() {
  const [state, dispatch] = useGame()
  // Lokale bevestigingen van dit toestel ('Start de veiling', 'Bekijk de eindstand').
  const [ack, setAck] = useState(loadAck)
  const [, refresh] = useReducer((n) => n + 1, 0)
  const [showOther, setShowOther] = useState(false)
  const [megaWin, setMegaWin] = useState(null) // id van de draai met MEGA WIN
  const [sheet, setSheet] = useState(null) // 'overview' | 'menu' | 'setup'
  const [sound, setSound] = useState(true)
  // Demo-weergave. Iedereen is een van de negen deelnemers (participant);
  // de organisator heeft daarnaast de veilingbediening. 'testAll' laat de
  // organisator in de demo elke beurt draaien, zodat één toestel genoeg is.
  const [role, setRole] = useState(() => {
    const fallback = { kind: 'organizer', participant: 0, testAll: true }
    try {
      const saved = JSON.parse(localStorage.getItem('fsm-demo-role'))
      if (saved?.kind === 'organizer' || saved?.kind === 'participant') {
        return { ...fallback, ...saved, participant: saved.participant >= 0 ? saved.participant : 0 }
      }
    } catch {
      /* geen opgeslagen weergave */
    }
    return fallback
  })
  const timers = useRef([])

  // Alles wat het scherm toont volgt uit de status en de tijd: onthulling,
  // beurtvrijgave en de fases van het veilingvak (zie game/view.js).
  const view = deriveView(state, clock.now(), ack)
  const { reveal, locked, tileStage, reelSpin } = view
  const game = view.state

  // Ververs het scherm precies op het volgende overgangsmoment.
  useEffect(() => {
    if (view.nextChangeAt == null) return
    const id = setTimeout(refresh, Math.max(0, view.nextChangeAt - clock.now()) + 15)
    return () => clearTimeout(id)
  }, [view.nextChangeAt, state])

  const later = (ms, fn) => timers.current.push(setTimeout(fn, ms))
  const clearTimers = () => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }
  useEffect(() => clearTimers, [])
  useEffect(() => setSoundEnabled(sound), [sound])
  useEffect(() => {
    try {
      localStorage.setItem('fsm-demo-role', JSON.stringify(role))
    } catch {
      /* geen opslag */
    }
  }, [role])
  useEffect(() => {
    try {
      localStorage.setItem(ACK_KEY, JSON.stringify(ack))
    } catch {
      /* geen opslag */
    }
  }, [ack])

  // Geluid bij de fases van het veilingvak.
  useEffect(() => {
    if (tileStage?.stage === 'green') sfx.highlight()
    if (tileStage?.stage === 'fade') sfx.remove()
  }, [tileStage?.stage, tileStage?.resultId])

  const isOrganizer = role.kind === 'organizer'
  // SPIN voor wie zelf aan de beurt is; de organisator is ook deelnemer.
  const canSpinFor = (participant) => role.participant === participant || (isOrganizer && role.testAll)

  // Effecten op het moment dat de rollen stoppen. Wie later binnenkomt
  // (herladen, opnieuw verbinden) krijgt geen verlate effecten meer.
  const announce = (spin) => {
    if (clock.now() - (spin.startedAt + STOP_DELAY) > 1500) return
    if (isMegaWin(spin.resultId)) {
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

  const spin = () => {
    unlockAudio()
    dispatch({ type: 'SPIN_START' })
  }

  const prepareAuction = (participant, bid) => {
    dispatch({ type: 'AUCTION_PREPARE', participant, bid })
    setSheet(null)
  }

  const clearEffects = () => {
    clearTimers()
    setMegaWin(null)
    setShowOther(false)
    setSheet(null)
  }

  const reset = () => {
    clearEffects()
    setAck({})
    dispatch({ type: 'RESET' })
  }

  // Het hoofdscherm blijft staan tot de laatste trekking onthuld is.
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
        onSpin={spin}
        onSettled={announce}
        onNext={() => setAck((a) => ({ ...a, auctionStart: reveal.id }))}
        onOverview={() => setSheet('overview')}
        onMenu={() => setSheet('menu')}
      />
    )
  } else if (finished) {
    screen = (
      <div className="screen screen-finished">
        <header className="top top-compact">
          <div className="top-row">
            <Logo compact />
            <MenuButton onClick={() => setSheet('menu')} />
          </div>
          <h1 className="finished-title">Alle {RESULTS.length} uitslagen zijn verdeeld</h1>
        </header>
        <Overview state={game} inline initialTab="people" />
      </div>
    )
  } else {
    screen = (
      <AuctionScreen
        state={game}
        reelSpin={reelSpin}
        reveal={reveal}
        tileStage={tileStage}
        showOther={showOther}
        isOrganizer={isOrganizer}
        canSpinFor={canSpinFor}
        onSpin={spin}
        onSettled={announce}
        onPrepare={() => setSheet('setup')}
        onFinish={() => setAck((a) => ({ ...a, finish: reveal.id }))}
        onOverview={() => setSheet('overview')}
        onMenu={() => setSheet('menu')}
      />
    )
  }

  return (
    <div className={`app ${megaWin ? 'is-mega' : ''}`}>
      {screen}
      <MegaWin key={megaWin ?? 'none'} show={!!megaWin} />
      {sheet === 'overview' && <Overview state={game} onClose={() => setSheet(null)} />}
      {sheet === 'setup' && (
        <AuctionSetup initial={game.auctionTurn} onConfirm={prepareAuction} onClose={() => setSheet(null)} />
      )}
      {sheet === 'menu' && (
        <DemoMenu
          phase={game.phase}
          sound={sound}
          onSound={() => setSound((s) => !s)}
          role={role}
          onRole={setRole}
          onSkip={() => {
            clearEffects()
            dispatch({ type: 'DEMO_SKIP_TO_AUCTION' })
          }}
          onReset={reset}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  )
}
