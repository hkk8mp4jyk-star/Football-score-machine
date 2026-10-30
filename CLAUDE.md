# CLAUDE.md — Football Score Machine

Overdracht voor nieuwe Claude Code-sessies. Lees dit eerst. Taal met de
gebruiker: **Nederlands**. De gebruiker werkt op **mobiel**.

Digitale fruitautomaat voor de jaarlijkse voetbalpool met negen vrienden.
React-app (prototype goedgekeurd) die stap voor stap multiplayer wordt via
Supabase. Fase 1 en 2 zijn klaar en goedgekeurd; fase 3 (Edge Function) is
gebouwd. Nieuw Supabase-project (V2): database geïnstalleerd en `db:test`
geslaagd (30-10-2026); Edge Function-uitrol en live test wachten elk op
akkoord. **Fase 4 alleen starten na
expliciet akkoord van de gebruiker.**

---

## 0. Werkafspraken (altijd)

- Werk in fases; na elke fase **stoppen en wachten op akkoord**.
- Branch: `claude/multiplayer-fase-1` (bestaande multiplayer-branch). Een
  sessie kan daarnaast een eigen sessiebranch krijgen; fase 3 staat op beide
  (`claude/fsm-phase-3-edge-function-4ihmsf`). Commit/push alleen als de
  gebruiker erom vraagt. **Geen PR** tenzij gevraagd.
- Wijzig niets wat niet gevraagd is (geen ongevraagde scherm-, code- of
  databasewijzigingen). Verzin geen spelregels: bij twijfel vragen.
- Goedgekeurd ontwerp is leidend: visuele wijzigingen alleen op verzoek, en
  regressie controleren (pixelvergelijking/timing) bij refactors.
- **Vraag nooit om het Supabase-token in de chat te plakken.** Het token wordt
  door de proxy als Network secret voor `api.supabase.com` toegevoegd; er is
  geen env-variabele nodig.
- **Haal geen API-keys of geheimen op** (bijv. `/v1/projects/{ref}/api-keys`);
  dat is geblokkeerd en niet de bedoeling. Hoe de publieke (anon/publishable)
  key in de frontend komt, beslissen we samen in fase 4.
- Autorisatie gebeurt **altijd server-side**. Een deelnemer mag nooit
  organisatoracties kunnen uitvoeren door zelf API-verzoeken te sturen.
- Voor elke push: `npm test` en `npm run build` moeten slagen.

---

## 1. Spelregels (definitief)

- **9 deelnemers.** De organisator is ook deelnemer (heeft een eigen naam/plek
  en moet dus zelf ook spinnen).
- **26 uitslagen**: alle scores `0-0` t/m `4-4` (25) plus `OVERIG`
  ("OVERIGE UITSLAGEN" = elke andere uitslag). Uitslagen met 5 goals bestaan
  niet meer.
- Elke uitslag valt **precies één keer** en wordt **pas op het moment van SPIN
  willekeurig gekozen** uit de nog resterende uitslagen (niets ligt vooraf
  vast). Cryptografische randomness, uniform (rejection sampling).
- **2 vaste rondes = 18 trekkingen**, daarna **8 kavels in de veiling**
  (18 + 8 = 26).
- **Volgorde** (deelnemer 1..9 = index 0..8):
  - ronde 1: 1 → 9
  - ronde 2: 9 → 1
- Iedere deelnemer trekt precies één keer per vaste ronde.
- **Waarde**: een uitslag uit de vaste rondes = **€10**. Een veilinguitslag =
  **het bod** van de koper. Totaal per deelnemer = som daarvan.
- **Veiling**:
  - Na trekking 18 staan de 8 resterende uitslagen op het veilingbord, in
    vaste volgorde (volgorde van `RESULTS`), 4 boven en 4 onder de machine.
  - Per kavel kiest de **organisator** (buiten de app geveild) de koper en het
    bod en geeft de beurt vrij ("Beurt vrijgeven"). Alleen die koper mag
    spinnen.
  - De machine kiest willekeurig welke van de resterende kavels de koper
    krijgt. Het bord verraadt niets vooraf.
  - Na de 8e kavel is het spel klaar → eindstand.
