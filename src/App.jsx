import { useEffect, useRef, useState } from 'react'
import MainScreen from './components/MainScreen.jsx'
import AuctionScreen from './components/AuctionScreen.jsx'
import Overview from './components/Overview.jsx'
import DemoMenu from './components/DemoMenu.jsx'
import MegaWin from './components/MegaWin.jsx'
import AuctionSetup from './components/AuctionSetup.jsx'
import { Logo, MenuButton } from './components/Header.jsx'
import { useGame } from './game/useGame.js'
import { DRAW_TURNS, MEGA_WIN_IDS, RESULT_BY_ID, TIMING } from './game/config.js'
import { buzz, setSoundEnabled, sfx, unlockAudio } from './audio/sound.js'

export default function App() {
  const [state, dispatch] = useGame()
  const [reveal, setReveal] = useState(null) // trekking die nu onthuld wordt
  // Na een trekking is de beurt even 'op slot': de uitslag blijft staan en
  // de SPIN-knop verschijnt pas als de volgende beurt is vrijgegeven.
  const [locked, setLocked] = useState(false)
  const [tileStage, setTileStage] = useState(null) // { resultId, stage: 'green' | 'fade' }
  const [showOther, setShowOther] = useState(false)
  const [megaWin, setMegaWin] = useState(null) // id van de draai met MEGA WIN
  const [sheet, setSheet] = useState(null) // 'overview' | 'menu'
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

  const isOrganizer = role.kind === 'organizer'
  // SPIN voor wie zelf aan de beurt is; de organisator is ook deelnemer.
  const canSpinFor = (participant) => role.participant === participant || (isOrganizer && role.testAll)

  const isMega = (spin) => MEGA_WIN_IDS.includes(spin.resultId)

  const announce = (spin) => {
    if (isMega(spin)) {
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

  const spinDraw = () => {
    unlockAudio()
    setReveal(null)
    dispatch({ type: 'SPIN_START' })
  }

  const settledDraw = (spin) => {
    const lastDraw = state.turn === DRAW_TURNS - 1
    announce(spin)
    setReveal(spin)
    setLocked(true)
    dispatch({ type: 'SPIN_COMMIT', spinId: spin.id })
    // Volgende beurt vrijgeven: naam wisselt en SPIN verschijnt.
    // Na de laatste trekking blijft de uitslag staan voor 'Start de veiling'.
    // Bij een MEGA WIN wacht de volgende beurt tot de animatie klaar is.
    const delay = isMega(spin) ? Math.max(TIMING.nextTurnDelay, TIMING.megaWin) : TIMING.nextTurnDelay
    later(delay, () => {
      setLocked(false)
      if (!lastDraw) setReveal(null)
    })
  }

  const spinAuction = () => {
    unlockAudio()
    setReveal(null)
    dispatch({ type: 'SPIN_START' })
  }

  const prepareAuction = (participant, bid) => {
    dispatch({ type: 'AUCTION_PREPARE', participant, bid })
    setReveal(null)
    setSheet(null)
  }

  // Veiling: rollen stoppen -> 0,8 s uitslag -> vak groen -> vak verdwijnt -> vastleggen.
  const settledAuction = (spin) => {
    announce(spin)
    // Bij een MEGA WIN licht het vak pas op als de animatie voorbij is.
    const hold = isMega(spin) ? TIMING.megaWin : TIMING.auctionHold
    later(hold, () => {
      sfx.highlight()
      setTileStage({ resultId: spin.resultId, stage: 'green' })
    })
    later(hold + TIMING.auctionHighlight, () => {
      sfx.remove()
      setTileStage({ resultId: spin.resultId, stage: 'fade' })
    })
    later(hold + TIMING.auctionHighlight + TIMING.auctionFade, () => {
      dispatch({ type: 'SPIN_COMMIT', spinId: spin.id })
      setTileStage(null)
      setReveal(spin)
    })
  }

  const reset = () => {
    clearTimers()
    setReveal(null)
    setLocked(false)
    setMegaWin(null)
    setTileStage(null)
    setShowOther(false)
    setSheet(null)
    dispatch({ type: 'RESET' })
  }

  // Het hoofdscherm blijft staan tot de laatste trekking onthuld is.
  const onMain = state.phase === 'draw' || (reveal && reveal.round !== 'veiling')
  const finished = state.phase === 'finished' && !reveal

  let screen
  if (onMain) {
    screen = (
      <MainScreen
        state={state}
        reveal={reveal}
        locked={locked}
        canSpinFor={canSpinFor}
        showOther={showOther}
        onSpin={spinDraw}
        onSettled={settledDraw}
        onNext={() => setReveal(null)}
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
          <h1 className="finished-title">Alle 37 uitslagen zijn verdeeld</h1>
        </header>
        <Overview state={state} inline initialTab="people" />
      </div>
    )
  } else {
    screen = (
      <AuctionScreen
        state={state}
        reveal={reveal}
        tileStage={tileStage}
        showOther={showOther}
        isOrganizer={isOrganizer}
        canSpinFor={canSpinFor}
        onSpin={spinAuction}
        onSettled={settledAuction}
        onPrepare={() => setSheet('setup')}
        onFinish={() => setReveal(null)}
        onOverview={() => setSheet('overview')}
        onMenu={() => setSheet('menu')}
      />
    )
  }

  return (
    <div className={`app ${megaWin ? 'is-mega' : ''}`}>
      {screen}
      <MegaWin key={megaWin ?? 'none'} show={!!megaWin} />
      {sheet === 'overview' && <Overview state={state} onClose={() => setSheet(null)} />}
      {sheet === 'setup' && (
        <AuctionSetup initial={state.auctionTurn} onConfirm={prepareAuction} onClose={() => setSheet(null)} />
      )}
      {sheet === 'menu' && (
        <DemoMenu
          phase={state.phase}
          sound={sound}
          onSound={() => setSound((s) => !s)}
          role={role}
          onRole={setRole}
          onSkip={() => {
            clearTimers()
            setReveal(null)
            setLocked(false)
            setMegaWin(null)
            setShowOther(false)
            setSheet(null)
            dispatch({ type: 'DEMO_SKIP_TO_AUCTION' })
          }}
          onReset={reset}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  )
}
