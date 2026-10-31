// Positie van een rol (in "vakjes") als functie van de tijd. Puur en
// deterministisch: elke telefoon rekent uit dezelfde starttijd hetzelfde
// beeld uit, ook wie halverwege binnenkomt.
//
//   versnellen (accel ms) → topsnelheid (vmax vakjes/ms) → afremmen (decel ms)
//   → stil op `target` (index in de strip van `count` vakjes) op `stopAt`.
// Zonder `stopAt` draait de rol door.

export function reelPosition(t, { startAt = 0, accel = 400, vmax = 0.02, stopAt = null, decel = 700, target = 0, count = 1, phase = 0 }) {
  const run = (x) => {
    const dt = x - startAt
    if (dt <= 0) return phase
    if (dt < accel) return phase + (vmax * dt * dt) / (2 * accel)
    return phase + (vmax * accel) / 2 + vmax * (dt - accel)
  }
  if (stopAt == null || t < stopAt - decel) return run(t)
  const d0 = stopAt - decel
  const p0 = run(d0)
  // Eindpositie: ver genoeg om natuurlijk uit te lopen, precies op het doel.
  const minTravel = (vmax * decel) / 3
  let pf = Math.ceil((p0 + minTravel - target) / count) * count + target
  if (pf < p0 + minTravel) pf += count
  if (t >= stopAt) return pf
  const u = (t - d0) / decel
  return p0 + (pf - p0) * (1 - (1 - u) ** 3)
}

// Welke vakjes zijn zichtbaar in een venster van één vakje hoog: index in
// de strip en verschuiving (−1 … 1, in vakhoogtes) voor het vorige, huidige
// en volgende vakje. Strip loopt van boven naar beneden.
export function visibleItems(position, count) {
  const base = Math.floor(position)
  const frac = position - base
  return [-1, 0, 1, 2].map((k) => ({
    index: (((base - k) % count) + count) % count,
    offset: frac + k - 0, // 0 = precies in beeld
    key: base - k,
  }))
}

// Rol staat stil (op of na `stopAt`)?
export const isStopped = (t, stopAt) => stopAt != null && t >= stopAt
