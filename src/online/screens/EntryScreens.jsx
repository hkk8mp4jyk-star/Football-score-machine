import { useState } from 'react'
import { NameInput, OnlineScreen, Status } from './common.jsx'
import { RulesFields, useRules } from './SettingsSheet.jsx'
import { errorText, isValidCode, normalizeCode } from '../api.js'
import { MAX_CLUB_LENGTH, blankDraft, setupStatus } from '../../lobby/lobbyRules.js'
import { missingText } from '../lobbyText.js'

// Beginscherm: "Nieuw spel", "Meedoen"; bij een lopend spel bovenaan een
// gouden knop met de wedstrijdnaam (verder met dat spel). Geschiedenis blijft
// voorlopig weg (B7). Geen verdere toelichtingen.
export function Home({ resume, onNew, onJoin, onResume, hasHistory = false, onHistory }) {
  return (
    <OnlineScreen className="ol-home">
      <div className="ol-home-body">
        {resume && (
          <button type="button" className="gold-btn ol-btn-wide ol-resume-btn" onClick={onResume} aria-label={`Verder met ${resume.matchName}`}>
            {resume.matchName}
          </button>
        )}
        <button type="button" className={resume ? 'ol-big-btn' : 'gold-btn ol-btn-wide'} onClick={onNew}>
          Nieuw spel
        </button>
        <button type="button" className="ol-big-btn" onClick={onJoin}>
          Meedoen
        </button>
        {hasHistory && (
          <button type="button" className="ol-big-btn" onClick={onHistory}>
            Geschiedenis
          </button>
        )}
      </div>
    </OnlineScreen>
  )
}

function ClubInput({ id, value, onChange, placeholder }) {
  return (
    <input
      id={id}
      className="ol-input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      maxLength={MAX_CLUB_LENGTH}
      autoComplete="off"
      autoCapitalize="words"
      enterKeyHint="next"
      placeholder={placeholder}
    />
  )
}

// Nieuw spel: één doorlopend formulier. De organisator stelt eerst alles in;
// "Spel aanmaken" kan pas als alles klopt. Daarna liggen de clubnamen vast.
export function NewGame({ onSubmit, onBack, initial = {} }) {
  const [name, setName] = useState(initial.name ?? '')
  const [home, setHome] = useState(initial.home ?? '')
  const [away, setAway] = useState(initial.away ?? '')
  const rules = useRules(initial.draft ?? blankDraft())
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const setup = setupStatus({ name, home, away, draft: rules.draft })
  const ok = setup.ok && !rules.errors.players && !rules.errors.price

  const submit = async (e) => {
    e.preventDefault()
    if (busy || !ok) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit({ name, home, away, draft: rules.draft })
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }
  const fieldError = (field) => setup.errors[field] && <span className="ol-hint is-error">{errorText({ code: setup.errors[field] })}</span>

  return (
    <OnlineScreen onBack={onBack} compact className="ol-new">
      <form className="ol-newgame" onSubmit={submit} noValidate>
        <h1 className="ol-title">Nieuw spel</h1>
        <label className="ol-field" htmlFor="ol-name">
          <span className="ol-label">Jouw naam</span>
          <NameInput value={name} onChange={setName} />
          {fieldError('name')}
        </label>
        <label className="ol-field" htmlFor="ol-home">
          <span className="ol-label">Thuisploeg</span>
          <ClubInput id="ol-home" value={home} onChange={setHome} />
          {fieldError('home')}
        </label>
        <label className="ol-field" htmlFor="ol-away">
          <span className="ol-label">Uitploeg</span>
          <ClubInput id="ol-away" value={away} onChange={setAway} />
          {fieldError('away')}
        </label>
        <RulesFields rules={rules} missingNote={missingText(setup.missing)} />
        {error && <p className="ol-hint is-error ol-center">{error}</p>}
        <button type="submit" className="gold-btn ol-btn-wide" disabled={!ok || busy}>
          {busy ? 'Even geduld…' : 'Spel aanmaken'}
        </button>
      </form>
    </OnlineScreen>
  )
}

