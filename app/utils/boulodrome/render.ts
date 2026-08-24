// Everything that puts pixels on the canvas. World units are meters; a single
// camera transform maps them to CSS pixels, and the play area keeps a fixed
// 2.4:1 aspect (letterboxed on narrow screens).
//
// Target look: a July evening in Fouesnant — warm sky, flat silhouettes, café
// fairy lights, sandy gravel. Everything procedural, no image assets.

import type { Effects } from './effects'
import { PALETTE, playerColor } from './palette'
import { createRng } from './rng'
import type { Terrain } from './terrain'
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
  ox: number
  oy: number
  w: number
  h: number
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
  const scale = Math.min(cssW / cam.viewW, cssH / viewH)
  const w = cam.viewW * scale
  const h = viewH * scale
  const ox = (cssW - w) / 2
  const oy = (cssH - h) / 2
  return {
    ctx,
    ox,
    oy,
    w,
    h,
    scale,
    cam,
    X: (x: number) => ox + w / 2 + (x - cam.cx) * scale,
    Y: (y: number) => oy + h / 2 - (y - cam.cy) * scale,
    S: (m: number) => m * scale,
  }
}

// ---------------------------------------------------------------- backdrop

export interface Backdrop {
  hillPhase: number[]
  trees: { x: number, h: number, w: number, kind: 0 | 1 }[]
  bulbs: { t: number, color: string, phase: number }[]
  clouds: { x: number, y: number, w: number, h: number, hi: boolean }[]
  glints: { x: number, y: number, w: number }[]
}