- **Noodfunctie**: de organisator mag expliciet "draaien namens" een
  deelnemer (vastgelegd als `on_behalf`). Verder kan niemand voor een ander
  spinnen.

## 2. Uitslagen en verdeling

- `RESULTS` (config): `0-0, 0-1 … 4-4, OVERIG` = 26 ids.
- Vaste rondes: 18 willekeurige uit 26. Veiling: de overige 8.
- **MEGA WIN** bij: `0-0, 1-0, 2-0, 2-1, 1-2, 0-1, 0-2, 1-1`.
- **OVERIG**: beide rollen landen op ★ → grote banner "OVERIGE UITSLAGEN".

## 3. Timing en animaties (definitief)

Uit `src/game/config.js` → `TIMING` en `src/game/timeline.js`:

| Moment | Tijd na SPIN |
|---|---|
| Rol 1 stopt | 3,0 s |
| Rol 2 stopt (visueel stilstand na settle) | 4,5 s (uitslag bekend 4,28 s) |
| Vaste ronde: volgende beurt vrij | stop + 3,0 s (MEGA: stop + 4,2 s) |
| Veiling: kavel groen | stop + 0,8 s (MEGA: na 4,2 s) |
| Veiling: groen → vervagen → weg | +0,9 s groen, +0,7 s fade |
| MEGA WIN-overlay | 4,2 s; OVERIG-banner 2,6 s |

- Rollen tonen 0–4 en ★ (6 symbolen); beweging via `reelMotion.js`
  (versnellen, topsnelheid, afremmen, kleine overshoot/settle).
- De **SPIN-knop verdwijnt** na indrukken en komt pas terug als de volgende
  beurt is **vrijgegeven** (niet bij einde animatie).
- Geluiden synthetisch via Web Audio; iOS-unlock bij eerste aanraking.
- Aankondigingen (geluid/overlay) worden overgeslagen als ze >1,5 s te laat
  zijn (bijv. na herladen).

## 4. Goedgekeurde UI/ontwerp

- Mobile-first, donker fruitautomaat-thema. Fonts: Anton (display), Barlow
  Condensed, Barlow. React + Tailwind 4.
- Op de machine: thuis **"Werder Bremen II"**, uit **"Bremer"**.
- **Hoofdscherm (rondes)**: rondebadges, naam van wie aan de beurt is, twee
  rollen, SPIN, teller "nog te trekken", knop/ovaal "Uitslagen bekijken".
- **Veilingscherm**: navigatie "VEILING" / "UITSLAGEN BEKIJKEN ›"; naam +
  "DRAAIT VOOR €…"; 4 kavels boven en 4 onder de machine (machine even groot
  als in de rondes); vaste posities, niets schuift; gewonnen kavel wordt groen
  en vervaagt, **geen doorzichtige vierkantjes blijven staan**; SPIN onder de
  onderste rij; geen statusbalk/footer; organisatorbediening (hamer-knop)
  bovenaan; DEMO-menu blijft.
- **Overzicht**: compacte kop met tabs "UITSLAGEN" / "PER DEELNEMER" naast de
  sluitknop; geen toelichting/legenda; per deelnemer bedragen (€10 / bod) en
  totalen; compacte kaartjes.
- **Bedragen**: hele bedragen zonder decimalen ("€10"), anders 2 decimalen
  ("€0,50").
- **DEMO-menu** (blijft bestaan, ook online als lokale demo): geluid, weergave
  organisator/deelnemer + naamkeuze, "Elke beurt zelf draaien", direct naar
  de veiling, demo resetten.
- De zwarte browserbalk verdwijnt pas bij installatie op beginscherm (PWA) —
  uitgesteld naar later.

