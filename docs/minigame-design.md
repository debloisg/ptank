# Pétanque Minigame « Le Boulodrome » — Technical Design

Status: validated with owner (concept, lib, route, entry, modes)
Date: 2026-08-24

## 1. Overview

A hidden pétanque minigame reachable by clicking the club logo in the footer
(bottom-left brand block of `AppFooter.vue`). It opens `/boulodrome`, a
side-view arcade pétanque game: pick an angle and power, the boule arcs
through the air, lands, rolls, and knocks other boules around. Playable
**vs the computer** or **vs a friend** (hot-seat, turn by turn on the same
screen). First to 13 points, real pétanque scoring.

Decisions already made with the owner:

- Concept: **side-view throw (angle + power)**, not top-down.
- Physics: **Planck.js** (pure-JS Box2D — quality contacts, CCD for fast
  boules, ~45 KB gz). No other new dependency.
- Route: **`/boulodrome`**.
- Entry: **plain click on the footer logo** — no gesture gimmick. Hidden
  only in the sense that nothing advertises it; noindex + out of sitemap.
- Modes: **vs AI** and **local 2-player hot-seat**. No online play.
- Visual design: carte blanche — aim for charming and fun (see §7).

Non-goals (v1): online multiplayer, server-side anything, 3D, leaderboards.

## 2. Entry point

`app/components/AppFooter.vue` — wrap the brand `<img src="/logo.webp">`
(line ~80) in `<NuxtLink to="/boulodrome" aria-label="Le boulodrome — jeu de
pétanque">`. The club-name text next to it stays a non-link; normal footer
behaviour otherwise unchanged.

## 3. Route & page

- `app/pages/boulodrome.vue`.
- SEO: `useSeoMeta({ robots: 'noindex, nofollow' })`; excluded from the
  sitemap via @nuxtjs/seo route rules.
- Page shell prerendered like the rest of the site; game is client-only:

```vue
<ClientOnly>
  <LazyBoulodromeGame />
  <template #fallback><p>Préparation du terrain…</p></template>
</ClientOnly>
```

- Default site layout (header/footer) so it still feels like the site; the
  playfield fills the content column, landscape-oriented canvas that
  letterboxes gracefully on portrait phones (fixed world aspect ~2.4:1,
  canvas scales to container width).
- All copy in French.

## 4. Architecture

```
app/
  pages/boulodrome.vue            — shell, SEO, ClientOnly
  components/boulodrome/
    BoulodromeGame.vue            — canvas mount, RAF loop, input, HUD glue
    BoulodromeHud.vue             — scoreboard, turn banner, boules left
    BoulodromeMenu.vue            — mode select (IA / 2 joueurs), rules modal
  utils/boulodrome/
    world.ts                      — Planck world setup: ground, walls, bodies
    throwing.ts                   — pure: (angle, power) → initial velocity
    turns.ts                      — pure: whose turn (pétanque alternation)
    scoring.ts                    — pure: end-of-mène scoring, game over
    ai.ts                         — pure: AI throw selection (seeded RNG)
    types.ts                      — GameState, Phase, Mode, PlayerId
```

- Planck.js is imported only inside `components/boulodrome/` /
  `utils/boulodrome/`, so it lands exclusively in the `/boulodrome` route
  chunk (automatic route-level code splitting) — zero cost to the rest of
  the site.
- Pure modules (`throwing`, `turns`, `scoring`, `ai`) have no DOM access;
  unit-tested under the existing `playwright.node.config.ts` runner.
  `world.ts` touches only Planck, also testable headless.
- `BoulodromeGame.vue` owns: Planck world stepping (fixed 60 Hz timestep,
  accumulator), rendering to canvas, pointer/keyboard input, and a small
  reactive mirror (`phase`, `scores`, `turn`, `boulesLeft`) for the HUD —
  per-frame data never goes through Vue reactivity.

### State machine

```
menu → cochonnet-thrown → aiming → charging → in-flight → settling
     ↘ settling → (next-throw | mène-scored) → aiming …
       mène-scored → (score < 13 ? new mène : game-over) → menu/replay
```

## 5. Gameplay

### World (side view)

- Ground: slightly bumpy static chain shape (procedural, seeded per mène) —
  gravel isn't flat, and small bumps make rolls interesting. Friction tuned
  so boules roll out over ~2–4 m, not forever.
- Left wall behind the thrower; right end of the lane is a low wooden
  backboard: a boule hitting it hard stays in play (like a real lane), but
  one flying over it is out (dead, removed with a puff).
- Cochonnet: small light circle body, thrown automatically at mène start to
  a randomized distance (6–10 m equivalent).
- Boules: circle bodies, dense, restitution low, friction high; **bullet
  (CCD) enabled** so full-power throws never tunnel.

### Throwing

- Two-step input, works with mouse, touch, and keyboard:
  1. **Aim**: drag up/down (or ←/→ arrows) to set angle; dotted preview
     shows only the first ~20 % of the arc — you aim, you don't get the
     landing spot for free.
  2. **Power**: hold (or hold Space) to charge an oscillating power bar,
     release to throw. Oscillation = skill element.
- High lob vs low roll both viable: lobbing over your opponent's boule
  ("plomber") vs rolling along the ground ("faire rouler"), and shooting
  directly at a boule ("tirer") — knock-outs work because collisions are
  real Box2D contacts.

### Turns, modes, scoring

