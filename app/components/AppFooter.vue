<script setup lang="ts">
import type { FooterColumn } from '@nuxt/ui'

// Site footer: a single <UFooterColumns> section (brand block in #left, link
// columns from `columns`) rendered inside the footer's container slot.
const columns: FooterColumn[] = [
  {
    label: 'Le club',
    children: [
      { label: 'Le Club', to: '/a-propos' },
      { label: 'Contact & Adhésion', to: '/contact' },
      { label: 'Actualités', to: '/actualites' },
    ],
  },
  {
    label: 'Agenda & résultats',
    children: [
      { label: 'Événements', to: '/evenements' },
      { label: 'Compétitions', to: '/competitions' },
      { label: 'Résultats', to: '/resultats' },
    ],
  },
  {
    label: 'Archives',
    children: [
      { label: 'Journaux & articles', to: '/archives' },
      { label: 'Galerie photos', to: '/archives/galerie' },
    ],
  },
  {
    label: 'Nous trouver',
    children: [
      {
        label: "Allée de Loc'Hilaire, 29170 Fouesnant",
        icon: 'i-lucide-map-pin',
        to: '/contact',
      },
      {
        label: 'contact@petanque-fouesnantaise.fr',
        icon: 'i-lucide-mail',
        to: 'mailto:contact@petanque-fouesnantaise.fr',
      },
    ],
  },
  {
    label: 'Informations',
    children: [
      { label: 'Mentions légales', to: '/mentions-legales' },
      { label: 'Confidentialité', to: '/confidentialite' },
    ],
  },
]
</script>

<template>
  <UFooter
    class="border-t border-default bg-default"
    :ui="{ container: 'block py-8 lg:py-12', center: 'block w-full mt-0' }"
  >
    <UFooterColumns
      :columns="columns"
      :ui="{
        // 5 link columns instead of the theme's default 2 → give the link grid
        // 4 of 5 tracks, brand block keeps 1.
        root: 'xl:grid-cols-5',
        center: 'xl:col-span-4',
        label: 'eyebrow',
        // Theme default (mt-6 space-y-4) makes the tallest column tower over
        // the shortest ones; tighter rows keep the columns close in height.
        list: 'mt-4 space-y-2.5',
        link: 'items-start',
        // The address label is longer than its column: let it wrap instead of
        // being clipped by the theme's default `truncate`.
        linkLabel: 'text-clip whitespace-normal',
        linkLeadingIcon: 'size-4 shrink-0 mt-0.5 text-primary',
      }"
    >
      <template #left>
        <div class="flex items-center gap-3 mb-4">
          <NuxtLink to="/boulodrome" aria-label="Le boulodrome — jeu de pétanque" :prefetch="false">
            <img
              src="/logo.webp"
              alt="Pétanque Fouesnantaise"
              width="36"
              height="36"
              class="w-9 h-9 shrink-0"
            >
          </NuxtLink>
          <span class="font-serif text-lg font-semibold text-highlighted">Pétanque Fouesnantaise</span>
        </div>
        <p class="text-sm text-muted max-w-xs">
          Un club convivial à deux pas des plages de Fouesnant, où l'on joue à la pétanque toute
          l'année, du débutant au licencié FFPJP.
        </p>
      </template>
    </UFooterColumns>
  </UFooter>
</template>