## 5. React-architectuur en spelengine

```
src/game/config.js     spelregels, uitslagen, volgorde, timing, MEGA-lijst
src/game/engine.js     pure reducer, tijdgestuurd (STATE_VERSION = 2)
src/game/timeline.js   alle vertragingen per draai (commit/release/tegels)
src/game/view.js       deriveView(state, now, ack) → wat het scherm toont
src/game/clock.js      gedeelde klok met offset (servertijd)
src/game/random.js     secureRandomInt (crypto, rejection sampling), secureId
src/game/reelMotion.js bewegingsprofiel van de rollen
src/game/money.js      bedragen in centen en opmaak
src/game/useGame.js    lokale demo-adapter (localStorage 'fsm-demo-state')
src/App.jsx            schermen, rollen (organisator/deelnemer), geluid
src/components/*       MainScreen, AuctionScreen, Header, SlotMachine, Reel,
                       Overview, AuctionSetup, DemoMenu, MegaWin, OtherBanner
src/audio/sound.js     synthetische geluiden
```

**Engine-principes** (moet ongewijzigd ook op de server werken):
- State: `{version, phase:'draw'|'auction'|'finished', turn, remaining,
  draws[{resultId, participant, round, bid, at}], auctionBoard,
  auctionTurn{participant,bid}|null, spin{id,resultId,participant,round,bid,startedAt}|null, lastSpin}`.
- Acties (altijd met `now`): `SPIN_START`, `AUCTION_PREPARE`, `RESET`,
  `DEMO_SKIP_TO_AUCTION`; overige acties = alleen `settle`.
  `SPIN_COMMIT` bestaat **niet** meer.
- **Tijdgestuurd**: `SPIN_START` kiest de uitslag en slaat `startedAt` op;
  alles daarna (stoppen, vastleggen, volgende beurt) volgt uit de tijd via
  `settle(state, now)` en `deriveView`. Geen client-timers die de status
  wijzigen → elke telefoon rekent hetzelfde uit, ook na herladen.
- `SPIN_START` wordt geweigerd als het spel klaar is, de beurt nog niet is
  vrijgegeven, of in de veiling geen `auctionTurn` is voorbereid.
- Afhankelijkheden injecteerbaar: `createReducer({randomInt, newId})`.

## 6. Multiplayer-architectuur en Supabase-config

- Supabase-project **V2: `twzjsmxydnfmowrmffsl`** ("football-score-machine-v2"),
  organisatie "Lars Projects", regio **eu-west-3 (Paris)**, Postgres 17, Free,
  URL `https://twzjsmxydnfmowrmffsl.supabase.co`. Standaard in
  `scripts/supabase.mjs` en `scripts/live-test.mjs`.
  - Handmatig ingesteld (door gebruiker): Anonymous sign-ins AAN, Allow new
    users to sign up AAN, manual linking UIT, sessietime-outs 0 (never),
    access token expiry 3600 s, refresh token protection AAN, Data API AAN,
    exposed schemas `public` + `graphql_public`, **Automatically expose new
    tables UIT**, pool size automatisch.
  - Gevolg van "expose UIT" (gecontroleerd via `pg_default_acl`): nieuwe
    tabellen in `public` geven anon/authenticated/service_role alleen
    truncate/references/trigger/maintain, nieuwe functies en sequences alleen
    `postgres`. Onze migraties verlenen alles expliciet; `security.sql` toetst
    dat.
  - Token (Network secret voor api.supabase.com) heeft toegang tot V2, niet
    `projects_read`. Migreren werkt; uitrollen van functies nog niet bewezen.
- **Oud project `nptulnnuejivwcgcltuy`** (eu-west-1): **defect** (Auth/REST
  HTTP 521 na herstarts, zie Openstaande punten). Niet meer gebruiken, niet
  wijzigen; blijft voorlopig bestaan.
- Deelnemers loggen in via **anonieme Supabase-login** (geen accounts of
  wachtwoorden). Live te testen met `npm run fn:test` (zie §7b).
