// Achtergrondthread: wekt het wachtkamergeluid op zonder het scherm op te
// houden; stuurt links/rechts terug (overgedragen, niet gekopieerd).
import { FLOOR_RATE, casinoFloorChannels } from './casinoFloor.js'

self.onmessage = () => {
  try {
    const [L, R] = casinoFloorChannels(FLOOR_RATE)
    self.postMessage({ L, R }, [L.buffer, R.buffer])
  } catch (e) {
    self.postMessage({ error: String(e) })
  }
}
