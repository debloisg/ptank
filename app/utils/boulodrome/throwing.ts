// Pure ballistics: the (angle, power) → velocity mapping the player and the AI
// both go through, plus the numeric helpers used for the aim preview and for
// the AI's "how hard do I need to throw to land there?" question.
//
// Air damping in the world is tiny (0.06), so a plain parabola predicts the
// flight closely enough for a preview and for AI planning.

import type { Vec } from './types'

export const GRAVITY = 9.8

export const ANGLE_MIN = (8 * Math.PI) / 180
export const ANGLE_MAX = (78 * Math.PI) / 180
export const SPEED_MIN = 4
export const SPEED_MAX = 10.8

/** Empirical: a boule keeps rolling roughly this many seconds' worth of its
 *  landing speed once it touches the gravel (measured in a headless sim). */
export const ROLL_FACTOR = 0.45

export function clampAngle(a: number): number {
  return a < ANGLE_MIN ? ANGLE_MIN : a > ANGLE_MAX ? ANGLE_MAX : a
}

export function speedForPower(power: number): number {
  const p = power < 0 ? 0 : power > 1 ? 1 : power
  return SPEED_MIN + (SPEED_MAX - SPEED_MIN) * p
}

export function powerForSpeed(speed: number): number {
  const p = (speed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN)
  return p < 0 ? 0 : p > 1 ? 1 : p
}

export function throwVelocity(angle: number, power: number): Vec {
  const s = speedForPower(power)
  const a = clampAngle(angle)
  return { x: Math.cos(a) * s, y: Math.sin(a) * s }
}

export interface Landing {
  x: number
  y: number
  /** Seconds of flight. */
  t: number
  vx: number
  vy: number
  /** Sampled points of the whole arc, ~60 Hz. */
  path: Vec[]
}

/** Numeric ballistic flight over a bumpy ground profile. */
export function simulateFlight(
  origin: Vec,
  angle: number,
  power: number,
  groundY: (x: number) => number,
  radius = 0.2,
  maxT = 4,
): Landing {
  const v = throwVelocity(angle, power)
  let x = origin.x
  let y = origin.y
  const vx = v.x
  let vy = v.y
  const dt = 1 / 120
  const path: Vec[] = [{ x, y }]
  let t = 0
  while (t < maxT) {
    vy -= GRAVITY * dt
    x += vx * dt
    y += vy * dt
    t += dt
    path.push({ x, y })
    if (vy < 0 && y - radius <= groundY(x)) break
  }
  return { x, y, t, vx, vy, path }
}

/** The dotted preview: only the first `fraction` of the arc — you aim, you
 *  don't get the landing spot handed to you. */
export function previewArc(
  origin: Vec,
  angle: number,
  power: number,
  groundY: (x: number) => number,
  radius = 0.2,
  fraction = 0.2,
  dots = 9,
): Vec[] {
  const flight = simulateFlight(origin, angle, power, groundY, radius)
  const last = Math.max(1, Math.floor(flight.path.length * fraction))
  const out: Vec[] = []
  for (let i = 1; i <= dots; i++) {
    const idx = Math.min(flight.path.length - 1, Math.round((last * i) / dots))
    out.push(flight.path[idx]!)
  }
  return out
}

/** Where a throw is expected to come to rest (landing + estimated roll). */
export function predictedRest(
  origin: Vec,
  angle: number,
  power: number,
  groundY: (x: number) => number,
  radius = 0.2,
  rollFactor = ROLL_FACTOR,
): number {
  const f = simulateFlight(origin, angle, power, groundY, radius)
  return f.x + Math.max(0, f.vx) * rollFactor
}

/** Binary search on power for a target resting distance — the mapping is
 *  monotonic in power for a fixed angle, so this always converges. */
export function powerForTarget(
  origin: Vec,
  angle: number,
  targetX: number,
  groundY: (x: number) => number,
  radius = 0.2,
  rollFactor = ROLL_FACTOR,
): number {
  let lo = 0
  let hi = 1
  for (let i = 0; i < 26; i++) {
    const mid = (lo + hi) / 2
    if (predictedRest(origin, angle, mid, groundY, radius, rollFactor) < targetX) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** Speed needed for the parabola to pass through `target` at `angle`
 *  — used by the AI when it decides to shoot a boule out ("tirer").
 *  Returns null when the target is unreachable at that angle. */
export function speedThroughPoint(origin: Vec, target: Vec, angle: number): number | null {
  const dx = target.x - origin.x
  const dy = target.y - origin.y
  if (dx <= 0.2) return null
  const c = Math.cos(angle)
  const denom = 2 * c * c * (dx * Math.tan(angle) - dy)
  if (denom <= 0) return null
  const v2 = (GRAVITY * dx * dx) / denom
  if (!Number.isFinite(v2) || v2 <= 0) return null
  return Math.sqrt(v2)
}
