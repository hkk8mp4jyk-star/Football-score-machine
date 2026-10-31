// Meldingen over de spelregels in gewone taal (B3), zonder formules.
// Puur, zodat de teksten los te testen zijn.

import { formatCents } from '../game/money.js'

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

// Een regel per probleem; leeg als alles klopt.
export function issueTexts(status) {
  return status.issues.map((issue) => {
    switch (issue.code) {
      case 'players_missing':
        return 'Vul het aantal deelnemers in.'
      case 'rounds_missing':
        return 'Kies het aantal vaste rondes.'
      case 'price_missing':
        return 'Vul de prijs per trekking in (€0 mag ook).'
      case 'too_few':
        return `Selecteer nog ${plural(issue.count, 'uitslag', 'uitslagen')} om alle vaste trekkingen mogelijk te maken.`
      case 'too_many':
        return `Verwijder ${plural(issue.count, 'uitslag', 'uitslagen')} om maximaal 10 veilinguitslagen over te houden.`
      default:
        return 'De spelregels kloppen nog niet.'
    }
  })
}

// Alleen de uitslagenregels (te weinig / te veel); de lege velden staan apart.
export const poolIssueTexts = (status) =>
  issueTexts({ issues: status.issues.filter((i) => i.code === 'too_few' || i.code === 'too_many') })

export function okText(status) {
  const fixed = plural(status.fixed, 'vaste trekking', 'vaste trekkingen')
  return status.lots > 0
    ? `Alles klopt: ${fixed} en ${plural(status.lots, 'veilinguitslag', 'veilinguitslagen')}.`
    : `Alles klopt: ${fixed} en geen veiling.`
}

// Velden van "Nieuw spel" die nog leeg zijn, in de volgorde van het formulier.
const FIELD_NAMES = {
  name: 'jouw naam',
  home: 'thuisploeg',
  away: 'uitploeg',
  players: 'aantal deelnemers',
  price: 'prijs',
  rounds: 'vaste rondes',
}
const FIELD_ORDER = ['name', 'home', 'away', 'players', 'price', 'rounds']
export function missingText(missing) {
  const list = FIELD_ORDER.filter((f) => missing.includes(f)).map((f) => FIELD_NAMES[f])
  if (!list.length) return null
  const joined = list.length > 1 ? `${list.slice(0, -1).join(', ')} en ${list.at(-1)}` : list[0]
  return `Nog invullen: ${joined}.`
}

// Getallen onder het raster: ook zichtbaar als het (nog) niet klopt.
export const countText = (n) => (n == null ? '–' : String(n))

export const priceText = (cents) => (cents == null ? '–' : formatCents(cents))
export const roundsText = (rounds) => (rounds ? String(rounds) : '–')

// Kleur van de melding: rood alleen bij echt ongeldige instellingen (te veel
// uitslagen of ongeldige invoer); onvolledig of nog leeg is neutraal.
export const statusKind = (status, inputError = false) =>
  inputError || status.issues.some((i) => i.code === 'too_many') ? 'bad' : 'wait'
