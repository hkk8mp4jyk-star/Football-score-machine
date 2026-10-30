import { useCallback, useEffect, useReducer } from 'react'
import { STATE_VERSION, createInitialState, reducer } from './engine.js'
import { clock } from './clock.js'
import { validateConfig } from './gameConfig.js'

// Lokale opslag-adapter (DEMO). In multiplayer komt hier een variant die:
//   - dispatch  -> verzoek naar de server stuurt
//   - state     -> uit een realtime kanaal ontvangt
// De componenten hoeven daarvoor niet te veranderen.

const KEY = 'fsm-demo-state'

// Herstelt een opgeslagen stand. Een draai die tijdens het herladen liep,
// blijft gewoon staan: de tijdlijn bepaalt waar hij nu is (verder draaien,
// onthullen of al vastgelegd).
// Versie 2 (vóór de instelbare spellen) was altijd het standaardspel: die
// krijgt de standaardinstellingen erbij en speelt ongewijzigd verder.
export function restoreState(raw) {
  try {
    if (!raw) return createInitialState()
    const parsed = JSON.parse(raw)
    if (parsed?.version === 2 && !('config' in parsed)) return { ...createInitialState(), ...parsed, version: STATE_VERSION }
    if (parsed?.version !== STATE_VERSION || validateConfig(parsed.config).length) return createInitialState()
    return { ...createInitialState(parsed.config), ...parsed }
  } catch {
    return createInitialState()
  }
}

function load() {
  try {
    return restoreState(localStorage.getItem(KEY))
  } catch {
    return createInitialState()
  }
}

export function useGame() {
  const [state, rawDispatch] = useReducer(reducer, undefined, load)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
    } catch {
      /* opslag niet beschikbaar: demo werkt gewoon zonder */
    }
  }, [state])

  // Elke actie krijgt het tijdstip van de (gedeelde) klok mee.
  const dispatch = useCallback((action) => rawDispatch({ ...action, now: clock.now() }), [])

  return [state, dispatch]
}
