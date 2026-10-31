import { useState } from 'react'
import { MAX_PLAYERS, MAX_ROUNDS } from '../../game/config.js'
import {
  PRESETS,
  choosePool,
  draftStatus,
  formatPriceInput,
  megaCandidates,
  parsePlayerCount,
  parsePrice,
  toggleMegaResult,
  togglePoolResult,
} from '../../lobby/lobbyRules.js'
import { countText, issueTexts, okText, poolIssueTexts, statusKind } from '../lobbyText.js'
import { Status } from './common.jsx'
import { errorText } from '../api.js'

const GOALS = [0, 1, 2, 3, 4, 5, 6]

// Invoer van de spelregels (gedeeld door "Nieuw spel" en de wachtkamer).
// Tekstvelden blijven tekst tot ze kloppen; `draft` is wat er naar de server gaat.
export function useRules(saved) {
  const [players, setPlayers] = useState(saved.maxPlayers == null ? '' : String(saved.maxPlayers))
  const [price, setPrice] = useState(formatPriceInput(saved.priceCents))
  const [rounds, setRounds] = useState(saved.rounds)
  const [pool, setPool] = useState(saved.pool)
  const [mega, setMega] = useState(saved.mega)
  const count = parsePlayerCount(players)
  const cents = parsePrice(price)
  const draft = {
    maxPlayers: count.error ? null : count.count,
    rounds,
    priceCents: cents.error ? null : cents.cents,
    pool,
    mega,
  }
  return {
    players,
    setPlayers,
    price,
    setPrice,
    rounds,
    setRounds,
    pool,
    setPool,
    mega,
    setMega,
    draft,
    errors: { players: count.error ?? null, price: cents.error ?? null },
  }
}

function ResultCell({ id, on, star, disabled, onClick, pressed }) {
  return (
    <button
      type="button"
      className={`ol-cell ${on ? 'is-on' : 'is-off'} ${star ? 'is-mega' : ''}`.replace(/\s+/g, ' ').trim()}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {id}
    </button>
  )
}

