// Pétanque alternation: the side that is NOT holding the point throws next.
// Not a simple back-and-forth — a side that keeps missing keeps throwing.

import { bestDistance } from './scoring'
import type { BouleSnapshot, PlayerId, Vec } from './types'
import { OTHER } from './types'

export interface TurnState {
  boules: BouleSnapshot[]
  cochonnet: Vec | null
  /** Boules still in hand, per side. */
  remaining: [number, number]
  /** Who threw the previous boule of this mène (null at the start). */
  lastThrower: PlayerId | null
  /** Who threw the cochonnet — they also throw the first boule. */
  starter: PlayerId
}

/** null = the mène is over, every boule has been played. */
export function nextThrower(state: TurnState): PlayerId | null {
  const { remaining, cochonnet, boules, lastThrower, starter } = state
  if (remaining[0] <= 0 && remaining[1] <= 0) return null
  if (remaining[0] <= 0) return 1
  if (remaining[1] <= 0) return 0
  if (lastThrower === null) return starter
  // Cochonnet gone (knocked out): the mène is void anyway, keep alternating.
  if (!cochonnet) return OTHER[lastThrower]

  const b0 = bestDistance(boules, 0, cochonnet)
  const b1 = bestDistance(boules, 1, cochonnet)
  if (b0 === null && b1 === null) return OTHER[lastThrower]
  if (b0 === null) return 0
  if (b1 === null) return 1
  if (Math.abs(b0 - b1) < 1e-4) return lastThrower // dead heat: replay the same side
  return b0 < b1 ? 1 : 0
}
