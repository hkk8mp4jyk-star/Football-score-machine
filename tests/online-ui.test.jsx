// F7: multiplayer-schermen, gerenderd naar HTML (zonder browser).
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CodeScreen, Home, JoinScreen, NewGame, Notice } from '../src/online/screens/EntryScreens.jsx'
import { AddPlayerSheet, LobbyOrganizer, LobbyParticipant, RemoveConfirm, inviteText } from '../src/online/screens/Lobby.jsx'
import { SettingsSheet } from '../src/online/screens/SettingsSheet.jsx'
import { PlayerList, moveSlot } from '../src/online/screens/PlayerList.jsx'
import { OnlineGame } from '../src/online/screens/OnlineGame.jsx'
import { deriveView } from '../src/game/view.js'
import { advancePhase, confirmAuction, introTimeline, spinTurn, startPlay } from '../src/lobby/playRules.js'
import { isDemoUrl } from '../src/App.jsx'
import { addManualPlayer, blankDraft, createRoom, joinRoom, removePlayer, roomView, setOrder, startGame, updateSettings } from '../src/lobby/lobbyRules.js'
import { MEGA_WIN_IDS, RESULTS } from '../src/game/config.js'

const noop = () => {}
const html = (el) => renderToStaticMarkup(el)
const count = (s, re) => (s.match(re) ?? []).length
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
const STANDARD = RESULTS.map((r) => r.id)
const NAMES = ['Sanne', 'Bas', 'Marieke', 'Dennis', 'Frank', 'Esther', 'Patrick', 'Jeroen', 'Noor', 'Ahmed', 'Ruud']
const CLUBS = { home: 'Werder Bremen II', away: 'Bremer SV' }
const VALID = { maxPlayers: 9, rounds: 2, priceCents: 1000, pool: STANDARD, mega: MEGA_WIN_IDS }
// Kamer met n aangemelde spelers; standaard ingesteld op 12 deelnemers.
function room(n, draft) {
  let r = createRoom({ id: 'r', code: 'K7QM2P', userId: 'org', name: 'Lars', ...CLUBS, draft: { ...VALID, maxPlayers: 12 } })
  for (let i = 1; i < n; i++) r = joinRoom(r, { userId: `u${i}`, name: NAMES[i - 1] }).room
  if (draft) r = updateSettings(r, { userId: 'org', draft: { maxPlayers: 12, ...draft } })
  return r
}
const actions = { updateSettings: noop, setOrder: noop, shuffleOrder: noop, removePlayer: noop, startGame: noop }
const orgLobby = (r, props = {}) => html(<LobbyOrganizer room={roomView(r, 'org')} actions={actions} onShare={noop} onCopy={noop} onHome={noop} notify={noop} {...props} />)
const newGame = (initial) => html(<NewGame onSubmit={noop} onBack={noop} initial={initial} />)
const FILLED = { name: 'Lars', ...CLUBS, draft: VALID }

describe('router', () => {
  it('DEMO alleen via ?demo', () => {
    expect(isDemoUrl('?demo')).toBe(true)
    expect(isDemoUrl('?demo=1')).toBe(true)
    expect(isDemoUrl('?kamer=K7QM2P&demo')).toBe(true)
    expect(isDemoUrl('')).toBe(false)
    expect(isDemoUrl('?kamer=K7QM2P')).toBe(false)
    expect(isDemoUrl('?demonstratie')).toBe(false)
  })
})

