# CLAUDE.md — Football Score Machine

Overdracht voor nieuwe Claude Code-sessies. Lees dit eerst. Taal met de
gebruiker: **Nederlands**. De gebruiker werkt op **mobiel**.

Digitale fruitautomaat voor een voetbalpool. React-app (prototype
goedgekeurd) die stap voor stap een instelbaar multiplayer-spel wordt via
Supabase V2 (1–12 spelers, 1–4 vaste rondes, eigen pool, optionele veiling).
Backend (database, Edge Function `game`, live tests 5A/5B) staat op V2 met de
oude, vaste spelregels. **Huidige stand: plan F1–F12 (§10); F1 (engine)
en F2 (machine-UI instelbaar) klaar en goedgekeurd; F7 (multiplayer-schermen)
plus het online spelverloop goedgekeurd en vastgelegd (commit **054320c**).
Echte Supabase-koppeling (migratie 3, Edge Function `game` v2, frontend
`realApi`) vastgelegd in commit **3f3f740**; op V2 (31-10-2026, elk apart
akkoord): migratie 3 toegepast, `db:test` 72/72, `game` **v2 uitgerold**
(ACTIVE), live tests 5A 15/15, 5B 9/9 en **5D 24/24** geslaagd.
**01-11-2026: volledige spelcyclus werkt tegen de echte V2** (productiebuild
+ echte publieke sleutel, 3 onafhankelijke browsers, 320/390/430 px: 45/45,
44/45, 45/45; enige afwijking: 4 trage leesverzoeken + 1 platform-504, zie
Openstaande punten). DEMO 16/16 pixel-identiek, 0 Supabase-verzoeken.
Commit **b0916b1** (5D + publicatieworkflow). **F10 (eindscherm + deelbare
PNG per tabblad) en F12 (geschiedenis, localStorage) goedgekeurd en
gecommit (01-11-2026).** Gepubliceerd op `main` (41932a8, GitHub Pages:
`https://hkk8mp4jyk-star.github.io/Football-score-machine/`). **F13
(openingsbeleving + START SPEL + `game` v3) live (02-11-2026)**: commit
`571db27` op `main` (Pages-run 41427900678), `game` **v3 ACTIVE** op V2, live
5A 15/15 en 5D 24/24 geslaagd, zie §4b. Nog: telefoontest, eigen Viva-fragment. Elke fase pas na expliciet akkoord van de
gebruiker. **Commit/push alleen na expliciete toestemming per keer.**

---

## 0. Werkafspraken (altijd)

- **DEMO openen**: de DEMO blijft bestaan als interne testmodus en is (sinds
  F7) alleen bereikbaar via **`?demo`** achter het webadres, bijv.
  `https://<gebruiker>.github.io/<repo>/?demo` of lokaal
  `http://localhost:5173/?demo`. Er is geen zichtbare DEMO-knop. Zonder
  `?demo` opent het online beginscherm (`src/App.jsx` → `DemoApp`/`OnlineApp`). De DEMO mag niet onbedoeld veranderen
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
  dat is geblokkeerd (token mist `api_gateway_keys_read`) en niet de
  bedoeling. **Uitzondering 01-11-2026, met expliciet akkoord**: alleen de
  publieke `sb_publishable_…`-sleutel is via een tijdelijke functie
  (`fsm-pubkey`, direct verwijderd) in `.env.local` gezet (niet in Git, alleen
  in die container). Nooit secret-/service_role-sleutels.
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

**Nieuwe flow (31-10-2026, vervangt B1; definitief):**
Home → Nieuw spel (één doorlopend formulier met de spelregels) → "Spel
aanmaken" → Wachtkamer. De organisator stelt eerst het volledige spel in;
pas daarna bestaat de kamer en kan hij uitnodigen.
- **Home**: alleen "Nieuw spel" en "Meedoen", geen kleine toelichtingen. Bij
  een actief spel: wedstrijdnaam + "Verder met huidig spel" (geen tekst over
  rondes/spelers).
- **Nieuw spel** (alles verplicht): Jouw naam (organisator, D4-regels),
  Thuisploeg, Uitploeg (elk 1–30 tekens, spaties aan begin/eind weg, verder
  zoals ingevoerd; apart opgeslagen als `match.home`/`match.away`). Deze drie
  velden zijn bij een nieuw spel **volledig leeg: geen placeholders of
  voorbeelden** (geen "Bijv. …"), alleen de labels erboven; Aantal
  deelnemers incl. organisator (zelf invullen, 1–12) en Prijs per vaste
  trekking (€, €0 mag) **naast elkaar op één regel**, beide leeg; Vaste
  rondes 1|2|3|4 (één keuze, standaard niets).
- **Wedstrijdnaam** = `"Thuisploeg – Uitploeg"` (en-dash), overal de
  speltitel (home, wachtkamer, meedoen, meldingen, uitnodiging). Clubnamen
  liggen vast na het aanmaken.
- **Uitslagen**: raster 0-0 t/m 6-6 direct zichtbaar, standaard niets
  gekozen; OVERIG altijd gekozen (niet uit te zetten); snelkeuzes blijven.
  Twee tabbladen: "Uitslagen" (alle uitslagen, kiezen wat meedoet) en
  "MEGA WIN" (uitsluitend de gekozen gewone uitslagen, nooit OVERIG). Een
  uitslag die uit de pool gaat verliest automatisch MEGA WIN.
- **Automatische controle** onder het raster, altijd zichtbaar (ook als het
  niet klopt; "–" zolang deelnemers of rondes ontbreken, negatief bij te
  weinig): Vaste trekkingen = deelnemers × rondes; Veilinguitslagen =
  geselecteerde uitslagen (incl. OVERIG) − vaste trekkingen. Geldig bij
  genoeg uitslagen, 0–10 veilinguitslagen en alle velden ingevuld.
  Teksten: "Selecteer nog X uitslagen om alle vaste trekkingen mogelijk te
  maken." / "Verwijder X uitslagen om maximaal 10 veilinguitslagen over te
  houden." / "Nog invullen: …" / "Alles klopt: … vaste trekkingen en …
  veilinguitslagen | geen veiling."
- **"Spel aanmaken"** alleen actief als alles geldig is; de server
  (`createRoom`) controleert opnieuw en maakt alleen een geldig spel; de
  organisator is speler 1; daarna wachtkamer.
- **Meedoen via code**: geen kop/label; "Vul de kamercode in die je van de
  organisator kreeg." boven het veld, codeveld, "Verder". **Via link** (en
  na de code): alleen wedstrijdnaam, naamveld en "Meedoen". Bezette naam
  (hoofdletterongevoelig): "Deze naam is al in gebruik. Kies een andere naam."
- **Wachtkamer** (rest beoordelen we later): wedstrijdnaam bovenaan,
  kamercode, "Deel uitnodiging", "Kopieer link", "x van y deelnemers"
  (y = ingesteld aantal); bij y deelnemers niemand meer toegelaten
  (`room_full`). Spelregels wijzigen kan nog (incl. aantal deelnemers, niet
  lager dan aangemeld; clubnamen niet).

**Online spel – definitief (31-10-2026, opdracht "Deel 1–10"; gaat vóór
oudere afspraken hieronder):**
- **Configureren**: velden en raster zoals "Nieuwe flow". MEGA WIN-uitslagen
  zijn **groen**, gewone gekozen uitslagen **goud**, niet gekozen donker
  (op beide tabbladen). Onvolledig (leeg, "Selecteer nog X uitslagen …",
  "Nog invullen: …") = **neutrale** melding; **rood** alleen bij echt
  ongeldig (te veel veilinguitslagen, ongeldige invoer). Negatieve
  veilinguitslagen tonen als negatief getal (bijv. -5). "Spel aanmaken" is
  donkergrijs/uitgeschakeld tot alles geldig is, daarna goud.
