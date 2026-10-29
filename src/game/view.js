// Afgeleide weergave: wat het scherm op tijdstip `now` moet tonen, berekend
// uit de spelstatus en de tijdlijn. Er zijn geen losse timers nodig; elke
// telefoon die dezelfde status en (gecorrigeerde) tijd heeft, toont hetzelfde.

import { TIMING } from './config.js'
import { settle } from './engine.js'
import { boundaries, releaseDelay, tileStageAt } from './timeline.js'

// `ack` bevat lokale bevestigingen van dit toestel:
//   auctionStart: id van de laatste rondedraai waarna 'Start de veiling' is getikt
//   finish:       id van de laatste veilingdraai waarna 'Bekijk de eindstand' is getikt
export function deriveView(rawState, now, ack = {}) {
  const state = settle(rawState, now)
  const spin = state.spin // lopend, nog niet vastgelegd
  const last = state.lastSpin // laatst vastgelegd

  let reveal = null
  let locked = false
  let tileStage = null

  if (spin) {
    const stage = tileStageAt(spin, now)
    if (stage) tileStage = { resultId: spin.resultId, stage }
  } else if (last) {
    if (last.round !== 'veiling') {
      // Rondes: uitslag en naam blijven staan tot de volgende beurt vrij is.
      locked = now < last.startedAt + releaseDelay(last)
      const lastDraw = state.phase !== 'draw'
      if (locked || (lastDraw && ack.auctionStart !== last.id)) reveal = last
    } else if (ack.finish !== last.id) {
      reveal = last
    }
  }

  // De rollen blijven de draai volgen tot ze helemaal stilstaan, ook als de
  // trekking intussen al is vastgelegd.
  let reelSpin = spin
  if (!reelSpin && last && now < last.startedAt + TIMING.reel2Stop + 100) reelSpin = last

  const times = [spin, last].filter(Boolean).flatMap(boundaries)
  if (last) times.push(last.startedAt + TIMING.reel2Stop + 100)
  const pending = times.filter((t) => t > now)
  const nextChangeAt = pending.length ? Math.min(...pending) : null

  return { state, reveal, locked, tileStage, reelSpin, nextChangeAt }
}
