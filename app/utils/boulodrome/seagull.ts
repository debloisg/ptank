// Ambient seagull. Pure state + world coordinates: this module never touches a
// canvas (drawing lives in render.ts), so the behaviour stays testable and the
// renderer stays the only place that knows about pixels.
//
// The bird is deliberately *ambient*: it shows up every 8–25 s, crosses the
// scene, and now and then drops onto the gravel to potter about. It never
// interferes with the physics — it is decoration that reacts to the game, not
// the other way round. The one hard rule is that it must clear off the moment a
// boule is in play, which the caller signals with `calm === false`.

const TAU = Math.PI * 2

export type GullState =
  | 'away' // off-screen, counting down to the next appearance
  | 'cross' // flying across the frame
  | 'descend' // gliding down towards a chosen landing spot
  | 'ground' // stood on the gravel, stepping and pecking
  | 'takeoff' // climbing back out, wings hammering

export class Seagull {
  state: GullState = 'away'
  /** World metres. `gy` is the ground under the bird, cached for the shadow. */
  x = 0
  y = 0
  gy = 0
  /** +1 flying/facing right, -1 left. */
  dir: 1 | -1 = 1
  /** Wing-beat phase in radians; the renderer turns it into a flap. */
  wing = 0
  /** 0 = head up, 1 = beak on the ground. */
  peck = 0
  /** Wings held out and still — the reduced-motion glide, and the descent. */
  gliding = false

  private rng: () => number
  private reduced: boolean
  private timer = 0
  private cruiseY = 0
  private speed = 3
  private bob = 0
  private targetX = 0
  private wantsLand = false
  private stepTimer = 0
  private peckTimer = 0
  private peckClock = -1

  constructor(reducedMotion = false, rng: () => number = Math.random) {
    this.reduced = reducedMotion
    this.rng = rng
    // Don't open the game with a bird already flapping across the title shot —
    // and with reduced motion, keep it a rare event from the very first pass.
    this.timer = reducedMotion ? this.between(20, 45) : this.between(6, 14)
  }

  get visible(): boolean {
    return this.state !== 'away'
  }

  /** True while the bird is on the gravel (renderer draws legs + shadow). */
  get grounded(): boolean {
    return this.state === 'ground'
  }

  private between(a: number, b: number): number {
    return a + (b - a) * this.rng()
  }

  /**
   * @param calm  false while a boule/cochonnet is flying or rolling. Landing is
   *              forbidden then, and a landed bird takes off at once.
   * @param groundY terrain height sampler, so the gull lands *on* the gravel
   *                whatever the mène's profile happens to be.
   * @param xMin lane's left bound; the bird enters/leaves just outside it.
   * @param xMax lane's right bound, likewise.
   */
  update(
    dt: number,
    calm: boolean,
    groundY: (x: number) => number,
    xMin: number,
    xMax: number,
  ) {
    if (this.state === 'away') {
      this.timer -= dt
      if (this.timer <= 0) this.launch(calm, groundY, xMin, xMax)
      return
    }

    this.gy = groundY(this.x)
    // A boule in play kills any landing plan, mid-glide included.
    if (!calm) this.wantsLand = false

    switch (this.state) {
      case 'cross':
        this.tickCross(dt, calm, xMin, xMax)
        break
      case 'descend':
        this.tickDescend(dt, calm)
        break
      case 'ground':
        this.tickGround(dt, calm)
        break
      case 'takeoff':
        this.tickTakeoff(dt)
        break
    }

    // Wing-beat rate follows what the bird is doing: gliding birds hold still,
    // a bird clawing its way off the ground beats hard.
    if (!this.gliding && this.state !== 'ground') {
      const rate = this.state === 'takeoff' ? 15 : 8.5
      this.wing = (this.wing + rate * dt) % TAU
    }
  }

