// Gedeelde generator: rendert de schermcomponenten voor een reeks DEMO-
// standen (standaardinstellingen) naar HTML. Gebruikt om de DEMO vóór en na
// F2 te vergelijken (tests/fixtures/demo-markup-v2.json, gemaakt met de
// componenten van commit a9e5b88). Alleen API's die in beide versies bestaan.
import { renderToStaticMarkup } from 'react-dom/server'
import MainScreen from '../src/components/MainScreen.jsx'
import AuctionScreen from '../src/components/AuctionScreen.jsx'
import Overview from '../src/components/Overview.jsx'
import AuctionSetup from '../src/components/AuctionSetup.jsx'
import DemoMenu from '../src/components/DemoMenu.jsx'
import { deriveView } from '../src/game/view.js'
import { STOP_DELAY } from '../src/game/timeline.js'
import { makeGame } from './helpers.js'

const noop = () => {}
const canSpinFor = (p) => p === 0

function screen(state, now, ack = {}) {
  const v = deriveView(state, now, ack)
  const game = v.state
  const onMain = game.phase === 'draw' || (v.reveal && v.reveal.round !== 'veiling')
  const common = { state: game, reelSpin: v.reelSpin, reveal: v.reveal, showOther: false, canSpinFor, onSpin: noop, onSettled: noop, onOverview: noop, onMenu: noop }
  return onMain
    ? renderToStaticMarkup(<MainScreen {...common} locked={v.locked} onNext={noop} />)
    : renderToStaticMarkup(<AuctionScreen {...common} tileStage={v.tileStage} isOrganizer onPrepare={noop} onFinish={noop} />)
}

export function demoMarkup() {
  const out = {}
  const g = makeGame({ seed: 5 })
  out.start = screen(g.state, g.now)
  g.spin()
  const s1 = g.state.spin
  out.spinning = screen(g.state, s1.startedAt + 1500)
  out.revealed = screen(g.state, s1.startedAt + STOP_DELAY + 300)
  for (let i = 0; i < 12; i++) g.spin()
  out.round2 = screen(g.state, g.now + 60_000)
  for (let i = 0; i < 5; i++) g.spin()
  out.lastDrawRevealed = screen(g.state, g.state.spin.startedAt + STOP_DELAY + 300)
  g.finishPending()
  const lastId = g.state.lastSpin.id
  out.auctionStart = screen(g.state, g.now + 60_000, { auctionStart: lastId })
  g.prepare(4, 7.5)
  out.auctionPrepared = screen(g.state, g.now, { auctionStart: lastId })
  g.spin()
  const a = g.state.spin
  out.auctionSpinning = screen(g.state, a.startedAt + 2000, { auctionStart: lastId })
  out.auctionGreen = screen(g.state, a.startedAt + 5300, { auctionStart: lastId })
  g.finishPending()
  out.auctionAfterOne = screen(g.state, g.now + 60_000, { auctionStart: lastId })
  out.overviewGrid = renderToStaticMarkup(<Overview state={g.state} onClose={noop} />)
  out.overviewPeople = renderToStaticMarkup(<Overview state={g.state} onClose={noop} initialTab="people" />)
  out.auctionSetup = renderToStaticMarkup(<AuctionSetup initial={{ participant: 2, bid: 12.25 }} onConfirm={noop} onClose={noop} />)
  out.demoMenu = renderToStaticMarkup(
    <DemoMenu phase="draw" sound role={{ kind: 'organizer', participant: 3, testAll: true }} onSound={noop} onRole={noop} onSkip={noop} onReset={noop} onClose={noop} />,
  )
  for (let i = 0; i < 7; i++) {
    g.prepare([0, 8, 2, 5, 1, 7, 3][i], [20, 0.5, 0, 12.25, 3, 10, 1][i])
    g.spin()
  }
  g.finishPending()
  out.finishedOverview = renderToStaticMarkup(<Overview state={g.state} inline initialTab="people" />)
  out.finishedGrid = renderToStaticMarkup(<Overview state={g.state} inline />)
  return out
}