/** Generated once per game: the horizon shouldn't change between mènes. */
export function createBackdrop(seed: number): Backdrop {
  const rng = createRng(seed)
  const hillPhase = [rng() * 7, rng() * 7, rng() * 7, rng() * 7]

  const trees: Backdrop['trees'] = []
  for (let i = 0; i < 26; i++) {
    trees.push({
      x: -0.25 + rng() * 1.6,
      h: 0.06 + rng() * 0.1,
      w: 0.02 + rng() * 0.035,
      kind: rng() < 0.45 ? 0 : 1,
    })
  }
  trees.sort((a, b) => a.h - b.h)

  const bulbs: Backdrop['bulbs'] = []
  for (let i = 0; i <= 26; i++) {
    bulbs.push({
      t: i / 26,
      color: PALETTE.bulbs[i % PALETTE.bulbs.length]!,
      phase: rng() * Math.PI * 2,
    })
  }

  const clouds: Backdrop['clouds'] = []
  for (let i = 0; i < 7; i++) {
    clouds.push({
      x: -0.2 + rng() * 1.5,
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

  return { hillPhase, trees, bulbs, clouds, glints }
}

function hillY(x: number, phase: number[], amp: number, base: number): number {
  return (
    base
    - amp * (0.55 * Math.sin(x * 3.1 + phase[0]!) + 0.3 * Math.sin(x * 6.7 + phase[1]!) + 0.15 * Math.sin(x * 12.3 + phase[2]!))
  )
}

function drawSky(v: View) {
  const { ctx } = v
  const g = ctx.createLinearGradient(0, v.oy, 0, v.oy + v.h)
  for (const stop of PALETTE.sky) g.addColorStop(stop.at, stop.color)
  ctx.fillStyle = g
  ctx.fillRect(v.ox, v.oy, v.w, v.h)
}

function drawSun(v: View, pan: number, horizon: number) {
  const { ctx } = v
  const cx = v.ox + v.w * 0.74 - pan * 0.04
  const cy = horizon - v.h * 0.24
  const r = v.h * 0.1

  const glow = ctx.createRadialGradient(cx, cy, r * 0.4, cx, cy, r * 5)
  glow.addColorStop(0, PALETTE.sunGlow)
  glow.addColorStop(1, 'rgba(255, 190, 120, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(v.ox, v.oy, v.w, v.h)

  ctx.fillStyle = PALETTE.sun
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
}

function drawClouds(v: View, b: Backdrop, pan: number, horizon: number) {
  const { ctx } = v
  ctx.globalAlpha = 0.55
  for (const c of b.clouds) {
    const x = v.ox + ((c.x - (pan * 0.06) / v.w) % 1.7) * v.w
    const y = horizon - v.h * (0.2 + c.y * 0.55)
    ctx.fillStyle = c.hi ? PALETTE.cloudHi : PALETTE.cloud
    const rx = c.w * v.w * 0.32
    const ry = Math.max(2, c.h * v.h * 0.6)
    ctx.beginPath()
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
    ctx.ellipse(x + rx * 0.7, y + ry * 0.3, rx * 0.55, ry * 0.7, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

function drawHorizon(v: View, b: Backdrop, pan: number, horizon: number) {
  const { ctx } = v
  const seaTop = horizon - v.h * 0.2

  // Coastline first: the sea band is painted over their feet, so the hills
  // read as standing behind the water.
  const layers = [
    { color: PALETTE.hillsFar, amp: v.h * 0.075, base: seaTop - v.h * 0.005, factor: 0.1 },
    { color: PALETTE.hillsNear, amp: v.h * 0.05, base: seaTop + v.h * 0.008, factor: 0.18 },
  ]
  for (const layer of layers) {
    ctx.fillStyle = layer.color
    ctx.beginPath()
    ctx.moveTo(v.ox, v.oy + v.h)
    for (let i = 0; i <= 64; i++) {
      const t = i / 64
      const sx = v.ox + t * v.w
      const hx = t + (pan * layer.factor) / v.w
      ctx.lineTo(sx, hillY(hx, b.hillPhase, layer.amp, layer.base))
    }
    ctx.lineTo(v.ox + v.w, v.oy + v.h)
    ctx.closePath()
    ctx.fill()
  }

  // Sea band
  const seaBottom = seaTop + v.h * 0.115
  ctx.fillStyle = PALETTE.sea
  ctx.fillRect(v.ox, seaTop + v.h * 0.02, v.w, seaBottom - seaTop)
  ctx.fillStyle = PALETTE.seaGlint
  for (const g of b.glints) {
    const x = v.ox + ((g.x - (pan * 0.02) / v.w + 1) % 1) * v.w
    ctx.fillRect(x, seaTop + v.h * 0.03 + g.y * v.h * 0.075, g.w * v.w * 0.06, Math.max(1, v.h * 0.004))
  }
}

function drawTreeLine(v: View, b: Backdrop, pan: number, horizon: number) {
  const { ctx } = v
  const base = horizon - v.h * 0.035
  ctx.fillStyle = PALETTE.treeLine
  ctx.fillRect(v.ox, base, v.w, horizon - base + v.h * 0.02)
  for (const t of b.trees) {
    const x = v.ox + (t.x * v.w - pan * 0.3)
    if (x < v.ox - 80 || x > v.ox + v.w + 80) continue
    const h = t.h * v.h
    const w = t.w * v.w
    ctx.fillStyle = PALETTE.treeLine
    if (t.kind === 0) {
      // pine
      ctx.beginPath()
      ctx.moveTo(x, base - h * 1.6)
      ctx.lineTo(x + w * 0.7, base + 2)
      ctx.lineTo(x - w * 0.7, base + 2)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = PALETTE.treeRim
      ctx.lineWidth = Math.max(1, v.h * 0.003)
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
      ctx.strokeStyle = PALETTE.treeRim
      ctx.lineWidth = Math.max(1, v.h * 0.004)
      ctx.beginPath()
      ctx.ellipse(x, cy, w * 0.93, h * 0.78, 0, -1.9, 0.15)
      ctx.stroke()
    }
  }
  ctx.fillStyle = PALETTE.treeHi
  ctx.fillRect(v.ox, base - 2, v.w, 2)
}

function drawFairyLights(v: View, b: Backdrop, pan: number, time: number, reduced: boolean) {
  const { ctx } = v
  const x0 = v.ox - v.w * 0.05 - pan * 0.12
  const x1 = x0 + v.w * 1.1
  const top = v.oy + v.h * 0.045
  const sag = v.h * 0.1
  const yAt = (t: number) => {
    // three catenary swags
    const s = (t * 3) % 1
    return top + Math.sin(s * Math.PI) * sag + Math.sin(t * Math.PI) * v.h * 0.02
  }

  ctx.strokeStyle = PALETTE.wire
  ctx.lineWidth = Math.max(1, v.h * 0.004)
  ctx.beginPath()
  for (let i = 0; i <= 90; i++) {
    const t = i / 90
    const x = x0 + (x1 - x0) * t
    const y = yAt(t)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()

  for (const bulb of b.bulbs) {
    const x = x0 + (x1 - x0) * bulb.t
    if (x < v.ox - 20 || x > v.ox + v.w + 20) continue
    const y = yAt(bulb.t) + v.h * 0.012
    const tw = reduced ? 1 : 0.82 + 0.18 * Math.sin(time * 2.1 + bulb.phase)
    const r = v.h * 0.011

    const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 5)
    glow.addColorStop(0, bulb.color)
    glow.addColorStop(1, 'rgba(255, 200, 120, 0)')
    ctx.globalAlpha = 0.42 * tw
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(x, y, r * 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1

    ctx.fillStyle = PALETTE.wire
    ctx.fillRect(x - r * 0.35, y - r * 1.5, r * 0.7, r * 0.8)
    ctx.fillStyle = bulb.color
    ctx.globalAlpha = tw
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
  }
}

// ---------------------------------------------------------------- terrain

function drawGround(v: View, terrain: Terrain) {
  const { ctx } = v
  const left = v.cam.cx - v.cam.viewW / 2 - 0.5
  const right = v.cam.cx + v.cam.viewW / 2 + 0.5
  const bottom = v.oy + v.h

  ctx.beginPath()
  ctx.moveTo(v.X(left), bottom)
  for (let x = left; x <= right; x += 0.16) ctx.lineTo(v.X(x), v.Y(terrain.heightAt(x)))
  ctx.lineTo(v.X(right), bottom)
  ctx.closePath()

  const gTop = v.Y(0.1)
  const g = ctx.createLinearGradient(0, gTop, 0, bottom)
  g.addColorStop(0, PALETTE.sandTop)
  g.addColorStop(0.35, PALETTE.sandMid)
  g.addColorStop(1, PALETTE.sandLow)
  ctx.fillStyle = g
  ctx.fill()

  ctx.save()
  ctx.clip()

  // Speckled grain — two batched passes (one path per tone) rather than a
  // fill per grain, which matters on phones.
  for (const pass of [0, 1]) {
    ctx.fillStyle = pass ? PALETTE.speckleLight : PALETTE.speckleDark
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
  ctx.strokeStyle = PALETTE.sandRake
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
  ctx.strokeStyle = 'rgba(120, 82, 45, 0.28)'
  ctx.lineWidth = Math.max(2, v.S(0.1))
  traceEdge(v.S(0.075))
  ctx.strokeStyle = 'rgba(255, 236, 195, 0.75)'
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

function drawBackboard(v: View, terrain: Terrain, boardX: number, boardH: number, boardHw: number) {
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
  ctx.fillStyle = PALETTE.woodDark
  ctx.fillRect(x - v.S(0.05), top - v.S(0.06), w + v.S(0.1), h + v.S(0.06))

  const planks = 3
  for (let i = 0; i < planks; i++) {
    const py = top + (h * i) / planks
    const ph = h / planks
    ctx.fillStyle = i % 2 === 0 ? PALETTE.wood : PALETTE.woodLight
    ctx.fillRect(x, py + 1, w, ph - 2)
  }
  ctx.fillStyle = 'rgba(255, 226, 180, 0.5)'
  ctx.fillRect(x, top - v.S(0.06), w, Math.max(2, v.S(0.045)))
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

  const g = ctx.createRadialGradient(cx - r * 0.38, cy - r * 0.42, r * 0.08, cx, cy, r * 1.12)
  g.addColorStop(0, PALETTE.steelLight)
  g.addColorStop(0.45, PALETTE.steelMid)
  g.addColorStop(1, PALETTE.steelDark)
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()

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
  const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.05, cx, cy, r * 1.1)
  g.addColorStop(0, PALETTE.cochonnetHi)
  g.addColorStop(0.6, PALETTE.cochonnet)
  g.addColorStop(1, '#c94f05')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(60, 25, 0, 0.4)'
  ctx.lineWidth = 1
  ctx.stroke()
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

  // torso, in the side's colour so you can tell who is throwing
  ctx.fillStyle = colors.stripeDark
  ctx.beginPath()
  ctx.moveTo(-px(0.14), -px(0.58))
  ctx.lineTo(px(0.16), -px(0.58))
  ctx.lineTo(px(0.12), -px(1.12))
  ctx.lineTo(-px(0.12), -px(1.12))
  ctx.closePath()
  ctx.fill()

  // head
  ctx.fillStyle = '#3a2f4a'
  ctx.beginPath()
  ctx.arc(0, -px(1.26), px(0.15), 0, Math.PI * 2)
  ctx.fill()

  // arm, pointing along the aim
  const shoulderY = -px(1.05)
  const armLen = px(0.55)
  const a = -aim.angle
  ctx.strokeStyle = colors.stripe
  ctx.lineWidth = px(0.09)
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(px(0.05), shoulderY)
  ctx.lineTo(px(0.05) + Math.cos(a) * armLen, shoulderY + Math.sin(a) * armLen)
  ctx.stroke()
  ctx.restore()
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
  const g = ctx.createLinearGradient(0, bottom, 0, bottom - h)
  g.addColorStop(0, '#7ed957')
  g.addColorStop(0.55, '#ffd166')
  g.addColorStop(1, '#ef476f')
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
      v.oy + v.h * 0.14,
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
  throwX: number
  board: { x: number, h: number, hw: number }
}

export function drawScene(v: View, s: SceneData) {
  const { ctx } = v
  ctx.save()
  ctx.beginPath()
  ctx.rect(v.ox, v.oy, v.w, v.h)
  ctx.clip()

  const pan = (v.cam.cx - LANE_MID) * v.scale

  // The whole backdrop hangs off the ground's screen position, so the
  // composition holds together at any zoom level.
  const horizon = Math.max(
    v.oy + v.h * 0.42,
    Math.min(v.oy + v.h * 0.9, v.Y(s.terrain.heightAt(v.cam.cx)) - v.h * 0.03),
  )

  drawSky(v)
  drawSun(v, pan, horizon)
  drawClouds(v, s.backdrop, pan, horizon)
  drawHorizon(v, s.backdrop, pan, horizon)
  drawTreeLine(v, s.backdrop, pan, horizon)
  drawFairyLights(v, s.backdrop, pan, s.time, s.reducedMotion)
  drawGround(v, s.terrain)
  drawThrowCircle(v, s.terrain, s.throwX)
  drawBackboard(v, s.terrain, s.board.x, s.board.h, s.board.hw)

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

export function clearCanvas(ctx: CanvasRenderingContext2D, cssW: number, cssH: number) {
  ctx.fillStyle = PALETTE.letterbox
  ctx.fillRect(0, 0, cssW, cssH)
}
