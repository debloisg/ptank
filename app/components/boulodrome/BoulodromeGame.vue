<script setup lang="ts">
// « Le Boulodrome » — the whole game: Planck world, fixed-timestep loop, input,
// canvas rendering and the DOM HUD on top. Mounted client-side only (the page
// shell wraps it in <ClientOnly>), so window/document are fair game.
//
// Per-frame data deliberately never goes through Vue reactivity: the `sim`
// object below is plain, and only the handful of refs the HUD reads are
// reactive.
import type { AiPlan } from '~/utils/boulodrome/ai'
import { planAiThrow } from '~/utils/boulodrome/ai'
import { GameAudio } from '~/utils/boulodrome/audio'
import { Effects } from '~/utils/boulodrome/effects'
import { playerColor } from '~/utils/boulodrome/palette'
import type { Backdrop, Camera, SceneEntity, SceneMeasure, View } from '~/utils/boulodrome/render'
import { clearCanvas, createBackdrop, drawScene, makeView, VIEW_W, WORLD_ASPECT } from '~/utils/boulodrome/render'
import { between, clamp, createRng } from '~/utils/boulodrome/rng'
import { bestDistance, distance, isGameOver, scoreMene } from '~/utils/boulodrome/scoring'
import { Seagull } from '~/utils/boulodrome/seagull'
import type { Terrain } from '~/utils/boulodrome/terrain'
import { createTerrain } from '~/utils/boulodrome/terrain'
import { clampAngle, powerForTarget, previewArc, throwVelocity } from '~/utils/boulodrome/throwing'
import { nextThrower } from '~/utils/boulodrome/turns'
import type { BoulodromeMode, BouleSnapshot, Phase, PlayerId, Vec } from '~/utils/boulodrome/types'
import type { Entity, Lane } from '~/utils/boulodrome/world'
import {
  atRest,
  BOARD_H,
  BOARD_HW,
  BOARD_X,
  BOULE_R,
  BOULES_PER_SIDE,
  COCH_MAX,
  COCH_MIN,
  COCH_R,
  createLane,
  destroyLane,
  isOutOfPlay,
  LANE_END,
  LANE_START,
  releasePoint,
  spawnBoule,
  spawnCochonnet,
  syncEntity,
  THROW_X,
  updateDamping,
} from '~/utils/boulodrome/world'

const props = defineProps<{ mode: BoulodromeMode }>()
const emit = defineEmits<{ quit: [] }>()

const DEG = Math.PI / 180
const FIXED = 1 / 60
const CHARGE_RATE = 1.25
const DEFAULT_ANGLE = 42 * DEG
const MENE_END_DURATION = 3
const SOUND_KEY = 'ptank:boulodrome:sound'

// ------------------------------------------------------------- HUD state

const wrapperEl = ref<HTMLDivElement | null>(null)
const canvasEl = ref<HTMLCanvasElement | null>(null)

const phase = ref<Phase>('cochonnet')
const scores = ref<[number, number]>([0, 0])
const mene = ref(1)
const remaining = ref<[number, number]>([BOULES_PER_SIDE, BOULES_PER_SIDE])
const thrower = ref<PlayerId | null>(null)
const banner = ref<string | null>(null)
const toast = ref<string | null>(null)
const winner = ref<PlayerId | null>(null)
const soundOn = ref(false)
const announcement = ref('')
const isFullscreen = ref(false)
const fullscreenEnabled = ref(true)

const names = computed<[string, string]>(() =>
  props.mode === 'ai' ? ['Vous', 'L’ordinateur'] : ['Joueur 1', 'Joueur 2'],
)
const nameOf = (p: PlayerId) => names.value[p]

const isHumanTurn = computed(() =>
  thrower.value !== null
  && !(props.mode === 'ai' && thrower.value === 1)
  && (phase.value === 'aiming' || phase.value === 'charging'),
)

const ariaLabel = computed(() =>
  `Mène ${mene.value}. ${nameOf(0)} ${scores.value[0]}, ${nameOf(1)} ${scores.value[1]}. `
  + (thrower.value !== null
    ? `${nameOf(thrower.value)} joue, ${remaining.value[thrower.value]} boules restantes.`
    : 'Lancer du cochonnet.'),
)

const colorOf = (p: PlayerId) => playerColor(p).stripe

const gameOverLine = computed(() => {
  const w = winner.value
  if (w === null) return ''
  const loser: PlayerId = w === 0 ? 1 : 0
  const scoreLine = `${scores.value[w]} à ${scores.value[loser]}`
  if (props.mode === 'ai') {
    return w === 0
      ? `Vous avez gagné ${scoreLine} !`
      : `L’ordinateur a gagné ${scoreLine}.`
  }
  return `${nameOf(w)} gagne ${scoreLine} !`
})

