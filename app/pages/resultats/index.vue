<script setup lang="ts">
useSeoMeta({
  title: 'Résultats · La Pétanque Fouesnantaise',
  description: 'Les résultats des concours et compétitions du club.',
})
</script>

<template>
  <ContentList
    prefix="/resultats"
    eyebrow="Palmarès"
    title="Résultats"
    subtitle="Classements et résultats des derniers concours."
    layout="cards"
    empty="Les résultats des concours seront publiés ici."
  />
</template>
