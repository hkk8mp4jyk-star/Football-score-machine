import { useEffect, useReducer, useState } from 'react'
import { draftStatus } from '../../lobby/lobbyRules.js'
import { issueTexts, priceText, roundsText, statusKind } from '../lobbyText.js'
import { USE_MOCK, errorText } from '../api.js'
import { ConfirmSheet, NameInput, OnlineScreen, Status } from './common.jsx'
import { PlayerList, moveSlot } from './PlayerList.jsx'
import { SettingsSheet } from './SettingsSheet.jsx'
import { MiniReels, warmingPositions } from '../intro/MiniReels.jsx'
import { startReelLoop } from '../../audio/openingSound.js'
import { SoundButton } from './SoundButton.jsx'

export const inviteText = (matchName, organizerName, code) => `Doe mee met ${matchName}, het spel van ${organizerName} in Football Score Machine. Kamercode: ${code}`

const seatsText = (room) => `${room.players.length} van ${room.maxPlayers} deelnemers`

// Mag het spel starten? Alleen als het werkelijke aantal deelnemers precies
// gelijk is aan het ingestelde aantal en alle spelregels kloppen.
export const canStart = (room) => room.players.length === room.maxPlayers && draftStatus(room.draft).ok

function RulesTiles({ draft }) {
  return (
    <div className="ol-rules">
      <div className="ol-rule">
        <b>{roundsText(draft.rounds)}</b>
        <span>{draft.rounds === 1 ? 'ronde' : 'rondes'}</span>
      </div>
      <div className="ol-rule">
        <b>{priceText(draft.priceCents)}</b>
        <span>per trekking</span>
      </div>
      <div className="ol-rule">
        <b>{draft.pool.length}</b>
        <span>uitslagen</span>
      </div>
    </div>
  )
}

// Verwijderen bevestigen: een deelnemer, een deelnemer zonder telefoon, of
// de organisator zelf (die blijft organisator).
export function RemoveConfirm({ player, busy, onConfirm, onCancel }) {
  const title = player.isMe ? 'Jezelf verwijderen?' : `${player.name} verwijderen?`
  const text = player.isMe
    ? 'Je blijft organisator, maar speelt zelf niet mee. Je kunt jezelf vóór de start weer toevoegen als er plek is.'
    : player.manual
      ? `${player.name} wordt uit de lijst gehaald.`
      : `${player.name} kan zich daarna opnieuw aanmelden, zolang het spel nog niet is gestart.`
  return (
    <ConfirmSheet title={title} confirmLabel="Verwijderen" danger busy={busy} onConfirm={onConfirm} onCancel={onCancel}>
      <p className="ol-intro ol-left">{text}</p>
    </ConfirmSheet>
  )
}

// Deelnemer zonder eigen telefoon toevoegen (speelt via het toestel van de organisator).
export function AddPlayerSheet({ onAdd, onClose }) {
  const [name, setName] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    if (!name.trim()) return setError('Vul een naam in.')
    setBusy(true)
    setError(null)
    try {
      await onAdd(name)
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }
  return (
    <div className="sheet-backdrop" onClick={busy ? undefined : onClose}>
      <form className="sheet ol-confirm" role="dialog" aria-label="Deelnemer zonder telefoon" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="sheet-head">
          <h2>Deelnemer zonder telefoon</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Sluiten">
            ✕
          </button>
        </div>
        <p className="ol-intro ol-left">Speelt het hele spel via jouw toestel. Jij drukt voor deze deelnemer op SPIN.</p>
        <NameInput value={name} onChange={setName} autoFocus id="ol-manual-name" placeholder="Naam" ariaLabel="Naam" />
        {error && <p className="ol-hint is-error">{error}</p>}
        <button type="submit" className="gold-btn ol-btn-wide" disabled={busy}>
          Toevoegen
        </button>
      </form>
    </div>
  )
}