// Wrapper classes/styles for the fullscreen toggle: no aspect-ratio/height cap
// and square corners once the element itself is the whole screen.
const wrapperStyle = computed(() => (
  isFullscreen.value
    ? { width: '100%', height: '100%' }
    : { aspectRatio: '2.4 / 1', maxHeight: 'min(70vh, 620px)' }
))

// ------------------------------------------------------------- simulation

interface Sim {
  lane: Lane | null
  terrain: Terrain
  entities: Entity[]
  cochonnet: Entity | null
  origin: Vec
  angle: number
  lastAngle: [number, number]
  power: number
  chargeDir: number
  pointerDown: boolean
  pointerY: number
  keyDir: number
  starter: PlayerId
  lastThrower: PlayerId | null
  settle: number
  elapsed: number
  meneTimer: number
  meneScored: boolean
  cochTries: number
  bannerTimer: number
  ai: { stage: 'think' | 'aim' | 'charge' | null, timer: number, plan: AiPlan | null }
  cam: Camera
  camTargetX: number
  camTargetW: number
  camTargetY: number
  timeScale: number
  slowmo: number
  measures: SceneMeasure[]
  seed: number
  followId: number | null
  lastClack: number
  time: number
}

let sim: Sim
let effects: Effects
let backdrop: Backdrop
let gull: Seagull
let audio: GameAudio
let rng: () => number
let reducedMotion = false
let raf = 0
let lastFrame = 0
let acc = 0
let lastView: View | null = null
let cssW = 0
let cssH = 0
let resizeObserver: ResizeObserver | null = null
const impactVy = new Map<number, number>()
let contacts: { a: unknown, b: unknown, n: number }[] = []

function makeSim(): Sim {
  const seed = (Date.now() ^ 0x9e3779b9) >>> 0
  const terrain = createTerrain(seed, LANE_START - 1, LANE_END + 1)
  return {
    lane: null,
    terrain,
    entities: [],
    cochonnet: null,
    origin: releasePoint(terrain),
    angle: DEFAULT_ANGLE,
    lastAngle: [DEFAULT_ANGLE, DEFAULT_ANGLE],
    power: 0,
    chargeDir: 1,
    pointerDown: false,
    pointerY: 0,
    keyDir: 0,
    starter: 0,
    lastThrower: null,
    settle: 0,
    elapsed: 0,
    meneTimer: 0,
    meneScored: false,
    cochTries: 0,
    bannerTimer: 0,
    ai: { stage: null, timer: 0, plan: null },
    cam: { cx: 5, cy: 1.2, viewW: VIEW_W },
    camTargetX: 5,
    camTargetW: VIEW_W,
    camTargetY: 1.2,
    timeScale: 1,
    slowmo: 0,
    measures: [],
    seed,
    followId: null,
    lastClack: 0,
    time: 0,
  }
}

// ------------------------------------------------------------- helpers

const groundY = (x: number) => sim.terrain.heightAt(x)

function snapshot(): BouleSnapshot[] {
  return sim.entities
    .filter(e => e.kind === 'boule')
    .map(e => ({ owner: (e.owner ?? 0) as PlayerId, x: e.pos.x, y: e.pos.y, dead: e.dead }))
}

function cochonnetPos(): Vec | null {
  const c = sim.cochonnet
  return c && !c.dead ? { x: c.pos.x, y: c.pos.y } : null
}

function isAiTurn(p: PlayerId | null) {
  return props.mode === 'ai' && p === 1
}

function setBanner(text: string, seconds = 2) {
  banner.value = text
  sim.bannerTimer = seconds
  announcement.value = text
}

// ------------------------------------------------------------- game flow

function startGame() {
  scores.value = [0, 0]
  mene.value = 1
  winner.value = null
  toast.value = null
  sim.starter = 0
  startMene()
}

function startMene() {
  destroyLane(sim.lane)
  sim.seed = (Math.imul(sim.seed, 1103515245) + 12345) >>> 0
  sim.terrain = createTerrain(sim.seed, LANE_START - 1, LANE_END + 1)
  sim.lane = createLane(sim.terrain)
  sim.lane.world.on('post-solve', (contact, impulse) => {
    let n = 0
    for (const v of impulse.normalImpulses) n = Math.max(n, v)
    if (n < 0.5) return
    contacts.push({
      a: contact.getFixtureA().getBody().getUserData(),
      b: contact.getFixtureB().getBody().getUserData(),
      n,
    })
  })

  sim.entities = []
  sim.cochonnet = null
  sim.origin = releasePoint(sim.terrain)
  sim.lastThrower = null
  sim.measures = []
  sim.followId = null
  sim.settle = 0
  sim.elapsed = 0
  sim.cochTries = 0
  sim.camTargetW = VIEW_W
  impactVy.clear()
  contacts = []
  effects.clear()
  remaining.value = [BOULES_PER_SIDE, BOULES_PER_SIDE]
  thrower.value = null
  toast.value = null

  throwCochonnet()
  phase.value = 'cochonnet'
  setBanner('Le cochonnet !', 1.4)
}

