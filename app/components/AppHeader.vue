<script setup lang="ts">
const open = ref(false)
const route = useRoute()

const links = [
  { label: 'Accueil', to: '/' },
  { label: 'Actualités', to: '/actualites' },
  { label: 'Événements', to: '/evenements' },
  { label: 'Compétitions', to: '/competitions' },
  { label: 'Résultats', to: '/resultats' },
  { label: 'À propos', to: '/a-propos' },
]

const isActive = (to: string) =>
  to === '/' ? route.path === '/' : route.path.startsWith(to)

watch(() => route.path, () => (open.value = false))
</script>

<template>
  <header class="sticky top-0 z-50 border-b border-default bg-default/85 backdrop-blur">
    <UContainer class="flex items-center justify-between gap-4 h-18 py-3">
      <!-- Wordmark -->
      <NuxtLink to="/" class="flex items-center gap-3 shrink-0">
        <span
          class="inline-flex items-center justify-center w-10 h-10 rounded-full bg-primary text-inverted font-serif font-semibold text-sm tracking-tight"
        >
          PF
        </span>
        <span class="font-serif text-lg sm:text-xl font-semibold text-highlighted leading-none">
          La Pétanque<span class="hidden sm:inline"> Fouesnantaise</span>
        </span>
      </NuxtLink>

      <!-- Desktop nav -->
      <nav class="hidden lg:flex items-center gap-7 text-sm">
        <NuxtLink
          v-for="link in links"
          :key="link.to"
          :to="link.to"
          class="transition-colors"
          :class="isActive(link.to) ? 'text-highlighted font-medium' : 'text-toned hover:text-highlighted'"
        >
          {{ link.label }}
        </NuxtLink>
      </nav>

      <div class="flex items-center gap-2">
        <UButton
          to="/contact"
          color="secondary"
          class="rounded-full px-5 font-medium hidden sm:inline-flex"
          label="Adhérer"
        />
        <UButton
          class="lg:hidden"
          color="neutral"
          variant="ghost"
          size="lg"
          :icon="open ? 'i-lucide-x' : 'i-lucide-menu'"
          aria-label="Ouvrir le menu"
          @click="open = !open"
        />
      </div>
    </UContainer>

    <!-- Mobile menu -->
    <div v-if="open" class="lg:hidden border-t border-default bg-default">
      <UContainer class="py-3 flex flex-col">
        <NuxtLink
          v-for="link in links"
          :key="link.to"
          :to="link.to"
          class="py-2.5 border-b border-muted last:border-0 transition-colors"
          :class="isActive(link.to) ? 'text-highlighted font-medium' : 'text-toned'"
        >
          {{ link.label }}
        </NuxtLink>
        <UButton
          to="/contact"
          color="secondary"
          block
          class="rounded-full mt-3"
          label="Adhérer au club"
        />
      </UContainer>
    </div>
  </header>
</template>
