# Football Score Machine

Digitale fruitautomaat voor de jaarlijkse voetbalpool met negen vrienden.
Dit is het **visuele prototype**: alleen ontwerp, animaties en een lokale demo.
Nog geen database, accounts of multiplayer.

## Wat zit erin

- **Hoofdscherm** (27 trekkingen): ronde 1 (1→9), ronde 2 (9→1), ronde 3 (1→9).
  Twee draaiende cijferrollen (0–5 en ★). Rol 1 stopt na 3 s, rol 2 na 4,5 s.
  Twee sterren = **OVERIGE UITSLAGEN** met grote aankondiging.
- **MEGA WIN** bij 0-0, 1-0, 2-0, 2-1, 1-2, 0-1, 0-2 en 1-1: flits, trillend
  beeld, lichtstralen, muntenregen en jackpotgeluid over het hele scherm
  (lijst in `MEGA_WIN_IDS` in `src/game/config.js`).
- **Veilingscherm** (laatste 10 uitslagen): compacte machine met links en rechts
  vijf gouden vakken op vaste posities. Na de draai blijft de uitslag 2 s staan,
  daarna licht het vak groen op en verdwijnt het. Andere vakken verschuiven niet.
- **Overzicht** met twee tabbladen: resterende uitslagen (6×6-raster + Overige)
  en uitslagen per deelnemer.
- **Demo-menu** (••• rechtsboven): geluid aan/uit, direct naar de veiling,
  demo resetten. De demo onthoudt de stand in de browser (`localStorage`).

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
src/game/config.js    spelregels: deelnemers, 37 uitslagen, beurtvolgorde, timing
src/game/engine.js    pure reducer met alle spelacties (serialiseerbare status)
src/game/useGame.js   lokale opslag-adapter (later vervangen door Supabase)
src/components/       SlotMachine, Reel, MainScreen, AuctionScreen, Overview, DemoMenu
src/audio/sound.js    gesynthetiseerde geluiden via Web Audio
```

### Voorbereid op Supabase (realtime multiplayer)

- Alle spelstatus is één serialiseerbaar object; elke wijziging is een actie
  (`SPIN_START`, `SPIN_COMMIT`, `RESET`). Die reducer kan zo naar een
  server-functie, zodat de **server** de uitslag kiest.
- Een draai heeft een `startedAt`-tijdstempel. De rollen rekenen hun positie
  uit die tijd uit, dus alle telefoons die dezelfde draai ontvangen, draaien
  en stoppen synchroon.
- Alleen `useGame.js` hoeft vervangen te worden door een hook die de status
  uit een Supabase realtime-kanaal leest en acties als RPC verstuurt.