// Meedoen (via code of uitnodigingslink): alleen de wedstrijdnaam, het
// naamveld en de knop. Een naam die al in gebruik is wordt geweigerd.
export function JoinScreen({ matchName, onSubmit, onBack }) {
  const [name, setName] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    if (!name.trim()) return setError('Vul je naam in.')
    setBusy(true)
    setError(null)
    try {
      await onSubmit(name)
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <OnlineScreen onBack={onBack}>
      <form className="ol-form" onSubmit={submit}>
        <h1 className="ol-title">{matchName}</h1>
        <div className="ol-field">
          <NameInput value={name} onChange={setName} autoFocus placeholder="Jouw naam" ariaLabel="Jouw naam" />
          {error && <span className="ol-hint is-error">{error}</span>}
        </div>
        <button type="submit" className="gold-btn ol-btn-wide" disabled={busy}>
          {busy ? 'Even geduld…' : 'Meedoen'}
        </button>
      </form>
    </OnlineScreen>
  )
}

// Meedoen met kamercode (stap 1); daarna volgt de naam.
export function CodeScreen({ onSubmit, onBack, initialCode = '' }) {
  const [code, setCode] = useState(normalizeCode(initialCode))
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    if (!isValidCode(code)) return setError('Een kamercode heeft 6 tekens (letters en cijfers).')
    setBusy(true)
    setError(null)
    try {
      await onSubmit(code)
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <OnlineScreen onBack={onBack}>
      <form className="ol-form" onSubmit={submit}>
        <label className="ol-field" htmlFor="ol-code">
          <span className="ol-intro">Vul de kamercode in die je van de organisator kreeg.</span>
          <input
            id="ol-code"
            className="ol-input ol-input-code"
            value={code}
            onChange={(e) => setCode(normalizeCode(e.target.value))}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck="false"
            enterKeyHint="go"
            placeholder="ABC123"
            autoFocus
          />
          {error && <span className="ol-hint is-error">{error}</span>}
        </label>
        <button type="submit" className="gold-btn ol-btn-wide" disabled={busy}>
          {busy ? 'Even geduld…' : 'Verder'}
        </button>
      </form>
    </OnlineScreen>
  )
}

// Foutmeldingen die een eigen scherm krijgen.
const NOTICES = {
  room_not_found: { title: 'Kamer niet gevonden', text: 'Deze kamer bestaat niet (meer). Controleer de code of vraag de organisator om een nieuwe uitnodiging.' },
  registration_closed: { title: 'Spel is al begonnen', text: 'Na de start kan niemand meer aansluiten. Ben je vergeten? Dan moet de organisator een nieuw spel maken.' },
  room_full: { title: 'Spel is vol', text: 'Alle plaatsen in dit spel zijn bezet.' },
  removed: { title: 'Je bent verwijderd', text: 'De organisator heeft je uit de wachtkamer gehaald. Zolang het spel nog niet is begonnen, kun je je opnieuw aanmelden.' },
  not_available: { title: 'Nog niet beschikbaar', text: 'Online spelen is nog niet beschikbaar.' },
}

export function Notice({ kind, matchName, onHome, onRejoin }) {
  const n = NOTICES[kind] ?? { title: 'Er ging iets mis', text: errorText({ code: kind }) }
  return (
    <OnlineScreen>
      <div className="ol-form ol-notice">
        <h1 className="ol-title">{n.title}</h1>
        {matchName && <p className="ol-intro">{matchName}</p>}
        <Status kind="bad">{n.text}</Status>
        {onRejoin && (
          <button type="button" className="gold-btn ol-btn-wide" onClick={onRejoin}>
            Opnieuw aanmelden
          </button>
        )}
        <button type="button" className={onRejoin ? 'ol-big-btn' : 'gold-btn ol-btn-wide'} onClick={onHome}>
          Naar beginscherm
        </button>
      </div>
    </OnlineScreen>
  )
}
