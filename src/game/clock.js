// Gedeelde klok voor alle tijdgestuurde onderdelen (rollen, onthulling,
// beurtvrijgave). In de demo is dit de klok van het toestel. In multiplayer
// wordt de afwijking ten opzichte van de serverklok gemeten en ingesteld,
// zodat alle telefoons dezelfde tijdlijn volgen.

let offsetMs = 0

export const clock = {
  now: () => Date.now() + offsetMs,
  setOffset(ms) {
    offsetMs = ms
  },
  getOffset: () => offsetMs,
}

// Afwijking schatten uit één meting: de server antwoordt met zijn tijd
// tussen verzenden (sentAt) en ontvangen (receivedAt) van het verzoek.
export function estimateOffset(sentAt, serverNow, receivedAt) {
  return serverNow - (sentAt + receivedAt) / 2
}
