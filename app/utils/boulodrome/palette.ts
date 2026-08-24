// Fixed illustrative palette — deliberately NOT read from CSS variables. The
// scene is a little painting of a July evening in Fouesnant; it should look the
// same whether the site is in light or dark mode. The DOM HUD on top uses the
// normal Nuxt UI theming.

export const PALETTE = {
  letterbox: '#1a1526',

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
  cloud: 'rgba(255, 205, 175, 0.45)',
  cloudHi: 'rgba(255, 235, 210, 0.55)',

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
  grassEdge: '#5d6b3c',

  woodLight: '#a9713f',
  wood: '#8a5730',
  woodDark: '#5d3a1f',

  steelDark: '#4e5a68',
  steelMid: '#96a3b1',
  steelLight: '#e7eef5',
  boule1: '#e8763a', // Joueur 1 — warm copper stripe
  boule1Dark: '#a8481d',
  boule2: '#3fa3d6', // Joueur 2 / ordinateur — cool blue stripe
  boule2Dark: '#1d6a99',
  cochonnet: '#ff7a18',
  cochonnetHi: '#ffd39a',

  shadow: 'rgba(70, 45, 30, 0.28)',
  dust: 'rgba(232, 205, 160, 0.85)',
  spark: '#fff0c0',
  measure: 'rgba(255, 246, 220, 0.9)',

  wire: '#2a2438',
  bulbs: ['#ffd98a', '#ffb37a', '#fff0cf', '#ffc36b', '#ffe08f'],

  ink: '#241d33',
  paper: 'rgba(255, 247, 232, 0.94)',
} as const

export function playerColor(owner: 0 | 1): { stripe: string, stripeDark: string } {
  return owner === 0
    ? { stripe: PALETTE.boule1, stripeDark: PALETTE.boule1Dark }
    : { stripe: PALETTE.boule2, stripeDark: PALETTE.boule2Dark }
}
