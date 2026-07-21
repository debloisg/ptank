<script setup lang="ts">
// Header text + display options are editable in Studio via content/competitions.md.
const { data: cfg } = await useAsyncData('competitions-cfg', () =>
  queryCollection('sections').path('/competitions').first(),
)

useSeoMeta({
  title: () => `${cfg.value?.title ?? 'Compétitions'} · La Pétanque Fouesnantaise`,
  description: () => cfg.value?.description ?? 'Le calendrier des compétitions officielles du club.',
})
</script>

<template>
  <ContentList
    prefix="/competitions"
    :eyebrow="cfg?.eyebrow ?? 'Officiel FFPJP'"
    :title="cfg?.title ?? 'Compétitions'"
    :subtitle="cfg?.description"
    layout="rows"
    empty="Le calendrier des compétitions sera publié ici."
  />
</template>