function throwCochonnet() {
  const target = between(rng, COCH_MIN, COCH_MAX)
  const angle = between(rng, 38 * DEG, 48 * DEG)
  const power = powerForTarget(sim.origin, angle, target, groundY, COCH_R, 0.3)
  const c = spawnCochonnet(sim.lane!, { ...sim.origin }, throwVelocity(angle, power))
  sim.cochonnet = c
  sim.entities.push(c)
  sim.followId = c.id
  sim.elapsed = 0
  sim.settle = 0
}

function beginTurn(p: PlayerId) {
  thrower.value = p
  phase.value = 'aiming'
  sim.angle = sim.lastAngle[p]
  sim.power = 0
  sim.chargeDir = 1
  sim.pointerDown = false
  sim.camTargetW = VIEW_W
  sim.measures = []

  if (isAiTurn(p)) {
    sim.ai = { stage: 'think', timer: between(rng, 0.7, 1.3), plan: null }
    setBanner('L’ordinateur joue…', 1.6)
  } else {
    sim.ai = { stage: null, timer: 0, plan: null }
    setBanner(props.mode === 'ai' ? 'À vous de jouer !' : `Aux boules, ${nameOf(p)} !`, 1.8)
  }
}

function doThrow(angle: number, power: number) {
  const p = thrower.value
  if (p === null || !sim.lane) return
  sim.lastAngle[p] = angle
  const boule = spawnBoule(sim.lane, p, { ...sim.origin }, throwVelocity(angle, power))
  sim.entities.push(boule)
  sim.followId = boule.id
  const left: [number, number] = [...remaining.value] as [number, number]
  left[p] = Math.max(0, left[p] - 1)
  remaining.value = left
  phase.value = 'flight'
  sim.settle = 0
  sim.elapsed = 0
  sim.power = 0
  sim.ai.stage = null
  banner.value = null
}

function onSettled() {
  if (phase.value === 'cochonnet') {
    const c = sim.cochonnet
    const badLength = !c || c.dead || c.pos.x < 4.6 || c.pos.x > 11.2
    if (badLength && sim.cochTries < 4) {
      // Bad cochonnet — throw it again, like a real player would.
      sim.cochTries += 1
      if (c && !c.dead && sim.lane) sim.lane.world.destroyBody(c.body)
      sim.entities = sim.entities.filter(e => e !== c)
      throwCochonnet()
      return
    }
    if (!c || c.dead) {
      // Should not happen, but never leave the game without a cochonnet.
      throwCochonnet()
      return
    }
    beginTurn(sim.starter)
    return
  }

  if (phase.value !== 'flight') return
  sim.lastThrower = thrower.value
  const coch = cochonnetPos()
  if (!coch) {
    endMene()
    return
  }
  const next = nextThrower({
    boules: snapshot(),
    cochonnet: coch,
    remaining: remaining.value,
    lastThrower: sim.lastThrower,
    starter: sim.starter,
  })
  if (next === null) endMene()
  else beginTurn(next)
}

function endMene() {
  const boules = snapshot()
  const coch = cochonnetPos()
  const outcome = scoreMene(boules, coch)

  sim.measures = []
  if (coch) {
    for (const owner of [0, 1] as PlayerId[]) {
      const d = bestDistance(boules, owner, coch)
      if (d === null) continue
      const best = boules
        .filter(b => !b.dead && b.owner === owner)
        .reduce<BouleSnapshot | null>((acc2, b) => {
          if (!acc2) return b
          return distance(b, coch) < distance(acc2, coch) ? b : acc2
        }, null)
      if (best) {
        sim.measures.push({
          from: coch,
          to: { x: best.x, y: best.y },
          label: `${Math.round(d * 100)} cm`,
          owner,
        })
      }
    }
  }

  sim.meneScored = outcome.winner !== null && outcome.points > 0
  if (outcome.winner !== null && outcome.points > 0) {
    const next: [number, number] = [...scores.value] as [number, number]
    next[outcome.winner] += outcome.points
    scores.value = next
    toast.value = `${nameOf(outcome.winner)} marque ${outcome.points} point${outcome.points > 1 ? 's' : ''} !`
    sim.starter = outcome.winner
    audio.cheer()
  } else if (outcome.reason === 'tie') {
    toast.value = 'Égalité au cochonnet : la mène est rejouée.'
  } else {
    toast.value = 'Mène nulle : personne ne marque.'
  }

  announcement.value = `${toast.value} Score : ${nameOf(0)} ${scores.value[0]}, ${nameOf(1)} ${scores.value[1]}.`
  banner.value = null
  thrower.value = null
  phase.value = 'mene-end'
  sim.meneTimer = 0
  // Measuring moment: ease in on the cochonnet.
  sim.camTargetW = coch && !reducedMotion ? 5.4 : VIEW_W
}

