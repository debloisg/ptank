// Fixed illustrative palettes — deliberately NOT read from CSS variables. The
// scene is a little painting of the Breton coast; it should look the same
// whether the site is in light or dark mode. The DOM HUD on top uses the normal
// Nuxt UI theming.
//
// Two scenes exist and one is picked at random once per game (see
// `createBackdrop`): a July *evening* in Fouesnant (the original, untouched)
// and a bright summer *day* on the same shore, Glénan-turquoise water and all.
// Everything that belongs to the *objects* rather than to the light — boules,
// cochonnet, ink/paper of the measuring labels — is shared, so the two scenes
// stay the same game rather than two different games.

export type SceneKind = 'sunset' | 'day'

export interface SkyStop {
  at: number
  color: string
}

/** Everything a scene repaints. Both scenes must define the whole set. */
export interface ScenePalette {
  /** Which scene this is. Used as a cache key by the renderer's gradient store,
   *  so two palettes can never share a cached gradient. */
  id: SceneKind
  sky: readonly SkyStop[]
  sun: string
  sunGlow: string
  /** Transparent end of the sun's radial gradient — must match `sunGlow`'s hue. */
  sunGlowEdge: string
  /** Height above the horizon, as a fraction of the nominal view height. */
  sunY: number
  /** Disc radius and glow reach, same unit. Midday sun: small, high, hazier. */
  sunR: number
  sunGlowR: number

  cloud: string
  cloudHi: string
  /** Clouds are hazy wisps at sunset, opaque cotton at midday. */
  cloudAlpha: number
  /** Adds a third lobe so day clouds read as puffy cumulus. */
  cloudPuffy: boolean

  sea: string
  seaGlint: string
  hillsFar: string
  hillsNear: string
  treeLine: string
  treeHi: string
  treeRim: string

  sandTop: string
  sandMid: string
  sandLow: string
  sandRake: string
  speckleDark: string
  speckleLight: string
  /** Soft shadow under the gravel's lit edge, then the lit edge itself. */
  groundEdgeShade: string
  groundEdgeLight: string

  woodLight: string
  wood: string
  woodDark: string
  plankHi: string

  /** Café garland: fairy lights at sunset, Breton bunting by day. */
  garland: 'bulbs' | 'bunting'
  wire: string
  bulbs: readonly string[]
  /** Occasional non-Gwenn-ha-Du fanions in the bunting. */
  buntingAccents: readonly string[]

  lighthouseTower: string
  lighthouseBand: string
  lighthouseLantern: string
  /** Only the evening scene blinks; by day the lamp is just a dot. */
  lighthouseBlink: boolean

  boatHull: string
  boatSail: string

  /** Gwenn ha Du + its pole, tinted by the ambient light. */
  flagBlack: string
  flagWhite: string
  flagPole: string

  gullBody: string
  gullShade: string
  gullWing: string
  gullTip: string
  gullBeak: string
}

/** A July evening in Fouesnant. These values are the original palette, verbatim. */
const SUNSET: ScenePalette = {
  id: 'sunset',
  sky: [
    { at: 0, color: '#3f3277' },
    { at: 0.28, color: '#7b4a8c' },
    { at: 0.5, color: '#c9617c' },
    { at: 0.7, color: '#f2925c' },
    { at: 0.88, color: '#ffc880' },
    { at: 1, color: '#ffe6b4' },
  ],
  sun: '#fff5d6',
  sunGlow: 'rgba(255, 206, 130, 0.55)',
  sunGlowEdge: 'rgba(255, 190, 120, 0)',
  sunY: 0.24,
  sunR: 0.1,
  sunGlowR: 5,

  cloud: 'rgba(255, 205, 175, 0.45)',
  cloudHi: 'rgba(255, 235, 210, 0.55)',
  cloudAlpha: 0.55,
  cloudPuffy: false,

  sea: '#6a5a93',
  seaGlint: 'rgba(255, 222, 175, 0.5)',
  hillsFar: '#5b4d84',
  hillsNear: '#42386a',
  treeLine: '#27233f',
  treeHi: '#332d52',
  treeRim: 'rgba(255, 186, 128, 0.42)',

  sandTop: '#e9c78d',
  sandMid: '#d5a869',
  sandLow: '#b1834e',
  sandRake: 'rgba(140, 100, 60, 0.28)',
  speckleDark: '#8d6a44',
  speckleLight: '#f6e2ba',
  groundEdgeShade: 'rgba(120, 82, 45, 0.28)',
  groundEdgeLight: 'rgba(255, 236, 195, 0.75)',

  woodLight: '#a9713f',
  wood: '#8a5730',
  woodDark: '#5d3a1f',
  plankHi: 'rgba(255, 226, 180, 0.5)',

  garland: 'bulbs',
  wire: '#2a2438',
  bulbs: ['#ffd98a', '#ffb37a', '#fff0cf', '#ffc36b', '#ffe08f'],
  buntingAccents: ['#d8382f', '#2b5fb8'],

  lighthouseTower: '#efe4dd',
  lighthouseBand: '#8e2f3c',
  lighthouseLantern: '#ffe9a8',
  lighthouseBlink: true,

  boatHull: '#2a2440',
  boatSail: '#f6dcc4',

  flagBlack: '#1c1730',
  flagWhite: '#f2e6de',
  flagPole: '#4a3f5e',

  gullBody: '#f6e7dc',
  gullShade: '#a08fac',
  gullWing: '#dfcbd6',
  gullTip: '#372e4d',
  gullBeak: '#e8963a',
}

