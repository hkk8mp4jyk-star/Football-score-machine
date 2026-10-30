# CLAUDE.md — Football Score Machine

Overdracht voor nieuwe Claude Code-sessies. Lees dit eerst. Taal met de
gebruiker: **Nederlands**. De gebruiker werkt op **mobiel**.

Digitale fruitautomaat voor een voetbalpool. React-app (prototype
goedgekeurd) die stap voor stap een instelbaar multiplayer-spel wordt via
Supabase V2 (1–12 spelers, 1–4 vaste rondes, eigen pool, optionele veiling).
Backend (database, Edge Function `game`, live tests 5A/5B) staat op V2 met de
oude, vaste spelregels. **Huidige stand: plan F1–F12 (§10); F1 (engine)
en F2 (machine-UI instelbaar) klaar en goedgekeurd; F3 wacht op opdracht.** Elke fase pas na expliciet akkoord van de
gebruiker. **Commit/push alleen na expliciete toestemming per keer.**

---

## 0. Werkafspraken (altijd)

- **DEMO openen**: de DEMO blijft bestaan als interne testmodus en is straks
  (na F7) alleen bereikbaar via **`?demo`** achter het webadres, bijv.
  `https://<gebruiker>.github.io/<repo>/?demo` of lokaal
  `http://localhost:5173/?demo`. Er komt geen zichtbare DEMO-knop. Tot F7
  opent de app nog direct in de DEMO. De DEMO mag niet onbedoeld veranderen
  (standaardinstellingen, zie §1; pixel-/timingregressie bij wijzigingen).
- **Publiceren**: ontwikkelen op de ontwikkelbranch. Pas als multiplayer
  volledig werkt en op meerdere telefoons is getest, een voorstel doen voor
  `main`. Samenvoegen, publiceren en deployen alleen met expliciete
  toestemming. De verborgen DEMO moet ook na publicatie werken.

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

### 1a. Instelbaar spel (multiplayer, besluiten D1–D11, 30-10-2026)

- **Deelnemers**: 1–12. Iedereen kan een spel organiseren en doet dan zelf
  mee (eigen naam bij aanmaken). Anderen melden zich aan met een eigen,
  unieke naam via uitnodigingslink of kamercode (**geen QR-code**). Alleen de
  organisator beheert (instellingen, volgorde, verwijderen vóór de start).
- **Namen**: 1–20 tekens, spaties aan begin/eind weg, **eerste letter
  hoofdletter**, rest zoals ingevoerd (`lars` → `Lars`, `PATRICK` →
  `PATRICK`, `van dijk` → `Van dijk`); uniek binnen een spel ongeacht
  hoofdletters; stuurtekens geweigerd.
- **Volgorde**: standaard aanmeldvolgorde; organisator kan slepen of
  "Loot volgorde"; bij de start definitief.
- **Vaste rondes**: 1–4, **slangvolgorde** (ronde 1 vooruit, 2 achteruit,
  3 vooruit, 4 achteruit); iedereen precies één keer per ronde.
- **Prijs per vaste trekking**: instelbaar, voor alle vaste trekkingen gelijk;
  in een nieuw multiplayer-spel **standaard leeg** en verplicht in te vullen
  vóór de start; **€0,00 toegestaan**; vrije bedragen (in centen, max
  €10.000). De DEMO houdt €10.
- **Pool**: keuze uit **0-0 t/m 6-6 (49)** + **OVERIG (verplicht)**, dus max.
  50. OVERIG = elke werkelijke uitslag die niet afzonderlijk in de pool staat.
  Elke uitslag valt maximaal één keer. MEGA WIN per geselecteerde uitslag aan
  te zetten; **OVERIG nooit MEGA WIN**. OVERIG- en MEGA WIN-animatie blijven.
- **Veiling (optioneel)**: `A = P − N × R` (P = pool incl. OVERIG, N =
  spelers, R = rondes), **0 ≤ A ≤ 10**. A = 0: geen veiling, klaar na de
  laatste vaste trekking. Alle 48 combinaties van N en R zijn mogelijk mits
  de pool klopt (12 × 4 = 48 vast; met alle 50 uitslagen → A = 2).
  Organisator kiest koper + bod, geeft de beurt vrij; alleen die koper krijgt
  SPIN; organisator kan namens de koper draaien; bod telt op bij het
  persoonlijke totaal.