function advanceAfterMene() {
  if (isGameOver(scores.value)) {
    winner.value = scores.value[0] >= scores.value[1] ? 0 : 1
    phase.value = 'game-over'
    toast.value = null
    sim.camTargetW = VIEW_W
    effects.confetti(sim.cam.cx - 6, sim.cam.cx + 6, sim.cam.cy + 2.4)
    audio.cheer()
    announcement.value = gameOverLine.value
    return
  }
  // A tie or a void mène is replayed under the same number.
  if (sim.meneScored) mene.value += 1
  startMene()
}

function restart() {
  winner.value = null
  startGame()
}

// ------------------------------------------------------------- physics

function stepPhysics(dt: number) {
  const lane = sim.lane
  if (!lane) return

  for (const e of sim.entities) {
    if (e.dead) continue
    impactVy.set(e.id, e.body.getLinearVelocity().y)
  }

  lane.world.step(dt, 8, 3)

  for (const e of sim.entities) {
    if (e.dead) continue
    syncEntity(e)
    const landed = updateDamping(e, sim.terrain)
    // Stragglers creeping down a slope: hurry them along rather than making
    // the player wait for Box2D's sleep threshold.
    if (sim.elapsed > 3 && !e.airborne) {
      e.body.setLinearDamping(e.body.getLinearDamping() * 2.4)
    }
    if (landed) {
      const vy = Math.abs(impactVy.get(e.id) ?? 0)
      const v = e.body.getLinearVelocity()
      const strength = Math.max(vy, Math.abs(v.x)) * 0.28
      if (strength > 0.18) {
        effects.puff(e.pos.x, groundY(e.pos.x) + 0.02, strength)
        audio.thud(strength * 0.8)
        if (vy > 6) effects.kick(0.05)
      }
    }
  }

  processContacts()

  for (const e of sim.entities) {
    if (e.dead) continue
    if (isOutOfPlay(e, sim.terrain)) killEntity(e)
  }
}

function killEntity(e: Entity) {
  effects.puff(e.pos.x, groundY(e.pos.x) + 0.05, 1.4)
  audio.pop()
  e.dead = true
  if (sim.lane) sim.lane.world.destroyBody(e.body)
  if (e === sim.cochonnet) {
    setBanner('Cochonnet perdu — mène nulle !', 2)
  }
}

function isEntity(x: unknown): x is Entity {
  const kind = (x as Entity | null)?.kind
  return kind === 'boule' || kind === 'cochonnet'
}

function processContacts() {
  for (const c of contacts) {
    // Both sides must be boules/cochonnet: gravel and backboard hits are
    // handled by the landing puff, not by the metallic clack.
    if (!isEntity(c.a) || !isEntity(c.b)) continue
    const a = c.a
    const b = c.b
    const hard = c.n
    if (sim.time - sim.lastClack < 0.05) continue
    sim.lastClack = sim.time
    const x = (a.pos.x + b.pos.x) / 2
    const y = (a.pos.y + b.pos.y) / 2
    audio.clack(Math.min(1.4, hard / 3))
    if (hard > 2) {
      effects.sparks(x, y, Math.min(1.6, hard / 4))
      effects.kick(Math.min(0.16, hard * 0.02))
      if (hard > 4.5 && !reducedMotion) sim.slowmo = 0.45
    }
  }
  contacts = []
}

function allAtRest(): boolean {
  for (const e of sim.entities) {
    if (e.dead) continue
    if (!atRest(e)) return false
  }
  return true
}

function forceRest() {
  for (const e of sim.entities) {
    if (e.dead) continue
    e.body.setLinearVelocity({ x: 0, y: 0 })
    e.body.setAngularVelocity(0)
  }
}

// ------------------------------------------------------------- AI

function tickAi(dt: number) {
  if (!isAiTurn(thrower.value) || sim.ai.stage === null) return
  sim.ai.timer -= dt

  if (sim.ai.stage === 'think') {
    if (sim.ai.timer > 0) return
    const coch = cochonnetPos()
    if (!coch) return
    sim.ai.plan = planAiThrow(
      {
        origin: sim.origin,
        cochonnet: coch,
        boules: snapshot(),
        remaining: remaining.value,
        self: 1,
        groundY,
        bouleRadius: BOULE_R,
      },
      rng,
    )
    sim.ai.stage = 'aim'
    return
  }

  const plan = sim.ai.plan
  if (!plan) return

  if (sim.ai.stage === 'aim') {
    const k = 1 - Math.exp(-dt * 7)
    sim.angle += (plan.angle - sim.angle) * k
    if (Math.abs(plan.angle - sim.angle) < 0.01) {
      sim.angle = plan.angle
      sim.ai.stage = 'charge'
      phase.value = 'charging'
      sim.power = 0
    }
    return
  }

  if (sim.ai.stage === 'charge') {
    sim.power += CHARGE_RATE * dt
    if (sim.power >= plan.power) {
      sim.power = plan.power
      doThrow(sim.angle, sim.power)
    }
  }
}

