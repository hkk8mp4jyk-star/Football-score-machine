// Echte server: Supabase V2 (project twzjsmxydnfmowrmffsl).
//
// - Inloggen: anonieme Supabase-login. De sessie blijft in deze browser
//   bewaard (localStorage), dus hetzelfde toestel = dezelfde identiteit: een
//   deelnemer houdt zijn plek en de organisator zijn rechten. Een ander
//   toestel of andere browser is een nieuwe identiteit en kan een bestaande
//   naam niet overnemen (de server weigert een bezette naam).
// - Alle acties via de Edge Function `game` (de server beslist alles). Een
//   spelverzoek wordt nooit automatisch herhaald (geen dubbele SPIN); alleen
//   bij een verlopen login (401, actie niet uitgevoerd) één keer opnieuw.
// - Wijzigingen: Realtime-signaal uit room_pulses (alleen kamer + versie),
//   plus een terugval die elke 2,5 s opnieuw ophaalt (alleen als de pagina
//   zichtbaar is) en bij terugkomen (online, focus).
// - Klok: elke serverreactie bevat serverNow; de afwijking wordt gemeten
//   (kortste rondreis wint) en in de gedeelde klok gezet.
//
// Zonder publieke sleutel (VITE_SUPABASE_PUBLISHABLE_KEY) meldt elke actie
// "nog niet beschikbaar". Nooit een service_role-sleutel in de frontend.

import { ApiError, isValidCode, normalizeCode } from './api.js'
import { clock as sharedClock, estimateOffset } from '../game/clock.js'
import { createHistoryStore } from './history.js'

const SESSION_KEY = 'fsm-online-session'
export const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL || 'https://twzjsmxydnfmowrmffsl.supabase.co'
const PUBLISHABLE_KEY = import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY || ''

function browserStorage() {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function unavailableApi(storage) {
  const unavailable = async () => {
    throw new ApiError('not_available')
  }
  return {
    isMock: false,
    session: sessionStore(storage),
    history: createHistoryStore(storage),
    now: () => sharedClock.now(),
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
  }
}

function sessionStore(storage) {
  return {
    get() {
      try {
        return JSON.parse(storage?.getItem(SESSION_KEY))
      } catch {
        return null
      }
    },
    set(value) {
      try {
        storage?.setItem(SESSION_KEY, JSON.stringify(value))
      } catch {
        /* geen opslag */
      }
    },
    clear() {
      try {
        storage?.removeItem(SESSION_KEY)
      } catch {
        /* geen opslag */
      }
    },
  }
}

async function defaultClient(url, key) {
  const { createClient } = await import('@supabase/supabase-js')
  return createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'fsm-auth' },
  })
}