  private launch(calm: boolean, groundY: (x: number) => number, xMin: number, xMax: number) {
    this.dir = this.rng() < 0.5 ? 1 : -1
    this.x = this.dir > 0 ? xMin - 2 : xMax + 2
    this.speed = this.between(2.6, 4.4)
    this.targetX = this.between(xMin + 2.5, xMax - 2.5)
    // Reduced motion: a single straight glide, never a landing.
    this.wantsLand = !this.reduced && calm && this.rng() < 0.45
    this.gliding = this.reduced
    this.bob = this.rng() * TAU
    // The camera frames roughly 3 m of air above the gravel, so anything above
    // ~2.6 m would simply fly past off-screen.
    this.cruiseY = groundY(this.targetX) + this.between(1.5, 2.6)
    this.y = this.cruiseY
    this.gy = groundY(this.x)
    this.peck = 0
    this.state = 'cross'
  }

  private retire(gapMin = 8, gapMax = 25) {
    this.state = 'away'
    this.gliding = false
    this.peck = 0
    // Reduced motion also means "rarely": long gaps between appearances.
    this.timer = this.reduced ? this.between(30, 70) : this.between(gapMin, gapMax)
  }

  private tickCross(dt: number, calm: boolean, xMin: number, xMax: number) {
    this.x += this.speed * this.dir * dt
    if (this.reduced) {
      this.y = this.cruiseY
    } else {
      this.bob = (this.bob + dt * 2.2) % TAU
      this.y = this.cruiseY + Math.sin(this.bob) * 0.14
    }

    // Start the approach a couple of metres before the spot, so the descent
    // reads as a glide rather than a lift-crash.
    if (this.wantsLand && calm && (this.targetX - this.x) * this.dir <= 2.8) {
      this.state = 'descend'
      this.gliding = true
    }

    if (this.dir > 0 ? this.x > xMax + 2.5 : this.x < xMin - 2.5) this.retire()
  }

  private tickDescend(dt: number, calm: boolean) {
    if (!calm) {
      // Aborted approach: pull up and leave.
      this.state = 'takeoff'
      this.gliding = false
      return
    }
    // Exponential ease onto the spot: no per-frame allocation, no trig.
    const k = 1 - Math.exp(-dt * 2.6)
    this.x += (this.targetX - this.x) * k
    const restY = this.gy + 0.06
    this.y += (restY - this.y) * (1 - Math.exp(-dt * 3.2))
    if (Math.abs(this.x - this.targetX) < 0.08 && this.y - restY < 0.05) {
      this.x = this.targetX
      this.y = restY
      this.state = 'ground'
      this.gliding = false
      this.timer = this.between(3.5, 9)
      this.stepTimer = this.between(0.6, 1.6)
      this.peckTimer = this.between(0.5, 1.8)
    }
  }

  private tickGround(dt: number, calm: boolean) {
    this.y = this.gy + 0.06
    if (!calm) {
      // Spooked: straight up, immediately.
      this.state = 'takeoff'
      this.peck = 0
      this.gliding = false
      return
    }

    this.timer -= dt
    this.stepTimer -= dt
    if (this.stepTimer <= 0) {
      // Little hop-steps, with the odd about-turn — that fidgety gull walk.
      if (this.rng() < 0.25) this.dir = this.dir > 0 ? -1 : 1
      this.x += this.dir * this.between(0.04, 0.2)
      this.stepTimer = this.between(0.5, 1.7)
    }

    if (this.peckClock >= 0) {
      this.peckClock += dt
      const t = this.peckClock / 0.42
      // Down and back up in one 0.42 s beat.
      this.peck = t >= 1 ? 0 : Math.sin(t * Math.PI)
      if (t >= 1) {
        this.peckClock = -1
        this.peckTimer = this.between(0.5, 2.2)
      }
    } else {
      this.peckTimer -= dt
      if (this.peckTimer <= 0) this.peckClock = 0
    }

    if (this.timer <= 0) {
      this.state = 'takeoff'
      this.peck = 0
      this.peckClock = -1
    }
  }

  private tickTakeoff(dt: number) {
    // Climb first, forward speed comes back as it gains height.
    this.y += 3.4 * dt
    this.x += this.speed * this.dir * dt * 0.55
    if (this.y > this.gy + 2.1) {
      this.cruiseY = this.y
      this.wantsLand = false
      this.gliding = this.reduced
      this.state = 'cross'
    }
  }
}
