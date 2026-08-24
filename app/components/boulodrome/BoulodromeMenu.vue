<script setup lang="ts">
// Intro screen for /boulodrome: mode pick + rules. No game logic here — this
// is pure DOM/Nuxt UI, the emitted `start` event is the only thing the parent
// page (app/pages/boulodrome.vue) needs to know about.
const emit = defineEmits<{
  start: [mode: 'ai' | 'hotseat']
}>()

const rulesOpen = ref(false)
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

    <div class="mt-10 grid gap-4 sm:grid-cols-2">
      <button
        type="button"
        class="group flex flex-col items-center gap-3 rounded-2xl border border-default bg-default p-6 text-center transition hover:-translate-y-0.5 hover:border-primary hover:shadow-lg"
        @click="emit('start', 'ai')"
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
        @click="emit('start', 'hotseat')"
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