- **Veilingtegels**: 1–4 op één rij **boven** de machine; 5–10 eerste rij
  boven en tweede rij onder de machine: 5 = 3+2, 6 = 3+3, 7 = 4+3, 8 = 4+4,
  9 = 5+4, 10 = 5+5 (`auctionRows(n)`). Eén tegelbreedte per spel = breedte bij
  `max(4, bovenste rij)` kolommen: nooit groter dan de goedgekeurde tegels bij
  4 per rij, bij 9/10 smaller; rijen met minder tegels gecentreerd. Getrokken
  tegels verdwijnen op hun plek, niets schuift; vormgeving en animatie
  blijven. Bij 0 kavels geen veilingscherm (direct eindstand).
- **Willekeur**: geen toewijzing vooraf aan spelers of posities, geen vooraf
  gegenereerde volgorde; bij elke SPIN kiest de server cryptografisch uniform
  één uitslag uit de rest, die definitief verdwijnt; ook de organisator heeft
  geen voorkennis. Dat de uitslag ~4,3 s vóór stilstand in netwerkverkeer te
  zien is, is **geaccepteerd (D9)**.
- **Registratie**: sluit bij de start; daarna geen nieuwe spelers (vergeten =
  nieuw spel). Bestaande spelers kunnen terugkeren (zelfde browser).
  Aanmelden en starten mogen ook gelijktijdig nooit tot een inconsistente
  status leiden (D8, oplossing in F3/F4).
- **Einde**: automatisch eindoverzicht voor iedereen (uitslagentabel, overzicht
  per deelnemer, bedragen, **totale pot**), **geen winnaar**; knop "Terug naar
  beginscherm" (geen knop "Nieuw spel"); "Deel einduitslag" als afbeelding.

### 1b. Standaardspel (DEMO, `DEFAULT_CONFIG`)

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

**Nieuwe schermen (multiplayer, in de bestaande stijl; machine ongewijzigd):**
- **Beginscherm**: "Nieuw spel", "Meedoen", "Geschiedenis"; bij een actief
  spel automatisch "Verder met huidig spel". Geen DEMO-knop (DEMO via `?demo`).
- **Nieuw spel**: eigen naam → kamer → instellingen → uitnodigen → wachten →
  volgorde → start. **Meedoen**: kamercode + naam; via een uitnodigingslink
  (`?kamer=CODE`) direct naar de aanmelding van die kamer.
- **Uitnodigen**: link delen (deelmenu/WhatsApp), link kopiëren, code tonen.
- **Wachtkamer**: iedereen ziet wie er is en "wachten op de organisator";
  alleen de organisator: instellingen, verwijderen, volgorde slepen/loten,
  starten.
- **Instellingen**: rondes, prijs (leeg tot ingevuld), raster 0-0 t/m 6-6 met
  modi "Meedoen"/"MEGA WIN", OVERIG altijd aan, teller P / N × R / A met
  directe melding; start alleen bij 0 ≤ A ≤ 10 en ingevulde prijs.
- **Spel**: bestaande hoofd- en veilingschermen; online menu (geluid,
  organisator: "draai namens", "plek vrijgeven"); klein verbindingsbalkje.
  Rollen tonen 0–6 + ★ alleen als de pool scores > 4 bevat (anders
  ongewijzigd 0–4 + ★); overzicht toont het raster van de pool.
- **Eindscherm**: overzicht (beide tabbladen) + totale pot, "Deel einduitslag",
  "Terug naar beginscherm"; geen winnaar.
- **Deelafbeelding**: eigen compacte mobiele opmaak (donker/goud), boven titel
  "Football Score Machine", speeldatum, totale pot; dan de volledige
  uitslagentabel (spelers, uitslagen, totalen); dan per speler alle
  uitslagen, veilingtrekkingen en bedragen. Leesbaar tot 12 spelers.
  Delen via het deelmenu; anders opslaan als terugval.
- **Geschiedenis** (lage prioriteit, uitstelbaar): alleen afgeronde spellen,
  laatste 10 per speler (datum, organisator, aantal spelers, eigen totaal),
  openen → eindoverzicht, opnieuw delen. Herkenning via de browseridentiteit
  (andere telefoon/gewiste gegevens = niet zichtbaar).

## 5. React-architectuur en spelengine