- **Spelnaam = wedstrijdnaam** "THUISCLUB – UITCLUB" (niet de naam van de
  organisator): wachtkamer, uitnodiging, scoremachine (clubnamen op de rollen,
  online via `teams`; de DEMO houdt "Werder Bremen II"/"Bremer"),
  startanimatie, eindstand, straks deelafbeelding en geschiedenis.
  **Beginscherm met actief spel**: de wedstrijdnaam staat direct op de gouden
  knop (geen aparte titel); verder ongewijzigd.
- **Wachtkamer organisator**: wedstrijdnaam, kamercode, "Deel uitnodiging"
  (deelmenu), "Kopieer link", teller "x van y deelnemers", deelnemerslijst
  (slepen + ▲▼, ✕ met bevestiging), spelregels met "Wijzig" (alles behalve
  clubnamen tot de start), "Loot volgorde" (direct), "＋ Deelnemer"
  (zonder telefoon), "＋ Zelf meedoen" (als de organisator zichzelf had
  verwijderd en er plek is), "Start het spel". **Geen helperteksten.**
  Standaardvolgorde = aanmeldvolgorde. De organisator is standaard
  deelnemer, kan zichzelf (met bevestiging) verwijderen en **blijft
  organisator**. **Deelnemer zonder telefoon**: door de organisator
  toegevoegd, het hele spel gekoppeld aan diens toestel (geen eigen
  toestel later), telt volledig mee; de organisator drukt voor hem SPIN.
  Ontwikkelknop heet **"＋ Testspeler"** (alleen lokale testomgeving).
- **Starten**: alleen als het **werkelijke aantal deelnemers precies gelijk is
  aan het ingestelde aantal** én alles geldig is (dus niet met 8 van 9).
  **Eén druk** op "Start het spel" start definitief (de aparte
  startbevestiging van B4 vervalt); daarna liggen deelnemers, volgorde en
  spelregels vast. De server legt `startedAt` vast; dubbele start wordt
  geweigerd (`room_changed` / `registration_closed`).
- **Wachtkamer deelnemers** (correctie 31-10-2026): één compact, verticaal
  gecentreerd blok: wedstrijdnaam, daaronder de namen in **compacte donkere
  naamvakken met subtiele gouden rand**, **1–6 deelnemers één kolom, 7–12
  twee kolommen** (kolom voor kolom gevuld, max. 6 per kolom: 7 = 4+3,
  12 = 6+6), direct daaronder de drie kleine draaiende rollen (animatie
  ongewijzigd) en "WARMING UP". Namen in aanmeldvolgorde (nog niet de
  trekkingsvolgorde; verspringt niet bij volgordewijziging), geen nummers,
  geen "Jij", geen labels. Geen volgorde, spelregels of MEGA WIN (de server
  stuurt ze ook niet). Past met 12 namen op 320 px (ook 320×568) zonder
  scrollen.
- **Gezamenlijke startanimatie** (alle telefoons, op `startedAt`, ~11–16 s):
  **A BONUS TRIGGER**: de drie rollen versnellen en stoppen één voor één op
  een gouden munt; bij de derde: gouden flits, lichtstralen, confetti,
  gekleurde lopende lampjes, "BONUSSPEL!". **B Namen**: alle namen draaien
  als grote fruitautomaat, vertragen en vallen één voor één op hun plek
  (genummerd vanaf 1) = de vóór de start vastgelegde volgorde (geen nieuwe
  loting); daarna kort de volledige volgorde. **C Welcome to Fabulous Las
  Vegas Nevada**: het originele welkomstbord (ruitvorm, rode ster met gele
  rand, WELCOME op zeven witte "dollars", blauw "to Fabulous", rood LAS
  VEGAS, blauw NEVADA, lampjes die aangaan) + samenvatting (wedstrijd,
  deelnemers, vaste trekkingen per deelnemer, prijs per vaste trekking,
  veilinguitslagen), ~3,2 s; daarna automatisch de scoremachine. Alles volgt
  uit de tijd: wie later binnenkomt valt op het juiste punt in of ziet
  direct de scoremachine (geen herhaling). SPIN kan pas na de animatie
  (`intro_running`).
- **Wie bedient de scoremachine (definitief)**: de deelnemer die aan de beurt
  is drukt zelf **SPIN** op zijn eigen telefoon; alleen hij ziet de actieve
  knop, anderen zien de machine zonder SPIN. Uitzonderingen: (1) deelnemer
  zonder telefoon → SPIN op het toestel van de organisator; (2) de organisator
  kan tijdens de actuele beurt **"Draai namens <naam>"** (knop op de plek van
  SPIN, met bevestiging "Alleen als … niet reageert"). Deelnemer en
  organisator tegelijk → precies één trekking (engine + versiecontrole; mock
  met Web Locks). Uitslag centraal en één keer; niets terug te draaien.
- **Veiling**: scoremachine, laatste uitslag en beschikbare uitslagen blijven
  zichtbaar. De organisator (hamerknop) kiest winnaar + bod (vóór bevestigen
  te corrigeren) en drukt **"Bevestig veiling"** (DEMO houdt "Beurt
  vrijgeven"): daarmee is de beurt toegewezen, er start nog géén trekking;
  daarna geen tweede bevestiging (`auction_confirmed`). Op alle telefoons
  ~2,6 s de aankondiging **"WINNAAR VEILING #n" / NAAM / €35,00** (gouden
  flits, vonken; geen tekst "Winnend bod") over de machine; `n` = werkelijk
  volgnummer van de veiling in het spel (#1, #2, …, door de server
  vastgelegd in `announce.lot`). Geen herhaling bij opnieuw verbinden
  (alleen binnen het tijdvenster). Daarna "<naam> draait voor €…" boven de
  machine; alleen de winnaar heeft SPIN (organisator kan namens). Bevestigen
  start geen trekking. Bedrag zoals "Draait voor": €35,00.
- **Verloop/betrouwbaarheid**: snake-volgorde, uitslag verdwijnt definitief,
  MEGA-animatie, OVERIG nooit MEGA, veiling na de vaste rondes, geen
  automatische volgende trekking, geen ongedaan maken, geen nieuwe
  deelnemers of volgordewijziging na de start, geen pauzeknop. Status staat
  op de server; terugkeren op hetzelfde toestel en offline deelnemers komen
  bij terugkeer op de actuele stand.
- **Faseovergangen (definitief, correctie 31-10-2026)**: **alleen de
  organisator** bepaalt wanneer de veilingfase begint ("Start de veiling",
  na de laatste vaste trekking; zonder veiling direct "Bekijk de
  eindstand") en wanneer de eindstand verschijnt ("Bekijk de eindstand", na
  de laatste veilingtrekking). Deelnemers hebben die knoppen niet (op de
  plek staat niets). De server legt de overgang **centraal en eenmalig**
  vast (`advancePhase(step)` → `room.ack.auctionStart`/`finish`; tweede keer
  `nothing_to_advance`, deelnemer `not_organizer`); alle telefoons gaan
  automatisch mee en zien bij opnieuw verbinden de actuele fase. "Bevestig
  veiling" kan pas na "Start de veiling" (`auction_not_open`). Trekking- en
  veilingregels ongewijzigd.
- **Goedgekeurd na visuele beoordeling (31-10-2026), niet wijzigen**: het Las
  Vegas-bord (formaat, vormgeving, verlichting) en de namenanimatie
  (snelheid, door elkaar draaien, vertragen, één voor één vastzetten,
  timing en effecten).
- **F10 eindscherm (goedgekeurd 01-11-2026)**: wedstrijdnaam, "Totale
  pot" in goud, de bestaande tabbladen (standaard "Per deelnemer", gelote
  volgorde), onderaan voor iedereen "Deel einduitslag" (goud) en "Terug naar
  beginscherm"; geen winnaar. Alleen online; DEMO ongewijzigd.
