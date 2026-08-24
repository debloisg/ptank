// Shared vocabulary for the hidden pétanque minigame (« Le Boulodrome »).
// Nothing here imports Planck: the pure rule modules (turns, scoring, ai) work
// on plain snapshots so they stay testable and cheap to reason about.

export type BoulodromeMode = 'ai' | 'hotseat'

/** 0 = Joueur 1 (the human on the left of the scoreboard), 1 = Joueur 2 / IA. */
export type PlayerId = 0 | 1

export type Phase =
  | 'cochonnet' // the cochonnet is in the air / rolling
  | 'aiming' // a side is choosing its angle
  | 'charging' // power bar oscillating, waiting for the release
  | 'flight' // a boule is in the air or still rolling
  | 'mene-end' // mène scored, showing the toast
  | 'game-over'

export interface Vec {
  x: number
  y: number
}

/** Everything the rule modules need to know about one boule. */
export interface BouleSnapshot {
  owner: PlayerId
  x: number
  y: number
  dead: boolean
}

export interface ThrowInput {
  /** Radians above the horizon. */
  angle: number
  /** 0..1, mapped to a launch speed by `throwing.ts`. */
  power: number
}

export const OTHER: Record<PlayerId, PlayerId> = { 0: 1, 1: 0 }
