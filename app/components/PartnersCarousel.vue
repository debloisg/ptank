<script setup lang="ts">
defineProps<{
  partners: { name: string, logo: string, href?: string }[]
}>()
</script>

<template>
  <UCarousel
    v-slot="{ item }"
    :items="partners"
    loop
    arrows
    :autoplay="{ delay: 4000 }"
    :ui="{
      item: 'basis-1/2 sm:basis-1/4 lg:basis-1/6',
      container: 'items-stretch',
    }"
  >
    <a
      :href="item.href"
      target="_blank"
      rel="noopener noreferrer"
      :aria-label="item.name"
      class="flex h-24 items-center justify-center rounded-xl border border-default bg-elevated p-4 grayscale transition duration-200 hover:grayscale-0 hover:border-accented hover:shadow-sm"
    >
      <img :src="item.logo" :alt="item.name" class="max-h-14 w-auto object-contain">
    </a>
  </UCarousel>
</template>
