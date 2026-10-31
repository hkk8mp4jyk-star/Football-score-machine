import { useCallback, useEffect, useMemo, useState } from 'react'
import { USE_MOCK, getApi, inviteUrl } from './api.js'
import { useRoom } from './useRoom.js'
import { OnlineScreen, Toast, useToast } from './screens/common.jsx'
import { CodeScreen, Home, JoinScreen, NewGame, Notice } from './screens/EntryScreens.jsx'
import { LobbyOrganizer, LobbyParticipant, inviteText } from './screens/Lobby.jsx'
import { OnlineGame } from './screens/OnlineGame.jsx'

// Online spel: beginscherm, nieuw spel, meedoen (code of uitnodigingslink
// `?kamer=CODE`), wachtkamer en start. Alle wijzigingen gaan via de server
// (`api`); dit scherm beslist zelf niets.

const NOTICE_CODES = new Set(['room_not_found', 'registration_closed', 'room_full', 'removed', 'not_available'])

function setUrl(code) {
  const url = code ? `${window.location.pathname}?kamer=${code}` : window.location.pathname
  window.history.replaceState(null, '', url)
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Terugval voor oudere browsers.
    const el = document.createElement('textarea')
    el.value = text
    el.setAttribute('readonly', '')
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.select()
    const ok = document.execCommand?.('copy') ?? false
    el.remove()
    return ok
  }
}

function Loading() {
  return (
    <OnlineScreen>
      <p className="ol-note ol-loading">Laden…</p>
    </OnlineScreen>
  )
}

function RoomRoute({ api, roomId, code, onHome, onRejoin, notify }) {
  const { room, error, accept } = useRoom(api, roomId)

  const actions = useMemo(() => {
    const call = (fn) => async (...args) => accept(await fn(roomId, ...args))
    const list = {
      updateSettings: call(api.updateSettings),
      setOrder: call(api.setOrder),
      shuffleOrder: call(api.shuffleOrder),
      removePlayer: call(api.removePlayer),
      startGame: call(api.startGame),
      addManualPlayer: call(api.addManualPlayer),
      joinSelf: call(api.joinSelf),
      spin: call(api.spin),
      confirmAuction: call(api.confirmAuction),
      advancePhase: call(api.advancePhase),
    }
    if (USE_MOCK && api.addFakePlayer) list.addFakePlayer = () => api.addFakePlayer(roomId) // alleen testmodus
    return list
  }, [api, roomId, accept])

  if (error && !room) {
    if (error.code === 'removed') return <Notice kind="removed" onHome={onHome} onRejoin={() => onRejoin(code)} />
    if (NOTICE_CODES.has(error.code)) return <Notice kind={error.code} onHome={onHome} />
    return <Notice kind="network" onHome={onHome} />
  }
  if (error?.code === 'removed') return <Notice kind="removed" matchName={room.matchName} onHome={onHome} onRejoin={() => onRejoin(code)} />
  if (!room) return <Loading />
  if (room.phase === 'started') return <OnlineGame room={room} actions={actions} onHome={onHome} notify={notify} />
  if (!room.isOrganizer) return <LobbyParticipant room={room} onHome={onHome} />

  const url = inviteUrl(room.code)
  const share = async () => {
    const text = inviteText(room.matchName, room.organizerName, room.code)
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Football Score Machine', text, url })
        return
      } catch (e) {
        if (e?.name === 'AbortError') return
      }
    }
    // Geen deelmenu: de volledige uitnodiging kopiëren.
    notify((await copyText(`${text}\n${url}`)) ? 'Uitnodiging gekopieerd' : 'Kopiëren lukte niet', false)
  }
  const copy = async () => notify((await copyText(url)) ? 'Link gekopieerd' : 'Kopiëren lukte niet', false)

  return <LobbyOrganizer room={room} actions={actions} onShare={share} onCopy={copy} onHome={onHome} notify={notify} />
}