- **F10 "Deel einduitslag" deelt het actieve tabblad** (goedgekeurd
  01-11-2026; ook in Geschiedenis): "Uitslagen" → **raster-PNG**
  (`gridModel`, `uitslagen-<wedstrijd>-<datum>.png`, 1080 × ~1412 px): zelfde
  kop, daaronder het raster in de app-indeling (gouden as-cijfers, getrokken
  vak donkerblauw met naam, vrij vak goud "VRIJ", buiten de pool gedimd met
  stippelrand, "OVERIGE UITSLAGEN" + naam eronder); geen markeringen, geen
  deelnemersoverzicht. "Per deelnemer" (standaard) → de deelnemers-PNG
  hieronder. Eén knop; beide PNG's worden vooraf gemaakt. `Overview` kreeg
  alleen de optionele prop `onTabChange` (DEMO-markup ongewijzigd).
- **F10 deelnemers-PNG (vereenvoudigd en goedgekeurd 01-11-2026)**: 1080 px
  breed, hoogte volgt de inhoud (4 spelers ~1244 px, 12 × 4 met 50 uitslagen
  ~2884 px). Kop: "Football / Score Machine", wedstrijd, speeldatum (nl),
  één regel "TOTALE POT €…" in gouden kader. Daaronder direct per deelnemer
  (gelote volgorde) een donkerblauwe kaart: positie + naam, totaal rechts in
  goud, alle uitslagen als **identieke gouden blokjes** "uitslag | bedrag"
  ("Overig" als gewone tekst). **Geen uitslagenraster, geen MEGA-, veiling- of
  OVERIG-markering, geen legenda, geen winnaar.** Delen via
  `navigator.share({files})` (WhatsApp e.d.), anders downloaden; bestandsnaam
  `einduitslag-<wedstrijd>-<jjjj-mm-dd>.png`; vooraf gemaakt bij het openen
  van het eindscherm.
- **MEGA WIN alleen** bij het instellen (groen in "Nieuw spel"/"Wijzig") en
  in de MEGA WIN-animatie; overzichten, eindscherm, geschiedenis en PNG tonen
  MEGA- en veilinguitslagen als gewone uitslagen (in de app-overzichten was
  dat al zo; `Overview` ongewijzigd, DEMO ongewijzigd).
- **F12 geschiedenis (goedgekeurd 01-11-2026; vervangt B7; definitief
  alleen lokaal in localStorage, geen centrale opslag/overzetcodes/accounts)**: knop
  "Geschiedenis" op het beginscherm zodra er minstens één afgeronde wedstrijd
  is; lijst (max. 10, nieuwste eerst op speeldatum) met wedstrijd, datum en
  pot; openen = eindscherm (alleen lezen, "Terug naar geschiedenis", PNG
  opnieuw). "Verder met huidig spel" alleen voor een niet-afgerond spel.

**Besluiten wachtkamer B1–B10 (31-10-2026; B1, B4, B6, B9 aangepast, zie
hierboven):**
- **B1** *(vervangen door de nieuwe flow hierboven)* Organisator vult naam in → kamer wordt direct gemaakt → wachtkamer;
  deelnemers kunnen zich al aanmelden terwijl de organisator instelt.
- **B2** Nieuw spel blanco: geen aantal deelnemers, geen rondes, prijs leeg,
  geen losse uitslagen (alleen OVERIG, altijd), geen MEGA. Snelkeuzes ("Standaard (0-0 t/m 4-4)",
  "Alles", "Wissen", "Standaard MEGA", "Geen MEGA") blijven, nooit
  automatisch toegepast. DEMO houdt haar standaard.
- **B3** Status in gewone taal (geen formules): rondes ontbreken, prijs
  ontbreekt, te weinig / te veel uitslagen (met "nodig: x tot y, nu z"),
  of "Alles klopt: … vaste trekkingen en een veiling van … kavels / geen
  veiling". Start uitgeschakeld zolang het niet klopt.
- **B4** Eén startbevestiging: Deelnemers, Vaste rondes, Prijs per trekking,
  Uitslagen, Veilingtrekkingen (of "Geen veiling") + "deelnemers, volgorde
  en spelregels liggen daarna vast"; knoppen "Annuleren" / "Definitief
  starten". De server start alleen als de kamer niet intussen veranderde
  (`room_changed`, versiecontrole; D8).
- **B5** Volgorde: slepen (⋮⋮) én ▲▼; "Loot volgorde" direct, zonder
  bevestiging; wijzigen tot de start.
- **B6** Verwijderen met korte bevestiging; organisator kan zichzelf niet
  verwijderen; verwijderde deelnemer kan zich opnieuw aanmelden zolang de
  wachtkamer open is ("Je bent verwijderd" + "Opnieuw aanmelden").
- **B7** "Geschiedenis" voorlopig helemaal verborgen.
- **B8** Precies twee knoppen: "Deel uitnodiging" (deelmenu van de telefoon;
  zonder deelmenu wordt de uitnodiging gekopieerd) en "Kopieer link".
  Uitnodiging = naam organisator + link + kamercode. Geen WhatsApp-knop.
- **B9** Wachtkamer deelnemer: alleen naam organisator, lijst aangemelde
  deelnemers, eigen naam met "Jij", "Wachten tot de organisator het spel
  start". Geen spelregels/raster/MEGA/prijzen (server stuurt ze ook niet).
- **B10** Eerst lokaal met mock (F7); echte server/Supabase pas na
  beoordeling en apart akkoord.

**Nieuwe schermen (multiplayer, in de bestaande stijl; machine ongewijzigd):**
- **Beginscherm**: "Nieuw spel", "Meedoen" (Geschiedenis verborgen, B7); bij
  een actief spel bovenaan wedstrijdnaam + "Verder met huidig spel". Geen DEMO-knop (DEMO via `?demo`).
- **Nieuw spel**: naam + clubs + spelregels (één formulier) → "Spel
  aanmaken" → wachtkamer → uitnodigen → wachten → volgorde → start. **Meedoen**: kamercode + naam; via een uitnodigingslink
  (`?kamer=CODE`) direct naar de aanmelding van die kamer.
- **Uitnodigen**: "Deel uitnodiging" (deelmenu), "Kopieer link", code tonen (B8).
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

## 4b. F13 Openingsbeleving (02-11-2026, live: `571db27` + `game` v3)

- **Wachtkamer**: zacht mechanisch rolgeluid (gegenereerde lus, 1 tegelijk,
  refcount) zolang WARMING UP draait; stopt bij verlaten/start/verborgen tabblad.
- **BONUSSPEL** (~6 s): 3 gouden munten blijven; dubbele ring lopende lampjes
  (`ChaseLights rings/per`), titel op twee regels ("BONUS" / "SPEL!",
  `aria-label="BONUSSPEL!"`), fanfare-moment (`is-fanfare`, extra flits +
  confetti) op `INTRO.fanfareAt` 5000; namen vanaf `namesAt` 6000. Geluid:
  muntdings, opbouwend casinogeluid, korte koperfanfare (synthetisch).
- **Las Vegas**: bord en samenvatting ongewijzigd (alleen op lage schermen
  ≤ 700 px kleiner + compacte samenvatting), plus de definitieve volgorde.
  In nieuwe spellen blijft het bord **onbeperkt** staan; alleen de organisator
  ziet **"START SPEL"**; daarna gaan alle telefoons tegelijk naar de machine.
