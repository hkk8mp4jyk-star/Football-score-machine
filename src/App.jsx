import { useEffect, useRef, useState } from 'react'
import MainScreen from './components/MainScreen.jsx'
import AuctionScreen from './components/AuctionScreen.jsx'
import Overview from './components/Overview.jsx'
import DemoMenu from './components/DemoMenu.jsx'
import { Logo, MenuButton } from './components/Header.jsx'
import { useGame } from './game/useGame.js'
import { RESULT_BY_ID, TIMING } from './game/config.js'
import { setSoundEnabled, sfx, unlockAudio } from './audio/sound.js'

export default function App() {
  const [state, dispatch] = useGame()
  const [reveal, setReveal] = useState(null) // trekking die nu onthuld wordt
  const [tileStage, setTileStage] = useState(null) // { resultId, stage: 'green' | 'fade' }
  const [showOther, setShowOther] = useState(false)
  const [sheet, setSheet] = useState(null) // 'overview' | 'menu'
  const [sound, setSound] = useState(true)
  // Tijdelijke ontwerpinstelling: A = SPIN-knop vervaagt, B = verdwijnt.
  const [spinVariant, setSpinVariant] = useState(() => {
    try {
      return localStorage.getItem('fsm-spin-variant') === 'B' ? 'B' : 'A'
    } catch {
      return 'A'
    }
  })
  const [bidder, setBidder] = useState('')
  const [bid, setBid] = useState('')
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
      localStorage.setItem('fsm-spin-variant', spinVariant)
    } catch {
      /* geen opslag: keuze geldt alleen deze sessie */
    }
  }, [spinVariant])

  const announce = (spin) => {
    if (RESULT_BY_ID[spin.resultId].other) {
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
    announce(spin)
    setReveal(spin)
    dispatch({ type: 'SPIN_COMMIT', spinId: spin.id })
  }

  const spinAuction = (participant, amount) => {
    unlockAudio()
    setReveal(null)
    dispatch({ type: 'SPIN_START', participant, bid: amount })
  }

  // Veiling: 2 s uitslag tonen -> vak groen -> vak verdwijnt -> vastleggen.
  const settledAuction = (spin) => {
    announce(spin)
    later(TIMING.auctionHold, () => {
      sfx.highlight()
      setTileStage({ resultId: spin.resultId, stage: 'green' })
    })
    later(TIMING.auctionHold + TIMING.auctionHighlight, () => {
      sfx.remove()
      setTileStage({ resultId: spin.resultId, stage: 'fade' })
    })
    later(TIMING.auctionHold + TIMING.auctionHighlight + TIMING.auctionFade, () => {
      dispatch({ type: 'SPIN_COMMIT', spinId: spin.id })
      setTileStage(null)
      setReveal(spin)
    })
  }

  const nextAuction = () => {
    setReveal(null)
    setBidder('')
    setBid('')
  }

  const reset = () => {
    clearTimers()
    setReveal(null)
    setTileStage(null)
    setShowOther(false)
    setBidder('')
    setBid('')
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
        showOther={showOther}
        spinVariant={spinVariant}
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
        spinVariant={spinVariant}
        bidder={bidder}
        bid={bid}
        onBidder={setBidder}
        onBid={setBid}
        onSpin={spinAuction}
        onSettled={settledAuction}
        onNext={nextAuction}
        onOverview={() => setSheet('overview')}
        onMenu={() => setSheet('menu')}
      />
    )
  }

  return (
    <div className="app">
      {screen}
      {sheet === 'overview' && <Overview state={state} onClose={() => setSheet(null)} />}
      {sheet === 'menu' && (
        <DemoMenu
          phase={state.phase}
          sound={sound}
          onSound={() => setSound((s) => !s)}
          spinVariant={spinVariant}
          onSpinVariant={setSpinVariant}
          onSkip={() => {
            clearTimers()
            setReveal(null)
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
