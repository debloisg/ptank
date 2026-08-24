<script setup lang="ts">
// Intro screen for /boulodrome: mode pick + rules. No game logic here — this
// is pure DOM/Nuxt UI, the emitted `start` event is the only thing the parent
// page (app/pages/boulodrome.vue) needs to know about.
import { Effects } from '~/utils/boulodrome/effects'

const emit = defineEmits<{
  start: [mode: 'ai' | 'hotseat', names: [string, string]]
}>()

const rulesOpen = ref(false)

// Naming step: pick a mode first, then name the player(s) before starting.
// Defaults are drawn from famous pirates/corsairs — Breton flavour welcome —
// and each input keeps its own re-rollable default so an emptied field falls
// back to something better than a bare "Joueur 1".
const PIRATES = [
  'Surcouf',
  'Barbe Rouge',
  'Barbe Noire',
  'La Buse',
  'Rackham le Rouge',
  'Anne Bonny',
  'Mary Read',
  'Duguay-Trouin',
  'Jean Bart',
  'L’Olonnais',
]
const NAME_MAX = 16

function randomPirate(exclude?: string) {
  const pool = exclude ? PIRATES.filter(n => n !== exclude) : PIRATES
  return pool[Math.floor(Math.random() * pool.length)]!
}

const step = ref<'choose' | 'name'>('choose')
const pendingMode = ref<'ai' | 'hotseat' | null>(null)
const p1Default = ref('')
const p2Default = ref('')
const p1Name = ref('')
const p2Name = ref('')

function pickMode(picked: 'ai' | 'hotseat') {
  pendingMode.value = picked
  p1Default.value = randomPirate()
  p2Default.value = picked === 'hotseat' ? randomPirate(p1Default.value) : ''
  p1Name.value = p1Default.value
  p2Name.value = p2Default.value
  step.value = 'name'
}

function rerollP1() {
  p1Default.value = randomPirate(pendingMode.value === 'hotseat' ? p2Default.value : undefined)
  p1Name.value = p1Default.value
}

function rerollP2() {
  p2Default.value = randomPirate(p1Default.value)
  p2Name.value = p2Default.value
}

function backToChoose() {
  step.value = 'choose'
  pendingMode.value = null
}

function cleanName(name: string, fallback: string) {
  const trimmed = name.trim().slice(0, NAME_MAX)
  return trimmed || fallback
}

function confirmStart() {
  const mode = pendingMode.value
  if (!mode) return
  const n1 = cleanName(p1Name.value, p1Default.value)
  const n2 = mode === 'hotseat' ? cleanName(p2Name.value, p2Default.value) : ''
  emit('start', mode, [n1, n2])
}

// ----------------------------------------------------------- welcome confetti
// One burst falling from the top bar on arrival, using the game's own Effects
// system (the game chunk is warmed by the page on mount) so the pieces are the
// exact confetti seen at a game win — not a lookalike. A throwaway overlay
// canvas maps world metres to pixels; torn down as soon as the last piece dies.
const CONFETTI_SCALE = 90 // px per world metre

let confettiCanvas: HTMLCanvasElement | null = null
let confettiRaf = 0

function launchConfetti() {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

  const canvas = document.createElement('canvas')
  // z below the sticky header (z-50): the pieces spawn in the header band and
  // fall out from underneath it, as if they had been tucked up there all along.
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:40;'
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  canvas.width = Math.round(window.innerWidth * dpr)
  canvas.height = Math.round(window.innerHeight * dpr)
  document.body.appendChild(canvas)
  confettiCanvas = canvas
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.scale(dpr, dpr)

  const w = window.innerWidth
  const h = window.innerHeight
  const effects = new Effects(false)
  // World frame: y up, ground at 0. Spawn at the header's bottom edge and
  // upward, so every piece starts hidden behind the bar.
  const headerBottom = document.querySelector('header')?.getBoundingClientRect().bottom ?? 72
  effects.confetti(0, w / CONFETTI_SCALE, (h - headerBottom) / CONFETTI_SCALE)

  let last = performance.now()
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    effects.update(dt)
    ctx.clearRect(0, 0, w, h)
    for (const p of effects.particles) {
      const t = p.life / p.maxLife
      ctx.globalAlpha = Math.min(1, (1 - t) * 2.2)
      ctx.fillStyle = p.color
      ctx.save()
      ctx.translate(p.x * CONFETTI_SCALE, h - p.y * CONFETTI_SCALE)
      ctx.rotate(p.angle)
      const s = p.r * CONFETTI_SCALE
      ctx.fillRect(-s * 0.5, -s * 0.35, s, s * 0.7)
      ctx.restore()
    }
    ctx.globalAlpha = 1
    if (effects.particles.length > 0) confettiRaf = window.requestAnimationFrame(frame)
    else stopConfetti()
  }
  confettiRaf = window.requestAnimationFrame(frame)
}

function stopConfetti() {
  if (confettiRaf) window.cancelAnimationFrame(confettiRaf)
  confettiRaf = 0
  confettiCanvas?.remove()
  confettiCanvas = null
}

onMounted(launchConfetti)
onBeforeUnmount(stopConfetti)

</script>

