import { playerName } from '../../game/gameConfig.js'

const euroFormat = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 })
// Zelfde schrijfwijze als "Draait voor €35,00" op het veilingscherm.
const euro = (cents) => euroFormat.format(cents / 100).replace(/\s/g, '')

// Feestelijke aankondiging "WINNAAR VEILING #n" na "Bevestig veiling", kort over de bestaande
// scoremachine heen (op alle telefoons, ~2,6 s; zie ANNOUNCE_MS).
export function AuctionAnnounce({ config, announce }) {
  return (
    <div className="announce" role="status" aria-live="polite">
      <div className="announce-flash" aria-hidden="true" />
      <div className="announce-card">
        <span className="announce-kicker">Winnaar veiling #{announce.lot}</span>
        <b className="announce-name">{playerName(config, announce.participant)}</b>
        <span className="announce-bid">{euro(announce.bidCents)}</span>
      </div>
      <div className="announce-sparks" aria-hidden="true">
        {Array.from({ length: 14 }, (_, i) => (
          <i key={i} style={{ '--a': `${(i * 360) / 14}deg`, '--d': `${90 + ((i * 37) % 60)}px` }} />
        ))}
      </div>
    </div>
  )
}
