// Toegang tot de server voor de multiplayer-schermen. De schermen kennen
// alleen deze interface; daarachter zit de nagebootste server (mock, alleen
// tijdens ontwikkelen) of de echte server (Supabase, F6).
//
// Interface (alle methoden async, fouten als ApiError met vaste code):
//   isMock
//   session.get() / session.set({ roomId, code }) / session.clear()
//   createRoom({ name, home, away, draft }) → { roomId, code }   (alleen een geldig spel)
//   lookupRoom(code)              → { id, code, phase, organizerName, playerCount, full, mySlot, removed }
//   joinRoom(code, name)          → { roomId, code }
//   getRoom(roomId)               → kamerweergave (zie lobby/lobbyRules.js roomView)
//   subscribe(roomId, onChange)   → functie om af te melden
//   updateSettings(roomId, draft) / setOrder(roomId, order) / shuffleOrder(roomId)
//   removePlayer(roomId, slot) / startGame(roomId, expectedVersion)
//   addManualPlayer(roomId, name) / joinSelf(roomId)
//   spin(roomId, { onBehalf }) / confirmAuction(roomId, participant, bidCents)
//   advancePhase(roomId, 'auction' | 'final')   (alleen organisator)
//   now()                         → servertijd (gedeelde klok)
//
// De mock komt nooit in de productieversie: hij wordt alleen geladen als
// `import.meta.env.DEV` (npm run dev) of VITE_USE_MOCK=1 (testbuild) waar is;
// in `npm run build` valt die tak weg (zie de controle in CLAUDE.md).

export class ApiError extends Error {
  constructor(code, detail) {
    super(code)
    this.code = code
    this.detail = detail
  }
}

// Mock: in `npm run dev` (tenzij VITE_USE_MOCK=0, dan de echte server) of in
// een testbuild met VITE_USE_MOCK=1. In `npm run build` nooit.
export const USE_MOCK = import.meta.env.VITE_USE_MOCK === '1' || (import.meta.env.DEV && import.meta.env.VITE_USE_MOCK !== '0')

let apiPromise = null
export function getApi() {
  if (!apiPromise) {
    apiPromise = USE_MOCK
      ? import('./mock/mockApi.js').then((m) => m.createMockApi())
      : import('./realApi.js').then((m) => m.createRealApi())
  }
  return apiPromise
}

// Kamercode: 6 tekens, zonder I, O, 0 en 1 (zelfde regel als de database).
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const normalizeCode = (text) => String(text ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
export const isValidCode = (code) => /^[A-HJ-NP-Z2-9]{6}$/.test(code)

// Meldingen in gewone taal.
export const ERROR_TEXT = {
  room_not_found: 'Deze kamer bestaat niet. Controleer de code.',
  registration_closed: 'Dit spel is al begonnen. Na de start kan niemand meer aansluiten.',
  room_full: 'Dit spel is vol: alle plaatsen zijn bezet.',
  name_taken: 'Deze naam is al in gebruik. Kies een andere naam.',
  name_empty: 'Vul je naam in.',
  name_too_long: 'Je naam mag maximaal 20 tekens hebben.',
  name_invalid: 'Deze naam kan niet. Gebruik gewone letters en cijfers.',
  club_empty: 'Vul beide clubnamen in.',
  club_too_long: 'Een clubnaam mag maximaal 30 tekens hebben.',
  club_invalid: 'Deze clubnaam kan niet. Gebruik gewone letters en cijfers.',
  players_invalid: 'Kies 1 tot 12 deelnemers.',
  max_below_players: 'Er zijn al meer deelnemers aangemeld dan dit aantal.',
  invalid_code: 'Een kamercode heeft 6 tekens.',
  removed: 'Je bent uit dit spel verwijderd.',
  not_organizer: 'Alleen de organisator kan dit doen.',
  cannot_remove_self: 'Je kunt jezelf niet verwijderen.',
  players_incomplete: 'Het spel kan pas starten als alle deelnemers er zijn.',
  intro_running: 'Even wachten: de startanimatie loopt nog.',
  not_your_turn: 'Je bent niet aan de beurt.',
  turn_not_released: 'De vorige trekking is nog bezig.',
  spin_in_progress: 'De rollen draaien al.',
  no_auction_turn: 'De organisator bevestigt eerst de veiling.',
  game_finished: 'Het spel is afgelopen.',
  not_auction: 'Er is nu geen veiling.',
  auction_confirmed: 'Deze veiling is al bevestigd.',
  invalid_bid: 'Vul een geldig bod in.',
  not_started: 'Het spel is nog niet gestart.',
  spin_rejected: 'Draaien lukte niet. Probeer het opnieuw.',
  nothing_to_advance: 'Deze stap is al gezet.',
  auction_not_open: 'Start eerst de veiling.',
  settings_invalid: 'De spelregels kloppen nog niet.',
  invalid_settings: 'Deze spelregels kunnen niet worden opgeslagen.',
  invalid_order: 'De volgorde is intussen gewijzigd. Probeer het opnieuw.',
  player_not_found: 'Deze speler is er al niet meer.',
  room_changed: 'Er is net iets gewijzigd, bijvoorbeeld een nieuwe speler. Controleer de gegevens en start opnieuw.',
  not_available: 'Online spelen is nog niet beschikbaar.',
  network: 'Geen verbinding. Probeer het opnieuw.',
}
export const errorText = (e) => ERROR_TEXT[e?.code] ?? 'Er ging iets mis. Probeer het opnieuw.'

// Uitnodigingslink: dezelfde pagina met `?kamer=CODE`.
export const inviteUrl = (code, loc = window.location) => `${loc.origin}${loc.pathname}?kamer=${code}`