- **Server-autoritatief**: `start_game` zet `room.awaitPlay = true,
  playAt = null`; nieuwe actie **`start_play`** (alleen organisator, pas vanaf
  `vegasAt`, eenmalig) zet `playAt = serverNow + PLAY_DELAY` (1500 ms);
  `playOpensAt(room)` = `playAt` (of `introEnd` voor oude spellen zonder
  `awaitPlay`); `spinTurn` weigert daarvóór (`intro_running`). Fouten:
  `not_organizer`, `intro_running` (te vroeg), `nothing_to_advance` (tweede
  keer / dubbelklik), `not_started`. Geen databasewijziging (velden in
  `rooms.state`). `roomView` stuurt `awaitPlay`/`playAt`.
- **Viva Las Vegas**: eenmalig bij het verschijnen van het bord (niet > 1,5 s
  te laat). Eigen ingesproken fragment als bestand
  **`public/sounds/viva-las-vegas.mp3`** (of `.m4a`); alleen gebruikt als het
  echt audio is (content-type `audio/*`); ontbreekt het → tijdelijk
  synthetisch testgeluid. Geen Web Speech, geen muziek van een bestaand nummer.
- **Geluid** (`src/audio/openingSound.js`, `SoundButton.jsx`): knop rechtsboven
  in wachtkamer en opening, in het spel via het menu; voorkeur in localStorage
  `fsm-sound`; geblokkeerd door de browser (iOS) → gouden knop "🔊 Geluid aan"
  (één tik); geluid blokkeert nooit de voortgang. `sound.js` kreeg alleen
  nieuwe exports (`audioOut`, `soundEnabled`, `audioRunning`); de DEMO zet bij
  laden zelf haar geluid en is ongewijzigd.
- **Uitrolvolgorde**: eerst frontend (werkt met `game` v2: geen `awaitPlay` →
  oude tijdgestuurde opening), daarna `game` v3 (`npm run fn:deploy`). Andersom
  zou een oude frontend op het bord blijven hangen zonder knop. Live tests 5A/5D
  passen zich aan (`awaitPlay` → `start_play`, in 5D ook weigering deelnemer,
  dubbel, Realtime). Terugval functie: v2-code uit commit 41932a8.
- **Tests (02-11-2026)**: `npm test` **321/321**; PGlite-integratie 9/9;
  `deno check` + rooktest; browser (mock, scratchpad `f13/`): opening 24/24
  (2 toestellen, herladen in elke fase, gelijktijdige overgang 2–10 ms,
  dubbelklik → versie +1, SPIN pas na START SPEL, geluid aan/uit/onthouden,
  één lus), iPhone-blokkade nagebootst 3/3, Las Vegas 12 spelers op
  320×568/390/430 3/3, BONUSSPEL-titel past op 320/390/430; DEMO 16/16
  pixel-identiek, 0 Supabase-verzoeken; mock niet in `dist/`.
  Niet getest: echte iPhone/Safari, echt ingesproken fragment.
- **Live (02-11-2026)**: frontend `571db27` eerst gepubliceerd (vooraf getoetst
  tegen de v2-servercode: oude opening, geen START SPEL, volledig spel); daarna
  `game` **v3** uitgerold (ACTIVE; v2-terugval = code `41932a8`). Live 5A
  **15/15**, 5D **24/24** (5D uitgebreid: wachtfase `awaitPlay`/`playAt = null`
  op alle 3 toestellen, deelnemer `start_play` → `not_organizer`, SPIN in de
  wachtfase → `intro_running`, Realtime bij START SPEL op alle toestellen, tweede
  START SPEL → `nothing_to_advance`, overal hetzelfde `playAt`; verder volledig
  spel met veilingen en eindstand). Alles opgeruimd, database leeg.

## 5. React-architectuur en spelengine

**Multiplayer-schermen (F7)**, strikt gescheiden van de DEMO:
```
src/App.jsx                 router: ?demo → DemoApp, anders OnlineApp (isDemoUrl)
src/DemoApp.jsx             de DEMO (voorheen App.jsx, inhoud ongewijzigd)
src/lobby/lobbyRules.js     pure wachtkamerregels (ook voor de echte server in F3):
                            createRoom({name, home, away, draft}) alleen geldig spel,
                            draft = {maxPlayers, rounds, priceCents, pool, mega},
                            room.match {home, away}, matchName, normalizeClub,
                            parsePlayerCount, setupStatus (formulier), selectie
                            togglePoolResult/toggleMegaResult/choosePool/megaCandidates,
                            maxPlayersOf (room_full), joinRoom, removePlayer, setOrder, shuffleOrder,
                            updateSettings/normalizeDraft, draftStatus, startGame
                            (expectedVersion → room_changed), lobbyConfig, roomView
                            (deelnemer: draft = null), roomSummary, parsePrice; LobbyError
src/online/api.js           interface + getApi(), ApiError, codes, ERROR_TEXT, inviteUrl
src/online/realApi.js       echte server: nog stub ('not_available'), F6
src/online/mock/mockApi.js  NAGEBOOTSTE SERVER: zelfde regels/foutcodes; kamers in
                            localStorage 'fsm-mock-server', identiteit + sessie per
                            tabblad in sessionStorage ('fsm-mock-user'/'-session'),
                            meldingen via BroadcastChannel 'fsm-mock'; addFakePlayer
src/online/OnlineApp.jsx    schermkeuze (home/new/code/join/room/notice), ?kamer=CODE,
                            terugkeren via sessie, delen/kopiëren, meldingen (toast)
src/online/useRoom.js       kamer ophalen + volgen; hoogste versie wint
src/online/lobbyText.js     statusteksten in gewone taal (B3)
src/lobby/playRules.js      pure spelregels online: spinTurn (wie mag SPIN, onBehalf,
                            deelnemer zonder telefoon, intro_running), confirmAuction
                            (Bevestig veiling + announce met lot #n), nextStep/
                            advancePhase (faseovergangen, alleen organisator →
                            room.ack), turnInfo, introTimeline/
                            introPhase/INTRO (startanimatie), ANNOUNCE_MS
src/online/history.js       F12: isRoomFinished, historyEntry (alleen-lezen kopie),
                            addEntry (max 10, nieuwste eerst), createHistoryStore
                            (localStorage 'fsm-history' + lopende spellen
                            'fsm-my-rooms'; mock: per tabblad), collectFinished
src/online/share/resultImage.js  F10: shareModel (puur), shareFileName, canvas-
                            tekening (renderResultCanvas/-File), shareOrDownload
src/online/screens/FinalScreen.jsx  eindscherm (live en geschiedenis)
src/online/screens/History.jsx  HistoryList, HistoryMatch
src/online/intro/*          slotMath (tijdgestuurde rolpositie), MiniReels (WARMING UP,
                            BONUS TRIGGER), StartIntro (BonusTrigger, NamesReveal,
                            VegasWelcome), VegasSign (SVG-bord), AuctionAnnounce
src/online/screens/OnlineGame.jsx  online scoremachine (MainScreen/AuctionScreen met
                            teams/altAction), Draai namens, Bevestig veiling, menu
src/online/screens/*        common (OnlineScreen, Status, ConfirmSheet, Toast),
                            EntryScreens (Home, NewGame, JoinScreen, CodeScreen, Notice),
                            Lobby (LobbyOrganizer, LobbyParticipant, StartConfirm,
                            RemoveConfirm), PlayerList (slepen/▲▼/✕), SettingsSheet
                            (useRules + RulesFields: gedeeld door Nieuw spel en
                            "Wijzig" in de wachtkamer),
                            OnlineGame (zie boven)
```
- **Bestaande componenten** kregen alleen optionele props (zonder props
  identieke DEMO-markup, getoetst): `SlotMachine teams`, `MainScreen`/
  `AuctionScreen` `teams` + `altAction` + `canAdvance` (false = knop
  "Start de veiling"/"Bekijk de eindstand" verborgen; online alleen de
  organisator), `AuctionSetup confirmLabel`. De DEMO houdt haar lokale
  bevestiging (`fsm-demo-ack`); online komt `ack` uit de kamer.
