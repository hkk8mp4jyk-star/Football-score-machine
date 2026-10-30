import { useState } from 'react'
import { OTHER_ID, RESULT_BY_ID } from '../game/config.js'
import { configOf, gridGoalsFor, playerName } from '../game/gameConfig.js'
import { drawValueCents, formatCents, totalCents } from '../game/money.js'

function RemainingGrid({ state }) {
  const config = configOf(state)
  const goals = gridGoalsFor(config) // standaard 0–4; groter alleen bij een grotere pool
  const inPool = new Set(config.pool)
  const owner = Object.fromEntries(state.draws.map((d) => [d.resultId, d]))
  const cell = (id) => {
    // Uitslagen die niet in de pool zitten, tonen we gedimd en zonder "Vrij".
    if (!inPool.has(id)) {
      return (
        <div key={id} className="grid-cell is-excluded" aria-label={`${id} doet niet mee`}>
          <span className="grid-score">{id}</span>
        </div>
      )
    }
    const d = owner[id]
    return (
      <div key={id} className={`grid-cell ${d ? 'is-taken' : 'is-free'} ${id === OTHER_ID ? 'grid-other' : ''}`}>
        <span className="grid-score">{id === OTHER_ID ? 'Overige uitslagen' : id}</span>
        <span className="grid-owner">{d ? playerName(config, d.participant) : 'Vrij'}</span>
      </div>
    )
  }
  const wide = goals.length > 5
  return (
    <div className={`tab-body ${wide ? `grid-wide grid-${goals.length}` : ''}`.trim()} style={wide ? { '--grid-cols': goals.length } : undefined}>
      <div className="grid-axes">
        <span className="axis-corner" />
        {goals.map((a) => (
          <span key={a} className="axis-label">
            {a}
          </span>
        ))}
      </div>
      <div className="score-grid">
        {goals.map((h) => (
          <div key={h} className="score-row">
            <span className="axis-label">{h}</span>
            {goals.map((a) => cell(`${h}-${a}`))}
          </div>
        ))}
        {cell(OTHER_ID)}
      </div>
    </div>
  )
}

function PerParticipant({ state }) {
  const config = configOf(state)
  return (
    <div className="tab-body">
      <ul className="people">
        {config.players.map(({ id, name }, i) => {
          const mine = state.draws.filter((d) => d.participant === id)
          return (
            <li key={id} className="person">
              <div className="person-head">
                <span className="person-num">{i + 1}</span>
                <span className="person-name">{name}</span>
                <span className="person-meta">
                  {mine.length} {mine.length === 1 ? 'uitslag' : 'uitslagen'} · <b>{formatCents(totalCents(mine, config.priceCents))}</b>
                </span>
              </div>
              <div className="chips">
                {mine.length === 0 && <span className="chip chip-empty">Nog niets getrokken</span>}
                {mine.map((d) => (
                  <span key={d.resultId} className="chip">
                    <span className="chip-score">{RESULT_BY_ID[d.resultId].other ? 'Overig' : d.resultId}</span>
                    <i className="chip-sep" aria-hidden="true" />
                    <small>{formatCents(drawValueCents(d, config.priceCents))}</small>
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
        {/* Tabbladen staan bovenaan, naast de sluitknop; geen aparte titel. */}
        <div className="overview-head">
          <div className="tabs" role="tablist">
            <button
              role="tab"
              aria-selected={tab === 'remaining'}
              className={tab === 'remaining' ? 'is-active' : ''}
              onClick={() => setTab('remaining')}
            >
              Uitslagen
            </button>
            <button
              role="tab"
              aria-selected={tab === 'people'}
              className={tab === 'people' ? 'is-active' : ''}
              onClick={() => setTab('people')}
            >
              Per deelnemer
            </button>
          </div>
          {!inline && (
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Sluiten">
              ✕
            </button>
          )}
        </div>
        {tab === 'remaining' ? <RemainingGrid state={state} /> : <PerParticipant state={state} />}
      </div>
    </div>
  )
}
