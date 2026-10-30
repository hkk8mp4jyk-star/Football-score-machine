# Football Score Machine

Digitale fruitautomaat voor de jaarlijkse voetbalpool met negen vrienden.
Het visuele prototype (met lokale demo) is af; multiplayer via Supabase wordt
in fases gebouwd (fase 1 engine en fase 2 database zijn klaar). Zie `CLAUDE.md`
voor alle afspraken en de stand van zaken.

## Wat zit erin

- **Hoofdscherm** (18 trekkingen): ronde 1 (1→9), ronde 2 (9→1).
  Twee draaiende cijferrollen (0–4 en ★). Rol 1 stopt na 3 s, rol 2 na 4,5 s.
  Twee sterren = **OVERIGE UITSLAGEN** met grote aankondiging.
- **MEGA WIN** bij 0-0, 1-0, 2-0, 2-1, 1-2, 0-1, 0-2 en 1-1: flits, trillend
  beeld, lichtstralen, muntenregen en jackpotgeluid over het hele scherm
  (lijst in `MEGA_WIN_IDS` in `src/game/config.js`).
- **Veilingscherm** (laatste 8 uitslagen): naam van de deelnemer met
  "Draait voor €…", daaronder dezelfde machine als in ronde 1 en 2, met 4 gouden vakken erboven en 4 eronder
  op vaste posities. Na het stoppen licht het vak na 0,8 s groen op en verdwijnt
  het. Andere vakken verschuiven niet.
- **Rollen (demo):** iedereen is een van de negen deelnemers en krijgt de
  SPIN-knop alleen als hij zelf aan de beurt is. De *organisator* is ook
  deelnemer en zet daarnaast via het hamer-icoon naast VEILING (bovenaan)
  deelnemer en winnend bod klaar. Wisselen via ••• → Weergave; "Elke beurt zelf draaien" laat de
  organisator in de demo alle beurten draaien.
- **Overzicht** met twee tabbladen: Uitslagen (5×5-raster + Overige,
  met de eigenaar in getrokken vakken) en uitslagen per deelnemer met de waarde
  per uitslag en het totaal. Ronde 1–2: €10 per uitslag; veiling: het betaalde
  bod. Berekend uit de trekkingen zelf (`src/game/money.js`), in centen.
- **Demo-menu** (••• rechtsonder; in de veiling rechtsboven): geluid aan/uit, weergave (organisator of
  deelnemer), direct naar de veiling, demo resetten. De demo onthoudt de stand in de browser (`localStorage`).

## Lokaal draaien

```bash
npm install
npm run dev        # start op http://localhost:5173 én op je netwerk-IP
```

### Bekijken op je telefoon

1. **Zelfde wifi:** `npm run dev` toont een `Network:`-adres
   (bijv. `http://192.168.1.20:5173`). Open dat op je telefoon.
2. **GitHub Pages (vaste link):** zet in de repository *Settings → Pages →
   Source* op **GitHub Actions**. Elke push naar `main` publiceert dan
   automatisch naar `https://<gebruiker>.github.io/<repo>/`.
3. **Los HTML-bestand:** `npm run build:artifact` maakt
   `dist-artifact/football-score-machine.html` met alles erin.

Tip: voeg de pagina op iPhone toe aan het beginscherm (Deel → Zet op
beginscherm) voor een schermvullende weergave.

## Techniek

React 19 + Vite + Tailwind CSS 4.

```
src/game/config.js    spelregels: deelnemers, 26 uitslagen (0-0 t/m 4-4 + Overige),
                      2 rondes, beurtvolgorde, timing
src/game/engine.js    pure reducer met alle spelacties (serialiseerbare status)
src/game/money.js     waarde per uitslag en totalen, afgeleid uit de trekkingen
src/game/useGame.js   lokale opslag-adapter (later vervangen door Supabase)
src/components/       SlotMachine, Reel, MainScreen, AuctionScreen, Overview, DemoMenu
src/audio/sound.js    gesynthetiseerde geluiden via Web Audio
```

### Tests

```bash
npm test           # Vitest: spelregels, trekking, veiling, bedragen, timing, herstel
```

### Tijdgestuurd spelverloop

Een geaccepteerde SPIN legt direct de uitslag en het starttijdstip vast
(`state.spin`). Alles daarna volgt uitsluitend uit de tijd:

