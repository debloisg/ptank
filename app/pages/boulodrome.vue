<script setup lang="ts">
// Hidden pétanque minigame, reached only via the footer logo (see
// AppFooter.vue). Not linked from anywhere else in the site's nav — kept out
// of search entirely: noindex/nofollow meta below + sitemap.exclude in
// nuxt.config.ts.
//
// This page is only the shell + state machine (menu → playing). The actual
// game (Planck.js world, canvas, physics) lives in
// components/boulodrome/BoulodromeGame.vue and is mounted client-only, since
// it touches the DOM/canvas directly and has nothing to prerender.
type BoulodromeMode = 'ai' | 'hotseat'

useSeoMeta({
  title: 'Le Boulodrome',
  robots: 'noindex, nofollow',
})

const mode = ref<BoulodromeMode | null>(null)

// Warm the game chunk (Planck + renderer) as soon as the page is reached: the
// menu confetti reuses the game's own Effects, and the first « Jouer » click
// then starts instantly instead of waiting on the network.
onMounted(() => {
  import('~/components/boulodrome/BoulodromeGame.vue')
})
const playerNames = ref<[string, string]>(['', ''])

function onStart(picked: BoulodromeMode, names: [string, string]) {
  mode.value = picked
  playerNames.value = names
}

function backToMenu() {
  mode.value = null
}
</script>

<template>
  <UContainer class="py-12 sm:py-16">
    <BoulodromeMenu v-if="!mode" @start="onStart" />

    <ClientOnly v-else>
      <LazyBoulodromeGame :mode="mode" :player-names="playerNames" @quit="backToMenu" />
      <template #fallback>
        <p class="py-24 text-center font-serif text-lg text-muted">
          Préparation du terrain…
        </p>
      </template>
    </ClientOnly>
  </UContainer>
</template>
