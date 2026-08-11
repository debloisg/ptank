<script setup lang="ts">
// One article row in the archive listings (/archives search results and
// /archives/[year]). Deliberately denser than AgendaRow: the archive shows
// hundreds of entries, so a row carries only what helps you decide whether to
// open it — period, title, category — and no image or excerpt.
const props = defineProps<{
  to: string
  title?: string
  date?: string
  category?: string
  // "YYYY-MM" on the monthly club journals, absent on one-off articles. When
  // present it's a better label than the publication date, because the issue's
  // period is what readers actually look for.
  journal?: string
  // Shown on search results, where rows from different years sit side by side.
  showYear?: boolean
  year?: number
}>()

const MONTHS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]

// The journal period. Some issues cover two months and the importer keeps that
// as "2015-07-08", so parse a list of month numbers rather than a single one.
const journalLabel = computed(() => {
  if (!props.journal) return null
  const [year, ...months] = props.journal.split('-')
  const names = months
    .map(m => MONTHS[Number(m) - 1])
    .filter((m): m is string => Boolean(m))
  return names.length ? `${names.join(' – ')} ${year}` : year ?? null
})

const formattedDate = computed(() =>
  props.date
    ? new Date(props.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
    : null,
)

// Journals are the club's own monthly newsletter — the spine of the archive, so
// they get the clay accent. Everything else stays neutral.
const isJournal = computed(() => Boolean(props.journal))
</script>

<template>
  <NuxtLink
    :to="to"
    class="group flex items-center gap-4 px-5 py-3.5 transition-colors duration-200 hover:bg-muted/60 sm:gap-5 sm:px-6"
  >
    <UIcon
      :name="isJournal ? 'i-lucide-newspaper' : 'i-lucide-file-text'"
      class="size-5 shrink-0 transition-colors"
      :class="isJournal ? 'text-secondary' : 'text-dimmed group-hover:text-primary'"
    />

    <div class="min-w-0 flex-1">
      <div class="truncate font-medium text-highlighted transition-colors group-hover:text-primary">
        {{ title }}
      </div>
      <div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
        <span v-if="journalLabel">{{ journalLabel }}</span>
        <template v-else-if="formattedDate">
          <span>{{ formattedDate }}</span>
        </template>
        <template v-if="category">
          <span class="text-dimmed">·</span>
          <span>{{ category }}</span>
        </template>
      </div>
    </div>

    <span
      v-if="showYear && year"
      class="shrink-0 font-serif text-sm font-semibold tabular-nums text-dimmed"
    >{{ year }}</span>

    <UIcon
      name="i-lucide-chevron-right"
      class="hidden size-4 shrink-0 text-dimmed transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-primary sm:block"
    />
  </NuxtLink>
</template>