// Lettertypen van het Las Vegas-welkomstbord ("Fabulous" in schrift, LAS
// VEGAS breed en zwaar). Alleen in het online deel; de DEMO laadt ze niet.
function useVegasFonts() {
  useEffect(() => {
    if (document.getElementById('fsm-vegas-fonts')) return
    const link = document.createElement('link')
    link.id = 'fsm-vegas-fonts'
    link.rel = 'stylesheet'
    link.href = 'https://fonts.googleapis.com/css2?family=Archivo+Black&family=Yellowtail&display=swap'
    document.head.appendChild(link)
  }, [])
}

export default function OnlineApp() {
  useVegasFonts()
  const [api, setApi] = useState(null)
  const [view, setView] = useState({ name: 'loading' })
  const [toast, notify] = useToast()

  const enterRoom = useCallback(
    (roomId, code) => {
      api.session.set({ roomId, code })
      setUrl(code)
      setView({ name: 'room', roomId, code })
    },
    [api],
  )

  const goHome = useCallback(async (a = api) => {
    setUrl(null)
    const session = a.session.get()
    let resume = null
    if (session?.roomId) {
      try {
        const room = await a.getRoom(session.roomId)
        const me = room.players.find((p) => p.isMe)
        resume = { matchName: room.matchName, phase: room.phase, myName: me?.name ?? '', isOrganizer: room.isOrganizer, ...session }
      } catch (e) {
        if (e.code !== 'network') a.session.clear()
      }
    }
    setView({ name: 'home', resume })
  }, [api])

  // Kamer openen via code of link. `inline`: fouten terug naar het formulier.
  const openCode = useCallback(
    async (code, { inline = false, a = api } = {}) => {
      let summary
      try {
        summary = await a.lookupRoom(code)
      } catch (e) {
        if (inline) throw e
        setUrl(null)
        return setView({ name: 'notice', kind: NOTICE_CODES.has(e.code) ? e.code : 'room_not_found' })
      }
      if (summary.mySlot != null) {
        a.session.set({ roomId: summary.id, code: summary.code })
        setUrl(summary.code)
        return setView({ name: 'room', roomId: summary.id, code: summary.code })
      }
      if (summary.phase !== 'lobby') return setView({ name: 'notice', kind: 'registration_closed', matchName: summary.matchName })
      if (summary.full) return setView({ name: 'notice', kind: 'room_full', matchName: summary.matchName })
      setUrl(summary.code)
      setView({ name: 'join', code: summary.code, summary })
    },
    [api],
  )

  useEffect(() => {
    let alive = true
    getApi().then((a) => {
      if (!alive) return
      setApi(a)
      const code = new URLSearchParams(window.location.search).get('kamer')
      if (code) openCode(code, { a })
      else goHome(a)
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  let screen
  switch (view.name) {
    case 'home':
      screen = (
        <Home
          resume={view.resume}
          onNew={() => setView({ name: 'new' })}
          onJoin={() => setView({ name: 'code' })}
          onResume={() => enterRoom(view.resume.roomId, view.resume.code)}
        />
      )
      break
    case 'new':
      screen = (
        <NewGame
          onBack={() => goHome()}
          onSubmit={async (setup) => {
            const { roomId, code } = await api.createRoom(setup)
            enterRoom(roomId, code)
          }}
        />
      )
      break
    case 'code':
      screen = <CodeScreen onBack={() => goHome()} onSubmit={(code) => openCode(code, { inline: true })} />
      break
    case 'join':
      screen = (
        <JoinScreen
          key={view.code}
          matchName={view.summary.matchName}
          onBack={() => goHome()}
          onSubmit={async (name) => {
            const { roomId, code } = await api.joinRoom(view.code, name)
            enterRoom(roomId, code)
          }}
        />
      )
      break
    case 'room':
      screen = (
        <RoomRoute
          key={view.roomId}
          api={api}
          roomId={view.roomId}
          code={view.code}
          notify={notify}
          onHome={() => goHome()}
          onRejoin={(code) => openCode(code)}
        />
      )
      break
    case 'notice':
      screen = <Notice kind={view.kind} matchName={view.matchName} onHome={() => goHome()} />
      break
    default:
      screen = <Loading />
  }

  return (
    <div className="app ol-app">
      {screen}
      <Toast toast={toast} />
    </div>
  )
}
