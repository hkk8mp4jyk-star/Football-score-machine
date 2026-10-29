// Cryptografisch veilige willekeur met een exact gelijke kans per uitkomst.
// Werkt in browsers, Node en Deno (Supabase Edge Functions) via Web Crypto.

const RANGE = 2 ** 32

// Uniform geheel getal in [0, n). Rejection sampling voorkomt de kleine
// scheefheid die 'random % n' zou geven.
export function secureRandomInt(n) {
  if (!Number.isInteger(n) || n <= 0 || n > RANGE) throw new RangeError(`ongeldig bereik: ${n}`)
  const limit = RANGE - (RANGE % n) // grootste veelvoud van n onder 2^32
  const buf = new Uint32Array(1)
  for (;;) {
    globalThis.crypto.getRandomValues(buf)
    if (buf[0] < limit) return buf[0] % n
  }
}

export function secureId() {
  return globalThis.crypto.randomUUID()
}
