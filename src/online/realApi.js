// Echte server (Supabase V2). Wordt in F6 gebouwd; tot die tijd meldt elke
// actie dat online spelen nog niet beschikbaar is.
import { ApiError } from './api.js'

const KEY = 'fsm-online-session'

export function createRealApi() {
  const unavailable = async () => {
    throw new ApiError('not_available')
  }
  return {
    isMock: false,
    session: {
      get() {
        try {
          return JSON.parse(localStorage.getItem(KEY))
        } catch {
          return null
        }
      },
      set(value) {
        try {
          localStorage.setItem(KEY, JSON.stringify(value))
        } catch {
          /* geen opslag */
        }
      },
      clear() {
        try {
          localStorage.removeItem(KEY)
        } catch {
          /* geen opslag */
        }
      },
    },
    createRoom: unavailable,
    lookupRoom: unavailable,
    joinRoom: unavailable,
    getRoom: unavailable,
    subscribe: () => () => {},
    updateSettings: unavailable,
    setOrder: unavailable,
    shuffleOrder: unavailable,
    removePlayer: unavailable,
    startGame: unavailable,
    addManualPlayer: unavailable,
    joinSelf: unavailable,
    spin: unavailable,
    confirmAuction: unavailable,
    advancePhase: unavailable,
    now: () => Date.now(),
  }
}