<template>
  <div class="mx-auto max-w-2xl text-center">
    <p class="eyebrow">Jeu secret du club</p>
    <h1 class="mt-2 font-serif text-4xl font-semibold text-highlighted sm:text-5xl">
      Le Boulodrome
    </h1>
    <p class="mx-auto mt-4 max-w-lg text-balance text-muted">
      Vous avez trouvé le boulodrome caché du site. Un cochonnet, trois boules,
      une petite brise de Fouesnant — à vous de jouer, en solo contre
      l'ordinateur ou à deux sur le même écran.
    </p>
    <p class="mt-2 text-xs italic text-muted/70 sm:text-sm">
      Chut… ce coin du site est un petit secret entre nous : gardez-le pour
      les amis du club.
    </p>

    <div v-if="step === 'choose'" class="mt-10 grid gap-4 sm:grid-cols-2">
      <button
        type="button"
        class="group flex flex-col items-center gap-3 rounded-2xl border border-default bg-default p-6 text-center transition hover:-translate-y-0.5 hover:border-primary hover:shadow-lg"
        @click="pickMode('ai')"
      >
        <span
          class="flex size-14 items-center justify-center rounded-full bg-primary/10 text-3xl transition group-hover:bg-primary/15"
        >
          🤖
        </span>
        <span class="font-serif text-lg font-semibold text-highlighted">Contre l'ordinateur</span>
        <span class="text-sm text-muted">Affrontez le pointeur du club, seul face au cochonnet.</span>
      </button>

      <button
        type="button"
        class="group flex flex-col items-center gap-3 rounded-2xl border border-default bg-default p-6 text-center transition hover:-translate-y-0.5 hover:border-primary hover:shadow-lg"
        @click="pickMode('hotseat')"
      >
        <span
          class="flex size-14 items-center justify-center rounded-full bg-secondary/10 text-3xl transition group-hover:bg-secondary/15"
        >
          🎏
        </span>
        <span class="font-serif text-lg font-semibold text-highlighted">À deux sur cet écran</span>
        <span class="text-sm text-muted">Chacun son tour, même écran — comme sur le terrain.</span>
      </button>
    </div>

    <!-- Naming step: one input vs the computer, two in hotseat -->
    <div v-else class="mt-10">
      <p class="font-serif text-lg font-semibold text-highlighted">
        {{ pendingMode === 'ai' ? 'À qui l’honneur ?' : 'Deux noms pour la partie' }}
      </p>
      <p class="mx-auto mt-1 max-w-sm text-sm text-muted">
        Un nom de flibustier par défaut — changez-le ou lancez les dés pour un autre.
      </p>

      <div class="mx-auto mt-5 flex max-w-sm flex-col gap-3">
        <div class="flex items-center gap-2">
          <UInput
            v-model="p1Name"
            :maxlength="NAME_MAX"
            size="lg"
            placeholder="Votre nom"
            class="flex-1"
            @keyup.enter="confirmStart"
          />
          <UButton
            icon="i-lucide-dices"
            color="neutral"
            variant="ghost"
            aria-label="Autre nom"
            @click="rerollP1"
          />
        </div>

        <div v-if="pendingMode === 'hotseat'" class="flex items-center gap-2">
          <UInput
            v-model="p2Name"
            :maxlength="NAME_MAX"
            size="lg"
            placeholder="Second joueur"
            class="flex-1"
            @keyup.enter="confirmStart"
          />
          <UButton
            icon="i-lucide-dices"
            color="neutral"
            variant="ghost"
            aria-label="Autre nom"
            @click="rerollP2"
          />
        </div>
      </div>

      <div class="mt-6 flex items-center justify-center gap-3">
        <UButton color="neutral" variant="ghost" icon="i-lucide-arrow-left" label="Retour" @click="backToChoose" />
        <UButton color="primary" icon="i-lucide-play" label="Jouer" @click="confirmStart" />
      </div>
    </div>

    <UButton
      color="neutral"
      variant="ghost"
      icon="i-lucide-circle-help"
      label="Comment jouer ?"
      class="mt-8"
      @click="rulesOpen = true"
    />

    <UModal v-model:open="rulesOpen" title="Comment jouer ?" description="Les règles du Boulodrome">
      <template #body>
        <div class="space-y-4 text-left text-sm text-default">
          <p>
            <span class="font-semibold text-highlighted">1. Viser —</span>
            faites glisser vers le haut/bas (ou les flèches ↑ / ↓) pour régler
            l'angle de tir. Un pointillé indique le tout début de la trajectoire :
            à vous de deviner la suite.
          </p>
          <p>
            <span class="font-semibold text-highlighted">2. Charger —</span>
            maintenez le clic (ou la barre d'espace) pour faire osciller la
            jauge de puissance, relâchez au bon moment pour lancer. Un peu de
            timing, comme au vrai tir.
          </p>
          <p>
            <span class="font-semibold text-highlighted">3. Pointer, tirer, plomber —</span>
            faites rouler la boule tout en douceur pour vous approcher du
            cochonnet, envoyez-la haut pour la faire atterrir dessus
            (« plomber »), ou visez directement une boule adverse pour la
            déloger (« tirer »).
          </p>
          <p>
            <span class="font-semibold text-highlighted">Le score —</span>
            à la fin de chaque mène, l'équipe la plus proche du cochonnet
            marque un point par boule mieux placée que la meilleure boule
            adverse. Premier à 13 points, la partie est gagnée !
          </p>
        </div>
      </template>
      <template #footer="{ close }">
        <UButton color="primary" label="Compris, à moi de jouer" block @click="close" />
      </template>
    </UModal>
  </div>
</template>
