// The opponent. One tuned difficulty: good enough to punish a lazy throw,
// human enough to miss. It goes through exactly the same (angle, power) →
// velocity mapping as the player, then gets gaussian noise on both.

import { gaussian, between, clamp } from './rng'
import { bestDistance, distance } from './scoring'
import {
  ANGLE_MAX,
  ANGLE_MIN,
  powerForSpeed,
  powerForTarget,
  speedThroughPoint,
} from './throwing'
import type { BouleSnapshot, PlayerId, ThrowInput, Vec } from './types'
import { OTHER } from './types'

export interface AiContext {
  origin: Vec
  cochonnet: Vec
  boules: BouleSnapshot[]
  remaining: [number, number]
  self: PlayerId
  groundY: (x: number) => number
  bouleRadius: number
}

export interface AiPlan extends ThrowInput {
  intent: 'point' | 'tir'
}

const DEG = Math.PI / 180

export function planAiThrow(ctx: AiContext, rng: () => number): AiPlan {
  const opponent = OTHER[ctx.self]
  const mine = bestDistance(ctx.boules, ctx.self, ctx.cochonnet)
  const theirs = bestDistance(ctx.boules, opponent, ctx.cochonnet)
  const losing = theirs !== null && (mine === null || theirs < mine)
  const lastBoules = ctx.remaining[ctx.self] <= 2

  // Behind on the point with the end in sight → go for the shot ("tirer").
  if (losing && lastBoules && theirs !== null && theirs < 1.1) {
    const target = closestOpponentBoule(ctx, opponent)
    if (target) {
      const plan = planShot(ctx, target, rng)
      if (plan) return plan
    }
  }
  return planPoint(ctx, rng)
}

function closestOpponentBoule(ctx: AiContext, opponent: PlayerId): BouleSnapshot | null {
  let best: BouleSnapshot | null = null
  let bestD = Infinity
  for (const b of ctx.boules) {
    if (b.dead || b.owner !== opponent) continue
    const d = distance(b, ctx.cochonnet)
    if (d < bestD) {
      bestD = d
      best = b
    }
  }
  return best
}

/** Drop a boule as close to the cochonnet as possible ("pointer"). */
function planPoint(ctx: AiContext, rng: () => number): AiPlan {
  // Aim slightly short: the roll estimate is optimistic and a boule that stops
  // in front of the cochonnet blocks the lane, which is good pétanque.
  const target = ctx.cochonnet.x - between(rng, 0.05, 0.35)
  const angle = clamp(between(rng, 33 * DEG, 55 * DEG), ANGLE_MIN, ANGLE_MAX)
  const ideal = powerForTarget(ctx.origin, angle, target, ctx.groundY, ctx.bouleRadius)
  return {
    angle: clamp(angle + gaussian(rng, 0, 1.6 * DEG), ANGLE_MIN, ANGLE_MAX),
    power: clamp(ideal + gaussian(rng, 0, 0.032), 0, 1),
    intent: 'point',
  }
}

/** Fire flat at a boule and try to knock it out ("tirer au fer"). */
function planShot(ctx: AiContext, target: BouleSnapshot, rng: () => number): AiPlan | null {
  const aim: Vec = { x: target.x, y: target.y + ctx.bouleRadius * 0.15 }
  for (const deg of [16, 20, 24, 28, 12]) {
    const angle = deg * DEG
    const speed = speedThroughPoint(ctx.origin, aim, angle)
    if (speed === null || speed > 10.6 || speed < 5) continue
    const power = powerForSpeed(speed)
    if (power >= 0.995) continue
    return {
      angle: clamp(angle + gaussian(rng, 0, 1.15 * DEG), ANGLE_MIN, ANGLE_MAX),
      power: clamp(power + gaussian(rng, 0, 0.022), 0, 1),
      intent: 'tir',
    }
  }
  return null
}
