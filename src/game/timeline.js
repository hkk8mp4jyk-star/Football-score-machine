// Tijdlijn van één draai, gemeten vanaf spin.startedAt (ms). Alle telefoons
// (en straks de server) rekenen met dezelfde functies, zodat het verloop
// overal gelijk is: rollen stoppen, uitslag tonen, vak groen, vak weg,
// beurt vrijgeven.

import { MEGA_WIN_IDS, TIMING } from './config.js'

// Moment waarop de tweede rol stilstaat (vóór het kleine terugveren).
export const STOP_DELAY = TIMING.reel2Stop - TIMING.reelSettle

// Standaard MEGA WIN-lijst (DEMO). In een instelbaar spel legt de engine bij
// elke draai vast of het een MEGA WIN is (`spin.mega`); oudere opgeslagen
// draaien zonder die vlag vallen terug op de standaardlijst.
export const isMegaWin = (resultId) => MEGA_WIN_IDS.includes(resultId)
export const spinIsMega = (spin) => spin.mega ?? isMegaWin(spin.resultId)
const isAuction = (spin) => spin.round === 'veiling'

// Veiling: zo lang blijft de uitslag staan voordat het vak oplicht.
// Bij een MEGA WIN wacht het vak tot de animatie voorbij is.
export function holdDelay(spin) {
  return spinIsMega(spin) ? TIMING.megaWin : TIMING.auctionHold
}

// Moment waarop de trekking in de administratie verschijnt.
// Rondes: zodra de rollen stilstaan. Veiling: nadat het vak verdwenen is.
export function commitDelay(spin) {
  if (!isAuction(spin)) return STOP_DELAY
  return STOP_DELAY + holdDelay(spin) + TIMING.auctionHighlight + TIMING.auctionFade
}

// Moment waarop de volgende beurt mag beginnen.
export function releaseDelay(spin) {
  if (isAuction(spin)) return commitDelay(spin)
  const wait = spinIsMega(spin) ? Math.max(TIMING.nextTurnDelay, TIMING.megaWin) : TIMING.nextTurnDelay
  return STOP_DELAY + wait
}

// Fase van het veilingvak op tijdstip `now`: null, 'green' of 'fade'.
export function tileStageAt(spin, now) {
  if (!isAuction(spin)) return null
  const t = now - spin.startedAt
  const green = STOP_DELAY + holdDelay(spin)
  if (t >= commitDelay(spin)) return null
  if (t >= green + TIMING.auctionHighlight) return 'fade'
  if (t >= green) return 'green'
  return null
}

// Alle overgangsmomenten van een draai (absolute tijden), voor het plannen
// van de volgende schermverversing.
export function boundaries(spin) {
  const s = spin.startedAt
  const list = [s + STOP_DELAY, s + TIMING.reel2Stop, s + commitDelay(spin), s + releaseDelay(spin)]
  if (isAuction(spin)) {
    const green = s + STOP_DELAY + holdDelay(spin)
    list.push(green, green + TIMING.auctionHighlight)
  }
  return list
}
