<script setup lang="ts">
// Editable hero (eyebrow, title, tagline, paragraph, stats, highlights)
// all live in content/index.md — non-coders edit them in Nuxt Studio.
const { data: home } = await useAsyncData('home', () =>
  queryCollection('content').path('/').first(),
)

const { data: events } = await useAsyncData('home-events', () =>
  queryCollection('content').where('path', 'LIKE', '/evenements/%').order('date', 'ASC').all(),
)
const { data: news } = await useAsyncData('home-news', () =>
  queryCollection('content').where('path', 'LIKE', '/actualites/%').order('date', 'DESC').all(),
)

const today = new Date().toISOString().slice(0, 10)
const upcoming = computed(() =>
  (events.value ?? []).filter(e => (e.date ?? '') >= today).slice(0, 4),
)
const latestNews = computed(() => (news.value ?? []).slice(0, 3))

useSeoMeta({
  title: 'La Pétanque Fouesnantaise · Club de pétanque à Fouesnant',
  description:
    'Un club convivial à Fouesnant (29) où l\'on joue à la pétanque toute l\'année, du débutant au licencié FFPJP.',
})
</script>

<template>
  <div>
    <!-- HERO + STATS share this wrapper so the card's negative margin never
         exposes the page canvas color in its side gutters. -->
    <div class="bg-default">
      <!-- ============ HERO ============ -->
      <section class="relative overflow-hidden">
        <img
          src="/images/hero-terrain.jpg"
          alt="Mouette avec un bandana du club sur un terrain de pétanque à Fouesnant"
          class="absolute inset-0 h-full w-full object-cover"
        >
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
              <UButton to="/contact" size="lg" color="secondary" class="rounded-full px-7" trailing-icon="i-lucide-arrow-right" label="Adhérer à l'association" />
              <UButton to="/evenements" size="lg" color="neutral" variant="outline" class="rounded-full px-7 border-white/70 bg-white/10 text-white backdrop-blur-sm hover:bg-white/20" label="Voir les concours" />
            </div>
          </div>
        </UContainer>
      </section>

      <!-- ============ STATS ============ -->
      <UContainer v-if="home?.stats?.length" class="relative -mt-16 sm:-mt-20">
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
        <div class="mb-8 flex items-end justify-between gap-4">
          <div>
            <p class="eyebrow mb-3">À la une</p>
            <h2 class="font-serif text-3xl sm:text-4xl font-semibold text-highlighted">Dernières nouvelles du boulodrome</h2>
          </div>
          <UButton to="/actualites" variant="link" color="primary" class="shrink-0" label="Toutes les actualités" trailing-icon="i-lucide-arrow-right" />
        </div>

        <UBlogPosts v-if="latestNews.length">
          <UBlogPost
            v-for="n in latestNews"
            :key="n.path"
            :to="n.path"
            :title="n.title"
            :description="n.description"
            :date="n.date"
            :image="n.image"
            :badge="n.category ? { label: n.category, color: 'secondary', variant: 'subtle' } : undefined"
          />
        </UBlogPosts>
        <p v-else class="text-muted">Pas encore d'actualité publiée.</p>
      </UContainer>
    </section>

    <!-- ============ PROCHAINS RENDEZ-VOUS ============ -->
    <UContainer class="py-16 sm:py-20">
      <div class="mb-8 flex items-end justify-between gap-4">
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
        <div class="grid gap-6 sm:grid-cols-3">
          <div
            v-for="h in home.highlights"
            :key="h.title"
            class="rounded-2xl border border-default bg-elevated p-6"
          >
            <h3 class="font-serif text-xl font-semibold text-highlighted">{{ h.title }}</h3>
            <p class="mt-2 text-sm text-toned">{{ h.description }}</p>
          </div>
        </div>
      </UContainer>
    </section>

    <!-- ============ PARTENAIRES ============ -->
    <section v-if="home?.partners?.length" class="border-b border-default">
      <UContainer class="py-16 sm:py-20">
        <p class="eyebrow mb-3 text-center">Ils nous soutiennent</p>
        <h2 class="font-serif text-3xl sm:text-4xl font-semibold text-highlighted mb-10 text-center">
          Nos partenaires
        </h2>
        <PartnersCarousel :partners="home.partners" />
      </UContainer>
    </section>

    <!-- ============ CTA ADHÉSION ============ -->
    <section class="bg-primary text-inverted">
      <UContainer class="py-16 text-center">
        <h2 class="font-serif text-3xl sm:text-4xl font-semibold">Envie de lancer quelques boules ?</h2>
        <p class="mx-auto mt-3 max-w-xl text-marine-100">
          Première séance d'essai gratuite. Débutant ou licencié, venez nous rencontrer sur les terrains.
        </p>
        <UButton to="/contact" size="lg" color="secondary" class="mt-7 rounded-full px-7" label="Nous rejoindre" trailing-icon="i-lucide-arrow-right" />
      </UContainer>
    </section>
  </div>
</template>
