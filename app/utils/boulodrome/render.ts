// Everything that puts pixels on the canvas. World units are metres; a single
// camera transform maps them to CSS pixels.
//
// Framing: the *gameplay* framing is a fixed 2.4:1 window (VIEW_W metres wide),
// but the picture is not letterboxed — it fills the whole canvas. The scale is
// still the min-fit of that 2.4:1 window, so what you can reach and how big a
// boule looks never depend on the screen; the extra room on a wider or taller
// canvas simply shows more sky, more sea and more gravel. `refW`/`refH` are the
// pixel size of that nominal window and every *feature* (sun radius, hill
// amplitude, cloud size, garland sag…) is measured against them, while spans
// and fills use the real canvas size. That is what keeps the composition
// identical from a 2.4:1 embed to a 2.2:1 phone in fullscreen to an ultrawide.
//
// Target look: a flat, illustrative Breton coast — either a July evening in
// Fouesnant or a bright summer day (see palette.ts). Everything procedural, no
// image assets.

import type { Effects } from './effects'
import type { SceneKind, ScenePalette } from './palette'
import { PALETTE, PALETTES, playerColor } from './palette'
import { createRng } from './rng'
import type { Seagull } from './seagull'
import type { Terrain } from './terrain'
import { WIND_MAX } from './throwing'
import type { PlayerId, Vec } from './types'

export const WORLD_ASPECT = 2.4
export const VIEW_W = 10.6
/** Neutral camera centre — parallax layers are offset relative to it. */
export const LANE_MID = 6

export interface Camera {
  cx: number
  cy: number
  viewW: number
}

export interface View {
  ctx: CanvasRenderingContext2D
  /** Always 0/0 now: the scene fills the canvas. Kept so callers can keep
   *  mapping screen → world with the same formula. */
  ox: number
  oy: number
  /** Full canvas size in CSS pixels. */
  w: number
  h: number
  /** The nominal 2.4:1 window in pixels — the yardstick for feature sizes. */
  refW: number
  refH: number
  scale: number
  cam: Camera
  X: (x: number) => number
  Y: (y: number) => number
  S: (m: number) => number
}

export function makeView(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  cam: Camera,
): View {
  const viewH = cam.viewW / WORLD_ASPECT
  // Same min-fit scale as the old letterboxed view: gameplay framing unchanged.
  const scale = Math.min(cssW / cam.viewW, cssH / viewH)
  // `cam.viewW * scale` is algebraically `min(cssW, cssH * WORLD_ASPECT)`, but
  // going through the division and back lands a float ulp on either side of
  // cssW. The camera eases `viewW` on *every* frame, so that ulp made the ceil()
  // in tileCount flip between 1 and 2 from one frame to the next and the whole
  // tiled backdrop jumped half a screen — the fullscreen flicker. Computing the
  // yardstick directly makes it exact and frame-stable.
  const refW = Math.min(cssW, cssH * WORLD_ASPECT)
  const refH = refW / WORLD_ASPECT
  // The camera centre stays at the centre of the canvas; the surplus is split
  // evenly around it, which is why ox/oy are simply 0.
  return {
    ctx,
    ox: 0,
    oy: 0,
    w: cssW,
    h: cssH,
    refW,
    refH,
    scale,
    cam,
    X: (x: number) => cssW / 2 + (x - cam.cx) * scale,
    Y: (y: number) => cssH / 2 - (y - cam.cy) * scale,
    S: (m: number) => m * scale,
  }
}

/** Positive modulo — used to wrap drifting backdrop layers. */
function mod(a: number, m: number): number {
  const r = a % m
  return r < 0 ? r + m : r
}

/**
 * How many copies of the nominal window fit across the canvas (plus one, for
 * the drift). Backdrop layers are laid out per copy so their *density* stays
 * constant instead of stretching on a wide screen.
 */
function tileCount(v: View): number {
  // The epsilon pins the exactly-one-window case — every canvas narrower than
  // 2.4:1, which is every screen in fullscreen — to a single stable answer
  // instead of letting rounding decide.
  return Math.ceil(v.w / v.refW - 1e-6) + 1
}

// ---------------------------------------------------------------- caches
//
// Everything below exists for one reason: at 60 fps a fullscreen canvas is
// fill-rate bound, and the scene used to rebuild half a dozen gradients and
// repaint the whole backdrop on every single frame. None of it changes what is
// drawn — same geometry, same colours, same order — only how often the work is
// redone.

/**
 * Quantise a gradient endpoint to a quarter pixel. The camera eases
 * asymptotically, so an exact key would miss every frame forever; a quarter of
 * a pixel on a gradient's *endpoint* is far below one 8-bit colour step.
 */
function q(n: number): number {
  return Math.round(n * 4) / 4
}

/**
 * Gradient store, one per context (a CanvasGradient belongs to the context that
 * made it, and the backdrop cache below has its own). Keys carry the full
 * geometry, so a hit is a gradient that would have been rebuilt identically.
 */
const gradientCaches = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasGradient>>()

function cachedGradient(
  ctx: CanvasRenderingContext2D,
  key: string,
  build: (c: CanvasRenderingContext2D) => CanvasGradient,
): CanvasGradient {
  let store = gradientCaches.get(ctx)
  if (!store) {
    store = new Map()
    gradientCaches.set(ctx, store)
  }
  const hit = store.get(key)
  if (hit) return hit
  // A resize or a zoom walks through keys; drop the lot rather than leak.
  if (store.size > 32) store.clear()
  const made = build(ctx)
  store.set(key, made)
  return made
}

/** Device pixels per CSS pixel for a context, read back off its own canvas. */
function dprOf(v: View): number {
  return v.ctx.canvas.width / v.w || 1
}

// ---------------------------------------------------------------- backdrop

export interface Backdrop {
  /** Picked once per game, from the seed. Drives every colour below. */
  scene: SceneKind
  hillPhase: number[]
  trees: { x: number, h: number, w: number, kind: 0 | 1 }[]
  /** Fairy-light bulbs (sunset) — colour + twinkle phase, cycled along the wire. */
  bulbs: { color: string, phase: number }[]
  /** Breton bunting fanions (day) — colour + sway phase, cycled the same way. */
  bunting: { color: string, phase: number }[]
  clouds: { x: number, y: number, w: number, h: number, hi: boolean }[]
  glints: { x: number, y: number, w: number }[]
  /** The sun's reflection column: extra glints bunched under it. `dx` is a
   *  horizontal offset from the sun in nominal-window units, densest at 0. */
  sunGlints: { dx: number, y: number, w: number }[]
  /** Position of the phare along the far coastline, 0..1. */
  lighthouse: { t: number, phase: number }
  /** One or two sloops drifting on the sea band. */
  boats: { t: number, y: number, s: number, speed: number, dir: 1 | -1 }[]
  /** Distant flocks, on a fixed schedule (see `flockCycle`). */
  flocks: {
    /** Seconds into the cycle when the flock enters frame. */
    at: number
    /** Seconds it takes to cross. */
    dur: number
    /** Height above the horizon, in nominal-window units. */
    y: number
    dir: 1 | -1
    /** Per bird: along-track lag (nominal windows), vertical spread, flap phase, size. */
    birds: { lag: number, dy: number, phase: number, s: number }[]
  }[]
  /** Length of the flock schedule; `time % flockCycle` drives it. */
  flockCycle: number
}

