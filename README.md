# Football Score Machine

Digitale fruitautomaat voor de jaarlijkse voetbalpool met negen vrienden.
Dit is het **visuele prototype**: alleen ontwerp, animaties en een lokale demo.
Nog geen database, accounts of multiplayer.

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

### Voorbereid op Supabase (realtime multiplayer)

- Alle spelstatus is één serialiseerbaar object; elke wijziging is een actie
  (`SPIN_START`, `SPIN_COMMIT`, `RESET`). Die reducer kan zo naar een
  server-functie, zodat de **server** de uitslag kiest.
- Een draai heeft een `startedAt`-tijdstempel. De rollen rekenen hun positie
  uit die tijd uit, dus alle telefoons die dezelfde draai ontvangen, draaien
  en stoppen synchroon.
- Alleen `useGame.js` hoeft vervangen te worden door een hook die de status
  uit een Supabase realtime-kanaal leest en acties als RPC verstuurt.
