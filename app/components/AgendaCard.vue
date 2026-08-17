<script setup lang="ts">
// Homepage agenda row — the mirror image of PostCard (the "À la une" news row):
// same card box, same reading rhythm, but the photo sits on the RIGHT and the
// date leads on the left in the brand colour. An event is answered by "when?"
// first, so the day/month block is the anchor; a news item is answered by
// "what?", so its photo leads. Keeping the two rows otherwise identical is what
// makes the homepage read as one list of club life rather than two widgets.
const props = defineProps<{
  to: string
  title?: string
  description?: string
  date?: string
  location?: string
  category?: string
  image?: string
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
      <div class="font-serif text-4xl font-bold text-primary">{{ day }}</div>
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
      <p v-if="description" class="mt-2 line-clamp-2 text-sm text-toned">{{ description }}</p>
    </div>

    <!-- Right-hand thumbnail, and only from `sm` up: on a phone the row is
         already narrow enough that a photo would squeeze the title into two
         words a line. Fixed box + object-cover so a portrait affiche and a
         landscape photo produce the same row height. -->
    <NuxtImg
      v-if="image"
      :src="image"
      :alt="title ?? ''"
      loading="lazy"
      sizes="200px"
      :placeholder="imagePlaceholder(image)"
      placeholder-class="blur-lg"
      class="hidden sm:block shrink-0 w-28 h-28 rounded-xl object-cover bg-muted"
    />
  </NuxtLink>
</template>