- Kamer (mock en straks server): `match`, `organizerName`, `players[{slot,
  userId|null, name, manual?}]`, `order`, `draft{maxPlayers, rounds,
  priceCents, pool, mega}`, `startedAt`, `announce{participant, bidCents,
  lot, at}`, `ack{auctionStart, finish}` (faseovergangen), `spinLog[{spinId,
  participant, spunBy, onBehalf, at}]`, `state` (engine, ongewijzigd). `roomView`: `controlSlots` (welke deelnemers dit
  toestel mag bedienen), deelnemers in de wachtkamer alleen `{slot, name}`.
- Lettertypen voor het Las Vegas-bord (Yellowtail, Archivo Black) worden
  alleen door `OnlineApp` geladen (DEMO/`index.html` ongewijzigd).
- Mock-beperking: identiteit per tabblad in sessionStorage; een gesloten
  tabblad is in de mock dus een "nieuwe telefoon". De echte server gebruikt
  een blijvende anonieme sessie (terugkeren op hetzelfde toestel).
- **Mock nooit in productie**: `USE_MOCK = import.meta.env.DEV ||
  VITE_USE_MOCK === '1'`; alleen dan wordt `mock/mockApi.js` geladen en
  verschijnen testonderdelen ("＋ Nep-speler", testmodus-melding). In
  `npm run build` vallen ze weg (gecontroleerd: geen `fsm-mock`,
  `Nep-speler`, `addFakePlayer`, `Testmodus` in `dist/`). Testen:
  `npm run dev` of `VITE_USE_MOCK=1 npx vite build`. Een extra telefoon
  nabootsen = nieuw tabblad (niet dupliceren: dat kopieert sessionStorage).
- De schermen beslissen niets zelf; alles via `api` (server-autoritatief).
  De echte server (F3/F6) moet dezelfde interface en foutcodes leveren en kan
  `lobbyRules.js` hergebruiken. CSS: blok "Multiplayer-schermen (F7)"
  onderaan `index.css`, alleen nieuwe `ol-`-klassen.

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

## 6b. Echte multiplayer (uitgerold op V2, 31-10-2026; telefoontest volgt)

Eén systeem: dezelfde spelregels (`src/lobby/lobbyRules.js`,
`src/lobby/playRules.js`, `src/game/engine.js`) draaien in de nagebootste
server (mock, lokaal testen) én in de Edge Function (echt). Geen tweede,
concurrerend systeem.

```
telefoon (React)                      Supabase V2
 ├─ OnlineApp / schermen               ├─ Auth: anonieme login (sessie in localStorage 'fsm-auth')
 ├─ getApi(): mock of realApi          ├─ Edge Function 'game' (service_role, alle wijzigingen)
 └─ realApi.js ── POST /functions/v1/game ─┤   src/server/actions.js → lobbyRules/playRules/engine
        │        (Bearer token, nooit automatisch herhaald)   → commit_room_state (versie + trekking, atomair)
        └── Realtime: room_pulses (kamer + versie) ──┘   trigger op rooms → room_pulses
            + terugval: elke 2,5 s ophalen, en bij online/focus/zichtbaar
```

- **Kamer = één document** in `rooms.state` (deelnemers met user-id's,
  `organizerName`, `match`, `order`, `draft`, `removedUserIds`, engine-`state`,
  `startedAt`, `announce{participant, bidCents, lot, at}`, `ack{auctionStart,
  finish}`, `spinLog`). Alleen de server leest en schrijft het (rol
  service_role). Telefoons krijgen alleen `roomView` (per rol gefilterd:
  deelnemers in de wachtkamer alleen `{slot, name}` in aanmeldvolgorde, geen
  spelregels, volgorde of user-id's; organisator alles behalve user-id's).
- **Serverautorisatie** (altijd op de server, user-id alleen uit het token):
  organisatoracties (`update_settings`, `set_order`, `shuffle_order`,
  `remove_player`, `add_manual_player`, `join_self`, `start_game`,
  `confirm_auction`, `advance_phase`) → `not_organizer`; SPIN alleen voor wie
  aan de beurt is, de organisator voor een deelnemer zonder telefoon of
  expliciet `onBehalf` → anders `not_your_turn`; niet-leden → `room_not_found`,
  verwijderd → `removed`. De uitslag kiest de server (`secureRandomInt`) pas
  bij `spin`; de telefoon stuurt geen uitslag (wordt genegeerd).
- **Atomair en eenmalig**: elke wijziging = `commit_room_state(versie)`;
  bij een versieconflict (PT409) laadt de server opnieuw en controleert alles
  opnieuw (max. 3 pogingen). Daardoor nooit dubbele SPIN, veilingbevestiging,
  faseovergang of start, en aanmelden vs. starten (D8) is geserialiseerd op
  dezelfde kamerrij. `draws` blijft het onveranderlijke vangnet (unieke
  uitslag en draai per kamer).
- **Sessiebeheer**: anonieme Supabase-login, sessie bewaard in de browser
  (`fsm-auth`, supabase-js ververst het token zelf). Zelfde toestel/browser =
  zelfde identiteit: deelnemer houdt zijn plek, organisator zijn rechten,
  ook na sluiten van de browser (laatste kamer in `fsm-online-session` →
  gouden knop op het beginscherm). Ander toestel/gewiste gegevens = nieuwe
  identiteit, kan een bestaande naam niet overnemen (`name_taken`) en heeft
  geen toegang tot de kamer (D6: geen herstel van organisatorrechten).
- **Spelstatus en faseovergangen**: tijdgestuurd (`deriveView` met de
  servertijd: `serverNow` in elk antwoord → klokafwijking, kortste rondreis
  wint). Startanimatie op `startedAt`; veilingaankondiging op `announce.at`;
  "Start de veiling"/"Bekijk de eindstand" alleen via `advance_phase`
  (organisator) → `room.ack`. Herladen/opnieuw verbinden = status ophalen en
  op de huidige tijd tonen (geen herhaling van afgelopen animaties).
- **Definitieve spelersvolgorde**: bij de start vastgelegd in
  `state.config.players` (uit `room.order`); leidend voor beurten,
  startanimatie, scoremachine, overzicht per deelnemer en eindstand (en
  straks de deelafbeelding). Nooit alfabetisch, op aanmelding, uitslagen of
  bedragen. Regressietest in `tests/online-ui.test.jsx`.
- **Mock vs. echt**: `src/online/api.js` → `USE_MOCK` = `VITE_USE_MOCK=1`, of
  `npm run dev` tenzij `VITE_USE_MOCK=0`. Productiebuild: altijd `realApi`
  (mock zit er niet in, gecontroleerd). Zonder `VITE_SUPABASE_PUBLISHABLE_KEY`
  meldt `realApi` "nog niet beschikbaar". supabase-js (2.118.0, zelfde
  versie als de Edge Function) zit in een aparte chunk die alleen wordt
  geladen als het online spel verbinding maakt; de DEMO laadt niets van
  Supabase (gecontroleerd: 0 verzoeken).
- **Misbruikgrens**: max. 5 nieuwe kamers per anonieme gebruiker per 24 uur
  (was: 5 in totaal, wat een vaste organisator na 5 spellen zou blokkeren).
