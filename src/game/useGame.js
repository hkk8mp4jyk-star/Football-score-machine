import { useEffect, useReducer } from 'react'
import { STATE_VERSION, createInitialState, reducer } from './engine.js'

// Lokale opslag-adapter. Met Supabase wordt dit vervangen door:
//   - dispatch  -> RPC-aanroep naar de server
//   - state     -> abonnement op een realtime kanaal
// De componenten hoeven daarvoor niet te veranderen.

const KEY = 'fsm-demo-state'

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return createInitialState()
    const parsed = JSON.parse(raw)
    if (parsed?.version !== STATE_VERSION) return createInitialState()
    // Een draai die tijdens herladen liep, maken we direct af.
    if (parsed.spin) return reducer(parsed, { type: 'SPIN_COMMIT', spinId: parsed.spin.id })
    return parsed
  } catch {
    return createInitialState()
  }
}

export function useGame() {
  const [state, dispatch] = useReducer(reducer, undefined, load)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
    } catch {
      /* opslag niet beschikbaar: demo werkt gewoon zonder */
    }
  }, [state])

  return [state, dispatch]
}