- Hosting: **GitHub Pages** (`.github/workflows/pages.yml`: `npm ci`,
  `npm test`, `npm run build` bij push naar `main`).
- **Server-autoritatief**: telefoons lezen alleen (RLS + Realtime). Alle
  wijzigingen (kamer maken, naam claimen, SPIN, veiling voorbereiden, plek
  vrijgeven, draaien namens) gaan via **één Edge Function** (service_role) die
  `engine.js` gebruikt en atomair vastlegt via `commit_room_state`.
- Beheer via Management API (`https://api.supabase.com/v1/projects/{ref}`):
  `npm run db:status | db:migrate | db:test | fn:deploy`
  (`scripts/supabase.mjs`; Node heeft `NODE_USE_ENV_PROXY=1` nodig, zit in de
  npm-scripts). Andere ref via `SUPABASE_PROJECT_REF`; lokaal eventueel
  `SUPABASE_ACCESS_TOKEN`. De Management API geeft bij veel verzoeken HTTP 429;
  het script wacht dan en probeert opnieuw.
- **Netwerk in Claude Code-omgeving**: `api.supabase.com` en
  `twzjsmxydnfmowrmffsl.supabase.co` zijn toegestaan (door de gebruiker in de
  omgevingsinstellingen; nodig voor `fn:test`).

## 7. Database en beveiliging (fase 2, uitgevoerd)

Migratie `supabase/migrations/20261029120000_multiplayer_schema.sql`
(remote geregistreerd als `multiplayer_schema`, versie 20261029203237;
het script vergelijkt op **naam**).

- `public.rooms`: `id`, `code` (6 tekens `^[A-HJ-NP-Z2-9]{6}$`, uniek),
  `organizer_id`, `state` jsonb (engine-formaat, <200 kB), `version`
  (optimistische vergrendeling), tijdstempels.
- `public.seats`: `(room_id, participant 0..8)` PK, `user_id` uniek per kamer,
  `is_organizer` (max één per kamer).
- `public.draws`: definitieve trekkingen; `spin_id` uniek; `result_id` alleen
  de 26 ids; uniek `(room_id, result_id)`; `round` `'1'|'2'|'veiling'`;
  `bid_cents` verplicht bij veiling en verboden in rondes; één trekking per
  deelnemer per vaste ronde; `spun_by`, `on_behalf`. **UPDATE geblokkeerd**
  door trigger (ook voor de server).
- Schema `private` (niet via API): `is_room_member()` (security definer).
- **RLS** aan op alle tabellen; `authenticated` mag alleen **lezen** wat bij
  de eigen kamer hoort; `anon` niets; **geen** insert/update/delete-policies.
  `service_role` heeft expliciete rechten.
- `public.commit_room_state(room, expected_version, state, draw?)`: zet status
  alleen bij juiste versie (anders `version_conflict`, **PT409**) en legt de
  trekking in dezelfde transactie vast. Alleen `service_role` mag uitvoeren.
- **Migratie 2** `supabase/migrations/20261030120000_version_conflict_pt409.sql`
  (naam `version_conflict_pt409`): alleen de foutcode 40001 → `PT409`
  (`create or replace`, rechten opnieuw gezet). De oorspronkelijke migratie
  blijft ongewijzigd (geschiedenis). Reden: PostgREST herhaalt 40001
  (serialization_failure) automatisch → eindeloze lus bij een verouderde
  versie; PT409 wordt niet herhaald en geeft HTTP 409. **Nooit 40001/40P01
  gebruiken voor eigen fouten.**
- Realtime-publicatie: `rooms` en `seats`.
- Tests: `supabase/tests/security.sql` (51 checks, in een rollback-transactie)
  + echte concurrency-test (10 gelijktijdige commits → precies 1 slaagt,
  testkamer `ZZTEST` wordt opgeruimd). Laatste run: **52/52 geslaagd**,
  database daarna leeg.

