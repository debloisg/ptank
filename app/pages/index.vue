<script setup lang="ts">
// Every editable string/asset on the homepage lives in content/index.md
// frontmatter — non-coders edit it in Nuxt Studio, including the hero style
// (photo vs native), the hero buttons and the closing call-to-action.
const { data: home } = await useAsyncData('home', () =>
  queryCollection('home').path('/').first(),
)

const { data: events } = await useAsyncData('home-events', () =>
  queryCollection('events').order('date', 'ASC').all(),
)
const { data: news } = await useAsyncData('home-news', () =>
  queryCollection('news').order('date', 'DESC').all(),
)

const today = new Date().toISOString().slice(0, 10)
const upcoming = computed(() =>
  (events.value ?? []).filter(e => (e.date ?? '') >= today).slice(0, 4),
)
const latestNews = computed(() => (news.value ?? []).slice(0, 3))

const heroStyle = computed(() => home.value?.heroStyle ?? 'photo')
const heroImage = computed(() => home.value?.image ?? '/images/hero-terrain.jpg')

// Hero buttons: editable in Studio; fall back to the two default CTAs.
const heroLinks = computed(() =>
  home.value?.links?.length
    ? home.value.links
    : [
        { label: "Adhérer à l'association", to: '/contact' },
        { label: 'Voir les concours', to: '/evenements' },
      ],
)
// Same links mapped to ButtonProps for the native <UPageHero> variant
// (brand styling by index: first = clay solid, rest = outline).
const heroButtons = computed(() =>
  heroLinks.value.map((l, i) => ({
    label: l.label,
    to: l.to,
    size: 'lg' as const,
    color: (i === 0 ? 'secondary' : 'neutral') as const,
    variant: (i === 0 ? 'solid' : 'outline') as const,
    trailingIcon: i === 0 ? 'i-lucide-arrow-right' : undefined,
    class: 'rounded-full px-7',
  })),
)

const ctaTitle = computed(() => home.value?.cta?.title ?? 'Envie de lancer quelques boules ?')
const ctaDescription = computed(
  () =>
    home.value?.cta?.description
    ?? "Première séance d'essai gratuite. Débutant ou licencié, venez nous rencontrer sur les terrains.",
)
const ctaLinks = [
  {
    label: 'Nous rejoindre',
    to: '/contact',
    color: 'secondary' as const,
    size: 'lg' as const,
    trailingIcon: 'i-lucide-arrow-right',
    class: 'rounded-full px-7',
  },
]

useSeoMeta({
  title: () => home.value?.title ?? 'La Pétanque Fouesnantaise · Club de pétanque à Fouesnant',
  description: () =>
    home.value?.description
    ?? "Un club convivial à Fouesnant (29) où l'on joue à la pétanque toute l'année, du débutant au licencié FFPJP.",
})
</script>

