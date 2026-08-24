// Juice: dust, sparks, confetti and screen shake. World coordinates, so the
// camera transform carries them for free. All of it honours reduced motion —
// the caller passes the flag once and the system stops shaking and confetti-ing.

import { PALETTE } from './palette'

export type ParticleKind = 'dust' | 'spark' | 'confetti'

export interface Particle {
  kind: ParticleKind
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  r: number
  angle: number
  spin: number
  color: string
  gravity: number
}

export class Effects {
  particles: Particle[] = []
  shake = 0
  reducedMotion = false

  constructor(reducedMotion = false) {
    this.reducedMotion = reducedMotion
  }

  /** Landing / rolling dust on the gravel. */
  puff(x: number, y: number, strength = 1) {
    const n = Math.min(18, 4 + Math.round(strength * 9))
    for (let i = 0; i < n; i++) {
      const a = Math.PI * (0.15 + Math.random() * 0.7)
      const sp = (0.4 + Math.random() * 1.5) * Math.min(2, strength)
      this.particles.push({
        kind: 'dust',
        x: x + (Math.random() - 0.5) * 0.12,
        y: y + Math.random() * 0.05,
        vx: Math.cos(a) * sp * (Math.random() < 0.5 ? -0.6 : 1),
        vy: Math.sin(a) * sp * 0.22,
        life: 0,
        maxLife: 0.35 + Math.random() * 0.4,
        r: 0.04 + Math.random() * 0.07,
        angle: 0,
        spin: 0,
        color: PALETTE.dust,
        gravity: -0.9,
      })
    }
  }

  /** Metallic clack: a few bright sparks flying off the contact point. */
  sparks(x: number, y: number, strength = 1) {
    const n = Math.min(14, 3 + Math.round(strength * 6))
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = (1 + Math.random() * 3) * Math.min(1.6, strength)
      this.particles.push({
        kind: 'spark',
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.abs(Math.sin(a)) * sp,
        life: 0,
        maxLife: 0.24 + Math.random() * 0.22,
        r: 0.018 + Math.random() * 0.02,
        angle: a,
        spin: 0,
        color: PALETTE.spark,
        gravity: -6,
      })
    }
  }

  confetti(x0: number, x1: number, y: number) {
    if (this.reducedMotion) return
    const colors = [...PALETTE.bulbs, PALETTE.boule1, PALETTE.boule2, PALETTE.cochonnet]
    for (let i = 0; i < 110; i++) {
      this.particles.push({
        kind: 'confetti',
        x: x0 + Math.random() * (x1 - x0),
        y: y + Math.random() * 1.5,
        vx: (Math.random() - 0.5) * 1.6,
        vy: -Math.random() * 0.8,
        life: 0,
        maxLife: 2.4 + Math.random() * 2,
        r: 0.05 + Math.random() * 0.06,
        angle: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 9,
        color: colors[Math.floor(Math.random() * colors.length)]!,
        gravity: -1.6,
      })
    }
  }

  kick(amount: number) {
    if (this.reducedMotion) return
    this.shake = Math.min(0.28, this.shake + amount)
  }

  update(dt: number) {
    this.shake *= Math.exp(-dt * 7)
    if (this.shake < 0.002) this.shake = 0
    const alive: Particle[] = []
    for (const p of this.particles) {
      p.life += dt
      if (p.life >= p.maxLife) continue
      p.vy += p.gravity * dt
      p.vx *= 1 - dt * (p.kind === 'dust' ? 1.6 : 0.6)
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.angle += p.spin * dt
      if (p.kind === 'dust') p.r += dt * 0.09
      alive.push(p)
    }
    this.particles = alive
  }

  shakeOffset(): { x: number, y: number } {
    if (!this.shake) return { x: 0, y: 0 }
    return {
      x: (Math.random() - 0.5) * this.shake,
      y: (Math.random() - 0.5) * this.shake * 0.6,
    }
  }

  clear() {
    this.particles.length = 0
    this.shake = 0
  }
}