/** Late morning on the same shore: the Glénan look — turquoise water, hard light. */
const DAY: ScenePalette = {
  id: 'day',
  sky: [
    { at: 0, color: '#1c63b6' },
    { at: 0.3, color: '#3f8ed8' },
    { at: 0.56, color: '#74bcec' },
    { at: 0.76, color: '#a9dcf3' },
    { at: 0.9, color: '#d8f1f7' },
    { at: 1, color: '#f1fbf6' },
  ],
  sun: '#fffceb',
  sunGlow: 'rgba(255, 250, 205, 0.5)',
  sunGlowEdge: 'rgba(255, 248, 200, 0)',
  sunY: 0.46,
  sunR: 0.072,
  sunGlowR: 6.5,

  cloud: 'rgba(255, 255, 255, 0.9)',
  cloudHi: '#ffffff',
  cloudAlpha: 0.92,
  cloudPuffy: true,

  sea: '#17a099',
  seaGlint: 'rgba(255, 255, 255, 0.6)',
  hillsFar: '#8fb79c',
  hillsNear: '#5f8f6c',
  treeLine: '#2f5a3a',
  treeHi: '#42734a',
  treeRim: 'rgba(214, 244, 176, 0.45)',

  sandTop: '#f6e0b4',
  sandMid: '#e5c48d',
  sandLow: '#c69d64',
  sandRake: 'rgba(150, 115, 70, 0.22)',
  speckleDark: '#a8845c',
  speckleLight: '#fff6dd',
  groundEdgeShade: 'rgba(140, 104, 62, 0.22)',
  groundEdgeLight: 'rgba(255, 253, 238, 0.8)',

  woodLight: '#c69158',
  wood: '#a5733f',
  woodDark: '#6f4a26',
  plankHi: 'rgba(255, 246, 220, 0.6)',

  garland: 'bunting',
  wire: '#3b3a42',
  bulbs: ['#ffd98a', '#ffb37a', '#fff0cf', '#ffc36b', '#ffe08f'],
  buntingAccents: ['#d8382f', '#2b5fb8'],

  lighthouseTower: '#fbf8f2',
  lighthouseBand: '#c9342c',
  lighthouseLantern: '#ffe07a',
  lighthouseBlink: false,

  boatHull: '#26333f',
  boatSail: '#fdfbf4',

  flagBlack: '#141420',
  flagWhite: '#fbfaf4',
  flagPole: '#cfd6d2',

  gullBody: '#fdfdfb',
  gullShade: '#bcc8d2',
  gullWing: '#e8eef3',
  gullTip: '#39434f',
  gullBeak: '#f2a33c',
}

export const PALETTES: Record<SceneKind, ScenePalette> = {
  sunset: SUNSET,
  day: DAY,
}

/**
 * Scene-independent colours: the props, the HUD-adjacent tones and the little
 * bits of juice. Identical in both scenes on purpose — a boule is a boule, and
 * the measuring labels must stay legible whatever the sky is doing.
 */
export const PALETTE = {
  letterbox: '#1a1526',

  steelDark: '#4e5a68',
  steelMid: '#96a3b1',
  steelLight: '#e7eef5',
  boule1: '#e8763a', // Joueur 1 — warm copper stripe
  boule1Dark: '#a8481d',
  boule2: '#3fa3d6', // Joueur 2 / ordinateur — cool blue stripe
  boule2Dark: '#1d6a99',
  cochonnet: '#ff7a18',
  cochonnetHi: '#ffd39a',

  // Marinière + bachi worn by the first player's thrower. Bleu marine is a fixed
  // colour, not a scene colour: the jersey looks the same at dusk or at noon.
  marinWhite: '#f2ece0',
  marinNavy: '#1e3462',
  pompom: '#c8262c',

  grassEdge: '#5d6b3c',
  shadow: 'rgba(70, 45, 30, 0.28)',
  dust: 'rgba(232, 205, 160, 0.85)',
  spark: '#fff0c0',
  measure: 'rgba(255, 246, 220, 0.9)',

  // Confetti reuses the fairy-light tones; they read as festive in both scenes.
  bulbs: ['#ffd98a', '#ffb37a', '#fff0cf', '#ffc36b', '#ffe08f'],

  ink: '#241d33',
  paper: 'rgba(255, 247, 232, 0.94)',
} as const

export function playerColor(owner: 0 | 1): { stripe: string, stripeDark: string } {
  return owner === 0
    ? { stripe: PALETTE.boule1, stripeDark: PALETTE.boule1Dark }
    : { stripe: PALETTE.boule2, stripeDark: PALETTE.boule2Dark }
}
