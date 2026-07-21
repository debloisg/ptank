<script setup lang="ts">
// Sticky site header — built on Nuxt UI's <UHeader> (sticky bar, mobile
// slideover) + <UNavigationMenu> (automatic active-link highlighting).
const links = [
  { label: 'Accueil', to: '/', exact: true },
  { label: 'Actualités', to: '/actualites' },
  { label: 'Événements', to: '/evenements' },
  { label: 'Compétitions', to: '/competitions' },
  { label: 'Résultats', to: '/resultats' },
  { label: 'Le Club', to: '/a-propos' },
]
</script>

<template>
  <!-- The brand + 6 nav items + CTA don't fit at `lg`, so the inline nav only
       appears at `xl`; below that the slideover (hamburger) takes over. -->
  <UHeader
    mode="slideover"
    :ui="{
      center: '!hidden xl:!flex',
      toggle: 'lg:!inline-flex xl:!hidden',
      content: 'lg:!block xl:!hidden',
      overlay: 'lg:!block xl:!hidden',
    }"
  >
    <!-- Wordmark -->
    <template #left>
      <NuxtLink to="/" class="flex items-center gap-3 shrink-0">
        <span class="inline-flex items-center justify-center w-10 h-10 rounded-full bg-primary text-inverted font-serif font-semibold text-sm tracking-tight">
          PF
        </span>
        <span class="font-serif text-lg sm:text-xl font-semibold text-highlighted leading-none">
          La Pétanque<span class="hidden sm:inline"> Fouesnantaise</span>
        </span>
      </NuxtLink>
    </template>

    <!-- Desktop nav -->
    <UNavigationMenu :items="links" variant="link" />

    <!-- Adhérer CTA -->
    <template #right>
      <UButton
        to="/contact"
        color="secondary"
        class="rounded-full px-5 font-medium hidden sm:inline-flex"
        label="Adhérer"
      />
    </template>

    <!-- Mobile slideover -->
    <template #body>
      <UNavigationMenu :items="links" orientation="vertical" variant="link" class="-mx-2.5" />
      <UButton
        to="/contact"
        color="secondary"
        block
        class="rounded-full mt-6"
        label="Adhérer au club"
      />
    </template>
  </UHeader>
</template>
