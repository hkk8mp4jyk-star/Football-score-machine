import { useEffect, useRef, useState } from 'react'
import Overview from '../../components/Overview.jsx'
import { Logo } from '../../components/Header.jsx'
import { formatCents, potCents } from '../../game/money.js'
import { renderResultFile, shareOrDownload } from '../share/resultImage.js'

// Eindscherm (F10), ook gebruikt om een wedstrijd uit de geschiedenis terug
// te kijken (F12). Alleen weergave: wedstrijdnaam, totale pot, de bestaande
// tabbladen (definitieve gelote volgorde) en twee knoppen voor iedereen.
// Geen winnaar. `state` = afgeronde spelstatus.
export function FinalScreen({ room, state, onBack, backLabel = 'Terug naar beginscherm', menu, notify }) {
  const [busy, setBusy] = useState(false)
  // "Deel einduitslag" deelt de afbeelding van het actieve tabblad:
  // "Uitslagen" → raster, "Per deelnemer" → deelnemersoverzicht.
  const tab = useRef('people')
  const kindOf = (t) => (t === 'remaining' ? 'grid' : 'people')
  // Beide afbeeldingen alvast maken, zodat het deelmenu direct na de tik
  // opent (sommige telefoons staan delen alleen direct na een tik toe).
  const files = useRef({})
  useEffect(() => {
    let alive = true
    files.current = {}
    for (const kind of ['people', 'grid']) {
      renderResultFile(room, state, kind)
        .then((f) => alive && (files.current[kind] = f))
        .catch(() => {})
    }
    return () => {
      alive = false
    }
  }, [room, state])

  const share = async () => {
    if (busy) return
    setBusy(true)
    try {
      const kind = kindOf(tab.current)
      const f = files.current[kind] ?? (await renderResultFile(room, state, kind))
      files.current[kind] = f
      const how = await shareOrDownload(f, { title: room.matchName })
      if (how === 'downloaded') notify?.('Afbeelding opgeslagen', false)
    } catch {
      notify?.('Delen lukte niet. Probeer het opnieuw.', true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="screen screen-finished ol-final">
      <header className="top top-compact">
        <div className="top-row">
          <Logo compact />
          {menu}
        </div>
        <h1 className="finished-title">{room.matchName}</h1>
        <p className="ol-final-pot">
          <span>Totale pot</span>
          <b>{formatCents(potCents(state))}</b>
        </p>
      </header>
      <Overview state={state} inline initialTab="people" onTabChange={(t) => (tab.current = t)} />
      <div className="ol-final-actions">
        <button type="button" className="gold-btn ol-btn-wide" onClick={share} disabled={busy}>
          Deel einduitslag
        </button>
        <button type="button" className="ol-big-btn" onClick={onBack}>
          {backLabel}
        </button>
      </div>
    </div>
  )
}