## 7b. Edge Function `game` (fase 3, gebouwd)

Eén functie, uitgerold als `game` (`npm run fn:deploy`), URL
`https://twzjsmxydnfmowrmffsl.supabase.co/functions/v1/game` (V2: nog niet
uitgerold). Schemawijziging na fase 3: alleen migratie 2 (PT409).

```
supabase/functions/game/index.ts  Deno-ingang: token controleren, service_role-client
src/server/actions.js             alle acties + autorisatie (gedeeld met tests)
src/server/http.js                CORS, POST/JSON, Bearer-token, foutcodes → HTTP
src/server/supabaseStore.js       opslag via supabase-js; status alleen via commit_room_state
scripts/server-integration.mjs    serverlogica tegen de echte database (in db:test)
scripts/live-test.mjs             live test met echte anonieme logins (fn:test)
tests/server.test.js, tests/memoryStore.js   unittests (geheugenopslag met DB-regels)
```

- **Aanroep**: `POST` met `Authorization: Bearer <access token van de
  anonieme sessie>` en JSON `{ action, ... }`. Antwoord altijd JSON:
  `{ ok: true, ..., serverNow }` of `{ ok: false, error, message }`.
- **Inloggen**: `verify_jwt` staat uit bij uitrol; de functie controleert het
  token zelf met `auth.getUser(token)` (geldig, niet verlopen, gebruiker
  bestaat). Het `userId` komt **alleen** uit het token, nooit uit de invoer.
- **Acties** (whitelist; `RESET`, `DEMO_SKIP_TO_AUCTION` e.d. bestaan
  online niet):

| Actie | Invoer | Wie |
|---|---|---|
| `time` | – | ingelogd (klok-sync via `serverNow`) |
| `create_room` | `participant?` | ingelogd → wordt organisator (max 5 kamers per gebruiker) |
| `lookup_room` | `code` | ingelogd: vrije/bezette namen, geen user-id's |
| `claim_seat` | `code, participant` | ingelogd; 1 naam per telefoon, 1 telefoon per naam; zelfde verzoek opnieuw = ok |
| `get_room` | `roomId` | leden: status, versie, plaatsen (herstel na herladen) |
| `release_seat` | `roomId, participant` | alleen organisator |
| `spin` | `roomId, onBehalf?` | alleen wie aan de beurt is; organisator namens een ander **alleen** met `onBehalf: true` → `draws.on_behalf = true`, `spun_by` = organisator |
| `auction_prepare` | `roomId, participant, bidCents` | alleen organisator, alleen in de veiling, niet tijdens een draai; bod in centen (0 … 1.000.000), status bewaart euro's |

- **SPIN op de server**: status laden → `settle(now)` → controleren (spel
  klaar? beurt vrij? veilingbeurt klaargezet? wie is aan de beurt?) →
  engine `SPIN_START` met `secureRandomInt` → `commit_room_state(versie,
  status, trekking)`. Wat de telefoon verder meestuurt (uitslag, deelnemer,
  tijd) wordt genegeerd.
- **Dubbel/gelijktijdig**: bij `version_conflict` (PT409 → `StoreConflict`)
  laadt de server opnieuw en controleert alles opnieuw (**max 3 pogingen**,
  daarna `conflict` 409); een tweede SPIN voor dezelfde beurt wordt dan
  `turn_not_released`. supabase-js (postgrest-js 2.118) herhaalt zelf alleen
  GET/HEAD/OPTIONS bij 503/520 (max 3), nooit de RPC-POST. Er is dus nergens
  een onbeperkte herhaling. Verzoek opnieuw versturen na verbindingsverlies
  kan nooit een tweede trekking geven.