// ------------------------------------------------------------- input

function canPlayerAct() {
  return isHumanTurn.value && phase.value !== 'game-over'
}

function startCharge() {
  if (!canPlayerAct() || phase.value !== 'aiming') return
  phase.value = 'charging'
  sim.power = 0
  sim.chargeDir = 1
}

function releaseCharge() {
  if (phase.value !== 'charging' || !canPlayerAct()) return
  doThrow(sim.angle, Math.max(0.05, sim.power))
}

function tickCharge(dt: number) {
  sim.power += sim.chargeDir * CHARGE_RATE * dt
  if (sim.power >= 1) {
    sim.power = 1
    sim.chargeDir = -1
  } else if (sim.power <= 0) {
    sim.power = 0
    sim.chargeDir = 1
  }
}

function toWorld(clientX: number, clientY: number): Vec | null {
  const canvas = canvasEl.value
  const view = lastView
  if (!canvas || !view) return null
  const rect = canvas.getBoundingClientRect()
  const px = clientX - rect.left
  const py = clientY - rect.top
  return {
    x: (px - view.ox - view.w / 2) / view.scale + view.cam.cx,
    y: view.cam.cy - (py - view.oy - view.h / 2) / view.scale,
  }
}

function onPointerDown(e: PointerEvent) {
  if (!canPlayerAct()) return
  canvasEl.value?.setPointerCapture(e.pointerId)
  sim.pointerDown = true
  sim.pointerY = e.clientY
  startCharge()
  e.preventDefault()
}

function onPointerMove(e: PointerEvent) {
  if (!canPlayerAct()) return
  if (sim.pointerDown) {
    const dy = e.clientY - sim.pointerY
    sim.pointerY = e.clientY
    sim.angle = clampAngle(sim.angle - dy * 0.005)
    return
  }
  if (e.pointerType === 'mouse' && phase.value === 'aiming') {
    const w = toWorld(e.clientX, e.clientY)
    if (!w) return
    const a = Math.atan2(w.y - sim.origin.y, Math.max(0.4, w.x - sim.origin.x))
    sim.angle = clampAngle(a)
  }
}

function onPointerUp(e: PointerEvent) {
  if (!sim.pointerDown) return
  sim.pointerDown = false
  canvasEl.value?.releasePointerCapture?.(e.pointerId)
  releaseCharge()
}

function onKeyDown(e: KeyboardEvent) {
  if (e.metaKey || e.ctrlKey || e.altKey) return
  // Never steal Space/arrows from a focused control (HUD buttons, menu links).
  const target = e.target as HTMLElement | null
  if (target?.closest?.('button, a, input, textarea, select, [contenteditable]')) return
  if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
    sim.keyDir = 1
    e.preventDefault()
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
    sim.keyDir = -1
    e.preventDefault()
  } else if (e.code === 'Space' || e.key === ' ') {
    e.preventDefault()
    if (!e.repeat) startCharge()
  }
}

