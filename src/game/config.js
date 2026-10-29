// Vaste spelregels van de pool. Alles hier is pure data, zodat dezelfde
// definities later door een Supabase-backend gedeeld kunnen worden.

export const PARTICIPANTS = [
  'Ruud',
  'Marieke',
  'Dennis',
  'Frank',
  'Sanne',
  'Patrick',
  'Jeroen',
  'Esther',
  'Bas',
]

// Teamnamen boven de cijferrollen (thuis links, uit rechts).
export const HOME_TEAM = 'Werder Bremen II'
export const AWAY_TEAM = 'Bremer'

export const OTHER_ID = 'OVERIG'

// Doelpunten per team: 0 t/m 4. Uitslagen met 5 goals doen niet mee.
export const MAX_GOALS = 4
export const GOALS = Array.from({ length: MAX_GOALS + 1 }, (_, i) => i) // [0..4]

// 25 scores van 0-0 t/m 4-4 plus OVERIGE UITSLAGEN = 26 uitslagen.
export const RESULTS = [
  ...GOALS.flatMap((home) => GOALS.map((away) => ({ id: `${home}-${away}`, home, away, other: false }))),
  { id: OTHER_ID, home: null, away: null, other: true },
]

export const RESULT_BY_ID = Object.fromEntries(RESULTS.map((r) => [r.id, r]))

export const ROUNDS = 2
export const DRAW_TURNS = PARTICIPANTS.length * ROUNDS // 18
export const AUCTION_LOTS = RESULTS.length - DRAW_TURNS // 8

// Ronde 1: 1 t/m 9, ronde 2: 9 t/m 1 (oneven rondes heen, even rondes terug).
export const TURN_ORDER = Array.from({ length: DRAW_TURNS }, (_, turn) => {
  const round = Math.floor(turn / PARTICIPANTS.length) + 1
  const pos = turn % PARTICIPANTS.length
  const participant = round % 2 === 0 ? PARTICIPANTS.length - 1 - pos : pos
  return { round, participant }
})

// Symbolen op de rol: 0..4 en een ster (index 5).
export const STAR = GOALS.length
export const REEL_SYMBOLS = GOALS.length + 1

export const TIMING = {
  reel1Stop: 3000, // ms na start
  reel2Stop: 4500,
  reelSettle: 220, // laatste stukje: rol veert terug in de inkeping
  auctionHold: 800, // uitslag blijft 0,8 s staan voordat het vak oplicht
  auctionHighlight: 900, // vak licht groen op
  auctionFade: 700, // vak verdwijnt
  nextTurnDelay: 3000, // uitslag blijft staan voordat de volgende beurt wordt vrijgegeven
  megaWin: 4200, // duur van de MEGA WIN-animatie
}

// Uitslagen die een MEGA WIN-animatie over het hele scherm geven.
export const MEGA_WIN_IDS = ['0-0', '1-0', '2-0', '2-1', '1-2', '0-1', '0-2', '1-1']

export function formatResult(id) {
  const r = RESULT_BY_ID[id]
  if (!r) return ''
  return r.other ? 'Overige uitslagen' : `${r.home}-${r.away}`
}

export function reelTargets(id) {
  const r = RESULT_BY_ID[id]
  return r.other ? [STAR, STAR] : [r.home, r.away]
}
