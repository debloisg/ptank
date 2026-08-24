// Seeded RNG. The terrain and the AI both need to be reproducible from a seed:
// the terrain so a mène looks identical across re-renders, the AI so its
// behaviour can be replayed.

/** mulberry32 — small, fast, good enough for gravel bumps and aim noise. */
export function createRng(seed: number): () => number {
  let t = (seed >>> 0) || 1
  return () => {
    t = (t + 0x6D2B79F5) >>> 0
    let x = Math.imul(t ^ (t >>> 15), 1 | t)
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

export function gaussian(rng: () => number, mu = 0, sigma = 1): number {
  let u = 0
  let v = 0
  while (u === 0) u = rng()
  while (v === 0) v = rng()
  return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

export function between(rng: () => number, a: number, b: number): number {
  return a + (b - a) * rng()
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}
