// Financiële waarde van uitslagen, afgeleid uit de bestaande trekkingen
// (state.draws). Er is geen aparte administratie: elke trekking bevat al de
// ronde en, voor de veiling, het winnende bod. Rekenen gebeurt in centen.

export const REGULAR_VALUE_CENTS = 1000 // €10 per uitslag in ronde 1, 2 en 3

const toCents = (euros) => Math.round((euros ?? 0) * 100)

// Ronde 1-3: vaste €10. Veiling: het daadwerkelijk betaalde bod.
export function drawValueCents(draw) {
  return draw.round === 'veiling' ? toCents(draw.bid) : REGULAR_VALUE_CENTS
}

export function totalCents(draws) {
  return draws.reduce((sum, d) => sum + drawValueCents(d), 0)
}

const whole = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0 })
const decimals = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })

// '€10', '€50', '€0,50', '€12,25' — hele bedragen zonder decimalen.
export function formatCents(cents) {
  const f = cents % 100 === 0 ? whole : decimals
  return f.format(cents / 100).replace(/\s/g, '')
}