- **Testafspraken**: `npm test` (unit, mock, server met geheugenopslag,
  realApi end-to-end), PGlite lokaal (migraties + `security.sql` +
  integratietests), browser: mock-build én productiebuild met `realApi` tegen
  een lokale nagebootste Supabase (scratchpad, niet in repo) in
  onafhankelijke browserprofielen op 320/390/430 px, DEMO-pixelregressie.
  Op V2 pas na toestemming: `db:migrate`, `db:test`, `fn:deploy`,
  `fn:test:5a/5b` (elk apart).

### Uitrolplan V2 (elke stap apart akkoord)
1. **Gedaan 31-10-2026 21:44 UTC**: `npm run db:migrate` → migratie 3
   `online_spel` (remote versie 20261031214442). Nacontrole: 4 tabellen met
   RLS, enige policy `room_pulses_select_members`, publicatie alleen
   `room_pulses`, rechten zoals ontworpen, database leeg, v1 bleef werken.
2. **Gedaan 21:47–21:51 UTC**: `npm run db:test` → **72/72** (security.sql 62
   + 10 gelijktijdigheids-/integratietests). 37 bedoelde `version_conflict`,
   0 fouten, alles opgeruimd.
3. **Gedaan 21:59:58 UTC**: `npm run fn:deploy` → `game` **versie 2**, ACTIVE,
   13 bestanden (code = commit 3f3f740). 401 zonder/ongeldig/vervalst token.
   Eén controleverzoek kreeg binnen 25 s geen antwoord en kwam niet in de
   gatewaylog voor (onderweg blijven hangen, niet bij Supabase); niet
   herhaalbaar.
4. **5A gedaan 22:09 UTC**: 15/15 (prijs €0, geen veiling). **5B gedaan
   22:47 UTC**: 9/9, 1× PT409/`version_conflict`, 0 fouten. 5B test één
   toestel; deelnemer + organisator tegelijk, meerdere toestellen,
   Realtime en bedragen → **5D** (§7b, nog niet live).
5. **5D gedaan 01-11-2026 23:16 UTC** (na herbouw van de Realtime-luisteraar:
   eerste poging faalde op een 503 van het platform bij 3 gelijktijdige
   streams naar één functie): **24/24**, 2× deelnemer + organisator
   tegelijk → telkens precies één, echte Realtime bij elk lid (exact de
   nieuwe versie), buitenstaander niets, bedragen/pot klopt, 2 bedoelde
   PT409, 0 fouten.
6. **Browser tegen echte V2 gedaan 01-11-2026** (productiebuild met
   `.env.local`, script in scratchpad `e2e/flow-v2.mjs`, controles in de
   V2-database, opruimen eigen gebruikers/kamers): 4 deelnemers (1 zonder
   telefoon), 2 rondes, €2,50, 2 veilingen (€12,34 / €35), geloot. Op 320,
   390, 430 px: 45/45, 44/45 (4× `get_room` 5,2–5,7 s), 45/45. Realtime in de
   app echt actief (WebSocket, "Subscribed to PostgreSQL", ~20 signalen per
   deelnemer per spel). Deelnemer leest met echte sleutel + eigen token
   `rooms`/`draws` niet (403 42501), alleen het eigen signaal.

### Publiceren (nog te doen, elk met akkoord)
1. Commit + push naar de werkbranch.
2. Gebruiker: GitHub → Settings → Secrets and variables → Actions →
   **Variables** → `VITE_SUPABASE_PUBLISHABLE_KEY` = publishable key uit
   Supabase (Project Settings → API Keys). `pages.yml` stopt als hij ontbreekt.
3. Settings → Pages → Source: **GitHub Actions**.
4. Merge naar `main` → workflow: test, build, deploy →
   `https://hkk8mp4jyk-star.github.io/football-score-machine/` (DEMO:
   `…/?demo`). Daarna test op echte telefoons.
- **Terugval**: functie terug naar v1 = code van commit **90e0265** (de 8
  functiebestanden daar zijn identiek aan de uitgerolde v1; 054320c niet!):
  `git worktree add --detach <map> 90e0265` en daar `node scripts/supabase.mjs
  deploy` (met `NODE_USE_ENV_PROXY=1`). Daarna eventueel
  `supabase/rollback/20261101120000_online_spel_down.sql` (lokaal getest:
  daarna slagen de oude 55 beveiligingstests weer).

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
- **Migratie 3** `supabase/migrations/20261101120000_online_spel.sql` (naam
  `online_spel`; **op V2 toegepast 31-10-2026**): (1) geen directe
  leesrechten meer voor deelnemers op `rooms`/`seats`/`draws` (policies weg,
  `rooms`/`seats` uit de Realtime-publicatie); (2) `draws`: uitslagen 0-0 t/m
  6-6 + OVERIG, deelnemer 0–11, rondes 1–4 of veiling; (3)
  `private.is_room_member` = organisator of deelnemer in `rooms.state ->
  'players'` (user-id); (4) nieuwe tabel `room_pulses` (kamer, versie, tijd),
  RLS: alleen leden lezen, door trigger `rooms_pulse` bijgehouden, in de
  Realtime-publicatie. `seats` wordt niet meer gebruikt (blijft leeg).
  `commit_room_state` ongewijzigd. Het vroegere voorstel (seats-naamkolom +
  D8-triggers) is vervangen: D8 volgt nu uit de versiecontrole op één rij.
  Supabase heeft zelf een event-trigger `public.rls_auto_enable` (RLS op
  nieuwe tabellen) — niet van ons, ongemoeid laten.
- `security.sql` (na migratie 3): **62 controles**, lokaal in PGlite 62/62.
- Tests: `supabase/tests/security.sql` (51 checks, in een rollback-transactie)
  + echte concurrency-test (10 gelijktijdige commits → precies 1 slaagt,
  testkamer `ZZTEST` wordt opgeruimd). Laatste run: **52/52 geslaagd**,
  database daarna leeg.

## 7b. Edge Function `game` (fase 3, gebouwd)

Eén functie, uitgerold als `game` (`npm run fn:deploy`), URL
`https://twzjsmxydnfmowrmffsl.supabase.co/functions/v1/game` (V2: versie 1,
ACTIVE, verify_jwt uit, uitgerold 30-10-2026). Schemawijziging na fase 3: alleen migratie 2 (PT409).

**Versie 2 (uitgerold 31-10-2026, ACTIVE)**: acties van het instelbare
spel (vervangt de tabel hieronder, die v1 beschrijft): `time`, `create_room
{name, home, away, draft}`, `lookup_room {code}`, `join_room {code, name}`,
`get_room`, `update_settings {draft}`, `set_order {order}`, `shuffle_order`,
`remove_player {slot}`, `add_manual_player {name}`, `join_self`,
`start_game {expectedVersion?}`, `spin {onBehalf?}`, `confirm_auction
{participant, bidCents}`, `advance_phase {step: auction|final}` (alle met
`roomId` behalve de eerste vier). Antwoord `{ok, room: roomView | summary,
serverNow}`. Foutcodes uit de spelregels (o.a. `not_organizer`/
`not_your_turn`/`removed` 403, `room_not_found`/`player_not_found` 404,
`name_*`/`club_*`/`invalid_*` 400, `room_full`/`name_taken`/
`registration_closed`/`players_incomplete`/`room_changed`/`intro_running`/
`spin_in_progress`/`turn_not_released`/`no_auction_turn`/`auction_confirmed`/
`auction_not_open`/`nothing_to_advance`/`conflict` 409, `too_many_rooms` 429).
De verliezer van een gelijktijdige SPIN krijgt nu `spin_in_progress`.
Uitrol verzamelt de bestanden automatisch (`functionFiles()` in
`scripts/supabase.mjs`, 13 bestanden). `deno check` geslaagd. Live tests
5A/5B/5C zijn aangepast aan wachtkamer → start → startanimatie → SPIN (5A
nu ook: dubbele naam, vol, alle organisatoracties door deelnemer geweigerd,
SPIN tijdens animatie geweigerd, tweede start geweigerd, namens draaien).

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
- **Live test** (`scripts/live-test.mjs`), vier afzonderlijke fasen; één
  fase per run, nooit automatisch een volgende:

