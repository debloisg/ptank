// Procedural gravel lane. Regenerated (new seed) at every mène so no two ends
// are played on exactly the same ground — the bumps are what make a roll
// interesting instead of deterministic.

import { createRng } from './rng'
import type { Vec } from './types'

const TAU = Math.PI * 2

export interface Speckle {
  x: number
  y: number
  r: number
  /** 0..1 — how light the grain is. */
  tone: number
}

export interface Terrain {
  seed: number
  x0: number
  x1: number
  step: number
  points: Vec[]
  heightAt: (x: number) => number
  speckles: Speckle[]
  /** Faint rake lines drawn across the gravel. */
  rakes: number[]
}

export function createTerrain(seed: number, x0: number, x1: number): Terrain {
  const rng = createRng(seed)
  const p1 = rng() * TAU
  const p2 = rng() * TAU
  const p3 = rng() * TAU
  const tilt = (rng() - 0.5) * 0.012

  const profile = (x: number) =>
    0.055 * Math.sin(x * 0.62 + p1)
    + 0.032 * Math.sin(x * 1.77 + p2)
    + 0.016 * Math.sin(x * 4.4 + p3)
    + tilt * x

  const step = 0.22
  const points: Vec[] = []
  for (let x = x0; x <= x1 + step * 0.5; x += step) {
    points.push({ x, y: profile(x) })
  }

  const heightAt = (x: number): number => {
    const t = (x - x0) / step
    const i = Math.floor(t)
    if (i < 0) return points[0]!.y
    if (i >= points.length - 1) return points[points.length - 1]!.y
    const a = points[i]!
    const b = points[i + 1]!
    return a.y + (b.y - a.y) * (t - i)
  }

  const speckles: Speckle[] = []
  for (let i = 0; i < 620; i++) {
    const x = x0 + rng() * (x1 - x0)
    const depth = rng() ** 1.6
    speckles.push({
      x,
      y: heightAt(x) - 0.02 - depth * 1.05,
      r: 0.008 + rng() * 0.022,
      tone: rng(),
    })
  }

  const rakes: number[] = []
  for (let i = 0; i < 26; i++) rakes.push(x0 + rng() * (x1 - x0))

  return { seed, x0, x1, step, points, heightAt, speckles, rakes }
}
