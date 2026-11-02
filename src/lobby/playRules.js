// Regels tijdens het online spel: wie mag SPIN drukken, "draai namens",
// "Bevestig veiling" en de tijdlijn van de gezamenlijke startanimatie.
//
// Puur en zonder opslag of netwerk, zoals lobbyRules.js: de nagebootste
// server (mock) en straks de echte server (Edge Function) gebruiken dezelfde
// regels. De uitslag kiest altijd de server (engine SPIN_START met
// cryptografische willekeur); de telefoon stuurt alleen "ik druk op SPIN".

import { MAX_PRICE_CENTS } from '../game/config.js'
import { createReducer, isTurnReleased, settle } from '../game/engine.js'
import { configOf, turnOrder } from '../game/gameConfig.js'
import { deriveView } from '../game/view.js'
import { secureId, secureRandomInt } from '../game/random.js'
import { LobbyError, isOrganizer } from './lobbyRules.js'

const bump = (room, changes) => ({ ...room, ...changes, version: room.version + 1 })

// ---------------------------------------------------------------------------
// Startanimatie: tijden in ms vanaf `room.startedAt` (servertijd). Elke
// telefoon rekent dezelfde fase uit de tijd; wie later binnenkomt, valt
// midden in de animatie in of ziet direct de scoremachine (geen herhaling).
//   A  BONUS TRIGGER: drie rollen versnellen, stoppen één voor één op een munt;
//      daarna BONUSSPEL! met opbouw en fanfare (~6 s in totaal)
//   B  NAMEN: alle namen draaien, vertragen en vallen één voor één op hun plek
//   C  WELCOME TO FABULOUS LAS VEGAS: bord + spelsamenvatting. In spellen met
//      `awaitPlay` (vanaf game v3) blijft dit staan tot de organisator op
//      "START SPEL" drukt (gedeelde wachtfase, `room.playAt`); oudere
//      spellen: na `vegasLength` automatisch de scoremachine.
// ---------------------------------------------------------------------------
export const INTRO = {
  coinStops: [1500, 2100, 2700], // rol 1, 2, 3 op een munt
  bonusAt: 2700, // gouden flits + BONUSSPEL!
  fanfareAt: 5000, // korte feestelijke fanfare
  namesAt: 6000, // namenanimatie begint (BONUS ~6 s)
  namesSpin: 1400, // eerst allemaal op topsnelheid
  nameGap: 380, // daarna valt elke 380 ms de volgende naam
  nameDecel: 750, // vertraging per naam
  orderHold: 1700, // volledige volgorde nog even in beeld
  vegasLength: 3200, // bord + samenvatting
}

export function introTimeline(playerCount) {
  const firstStop = INTRO.namesAt + INTRO.namesSpin + INTRO.nameDecel
  const nameStops = Array.from({ length: playerCount }, (_, i) => firstStop + i * INTRO.nameGap)
  const orderAt = nameStops.at(-1) ?? firstStop
  const vegasAt = orderAt + INTRO.orderHold
  return { ...INTRO, nameStops, orderAt, vegasAt, endAt: vegasAt + INTRO.vegasLength }
}

export const introEnd = (room) => room.startedAt + introTimeline(room.state.config.players.length).endAt

// Na "START SPEL" gaan alle telefoons op hetzelfde (server)tijdstip verder,
// ook als het Realtime-signaal niet overal even snel binnenkomt.
export const PLAY_DELAY = 1500

// Vanaf wanneer mag er gedraaid worden? null = nog niet bekend (wacht op
// "START SPEL"). Oudere spellen (zonder `awaitPlay`): einde van de animatie.
export function playOpensAt(room) {
  if (room.awaitPlay) return room.playAt ?? null
  return introEnd(room)
}

// Fase van de startanimatie op tijdstip `now` (null = voorbij: scoremachine).
// `wait` = { awaitPlay, playAt } van de kamer: het Las Vegas-scherm blijft dan
// staan tot `playAt`.
export function introPhase(startedAt, playerCount, now, wait = {}) {
  const t = now - startedAt
  const tl = introTimeline(playerCount)
  if (wait.awaitPlay) {
    if (wait.playAt != null && now >= wait.playAt && t >= tl.vegasAt) return null
  } else if (t >= tl.endAt) return null
  if (t < 0) return { phase: 'bonus', t: 0, tl }
  if (t < tl.namesAt) return { phase: 'bonus', t, tl }
  if (t < tl.vegasAt) return { phase: 'names', t, tl }
  return { phase: 'vegas', t, tl, waiting: !!wait.awaitPlay }
}

// "START SPEL" (alleen organisator, eenmalig, pas op het Las Vegas-scherm):
// legt het gezamenlijke vertrekmoment vast.
export function startPlay(room, { userId, now }) {
  if (!isOrganizer(room, userId)) throw new LobbyError('not_organizer')
  if (room.phase !== 'started') throw new LobbyError('not_started')
  if (!room.awaitPlay || room.playAt != null) throw new LobbyError('nothing_to_advance')
  if (now < room.startedAt + introTimeline(room.state.config.players.length).vegasAt) throw new LobbyError('intro_running')
  return bump(room, { playAt: now + PLAY_DELAY })
}

// Veilingaankondiging ("VOLGENDE VEILINGTREKKING") op alle telefoons.
export const ANNOUNCE_MS = 2600
export const announceVisible = (announce, now) => !!announce && now >= announce.at && now < announce.at + ANNOUNCE_MS