- Modes chosen on the menu screen: **« Contre l'ordinateur »** or
  **« À deux sur cet écran »**.
- Hot-seat: the turn banner announces the player (« Aux boules, Joueur 2 ! »)
  with distinct boule colors; input is identical for both players. No
  pass-the-device blocking screen — everything is visible anyway.
- Real pétanque alternation: side farthest from the cochonnet throws next;
  3 boules per side (doublette simplification). Dead boules don't score.
- End of mène: closest side scores 1 point per boule closer than the
  opponent's best; first to 13 wins. Tie for closest → nobody scores
  (matches the real rule), replay the mène.
- AI (`ai.ts`): picks target distance near the cochonnet, converts through
  the same `throwing.ts` mapping the player uses, adds gaussian aim/power
  noise; when losing the mène with its last boules it attempts a direct
  shot at the best opposing boule. Pure `(state, rng) → {angle, power}`,
  deterministic with a seeded RNG for tests. One tuned difficulty in v1.

## 6. Rendering

- Single `<canvas>` scaled by `devicePixelRatio` (cap 2). World units are
  meters; one camera transform maps world → pixels. Slight camera pan
  follows the boule in flight, eases back after settling.
- Draw order: sky/backdrop → terrain → shadows (flattened ellipses under
  airborne boules — huge readability win for lob height) → cochonnet →
  boules → dust/impact particles → aim preview.
- HUD is DOM (Nuxt UI components), never canvas.

## 7. Art direction (carte blanche)

Goal: warm, sunny, a bit toy-like — "pétanque in Fouesnant on a July
evening", not a physics demo. All procedural (gradients, shapes, particles):
no image assets, nothing through R2 or @nuxt/image.

- Backdrop: layered flat-color silhouettes — warm sky gradient, distant
  Breton coastline, dark pine/plane-tree line, string of café fairy lights
  across the top. Subtle parallax with the camera pan.
- Terrain: sandy gravel band with speckle noise and thin darker line
  ("rake" texture); backboard in wood tones.
- Boules: radial-gradient steel with a specular dot; Player 1 warm stripe,
  Player 2 / AI cool stripe; cochonnet bright signal-orange for contrast.
- Juice: dust puff on landing, small screen shake on hard "tirer" hits,
  slow-motion + zoom for the final measuring moment of a close mène, a
  measuring-tape animation when scoring is tight, confetti at 13.
- Fixed palette (defined in one `palette.ts`), tuned to look right on the
  site's light and dark themes rather than reading CSS variables — the
  scene is illustrative, not themed UI. The DOM HUD uses normal Nuxt UI
  theming.
- `prefers-reduced-motion`: no shake, no slow-mo, no confetti; physics and
  gameplay unchanged.

## 8. Audio (small, optional)

A handful of synthesized sounds via Web Audio (no audio files): boule
"clack" (the iconic sound — filtered noise burst + metallic ping), soft
thud on gravel, crowd "ooh" on a successful shot. Muted by default until
the user enables sound (button in HUD); preference in `localStorage`.
If this proves fiddly, ship v1 silent — cut line, not a blocker.

## 9. Performance & footprint

- New dependency: `planck` only. Route chunk estimate: ~45 KB gz (planck)
  + ~15 KB game code; loaded only on `/boulodrome`.
- Fixed-timestep stepping; RAF paused when tab hidden
  (`visibilitychange`) and on the menu screen.
- ≤ ~10 dynamic bodies at once — trivial load for Box2D; low-end phones fine.
- Planck world destroyed on component unmount; no leaks across
  client-side navs.

## 10. Accessibility

- Full keyboard play (arrows = angle, Space hold/release = power) ships in
  v1 since the input model is already two discrete steps.
- Canvas gets `role="img"` + live `aria-label` summarizing state ("Mène 3,
  vous 5, ordinateur 3, 2 boules restantes"); turn/score announcements via
  an `aria-live` region in the HUD.
- HUD/menu are regular DOM — `nuxt-a11y` checks must stay green.
- Color is never the only distinction between sides: stripe patterns differ
  (rings vs cross-hatch) in addition to hue.

## 11. Testing

- Unit (`playwright.node.config.ts`):
  - `throwing.ts`: angle/power → velocity mapping bounds and monotonicity.
  - `turns.ts`: alternation incl. one side out of boules, dead boules.
  - `scoring.ts`: all closest-boule cases — multi-point mènes, ties,
    dead-boule exclusion, reaching 13.
  - `ai.ts`: seeded determinism; output always within legal angle/power.
  - `world.ts`: headless Planck sim — thrown boule settles in bounds;
    full-power throw doesn't tunnel (CCD regression test).
- E2E (Playwright): footer logo → `/boulodrome`; menu → pick mode → canvas
  mounts; scripted aim+throw flips a `data-phase` attribute; noindex meta
  present; route absent from generated sitemap; basic axe pass on the page.

## 12. Rollout

1. This document (branch `worktree-minigame`).
2. Skeleton: route, page, footer link, menu, empty canvas + loop.
3. Planck world + throwing input → first playable throw.
4. Turns + scoring + hot-seat mode → full 2-player game.
5. AI mode. 6. Art pass + juice. 7. Audio if cheap.
8. Tests green, `pnpm lint` + `pnpm typecheck` (dev server stopped first —
   known dev/build conflict).
9. PR to `main`; Cloudflare Workers Builds auto-deploys on merge.