- **Foutcodes**: `unauthorized` 401, `invalid_input`/`unknown_action`/
  `invalid_json` 400, `not_your_turn`/`not_organizer` 403, `room_not_found`
  404 (ook voor niet-leden), `seat_taken`/`already_seated`/
  `turn_not_released`/`no_auction_turn`/`game_finished`/`not_auction`/
  `spin_in_progress`/`conflict` 409, `too_large` 413 (>4 kB),
  `too_many_rooms` 429, `server_error` 500 (zonder interne details).
- **Live test** (`npm run fn:test`): rolt tijdelijk hulpfunctie
  `fsm-testlogin` uit (doet `signInAnonymously()` met de sleutel uit de eigen
  functie-omgeving, beveiligd met een eenmalige willekeurige code; dit script
  ziet nooit een API-sleutel), speelt alle scenario's met echte tokens en
  ruimt hulpfunctie, testkamers en testgebruikers altijd op.

### Veilige installatie- en testprocedure V2 (elke stap apart akkoord)

1. Lokaal (gedaan): code + `npm test` + `npm run build`; extra controle met
   PGlite (scratchpad, niet in repo): beide migraties + `security.sql` met
   nagebootste Supabase-rollen en "expose UIT" → 55/55; tegenproef zonder
   migratie 2 faalt op de PT409-controles.
2. **Gedaan 30-10-2026**: `npm run db:migrate` (remote versies
   20261030141020 `multiplayer_schema`, 20261030141022
   `version_conflict_pt409`). Read-only nacontrole geslaagd: 3 tabellen met
   RLS en 3 SELECT-policies (authenticated, via `private.is_room_member`);
   rechten exact zoals ontworpen (anon niets; authenticated alleen SELECT +
   `is_room_member` + usage `private`; service_role tabellen, sequence en
   `commit_room_state`); `commit_room_state` bevat PT409 en geen 40001;
   publicatie `rooms` + `seats`; PostgREST-schemacache: 3 relaties, geen
   fouten; alle diensten gezond; tabellen leeg.