// ---------------------------------------------------------------------------
// Wie is er nu aan de beurt (na `settle` op `now`), of waarom kan er niet
// gedraaid worden?
// ---------------------------------------------------------------------------
export function turnInfo(rawState, now) {
  const state = settle(rawState, now)
  if (state.phase === 'finished') return { state, error: 'game_finished' }
  if (state.spin) return { state, error: 'spin_in_progress' }
  if (!isTurnReleased(state, now)) return { state, error: 'turn_not_released' }
  if (state.phase === 'draw') return { state, participant: turnOrder(configOf(state))[state.turn].participant }
  if (state.auctionTurn?.participant == null) return { state, error: 'no_auction_turn' }
  return { state, participant: state.auctionTurn.participant }
}

// ---------------------------------------------------------------------------
// SPIN. Mag alleen:
//   - de deelnemer die aan de beurt is, op zijn eigen telefoon;
//   - de organisator voor een deelnemer zonder telefoon (op zijn toestel);
//   - de organisator expliciet "namens" de deelnemer (onBehalf: true).
// De engine weigert een tweede draai voor dezelfde beurt; de server legt de
// kamer met versiecontrole vast, dus gelijktijdige SPIN's (deelnemer én
// organisator) geven precies één trekking.
// ---------------------------------------------------------------------------
export function spinTurn(room, { userId, onBehalf = false, now, randomInt = secureRandomInt, newId = secureId }) {
  if (room.phase !== 'started') throw new LobbyError('not_started')
  const opens = playOpensAt(room)
  if (opens == null || now < opens) throw new LobbyError('intro_running')
  const info = turnInfo(room.state, now)
  if (info.error) throw new LobbyError(info.error)
  const player = room.players.find((p) => p.slot === info.participant)
  const own = !!player?.userId && player.userId === userId
  const org = isOrganizer(room, userId)
  if (!own && !(org && (player?.manual || onBehalf))) throw new LobbyError('not_your_turn')
  const next = createReducer({ randomInt, newId })(room.state, { type: 'SPIN_START', now })
  if (!next.spin || next.spin.startedAt !== now || next.spin.participant !== info.participant) throw new LobbyError('spin_rejected')
  const log = { spinId: next.spin.id, participant: info.participant, spunBy: userId, onBehalf: !own && !player.manual, at: now }
  return { room: bump(room, { state: next, spinLog: [...(room.spinLog ?? []), log] }), spin: next.spin }
}

// ---------------------------------------------------------------------------
// "Bevestig veiling" (alleen organisator): wijst de beurt toe aan de
// veilingwinnaar met het winnende bod. Start nog géén trekking; die begint
// pas als de winnaar (of de organisator namens hem) op SPIN drukt. Na de
// bevestiging ligt de beurt vast (geen correctie, geen tweede aankondiging).
// ---------------------------------------------------------------------------
export function confirmAuction(room, { userId, participant, bidCents, now }) {
  if (!isOrganizer(room, userId)) throw new LobbyError('not_organizer')
  if (room.phase !== 'started') throw new LobbyError('not_started')
  const state = settle(room.state, now)
  if (state.phase !== 'auction') throw new LobbyError('not_auction')
  if (state.spin) throw new LobbyError('spin_in_progress')
  if (state.auctionTurn) throw new LobbyError('auction_confirmed')
  if (nextStep(room, now) === 'auction') throw new LobbyError('auction_not_open') // eerst "Start de veiling"
  if (!isTurnReleased(state, now)) throw new LobbyError('turn_not_released')
  if (!Number.isInteger(bidCents) || bidCents < 0 || bidCents > MAX_PRICE_CENTS) throw new LobbyError('invalid_bid')
  if (!configOf(state).players.some((p) => p.id === participant)) throw new LobbyError('player_not_found')
  const next = createReducer()(state, { type: 'AUCTION_PREPARE', participant, bid: bidCents / 100, now })
  if (next.auctionTurn?.participant !== participant) throw new LobbyError('invalid_bid')
  // Volgnummer van deze veiling binnen het spel (#1, #2, …).
  const lot = state.draws.filter((d) => d.round === 'veiling').length + 1
  return bump(room, { state: next, announce: { participant, bidCents, lot, at: now } })
}

// ---------------------------------------------------------------------------
// Faseovergangen (alleen organisator, centraal en eenmalig): na de laatste
// vaste trekking "Start de veiling" (of zonder veiling "Bekijk de
// eindstand"), en na de laatste veilingtrekking "Bekijk de eindstand".
// Vastgelegd in `room.ack` (zelfde vorm als de lokale bevestiging in de
// DEMO); alle telefoons rekenen daarmee hun weergave uit (deriveView).
//   step 'auction': de onthulde laatste rondetrekking afsluiten
//   step 'final':   de onthulde laatste veilingtrekking afsluiten
// ---------------------------------------------------------------------------
export function nextStep(room, now) {
  if (room.phase !== 'started') return null
  const v = deriveView(room.state, now, room.ack ?? {})
  if (!v.reveal || v.locked || v.tileStage || v.state.spin) return null
  if (v.reveal.round !== 'veiling' && v.state.phase !== 'draw') return 'auction'
  if (v.reveal.round === 'veiling' && v.state.phase === 'finished') return 'final'
  return null
}

export function advancePhase(room, { userId, step, now }) {
  if (!isOrganizer(room, userId)) throw new LobbyError('not_organizer')
  if (room.phase !== 'started') throw new LobbyError('not_started')
  if (!step || nextStep(room, now) !== step) throw new LobbyError('nothing_to_advance')
  const reveal = deriveView(room.state, now, room.ack ?? {}).reveal
  const key = step === 'auction' ? 'auctionStart' : 'finish'
  return bump(room, { ack: { ...(room.ack ?? {}), [key]: reveal.id } })
}