/** Generated once per game: the horizon shouldn't change between mènes. */
export function createBackdrop(seed: number): Backdrop {
  const rng = createRng(seed)
  // Scene first, so it is a clean coin flip rather than a function of the rest.
  const scene: SceneKind = rng() < 0.5 ? 'sunset' : 'day'
  const pal = PALETTES[scene]

  const hillPhase = [rng() * 7, rng() * 7, rng() * 7, rng() * 7]

  const trees: Backdrop['trees'] = []
  for (let i = 0; i < 30; i++) {
    trees.push({
      x: rng(), // 0..1 across the tree band, widened at draw time
      h: 0.06 + rng() * 0.1,
      w: 0.02 + rng() * 0.035,
      kind: rng() < 0.45 ? 0 : 1,
    })
  }
  trees.sort((a, b) => a.h - b.h)

  const bulbs: Backdrop['bulbs'] = []
  for (let i = 0; i < 27; i++) {
    bulbs.push({
      color: PALETTE.bulbs[i % PALETTE.bulbs.length]!,
      phase: rng() * Math.PI * 2,
    })
  }

  // Gwenn ha Du bunting: mostly black/white, with the odd red or blue fanion.
  const bunting: Backdrop['bunting'] = []
  for (let i = 0; i < 27; i++) {
    const accent = rng() < 0.14
    bunting.push({
      color: accent
        ? pal.buntingAccents[Math.floor(rng() * pal.buntingAccents.length)]!
        : (i % 2 === 0 ? pal.flagBlack : pal.flagWhite),
      phase: rng() * Math.PI * 2,
    })
  }

  const clouds: Backdrop['clouds'] = []
  for (let i = 0; i < 7; i++) {
    clouds.push({
      x: rng(),
      y: 0.08 + rng() * 0.3,
      w: 0.12 + rng() * 0.22,
      h: 0.012 + rng() * 0.022,
      hi: rng() < 0.4,
    })
  }

  const glints: Backdrop['glints'] = []
  for (let i = 0; i < 22; i++) {
    glints.push({ x: rng(), y: rng(), w: 0.01 + rng() * 0.05 })
  }

  // The reflection path: a triangular spread (sum of two uniforms) keeps the
  // dashes densest right under the sun and thins them out to the sides.
  const sunGlints: Backdrop['sunGlints'] = []
  for (let i = 0; i < 52; i++) {
    sunGlints.push({
      dx: (rng() + rng() - 1) * 0.075,
      y: rng(),
      w: 0.008 + rng() * 0.035,
    })
  }

  // Keep the phare off to one side so it never sits behind the play area.
  const lighthouse = { t: rng() < 0.5 ? 0.1 + rng() * 0.14 : 0.76 + rng() * 0.14, phase: rng() * 6 }

  const boats: Backdrop['boats'] = []
  for (let i = 0; i < (rng() < 0.5 ? 1 : 2); i++) {
    boats.push({
      t: rng(),
      y: rng(),
      s: rng(),
      speed: 0.006 + rng() * 0.008,
      dir: rng() < 0.5 ? 1 : -1,
    })
  }

  // Distant flocks. Rare events, so they get a long *schedule* rather than a
  // per-frame dice roll: nothing to tick, nothing to allocate at 60 fps, and the
  // cycle is long enough (~4 min) that no one spots the repeat. Every gap is
  // longer than the longest crossing, so a flock never gets cut off by the wrap.
  const flocks: Backdrop['flocks'] = []
  let at = 12 + rng() * 30
  for (let i = 0; i < 5; i++) {
    const count = 3 + Math.floor(rng() * 5) // 3–7 birds
    const birds: Backdrop['flocks'][number]['birds'] = []
    for (let k = 0; k < count; k++) {
      birds.push({
        lag: k * (0.035 + rng() * 0.028),
        dy: (rng() - 0.5) * 0.05,
        phase: rng() * Math.PI * 2,
        s: 0.75 + rng() * 0.55,
      })
    }
    flocks.push({
      at,
      dur: 15 + rng() * 9,
      // Flocks are drawn between the two cached slabs, so the tree band still
      // passes in front of them but the coastline no longer can. The far ridge
      // tops out 0.28 nominal-window units above the horizon; the band starts
      // clear of that, which is also simply where distant birds belong.
      y: 0.34 + rng() * 0.3,
      dir: rng() < 0.5 ? 1 : -1,
      birds,
    })
    at += 24 + rng() * 40
  }

  return { scene, hillPhase, trees, bulbs, bunting, clouds, glints, sunGlints, lighthouse, boats, flocks, flockCycle: at }
}

function hillY(x: number, phase: number[], amp: number, base: number): number {
  return (
    base
    - amp * (0.55 * Math.sin(x * 3.1 + phase[0]!) + 0.3 * Math.sin(x * 6.7 + phase[1]!) + 0.15 * Math.sin(x * 12.3 + phase[2]!))
  )
}

/** Where the horizon falls inside the sky wash in the nominal 2.4:1 framing. */
const SKY_HORIZON_AT = 0.65

/** Sea top, the line every backdrop band is measured from. */
const SEA_TOP_AT = 0.2
/** Far coastline: base offset from the sea top, and wave amplitude. */
const HILLS_FAR_BASE = -0.005
const HILLS_FAR_AMP = 0.075

/**
 * The lowest the far ridge can ever fall, in canvas pixels. `hillY` is a sum of
 * sines with total weight 1, so `base + amp` is a hard bound — and the far-hill
 * polygon fills solid from its ridge all the way down to `v.h`. Anything the
 * sky would paint below this line is therefore repainted, which is what lets
 * `drawSky` stop there instead of covering the whole canvas.
 */
function lowestFarRidge(v: View, horizon: number): number {
  const seaTop = horizon - v.refH * SEA_TOP_AT
  return seaTop + v.refH * (HILLS_FAR_BASE + HILLS_FAR_AMP)
}

function drawSky(v: View, p: ScenePalette, horizon: number) {
  const { ctx } = v
  // The wash is hung off the horizon and measured in nominal-window units, so
  // the warm band always lands *at* the waterline. Anchoring it to the canvas
  // instead would push the warm end down behind the gravel as soon as there is
  // extra height (fullscreen on a phone), leaving a flat mid-tone horizon.
  // Beyond both ends the gradient clamps, which is exactly what the surplus
  // sky should be: more of the deep top colour.
  const y0 = q(horizon - v.refH * SKY_HORIZON_AT)
  const y1 = q(horizon + v.refH * (1 - SKY_HORIZON_AT))
  const g = cachedGradient(ctx, `sky|${p.id}|${y0}|${y1}`, (c) => {
    const made = c.createLinearGradient(0, y0, 0, y1)
    for (const stop of p.sky) made.addColorStop(stop.at, stop.color)
    return made
  })
  ctx.fillStyle = g
  // Stop two pixels past the lowest the coastline can reach: the hills repaint
  // everything below, so filling to `v.h` was up to half a canvas of pure
  // overdraw on a tall screen.
  const cut = Math.min(v.h, lowestFarRidge(v, horizon) + 2)
  ctx.fillRect(0, 0, v.w, cut)
  // The coastline polygons close *on* the bottom edge of the canvas, so their
  // last device row is antialiased and whatever is beneath shows through it.
  // One more row of the same gradient keeps that blend identical to the
  // full-height fill it replaced.
  if (cut < v.h - 1) ctx.fillRect(0, v.h - 1, v.w, 1)
}

function drawSun(v: View, p: ScenePalette, pan: number, horizon: number) {
  const { ctx } = v
  // Anchored to the nominal window, not to the canvas: on an ultrawide screen
  // the sun stays where it was composed rather than sliding into the corner.
  const cx = v.w / 2 + v.refW * 0.24 - pan * 0.04
  const cy = horizon - v.refH * p.sunY
  const r = v.refH * p.sunR

  // Built at the origin and translated into place: the radius is the only thing
  // in the key, so panning the sun no longer rebuilds the gradient every frame.
  const gr = q(r)
  const reach = gr * p.sunGlowR
  const glow = cachedGradient(ctx, `sunGlow|${p.id}|${gr}`, (c) => {
    const made = c.createRadialGradient(0, 0, gr * 0.4, 0, 0, reach)
    made.addColorStop(0, p.sunGlow)
    made.addColorStop(1, p.sunGlowEdge)
    return made
  })
  ctx.save()
  ctx.translate(cx, cy)
  ctx.fillStyle = glow
  // The outer stop is fully transparent, so the glow's bounding square and the
  // whole canvas produce identical pixels — for a fraction of the fill.
  ctx.fillRect(-reach, -reach, reach * 2, reach * 2)
  ctx.restore()

  ctx.fillStyle = p.sun
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
}