// Aantal deelnemers + prijs (naast elkaar), vaste rondes, uitslagen met twee
// tabbladen en de automatische controle. `missingNote`: melding over lege velden boven
// dit blok (naam, clubs) voor de melding "Nog invullen".
export function RulesFields({ rules, initialTab = 'pool', missingNote = null }) {
  const [tab, setTab] = useState(initialTab) // 'pool' | 'mega'
  const { pool, mega, setPool, setMega } = rules
  const status = draftStatus(rules.draft)
  const regular = megaCandidates(pool)
  const apply = (next) => {
    setPool(next.pool)
    setMega(next.mega)
  }
  const togglePool = (id) => apply(togglePoolResult({ pool, mega }, id)) // MEGA vervalt mee
  const toggleMega = (id) => apply(toggleMegaResult({ pool, mega }, id))
  const choose = (ids) => apply(choosePool({ pool, mega }, ids))

  const fieldIssues = status.issues.filter((i) => i.code === 'players_missing' || i.code === 'price_missing' || i.code === 'rounds_missing')
  const poolTexts = poolIssueTexts(status)
  // Rood alleen bij echt ongeldig (te veel uitslagen, ongeldige invoer);
  // leeg of onvolledig is een neutrale melding.
  const inputError = !!rules.errors.players || !!rules.errors.price
  const kind = statusKind(status, inputError)
  const badCount = status.issues.some((i) => i.code === 'too_many')

  return (
    <>
      <div className="ol-pair">
        <label className="ol-field" htmlFor="ol-players">
          <span className="ol-label">Aantal deelnemers</span>
          <input
            id="ol-players"
            className="ol-input ol-input-num"
            inputMode="numeric"
            enterKeyHint="next"
            autoComplete="off"
            placeholder={`1–${MAX_PLAYERS}`}
            value={rules.players}
            onChange={(e) => rules.setPlayers(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
          />
        </label>
        <label className="ol-field" htmlFor="ol-price">
          <span className="ol-label">Prijs per vaste trekking</span>
          <span className="money-input ol-price">
            <span>€</span>
            <input
              id="ol-price"
              inputMode="decimal"
              enterKeyHint="done"
              autoComplete="off"
              placeholder="0,00"
              value={rules.price}
              onChange={(e) => rules.setPrice(e.target.value.replace(/[^0-9.,]/g, ''))}
            />
          </span>
        </label>
      </div>
      {rules.errors.players && <p className="ol-hint is-error">Kies 1 tot {MAX_PLAYERS} deelnemers (jij telt mee).</p>}
      {rules.errors.price && <p className="ol-hint is-error">Vul een bedrag in, bijvoorbeeld 10 of 2,50 (maximaal €10.000).</p>}

      <div className="ol-set-row">
        <span className="ol-label">Vaste rondes</span>
        <div className="ol-steps" role="radiogroup" aria-label="Vaste rondes">
          {Array.from({ length: MAX_ROUNDS }, (_, i) => i + 1).map((n) => (
            <button key={n} type="button" role="radio" aria-checked={rules.rounds === n} className={rules.rounds === n ? 'is-on' : ''} onClick={() => rules.setRounds(n)}>
              {n}
            </button>
          ))}
        </div>
      </div>

      <div className="ol-field">
        <div className="segmented" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'pool'} className={tab === 'pool' ? 'is-active' : ''} onClick={() => setTab('pool')}>
            Uitslagen · {pool.length}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'mega'} className={tab === 'mega' ? 'is-active' : ''} onClick={() => setTab('mega')}>
            MEGA WIN ★ · {mega.length}
          </button>
        </div>
        <div className="ol-chiprow">
          {tab === 'pool' ? (
            <>
              <button type="button" className="ol-chip" onClick={() => choose(PRESETS.standard())}>
                Standaard (0-0 t/m 4-4)
              </button>
              <button type="button" className="ol-chip" onClick={() => choose(PRESETS.all())}>
                Alles
              </button>
              <button type="button" className="ol-chip" onClick={() => choose(PRESETS.clear())}>
                Wissen
              </button>
            </>
          ) : (
            <>
              <button type="button" className="ol-chip" onClick={() => setMega(PRESETS.standardMega(pool))} disabled={!regular.length}>
                Standaard MEGA
              </button>
              <button type="button" className="ol-chip" onClick={() => setMega([])} disabled={!mega.length}>
                Geen MEGA
              </button>
            </>
          )}
        </div>

        {tab === 'pool' ? (
          <>
            <div className="ol-grid">
              <span />
              {GOALS.map((a) => (
                <span key={a} className="ol-ax">
                  {a}
                </span>
              ))}
              {GOALS.map((h) => [
                <span key={`h${h}`} className="ol-ax">
                  {h}
                </span>,
                ...GOALS.map((a) => {
                  const id = `${h}-${a}`
                  const on = pool.includes(id)
                  return <ResultCell key={id} id={id} on={on} star={mega.includes(id)} pressed={on} onClick={() => togglePool(id)} />
                }),
              ])}
            </div>
            <div className="ol-other">
              Overige uitslagen <small>· doet altijd mee</small>
            </div>
          </>
        ) : regular.length ? (
          // MEGA WIN: alleen de gekozen gewone uitslagen (OVERIG nooit).
          <div className="ol-mega-list">
            {regular.map((id) => (
              <ResultCell key={id} id={id} on star={mega.includes(id)} pressed={mega.includes(id)} onClick={() => toggleMega(id)} />
            ))}
          </div>
        ) : (
          <p className="ol-hint ol-center ol-mega-empty">Kies eerst uitslagen op het tabblad Uitslagen.</p>
        )}
      </div>

      <div className="ol-counts" aria-live="polite">
        <div className="ol-count-tile">
          <b>{countText(status.fixed)}</b>
          <span>Vaste trekkingen</span>
        </div>
        <div className={`ol-count-tile ${badCount ? 'is-bad' : ''}`.trim()}>
          <b>{countText(status.auction)}</b>
          <span>Veilinguitslagen</span>
        </div>
      </div>
      {status.ok && !missingNote && !rules.errors.players && !rules.errors.price ? (
        <Status kind="ok">{okText(status)}</Status>
      ) : (
        (missingNote || fieldIssues.length > 0 || poolTexts.length > 0) && (
          <Status kind={kind}>
            {missingNote ? <p>{missingNote}</p> : issueTexts({ issues: fieldIssues }).map((t) => <p key={t}>{t}</p>)}
            {poolTexts.map((t) => (
              <p key={t}>{t}</p>
            ))}
          </Status>
        )
      )}
    </>
  )
}

// Spelregels wijzigen in de wachtkamer (alleen organisator).
export function SettingsSheet({ draft: saved, onSave, onClose, initialTab }) {
  const rules = useRules(saved)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const invalid = !!rules.errors.players || !!rules.errors.price || rules.draft.maxPlayers == null

  const save = async () => {
    if (busy || invalid) return
    setBusy(true)
    setError(null)
    try {
      await onSave(rules.draft)
    } catch (e) {
      setError(e)
      setBusy(false)
    }
  }

  return (
    <div className="sheet-backdrop" onClick={busy ? undefined : onClose}>
      <div className="sheet sheet-tall ol-settings" role="dialog" aria-label="Spelregels" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>Spelregels</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Sluiten zonder opslaan">
            ✕
          </button>
        </div>
        <RulesFields rules={rules} initialTab={initialTab} />
        {error && <p className="ol-hint is-error ol-center">{errorText(error)}</p>}
        <button type="button" className="gold-btn ol-btn-wide" onClick={save} disabled={busy || invalid}>
          {busy ? 'Opslaan…' : 'Opslaan'}
        </button>
      </div>
    </div>
  )
}