| Commando | Fase | Inhoud |
|---|---|---|
| `npm run fn:test:5a` | 5A basis | 3 anonieme logins (na elkaar), 401-controles, servertijd, kamer, opzoeken, naam claimen, weigeringen, **één** SPIN, status ophalen, herstel (opnieuw versturen → geen 2e trekking; later ophalen → beurt vrij). **Geen** gelijktijdige verzoeken (lokaal getoetst: max. 1 verzoek tegelijk) |
| `npm run fn:test:5b` | 5B beperkt | 1 login, kamer, **2** gelijktijdige SPIN's |
| `npm run fn:test:5c -- --bevestig` | 5C uitgebreid | idem met **10**; zonder `--bevestig` weigert het script |
| `npm run fn:test:5d` | 5D volledig spel | 4 logins (organisator, A, B, buitenstaander); 3 deelnemers × 2 rondes, €2,50 per trekking, 2 veilingen (A €12,34 zelf, B €35,00 namens); volgorde geloot (≠ aanmelding); per eerste beurt van A en B **deelnemer + organisator (namens) tegelijk** → precies één; na elke stap `get_room` op 3 toestellen vergeleken (deelnemers, volgorde, trekkingen, fase, `ack`, `announce`); **echte Realtime** bij aanmelden, start, gelijktijdige SPIN's, veilingen en overgangen (leden ontvangen de nieuwe versie, buitenstaander niets); bedragen/pot op alle toestellen + database; database: 8 unieke trekkingen/draaien, bod alleen bij de veiling, `spun_by`/`on_behalf`; logs: RPC alleen 200/409, 200 = aantal geslaagde wijzigingen, geen 5xx/herhaallus; reactietijden (> 5 s = waarschuwing). Tijdslimiet 420 s |

  **Realtime in 5D**: de hulpfunctie `fsm-testlogin` heeft een tweede modus
  (`?mode=listen`): ze abonneert zich in Supabase met het token van de
  testgebruiker op `postgres_changes` van `room_pulses` (zoals `realApi`,
  dus met RLS van die gebruiker) en stuurt `status`/`ready`/`pulse`/`end`
  als NDJSON terug (max. 30 s, stopt bij de verwachte versie). Lokaal
  nagebootst met membership-controle (`tests/live-test.test.js`); de modus
  zelf is in Deno gestart en stopt bij geen verbinding netjes
  (`CHANNEL_ERROR`). Echte Realtime-aflevering kan alleen live.

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
- **F10 + F12 (01-11-2026, lokaal, niet gecommit)**: `npm test` → **314**
  (+15 in `tests/history.test.jsx`: afgerond pas na "Bekijk de eindstand";
  opslag max 10, elfde verdringt oudste, geen dubbele, sortering; herstart
  (nieuwe store, zelfde opslag); kapotte/ontbrekende opslag; lopend spel niet
  opgeslagen; `collectFinished`; PNG-gegevens bij 1, 4 en 12 × 4 met 50
  uitslagen (volgorde, kosten, veilingen, pot, MEGA/OVERIG); bestandsnaam;
  delen/annuleren/terugval downloaden; schermen eindscherm, beginscherm,
  geschiedenis, terugkijken zonder SPIN/beheer). **Browser mock** (dev,
  scratchpad `f10/shots.mjs`): 24/24 (eindscherm 320/390/430, gelote volgorde,
  pot, knoppen, geen horizontaal scrollen; download + nagebootst deelmenu
  met PNG-bestand; PNG 1/4/12 spelers; geschiedenis 11 → 10, nieuwste boven;
  terugkijken + PNG opnieuw). **Echte V2** (`e2e/f12-v2.mjs`): 13/13 (echt spel
  tot het einde, PNG, server weigert elke wijziging na afloop (409), browser
  dicht/open → geschiedenis + PNG opnieuw, lopend spel intact), opgeruimd.
  Volledige spelcyclus V2 opnieuw 45/45 (390 px). DEMO 16/16 pixel-identiek,
  0 Supabase-verzoeken. Geen database- of Edge Function-wijziging nodig.
- **Echte koppeling lokaal (01-11-2026, niet gecommit)**: `npm test` →
  **286 tests** (+ eindstand-volgorde regressie; `server.test.js` herschreven
  voor de nieuwe acties: 39 tests incl. 10.000 proeftrekkingen chi-kwadraat,
  gelijktijdige SPIN/aanmelden/start/bevestigen/overgangen, autorisatie,
  12 × 4 met 50 uitslagen; `realApi.test.js` 6 tests: echte frontendkoppeling
  → HTTP → server met meerdere toestellen, sessieherstel, geen herhaling,
  401, klok). PGlite: migraties 1–3 + `security.sql` **62/62**,
  integratietests **9/9**, terugdraaien → oude tests 55/55, oude functiecode
  op nieuw schema 6/6. `deno check` + Deno-rooktest geslaagd. **Browser met
  productiebuild + `realApi`** tegen lokale nagebootste Supabase (echte
  servercode, geen Realtime → terugval), 3 onafhankelijke browserprofielen:
  **26/26** op 320, 390 en 430 px (aanmaken, link, code, dubbele naam,
  deelnemer zonder telefoon, API-poging deelnemer → 403, browser dicht en
  terug → zelfde rechten, startanimatie op alle toestellen, herladen tijdens
  animatie → geen herhaling, alleen actieve deelnemer SPIN, gelijktijdig
  SPIN + Draai namens → 1 trekking, overgangen alleen organisator,
  aankondiging #1/#2 bij deelnemers, eindstand in definitieve volgorde,
  geen dubbele bevestigingen/overgangen). DEMO 16/16 pixel-identiek, geen
  Supabase-verzoeken. Read-only V2-inventarisatie: alleen migraties 1–2,
  database leeg, functie `game` v1.
- **Correcties na beoordeling F8 (31-10-2026, lokaal, niet gecommit)**:
  `npm test` → **277 tests** (+4: faseovergangen alleen organisator,
  eenmalig, pas na de laatste trekking, veiling pas bevestigen na "Start de
  veiling", zonder veiling direct eindstand; veilingnummers #1/#2;
  wachtkamer 1 kolom t/m 6, 2 kolommen bij 7–12; deelnemer zonder knop
  "Start de veiling"). **Browser** (3 telefoons, 320/390/430 px): **35/35**
  per breedte: deelnemers zien geen overgangsknoppen, organisator klikt →
  iedereen automatisch naar veiling/eindstand, herladen → actuele fase,
  aankondiging "Winnaar veiling #1" en "#2". Wachtkamer 6 en 12 deelnemers
  op 320 (×568), 390 en 430 px: geen scrollen, juiste kolommen, geen
  afgekapte namen. Startanimatie-bestanden ongewijzigd. Lege velden "Nieuw
  spel" gecontroleerd (al in orde). DEMO 16/16 pixel-identiek.