function drawClouds(v: View, b: Backdrop, p: ScenePalette, pan: number, horizon: number) {
  const { ctx } = v
  const tiles = tileCount(v)
  const span = tiles * v.refW
  const x0 = v.w / 2 - span / 2
  const drift = pan * 0.06

  ctx.globalAlpha = p.cloudAlpha
  for (const c of b.clouds) {
    const y = horizon - v.refH * (0.2 + c.y * 0.55)
    const rx = c.w * v.refW * 0.32
    const ry = Math.max(2, c.h * v.refH * 0.6)
    ctx.fillStyle = c.hi ? p.cloudHi : p.cloud
    ctx.beginPath()
    for (let i = 0; i < tiles; i++) {
      const x = x0 + mod(c.x * v.refW + i * v.refW - drift, span)
      if (x < -rx * 2 || x > v.w + rx * 2) continue
      // One path per tone keeps the fill count down, but ellipse() does *not*
      // start a subpath: without a moveTo to its own start point every lobe is
      // joined to the previous one by a straight line, which is the grey thread
      // that used to run across the whole sky.
      ctx.moveTo(x + rx, y)
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
      ctx.moveTo(x + rx * 0.7 + rx * 0.55, y + ry * 0.3)
      ctx.ellipse(x + rx * 0.7, y + ry * 0.3, rx * 0.55, ry * 0.7, 0, 0, Math.PI * 2)
      // Cumulus get a third, taller lobe so they read as cotton, not haze.
      if (p.cloudPuffy) {
        ctx.moveTo(x - rx * 0.62 + rx * 0.5, y + ry * 0.34)
        ctx.ellipse(x - rx * 0.62, y + ry * 0.34, rx * 0.5, ry * 0.62, 0, 0, Math.PI * 2)
      }
    }
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

/**
 * Distant flocks: now and then a handful of gulls crosses the far sky as little
 * ticks. They live at backdrop depth — they drift with the pan like the hills
 * rather than in world coordinates — and the whole flock is one stroked path.
 */
function drawFlocks(
  v: View,
  b: Backdrop,
  p: ScenePalette,
  pan: number,
  horizon: number,
  time: number,
  reduced: boolean,
) {
  const { ctx } = v
  const tt = mod(time, b.flockCycle)
  const span = v.w + v.refW * 0.5
  const x0 = -v.refW * 0.25
  const drift = pan * 0.09

  ctx.strokeStyle = p.gullTip
  ctx.lineWidth = Math.max(1, v.refH * 0.0035)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.globalAlpha = 0.45

  for (let fi = 0; fi < b.flocks.length; fi++) {
    // Reduced motion: half as many crossings, and the wings hold still.
    if (reduced && (fi & 1)) continue
    const f = b.flocks[fi]!
    const t = (tt - f.at) / f.dur
    if (t < 0 || t > 1) continue
    const head = f.dir > 0 ? x0 + t * span : x0 + span - t * span
    ctx.beginPath()
    for (const bird of f.birds) {
      const bx = head - f.dir * bird.lag * v.refW - drift
      if (bx < -20 || bx > v.w + 20) continue
      const by = horizon - v.refH * (f.y + bird.dy)
      const s = Math.max(1.5, v.refH * 0.008 * bird.s)
      const flap = reduced ? 0.5 : 0.5 + 0.42 * Math.sin(time * 3.6 + bird.phase)
      ctx.moveTo(bx - s, by - s * flap)
      ctx.lineTo(bx, by)
      ctx.lineTo(bx + s, by - s * flap)
    }
    ctx.stroke()
  }

  ctx.globalAlpha = 1
  ctx.lineCap = 'butt'
  ctx.lineJoin = 'miter'
}

/**
 * Where the phare stands, or null when it is off-frame. Both halves below need
 * exactly the same anchor, so it is worked out once.
 */
function lighthouseAt(v: View, b: Backdrop, pan: number, amp: number, base: number) {
  const x = v.w / 2 + (b.lighthouse.t - 0.5) * v.refW * 1.3
  if (x < -40 || x > v.w + 40) return null
  // Same parallax and the same wave as the far hills, so it stands *on* them.
  const hx = (x - v.w / 2 + pan * 0.1) / v.refW
  const h = v.refH * 0.075
  return {
    x,
    h,
    w: Math.max(2, v.refH * 0.016),
    groundY: hillY(hx, b.hillPhase, amp, base),
  }
}

/**
 * The phare's masonry: a tiny white tower on the far ridge. Static — it only
 * moves with the pan — so it lives in the cached backdrop, while the lamp beat
 * below stays on the live pass.
 */
function drawLighthouseTower(v: View, b: Backdrop, p: ScenePalette, pan: number, amp: number, base: number) {
  const at = lighthouseAt(v, b, pan, amp, base)
  if (!at) return
  const { ctx } = v
  const { x, h, w, groundY } = at

  // Tower: a slight taper reads as masonry even at a dozen pixels.
  ctx.fillStyle = p.lighthouseTower
  ctx.beginPath()
  ctx.moveTo(x - w * 0.62, groundY)
  ctx.lineTo(x + w * 0.62, groundY)
  ctx.lineTo(x + w * 0.36, groundY - h)
  ctx.lineTo(x - w * 0.36, groundY - h)
  ctx.closePath()
  ctx.fill()

  // Lantern room + its band, then the gallery lip.
  const ly = groundY - h
  ctx.fillStyle = p.lighthouseBand
  ctx.fillRect(x - w * 0.5, ly - h * 0.28, w, h * 0.28)
  ctx.fillStyle = p.lighthouseTower
  ctx.fillRect(x - w * 0.58, ly - h * 0.32, w * 1.16, Math.max(1, h * 0.05))
}

/**
 * The lamp itself. Drawn after the cached backdrop, so it is clipped to the
 * strip above the waterline: in the old single-pass order the sea band was
 * painted straight over the bottom of the glow, and the clip reproduces that
 * exactly without having to repaint the sea.
 */
function drawLighthouseLamp(
  v: View,
  b: Backdrop,
  p: ScenePalette,
  pan: number,
  amp: number,
  base: number,
  horizon: number,
  time: number,
) {
  const at = lighthouseAt(v, b, pan, amp, base)
  if (!at) return
  const { ctx } = v
  const { x, h, w, groundY } = at
  const lampY = groundY - h - h * 0.15
  // A four-second sweep: mostly dark, one bright beat, like a real characteristic.
  const beat = p.lighthouseBlink ? Math.max(0, Math.sin(time * 1.6 + b.lighthouse.phase)) ** 8 : 0.25

  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, v.w, horizon - v.refH * (SEA_TOP_AT - 0.02))
  ctx.clip()

  ctx.fillStyle = p.lighthouseLantern
  ctx.globalAlpha = 0.5 + 0.5 * beat
  ctx.beginPath()
  ctx.arc(x, lampY, Math.max(1, w * 0.22), 0, Math.PI * 2)
  ctx.fill()
  if (beat > 0.02) {
    const reach = q(w * 3.2)
    const glow = cachedGradient(ctx, `lamp|${p.id}|${reach}`, (c) => {
      const made = c.createRadialGradient(0, 0, 0, 0, 0, reach)
      made.addColorStop(0, p.lighthouseLantern)
      made.addColorStop(1, 'rgba(255, 233, 168, 0)')
      return made
    })
    ctx.globalAlpha = 0.55 * beat
    ctx.translate(x, lampY)
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(0, 0, reach, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
  ctx.restore()
}

/** A classic sloop silhouette: hull, mast, mainsail, jib. */
function drawBoat(v: View, p: ScenePalette, x: number, y: number, size: number, dir: 1 | -1) {
  const { ctx } = v
  const hw = size
  const hh = size * 0.34
  const mast = size * 1.9

  ctx.fillStyle = p.boatSail
  // Mainsail behind the mast, jib in front — mirrored by the drift direction.
  ctx.beginPath()
  ctx.moveTo(x, y - mast)
  ctx.lineTo(x - dir * hw * 0.82, y - hh * 0.6)
  ctx.lineTo(x - dir * hw * 0.08, y - hh * 0.6)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(x, y - mast * 0.86)
  ctx.lineTo(x + dir * hw * 0.62, y - hh * 0.6)
  ctx.lineTo(x + dir * hw * 0.06, y - hh * 0.6)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = p.boatHull
  ctx.fillRect(x - Math.max(0.5, size * 0.05), y - mast, Math.max(1, size * 0.1), mast - hh * 0.6)
  ctx.beginPath()
  ctx.moveTo(x - hw, y - hh)
  ctx.lineTo(x + hw, y - hh)
  ctx.lineTo(x + hw * 0.55, y)
  ctx.lineTo(x - hw * 0.55, y)
  ctx.closePath()
  ctx.fill()
}

/** Everything on the horizon that only moves with the pan: hills, the phare's
 *  masonry, the sea band and its two sets of glints. Cached. */
function drawHorizonStatic(v: View, b: Backdrop, p: ScenePalette, pan: number, horizon: number) {
  const { ctx } = v
  const seaTop = horizon - v.refH * SEA_TOP_AT
  const steps = Math.min(160, Math.max(64, Math.round(v.w / 12)))

  // Coastline first: the sea band is painted over their feet, so the hills
  // read as standing behind the water.
  const layers = [
    { color: p.hillsFar, amp: v.refH * HILLS_FAR_AMP, base: seaTop + v.refH * HILLS_FAR_BASE, factor: 0.1 },
    { color: p.hillsNear, amp: v.refH * 0.05, base: seaTop + v.refH * 0.008, factor: 0.18 },
  ]
  for (const layer of layers) {
    ctx.fillStyle = layer.color
    ctx.beginPath()
    ctx.moveTo(0, v.h)
    for (let i = 0; i <= steps; i++) {
      const sx = (i / steps) * v.w
      // Wave coordinates are in nominal-window units, so the ridge keeps its
      // wavelength instead of stretching with the canvas.
      const hx = (sx - v.w / 2 + pan * layer.factor) / v.refW
      ctx.lineTo(sx, hillY(hx, b.hillPhase, layer.amp, layer.base))
    }
    ctx.lineTo(v.w, v.h)
    ctx.closePath()
    ctx.fill()
  }

  drawLighthouseTower(v, b, p, pan, layers[0]!.amp, layers[0]!.base)

  // Sea band — always edge to edge, whatever the aspect ratio.
  const seaBottom = seaTop + v.refH * 0.115
  ctx.fillStyle = p.sea
  ctx.fillRect(0, seaTop + v.refH * 0.02, v.w, seaBottom - seaTop)

  const tiles = tileCount(v)
  const span = tiles * v.refW
  const x0 = v.w / 2 - span / 2

  // Glints belong to the water itself, so they go down before the boats — a
  // sloop floats *on* the sea and must never be crossed by a reflection.
  ctx.fillStyle = p.seaGlint
  const glintH = Math.max(1, v.refH * 0.004)
  ctx.beginPath()
  for (const g of b.glints) {
    const gy = seaTop + v.refH * 0.03 + g.y * v.refH * 0.075
    const gw = g.w * v.refW * 0.06
    for (let i = 0; i < tiles; i++) {
      const x = x0 + mod(g.x * v.refW + i * v.refW - pan * 0.02, span)
      // rect() opens its own subpath, so these need no moveTo between them.
      ctx.rect(x, gy, gw, glintH)
    }
  }
  ctx.fill()

  // The sun's reflection: a denser column of glints right under it, brighter
  // than the ambient ones. Same anchor as drawSun so the two stay in line.
  const sunX = v.w / 2 + v.refW * 0.24 - pan * 0.04
  ctx.globalAlpha = 0.9
  ctx.beginPath()
  for (const g of b.sunGlints) {
    const x = sunX + g.dx * v.refW
    if (x < -20 || x > v.w + 20) continue
    const gy = seaTop + v.refH * 0.03 + g.y * v.refH * 0.075
    ctx.rect(x, gy, g.w * v.refW * 0.06, glintH)
  }
  ctx.fill()
  ctx.globalAlpha = 1
}

/**
 * The sloops. Split out of the horizon because they drift with `time`, so they
 * cannot live in the cached backdrop. They keep their old place in the stack —
 * over the glints, under everything the tree line and beyond — which costs
 * nothing to preserve: a boat's hull sits a good tenth of a nominal window
 * above the tree band, so nothing it could overlap is drawn between them.
 */
function drawBoats(v: View, b: Backdrop, p: ScenePalette, pan: number, horizon: number, time: number) {
  const seaTop = horizon - v.refH * SEA_TOP_AT
  // Boats exist once each (not tiled), so they wrap over the *canvas* plus a
  // margin — otherwise a wide screen would park them off-frame most of the time.
  const boatSpan = v.w + v.refW * 0.3
  const boatX0 = -v.refW * 0.15
  for (const boat of b.boats) {
    const bx = boatX0 + mod((boat.t + time * boat.speed * boat.dir) * boatSpan - pan * 0.05, boatSpan)
    const by = seaTop + v.refH * (0.055 + boat.y * 0.05)
    const size = v.refH * (0.02 + boat.s * 0.014)
    if (bx > -20 && bx < v.w + 20) drawBoat(v, p, bx, by, size, boat.dir)
  }
}

function drawTreeLine(v: View, b: Backdrop, p: ScenePalette, pan: number, horizon: number) {
  const { ctx } = v
  const base = horizon - v.refH * 0.035
  ctx.fillStyle = p.treeLine
  ctx.fillRect(0, base, v.w, horizon - base + v.refH * 0.02)

  // The band always over-covers the canvas so the drift never reveals an edge.
  const spread = v.w + v.refW * 1.2
  const left = -(spread - v.w) / 2
  for (const t of b.trees) {
    const x = left + t.x * spread - pan * 0.3
    if (x < -80 || x > v.w + 80) continue
    const h = t.h * v.refH
    const w = t.w * v.refW
    ctx.fillStyle = p.treeLine
    if (t.kind === 0) {
      // pine
      ctx.beginPath()
      ctx.moveTo(x, base - h * 1.6)
      ctx.lineTo(x + w * 0.7, base + 2)
      ctx.lineTo(x - w * 0.7, base + 2)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = p.treeRim
      ctx.lineWidth = Math.max(1, v.refH * 0.003)
      ctx.beginPath()
      ctx.moveTo(x, base - h * 1.6)
      ctx.lineTo(x + w * 0.7, base)
      ctx.stroke()
    } else {
      // plane tree: trunk first so it shows under the crown
      const cy = base - h * 0.95
      ctx.fillRect(x - w * 0.09, cy, w * 0.18, base - cy + 2)
      ctx.beginPath()
      ctx.ellipse(x, cy, w * 0.95, h * 0.8, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = p.treeRim
      ctx.lineWidth = Math.max(1, v.refH * 0.004)
      ctx.beginPath()
      ctx.ellipse(x, cy, w * 0.93, h * 0.78, 0, -1.9, 0.15)
      ctx.stroke()
    }
  }
  ctx.fillStyle = p.treeHi
  ctx.fillRect(0, base - 2, v.w, 2)
}

/**
 * One pre-rendered glow disc per fairy-light colour. There are only five
 * colours and about thirty bulbs on the wire, so building the gradients once
 * per size and blitting them turns thirty radial-gradient fills a frame into
 * thirty copies. Rebuilt only when the glow's device radius changes.
 */
let bulbSprites: { key: string, byColor: Map<string, HTMLCanvasElement> } | null = null

function bulbGlowSprites(p: ScenePalette, reach: number, dpr: number): Map<string, HTMLCanvasElement> | null {
  if (typeof document === 'undefined') return null
  const rd = Math.max(1, Math.ceil(reach * dpr))
  const key = `${p.id}|${rd}`
  if (bulbSprites?.key === key) return bulbSprites.byColor
  const byColor = new Map<string, HTMLCanvasElement>()
  const size = rd * 2
  for (const color of p.bulbs) {
    if (byColor.has(color)) continue
    const c = document.createElement('canvas')
    c.width = size
    c.height = size
    const cc = c.getContext('2d')
    if (!cc) return null
    // Same gradient as the per-frame one, at device scale and centred. The
    // outer stop is transparent, so a square fill and a disc fill are the same
    // pixels — one less path per bulb.
    const g = cc.createRadialGradient(rd, rd, 0, rd, rd, reach * dpr)
    g.addColorStop(0, color)
    g.addColorStop(1, 'rgba(255, 200, 120, 0)')
    cc.fillStyle = g
    cc.fillRect(0, 0, size, size)
    byColor.set(color, c)
  }
  bulbSprites = { key, byColor }
  return byColor
}

/**
 * The café garland strung over the pitch. Same wire in both scenes; what hangs
 * off it is a scene decision — fairy lights at dusk, Breton bunting by day.
 */
function drawGarland(v: View, b: Backdrop, p: ScenePalette, pan: number, time: number, reduced: boolean) {
  const { ctx } = v
  const x0 = -v.w * 0.05 - pan * 0.12
  const x1 = x0 + v.w * 1.1
  // Hung against the nominal window's top edge, not the canvas', so it doesn't
  // float away when there is extra sky above.
  const top = v.h / 2 - v.refH * 0.455
  const sag = v.refH * 0.1
  const swagW = v.refW / 3
  // Three swags per nominal window — one more per extra window of width.
  const yAt = (x: number) => top + Math.sin((mod(x - x0, swagW) / swagW) * Math.PI) * sag

  ctx.strokeStyle = p.wire
  ctx.lineWidth = Math.max(1, v.refH * 0.004)
  ctx.beginPath()
  const steps = Math.min(200, Math.max(90, Math.round((x1 - x0) / 8)))
  for (let i = 0; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps
    if (i === 0) ctx.moveTo(x, yAt(x))
    else ctx.lineTo(x, yAt(x))
  }
  ctx.stroke()

  // Fixed spacing (≈ 9 per swag) keeps the density identical at any width; the
  // stored colour/phase arrays are simply cycled.
  const spacing = swagW / 9
  const count = Math.ceil((x1 - x0) / spacing)

  if (p.garland === 'bulbs') {
    const r = v.refH * 0.011
    const dpr = dprOf(v)
    const sprites = bulbGlowSprites(p, r * 5, dpr)

    // Two passes over the same bulbs. The glows go down first, at device
    // resolution with integer coordinates (MDN: a sub-pixel drawImage forces a
    // resample), then the wire stubs and the bulbs themselves in the normal
    // transform. Thirty radial gradients per frame became thirty blits.
    if (sprites) {
      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      for (let i = 0; i <= count; i++) {
        const x = x0 + i * spacing
        if (x < -20 || x > v.w + 20) continue
        const bulb = b.bulbs[i % b.bulbs.length]!
        const y = yAt(x) + v.refH * 0.012
        const tw = reduced ? 1 : 0.82 + 0.18 * Math.sin(time * 2.1 + bulb.phase)
        const sprite = sprites.get(bulb.color)
        if (!sprite) continue
        ctx.globalAlpha = 0.42 * tw
        ctx.drawImage(sprite, Math.round(x * dpr - sprite.width / 2), Math.round(y * dpr - sprite.height / 2))
      }
      ctx.globalAlpha = 1
      ctx.restore()
    }

    for (let i = 0; i <= count; i++) {
      const x = x0 + i * spacing
      if (x < -20 || x > v.w + 20) continue
      const bulb = b.bulbs[i % b.bulbs.length]!
      const y = yAt(x) + v.refH * 0.012
      const tw = reduced ? 1 : 0.82 + 0.18 * Math.sin(time * 2.1 + bulb.phase)

      ctx.fillStyle = p.wire
      ctx.fillRect(x - r * 0.35, y - r * 1.5, r * 0.7, r * 0.8)
      ctx.fillStyle = bulb.color
      ctx.globalAlpha = tw
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
    }
    return
  }

  // Bunting: small triangular fanions, apex down, swaying on their own phase.
  // A few dozen flat triangles — cheap enough to fill one by one.
  const fw = v.refH * 0.03
  const fh = v.refH * 0.058
  for (let i = 0; i <= count; i++) {
    const x = x0 + i * spacing
    if (x < -20 || x > v.w + 20) continue
    const fan = b.bunting[i % b.bunting.length]!
    const y = yAt(x) + v.refH * 0.004
    const a = reduced ? 0 : Math.sin(time * 1.7 + fan.phase) * 0.17
    // Rotate by hand rather than with save/rotate/restore: three points is
    // less work than four context state changes.
    const dx = Math.sin(a)
    const dy = Math.cos(a)
    ctx.fillStyle = fan.color
    ctx.beginPath()
    ctx.moveTo(x - dy * fw * 0.5, y + dx * fw * 0.5)
    ctx.lineTo(x + dy * fw * 0.5, y - dx * fw * 0.5)
    ctx.lineTo(x + dx * fh, y + dy * fh)
    ctx.closePath()
    ctx.fill()
  }
}

// ---------------------------------------------------------------- terrain

function drawGround(v: View, p: ScenePalette, terrain: Terrain) {
  const { ctx } = v
  // Half the *canvas* in world units, not half the nominal window: on a wide
  // screen the gravel has to keep running to both edges.
  const halfW = v.w / 2 / v.scale
  const left = v.cam.cx - halfW - 0.5
  const right = v.cam.cx + halfW + 0.5
  const bottom = v.h

  ctx.beginPath()
  ctx.moveTo(v.X(left), bottom)
  for (let x = left; x <= right; x += 0.16) ctx.lineTo(v.X(x), v.Y(terrain.heightAt(x)))
  ctx.lineTo(v.X(right), bottom)
  ctx.closePath()

  const gTop = q(v.Y(0.1))
  const gBottom = q(bottom)
  const g = cachedGradient(ctx, `ground|${p.id}|${gTop}|${gBottom}`, (c) => {
    const made = c.createLinearGradient(0, gTop, 0, gBottom)
    made.addColorStop(0, p.sandTop)
    made.addColorStop(0.35, p.sandMid)
    made.addColorStop(1, p.sandLow)
    return made
  })
  ctx.fillStyle = g
  ctx.fill()

  ctx.save()
  ctx.clip()

  // Speckled grain — two batched passes (one path per tone) rather than a
  // fill per grain, which matters on phones.
  for (const pass of [0, 1]) {
    ctx.fillStyle = pass ? p.speckleLight : p.speckleDark
    ctx.globalAlpha = pass ? 0.45 : 0.32
    ctx.beginPath()
    for (const s of terrain.speckles) {
      if (s.x < left || s.x > right) continue
      if ((s.tone > 0.55 ? 1 : 0) !== pass) continue
      const r = Math.max(0.6, v.S(s.r))
      const sx = v.X(s.x)
      const sy = v.Y(s.y)
      ctx.moveTo(sx + r, sy)
      ctx.arc(sx, sy, r, 0, Math.PI * 2)
    }
    ctx.fill()
  }
  ctx.globalAlpha = 1

  // Rake lines
  ctx.strokeStyle = p.sandRake
  ctx.lineWidth = Math.max(1, v.S(0.012))
  ctx.beginPath()
  for (const rx of terrain.rakes) {
    if (rx < left || rx > right) continue
    ctx.moveTo(v.X(rx), v.Y(terrain.heightAt(rx) - 0.04))
    ctx.lineTo(v.X(rx + 0.22), v.Y(terrain.heightAt(rx + 0.22) - 0.34))
  }
  ctx.stroke()
  ctx.restore()

  // Crisp lit edge along the surface, with a soft shadow just under it so the
  // gravel band reads as a solid mass rather than a flat colour.
  const traceEdge = (dy: number) => {
    ctx.beginPath()
    for (let x = left; x <= right; x += 0.16) {
      const y = v.Y(terrain.heightAt(x)) + dy
      if (x === left) ctx.moveTo(v.X(x), y)
      else ctx.lineTo(v.X(x), y)
    }
    ctx.stroke()
  }
  ctx.strokeStyle = p.groundEdgeShade
  ctx.lineWidth = Math.max(2, v.S(0.1))
  traceEdge(v.S(0.075))
  ctx.strokeStyle = p.groundEdgeLight
  ctx.lineWidth = Math.max(1.2, v.S(0.02))
  traceEdge(0)
}

function drawThrowCircle(v: View, terrain: Terrain, x: number) {
  const { ctx } = v
  ctx.strokeStyle = 'rgba(120, 80, 45, 0.5)'
  ctx.lineWidth = Math.max(1, v.S(0.02))
  ctx.beginPath()
  ctx.ellipse(v.X(x), v.Y(terrain.heightAt(x) - 0.01), v.S(0.55), v.S(0.13), 0, 0, Math.PI * 2)
  ctx.stroke()
}

/**
 * The breeze indicator: a pennant on a short pole planted beside the throwing
 * circle. It has to live *here*, next to the thrower, because that is where the
 * player is already looking while they aim — a flag at the far end would be
 * read as scenery. Dead calm hangs it straight down; a full breeze pulls it
 * level and downwind, and the ripple speeds up with it.
 */
function drawWindVane(
  v: View,
  p: ScenePalette,
  terrain: Terrain,
  worldX: number,
  wind: number,
  time: number,
  reduced: boolean,
) {
  const { ctx } = v
  const x = v.X(worldX)
  const baseY = v.Y(terrain.heightAt(worldX))
  const poleH = v.S(1.3)
  if (poleH < 6) return
  const top = baseY - poleH

  ctx.fillStyle = 'rgba(90, 58, 32, 0.25)'
  ctx.beginPath()
  ctx.ellipse(x, baseY, v.S(0.12), v.S(0.035), 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = p.flagPole
  ctx.fillRect(x - Math.max(0.5, v.S(0.015)), top, Math.max(1.5, v.S(0.03)), poleH)

  const k = Math.min(1, Math.abs(wind) / WIND_MAX)
  const dir = wind >= 0 ? 1 : -1
  const len = v.S(0.3 + 0.34 * k)
  // 0 rad = level (full breeze), π/2 = hanging dead calm. Screen y grows down,
  // so the "down" component is +uy.
  const ang = (1 - k) * (Math.PI / 2)
  const ux = Math.cos(ang) * dir
  const uy = Math.sin(ang)
  const amp = reduced ? 0 : v.S(0.05) * k
  const half = v.S(0.1)
  const steps = 6

  // One tapered quad strip, traced out along one edge and back along the other,
  // with the same ripple sampled on both so the pennant stays a single sheet.
  ctx.fillStyle = p.flagWhite
  ctx.strokeStyle = p.flagBlack
  ctx.lineWidth = Math.max(1, v.S(0.013))
  ctx.beginPath()
  for (let i = 0; i <= steps * 2 + 1; i++) {
    const back = i > steps
    const t = back ? (steps * 2 + 1 - i) / steps : i / steps
    const wob = Math.sin(t * 4.4 - time * (2.4 + 5 * k)) * amp * t
    const hw = half * (1 - t) * (back ? -1 : 1)
    // (-uy, ux) is the pennant's normal: used both for the ripple and the taper.
    const px = x + ux * len * t - uy * (wob + hw)
    const py = top + uy * len * t + ux * (wob + hw)
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  // Finial, so the pole doesn't end in nothing at twenty pixels tall.
  ctx.fillStyle = p.flagBlack
  ctx.beginPath()
  ctx.arc(x, top, Math.max(1, v.S(0.045)), 0, Math.PI * 2)
  ctx.fill()
}

function drawBackboard(v: View, p: ScenePalette, terrain: Terrain, boardX: number, boardH: number, boardHw: number) {
  const { ctx } = v
  const base = terrain.heightAt(boardX)
  const x = v.X(boardX - boardHw)
  const w = v.S(boardHw * 2)
  const top = v.Y(base + boardH)
  const h = v.S(boardH) + v.S(0.12)

  // Ground shadow at the foot of the board
  ctx.fillStyle = 'rgba(90, 58, 32, 0.3)'
  ctx.beginPath()
  ctx.ellipse(x + w / 2, v.Y(base - 0.02), v.S(0.45), v.S(0.1), 0, 0, Math.PI * 2)
  ctx.fill()

  // Back post visible behind, then the planks
  ctx.fillStyle = p.woodDark
  ctx.fillRect(x - v.S(0.05), top - v.S(0.06), w + v.S(0.1), h + v.S(0.06))

  const planks = 3
  for (let i = 0; i < planks; i++) {
    const py = top + (h * i) / planks
    const ph = h / planks
    ctx.fillStyle = i % 2 === 0 ? p.wood : p.woodLight
    ctx.fillRect(x, py + 1, w, ph - 2)
  }
  ctx.fillStyle = p.plankHi
  ctx.fillRect(x, top - v.S(0.06), w, Math.max(2, v.S(0.045)))
}

/**
 * Gwenn ha Du on a pole at the far end of the lane. Deliberately simplified —
 * five stripes instead of nine and three ermine spots in the canton — because
 * the whole thing is about twenty pixels tall and the real flag turns to mush
 * at that size.
 */
function drawFlag(v: View, p: ScenePalette, terrain: Terrain, worldX: number, time: number, reduced: boolean) {
  const { ctx } = v
  const baseY = v.Y(terrain.heightAt(worldX))
  const x = v.X(worldX)
  const poleH = v.S(1.15)
  const fw = v.S(0.66)
  const fh = v.S(0.42)
  const top = baseY - poleH

  // Pole, with a small foot shadow so it isn't floating on the gravel.
  ctx.fillStyle = 'rgba(90, 58, 32, 0.25)'
  ctx.beginPath()
  ctx.ellipse(x, baseY, v.S(0.14), v.S(0.04), 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = p.flagPole
  ctx.fillRect(x - Math.max(0.5, v.S(0.018)), top, Math.max(1.5, v.S(0.036)), poleH)

  const rows = 5 // black / white / black / white / black
  const rh = fh / rows
  const amp = reduced ? 0 : fh * 0.16
  const cols = 6
  // One wavy quad strip per stripe: cheap, and the ripple carries across the
  // whole flag because every row samples the same wave.
  const waveAt = (t: number) => Math.sin(t * 5.2 - time * 4.2) * amp * t
  for (let r = 0; r < rows; r++) {
    ctx.fillStyle = r % 2 === 0 ? p.flagBlack : p.flagWhite
    ctx.beginPath()
    for (let i = 0; i <= cols; i++) {
      const t = i / cols
      const px = x + t * fw
      const py = top + r * rh + waveAt(t)
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    for (let i = cols; i >= 0; i--) {
      const t = i / cols
      ctx.lineTo(x + t * fw, top + (r + 1) * rh + waveAt(t))
    }
    ctx.closePath()
    ctx.fill()
  }

  // Canton: white block at the hoist with a hint of ermine.
  const cw = fw * 0.4
  const ch = fh * 0.55
  ctx.fillStyle = p.flagWhite
  ctx.beginPath()
  ctx.moveTo(x, top)
  ctx.lineTo(x + cw, top + waveAt(cw / fw))
  ctx.lineTo(x + cw, top + ch + waveAt(cw / fw))
  ctx.lineTo(x, top + ch)
  ctx.closePath()
  ctx.fill()

  const dot = Math.max(0.8, cw * 0.11)
  ctx.fillStyle = p.flagBlack
  ctx.beginPath()
  for (const [ex, ey] of [[0.28, 0.3], [0.62, 0.3], [0.45, 0.68]] as const) {
    const px = x + cw * ex
    ctx.rect(px - dot / 2, top + ch * ey + waveAt((cw * ex) / fw), dot, dot * 1.4)
  }
  ctx.fill()
}

// ---------------------------------------------------------------- seagull

/**
 * The ambient gull. Flat two-tone bird: body + head + beak, wings either beating
 * (in flight) or folded (on the gravel). It lives in world coordinates, so the
 * camera carries it for free.
 */
export function drawSeagull(v: View, p: ScenePalette, g: Seagull) {
  if (!g.visible) return
  const { ctx } = v
  const cx = v.X(g.x)
  const cy = v.Y(g.y)
  const f = g.dir
  const bl = v.S(0.24) // body half-length
  const bh = v.S(0.1) // body half-height
  if (bl < 1) return

  // Shadow, only while the bird is near the ground: it fades as it climbs.
  const height = g.y - g.gy
  if (height < 1.4) {
    const k = 1 - height / 1.4
    ctx.globalAlpha = 0.28 * k
    ctx.fillStyle = PALETTE.shadow
    ctx.beginPath()
    ctx.ellipse(cx, v.Y(g.gy - 0.01), bl * (0.9 + 0.5 * (1 - k)), bh * 0.45, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
  }

  // In flight: a shallow "M". Swept back from the shoulder, the way a gull's
  // wing actually sits — leading edge out to the tip, trailing edge back down to
  // the flank. Declared before the body because the *far* wing has to go under
  // it; only the near one is drawn on top.
  const beat = g.gliding ? 0.15 : Math.sin(g.wing)
  const span = bl * 1.9
  const lift = bh * 3.2
  const wing = (t: number, color: string) => {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(cx + f * bl * 0.1, cy - bh * 0.25)
    ctx.quadraticCurveTo(
      cx - f * span * 0.15,
      cy - t * lift * 0.95,
      cx - f * span * 0.55,
      cy - t * lift,
    )
    ctx.quadraticCurveTo(
      cx - f * span * 0.22,
      cy - t * lift * 0.3 + bh * 0.45,
      cx - f * bl * 0.45,
      cy + bh * 0.35,
    )
    ctx.closePath()
    ctx.fill()
  }

  // Far wing first: behind the body, a beat out of phase and in the shade tone,
  // which is what gives the bird its thickness.
  if (!g.grounded) wing(-beat * 0.7, p.gullShade)

  // Tail, then body.
  ctx.fillStyle = p.gullBody
  ctx.beginPath()
  ctx.moveTo(cx - f * bl * 0.85, cy - bh * 0.2)
  ctx.lineTo(cx - f * bl * 1.5, cy - bh * 0.7)
  ctx.lineTo(cx - f * bl * 1.45, cy + bh * 0.25)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(cx, cy, bl, bh, 0, 0, Math.PI * 2)
  ctx.fill()

  // Head: leans forward and down while pecking.
  const peck = g.peck
  const hx = cx + f * bl * 0.82 + f * peck * bl * 0.35
  const hy = cy - bh * 0.75 + peck * bh * 2.1
  ctx.beginPath()
  ctx.arc(hx, hy, bh * 0.75, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = p.gullBeak
  ctx.beginPath()
  ctx.moveTo(hx + f * bh * 0.5, hy - bh * 0.1 + peck * bh * 0.3)
  ctx.lineTo(hx + f * bh * 1.5, hy + bh * 0.25 + peck * bh * 0.5)
  ctx.lineTo(hx + f * bh * 0.5, hy + bh * 0.45 + peck * bh * 0.3)
  ctx.closePath()
  ctx.fill()

  if (g.grounded) {
    // Folded wing + two twig legs.
    ctx.fillStyle = p.gullWing
    ctx.beginPath()
    ctx.ellipse(cx - f * bl * 0.15, cy + bh * 0.05, bl * 0.62, bh * 0.55, f * 0.12, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = p.gullTip
    ctx.beginPath()
    ctx.moveTo(cx - f * bl * 0.7, cy - bh * 0.05)
    ctx.lineTo(cx - f * bl * 1.25, cy + bh * 0.15)
    ctx.lineTo(cx - f * bl * 0.7, cy + bh * 0.35)
    ctx.closePath()
    ctx.fill()

    ctx.strokeStyle = p.gullBeak
    ctx.lineWidth = Math.max(1, bh * 0.18)
    ctx.beginPath()
    ctx.moveTo(cx - f * bl * 0.1, cy + bh * 0.7)
    ctx.lineTo(cx - f * bl * 0.14, cy + bh * 1.6)
    ctx.moveTo(cx + f * bl * 0.22, cy + bh * 0.7)
    ctx.lineTo(cx + f * bl * 0.18, cy + bh * 1.6)
    ctx.stroke()
    return
  }

  // Near wing, over the body.
  wing(beat, p.gullWing)
}

// ---------------------------------------------------------------- boules

export interface SceneEntity {
  kind: 'boule' | 'cochonnet'
  owner: PlayerId | null
  x: number
  y: number
  angle: number
  r: number
  groundY: number
}

function drawShadow(v: View, e: SceneEntity) {
  const { ctx } = v
  const height = Math.max(0, e.y - e.r - e.groundY)
  const spread = 1 / (1 + height * 0.55)
  ctx.globalAlpha = 0.1 + 0.28 * spread
  ctx.fillStyle = PALETTE.shadow
  ctx.beginPath()
  ctx.ellipse(
    v.X(e.x + height * 0.06),
    v.Y(e.groundY - 0.015),
    v.S(e.r * (1.25 - 0.35 * (1 - spread))),
    v.S(e.r * 0.4 * spread + 0.01),
    0,
    0,
    Math.PI * 2,
  )
  ctx.fill()
  ctx.globalAlpha = 1
}

function drawBoule(v: View, e: SceneEntity) {
  const { ctx } = v
  const cx = v.X(e.x)
  const cy = v.Y(e.y)
  const r = v.S(e.r)
  if (r < 0.5) return

  // Built at the origin so the key is just the radius: every boule on the lane
  // is the same size, so this is one gradient per frame instead of one each.
  const gr = q(r)
  const g = cachedGradient(ctx, `boule|${gr}`, (c) => {
    const made = c.createRadialGradient(-gr * 0.38, -gr * 0.42, gr * 0.08, 0, 0, gr * 1.12)
    made.addColorStop(0, PALETTE.steelLight)
    made.addColorStop(0.45, PALETTE.steelMid)
    made.addColorStop(1, PALETTE.steelDark)
    return made
  })
  ctx.save()
  ctx.translate(cx, cy)
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // Side stripes — different colour AND different pattern, so the two sides
  // stay distinguishable without relying on hue.
  const colors = playerColor(e.owner ?? 0)
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.clip()
  ctx.translate(cx, cy)
  ctx.rotate(-e.angle)
  ctx.globalAlpha = 0.9
  if (e.owner === 0) {
    // rings
    ctx.strokeStyle = colors.stripe
    ctx.lineWidth = r * 0.19
    for (const off of [-0.42, 0.42]) {
      ctx.beginPath()
      ctx.ellipse(0, off * r, r * 0.98, r * 0.3, 0, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.strokeStyle = colors.stripeDark
    ctx.lineWidth = r * 0.06
    ctx.beginPath()
    ctx.ellipse(0, 0, r * 0.96, r * 0.5, 0, 0, Math.PI * 2)
    ctx.stroke()
  } else {
    // cross-hatch
    ctx.strokeStyle = colors.stripe
    ctx.lineWidth = r * 0.13
    for (const d of [-0.55, 0, 0.55]) {
      ctx.beginPath()
      ctx.moveTo(-r, d * r - r * 0.6)
      ctx.lineTo(r, d * r + r * 0.6)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(-r, -d * r + r * 0.6)
      ctx.lineTo(r, -d * r - r * 0.6)
      ctx.stroke()
    }
  }
  ctx.restore()

  // Specular dot + rim
  ctx.globalAlpha = 0.85
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.ellipse(cx - r * 0.36, cy - r * 0.42, r * 0.2, r * 0.13, -0.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.strokeStyle = 'rgba(30, 24, 40, 0.35)'
  ctx.lineWidth = Math.max(1, r * 0.06)
  ctx.beginPath()
  ctx.arc(cx, cy, r - ctx.lineWidth * 0.5, 0, Math.PI * 2)
  ctx.stroke()
}

function drawCochonnet(v: View, e: SceneEntity) {
  const { ctx } = v
  const cx = v.X(e.x)
  const cy = v.Y(e.y)
  const r = Math.max(2, v.S(e.r))
  const gr = q(r)
  const g = cachedGradient(ctx, `coch|${gr}`, (c) => {
    const made = c.createRadialGradient(-gr * 0.35, -gr * 0.4, gr * 0.05, 0, 0, gr * 1.1)
    made.addColorStop(0, PALETTE.cochonnetHi)
    made.addColorStop(0.6, PALETTE.cochonnet)
    made.addColorStop(1, '#c94f05')
    return made
  })
  ctx.save()
  ctx.translate(cx, cy)
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.fill()
  // Rim on the same path, still inside the translate — a pure translation
  // leaves the line width alone, but keeping them together says so.
  ctx.strokeStyle = 'rgba(60, 25, 0, 0.4)'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.restore()
}

// ---------------------------------------------------------------- thrower

export interface SceneAim {
  origin: Vec
  angle: number
  /** null while simply aiming. */
  power: number | null
  owner: PlayerId
  preview: Vec[]
  groundY: number
  /** Hide the preview + gauge while the AI is "thinking". */
  idle: boolean
  /** The computer's side in `ai` mode: drawn as a robot instead of a silhouette. */
  robot?: boolean
}

function drawThrower(v: View, aim: SceneAim) {
  const { ctx } = v
  const colors = playerColor(aim.owner)
  const footY = aim.groundY
  const x = v.X(aim.origin.x - 0.15)
  const scale = v.scale
  const px = (m: number) => m * scale

  ctx.save()
  ctx.translate(x, v.Y(footY))
  ctx.fillStyle = '#2b2338'

  // The computer gets a robot body. Same footprint, same shoulder height, same
  // aiming arm — only the shapes change, so nothing about reading the throw
  // moves. Everything below is boxes: a robot is what a silhouette looks like
  // when you replace every curve with a right angle.
  if (aim.robot) {
    ctx.fillStyle = '#39424e'
    // stiff legs
    for (const dir of [-1, 1]) {
      ctx.fillRect(dir * px(0.2) - px(0.055), -px(0.62), px(0.11), px(0.62))
      ctx.fillRect(dir * px(0.2) - px(0.1), -px(0.06), px(0.2), px(0.06))
    }
    // boxy torso in the side's colour, with a darker chest plate
    ctx.fillStyle = colors.stripeDark
    ctx.fillRect(-px(0.17), -px(1.14), px(0.34), px(0.56))
    ctx.fillStyle = '#2b3440'
    ctx.fillRect(-px(0.1), -px(1.03), px(0.2), px(0.16))

    // rectangular head, antenna with its little ball, one eye dot
    ctx.fillStyle = '#39424e'
    ctx.fillRect(-px(0.15), -px(1.42), px(0.3), px(0.26))
    ctx.fillRect(-px(0.014), -px(1.56), px(0.028), px(0.14))
    ctx.fillStyle = colors.stripe
    ctx.beginPath()
    ctx.arc(0, -px(1.57), Math.max(1, px(0.05)), 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(px(0.05), -px(1.29), Math.max(1, px(0.045)), 0, Math.PI * 2)
    ctx.fill()
  } else {
    // legs — two of them, feet apart, knees slightly bent
    ctx.strokeStyle = '#2b2338'
    ctx.lineWidth = px(0.11)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const dir of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(dir * px(0.22), 0)
      ctx.lineTo(dir * px(0.16), -px(0.34))
      ctx.lineTo(dir * px(0.05), -px(0.6))
      ctx.stroke()
    }
    drawThrowerBody(v, aim, px)
  }

  // arm, pointing along the aim — same tone as the head: it is a limb, not a
  // team accent (the torso and the boules already carry the side's colour)
  const shoulderY = -px(1.05)
  const armLen = px(0.55)
  const a = -aim.angle
  ctx.strokeStyle = aim.robot ? colors.stripeDark : '#3a2f4a'
  ctx.lineWidth = px(0.09)
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(px(0.05), shoulderY)
  ctx.lineTo(px(0.05) + Math.cos(a) * armLen, shoulderY + Math.sin(a) * armLen)
  ctx.stroke()
  ctx.restore()
}

/** Torso + head of the human thrower, drawn in the already-translated space. */
function drawThrowerBody(v: View, aim: SceneAim, px: (m: number) => number) {
  const { ctx } = v
  const colors = playerColor(aim.owner)

  // Torso. Player 0 is the local: marinière — white with narrow bleu-marine
  // stripes — and a bachi with its pompom rouge. Player 1 keeps a plain torso in
  // its own colour; the arm below is in the side colour for both, so a glance
  // still tells you whose turn it is either way.
  const torsoPath = () => {
    ctx.beginPath()
    ctx.moveTo(-px(0.14), -px(0.58))
    ctx.lineTo(px(0.16), -px(0.58))
    ctx.lineTo(px(0.12), -px(1.12))
    ctx.lineTo(-px(0.12), -px(1.12))
    ctx.closePath()
  }
  const marin = aim.owner === 0
  torsoPath()
  ctx.fillStyle = marin ? PALETTE.marinWhite : colors.stripeDark
  ctx.fill()

  if (marin) {
    // Stripes clipped to the torso: one batched path, so the whole jersey costs
    // a clip and a single fill.
    ctx.save()
    ctx.clip()
    ctx.fillStyle = PALETTE.marinNavy
    const band = Math.max(1, px(0.042))
    const pitch = Math.max(2, px(0.105))
    ctx.beginPath()
    for (let y = -px(1.1); y < -px(0.56); y += pitch) ctx.rect(-px(0.25), y, px(0.5), band)
    ctx.fill()
    ctx.restore()
  }

  // head
  ctx.fillStyle = '#3a2f4a'
  ctx.beginPath()
  ctx.arc(0, -px(1.26), px(0.15), 0, Math.PI * 2)
  ctx.fill()

  if (marin) {
    // Bachi: flat white crown sat on the head, navy band, pompom on top. Three
    // primitives, because at ~40 px tall anything more turns to mush.
    const capY = -px(1.34)
    ctx.fillStyle = PALETTE.marinWhite
    ctx.beginPath()
    ctx.ellipse(0, capY, px(0.185), px(0.075), 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = PALETTE.marinNavy
    ctx.fillRect(-px(0.17), capY + px(0.03), px(0.34), Math.max(1, px(0.05)))
    ctx.fillStyle = PALETTE.pompom
    ctx.beginPath()
    ctx.arc(0, capY - px(0.075), Math.max(1, px(0.05)), 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawPreview(v: View, aim: SceneAim) {
  const { ctx } = v
  ctx.save()
  ctx.fillStyle = 'rgba(255, 250, 235, 0.85)'
  aim.preview.forEach((p, i) => {
    const t = i / Math.max(1, aim.preview.length - 1)
    ctx.globalAlpha = 0.9 - t * 0.7
    ctx.beginPath()
    ctx.arc(v.X(p.x), v.Y(p.y), Math.max(1.5, v.S(0.045) * (1 - t * 0.4)), 0, Math.PI * 2)
    ctx.fill()
  })
  ctx.restore()
}

function drawPowerGauge(v: View, aim: SceneAim) {
  if (aim.power === null) return
  const { ctx } = v
  const x = v.X(aim.origin.x - 0.75)
  const bottom = v.Y(aim.groundY + 0.15)
  const h = v.S(1.5)
  const w = Math.max(6, v.S(0.16))

  ctx.fillStyle = 'rgba(30, 24, 45, 0.5)'
  ctx.beginPath()
  ctx.roundRect(x - w / 2, bottom - h, w, h, w / 2)
  ctx.fill()

  const p = Math.max(0, Math.min(1, aim.power))
  const fh = h * p
  const g0 = q(bottom)
  const g1 = q(bottom - h)
  const g = cachedGradient(ctx, `gauge|${g0}|${g1}`, (c) => {
    const made = c.createLinearGradient(0, g0, 0, g1)
    made.addColorStop(0, '#7ed957')
    made.addColorStop(0.55, '#ffd166')
    made.addColorStop(1, '#ef476f')
    return made
  })
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.roundRect(x - w / 2 + 1, bottom - fh, w - 2, Math.max(2, fh), w / 2)
  ctx.fill()

  ctx.fillStyle = 'rgba(255, 250, 235, 0.95)'
  ctx.fillRect(x - w, bottom - fh - 1, w * 2, 2)
}

// ---------------------------------------------------------------- overlays

export interface SceneMeasure {
  from: Vec
  to: Vec
  label: string
  owner: PlayerId
}

function drawMeasures(v: View, measures: SceneMeasure[]) {
  const { ctx } = v
  ctx.save()
  ctx.lineWidth = Math.max(1, v.S(0.02))
  ctx.setLineDash([v.S(0.09), v.S(0.07)])
  ctx.font = `600 ${Math.max(10, Math.round(v.S(0.24)))}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  measures.forEach((m, i) => {
    const colors = playerColor(m.owner)
    ctx.strokeStyle = colors.stripe
    ctx.beginPath()
    ctx.moveTo(v.X(m.from.x), v.Y(m.from.y))
    ctx.lineTo(v.X(m.to.x), v.Y(m.to.y))
    ctx.stroke()

    const mx = v.X((m.from.x + m.to.x) / 2)
    const my = Math.max(
      v.h / 2 - v.refH * 0.36,
      v.Y(Math.max(m.from.y, m.to.y)) - v.S(0.35) - i * v.S(0.42),
    )
    const tw = ctx.measureText(m.label).width + v.S(0.2)
    ctx.setLineDash([])
    ctx.fillStyle = PALETTE.paper
    ctx.beginPath()
    ctx.roundRect(mx - tw / 2, my - v.S(0.22), tw, v.S(0.34), v.S(0.08))
    ctx.fill()
    ctx.strokeStyle = colors.stripe
    ctx.lineWidth = Math.max(1, v.S(0.015))
    ctx.stroke()
    ctx.fillStyle = PALETTE.ink
    ctx.fillText(m.label, mx, my + v.S(0.04))
    ctx.setLineDash([v.S(0.09), v.S(0.07)])
    ctx.lineWidth = Math.max(1, v.S(0.02))
  })
  ctx.restore()
}

function drawParticles(v: View, effects: Effects) {
  const { ctx } = v
  for (const p of effects.particles) {
    const t = p.life / p.maxLife
    const x = v.X(p.x)
    const y = v.Y(p.y)
    if (p.kind === 'dust') {
      ctx.globalAlpha = (1 - t) * 0.6
      ctx.fillStyle = p.color
      ctx.beginPath()
      ctx.arc(x, y, Math.max(1, v.S(p.r)), 0, Math.PI * 2)
      ctx.fill()
    } else if (p.kind === 'spark') {
      ctx.globalAlpha = 1 - t
      ctx.strokeStyle = p.color
      ctx.lineWidth = Math.max(1, v.S(0.02))
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x - v.S(p.vx * 0.03), y + v.S(p.vy * 0.03))
      ctx.stroke()
    } else {
      ctx.globalAlpha = Math.min(1, (1 - t) * 2.2)
      ctx.fillStyle = p.color
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(p.angle)
      const s = v.S(p.r)
      ctx.fillRect(-s * 0.5, -s * 0.35, s, s * 0.7)
      ctx.restore()
    }
  }
  ctx.globalAlpha = 1
}

// ---------------------------------------------------------------- scene

export interface SceneData {
  time: number
  terrain: Terrain
  entities: SceneEntity[]
  aim: SceneAim | null
  measures: SceneMeasure[]
  effects: Effects
  backdrop: Backdrop
  reducedMotion: boolean
  /** The mène's breeze in m/s, signed (+ = down the lane). Drives the pennant. */
  wind: number
  throwX: number
  board: { x: number, h: number, hw: number }
  /** Ambient wildlife; omitted is fine. */
  seagull?: Seagull | null
}

/**
 * Everything behind the animated layers: sky, sun, clouds, coastline, the
 * phare's masonry, the sea and its glints. This is the expensive half — two
 * gradient washes and a couple of screen-wide polygons — and it only depends on
 * the pan and the canvas size, so it goes into an offscreen canvas and is
 * blitted every frame. During aiming, which is most of the game, the camera is
 * parked and the whole stack collapses to one copy.
 *
 * The tree band deliberately stays *out* of it. Three layers animate — flocks,
 * the lamp beat, the sloops — and all three belong behind the pines, so caching
 * the trees would need a second, alpha-blended slab. An 8-bit premultiplied
 * round-trip through that slab costs a couple of units on every antialiased
 * branch edge, and the tree line is thirty small paths: cheaper to redraw than
 * to composite. So the order is: blit this, draw the movers, draw the trees.
 */
function drawBackdropFar(v: View, b: Backdrop, p: ScenePalette, pan: number, horizon: number) {
  drawSky(v, p, horizon)
  drawSun(v, p, pan, horizon)
  drawClouds(v, b, p, pan, horizon)
  drawHorizonStatic(v, b, p, pan, horizon)
}

interface BackdropCache {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  devW: number
  devH: number
  w: number
  h: number
  refW: number
  pan: number
  horizon: number
  backdrop: Backdrop
}

let backdropCache: BackdropCache | null = null

/**
 * Rebuild the slab when anything it depends on has moved, then blit it. Half a
 * device pixel is the threshold on the two continuous inputs: the camera eases
 * asymptotically and never truly stops, so an exact comparison would rebuild
 * every frame forever, and half a pixel is below what a pan can show. A new
 * mène brings new terrain, which moves the horizon, which invalidates it.
 * Returns false when there is no offscreen to draw through, in which case the
 * caller paints the backdrop straight onto the frame.
 */
function blitBackdropFar(v: View, b: Backdrop, p: ScenePalette, pan: number, horizon: number): boolean {
  const { ctx } = v
  const devW = ctx.canvas.width
  const devH = ctx.canvas.height
  const dpr = dprOf(v)
  if (typeof document === 'undefined' || devW < 1 || devH < 1) return false

  let cache = backdropCache
  const resized = !cache
    || cache.devW !== devW || cache.devH !== devH
    || cache.w !== v.w || cache.h !== v.h || cache.refW !== v.refW
  const moved = !cache
    || cache.backdrop !== b
    || Math.abs(cache.pan - pan) * dpr >= 0.5
    || Math.abs(cache.horizon - horizon) * dpr >= 0.5

  if (resized) {
    const canvas = cache?.canvas ?? document.createElement('canvas')
    canvas.width = devW
    canvas.height = devH
    // Opaque: the sky and the coastline between them cover every pixel, which
    // makes the per-frame blit a straight copy with no alpha round-trip.
    const offCtx = canvas.getContext('2d', { alpha: false })
    if (!offCtx) return false
    cache = {
      canvas,
      ctx: offCtx,
      devW,
      devH,
      w: v.w,
      h: v.h,
      refW: v.refW,
      pan: Number.NaN,
      horizon: Number.NaN,
      backdrop: b,
    }
    backdropCache = cache
  }
  if (!cache) return false

  if (resized || moved) {
    cache.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    // Start from exactly the ground `clearCanvas` lays down on the frame, in the
    // same CSS units: the backing store is `round(cssH * dpr)` tall, so its last
    // device row is usually only half reachable, and every partly covered pixel
    // there has to blend against the same colour it would have on the frame.
    cache.ctx.fillStyle = PALETTE.letterbox
    cache.ctx.fillRect(0, 0, v.w, v.h)
    drawBackdropFar(makeView(cache.ctx, v.w, v.h, v.cam), b, p, pan, horizon)
    cache.pan = pan
    cache.horizon = horizon
    cache.backdrop = b
  }

  // 1:1 in device pixels — no resample, no filtering, exactly the pixels the
  // single-pass version would have painted.
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.drawImage(cache.canvas, 0, 0)
  ctx.restore()
  return true
}

/** Drop the cached backdrop — call when the canvas is going away. */
export function releaseBackdropCache() {
  backdropCache = null
  bulbSprites = null
}

export function drawScene(v: View, s: SceneData) {
  const { ctx } = v
  ctx.save()
  ctx.beginPath()
  // Clip to the whole canvas — the scene fills it, there is no letterbox left.
  ctx.rect(0, 0, v.w, v.h)
  ctx.clip()

  const p = PALETTES[s.backdrop.scene]
  const pan = (v.cam.cx - LANE_MID) * v.scale

  // The whole backdrop hangs off the ground's screen position, so the
  // composition holds together at any zoom level.
  const horizon = Math.max(
    v.h * 0.42,
    Math.min(v.h * 0.9, v.Y(s.terrain.heightAt(v.cam.cx)) - v.refH * 0.03),
  )

  // Cached slab, then the three layers that move with the clock, then the tree
  // band on top of them: that sandwich is what keeps a sloop behind the pines
  // and the lamp's halo behind the coast, exactly as the old single pass did.
  if (!blitBackdropFar(v, s.backdrop, p, pan, horizon)) {
    drawBackdropFar(v, s.backdrop, p, pan, horizon)
  }
  drawFlocks(v, s.backdrop, p, pan, horizon, s.time, s.reducedMotion)
  drawLighthouseLamp(
    v,
    s.backdrop,
    p,
    pan,
    v.refH * HILLS_FAR_AMP,
    horizon - v.refH * SEA_TOP_AT + v.refH * HILLS_FAR_BASE,
    horizon,
    s.time,
  )
  drawBoats(v, s.backdrop, p, pan, horizon, s.time)
  drawTreeLine(v, s.backdrop, p, pan, horizon)
  drawGarland(v, s.backdrop, p, pan, s.time, s.reducedMotion)
  drawGround(v, p, s.terrain)
  drawThrowCircle(v, s.terrain, s.throwX)
  // Just ahead of the thrower, not behind: while aiming the camera sits well
  // to the right of the circle, so anything left of it is off-screen.
  drawWindVane(v, p, s.terrain, s.throwX + 0.85, s.wind, s.time, s.reducedMotion)
  drawBackboard(v, p, s.terrain, s.board.x, s.board.h, s.board.hw)
  drawFlag(v, p, s.terrain, s.board.x + 0.55, s.time, s.reducedMotion)
  if (s.seagull) drawSeagull(v, p, s.seagull)

  for (const e of s.entities) drawShadow(v, e)
  for (const e of s.entities) if (e.kind === 'cochonnet') drawCochonnet(v, e)
  for (const e of s.entities) if (e.kind === 'boule') drawBoule(v, e)

  drawParticles(v, s.effects)
  if (s.measures.length) drawMeasures(v, s.measures)

  if (s.aim) {
    drawThrower(v, s.aim)
    if (!s.aim.idle) {
      drawPreview(v, s.aim)
      drawPowerGauge(v, s.aim)
    }
  }

  ctx.restore()
}

/**
 * Fallback fill only: the scene now paints every pixel itself, but a frame that
 * bails out early (canvas resized mid-frame, backdrop not ready) should show a
 * deep neutral rather than whatever was there before.
 */
export function clearCanvas(ctx: CanvasRenderingContext2D, cssW: number, cssH: number) {
  ctx.fillStyle = PALETTE.letterbox
  ctx.fillRect(0, 0, cssW, cssH)
}
