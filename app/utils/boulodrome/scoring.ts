// End-of-mène scoring, straight out of the real rules: the side holding the
// point scores one for each of its boules closer than the opponent's best.

import type { BouleSnapshot, PlayerId, Vec } from './types'

/** Two boules this close to the same distance count as a tie (« égalité »). */
export const TIE_EPSILON = 0.012

export function distance(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function liveBoules(boules: BouleSnapshot[], owner: PlayerId): BouleSnapshot[] {
  return boules.filter(b => !b.dead && b.owner === owner)
}

export function sortedDistances(boules: BouleSnapshot[], owner: PlayerId, cochonnet: Vec): number[] {
  return liveBoules(boules, owner)
    .map(b => distance(b, cochonnet))
    .sort((a, b) => a - b)
}

/** Closest live boule of a side, or null when it has none left on the ground. */
export function bestDistance(boules: BouleSnapshot[], owner: PlayerId, cochonnet: Vec): number | null {
  const d = sortedDistances(boules, owner, cochonnet)
  return d.length ? d[0]! : null
}

export interface MeneOutcome {
  winner: PlayerId | null
  points: number
  /** `tie` and `void` both mean "replay the mène". */
  reason: 'points' | 'tie' | 'void'
}

export function scoreMene(boules: BouleSnapshot[], cochonnet: Vec | null): MeneOutcome {
  // Cochonnet knocked out of the lane: the mène is dead, nobody scores.
  if (!cochonnet) return { winner: null, points: 0, reason: 'void' }

  const d0 = sortedDistances(boules, 0, cochonnet)
  const d1 = sortedDistances(boules, 1, cochonnet)
  if (!d0.length && !d1.length) return { winner: null, points: 0, reason: 'void' }
  if (!d1.length) return { winner: 0, points: d0.length, reason: 'points' }
  if (!d0.length) return { winner: 1, points: d1.length, reason: 'points' }

  const best0 = d0[0]!
  const best1 = d1[0]!
  if (Math.abs(best0 - best1) < TIE_EPSILON) return { winner: null, points: 0, reason: 'tie' }

  const winner: PlayerId = best0 < best1 ? 0 : 1
  const mine = winner === 0 ? d0 : d1
  const theirBest = winner === 0 ? best1 : best0
  const points = mine.filter(d => d < theirBest - TIE_EPSILON).length
  return { winner, points: Math.max(1, points), reason: 'points' }
}

export const TARGET_SCORE = 13

export function isGameOver(scores: [number, number]): boolean {
  return scores[0] >= TARGET_SCORE || scores[1] >= TARGET_SCORE
}
