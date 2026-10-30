// HTTP-laag van de Edge Function: CORS, inloggen controleren, invoer lezen en
// fouten vertalen. Werkt met standaard Request/Response (Deno en Node).

import { ActionError } from './actions.js'

export const MAX_BODY_BYTES = 4096

const CORS = {
  // Geen cookies: toegang loopt via het Bearer-token, dus '*' is veilig.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

const fail = (status, error, message = error) => json(status, { ok: false, error, message })

// `authenticate(token)` geeft het user-id terug of null (ongeldig/verlopen).
export function createHttpHandler({ server, authenticate, log = console.error }) {
  return async function handleHttp(req) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
    if (req.method !== 'POST') return fail(405, 'method_not_allowed')

    const match = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')
    if (!match) return fail(401, 'unauthorized', 'niet ingelogd')

    try {
      const text = await req.text()
      if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return fail(413, 'too_large')
      let body
      try {
        body = JSON.parse(text)
      } catch {
        return fail(400, 'invalid_json')
      }

      const userId = await authenticate(match[1])
      if (!userId) return fail(401, 'unauthorized', 'niet ingelogd')

      return json(200, await server.handle(userId, body))
    } catch (e) {
      if (e instanceof ActionError) return fail(e.status, e.code, e.message)
      log('onverwachte fout', e)
      return fail(500, 'server_error', 'er ging iets mis op de server')
    }
  }
}
