<script setup lang="ts">
const props = defineProps<{
  to: string
  title?: string
  description?: string
  date?: string
  image?: string
  location?: string
  category?: string
}>()

const formattedDate = computed(() =>
  props.date
    ? new Date(props.date).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null,
)
</script>

<template>
  <NuxtLink
    :to="to"
    class="group flex h-full flex-col overflow-hidden rounded-2xl border border-default bg-elevated shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-accented"
  >
    <div v-if="image" class="aspect-[16/10] overflow-hidden">
      <img
        :src="image"
        :alt="title"
        class="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
      >
    </div>

    <div class="flex flex-1 flex-col p-6">
      <div class="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span v-if="category" class="eyebrow !text-[0.7rem]">{{ category }}</span>
        <span v-if="formattedDate" class="text-muted">{{ formattedDate }}</span>
      </div>

      <h3 class="font-serif text-xl font-semibold leading-snug text-highlighted transition-colors group-hover:text-primary">
        {{ title }}
      </h3>

      <p v-if="location" class="mt-1.5 inline-flex items-center gap-1.5 text-sm text-muted">
        <UIcon name="i-lucide-map-pin" class="h-3.5 w-3.5" />{{ location }}
      </p>

      <p v-if="description" class="mt-3 line-clamp-3 text-sm text-toned">
        {{ description }}
      </p>

      <span class="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-secondary">
        Lire la suite
        <UIcon name="i-lucide-arrow-right" class="h-4 w-4 transition group-hover:translate-x-0.5" />
      </span>
    </div>
  </NuxtLink>
</template>