- **Online spelverloop (31-10-2026, lokaal, niet gecommit)**: `npm test` →
  **273 tests** (+11 in `tests/play.test.js`: introtijdlijn en -fases,
  rollen exact op munt/naam, SPIN alleen voor wie aan de beurt is,
  organisator alleen expliciet namens, deelnemer zonder telefoon, tweede
  SPIN geweigerd, veiling bevestigen (rechten, bod, geen tweede
  bevestiging, start geen trekking), aankondigingsvenster, mock: volledig
  spel met 3 telefoons incl. gelijktijdig drukken → 1 trekking; lobby:
  organisator zichzelf verwijderen/terug, zonder telefoon, start alleen bij
  precies y van y; schermen: wachtkamer deelnemer, startanimatie A/B/C,
  actieve deelnemer vs. toeschouwer, Draai namens, aankondiging).
  **Browser** (mock-build, 3 telefoons + 2 testspelers + 1 zonder
  telefoon, 320/390/430 px): **27/27** per breedte, incl. gelijktijdig SPIN
  + Draai namens → precies één trekking, herladen tijdens spel/veiling →
  geen herhaling van animatie/aankondiging, geen consolefouten. Frames per
  fase + video van de startanimatie. **DEMO**: 16/16 pixel-identiek
  (oude build `/` vs. nieuwe `/?demo`), draaien/herladen gelijk.
- **F7 aangepaste flow (31-10-2026, lokaal, niet gecommit)**: `npm test` →
  **262 tests** (lobby 37, schermen 30; nieuw: blanco formulier, clubs,
  aantal deelnemers 1–12, wedstrijdnaam, setupStatus, server maakt alleen
  geldige spellen, 0 / 10 / 11 veilinguitslagen, definitieve teksten,
  selectie OVERIG/MEGA, ingesteld maximum → `room_full`, maximum niet onder
  aangemeld). Browserflow 30/30 op 320/390/430 px, geen horizontaal
  scrollen of consolefouten. DEMO opnieuw 16/16 pixel-identiek.
  **Open punt wachtkamer**: de start rekent (ongewijzigd) met de aangemelde
  deelnemers; met minder dan het ingestelde aantal kan de start dus
  geblokkeerd zijn ("Met x van y deelnemers kloppen de spelregels nog
  niet.") of een andere veiling opleveren. Beslissen bij de beoordeling van
  de wachtkamer.
- **F7 multiplayer-schermen met mock (31-10-2026, lokaal, niet gecommit)**:
  `npm test` → **250 tests** (196 bestaande ongewijzigd groen + 30 in
  `tests/lobby.test.js`: blanco beginstand, kamer maken, aanmelden, dubbele
  namen, max. 12, terugkeren, spelregels tijdens aanmelden, geldige/ongeldige
  concepten, statusteksten, prijsinvoer, volgorde/loten (alle 24 volgordes),
  verwijderen + opnieuw aanmelden, start + `room_changed`, registratie dicht
  na start, deelnemer ziet geen spelregels/user-id's, mock met meerdere
  telefoons, realApi-stub; + 24 in `tests/online-ui.test.jsx`: router
  `?demo`, alle schermen gerenderd). `npm run build` slaagt, mock niet in de
  bundel. **Browserflow** (Playwright, mock-build, meerdere tabbladen,
  320/390/430 px): 33/33 controles per breedte, geen horizontaal scrollen,
  geen consolefouten; 26 schermafbeeldingen per breedte. **DEMO**: oude
  build (vóór F1) op `/` vs. nieuwe op `/?demo`: 16/16 schermen
  pixel-identiek; draaien/herladen gelijk; `/` raakt `fsm-demo-state` niet.
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
| F3 | Server: wachtkamer, `join_room(code, naam)`, `update_settings`, `set_order`/`shuffle_order` (server-crypto), `remove_player`, `start_game` (volledige validatie, `validateConfig`), SPIN/veiling pas na start, terugkeer via `lookup_room`; migratie 3 + D8-triggers + `security.sql` in PGlite; unittests | L | **lokaal klaar** (01-11-2026; D8 via versiecontrole i.p.v. triggers) |
| F4 | Migratie 3 + `db:test` | V2 | **gedaan** (31-10-2026, 72/72) |
| F5 | Uitrol `game` + live tests 5A/5B aangepast aan wachtkamer/start | V2 | **gedaan** (v2 ACTIVE, 5A 15/15, 5B 9/9, 5D 24/24) |
| F6 | Online fundament frontend: supabase-js, publieke sleutel (env), `callGame` (tijdslimiet, nooit automatisch herhaald), kloksync, statusopslag (hoogste versie wint), sessie/terugkeer | L | **klaar, getest tegen echte V2** (01-11-2026) |
| F7 | Schermen Begin (+ "Verder met huidig spel"), Nieuw spel, Meedoen, Wachtkamer, Instellingen, Volgorde; router met `?demo` en `?kamer=`; Playwright tegen nagebootste server | L | **gebouwd, wacht op beoordeling** (31-10-2026, vóór F3 uitgevoerd op verzoek; B1–B10) |
| F8 | Online spel: synchrone animaties (servertijd), herstel, online menu ("draai namens", "plek vrijgeven"), verbindingsbalkje; daarna korte live test | L → V2 | **lokaal met mock gebouwd** (startanimatie, SPIN-regels, Draai namens, veiling + aankondiging), wacht op beoordeling; nog niet op de echte server |
| F9 | Veiling online (0–10, tegelindeling) | L → V2 | |
| F10 | Eindscherm (pot, terug), deelafbeelding (canvas → PNG, deelmenu/opslaan) | L | **klaar en goedgekeurd** (01-11-2026; PNG per actief tabblad) |
| F11 | Publieke sleutel als GitHub-variabele (begeleid), test op telefoons; daarna pas voorstel voor `main`/Pages (toestemming) | V2/Pages | |
| F12 | Geschiedenis (afgeronde spellen, laatste 10, opnieuw delen) | L | **klaar en goedgekeurd** (01-11-2026; localStorage, geen V2-wijziging) |
| F13 | Openingsbeleving: wachtkamergeluid, BONUSSPEL 6 s, Las Vegas wacht op START SPEL (`start_play`, `game` v3), Viva-fragment, geluidsknop | L → V2 | **live** (02-11-2026, §4b): `571db27` op Pages, `game` v3, 5A 15/15, 5D 24/24 |

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
- **Nog niet getest**: echte telefoons (iOS/Android, mobiel netwerk),
  tokenverversing na > 1 uur spelen, 12 deelnemers in de browser (wel in
  `db:test` en unittests).
- **Geschiedenis staat per toestel/browser** (zoals de identiteit, D6):
  ander toestel of gewiste browsergegevens = lege geschiedenis. Een spel komt
  erin zodra dit toestel de eindstand ziet, of bij het volgende beginscherm
  (lopende spellen van dit toestel worden dan nagelopen).
- **Edge Runtime (Free plan)**: start voor bijna elk verzoek een nieuwe
  worker (~280 boots per ~550 verzoeken). Eén keer een 504 op `game` precies
  bij een worker-`shutdown` en 4 trage `get_room` (~5,5 s) in één
  browserrun; geen gevolgen (leesverzoek, volgende poll/Realtime herstelt;
  een mislukte SPIN toont "Geen verbinding. Probeer het opnieuw.", server
  voorkomt dubbel). Drie gelijktijdige langlopende streams naar één functie
  gaven een 503 (alleen relevant voor de testhulpfunctie).
- Anonieme aanmeldingen: Supabase-limiet per IP-adres (standaard 30 per uur);
  12 spelers op één wifi is ruim binnen de grens.
- Unittest `lobby.test.js` "nog niet beschikbaar" gebruikt nu expliciet
  `key: ''` (anders probeerde hij met `.env.local` echt in te loggen).
- **Voor F3/F4 (echte server/database)**: `playRules.js` en `lobbyRules.js`
  overnemen in de Edge Function; database uitbreiden met wedstrijd
  (`home`/`away`), `organizer_name`, `max_players`, deelnemers zonder
  telefoon (`seats.user_id` nullable + `manual`), `started_at`, `announce`;
  `draws.spun_by`/`on_behalf` vullen uit `spinLog`. Pas na apart akkoord.
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
