// Planck (Box2D) setup for the lane. Planck v1 API: `new World({ gravity })`,
// `world.createBody(def)`, `body.createFixture({ shape, density, ... })`,
// `world.step(1/60, 8, 3)`. Never mutate the world from inside a contact
// callback — events are buffered and applied after the step.

import { Box, Chain, Circle, Edge, World } from 'planck'
import type { Body, World as PlanckWorld } from 'planck'
import { GRAVITY } from './throwing'
import type { Terrain } from './terrain'
import type { PlayerId, Vec } from './types'

/** Toy-ish scale: a real boule is 7.5 cm across, which would be 4 px on screen.
 *  These are "meters" for the physics and "charming" for the eye. */
export const BOULE_R = 0.2
export const COCH_R = 0.09

export const LANE_START = -1.1
export const LANE_END = 13.6
/** Wooden backboard at the far end: hard hits stay in, lobs over it are dead. */
export const BOARD_X = 12.6
export const BOARD_H = 0.5
export const BOARD_HW = 0.07

export const THROW_X = 0.5
export const THROW_H = 1.25

export const COCH_MIN = 6
export const COCH_MAX = 9.6

/** Damping is swapped at runtime: almost none in the air, a lot on the gravel,
 *  which is what makes a boule roll out in ~2–4 m instead of ~15. */
export const AIR_DAMPING = 0.06
export const BOULE_ROLL_DAMPING = 1.75
export const COCH_ROLL_DAMPING = 2.6
export const BOULE_ANGULAR_DAMPING = 3.2

export const BOULES_PER_SIDE = 3

export interface Entity {
  id: number
  kind: 'boule' | 'cochonnet'
  owner: PlayerId | null
  body: Body
  dead: boolean
  /** Was it airborne on the previous step? (used for the landing puff) */
  airborne: boolean
  /** Mirror of the body transform, kept valid after the body is destroyed. */
  pos: Vec
  angle: number
}

/** Copy the body transform into the entity so rendering and scoring never
 *  touch a destroyed body. */
export function syncEntity(e: Entity) {
  if (e.dead) return
  const p = e.body.getPosition()
  e.pos.x = p.x
  e.pos.y = p.y
  e.angle = e.body.getAngle()
}

export interface Lane {
  world: PlanckWorld
  terrain: Terrain
  ground: Body
}

export function createLane(terrain: Terrain): Lane {
  const world = new World({ gravity: { x: 0, y: -GRAVITY }, allowSleep: true })

  const ground = world.createBody({ type: 'static', userData: { kind: 'ground' } })

  // One chain for the whole profile: Planck handles the "ghost collisions"
  // between consecutive segments internally, which a pile of Edges would not.
  ground.createFixture({
    shape: new Chain(terrain.points.map(p => ({ x: p.x, y: p.y })), false),
    friction: 0.92,
    restitution: 0.04,
  })

  // Wall behind the thrower, so a botched backwards bounce stays on screen.
  ground.createFixture({
    shape: new Edge({ x: LANE_START, y: -2 }, { x: LANE_START, y: 6 }),
    friction: 0.3,
    restitution: 0.2,
  })

  const boardY = terrain.heightAt(BOARD_X)
  ground.createFixture({
    shape: new Box(BOARD_HW, BOARD_H / 2, { x: BOARD_X, y: boardY + BOARD_H / 2 }, 0),
    friction: 0.7,
    restitution: 0.22,
  })

  return { world, terrain, ground }
}

export function releasePoint(terrain: Terrain): Vec {
  return { x: THROW_X, y: terrain.heightAt(THROW_X) + THROW_H }
}

let nextId = 1

export function spawnBoule(lane: Lane, owner: PlayerId, at: Vec, velocity: Vec): Entity {
  const body = lane.world.createBody({
    type: 'dynamic',
    position: { x: at.x, y: at.y },
    linearVelocity: { x: velocity.x, y: velocity.y },
    angularVelocity: -velocity.x * 0.6,
    linearDamping: AIR_DAMPING,
    angularDamping: BOULE_ANGULAR_DAMPING,
    bullet: true, // full-power throws must not tunnel through the backboard
    allowSleep: true,
  })
  body.createFixture({
    shape: new Circle(BOULE_R),
    // 0.7 kg for a π·0.2² m² disc.
    density: 0.7 / (Math.PI * BOULE_R * BOULE_R),
    friction: 0.72,
    restitution: 0.16,
  })
  const entity: Entity = { id: nextId++, kind: 'boule', owner, body, dead: false, airborne: true, pos: { x: at.x, y: at.y }, angle: 0 }
  body.setUserData(entity)
  return entity
}

export function spawnCochonnet(lane: Lane, at: Vec, velocity: Vec): Entity {
  const body = lane.world.createBody({
    type: 'dynamic',
    position: { x: at.x, y: at.y },
    linearVelocity: { x: velocity.x, y: velocity.y },
    linearDamping: AIR_DAMPING,
    angularDamping: 2.4,
    bullet: true,
    allowSleep: true,
  })
  body.createFixture({
    shape: new Circle(COCH_R),
    density: 0.03 / (Math.PI * COCH_R * COCH_R),
    friction: 0.8,
    restitution: 0.2,
  })
  const entity: Entity = { id: nextId++, kind: 'cochonnet', owner: null, body, dead: false, airborne: true, pos: { x: at.x, y: at.y }, angle: 0 }
  body.setUserData(entity)
  return entity
}

/** Swap air/ground damping and report a fresh landing (for the dust puff). */
export function updateDamping(entity: Entity, terrain: Terrain): boolean {
  const p = entity.body.getPosition()
  const r = entity.kind === 'boule' ? BOULE_R : COCH_R
  const grounded = p.y - r <= terrain.heightAt(p.x) + 0.035
  const wasAirborne = entity.airborne
  entity.airborne = !grounded
  entity.body.setLinearDamping(
    grounded ? (entity.kind === 'boule' ? BOULE_ROLL_DAMPING : COCH_ROLL_DAMPING) : AIR_DAMPING,
  )
  return grounded && wasAirborne
}

/** Out of play: over/behind the backboard, off the back of the lane, or fallen
 *  through the world (shouldn't happen, but never trust a physics engine). */
export function isOutOfPlay(entity: Entity, terrain: Terrain): boolean {
  const p = entity.body.getPosition()
  if (p.x > BOARD_X + BOARD_HW + 0.05) return true
  if (p.x < LANE_START - 0.4) return true
  if (p.y < terrain.heightAt(p.x) - 1.5) return true
  return false
}

export function atRest(entity: Entity): boolean {
  const b = entity.body
  if (!b.isAwake()) return true
  const v = b.getLinearVelocity()
  return Math.abs(v.x) < 0.13 && Math.abs(v.y) < 0.13 && Math.abs(b.getAngularVelocity()) < 0.9
}

export function destroyLane(lane: Lane | null) {
  if (!lane) return
  let body = lane.world.getBodyList()
  while (body) {
    const next = body.getNext()
    lane.world.destroyBody(body)
    body = next
  }
}
