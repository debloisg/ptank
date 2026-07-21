<script setup lang="ts">
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

// Official/club fixtures get a green badge, open-to-all/discovery events get the clay one.
const OFFICIAL_KEYWORDS = ['officiel', 'club', 'départemental', 'régional', 'national']
const badgeColor = computed(() =>
  OFFICIAL_KEYWORDS.some(k => props.category?.toLowerCase().includes(k)) ? 'success' : 'secondary',
)
</script>

<template>
  <NuxtLink
    :to="to"
    class="group flex items-start gap-5 rounded-2xl border border-default bg-elevated p-6 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-accented"
  >
    <div v-if="day" class="shrink-0 text-center leading-none">
      <div class="font-serif text-4xl font-bold text-secondary">{{ day }}</div>
      <div class="mt-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{{ month }}</div>
    </div>

    <div class="min-w-0 flex-1 pt-0.5">
      <div class="flex items-start justify-between gap-3">
        <h3 class="font-serif text-lg font-semibold leading-snug text-highlighted transition-colors group-hover:text-primary">
          {{ title }}
        </h3>
        <UBadge
          v-if="category"
          :color="badgeColor"
          variant="subtle"
          size="sm"
          class="shrink-0 rounded-full !text-[0.65rem] font-semibold uppercase tracking-wide"
        >
          {{ category }}
        </UBadge>
      </div>
      <p v-if="location" class="mt-1 text-sm text-muted">{{ location }}</p>
    </div>
  </NuxtLink>
</template>
