// Financiële waarde van uitslagen, afgeleid uit de bestaande trekkingen
// (state.draws). Er is geen aparte administratie: elke trekking bevat al de
// ronde en, voor de veiling, het winnende bod. Rekenen gebeurt in centen.

export const REGULAR_VALUE_CENTS = 1000 // €10 per uitslag in de vaste rondes

const toCents = (euros) => Math.round((euros ?? 0) * 100)

// Vaste rondes: de prijs per vaste trekking van het spel (DEMO: €10).
// Veiling: het daadwerkelijk betaalde bod.
export function drawValueCents(draw, priceCents = REGULAR_VALUE_CENTS) {
  return draw.round === 'veiling' ? toCents(draw.bid) : priceCents
}

export function totalCents(draws, priceCents = REGULAR_VALUE_CENTS) {
  return draws.reduce((sum, d) => sum + drawValueCents(d, priceCents), 0)
}

// Totale pot van een spel: alle vaste trekkingen tegen de spelprijs plus alle biedingen.
export function potCents(state) {
  return totalCents(state.draws, state.config?.priceCents ?? REGULAR_VALUE_CENTS)
}

const whole = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0 })
const decimals = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })

// '€10', '€50', '€0,50', '€12,25' — hele bedragen zonder decimalen.
export function formatCents(cents) {
  const f = cents % 100 === 0 ? whole : decimals
  return f.format(cents / 100).replace(/\s/g, '')
}
