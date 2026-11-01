import { formatCents } from '../../game/money.js'
import { playDate } from '../share/resultImage.js'
import { OnlineScreen } from './common.jsx'
import { FinalScreen } from './FinalScreen.jsx'

// Geschiedenis (F12): de laatste 10 afgeronde wedstrijden op dit toestel,
// nieuwste eerst. Openen = het eindscherm, alleen te bekijken.
export function HistoryList({ entries, onOpen, onBack }) {
  return (
    <OnlineScreen onBack={onBack}>
      <h1 className="ol-title">Geschiedenis</h1>
      {entries.length === 0 ? (
        <p className="ol-note">Nog geen afgeronde wedstrijden.</p>
      ) : (
        <ul className="ol-history">
          {entries.map((e) => (
            <li key={e.roomId}>
              <button type="button" className="ol-history-item" onClick={() => onOpen(e)}>
                <span className="ol-history-name">{e.matchName}</span>
                <span className="ol-history-meta">
                  <span className="ol-history-date">{playDate(e.startedAt)}</span>
                  <b className="ol-history-pot">{formatCents(e.potCents)}</b>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </OnlineScreen>
  )
}

export function HistoryMatch({ entry, onBack, notify }) {
  return <FinalScreen room={entry.room} state={entry.room.state} onBack={onBack} backLabel="Terug naar geschiedenis" notify={notify} />
}
