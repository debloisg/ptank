<script setup lang="ts">
useSeoMeta({
  title: 'Actualités · La Pétanque Fouesnantaise',
  description: 'Toutes les actualités et nouvelles de La Pétanque Fouesnantaise.',
})
</script>

<template>
  <ContentList
    prefix="/actualites"
    eyebrow="La vie du club"
    title="Actualités"
    subtitle="Les dernières nouvelles de La Pétanque Fouesnantaise."
    layout="cards"
    empty="Les actualités publiées apparaîtront ici."
  />
</template>
