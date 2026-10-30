// Bewegingsprofiel van één cijferrol: optrekken -> topsnelheid -> afremmen ->
// kleine terugveer in de "inkeping", zoals bij een mechanische rol.
// Pure functie: de positie volgt volledig uit de verstreken tijd, zodat elke
// telefoon die dezelfde draai ontvangt exact hetzelfde beeld toont.

import { REEL_SYMBOLS, TIMING } from './config.js'

const ACCEL = 0.35 // s
const DECEL = 1.15 // s
const SETTLE = TIMING.reelSettle / 1000 // s terugveren
const OVERSHOOT = 0.16 // in symbolen
const TOP_SPEED = 21 // symbolen per seconde (richtwaarde)

export const mod = (n, m) => ((n % m) + m) % m
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)

// p0: startpositie (in symbolen), target: symboolindex waarop de rol stopt,
// totalMs: tijd tot de rol helemaal stilstaat (inclusief terugveren),
// symbols: aantal symbolen op de rol (standaard 0–4 + ★).
export function buildProfile(p0, target, totalMs, symbols = REEL_SYMBOLS) {
  const T = totalMs / 1000
  const Tm = T - SETTLE
  const effective = Tm - ACCEL / 2 - DECEL / 2
  const wanted = p0 + TOP_SPEED * effective - OVERSHOOT
  let land = Math.ceil(wanted)
  land += mod(target - land, symbols)
  const pEnd = land + OVERSHOOT
  const v = (pEnd - p0) / effective
  const pA = p0 + (v * ACCEL) / 2
  const pD = pA + v * (Tm - DECEL - ACCEL)
  return {
    T,
    Tm,
    land,
    at(t) {
      if (t <= 0) return { p: p0, v: 0 }
      if (t < ACCEL) return { p: p0 + (v * t * t) / (2 * ACCEL), v: (v * t) / ACCEL }
      if (t < Tm - DECEL) return { p: pA + v * (t - ACCEL), v }
      if (t < Tm) {
        const s = t - (Tm - DECEL)
        return { p: pD + v * s - (v * s * s) / (2 * DECEL), v: v * (1 - s / DECEL) }
      }
      if (t < T) return { p: pEnd - OVERSHOOT * easeInOut((t - Tm) / SETTLE), v: 0 }
      return { p: land, v: 0 }
    },
  }
}
