<script setup lang="ts">
useSeoMeta({
  title: 'Compétitions · La Pétanque Fouesnantaise',
  description: 'Le calendrier des compétitions officielles du club.',
})
</script>

<template>
  <ContentList
    prefix="/competitions"
    eyebrow="Officiel FFPJP"
    title="Compétitions"
    subtitle="Championnats et concours officiels où le club est engagé."
    layout="rows"
    empty="Le calendrier des compétitions sera publié ici."
  />
</template>