```
src/game/config.js     standaardregels (DEMO), ALL_RESULTS (0-0…6-6 + OVERIG), grenzen, timing
src/game/gameConfig.js spelinstellingen: DEFAULT_CONFIG, validateConfig, turnOrder (slang),
                       drawTurns/auctionLots, normalizePlayerName, sortResults
src/game/engine.js     pure reducer, tijdgestuurd (STATE_VERSION = 3, instellingen in de status)
src/game/timeline.js   alle vertragingen per draai (commit/release/tegels)
src/game/view.js       deriveView(state, now, ack) → wat het scherm toont
src/game/clock.js      gedeelde klok met offset (servertijd)
src/game/random.js     secureRandomInt (crypto, rejection sampling), secureId
src/game/reelMotion.js bewegingsprofiel van de rollen (buildProfile(p0, doel, ms, symbolen))
src/game/money.js      bedragen in centen en opmaak
src/game/useGame.js    lokale demo-adapter (localStorage 'fsm-demo-state')
src/App.jsx            schermen, rollen (organisator/deelnemer), geluid
src/components/*       MainScreen, AuctionScreen, Header, SlotMachine, Reel,
                       Overview, AuctionSetup, DemoMenu, MegaWin, OtherBanner
src/audio/sound.js     synthetische geluiden
```

**Instellingen in de schermen (F2)**: geen nieuwe props-ketens; elk scherm
leest `configOf(state)` uit de spelstatus die het al kreeg.
- `MainScreen`: `turnOrder`/`drawTurns`/`playerName`, `RoundBadges rounds`,
  "Trekking x van N×R", "Hierna: … / Veiling / Eindstand", knop "Bekijk de
  eindstand" i.p.v. "Start de veiling" als er geen veiling is.
- `AuctionScreen`: namen, "Kavel x van A", `auctionRows`; rijen met 4 tegels
  bij 4 kolommen houden de oorspronkelijke opmaak, andere krijgen
  `lot-row-fixed` + `--cols`; onderste rij alleen als er tegels zijn.
- `SlotMachine`/`Reel`/`reelMotion`/`reelTargets(id, symbolen)`: rol met
  `reelSymbolsFor(config)` symbolen: 6 (0–4 + ★, DEMO) of 8 (0–6 + ★) als de
  pool een score boven 4 bevat; **de ster is altijd het laatste symbool**
  (standaard plek 5, groot plek 7; een 5 of 6 is dus nooit een ster).
  Timing en beweging ongewijzigd.
- `Overview`: raster `gridGoalsFor(config)` (0–4, of tot de hoogste score in de
  pool; klassen `grid-wide grid-6/7`, `--grid-cols`); scores buiten de pool
  `is-excluded` (gedimd, stippelrand, zonder "Vrij"); per deelnemer in
  speelvolgorde met `priceCents`.
- `AuctionSetup` (`players`), `DemoMenu` (`config`), `App` (MEGA via
  `spinIsMega(spin)`, "Alle P uitslagen …").
- `Header`: `PlayerSpot` lange namen (> 12 tekens `is-long`, > 16 `is-xlong`);
  `RoundBadges` bij 3–4 rondes `rounds-many` (compacter; knop toont dan
  "Uitslagen ›", via `:has()`).
- CSS: één blok "Instelbare spellen (F2)" onderaan `index.css`, alleen nieuwe
  klassen; enige wijziging in bestaande CSS: `repeat(var(--grid-cols, 5), …)`
  (zonder variabele identiek).

**Engine-principes** (moet ongewijzigd ook op de server werken):
- State (versie 3): `{version: 3, config, phase:'draw'|'auction'|'finished',
  turn, remaining, draws[{resultId, participant, round, bid, at}],
  auctionBoard, auctionTurn{participant,bid}|null,
  spin{id,resultId,participant,round,bid,startedAt,mega}|null, lastSpin}`.
- `config = {players:[{id,name}] in speelvolgorde, rounds, priceCents, pool,
  mega}`; pool en mega in overzichtsvolgorde (`sortResults`). `participant`
  = vast speler-id (0–11), niet de positie. `createInitialState(config =
  DEFAULT_CONFIG)` valideert (`ConfigError`). Zonder `config` (oud) gelden de
  standaardinstellingen (`configOf`).
- Na N × R vaste trekkingen: veiling als A > 0 (bord = rest in
  overzichtsvolgorde), anders direct `finished`. `AUCTION_PREPARE` alleen voor
  een bestaande speler en bod ≥ 0. SPIN alleen in `draw`/`auction`.
- `spin.mega` ligt vast bij SPIN; `timeline.spinIsMega(spin)` valt voor oude
  draaien terug op `MEGA_WIN_IDS`. Geld: `drawValueCents(draw, priceCents)`,
  `totalCents(draws, priceCents)`, `potCents(state)`; standaard €10.
- DEMO-opslag versie 2 krijgt bij `restoreState` de standaardinstellingen
  (voortgang blijft); versie 3 met ongeldige instellingen → nieuw spel.
