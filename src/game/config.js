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

// 36 scores van 0-0 t/m 5-5 plus OVERIGE UITSLAGEN = 37 uitslagen.
export const RESULTS = [
  ...Array.from({ length: 36 }, (_, i) => {
    const home = Math.floor(i / 6)
    const away = i % 6
    return { id: `${home}-${away}`, home, away, other: false }
  }),
  { id: OTHER_ID, home: null, away: null, other: true },
]

export const RESULT_BY_ID = Object.fromEntries(RESULTS.map((r) => [r.id, r]))

export const ROUNDS = 3
export const DRAW_TURNS = PARTICIPANTS.length * ROUNDS // 27
export const AUCTION_LOTS = RESULTS.length - DRAW_TURNS // 10

// Ronde 1: 1 t/m 9, ronde 2: 9 t/m 1, ronde 3: 1 t/m 9.
export const TURN_ORDER = Array.from({ length: DRAW_TURNS }, (_, turn) => {
  const round = Math.floor(turn / PARTICIPANTS.length) + 1
  const pos = turn % PARTICIPANTS.length
  const participant = round === 2 ? PARTICIPANTS.length - 1 - pos : pos
  return { round, participant }
})

// Symbolen op de rol: 0..5 en een ster (index 6).
export const STAR = 6
export const REEL_SYMBOLS = 7

export const TIMING = {
  reel1Stop: 3000, // ms na start
  reel2Stop: 4500,
  auctionHold: 2000, // uitslag blijft 2 s staan voordat het vak oplicht
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