// Alle afhankelijkheden zijn in te stellen voor de tests (meerdere
// "toestellen" met eigen opslag, nep-Supabase, server in hetzelfde proces).
export function createRealApi({
  url = SUPABASE_URL,
  key = PUBLISHABLE_KEY,
  client,
  fetchFn = (...a) => globalThis.fetch(...a),
  storage = browserStorage(),
  clock = sharedClock,
  timeoutMs = 15_000,
  pollMs = 2_500, // terugval als Realtime wegvalt (aankondiging staat ~2,6 s in beeld)
  events = typeof window !== 'undefined' ? window : null,
  isHidden = () => typeof document !== 'undefined' && document.hidden,
} = {}) {
  if (!client && !key) return unavailableApi(storage)
  const clientPromise = client ? Promise.resolve(client) : defaultClient(url, key)
  let bestRtt = Infinity

  // Eén lopende aanmelding tegelijk (anders twee anonieme gebruikers bij de start).
  let signingIn = null
  async function accessToken() {
    const sb = await clientPromise
    const { data } = await sb.auth.getSession()
    if (data?.session?.access_token) return data.session.access_token
    signingIn ??= sb.auth.signInAnonymously().finally(() => {
      signingIn = null
    })
    const { data: d, error } = await signingIn
    if (error || !d?.session) throw new ApiError('network')
    sb.realtime?.setAuth?.(d.session.access_token)
    return d.session.access_token
  }

  async function post(token, body) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const sent = Date.now()
    try {
      const res = await fetchFn(`${url}/functions/v1/game`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, apikey: key, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      })
      const data = await res.json().catch(() => null)
      const received = Date.now()
      if (Number.isFinite(data?.serverNow) && received - sent < bestRtt) {
        bestRtt = received - sent
        clock.setOffset(estimateOffset(sent, data.serverNow, received))
      }
      return { status: res.status, data }
    } catch {
      throw new ApiError('network')
    } finally {
      clearTimeout(timer)
    }
  }

  // Eén spelverzoek; nooit automatisch herhaald, behalve na een verlopen login.
  async function game(action, input = {}) {
    let res = await post(await accessToken(), { action, ...input })
    if (res.status === 401) {
      const sb = await clientPromise
      await sb.auth.refreshSession?.()
      res = await post(await accessToken(), { action, ...input })
    }
    if (!res.data?.ok) throw new ApiError(res.data?.error ?? 'network')
    return res.data
  }

  const room = (action) => async (roomId, input) => (await game(action, { roomId, ...input })).room

  // Klok alvast gelijkzetten (niet blokkerend).
  game('time').catch(() => {})

  return {
    isMock: false,
    session: sessionStore(storage),
    history: createHistoryStore(storage),
    now: () => clock.now(),

    async createRoom(setup) {
      const r = (await game('create_room', setup)).room
      return { roomId: r.id, code: r.code }
    },
    async lookupRoom(rawCode) {
      const code = normalizeCode(rawCode)
      if (!isValidCode(code)) throw new ApiError('invalid_code')
      return (await game('lookup_room', { code })).summary
    },
    async joinRoom(rawCode, name) {
      const code = normalizeCode(rawCode)
      if (!isValidCode(code)) throw new ApiError('invalid_code')
      const r = (await game('join_room', { code, name })).room
      return { roomId: r.id, code: r.code }
    },
    getRoom: (roomId) => room('get_room')(roomId),

    // Realtime-signaal + terugval (regelmatig ophalen, en bij terugkomen).
    subscribe(roomId, onChange) {
      let channel = null
      let stopped = false
      clientPromise.then(async (sb) => {
        if (stopped || !sb.channel) return
        await accessToken().catch(() => {})
        channel = sb
          .channel(`room-${roomId}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'room_pulses', filter: `room_id=eq.${roomId}` }, () => onChange())
          .subscribe()
        if (stopped) sb.removeChannel(channel)
      })
      const poll = setInterval(() => {
        if (!isHidden()) onChange()
      }, pollMs)
      const wake = () => {
        if (!isHidden()) onChange()
      }
      events?.addEventListener?.('online', wake)
      events?.addEventListener?.('focus', wake)
      events?.addEventListener?.('visibilitychange', wake)
      return () => {
        stopped = true
        clearInterval(poll)
        events?.removeEventListener?.('online', wake)
        events?.removeEventListener?.('focus', wake)
        events?.removeEventListener?.('visibilitychange', wake)
        if (channel) clientPromise.then((sb) => sb.removeChannel(channel))
      }
    },

    updateSettings: (roomId, draft) => room('update_settings')(roomId, { draft }),
    setOrder: (roomId, order) => room('set_order')(roomId, { order }),
    shuffleOrder: (roomId) => room('shuffle_order')(roomId),
    removePlayer: (roomId, slot) => room('remove_player')(roomId, { slot }),
    startGame: (roomId, expectedVersion) => room('start_game')(roomId, { expectedVersion: expectedVersion ?? null }),
    addManualPlayer: (roomId, name) => room('add_manual_player')(roomId, { name }),
    joinSelf: (roomId) => room('join_self')(roomId),
    spin: (roomId, { onBehalf = false } = {}) => room('spin')(roomId, { onBehalf }),
    confirmAuction: (roomId, participant, bidCents) => room('confirm_auction')(roomId, { participant, bidCents }),
    advancePhase: (roomId, step) => room('advance_phase')(roomId, { step }),
  }
}
