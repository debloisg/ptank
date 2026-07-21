<script setup lang="ts">
// One row inside the agenda "list card" (see ContentList `rows` layout):
// a big clay day-number (matching AgendaCard), title + location, category badge.
const props = defineProps<{
  to: string
  title?: string
  date?: string
  location?: string
  category?: string
}>()

const day = computed(() => (props.date ? new Date(props.date).getDate() : null))
const month = computed(() =>
  props.date
    ? new Date(props.date)
        .toLocaleDateString('fr-FR', { month: 'short' })
        .replace('.', '')
        .toUpperCase()
    : null,
)

// Official/club fixtures → green badge; open/discovery events → clay.
const OFFICIAL_KEYWORDS = ['officiel', 'club', 'départemental', 'régional', 'national']
const badgeColor = computed(() =>
  OFFICIAL_KEYWORDS.some(k => props.category?.toLowerCase().includes(k)) ? 'success' : 'secondary',
)
</script>

<template>
  <NuxtLink
    :to="to"
    class="group flex items-center gap-4 sm:gap-6 px-5 sm:px-6 py-4 transition-colors duration-200 hover:bg-muted/60"
  >
    <div v-if="day" class="w-12 shrink-0 text-center leading-none">
      <div class="font-serif text-2xl font-bold text-secondary">{{ day }}</div>
      <div class="mt-1 text-[0.6rem] font-semibold uppercase tracking-wide text-muted">{{ month }}</div>
    </div>

    <div class="min-w-0 flex-1">
      <div class="font-medium text-highlighted transition-colors group-hover:text-primary">
        {{ title }}
      </div>
      <div v-if="location" class="mt-0.5 inline-flex items-center gap-1.5 text-sm text-muted">
        <UIcon name="i-lucide-map-pin" class="size-3.5 shrink-0" />{{ location }}
      </div>
    </div>

    <UBadge
      v-if="category"
      :color="badgeColor"
      variant="subtle"
      size="sm"
      class="shrink-0 rounded-full !text-[0.65rem] font-semibold uppercase tracking-wide"
    >
      {{ category }}
    </UBadge>

    <UIcon
      name="i-lucide-chevron-right"
      class="hidden sm:block size-5 shrink-0 text-dimmed transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-primary"
    />
  </NuxtLink>
</template>
