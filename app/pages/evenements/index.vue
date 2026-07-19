<script setup lang="ts">
useSeoMeta({
  title: 'Événements · La Pétanque Fouesnantaise',
  description: 'Concours, animations et rendez-vous de La Pétanque Fouesnantaise.',
})
</script>

<template>
  <ContentList
    prefix="/evenements"
    eyebrow="Agenda"
    title="Événements"
    subtitle="Concours, animations et rendez-vous du club."
    layout="rows"
    empty="Les prochains événements seront annoncés ici."
  />
</template>
