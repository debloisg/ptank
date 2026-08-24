// Four synthesized sounds, no audio files: the metallic "clack" of two boules,
// a soft thud on the gravel, a little pop when a boule dies, and a chime when a
// mène is won. Silent until the player turns sound on (HUD button).

export class GameAudio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noise: AudioBuffer | null = null
  enabled = false

  setEnabled(on: boolean) {
    this.enabled = on
    if (on) this.ensure()
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, 0.02)
    }
  }

  private ensure(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      return this.ctx
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    const ctx = new Ctor()
    const master = ctx.createGain()
    master.gain.value = 0.5
    master.connect(ctx.destination)

    const len = Math.floor(ctx.sampleRate * 0.4)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1

    this.ctx = ctx
    this.master = master
    this.noise = buf
    return ctx
  }

  private burst(freq: number, q: number, gain: number, decay: number, type: BiquadFilterType = 'bandpass') {
    const ctx = this.ctx
    if (!ctx || !this.master || !this.noise || !this.enabled) return
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const filter = ctx.createBiquadFilter()
    filter.type = type
    filter.frequency.value = freq
    filter.Q.value = q
    const g = ctx.createGain()
    const now = ctx.currentTime
    g.gain.setValueAtTime(gain, now)
    g.gain.exponentialRampToValueAtTime(0.0001, now + decay)
    src.connect(filter).connect(g).connect(this.master)
    src.start(now)
    src.stop(now + decay + 0.02)
  }

  private ping(freq: number, gain: number, decay: number) {
    const ctx = this.ctx
    if (!ctx || !this.master || !this.enabled) return
    const osc = ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = freq
    const g = ctx.createGain()
    const now = ctx.currentTime
    g.gain.setValueAtTime(gain, now)
    g.gain.exponentialRampToValueAtTime(0.0001, now + decay)
    osc.connect(g).connect(this.master)
    osc.start(now)
    osc.stop(now + decay + 0.02)
  }

  clack(strength = 1) {
    const s = Math.min(1.4, strength)
    this.burst(2600 + Math.random() * 900, 6, 0.35 * s, 0.09)
    this.ping(1400 + Math.random() * 500, 0.16 * s, 0.28)
    this.ping(2350 + Math.random() * 700, 0.09 * s, 0.18)
  }

  thud(strength = 1) {
    const s = Math.min(1.2, strength)
    this.burst(420, 1.2, 0.3 * s, 0.16, 'lowpass')
  }

  pop() {
    this.ping(320, 0.18, 0.16)
  }

  cheer() {
    this.ping(660, 0.16, 0.4)
    window.setTimeout(() => this.ping(880, 0.14, 0.45), 110)
    window.setTimeout(() => this.ping(1320, 0.12, 0.6), 220)
  }

  close() {
    if (this.ctx) void this.ctx.close()
    this.ctx = null
    this.master = null
    this.noise = null
  }
}