function onKeyUp(e: KeyboardEvent) {
  if (['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(e.key)) {
    sim.keyDir = 0
  } else if (e.code === 'Space' || e.key === ' ') {
    releaseCharge()
  }
}

// ------------------------------------------------------------- camera

function updateCamera(dt: number) {
  const viewH = sim.cam.viewW / WORLD_ASPECT
  const follow = sim.entities.find(e => e.id === sim.followId && !e.dead)
  const flying = phase.value === 'flight' || phase.value === 'cochonnet'
  const coch = cochonnetPos()

  let tx: number
  if (flying && follow) {
    tx = follow.pos.x + 0.9
  } else if (phase.value === 'mene-end' && coch) {
    tx = coch.x
  } else {
    tx = ((coch?.x ?? 8) + THROW_X) / 2 + 0.4
  }

  const half = sim.cam.viewW / 2
  const lo = LANE_START + half - 0.4
  const hi = BOARD_X + 1.2 - half
  sim.camTargetX = clamp(tx, Math.min(lo, hi), Math.max(lo, hi))

  // Zoom out a touch for high lobs so the boule never leaves the frame.
  if (flying && follow) {
    const h = follow.pos.y - groundY(follow.pos.x)
    sim.camTargetW = clamp(VIEW_W + Math.max(0, h - 2.2) * 0.85, VIEW_W, 14.5)
  }

  const base = groundY(sim.cam.cx) + viewH / 2 - 1.4
  sim.camTargetY = flying && follow ? Math.max(base, follow.pos.y - viewH * 0.12) : base

  const kx = 1 - Math.exp(-dt * (flying ? 5 : 2.6))
  sim.cam.cx += (sim.camTargetX - sim.cam.cx) * kx
  sim.cam.cy += (sim.camTargetY - sim.cam.cy) * kx
  sim.cam.viewW += (sim.camTargetW - sim.cam.viewW) * (1 - Math.exp(-dt * 2.4))
}

// ------------------------------------------------------------- loop

function update(dt: number) {
  sim.time += dt
  effects.update(dt)

  // Ambient seagull: it may only settle on the gravel while nothing is in play,
  // and takes off at once as soon as a boule (or the cochonnet) is flying.
  const calm = phase.value !== 'flight' && phase.value !== 'cochonnet'
  gull.update(dt, calm, groundY, LANE_START, LANE_END)

  if (sim.bannerTimer > 0) {
    sim.bannerTimer -= dt
    if (sim.bannerTimer <= 0) banner.value = null
  }

  if (sim.slowmo > 0) {
    sim.slowmo -= dt
    sim.timeScale += (0.35 - sim.timeScale) * (1 - Math.exp(-dt * 14))
  } else {
    sim.timeScale += (1 - sim.timeScale) * (1 - Math.exp(-dt * 4))
  }

  if (canPlayerAct() && sim.keyDir !== 0) {
    sim.angle = clampAngle(sim.angle + sim.keyDir * 0.95 * dt)
  }
  if (phase.value === 'charging' && !isAiTurn(thrower.value)) tickCharge(dt)
  tickAi(dt)

  if (phase.value === 'flight' || phase.value === 'cochonnet') {
    acc += dt * sim.timeScale
    let steps = 0
    while (acc >= FIXED && steps < 5) {
      stepPhysics(FIXED)
      acc -= FIXED
      steps += 1
    }
    if (steps >= 5) acc = 0

    sim.elapsed += dt
    if (allAtRest()) {
      sim.settle += dt
      if (sim.settle > 0.3) onSettled()
    } else {
      sim.settle = 0
      if (sim.elapsed > 6.5) {
        forceRest()
        onSettled()
      }
    }
  } else {
    acc = 0
  }

  if (phase.value === 'mene-end') {
    sim.meneTimer += dt
    if (sim.meneTimer > MENE_END_DURATION) advanceAfterMene()
  }

  updateCamera(dt)
}

function sceneEntities(): SceneEntity[] {
  const out: SceneEntity[] = []
  for (const e of sim.entities) {
    if (e.dead) continue
    out.push({
      kind: e.kind,
      owner: e.owner,
      x: e.pos.x,
      y: e.pos.y,
      angle: e.angle,
      r: e.kind === 'boule' ? BOULE_R : COCH_R,
      groundY: groundY(e.pos.x),
    })
  }
  return out
}

function render() {
  const canvas = canvasEl.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return

  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const wantW = Math.round(cssW * dpr)
  const wantH = Math.round(cssH * dpr)
  if (canvas.width !== wantW || canvas.height !== wantH) {
    canvas.width = wantW
    canvas.height = wantH
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  clearCanvas(ctx, cssW, cssH)

  const shake = effects.shakeOffset()
  const view = makeView(ctx, cssW, cssH, {
    cx: sim.cam.cx + shake.x,
    cy: sim.cam.cy + shake.y,
    viewW: sim.cam.viewW,
  })
  lastView = view

  const aiming = phase.value === 'aiming' || phase.value === 'charging'
  const p = thrower.value

  drawScene(view, {
    time: sim.time,
    terrain: sim.terrain,
    entities: sceneEntities(),
    measures: phase.value === 'mene-end' ? sim.measures : [],
    effects,
    backdrop,
    seagull: gull,
    reducedMotion,
    throwX: THROW_X,
    board: { x: BOARD_X, h: BOARD_H, hw: BOARD_HW },
    aim: aiming && p !== null
      ? {
          origin: sim.origin,
          angle: sim.angle,
          power: phase.value === 'charging' ? sim.power : null,
          owner: p,
          groundY: groundY(sim.origin.x),
          idle: isAiTurn(p) && sim.ai.stage === 'think',
          preview: previewArc(
            sim.origin,
            sim.angle,
            phase.value === 'charging' ? sim.power : 0.5,
            groundY,
            BOULE_R,
          ),
        }
      : null,
  })
}

function frame(now: number) {
  raf = window.requestAnimationFrame(frame)
  const dt = Math.min(0.05, (now - lastFrame) / 1000 || 0)
  lastFrame = now
  update(dt)
  render()
}

function startLoop() {
  if (raf) return
  lastFrame = performance.now()
  raf = window.requestAnimationFrame(frame)
}

function stopLoop() {
  if (raf) window.cancelAnimationFrame(raf)
  raf = 0
}

function onVisibility() {
  if (document.hidden) stopLoop()
  else startLoop()
}

// ------------------------------------------------------------- lifecycle

function measure() {
  const el = wrapperEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  cssW = Math.max(1, Math.round(rect.width))
  cssH = Math.max(1, Math.round(rect.height))
  const canvas = canvasEl.value
  if (canvas) {
    canvas.style.width = `${cssW}px`
    canvas.style.height = `${cssH}px`
  }
}

function toggleSound() {
  soundOn.value = !soundOn.value
  audio.setEnabled(soundOn.value)
  try {
    window.localStorage.setItem(SOUND_KEY, soundOn.value ? '1' : '0')
  } catch {
    // private mode — the preference simply doesn't persist
  }
}

// --------------------------------------------------------- fullscreen

function isCoarsePointer() {
  return window.matchMedia?.('(pointer: coarse)').matches ?? false
}

function onFullscreenChange() {
  const doc = document as Document & { webkitFullscreenElement?: Element | null }
  const fsEl = doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null
  isFullscreen.value = fsEl === wrapperEl.value
}

async function enterFullscreen() {
  const el = wrapperEl.value as (HTMLDivElement & { webkitRequestFullscreen?: () => void }) | null
  if (!el) return
  try {
    if (el.requestFullscreen) {
      await el.requestFullscreen()
    } else if (el.webkitRequestFullscreen) {
      // Older WebKit (iPadOS) fallback — no promise returned.
      el.webkitRequestFullscreen()
    }
  } catch {
    // Rejected: no user activation, unsupported, etc. — silently no-op.
  }
  if (isCoarsePointer()) {
    screen.orientation?.lock?.('landscape').catch(() => {})
  }
}

async function exitFullscreen() {
  const doc = document as Document & { webkitExitFullscreen?: () => void }
  try {
    if (document.exitFullscreen) {
      await document.exitFullscreen()
    } else if (doc.webkitExitFullscreen) {
      doc.webkitExitFullscreen()
    }
  } catch {
    // ignore
  }
  try {
    screen.orientation?.unlock?.()
  } catch {
    // unsupported — no-op
  }
}

function toggleFullscreen() {
  if (isFullscreen.value) exitFullscreen()
  else enterFullscreen()
}

onMounted(() => {
  reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  rng = createRng((Date.now() ^ 0x5bd1e995) >>> 0)
  effects = new Effects(reducedMotion)
  audio = new GameAudio()
  // Random seed: it picks the scene (July evening or bright day) once per game,
  // along with the horizon, the garland and the boats.
  backdrop = createBackdrop((rng() * 0xFFFFFFFF) >>> 0)
  gull = new Seagull(reducedMotion, rng)
  sim = makeSim()

  try {
    soundOn.value = window.localStorage.getItem(SOUND_KEY) === '1'
  } catch {
    soundOn.value = false
  }
  if (soundOn.value) audio.setEnabled(true)

  measure()
  resizeObserver = new ResizeObserver(measure)
  if (wrapperEl.value) resizeObserver.observe(wrapperEl.value)

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  document.addEventListener('visibilitychange', onVisibility)

  fullscreenEnabled.value = document.fullscreenEnabled ?? true
  document.addEventListener('fullscreenchange', onFullscreenChange)
  document.addEventListener('webkitfullscreenchange', onFullscreenChange)

  startGame()
  startLoop()

  // User activation from the menu tap is still live here — try to go
  // fullscreen automatically on phones so the game gets the whole screen.
  if (isCoarsePointer()) enterFullscreen()
})

onBeforeUnmount(() => {
  stopLoop()
  resizeObserver?.disconnect()
  resizeObserver = null
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  document.removeEventListener('visibilitychange', onVisibility)
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  document.removeEventListener('webkitfullscreenchange', onFullscreenChange)
  destroyLane(sim?.lane ?? null)
  if (sim) sim.lane = null
  audio?.close()
})
</script>

<template>
  <div class="w-full">
    <div
      ref="wrapperEl"
      :data-phase="phase"
      class="relative w-full select-none overflow-hidden bg-[#1a1526] shadow-lg"
      :class="isFullscreen ? 'h-full rounded-none' : 'rounded-2xl'"
      :style="wrapperStyle"
    >
      <canvas
        ref="canvasEl"
        class="block h-full w-full touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        role="img"
        tabindex="0"
        :aria-label="ariaLabel"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      />

      <!-- HUD -->
      <div class="pointer-events-none absolute inset-0 flex flex-col justify-between p-2 sm:p-3">
        <div class="flex items-start justify-between gap-2">
          <div class="flex gap-1.5 rounded-xl bg-black/45 p-1.5 text-white backdrop-blur-sm sm:gap-3 sm:p-2">
            <div
              v-for="p in ([0, 1] as PlayerId[])"
              :key="p"
              class="flex items-center gap-1.5 rounded-lg px-1.5 py-0.5 sm:px-2"
              :class="thrower === p ? 'bg-white/15' : ''"
            >
              <span
                class="inline-block size-2.5 rounded-full ring-1 ring-white/40 sm:size-3"
                :style="{ backgroundColor: colorOf(p) }"
              />
              <div class="leading-tight">
                <div class="text-[10px] uppercase tracking-wide text-white/70 sm:text-xs">
                  {{ nameOf(p) }}
                </div>
                <div class="flex items-center gap-1.5">
                  <span class="text-sm font-bold tabular-nums sm:text-lg">{{ scores[p] }}</span>
                  <span class="flex gap-0.5" :aria-label="`${remaining[p]} boules restantes`">
                    <span
                      v-for="i in BOULES_PER_SIDE"
                      :key="i"
                      class="inline-block size-1.5 rounded-full sm:size-2"
                      :style="{
                        backgroundColor: i <= remaining[p] ? colorOf(p) : 'transparent',
                        boxShadow: `inset 0 0 0 1px ${colorOf(p)}`,
                      }"
                    />
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div class="flex items-center gap-1.5">
            <span class="rounded-lg bg-black/45 px-2 py-1 text-[10px] font-medium text-white backdrop-blur-sm sm:text-xs">
              Mène {{ mene }}
            </span>
            <UButton
              class="pointer-events-auto"
              size="xs"
              color="neutral"
              variant="solid"
              :icon="soundOn ? 'i-lucide-volume-2' : 'i-lucide-volume-x'"
              :aria-label="soundOn ? 'Couper le son' : 'Activer le son'"
              @click="toggleSound"
            />
            <UButton
              v-if="fullscreenEnabled"
              class="pointer-events-auto"
              size="xs"
              color="neutral"
              variant="solid"
              :icon="isFullscreen ? 'i-lucide-minimize' : 'i-lucide-maximize'"
              :aria-label="isFullscreen ? 'Quitter le plein écran' : 'Plein écran'"
              @click="toggleFullscreen"
            />
            <UButton
              class="pointer-events-auto"
              size="xs"
              color="neutral"
              variant="solid"
              icon="i-lucide-log-out"
              aria-label="Retour au menu"
              @click="emit('quit')"
            />
          </div>
        </div>

        <!-- Turn banner -->
        <Transition
          enter-active-class="transition duration-200 ease-out"
          enter-from-class="opacity-0 -translate-y-1"
          leave-active-class="transition duration-300 ease-in"
          leave-to-class="opacity-0"
        >
          <div v-if="banner && phase !== 'game-over'" class="mx-auto">
            <span class="rounded-full bg-black/55 px-4 py-1.5 text-sm font-semibold text-white shadow backdrop-blur-sm sm:text-base">
              {{ banner }}
            </span>
          </div>
        </Transition>

        <div class="flex items-end justify-between gap-2">
          <p v-if="isHumanTurn" class="max-w-[60%] rounded-lg bg-black/40 px-2 py-1 text-[10px] leading-snug text-white/85 backdrop-blur-sm sm:text-xs">
            Visez avec la souris ou les flèches · maintenez (clic ou Espace) pour la puissance, relâchez pour lancer.
          </p>
          <span v-else />
        </div>
      </div>

      <!-- Fin de mène -->
      <Transition
        enter-active-class="transition duration-300 ease-out"
        enter-from-class="opacity-0 scale-95"
        leave-active-class="transition duration-200 ease-in"
        leave-to-class="opacity-0"
      >
        <div v-if="toast && phase === 'mene-end'" class="pointer-events-none absolute inset-x-0 bottom-8 flex justify-center">
          <div class="rounded-xl bg-[#fff7e8]/95 px-5 py-3 text-center shadow-xl">
            <p class="text-sm font-bold text-[#241d33] sm:text-base">
              {{ toast }}
            </p>
            <p class="mt-0.5 text-xs text-[#241d33]/70">
              {{ nameOf(0) }} {{ scores[0] }} — {{ scores[1] }} {{ nameOf(1) }}
            </p>
          </div>
        </div>
      </Transition>

      <!-- Fin de partie -->
      <div
        v-if="phase === 'game-over' && winner !== null"
        class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/55 p-4 text-center backdrop-blur-sm"
      >
        <p class="text-xs font-semibold uppercase tracking-widest text-white/70">
          Fin de partie
        </p>
        <h2 class="text-xl font-black text-white sm:text-3xl">
          {{ gameOverLine }}
        </h2>
        <div class="mt-1 flex gap-2">
          <UButton color="primary" icon="i-lucide-rotate-ccw" @click="restart">
            Rejouer
          </UButton>
          <UButton color="neutral" variant="subtle" icon="i-lucide-arrow-left" @click="emit('quit')">
            Menu
          </UButton>
        </div>
      </div>

      <p class="sr-only" aria-live="polite">
        {{ announcement }}
      </p>
    </div>
  </div>
</template>
