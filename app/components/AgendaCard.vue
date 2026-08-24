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
    class="group flex overflow-hidden rounded-2xl border border-default bg-elevated shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-accented"
  >
    <div class="flex min-w-0 flex-1 items-center gap-5 p-6">
      <div v-if="day" class="shrink-0 self-center text-center leading-none text-secondary">
        <div class="font-serif text-4xl font-bold">{{ day }}</div>
        <div class="mt-1.5 text-xs font-semibold uppercase tracking-wide">{{ month }}</div>
      </div>

      <div class="min-w-0 flex-1">
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
    </div>

    <!-- Full-height photo panel on the RIGHT, mirroring the "À la une" hero
         rows (UBlogPost horizontal, photo left): flush with the card edge,
         stretching the card's whole height. Only from `sm` up — on a phone
         the row is already narrow enough that a photo would squeeze the
         title into two words a line. object-cover so a portrait affiche and
         a landscape photo produce the same panel. -->
    <div v-if="image" class="relative hidden w-2/5 max-w-sm shrink-0 sm:block min-h-52">
      <NuxtImg
        :src="image"
        :alt="title ?? ''"
        loading="lazy"
        sizes="480px"
        :placeholder="imagePlaceholder(image)"
        placeholder-class="blur-lg"
        class="absolute inset-0 h-full w-full object-cover bg-muted"
      />
    </div>
  </NuxtLink>
</template>