describe('beginscherm', () => {
  it('Nieuw spel en Meedoen, rechtsboven een klein rond icoon Geschiedenis; geen DEMO of kleine teksten', () => {
    const s = html(<Home onNew={noop} onJoin={noop} onResume={noop} onHistory={noop} />)
    expect(text(s).trim()).toBe('Football Score Machine Nieuw spel Meedoen')
    // icoon in de kop (niet als grote knop tussen de knoppen), met toegankelijke naam
    expect(s).toMatch(/<header[^>]*>[\s\S]*<div class="ol-top-action"><button type="button" class="ol-icon-btn ol-history-btn"[^>]*aria-label="Geschiedenis"[^>]*><svg[\s\S]*<\/svg><\/button><\/div><\/header>/)
    expect(count(s, /ol-big-btn[^"]*"[^>]*>Geschiedenis/g)).toBe(0)
  })
  it('lopend spel: wedstrijdnaam direct op de gouden knop, geen aparte titel', () => {
    const s = html(<Home resume={{ matchName: 'Werder Bremen II – Bremer SV', phase: 'lobby' }} onNew={noop} onJoin={noop} onResume={noop} />)
    expect(text(s).trim()).toBe('Football Score Machine Werder Bremen II – Bremer SV Nieuw spel Meedoen')
    expect(s).toMatch(/<button type="button" class="gold-btn ol-btn-wide ol-resume-btn"[^>]*>Werder Bremen II – Bremer SV<\/button>/)
    expect(s).not.toMatch(/<button type="button" class="gold-btn[^"]*"[^>]*>Nieuw spel/) // Nieuw spel dan niet goud
  })
})

describe('nieuw spel (één formulier)', () => {
  it('leeg: alle velden leeg, niets gekozen behalve OVERIG, knop uit', () => {
    const s = newGame()
    for (const id of ['ol-name', 'ol-home', 'ol-away', 'ol-players', 'ol-price']) expect(s).toMatch(new RegExp(`id="${id}"[^>]*value=""`))
    // geen voorbeelden of placeholders in naam en clubs
    for (const id of ['ol-name', 'ol-home', 'ol-away']) expect(s).not.toMatch(new RegExp(`<input[^>]*id="${id}"[^>]*placeholder=`))
    expect(s).not.toMatch(/Bijv\./)
    expect(s).toContain('maxLength="20"')
    expect(s).toContain('maxLength="30"')
    expect(count(s, /aria-checked="true"/g)).toBe(0)
    expect(count(s, /ol-cell is-on/g)).toBe(0)
    expect(count(s, /ol-cell is-off/g)).toBe(49)
    expect(text(s)).toContain('Overige uitslagen · doet altijd mee')
    expect(text(s)).toContain('Uitslagen · 1')
    expect(text(s)).toContain('MEGA WIN ★ · 0')
    expect(text(s)).toContain('Nog invullen: jouw naam, thuisploeg, uitploeg, aantal deelnemers, prijs en vaste rondes.')
    expect(count(s, /<b>–<\/b>/g)).toBe(2) // aantallen altijd zichtbaar
    expect(text(s)).toMatch(/Vaste trekkingen .* Veilinguitslagen/)
    expect(s).toMatch(/<button type="submit"[^>]*disabled=""[^>]*>Spel aanmaken/)
  })
  it('deelnemers en prijs staan samen op één regel', () => {
    const s = newGame()
    const pair = s.slice(s.indexOf('<div class="ol-pair">'), s.indexOf('ol-set-row'))
    expect(pair).toContain('id="ol-players"')
    expect(pair).toContain('id="ol-price"')
    expect(pair).toContain('<span>€</span>')
    expect(text(pair)).toContain('Aantal deelnemers')
    expect(text(pair)).toContain('Prijs per vaste trekking')
  })
  it('ingevuld en geldig: aantallen, melding, knop aan', () => {
    const s = newGame(FILLED)
    expect(text(s)).toMatch(/18 Vaste trekkingen 8 Veilinguitslagen/)
    expect(text(s)).toContain('Alles klopt: 18 vaste trekkingen en 8 veilinguitslagen.')
    expect(s).toMatch(/<button type="submit" class="gold-btn ol-btn-wide">Spel aanmaken/)
    expect(count(s, /ol-cell is-on/g)).toBe(25)
  })
  it('geldig met 0 veilinguitslagen', () => {
    const s = newGame({ ...FILLED, draft: { ...VALID, maxPlayers: 12, pool: STANDARD.slice(0, 23).concat('OVERIG'), mega: [] } })
    expect(text(s)).toMatch(/24 Vaste trekkingen 0 Veilinguitslagen/)
    expect(text(s)).toContain('Alles klopt: 24 vaste trekkingen en geen veiling.')
  })
  it('te weinig en te veel: aantallen blijven zichtbaar, knop uit', () => {
    const few = newGame({ ...FILLED, draft: { ...VALID, rounds: 3 } })
    expect(text(few)).toMatch(/27 Vaste trekkingen -1 Veilinguitslagen/)
    expect(text(few)).toContain('Selecteer nog 1 uitslag om alle vaste trekkingen mogelijk te maken.')
    expect(few).toMatch(/disabled=""[^>]*>Spel aanmaken/)
    const many = newGame({ ...FILLED, draft: { ...VALID, maxPlayers: 4 } })
    expect(text(many)).toMatch(/8 Vaste trekkingen 18 Veilinguitslagen/)
    expect(text(many)).toContain('Verwijder 8 uitslagen om maximaal 10 veilinguitslagen over te houden.')
    expect(many).toContain('ol-count-tile is-bad')
  })
  it('tabblad MEGA WIN: alleen de gekozen gewone uitslagen, nooit OVERIG; MEGA groen, rest goud', () => {
    const s = html(<SettingsSheet draft={{ ...VALID, pool: ['0-0', '1-1', '3-2', 'OVERIG'], mega: ['1-1'] }} onSave={noop} onClose={noop} initialTab="mega" />)
    expect(count(s, /class="ol-cell/g)).toBe(3)
    expect(text(s)).toMatch(/0-0 .*1-1 .*3-2/)
    expect(count(s, /ol-cell is-on is-mega/g)).toBe(1)
    expect(count(s, /class="ol-cell is-on"/g)).toBe(2)
    expect(s).not.toContain('Overige uitslagen')
    const empty = html(<SettingsSheet draft={{ ...VALID, pool: ['OVERIG'], mega: [] }} onSave={noop} onClose={noop} initialTab="mega" />)
    expect(text(empty)).toContain('Kies eerst uitslagen op het tabblad Uitslagen.')
    // ook op het eerste tabblad zijn MEGA-uitslagen groen
    const pool = html(<SettingsSheet draft={{ ...VALID, pool: ['0-0', '1-1', 'OVERIG'], mega: ['1-1'] }} onSave={noop} onClose={noop} />)
    expect(count(pool, /ol-cell is-on is-mega/g)).toBe(1)
    expect(count(pool, /class="ol-cell is-off"/g)).toBe(47)
  })
  it('meldingen: leeg en onvolledig neutraal, alleen echt ongeldig rood', () => {
    expect(newGame()).toMatch(/ol-status is-wait/)
    expect(newGame()).not.toMatch(/ol-status is-bad/)
    const few = newGame({ ...FILLED, draft: { ...VALID, rounds: 3 } })
    expect(few).toMatch(/ol-status is-wait/)
    expect(few).not.toContain('ol-count-tile is-bad')
    const many = newGame({ ...FILLED, draft: { ...VALID, maxPlayers: 4 } })
    expect(many).toMatch(/ol-status is-bad/)
  })
})

describe('meedoen', () => {
  it('kamercode: tekst boven het veld, geen kop of label', () => {
    const s = html(<CodeScreen onSubmit={noop} onBack={noop} initialCode="k7q-m2p" />)
    expect(s).toContain('value="K7QM2P"')
    expect(text(s)).toContain('Vul de kamercode in die je van de organisator kreeg.')
    expect(s).not.toMatch(/ol-title|>Kamercode<|>Meedoen</)
    expect(s.indexOf('Vul de kamercode')).toBeLessThan(s.indexOf('id="ol-code"'))
    expect(text(s)).toMatch(/Verder\s*$/)
  })
  it('via link: alleen wedstrijdnaam, naamveld en Meedoen', () => {
    const s = html(<JoinScreen matchName="Werder Bremen II – Bremer SV" onSubmit={noop} onBack={noop} />)
    expect(text(s).trim()).toBe('‹ Terug Football Score Machine Werder Bremen II – Bremer SV Meedoen')
    expect(s).toContain('placeholder="Jouw naam"')
    expect(s).not.toContain('K7QM2P')
  })
  it('foutmeldingen als scherm', () => {
    for (const [kind, title] of [
      ['room_not_found', 'Kamer niet gevonden'],
      ['registration_closed', 'Spel is al begonnen'],
      ['room_full', 'Spel is vol'],
      ['removed', 'Je bent verwijderd'],
      ['not_available', 'Nog niet beschikbaar'],
    ]) {
      expect(html(<Notice kind={kind} onHome={noop} />)).toContain(title)
    }
    expect(text(html(<Notice kind="room_full" matchName="A – B" onHome={noop} />))).toContain('A – B')
    const removed = html(<Notice kind="removed" onHome={noop} onRejoin={noop} />)
    expect(removed).toContain('Opnieuw aanmelden')
    expect(html(<Notice kind="registration_closed" onHome={noop} />)).not.toContain('Opnieuw aanmelden')
  })
})

describe('wachtkamer organisator', () => {
  it('wedstrijdnaam, kamercode, twee knoppen, x van y deelnemers; geen helperteksten', () => {
    const s = orgLobby(room(6, VALID))
    expect(s).toMatch(/<h1 class="ol-title ol-match">Werder Bremen II – Bremer SV<\/h1>/)
    expect(s).toContain('K7QM2P')
    expect(s).toContain('Deel uitnodiging')
    expect(s).toContain('Kopieer link')
    expect(s).not.toMatch(/WhatsApp|QR|Sleep|Starten kan|kloppen de spelregels/i)
    expect(text(s)).toContain('6 van 9 deelnemers')
    expect(s).not.toContain('Alles klopt') // geen overbodige melding als het klopt
    expect(s).toContain('Loot volgorde')
    expect(s).toContain('Start het spel')
  })
  it('start alleen bij precies het ingestelde aantal deelnemers', () => {
    expect(orgLobby(room(9, VALID))).toMatch(/<button type="button" class="gold-btn ol-btn-wide">Start het spel/)
    expect(orgLobby(room(8, VALID))).toMatch(/<button type="button" class="gold-btn ol-btn-wide" disabled="">Start het spel/)
    expect(orgLobby(room(2, VALID))).toMatch(/disabled="">Start het spel/)
    expect(orgLobby(room(9, { ...VALID, priceCents: null }))).toMatch(/disabled="">Start het spel/)
  })
  it('deelnemers: slepen, ▲▼ en ✕ (ook bij de organisator zelf)', () => {
    const s = orgLobby(room(4, VALID))
    expect(count(s, /class="ol-handle"/g)).toBe(4)
    expect(count(s, /omhoog"/g)).toBe(4)
    expect(count(s, /omlaag"/g)).toBe(4)
    expect(count(s, /ol-icon-remove/g)).toBe(4)
    expect(s).toContain('Lars verwijderen')
    expect(s).toMatch(/disabled=""[^>]*aria-label="Lars omhoog"/)
  })
  it('deelnemer toevoegen, zelf meedoen, Testspeler alleen in de testomgeving', () => {
    const s = orgLobby(room(2))
    expect(s).toContain('＋ Deelnemer')
    expect(s).not.toContain('Zelf meedoen') // speelt al mee
    expect(s).not.toContain('Testspeler')
    expect(s).not.toContain('Nep-speler')
    expect(orgLobby(room(2), { actions: { ...actions, addFakePlayer: noop } })).toMatch(/class="ghost-btn ol-mock-btn">＋ Testspeler/)
    expect(orgLobby(room(9, VALID), { actions: { ...actions, addFakePlayer: noop } })).toMatch(/disabled="">＋ Testspeler/)
    const self = removePlayer(room(3, VALID), { userId: 'org', slot: 0 })
    const v = orgLobby(self)
    expect(v).toContain('＋ Zelf meedoen')
    expect(text(v)).not.toContain('Lars')
    const man = addManualPlayer(room(2, VALID), { userId: 'org', name: 'Opa' }).room
    expect(text(orgLobby(man))).toMatch(/Opa Zonder telefoon/)
  })
  it('na verwijderen zakt de nummering op', () => {
    const r = removePlayer(room(4), { userId: 'org', slot: 1 })
    const s = orgLobby(r)
    expect(text(s)).not.toContain('Sanne')
    expect(text(s)).toMatch(/2 Bas .* 3 Marieke/)
  })
  it('uitnodiging bevat wedstrijd, organisator en kamercode', () => {
    expect(inviteText('Werder Bremen II – Bremer SV', 'Lars', 'K7QM2P')).toBe(
      'Doe mee met Werder Bremen II – Bremer SV, het spel van Lars in Football Score Machine. Kamercode: K7QM2P',
    )
  })
  it('spelregels wijzigen: opgeslagen waarden, inclusief aantal deelnemers, geen clubnamen', () => {
    const s = html(<SettingsSheet draft={room(9, VALID).draft} onSave={noop} onClose={noop} />)
    expect(s).toMatch(/id="ol-players"[^>]*value="9"/)
    expect(s).toMatch(/aria-checked="true" class="is-on">2</)
    expect(s).toMatch(/id="ol-price"[^>]*value="10"/)
    expect(count(s, /class="ol-cell is-on/g)).toBe(25)
    expect(count(s, /is-mega/g)).toBe(8)
    expect(text(s)).toContain('Alles klopt')
    expect(s).not.toMatch(/ol-home|ol-away|Thuisploeg/)
  })
  it('blanco spelregels (B2) in het formulier', () => {
    const s = html(<SettingsSheet draft={blankDraft()} onSave={noop} onClose={noop} />)
    expect(count(s, /class="is-on"/g)).toBe(0)
    expect(s).toMatch(/id="ol-price"[^>]*value=""/)
    expect(count(s, /is-mega/g)).toBe(0)
    expect(text(s)).toContain('Vul het aantal deelnemers in.')
  })
})

describe('wachtkamer deelnemer', () => {
  it('wedstrijdnaam, namen zonder nummers of labels, drie rollen en WARMING UP', () => {
    let r = room(5, VALID)
    r = setOrder(r, { userId: 'org', order: [4, 3, 2, 1, 0] })
    const s = html(<LobbyParticipant room={roomView(r, 'u2')} onHome={noop} fixedTime={1234} />)
    expect(text(s)).toContain('Werder Bremen II – Bremer SV')
    expect(s).toMatch(/<ul class="ol-names" style="--rows:5"><li>Lars<\/li><li>Sanne<\/li><li>Bas<\/li><li>Marieke<\/li><li>Dennis<\/li><\/ul>/) // aanmeldvolgorde, één kolom
    // namen direct gevolgd door de rollen en WARMING UP, in één gecentreerd blok
    expect(s).toMatch(/<div class="ol-guest"><h1[^]*<ul class="ol-names"[^]*<\/ul><div class="warming">/)
    expect(count(s, /class="mini-reel(?: |")/g)).toBe(3)
    expect(text(s)).toContain('WARMING UP')
    expect(s).not.toMatch(/Jij|Organisator|ol-num|ol-rule|ol-grid|MEGA|€|rondes|Wijzig|ol-handle|verwijderen|Start het spel|Loot/i)
  })
})

describe('wachtkamer deelnemer: 7–12 namen in twee kolommen', () => {
  it('12 deelnemers: 2 kolommen van 6; 7: 4 + 3', () => {
    const r12 = room(12, { ...VALID, maxPlayers: 12 })
    const s12 = html(<LobbyParticipant room={roomView(r12, 'u3')} onHome={noop} fixedTime={0} />)
    expect(s12).toContain('<ul class="ol-names is-two" style="--rows:6">')
    expect(count(s12, /<li>/g)).toBe(12)
    const s7 = html(<LobbyParticipant room={roomView(room(7, VALID), 'u3')} onHome={noop} fixedTime={0} />)
    expect(s7).toContain('<ul class="ol-names is-two" style="--rows:4">')
    const s6 = html(<LobbyParticipant room={roomView(room(6, VALID), 'u3')} onHome={noop} fixedTime={0} />)
    expect(s6).toContain('<ul class="ol-names" style="--rows:6">')
  })
})

describe('bevestigen', () => {
  it('verwijderen bevestigen: deelnemer, zonder telefoon, jezelf', () => {
    const t = text(html(<RemoveConfirm player={{ name: 'Bas', slot: 2 }} onConfirm={noop} onCancel={noop} />))
    expect(t).toContain('Bas verwijderen?')
    expect(t).toContain('opnieuw aanmelden')
    expect(text(html(<RemoveConfirm player={{ name: 'Lars', slot: 0, isMe: true, isOrganizer: true }} onConfirm={noop} onCancel={noop} />))).toContain('Je blijft organisator')
    expect(text(html(<RemoveConfirm player={{ name: 'Opa', slot: 3, manual: true }} onConfirm={noop} onCancel={noop} />))).toContain('Opa verwijderen?')
  })
  it('deelnemer zonder telefoon toevoegen', () => {
    const t = text(html(<AddPlayerSheet onAdd={noop} onClose={noop} />))
    expect(t).toContain('Deelnemer zonder telefoon')
    expect(t).toContain('Toevoegen')
  })
})

const settleId = (r, t) => deriveView(r.state, t, {}).reveal?.id
const game = (r, user, now, props = {}) => html(<OnlineGame room={roomView(r, user)} actions={{}} onHome={noop} notify={noop} now={now} {...props} />)

describe('gestart spel', () => {
  const waiting = (draft = { rounds: 1, priceCents: 500, pool: ['0-0', '1-1', '2-2', 'OVERIG'], mega: [], maxPlayers: 3 }) =>
    startGame(room(3, draft), { userId: 'org', now: 1_000_000 })
  // Organisator heeft op het Las Vegas-scherm "START SPEL" gedrukt.
  const started = (draft) => startPlay(waiting(draft), { userId: 'org', now: 1_000_000 + introTimeline(3).vegasAt + 100 })
  it('startanimatie: BONUS TRIGGER → BONUSSPEL! → namen → Las Vegas-bord met samenvatting', () => {
    const r = started()
    const tl = introTimeline(3)
    const a = game(r, 'u1', 1_000_000 + 500)
    expect(a).toContain('intro-bonus')
    expect(text(a)).toContain('WARMING UP')
    const b = game(r, 'u1', 1_000_000 + tl.bonusAt + 10)
    expect(b).toContain('aria-label="BONUSSPEL!"')
    expect(count(b, /mini-reel is-landed/g)).toBe(3)
    const n = game(r, 'u1', 1_000_000 + tl.orderAt + 10)
    expect(text(n)).toMatch(/1 Lars 2 Sanne 3 Bas/)
    expect(count(n, /names-row is-landed/g)).toBe(3)
    const v = game(r, 'u1', 1_000_000 + tl.vegasAt + 10)
    expect(v).toContain('aria-label="Welcome to Fabulous Las Vegas Nevada"')
    expect(text(v)).toMatch(/Werder Bremen II – Bremer SV/)
    expect(text(v)).toMatch(/Deelnemers 3 Vaste trekkingen per deelnemer 1 Prijs per vaste trekking €5 Veilinguitslagen 1/)
  })
  it('Las Vegas-scherm blijft staan; alleen de organisator ziet START SPEL; daarna tegelijk naar de machine', () => {
    const w = waiting()
    const late = 1_000_000 + introTimeline(3).endAt + 3_600_000 // ook een uur later
    const org = game(w, 'org', late)
    const sanne = game(w, 'u1', late)
    expect(org).toContain('aria-label="Welcome to Fabulous Las Vegas Nevada"')
    expect(sanne).toContain('aria-label="Welcome to Fabulous Las Vegas Nevada"')
    expect(org).toMatch(/<button[^>]*class="gold-btn ol-btn-wide ol-play-btn"[^>]*>START SPEL</)
    expect(sanne).not.toContain('START SPEL')
    expect(text(sanne)).toMatch(/1 Lars 2 Sanne 3 Bas/) // definitieve volgorde blijft zichtbaar
    const r = started()
    expect(game(r, 'u1', r.playAt - 1)).toContain('aria-label="Welcome to Fabulous Las Vegas Nevada"')
    expect(game(r, 'org', r.playAt - 1)).not.toContain('START SPEL') // al gedrukt: geen tweede keer
    expect(game(r, 'u1', r.playAt)).toContain('spin-btn') // iedereen op hetzelfde moment door
    expect(game(r, 'org', r.playAt)).toContain('spin-btn')
  })
  it('scoremachine: SPIN alleen voor wie aan de beurt is; clubnamen op de rollen', () => {
    const r = started()
    const after = r.playAt
    const lars = game(r, 'org', after) // Lars is aan de beurt
    expect(lars).toMatch(/class="gold-btn spin-btn "/)
    expect(text(lars)).toContain('Werder Bremen II')
    expect(text(lars)).toContain('Bremer SV')
    const sanne = game(r, 'u1', after) // toeschouwer
    expect(sanne).toMatch(/gold-btn spin-btn is-hidden/)
    expect(sanne).not.toContain('Draai namens')
  })
  it('organisator: "Draai namens …" alleen bij een beurt van een ander', () => {
    let r = started()
    const t0 = r.playAt
    r = spinTurn(r, { userId: 'org', now: t0 }).room
    const t1 = r.state.spin.startedAt + 9000
    const org = game(r, 'org', t1)
    expect(org).toMatch(/ghost-btn ol-onbehalf[^>]*>Draai namens Sanne</)
    expect(game(r, 'u1', t1)).toMatch(/class="gold-btn spin-btn "/) // Sanne zelf: actieve SPIN
    expect(game(r, 'u1', t1)).not.toContain('Draai namens')
  })
  it('veiling: aankondiging na Bevestig veiling, winnaar en bod boven de machine', () => {
    let r = started({ rounds: 1, priceCents: 500, pool: ['0-0', '1-1', '2-2', '3-3', 'OVERIG'], mega: [], maxPlayers: 3 })
    let t = r.playAt
    for (const [u, ob] of [
      ['org', false],
      ['u1', false],
      ['org', true],
    ]) {
      r = spinTurn(r, { userId: u, onBehalf: ob, now: t }).room
      t = r.state.spin.startedAt + 9000
    }
    expect(game(r, 'u1', t)).toMatch(/gold-btn gold-btn-next is-hidden/) // deelnemer: geen knop "Start de veiling"
    expect(game(r, 'org', t)).toMatch(/class="gold-btn gold-btn-next ">Start de veiling/) // organisator wel
    r = advancePhase(r, { userId: 'org', step: 'auction', now: t })
    r = confirmAuction(r, { userId: 'org', participant: 1, bidCents: 3500, now: t })
    const seen = {}
    const during = game(r, 'u2', t + 500, seen)
    expect(text(during)).toMatch(/Winnaar veiling #1 Sanne €35,00/)
    expect(text(during)).not.toMatch(/Winnend|Volgende veilingtrekking/)
    const after = game(r, 'u1', t + 3000, seen)
    expect(after).not.toContain('announce-card')
    expect(text(after)).toMatch(/Sanne Draait voor €35,00/)
    expect(after).toMatch(/class="gold-btn spin-btn spin-btn-compact "/) // winnaar: actieve SPIN
    expect(game(r, 'u2', t + 3000, seen)).toMatch(/spin-btn-compact is-hidden/) // ander: niet
  })
})

describe('volgorde verplaatsen', () => {
  it('moveSlot', () => {
    expect(moveSlot([0, 1, 2, 3], 3, 0)).toEqual([3, 0, 1, 2])
    expect(moveSlot([0, 1, 2, 3], 0, 2)).toEqual([1, 2, 0, 3])
    expect(moveSlot([0, 1, 2, 3], 0, -1)).toEqual([0, 1, 2, 3])
    expect(moveSlot([0, 1, 2, 3], 3, 4)).toEqual([0, 1, 2, 3])
  })
  it('alleen-lezen lijst zonder bediening', () => {
    const s = html(<PlayerList players={[{ slot: 0, name: 'Lars', isOrganizer: true, isMe: false }]} />)
    expect(s).not.toMatch(/ol-handle|ol-icon/)
    expect(s).toContain('Organisator')
  })
})

describe('eindstand: definitieve spelersvolgorde (regressie)', () => {
  it('per deelnemer in de bij de start vastgelegde volgorde, niet alfabetisch/aanmelding/uitslagen/bedragen', () => {
    // aanmelden: Lars, Sanne, Bas, Marieke; startvolgorde: Marieke, Lars, Bas, Sanne
    let r = createRoom({ id: 'r', code: 'K7QM2P', userId: 'org', name: 'Lars', ...CLUBS, draft: { maxPlayers: 4, rounds: 1, priceCents: 1000, pool: ['0-0', '1-0', '1-1', '2-0', '2-2', 'OVERIG'], mega: [] } })
    for (const [u, n] of [['u1', 'Sanne'], ['u2', 'Bas'], ['u3', 'Marieke']]) r = joinRoom(r, { userId: u, name: n }).room
    r = setOrder(r, { userId: 'org', order: [3, 0, 2, 1] })
    r = startGame(r, { userId: 'org', now: 1_000_000 })
    r = startPlay(r, { userId: 'org', now: 1_000_000 + introTimeline(4).vegasAt })
    let t = r.playAt
    const rel = () => r.state.spin.startedAt + 9000
    for (const u of ['u3', 'org', 'u2', 'u1']) {
      r = spinTurn(r, { userId: u, now: t }).room
      t = rel()
    }
    r = advancePhase(r, { userId: 'org', step: 'auction', now: t })
    // twee veilingen voor Bas (hoogste bedrag), zodat bedragen een andere volgorde zouden geven
    for (const bid of [5000, 4000]) {
      r = confirmAuction(r, { userId: 'org', participant: 2, bidCents: bid, now: t })
      r = spinTurn(r, { userId: 'u2', now: t + 10 }).room
      t = rel()
    }
    r = advancePhase(r, { userId: 'org', step: 'final', now: t })
    const s = game(r, 'u1', t + 10)
    expect(s).toContain('screen-finished')
    const names = [...s.matchAll(/class="person-name">([^<]+)</g)].map((m) => m[1])
    expect(names).toEqual(['Marieke', 'Lars', 'Bas', 'Sanne'])
    expect(names).not.toEqual([...names].sort()) // niet alfabetisch
    expect(r.state.config.players.map((p) => p.name)).toEqual(names)
  })
})
