// Supabase Edge Function "game": de enige schrijfroute voor het spel.
//
// Telefoons loggen anoniem in bij Supabase en sturen hun verzoek met het
// eigen toegangstoken (Authorization: Bearer …). Deze functie controleert
// het token bij Supabase Auth, past de spelregels toe (src/game/engine.js via
// src/server/actions.js) en legt alles vast met de service_role-sleutel, die
// nooit de server verlaat. Uitrollen: npm run fn:deploy

import { createClient } from 'npm:@supabase/supabase-js@2.118.0'
import { createGameServer } from '../../../src/server/actions.js'
import { createHttpHandler } from '../../../src/server/http.js'
import { createSupabaseStore } from '../../../src/server/supabaseStore.js'

const url = Deno.env.get('SUPABASE_URL')
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
if (!url || !serviceKey) throw new Error('SUPABASE_URL of SUPABASE_SERVICE_ROLE_KEY ontbreekt')

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

// Token controleren bij Supabase Auth: geldig, niet verlopen, gebruiker bestaat nog.
async function authenticate(token: string): Promise<string | null> {
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data?.user) return null
  return data.user.id
}

const server = createGameServer({ store: createSupabaseStore(admin) })

Deno.serve(createHttpHandler({ server, authenticate }))
