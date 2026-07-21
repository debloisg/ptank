<script setup lang="ts">
const props = defineProps<{
  partners: { name: string, logo: string, href?: string }[]
}>()

// Repeat the list until it comfortably fills the track, so the infinite loop
// always looks continuous even with only a handful of partners.
const items = computed(() => {
  const p = props.partners ?? []
  if (!p.length) return []
  let out = [...p]
  while (out.length < 12) out = out.concat(p)
  return out
})
</script>

<template>
  <!-- Full-bleed carousel; arrows sit on top and fade in on hover. -->
  <UCarousel
    v-slot="{ item }"
    :items="items"
    loop
    arrows
    :autoplay="{ delay: 3500 }"
    class="group"
    :prev="{ color: 'neutral', variant: 'solid' }"
    :next="{ color: 'neutral', variant: 'solid' }"
    :ui="{
      item: 'basis-1/2 sm:basis-1/4 lg:basis-1/6',
      container: 'items-stretch',
      prev: 'start-4 sm:start-4 shadow-md opacity-0 transition-opacity group-hover:opacity-100',
      next: 'end-4 sm:end-4 shadow-md opacity-0 transition-opacity group-hover:opacity-100',
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