- Willekeur alleen bij `SPIN_START` (één aanroep van `randomInt` uit de rest);
  de beginstatus bevat geen volgorde of willekeur.
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
  wachtwoorden). Live te testen met `npm run fn:test:5a` (zie §7b).
- **Terugkeren**: zelfde browser = zelfde anonieme identiteit → zelfde plek,
  zonder opnieuw naam te vragen; de organisator houdt zo zijn rechten.
  Nieuwe telefoon/andere browser/gewiste gegevens: geen herstel van
  organisatorrechten (D6, geen herstellink); geen automatische overdracht.
- **Publieke sleutel frontend (D10)**: alleen de publieke (publishable/anon)
  sleutel, via een **GitHub-repositoryvariabele** in de build
  (bijv. `VITE_SUPABASE_PUBLISHABLE_KEY`); lokaal `.env.local` (niet in Git).
  Nooit een service_role-sleutel in de frontend. Claude begeleidt de
  GitHub-instellingen stap voor stap wanneer F11 aan de orde is.
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
  omgevingsinstellingen; nodig voor `fn:test:*`).

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
- **Gepland: migratie 3 (F4, nog niet gemaakt of uitgevoerd)** voor het
  instelbare spel: `draws.result_id` check → 0-0 t/m 6-6 + OVERIG (50);
  `draws.round` → `'1'`–`'4'` of `'veiling'`; `seats.participant` → 0–11
  (vast speler-id; speelvolgorde staat in `state.config`); nieuwe kolom
  `seats.name` (1–20) met unieke index `(room_id, lower(name))`; index
  `seats(user_id)` (Geschiedenis). **D8 (aanmelden vs. starten)**: voorstel
  twee triggers die dezelfde `rooms`-rij vergrendelen: een `seats`-insert
  wordt geweigerd als de kamer niet meer in de wachtkamer staat, en de
  overgang wachtkamer → gestart wordt geweigerd als de plaatsen niet precies
  overeenkomen met `config.players`. Zo serialiseert Postgres beide acties;
  `commit_room_state`, RLS en publicatie blijven ongewijzigd. Uitwerking en
  akkoord in F3/F4.
- Tests: `supabase/tests/security.sql` (51 checks, in een rollback-transactie)
  + echte concurrency-test (10 gelijktijdige commits → precies 1 slaagt,
  testkamer `ZZTEST` wordt opgeruimd). Laatste run: **52/52 geslaagd**,
  database daarna leeg.

## 7b. Edge Function `game` (fase 3, gebouwd)

Eén functie, uitgerold als `game` (`npm run fn:deploy`), URL
`https://twzjsmxydnfmowrmffsl.supabase.co/functions/v1/game` (V2: versie 1,
ACTIVE, verify_jwt uit, uitgerold 30-10-2026). Schemawijziging na fase 3: alleen migratie 2 (PT409).

