<script setup lang="ts">
// Header text + display options are editable in Studio via content/evenements.md.
const { data: cfg } = await useAsyncData('evenements-cfg', () =>
  queryCollection('sections').path('/evenements').first(),
)

useSeoMeta({
  title: () => `${cfg.value?.title ?? 'Événements'} · La Pétanque Fouesnantaise`,
  description: () =>
    cfg.value?.description ?? 'Concours, animations et rendez-vous de La Pétanque Fouesnantaise.',
})
</script>

<template>
  <ContentList
    prefix="/evenements"
    :eyebrow="cfg?.eyebrow ?? 'Agenda'"
    :title="cfg?.title ?? 'Événements'"
    :subtitle="cfg?.description"
    layout="rows"
    empty="Les prochains événements seront annoncés ici."
  />
</template>