// Wachtkamer van de organisator.
export function LobbyOrganizer({ room, actions, onShare, onCopy, onHome, notify, initialSheet = null }) {
  const [sheet, setSheet] = useState(initialSheet) // 'settings' | 'add' | { remove: player }
  const [busy, setBusy] = useState(false)
  const plan = draftStatus(room.draft)
  const order = room.players.map((p) => p.slot)
  const playing = room.mySlot != null
  const full = room.players.length >= room.maxPlayers

  const run = async (fn) => {
    if (busy) return false
    setBusy(true)
    try {
      await fn()
      return true
    } catch (e) {
      notify(errorText(e), true)
      return false
    } finally {
      setBusy(false)
    }
  }
  const move = (from, to) => run(() => actions.setOrder(moveSlot(order, from, to)))

  return (
    <OnlineScreen compact onBack={onHome} className="ol-lobby">
      <SoundButton />
      <h1 className="ol-title ol-match">{room.matchName}</h1>
      <section className="ol-card ol-code">
        <span className="ol-label">Kamercode</span>
        <b className="ol-code-value">{room.code}</b>
        <div className="ol-btn-row">
          <button type="button" className="ghost-btn" onClick={onShare}>
            Deel uitnodiging
          </button>
          <button type="button" className="ghost-btn" onClick={onCopy}>
            Kopieer link
          </button>
        </div>
      </section>

      <section className="ol-card">
        <h3>
          Spelregels
          <button type="button" className="ol-head-link" onClick={() => setSheet('settings')}>
            Wijzig ›
          </button>
        </h3>
        <RulesTiles draft={room.draft} />
        {!plan.ok && (
          <Status kind={statusKind(plan)}>
            {issueTexts(plan).map((t) => (
              <p key={t}>{t}</p>
            ))}
          </Status>
        )}
      </section>

      <section className="ol-card">
        <h3>
          Deelnemers <small>{seatsText(room)}</small>
        </h3>
        <PlayerList players={room.players} editable busy={busy} onMove={move} onRemove={(player) => setSheet({ remove: player })} />
        <div className="ol-btn-row ol-btn-wrap">
          <button type="button" className="ghost-btn" onClick={() => run(actions.shuffleOrder)} disabled={busy || room.players.length < 2}>
            Loot volgorde
          </button>
          <button type="button" className="ghost-btn" onClick={() => setSheet('add')} disabled={busy || full}>
            ＋ Deelnemer
          </button>
          {!playing && (
            <button type="button" className="ghost-btn" onClick={() => run(actions.joinSelf)} disabled={busy || full}>
              ＋ Zelf meedoen
            </button>
          )}
          {USE_MOCK && actions.addFakePlayer && (
            <button type="button" className="ghost-btn ol-mock-btn" onClick={() => run(actions.addFakePlayer)} disabled={busy || full}>
              ＋ Testspeler
            </button>
          )}
        </div>
      </section>

      <div className="ol-start">
        <button type="button" className="gold-btn ol-btn-wide" disabled={!canStart(room) || busy} onClick={() => run(() => actions.startGame(room.version))}>
          Start het spel
        </button>
      </div>

      {sheet === 'settings' && (
        <SettingsSheet
          draft={room.draft}
          onSave={async (draft) => {
            await actions.updateSettings(draft)
            setSheet(null)
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'add' && (
        <AddPlayerSheet
          onAdd={async (name) => {
            await actions.addManualPlayer(name)
            setSheet(null)
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.remove && (
        <RemoveConfirm
          player={sheet.remove}
          busy={busy}
          onConfirm={async () => {
            if (await run(() => actions.removePlayer(sheet.remove.slot))) setSheet(null)
          }}
          onCancel={() => setSheet(null)}
        />
      )}
    </OnlineScreen>
  )
}

// Drie kleine rollen die rustig blijven draaien tot de organisator start.
export function WarmingUp({ fixedTime }) {
  const [, tick] = useReducer((n) => n + 1, 0)
  // Zacht mechanisch rolgeluid zolang de rollen draaien (één lus, stopt bij verlaten).
  useEffect(() => (fixedTime == null ? startReelLoop() : undefined), [fixedTime])
  useEffect(() => {
    if (fixedTime != null) return
    let id = requestAnimationFrame(function loop() {
      tick()
      id = requestAnimationFrame(loop)
    })
    return () => cancelAnimationFrame(id)
  }, [fixedTime])
  const t = fixedTime ?? (typeof performance !== 'undefined' ? performance.now() : 0)
  return (
    <div className="warming">
      <MiniReels positions={warmingPositions(t)} />
      <p className="warming-text">WARMING UP</p>
    </div>
  )
}

// Wachtkamer van een deelnemer: wedstrijdnaam, namen (aanmeldvolgorde, geen
// nummers of labels), drie draaiende rollen en WARMING UP. Geen volgorde,
// spelregels of MEGA WIN.
export function LobbyParticipant({ room, onHome, fixedTime }) {
  const n = room.players.length
  const two = n > 6 // 7–12 namen: twee kolommen, max. 6 per kolom
  const rows = two ? Math.ceil(n / 2) : Math.max(n, 1)
  return (
    <OnlineScreen compact onBack={onHome} className="ol-lobby ol-lobby-guest">
      <SoundButton />
      <div className="ol-guest">
        <h1 className="ol-title ol-match">{room.matchName}</h1>
        <ul className={`ol-names${two ? ' is-two' : ''}`} style={{ '--rows': rows }}>
          {room.players.map((p) => (
            <li key={p.slot}>{p.name}</li>
          ))}
        </ul>
        <WarmingUp fixedTime={fixedTime} />
      </div>
    </OnlineScreen>
  )
}
