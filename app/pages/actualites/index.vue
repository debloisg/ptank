<script setup lang="ts">
// The listing config (title, intro, layout) lives in content/actualites.md so
// non-coders can edit it — including the list orientation — from Nuxt Studio.
const { data: cfg } = await useAsyncData('actualites-cfg', () =>
  queryCollection('content').path('/actualites').first(),
)

useSeoMeta({
  title: () => `${cfg.value?.title ?? 'Actualités'} · La Pétanque Fouesnantaise`,
  description: () =>
    cfg.value?.description ?? 'Toutes les actualités et nouvelles de La Pétanque Fouesnantaise.',
})
</script>

<template>
  <ContentList
    prefix="/actualites"
    :eyebrow="cfg?.eyebrow ?? 'La vie du club'"
    :title="cfg?.title ?? 'Actualités'"
    :subtitle="cfg?.description"
    :orientation="cfg?.orientation ?? 'horizontal'"
    empty="Les actualités publiées apparaîtront ici."
  />
</template>