```
src/game/timeline.js  momenten van één draai: stoppen, vak groen/weg, vastleggen, beurt vrij
src/game/view.js      wat het scherm op tijdstip t toont (geen losse timers)
src/game/clock.js     gedeelde klok; in multiplayer gecorrigeerd naar de serverklok
src/game/random.js    cryptografisch veilige, gelijkmatige willekeur
src/game/reelMotion.js beweging van de cijferrollen als functie van de tijd
```

Daardoor tonen alle toestellen met dezelfde status hetzelfde, en loopt een
draai na herladen of opnieuw verbinden gewoon op de juiste plek verder.

### Database (Supabase) — multiplayer

Supabase-project `twzjsmxydnfmowrmffsl` ("football-score-machine-v2", regio
eu-west-3 Paris). Het eerdere project `nptulnnuejivwcgcltuy` is defect en wordt
niet meer gebruikt.

Migraties (`supabase/migrations`, op volgorde):

1. `multiplayer_schema` — tabellen, RLS, rechten, `commit_room_state`.
2. `version_conflict_pt409` — versieconflict meldt foutcode `PT409` in plaats
   van 40001. PostgREST herhaalt 40001 automatisch, wat bij een verouderde
   versie een eindeloze lus gaf; PT409 wordt een gewone HTTP 409.

"Automatically expose new tables" staat uit: alle rechten die het spel nodig
heeft, staan expliciet in de migraties.

```bash
npm run db:status    # project, migraties en tabellen (alleen lezen)
npm run db:migrate   # openstaande migraties uit supabase/migrations uitvoeren
npm run db:test      # beveiligings- en databasetests (laten niets achter)
```

Toegang via de Management API: in Claude Code voegt de beveiligde proxy het
access token toe (Network secret voor `api.supabase.com`); lokaal zet je
`SUPABASE_ACCESS_TOKEN`.

| Tabel | Inhoud | Deelnemers | Server |
|---|---|---|---|
| `rooms` | kamercode, organisator, spelstatus (engine-formaat), versie | lezen (eigen kamer) | alles |
| `seats` | welke telefoon welke naam heeft | lezen (eigen kamer) | alles |
| `draws` | definitieve trekkingen, uniek per kamer en uitslag | lezen (eigen kamer) | toevoegen, nooit wijzigen |

- Deelnemers kunnen niets rechtstreeks wijzigen (Row Level Security zonder
  schrijfregels, geen schrijfrechten).
- `commit_room_state(room, verwachte_versie, status, trekking)` is de enige
  schrijfroute voor het spel en alleen uitvoerbaar door de server
  (`service_role`). Status en trekking worden samen vastgelegd; bij een
  verouderde versie (dubbele of gelijktijdige SPIN) of een dubbele uitslag
  verandert er niets.

### Server: Edge Function `game` (fase 3)

Alle spelacties lopen via één Supabase Edge Function
(`supabase/functions/game`). De telefoon logt anoniem in en stuurt alleen
"wat wil ik doen"; de server controleert wie het vraagt, past de spelregels
toe met dezelfde engine en kiest zelf de uitslag.

```bash
npm run fn:deploy    # functie uitrollen
npm run fn:test      # live test met echte anonieme logins (ruimt alles op)
```

Installeren en testen gaat stap voor stap: migreren, `db:test`, uitrollen,
dan pas de live test, eerst zonder en daarna met gelijktijdige verzoeken.

Acties: `time`, `create_room`, `lookup_room`, `claim_seat`, `get_room`,
`release_seat` (organisator), `spin` (wie aan de beurt is; organisator namens
een ander alleen met `onBehalf: true`), `auction_prepare` (organisator).
Logica in `src/server/` (getest met `npm test` en tegen de echte database met
`npm run db:test`).

### Voorbereid op Supabase (realtime multiplayer)

- Alle spelstatus is één serialiseerbaar object; elke wijziging is een actie
  (`SPIN_START`, `AUCTION_PREPARE`, `RESET`). Die reducer kan zo naar een
  server-functie, zodat de **server** de uitslag kiest.
- Een draai heeft een `startedAt`-tijdstempel. De rollen rekenen hun positie
  uit die tijd uit, dus alle telefoons die dezelfde draai ontvangen, draaien
  en stoppen synchroon.
- Alleen `useGame.js` hoeft vervangen te worden door een hook die de status
  uit een Supabase realtime-kanaal leest en acties als RPC verstuurt.