```
supabase/functions/game/index.ts  Deno-ingang: token controleren, service_role-client
src/server/actions.js             alle acties + autorisatie (gedeeld met tests)
src/server/http.js                CORS, POST/JSON, Bearer-token, foutcodes → HTTP
src/server/supabaseStore.js       opslag via supabase-js; status alleen via commit_room_state
scripts/server-integration.mjs    serverlogica tegen de echte database (in db:test)
scripts/live-test.mjs             live test in fasen 5a/5b/5c met echte anonieme logins
tests/live-test.test.js           lokale tests van het live-testscript (zonder netwerk)
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
- **Live test** (`scripts/live-test.mjs`), drie afzonderlijke fasen; één
  fase per run, nooit automatisch een volgende:

| Commando | Fase | Inhoud |
|---|---|---|
| `npm run fn:test:5a` | 5A basis | 3 anonieme logins (na elkaar), 401-controles, servertijd, kamer, opzoeken, naam claimen, weigeringen, **één** SPIN, status ophalen, herstel (opnieuw versturen → geen 2e trekking; later ophalen → beurt vrij). **Geen** gelijktijdige verzoeken (lokaal getoetst: max. 1 verzoek tegelijk) |
| `npm run fn:test:5b` | 5B beperkt | 1 login, kamer, **2** gelijktijdige SPIN's |
| `npm run fn:test:5c -- --bevestig` | 5C uitgebreid | idem met **10**; zonder `--bevestig` weigert het script |

  - 5B/5C controleren apart: (1) **client**: precies één 200, de rest 409
    (`turn_not_released`/`conflict`), nooit 5xx; (2) **database**: precies
    één trekking, versie 1; (3) **PostgREST-logs** (intern):
    `commit_room_state` 1× 200, k× 409 (= PT409), 0× 5xx, alle RPC's
    200 of 409 (`rpcAll = rpc200 + rpc409`), k ≤ 3·(n−1);
    (4) **geen lus**: na 10 s alle tellingen ongewijzigd,
    `version_conflict` = RPC 409, geen `idle in transaction`, rollbacks
    begrensd.
  - **Logpatronen** (`LOG_PATTERNS`, `logStatsSql()`, `countLogLines()` in
    het script): gateway-regels `POST | <status> | https://<ref>.supabase.co/rest/v1/rpc/commit_room_state …`
    via `match()` met **alleen tekenklassen, geen backslashes** (`[|]`,
    `[.]`), pad exact (`( |[?]|$)`), alleen echte HTTP-methoden;
    `version_conflict` = exact databasebericht. **De log-SQL van Supabase
    verwijdert backslashes**: `\|` wordt `|` (regex-"of"). Nooit backslashes
    in logpatronen gebruiken. Intern PT409 ≠ client-409: de
    server herhaalt een PT409 (max 3) en de client ziet daarna meestal
    `turn_not_released`. Is k = 0 (geen overlap), dan slaagt de fase met
    waarschuwing "PT409 niet aangetoond".
  - Veiligheid: alleen project `twzjsmxydnfmowrmffsl` (anders exit 2, ook via
    `SUPABASE_PROJECT_REF`); elk verzoek tijdslimiet incl. lezen van het
    antwoord (beheer 30 s, functies 20 s); herhalingen begrensd (429: 5,
    login "nog niet klaar" 404/503: 6 pogingen, `game`-verzoeken nooit);
    fasetijdslimiet (5A 240 s, 5B/5C 180 s) breekt lopende testverzoeken af;
    stappen na elkaar, stop bij eerste fout.
  - Opruimen in `finally`, altijd: testkamers (op organizer-id), anonieme
    testgebruikers (alleen eigen id's, `is_anonymous`), hulpfunctie, daarna
    controle "niets achtergebleven". Elke stap 30 s, geheel 120 s.
  - Voor- en nacontrole: diensten gezond, geen hangende transacties.
  - **Exitcodes**: 0 geslaagd · 1 test mislukt · 2 verkeerd gestart/project
    · 3 opruimen onvolledig (handmatig controleren!) · 4 voorcontrole mislukt
    (niets aangemaakt) · 5 fasetijdslimiet.
  - Hulpfunctie `fsm-testlogin`: doet `signInAnonymously()` met de sleutel uit
    de eigen functie-omgeving, beveiligd met een eenmalige code; het script
    ziet nooit een API-sleutel.

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
4. **Gedaan 30-10-2026**: `npm run fn:deploy` (code identiek aan lokaal
   geteste commit 90e0265) → `game` versie 1, ACTIVE, verify_jwt uit.
   Verificatie zonder geldige login: zonder token, ongeldig token en
   Basic-header → 401 `unauthorized` (JSON van onze code); GET → 405;
   OPTIONS → 204 met CORS. Logs: functie start in ~35 ms, geen fouten;
   ongeldig token werd echt bij Auth gecontroleerd (`bad_jwt` in Auth-log →
   401). Daaruit volgt: `SUPABASE_URL` en `SUPABASE_SERVICE_ROLE_KEY` zijn
   aanwezig (anders start `index.ts` niet) en de gateway accepteerde de
   service-sleutel richting Auth. Nog niet bewezen: database-acties via
   PostgREST met de service-sleutel (volgt in stap 5a). Database daarna leeg,
   alle diensten gezond.
5. **5A gedaan 30-10-2026 14:38 UTC** (`npm run fn:test:5a`, script =
   commit ffec8f7, één keer): **13/13 stappen, exitcode 0**. Echte anonieme
   login (3×), 401 zonder/ongeldig/vervalst token, klokafwijking 161 ms
   (rondreis 376 ms), kamer + opzoeken (geen user-id's), naam claimen,
   weigeringen, precies één SPIN (`commit_room_state` 1× 200 via PostgREST:
   Edge Function ↔ PostgREST met service-sleutel werkt), status ophalen
   synchroon, opnieuw versturen → `turn_not_released` (geen 2e trekking),
   later ophalen → uitslag vastgelegd en beurt vrij. Opruimen volledig
   (kamers, 3 testgebruikers, hulpfunctie; 0 sessies). Onafhankelijk
   nagecontroleerd: database leeg, alleen `game` aanwezig, alle diensten
   gezond, 15 verbindingen (2 PostgREST + 1 Auth-pool, idle; vooraf 13),
   geen hangende transacties of locks, geen fouten/5xx in de logs, geen
   `version_conflict`. Alle REST-statussen: 200/201, plus 1 bedoelde 409
   (`seats`, bezette naam).
   **5B gedaan 30-10-2026 14:54:32–14:55:22 UTC** (`npm run fn:test:5b`,
   script = commit 41f46bd met gerepareerde logtelling, één keer): **8/8
   stappen, exitcode 0**. 1 anonieme login, kamer, 2 gelijktijdige SPIN's.
   (a) *Gelijktijdige verzoeken correct afgehandeld*: client 1× `200`, 1×
   `409 turn_not_released`; database precies één trekking, versie 1.
   (b) *PT409 via PostgREST aangetoond*: `commit_room_state` 1× `POST | 200`
   (14:54:43.462) en 1× `POST | 409` (14:54:43.639), 0× 5xx, `rpcAll` 2 =
   200 + 409; precies één `version_conflict` in de databaselog
   (14:54:43.726). Het intern PT409 werd door de server opnieuw geprobeerd en
   eindigde bij de client als `turn_not_released`. Geen herhaallus:
   tellingen identiek na 10 s én bij onafhankelijke hermeting minuten later
   (5B-venster = 5B-start tot nu). Rollbacks 35 → 36 (alleen het PT409).
   Opruimen volledig (kamer, 1 testgebruiker, hulpfunctie; 0 sessies).
   Nacontrole: database leeg, alleen `game`, alle diensten gezond, 16
   verbindingen (3 PostgREST + 1 Auth, idle), geen hangende transacties of
   wachtende locks, geen 5xx/`PGRST`/fouten in de logs.
   Daarna, met eigen akkoord: **5C** `npm run fn:test:5c -- --bevestig`. Na elke fase: exitcode en opruimen beoordelen;
   bij exitcode ≠ 0 niet doorgaan en niet automatisch herhalen.
   **Stopcriterium**: één 5xx, time-out of hangende verbinding.

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
- **F2 machine-UI instelbaar (30-10-2026, lokaal)**: `npm test` → **196
  tests** (160 + 36 in `tests/ui-config.test.jsx`, componenten gerenderd met
  `react-dom/server`): DEMO-HTML van 16 schermen identiek aan de componenten
  van vóór F2 (`tests/fixtures/demo-markup-v2.json`, generator
  `tests/demoMarkup.jsx`); rollen 5/6 (doelen, ster, beweging en timing bij 6
  en 8 symbolen); 1–12 × 1–4 naam/slang/badges/teller/"Hierna" bij elke beurt;
  3–4 rondes compact; lange namen; zonder veiling "Bekijk de eindstand";
  tegelindeling 1–10, rij boven/onder, vaste posities na verkoop; overzicht
  standaard 5×5, alle 50 (7×7), deels geselecteerd (gedimd); per deelnemer
  €0 en €7,50 + biedingen; veilingvenster met eigen spelers; MEGA eigen lijst.
  **DEMO browser**: oude build (vóór F1) vs. F2-build, vaste klok,
  `animations: 'disabled'`: **16/16 schermen pixel-identiek** (7 spelverloop +
  overzicht beide tabs, DEMO-menu, veilingvenster, veiling-overzicht/-menu,
  knop eindstand, eindstand beide tabs; opgeslagen v2-standen). **Visuele
  controle** nieuwe instellingen: 22 opnames × 4 breedtes (320, 390, 430,
  1280 px), geen horizontaal scrollen, geen consolefouten; bevinding 4 rondes
  overlapten de knop "Uitslagen bekijken" → opgelost met `rounds-many`
  (gemeten ruimte bij 320 px 14 px, bij 390 px 46 px).
- **F1 engine instelbaar (30-10-2026, lokaal)**: `npm test` → **160 tests**
  (120 bestaande ongewijzigd groen + 40 nieuw in `tests/gameConfig.test.js`
  en `tests/engine-config.test.js`): 50 uitslagen; slangvolgorde voor alle
  1–12 × 1–4; validatie (alle 48 combinaties met A = 0 en max, A = 11 en
  te kleine pool geweigerd, spelers/namen/prijs/pool/MEGA/OVERIG);
  volledige spellen voor alle combinaties met veiling 0 / midden / max (144
  spellen) incl. 12 × 4 met 50 uitslagen (A = 2) en 1 × 1 alleen OVERIG;
  veiling 0 (direct klaar) en 10 (vaste posities); geld incl. €0, €7,50 en
  pot; MEGA eigen lijst, oude draai zonder vlag, OVERIG nooit MEGA;
  willekeur alleen bij SPIN, uniform (10.000 × uit 50 en 10.000 veilingtrekkingen
  uit 10, chi-kwadraat). **DEMO ongewijzigd**: referentie van de engine vóór
  F1 (`tests/fixtures/engine-v2-golden.json`, 20 volledige spellen, elke
  tussenstand als vingerafdruk) identiek; opgeslagen v2-standen (lopende draai
  en veiling) hersteld zonder verlies; browser-pixelvergelijking oude vs. nieuwe
  build met vaste klok en `animations: 'disabled'`: 7/7 schermen identiek.
  Geen visuele componenten gewijzigd; niets op Supabase.
- **Fase 3** (gebouwd): Edge Function `game` uitgerold
  (ACTIVE, verify_jwt uit). `npm test` → **85 tests** (51 + 34 servertests:
  toegang/invoer, kamer/namen, SPIN-autorisatie, noodfunctie, veiling,
  10 gelijktijdige SPIN's/claims, 10.000 proeftrekkingen chi-kwadraat,
  herstel, versieconflict, HTTP-laag). `npm run db:test` → **58/58**
  (52 + 6 servertests tegen de echte database als service_role, incl. volledig
  spel 18+8 en gelijktijdigheid; database daarna leeg). Rooktest in Deno 2.5
  (`deno check` + handler) geslaagd.
- **Logtelling 5B/5C gerepareerd**: `npm test` → **120 tests** (zie
  Openstaande punten → "Opgelost: foutieve 5xx-logtelling").
- **Live-testscript in fasen (lokaal)**: `npm test` → **110 tests** (+22 in
  `tests/live-test.test.js`: fasekeuze en 5C-bevestiging, projectbewaking
  (oud project geweigerd, alle URL's naar V2), tijdslimiet bij hangend
  verzoek/hangende inhoud/genegeerd afbreeksignaal, 429 en login begrensd,
  `game` nooit herhaald, afbreken; 5A slaagt met max. 1 gelijktijdig verzoek
  en 1 trekking; opruimen altijd, ook bij fasetijdslimiet; hangend opruimen →
  exit 3; 5B precies 2 en 5C precies 10 gelijktijdige SPIN's; 5xx of
  oplopende conflicten → mislukt; k = 0 → waarschuwing). Commandoregel:
  verkeerd starten → exit 2 zonder netwerkverkeer.
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

## 10. Implementatieplan instelbaar multiplayer-spel (F1–F12)

Elke fase apart akkoord; L = alleen lokaal, V2 = wijziging op Supabase V2.
Backendtests 5A/5B (oude, vaste regels) zijn het uitgangspunt; 5C is
voorlopig overgeslagen.

| Fase | Inhoud | Waar | Status |
|---|---|---|---|
| **F1** | Engine instelbaar (§5): 1–12 spelers, 1–4 rondes, slang, pool 0-0…6-6 + OVERIG, MEGA per uitslag, prijs (ook €0), veiling 0–10, namen/volgorde; DEMO = standaard | L | **klaar en goedgekeurd** (commit a9e5b88) |
| **F2** | Machine-UI instelbaar: namen/volgorde uit `config`, rondebadges R, "Trekking x van N×R", "Bekijk de eindstand" bij A = 0, tegelindeling 1–10 (max. tegelgrootte), rollen tot 6 alleen bij pool > 4, raster tot 6-6, prijs per trekking; DEMO pixel-identiek | L | **klaar en goedgekeurd** (30-10-2026) |
| F3 | Server: wachtkamer, `join_room(code, naam)`, `update_settings`, `set_order`/`shuffle_order` (server-crypto), `remove_player`, `start_game` (volledige validatie, `validateConfig`), SPIN/veiling pas na start, terugkeer via `lookup_room`; migratie 3 + D8-triggers + `security.sql` in PGlite; unittests | L | |
| F4 | Migratie 3 + `db:test` | V2 | |
| F5 | Uitrol `game` + live tests 5A/5B aangepast aan wachtkamer/start | V2 | |
| F6 | Online fundament frontend: supabase-js, publieke sleutel (env), `callGame` (tijdslimiet, nooit automatisch herhaald), kloksync, statusopslag (hoogste versie wint), sessie/terugkeer | L | |
| F7 | Schermen Begin (+ "Verder met huidig spel"), Nieuw spel, Meedoen, Wachtkamer, Instellingen, Volgorde; router met `?demo` en `?kamer=`; Playwright tegen nagebootste server | L | |
| F8 | Online spel: synchrone animaties (servertijd), herstel, online menu ("draai namens", "plek vrijgeven"), verbindingsbalkje; daarna korte live test | L → V2 | |
| F9 | Veiling online (0–10, tegelindeling) | L → V2 | |
| F10 | Eindscherm (pot, terug), deelafbeelding (canvas → PNG, deelmenu/opslaan) | L | |
| F11 | Publieke sleutel als GitHub-variabele (begeleid), test op telefoons; daarna pas voorstel voor `main`/Pages (toestemming) | V2/Pages | |
| F12 | Geschiedenis (afgeronde spellen, laatste 10, opnieuw delen) — uitstelbaar | L → V2 | |

- **Risico's**: DEMO (statusversie, engine) → referentietest + pixelvergelijking;
  goedgekeurde machine (rollen, tegels) → alleen anders bij afwijkende pool/A,
  eerst schermafbeeldingen; servertests en live-testscripts bewegen mee in
  F3/F5; de server (`src/server/actions.js`) gebruikt tot F3 nog de vaste
  `TURN_ORDER`/`PARTICIPANTS` en werkt daarmee alleen met de
  standaardinstellingen (ongewijzigd uitgerold op V2).
- **Uitstelbaar/optioneel**: Geschiedenis + delen vanuit Geschiedenis,
  slepen (eerst ▲▼), Presence ("nu online"), verharding van de ~4,3 s.
- **Later**: PWA (beginscherm-icoon) + pushmelding "Jij bent aan de beurt!",
  eventueel zachte drempel naar standalone-modus.

### Openstaande punten
- Uitslag ~4,3 s vóór stilstand in netwerkverkeer zichtbaar: **geaccepteerd
  (D9)**, geen verharding.
- Token mist `advisors_read` (security advisors niet op te vragen).
- Supabase free plan pauzeert na 7 dagen inactiviteit.
- Het access token heeft volledige rechten: na de bouw intrekken/vernieuwen.
- **Opgelost (migratie 2, op V2 geïnstalleerd en live bewezen in 5B)**:
  foutcode 40001 in `commit_room_state` liet PostgREST vastlopen bij
  gelijktijdige SPIN's.
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
- **Opgelost (30-10-2026): foutieve 5xx-logtelling.** Oorzaak (read-only
  bevestigd op de 5A-logs): de log-SQL van Supabase haalt backslashes weg,
  waardoor `'^POST \\| 5[0-9][0-9] \\| …'` werd uitgevoerd als
  `^POST | 5[0-9][0-9] | …` (alternatieven) en elke regel die met `POST`
  begint telde: 29 = precies het aantal POST-regels in het 5A-venster (oude
  query 29, dezelfde regex zonder backslashes 29, met `[|]` 0). Oplossing:
  patronen zonder backslashes (zie §7b), extra telling `rpcAll`, strengere
  controles in 5B/5C. Lokaal: `npm test` **120** (+10: representatieve
  logregels 200/409/500/504, niet-RPC-regels, misleidende cijfers en namen,
  querystring, exact `version_conflict`, geen backslashes, regressie oude
  patroon; 5B mislukt bij andere RPC-status, te veel PT409, of
  `version_conflict` ≠ RPC 409). Live read-only met `logStats` van het
  script: 5A-venster 14:38:40–14:39:14 en "5A tot nu": rpcAll 1, rpc200 1,
  rpc409 0, rpc5xx 0, version_conflict 0; ruim venster vanaf 14:00:
  idem maar version_conflict 18 (= db:test 14:13–14:14 via directe SQL,
  geen PostgREST) — daarom telt 5B alleen vanaf 5 s vóór de eigen
  gelijktijdige verzoeken. Onafhankelijke controle: sinds 14:00 precies één
  RPC-logregel (`POST | 200`).
- Organisator die van telefoon/browser wisselt verliest organisatorrechten
  (`organizer_id` = oude anonieme gebruiker); **geaccepteerd (D6)**, geen
  herstellink en geen overdracht.
- Geen "spel opnieuw beginnen" online (RESET bewust niet toegestaan);
  nieuw spel = nieuwe kamer.
- Anonieme logins kunnen kamers maken (max 5 per gebruiker); eventueel later
  CAPTCHA/rate limit op anonieme aanmelding in Supabase Auth.
