import { useCallback, useEffect, useRef, useState } from 'react'

// Houdt de kamer bij: eerst ophalen, daarna bij elke melding opnieuw ophalen.
// Een oudere versie overschrijft nooit een nieuwere (hoogste versie wint).
export function useRoom(api, roomId) {
  const [room, setRoom] = useState(null)
  const [error, setError] = useState(null)
  const latest = useRef(0)

  const accept = useCallback((view) => {
    if (view && view.version >= latest.current) {
      latest.current = view.version
      setRoom(view)
    }
  }, [])

  const reload = useCallback(async () => {
    try {
      accept(await api.getRoom(roomId))
      setError(null)
    } catch (e) {
      setError(e)
    }
  }, [api, roomId, accept])

  useEffect(() => {
    latest.current = 0
    setRoom(null)
    setError(null)
    reload()
    return api.subscribe(roomId, reload)
  }, [api, roomId, reload])

  return { room, error, accept, reload }
}
