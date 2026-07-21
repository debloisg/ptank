<script setup lang="ts">
const year = new Date().getFullYear()

const nav = [
  { label: 'Actualités', to: '/actualites' },
  { label: 'Événements', to: '/evenements' },
  { label: 'Compétitions', to: '/competitions' },
  { label: 'Résultats', to: '/resultats' },
  { label: 'Le Club', to: '/a-propos' },
  { label: 'Contact & Adhésion', to: '/contact' },
]
</script>

<template>
  <footer class="border-t border-default bg-default">
    <UContainer class="py-14 grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
      <div class="lg:col-span-1">
        <div class="flex items-center gap-3 mb-4">
          <span class="inline-flex items-center justify-center w-9 h-9 rounded-full bg-primary text-inverted font-serif text-xs font-semibold">
            PF
          </span>
          <span class="font-serif text-lg font-semibold text-highlighted">La Pétanque Fouesnantaise</span>
        </div>
        <p class="text-sm text-muted max-w-xs">
          Un club convivial à deux pas des plages de Fouesnant, où l'on joue à la pétanque toute
          l'année, du débutant au licencié FFPJP.
        </p>
      </div>

      <div>
        <p class="eyebrow mb-4">Le club</p>
        <ul class="space-y-2 text-sm">
          <li v-for="link in nav" :key="link.to">
            <NuxtLink :to="link.to" class="text-toned hover:text-highlighted transition-colors">
              {{ link.label }}
            </NuxtLink>
          </li>
        </ul>
      </div>

      <div>
        <p class="eyebrow mb-4">Nous trouver</p>
        <ul class="space-y-3 text-sm text-toned">
          <li class="flex items-start gap-2.5">
            <UIcon name="i-lucide-map-pin" class="w-4 h-4 mt-0.5 shrink-0 text-primary" />
            Allée de Loc'Hilaire, 29170 Fouesnant
          </li>
          <li class="flex items-center gap-2.5">
            <UIcon name="i-lucide-mail" class="w-4 h-4 shrink-0 text-primary" />
            <a href="mailto:contact@petanque-fouesnantaise.fr" class="hover:text-highlighted">
              contact@petanque-fouesnantaise.fr
            </a>
          </li>
        </ul>
      </div>
    </UContainer>

    <div class="border-t border-muted">
      <UContainer class="py-5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted">
        <span>Association de pétanque de Fouesnant · Finistère Sud</span>
        <span>© {{ year }} La Pétanque Fouesnantaise · Tous droits réservés</span>
      </UContainer>
    </div>
  </footer>
</template>