<template>
  <div>
    <!-- HERO + STATS share this wrapper so the photo hero's overlapping stats
         card never exposes the page canvas colour in its side gutters. -->
    <div class="bg-default">
      <!-- ============ HERO — native (heroStyle: native) ============ -->
      <UPageHero
        v-if="heroStyle === 'native'"
        orientation="horizontal"
        :headline="home?.eyebrow ?? 'Depuis 1982 · Fouesnant, Finistère'"
        :title="home?.title ?? 'La Pétanque Fouesnantaise'"
        :description="home?.tagline ?? home?.description"
        :links="heroButtons"
      >
        <NuxtImg
          :src="heroImage"
          alt="Terrain de pétanque à Fouesnant"
          format="auto"
          sizes="sm:100vw md:100vw lg:600px"
          loading="eager"
          fetchpriority="high"
          preload
          class="w-full rounded-2xl border border-default object-cover shadow-xl aspect-[4/3]"
        />
      </UPageHero>

      <!-- ============ HERO — photo (brand, default) ============ -->
      <section v-else class="relative overflow-hidden">
        <NuxtImg
          :src="heroImage"
          alt="Mouette avec un bandana du club sur un terrain de pétanque à Fouesnant"
          format="auto"
          sizes="sm:100vw md:100vw lg:100vw xl:100vw 2xl:100vw"
          loading="eager"
          fetchpriority="high"
          preload
          class="absolute inset-0 h-full w-full object-cover"
        />
        <div class="absolute inset-0 bg-gradient-to-t from-marine-950/85 via-marine-950/35 to-marine-950/10" />
        <div class="absolute inset-0 bg-gradient-to-r from-marine-950/80 via-marine-950/25 to-transparent" />

        <UContainer class="relative pt-20 sm:pt-28 pb-40 sm:pb-52">
          <div class="max-w-3xl">
            <p class="eyebrow mb-5 !text-clay-200">
              {{ home?.eyebrow ?? 'Depuis 1982 · Fouesnant, Finistère' }}
            </p>
            <h1 class="font-serif text-5xl sm:text-7xl font-semibold leading-[1.02] tracking-tight text-white">
              {{ home?.title ?? 'La Pétanque Fouesnantaise' }}
            </h1>
            <p v-if="home?.tagline" class="mt-5 text-xl font-medium text-clay-100">
              {{ home.tagline }}
            </p>
            <p class="mt-5 max-w-2xl text-lg text-white/80">
              {{ home?.description ?? 'Loisir, convivialité et compétition au bord de la mer.' }}
            </p>

            <div class="mt-9 flex flex-wrap gap-3">
              <UButton
                v-for="(l, i) in heroLinks"
                :key="i"
                :to="l.to"
                :label="l.label"
                size="lg"
                :color="i === 0 ? 'secondary' : 'neutral'"
                :variant="i === 0 ? 'solid' : 'outline'"
                :trailing-icon="i === 0 ? 'i-lucide-arrow-right' : undefined"
                :class="i === 0
                  ? 'rounded-full px-7'
                  : 'rounded-full px-7 border-white/70 bg-white/10 text-white backdrop-blur-sm hover:bg-white/20'"
              />
            </div>
          </div>
        </UContainer>
      </section>

      <!-- ============ STATS ============ -->
      <UContainer
        v-if="home?.stats?.length"
        :class="heroStyle === 'native' ? 'pb-4' : 'relative -mt-16 sm:-mt-20'"
      >
        <dl class="grid grid-cols-2 divide-x divide-y divide-default rounded-2xl border border-default bg-elevated shadow-xl sm:grid-cols-4 sm:divide-y-0">
          <div v-for="stat in home.stats" :key="stat.label" class="p-6 sm:p-8">
            <dt class="font-serif text-4xl font-semibold text-secondary">{{ stat.value }}</dt>
            <dd class="mt-1 text-sm uppercase tracking-wide text-muted">{{ stat.label }}</dd>
          </div>
        </dl>
      </UContainer>
    </div>

    <!-- ============ DERNIÈRES ACTUALITÉS ============ -->
    <section class="bg-default border-t border-default">
      <UContainer class="py-16 sm:py-20">
        <div class="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p class="eyebrow mb-3">À la une</p>
            <h2 class="font-serif text-3xl sm:text-4xl font-semibold text-highlighted">Dernières nouvelles du boulodrome</h2>
          </div>
          <UButton to="/actualites" variant="link" color="primary" class="shrink-0" label="Toutes les actualités" trailing-icon="i-lucide-arrow-right" />
        </div>

        <UBlogPosts v-if="latestNews.length" orientation="vertical" class="lg:gap-y-8">
          <PostCard
            v-for="n in latestNews"
            :key="n.path"
            :to="n.path"
            :title="n.title"
            :description="n.description"
            :date="n.date"
            :category="n.category"
            :image="n.image"
          />
        </UBlogPosts>
        <p v-else class="text-muted">Pas encore d'actualité publiée.</p>
      </UContainer>
    </section>

    <!-- ============ PROCHAINS RENDEZ-VOUS ============ -->
    <UContainer class="py-16 sm:py-20">
      <div class="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p class="eyebrow mb-3">Agenda</p>
          <h2 class="font-serif text-3xl sm:text-4xl font-semibold text-highlighted">Prochains rendez-vous</h2>
        </div>
        <UButton to="/evenements" variant="link" color="primary" class="shrink-0" label="Tout l'agenda" trailing-icon="i-lucide-arrow-right" />
      </div>

      <div v-if="upcoming.length" class="grid gap-5 sm:grid-cols-2">
        <AgendaCard
          v-for="e in upcoming"
          :key="e.path"
          :to="e.path"
          :title="e.title"
          :date="e.date"
          :location="e.location"
          :category="e.category"
        />
      </div>
      <p v-else class="text-muted">Aucun événement à venir pour le moment.</p>
    </UContainer>

    <!-- ============ HIGHLIGHTS ============ -->
    <section v-if="home?.highlights?.length" class="bg-default border-y border-default">
      <UContainer class="py-16 sm:py-20">
        <p class="eyebrow mb-3">Qui sommes-nous</p>
        <h2 class="font-serif text-3xl sm:text-4xl font-semibold text-highlighted mb-10">
          Un club, cent terrains, mille parties
        </h2>
        <UPageGrid>
          <UPageCard
            v-for="h in home.highlights"
            :key="h.title"
            :icon="h.icon"
            :title="h.title"
            :description="h.description"
          />
        </UPageGrid>
      </UContainer>
    </section>

    <!-- ============ PARTENAIRES (full-bleed carousel) ============ -->
    <section v-if="home?.partners?.length" class="border-b border-default py-16 sm:py-20">
      <UContainer>
        <p class="eyebrow mb-3 text-center">Ils nous soutiennent</p>
        <h2 class="font-serif text-3xl sm:text-4xl font-semibold text-highlighted mb-10 text-center">
          Nos partenaires
        </h2>
      </UContainer>
      <PartnersCarousel :partners="home.partners" />
    </section>

    <!-- ============ CTA ADHÉSION (full-bleed navy band) ============ -->
    <UPageCTA
      orientation="vertical"
      variant="solid"
      class="rounded-none"
      :ui="{ container: 'max-w-7xl mx-auto' }"
      :title="ctaTitle"
      :description="ctaDescription"
      :links="ctaLinks"
    />

    <!-- ============ OPEN SOURCE BANNER (just above footer) ============ -->
    <section class="border-t border-default bg-muted">
      <UContainer class="py-4">
        <p class="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-toned text-center">
          <span>🚀 Ce site est open source, les contributions sont bienvenues&nbsp;:</span>
          <a
            href="https://github.com/debloisg/ptank"
            target="_blank"
            rel="noopener"
            class="inline-flex items-center gap-1.5 font-medium text-highlighted hover:text-primary transition-colors"
          >
            debloisg/ptank
            <UIcon name="i-lucide-github" class="w-4 h-4" />
          </a>
        </p>
      </UContainer>
    </section>
  </div>
</template>
