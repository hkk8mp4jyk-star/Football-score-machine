import { useState } from 'react'
import { GOALS, OTHER_ID, PARTICIPANTS, RESULT_BY_ID } from '../game/config.js'
import { drawValueCents, formatCents, totalCents } from '../game/money.js'

function RemainingGrid({ state }) {
  const owner = Object.fromEntries(state.draws.map((d) => [d.resultId, d]))
  const cell = (id) => {
    const d = owner[id]
    return (
      <div key={id} className={`grid-cell ${d ? 'is-taken' : 'is-free'} ${id === OTHER_ID ? 'grid-other' : ''}`}>
        <span className="grid-score">{id === OTHER_ID ? 'Overige uitslagen' : id}</span>
        <span className="grid-owner">{d ? PARTICIPANTS[d.participant] : 'Vrij'}</span>
      </div>
    )
  }
  return (
    <div className="tab-body">
      <div className="grid-axes">
        <span className="axis-corner" />
        {GOALS.map((a) => (
          <span key={a} className="axis-label">
            {a}
          </span>
        ))}
      </div>
      <div className="score-grid">
        {GOALS.map((h) => (
          <div key={h} className="score-row">
            <span className="axis-label">{h}</span>
            {GOALS.map((a) => cell(`${h}-${a}`))}
          </div>
        ))}
        {cell(OTHER_ID)}
      </div>
    </div>
  )
}

function PerParticipant({ state }) {
  return (
    <div className="tab-body">
      <ul className="people">
        {PARTICIPANTS.map((name, i) => {
          const mine = state.draws.filter((d) => d.participant === i)
          return (
            <li key={name} className="person">
              <div className="person-head">
                <span className="person-num">{i + 1}</span>
                <span className="person-name">{name}</span>
                <span className="person-meta">
                  {mine.length} {mine.length === 1 ? 'uitslag' : 'uitslagen'} · <b>{formatCents(totalCents(mine))}</b>
                </span>
              </div>
              <div className="chips">
                {mine.length === 0 && <span className="chip chip-empty">Nog niets getrokken</span>}
                {mine.map((d) => (
                  <span key={d.resultId} className="chip">
                    <span className="chip-score">{RESULT_BY_ID[d.resultId].other ? 'Overig' : d.resultId}</span>
                    <i className="chip-sep" aria-hidden="true" />
                    <small>{formatCents(drawValueCents(d))}</small>
                  </span>
                ))}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default function Overview({ state, onClose, inline = false, initialTab = 'remaining' }) {
  const [tab, setTab] = useState(initialTab)
  return (
    <div className={inline ? 'overview overview-inline' : 'sheet-backdrop'} onClick={inline ? undefined : onClose}>
      <div className={inline ? '' : 'sheet sheet-tall'} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Uitslagen">
        {!inline && (
          <div className="sheet-head">
            <h2>Uitslagen</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Sluiten">
              ✕
            </button>
          </div>
        )}
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'remaining'} className={tab === 'remaining' ? 'is-active' : ''} onClick={() => setTab('remaining')}>
            Resterende uitslagen
          </button>
          <button role="tab" aria-selected={tab === 'people'} className={tab === 'people' ? 'is-active' : ''} onClick={() => setTab('people')}>
            Per deelnemer
          </button>
        </div>
        {tab === 'remaining' ? <RemainingGrid state={state} /> : <PerParticipant state={state} />}
      </div>
    </div>
  )
}
