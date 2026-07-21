<script setup lang="ts">
// Header text + display options are editable in Studio via content/resultats.md.
const { data: cfg } = await useAsyncData('resultats-cfg', () =>
  queryCollection('sections').path('/resultats').first(),
)

useSeoMeta({
  title: () => `${cfg.value?.title ?? 'Résultats'} · La Pétanque Fouesnantaise`,
  description: () => cfg.value?.description ?? 'Les résultats des concours et compétitions du club.',
})
</script>

<template>
  <ContentList
    prefix="/resultats"
    :eyebrow="cfg?.eyebrow ?? 'Palmarès'"
    :title="cfg?.title ?? 'Résultats'"
    :subtitle="cfg?.description"
    layout="cards"
    :orientation="cfg?.orientation ?? 'horizontal'"
    empty="Les résultats des concours seront publiés ici."
  />
</template>