3. **Gedaan 30-10-2026**: `npm run db:test` → **62/62** (security.sql 55 in
   rollback-transactie, 1 concurrency-test op `commit_room_state`, 6
   servertests incl. 10 gelijktijdige claims/SPIN's en volledig spel 18+8).
   Alle verzoeken via Management API `/database/query` (direct Postgres,
   `mgmt-api`), niet via PostgREST; herhalingen begrensd (429: max 8,
   versieconflict: max 3). Conflicten correct: precies 9 + 9
   `version_conflict` (PT409) in de logs om 14:13/14:14, daarna geen enkele
   meer. Na afloop: 0 kamers/plaatsen/trekkingen/gebruikers, 13 verbindingen
   (gelijk aan vooraf), geen hangende transacties of locks, alle diensten
   gezond, geen fouten in de logs.
4. `npm run fn:deploy` → één verzoek zonder token: verwacht 401.
5. Live test gefaseerd: eerst zonder gelijktijdigheid, dan 2 gelijktijdige
   SPIN's, pas daarna 10. Tussendoor controleren: geen
   `idle in transaction`, geen `version_conflict`-stroom in de logs, health
   groen. **Stopcriterium**: één 500 of hangende verbinding = direct stoppen.
   Opruimen moet altijd draaien (eerder liet een afgebroken run data achter).

## 8. Afspraken: trekking, sync, animaties, herstel

- Een geaccepteerde SPIN wordt **direct en definitief op de server
  vastgelegd** (status + trekking in één transactie). Herladen, wegvallen of
  terugkomen verandert nooit de uitslag.
- De **server kiest de uitslag** (`secureRandomInt`), nooit de telefoon.
- Dubbele/gelijktijdige SPIN's: versiecontrole → precies één slaagt, de rest
  krijgt `version_conflict` en verandert niets.
- Sync: elke telefoon ontvangt de status met `startedAt` en rekent de animatie
  uit op de **gedeelde klok** (`clock.js`, offset t.o.v. servertijd via
  `estimateOffset`). Zo draaien en stoppen alle telefoons gelijk.
- Herstel na verbindingsverlies/herladen: status opnieuw ophalen → `settle` +
  `deriveView` op de huidige tijd. Een lopende draai loopt verder vanaf het
  juiste punt; te late aankondigingen worden overgeslagen. (Lokaal al werkend
  en getest in de demo.)
- Organisator kan een geclaimde plek vrijgeven (bijv. nieuwe telefoon).

## 9. Wat is gebouwd en getest

- **Prototype** (goedgekeurd): alle schermen, animaties, geluid, demo.
  Gepubliceerd als artifact: `npm run build:artifact` →
  `dist-artifact/football-score-machine.html`.
- **Fase 1** (goedgekeurd): tijdgestuurde engine, timeline, view, klok,
  crypto-random. `npm test` → **51 tests** geslaagd (config, random, engine,
  money, timeline, reelMotion, recovery). Browserregressie t.o.v. de
  goedgekeurde versie: 6 schermen pixel-identiek, timing gelijk, herstel na
  herladen werkt. Bekend klein verschil: settle-veer van rol 2 wordt in de
  rondes nu volledig afgespeeld.
- **Fase 2** (goedgekeurd): schema, RLS, `commit_room_state`, DB-tests
  (52/52).
- **Fase 3** (gebouwd, wacht op akkoord): Edge Function `game` uitgerold
  (ACTIVE, verify_jwt uit). `npm test` → **85 tests** (51 + 34 servertests:
  toegang/invoer, kamer/namen, SPIN-autorisatie, noodfunctie, veiling,
  10 gelijktijdige SPIN's/claims, 10.000 proeftrekkingen chi-kwadraat,
  herstel, versieconflict, HTTP-laag). `npm run db:test` → **58/58**
  (52 + 6 servertests tegen de echte database als service_role, incl. volledig
  spel 18+8 en gelijktijdigheid; database daarna leeg). Rooktest in Deno 2.5
  (`deno check` + handler) geslaagd.
- **V2-voorbereiding (lokaal)**: `npm test` → **88 tests** (+3: PT409 →
  versieconflict, 23505/overige fouten, HTTP 409 i.p.v. 500; conflicttest
  telt precies 3 pogingen). `security.sql` +4 controles (PT409 i.p.v. 40001,
  expliciete serverrechten incl. sequence, expliciet leesrecht +
  `is_room_member`, geen bijrechten voor deelnemers). `deno check` en
  Deno-rooktest geslaagd. Migraties op V2 uitgevoerd en nagecontroleerd
  (zie §7b, procedure stap 2).
- **Live test `fn:test` (30-10-2026, oud project, domein toegestaan)**: anonieme login
  werkt (echte Supabase Auth, `is_anonymous = true`); geldig/ongeldig/vervalst/
  verwijderd token, servertijd, kamer + 9 namen, autorisatie (geen
  organisatoracties of andermans SPIN), namens draaien, verbinding weg tijdens
  SPIN (geen tweede trekking), plek vrijgeven: geslaagd. Opruimen geslaagd.
  **BLOKKERENDE BEVINDING**: bij gelijktijdige SPIN's geeft
  `commit_room_state` `version_conflict` met SQLSTATE **40001**; via PostgREST
  levert dat `500` op én blijven de PostgREST-verbindingen hangen in
  `idle in transaction (aborted)` (geen `idle_in_transaction_session_timeout`).
  Na enkele conflicten hangen daarna **alle** database-aanroepen van de functie
  (eerst gezien als hangende `create_room`). Wel: altijd precies één trekking.
  Voorgestelde oplossing (wacht op akkoord gebruiker, schemawijziging):
  migratie die alleen de foutcode in `commit_room_state` wijzigt naar
  `PT409` (PostgREST → HTTP 409, geen transactie-retry), plus aanpassing van
  `supabaseStore.js`, `security.sql` en `server-integration.mjs`; daarna
  vastgelopen PostgREST-verbindingen laten opruimen (herstart PostgREST of
  `pg_terminate_backend`; dat laatste werd door de veiligheidscontrole van
  Claude Code geweigerd) en `fn:test` opnieuw.

Commando's: `npm run dev` (vite --host), `npm test`, `npm run build`,
`npm run preview`, `npm run build:artifact`, `npm run db:*`, `npm run fn:*`.

## 10. Nog te bouwen (niet zonder akkoord starten)

3. ~~Edge Function~~ — gebouwd (§7b); installatie op V2 + live test volgens
   de veilige procedure (§7b) staan nog open.
4. **Kamer-/aanmeldschermen** in de bestaande stijl (kamer maken,
   uitnodigingslink/code, naam kiezen). Publieke key in frontend-config:
   eerst met de gebruiker afstemmen hoe die wordt aangeleverd.
5. **Realtime rondes 1–2**: online adapter in plaats van `useGame`,
   klok-sync, SPIN via de server.
6. **Veiling online.**
7. **Robuustheid**: reconnect, achtergrond, refresh, plek vrijgeven.
8. **Live**: GitHub Pages; controleren dat uitnodigingslinks met kamercode
   direct openen; generale repetitie met 9 telefoons.
- **Later**: PWA (beginscherm-icoon) + pushmelding "Jij bent aan de beurt!",
  eventueel zachte drempel naar standalone-modus.

### Openstaande punten
- Optionele verharding: uitslag later naar telefoons sturen, zodat hij niet
  ~4,5 s vóór stilstand in netwerkverkeer te zien is.
- Token mist `advisors_read` (security advisors niet op te vragen).
- Supabase free plan pauzeert na 7 dagen inactiviteit.
- Het access token heeft volledige rechten: na de bouw intrekken/vernieuwen.
- **Opgelost in code (migratie 2, nog niet geïnstalleerd)**: foutcode 40001
  in `commit_room_state` liet PostgREST vastlopen bij gelijktijdige SPIN's.
- **Storing 30-10-2026 (bevestigd, read-only onderzocht)**: PostgREST herhaalde
  de mislukte `commit_room_state` eindeloos (log `version_conflict` ~1×/s van
  08:46 tot 09:12, ook zonder clients; 3,64 mln. request-setup-statements en
  evenveel rollbacks) → pool vol (`PGRST003`). Na twee projectherstarts
  (09:13 en 09:44 UTC) geven Auth, PostgREST én de interne admin-API van de
  instance blijvend HTTP 521; vóór de herstart gaven ze nog 200. Postgres,
  Storage, Realtime en pooler zijn gezond; PostgREST/Auth maken géén
  databaseverbinding (geen mislukte logins). Geen resource pressure zichtbaar
  (DB 11 MB, cache-hit 99,95 %, 0 temp-bestanden, geen locks/hangende
  transacties, geen OOM/disk/FATAL-logs). Geen validatiefouten of eigen
  objecten in interne schema's (upgrade-check). Geheugen/CPU/disk-metrics zijn
  met dit token niet op te vragen. Conclusie: opstartprobleem van de
  instance-diensten buiten Postgres; herstel vereist Supabase. Bij een nieuw
  project: 40001 → PT409 direct in de migratie meenemen.
- **Logs uitlezen**: `GET /v1/projects/{ref}/analytics/endpoints/logs?sql=…`
  met tabel `logs` (ClickHouse-dialect, geen `*`, kolommen `timestamp`,
  `event_message`; max ~1 verzoek per paar seconden).
- Organisator die van telefoon wisselt verliest organisatorrechten
  (`organizer_id` = oude anonieme gebruiker); overdracht bestaat nog niet.
- Geen "spel opnieuw beginnen" online (RESET bewust niet toegestaan);
  nieuw spel = nieuwe kamer.
- Anonieme logins kunnen kamers maken (max 5 per gebruiker); eventueel later
  CAPTCHA/rate limit op anonieme aanmelding in Supabase Auth.
