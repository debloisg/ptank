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
    <!-- ============ HERO ============ -->
    <section class="relative overflow-hidden bg-gradient-to-b from-clay-100/50 to-transparent">
      <!-- soft decorative blobs -->
      <div class="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-clay-200/40 blur-3xl" />
      <div class="pointer-events-none absolute -left-32 top-40 h-80 w-80 rounded-full bg-marine-200/40 blur-3xl" />

      <UContainer class="relative py-20 sm:py-28">
        <div class="max-w-3xl">
          <p class="eyebrow mb-5">
            {{ home?.eyebrow ?? 'Depuis 1978 · Fouesnant, Finistère' }}
          </p>
          <h1 class="font-serif text-5xl sm:text-7xl font-semibold leading-[1.02] tracking-tight text-highlighted">
            {{ home?.title ?? 'La Pétanque Fouesnantaise' }}
          </h1>
          <p v-if="home?.tagline" class="mt-5 text-xl font-medium text-secondary">
            {{ home.tagline }}
          </p>
          <p class="mt-5 max-w-2xl text-lg text-toned">
            {{ home?.description ?? 'Loisir, convivialité et compétition au bord de la mer.' }}
          </p>

          <div class="mt-9 flex flex-wrap gap-3">
            <UButton to="/contact" size="lg" color="secondary" class="rounded-full px-7" trailing-icon="i-lucide-arrow-right" label="Adhérer à l'association" />
            <UButton to="/evenements" size="lg" color="primary" variant="outline" class="rounded-full px-7" label="Voir les concours" />
          </div>

          <!-- Stats -->
          <div v-if="home?.stats?.length" class="mt-14 border-t border-accented pt-8">
            <dl class="flex flex-wrap gap-x-12 gap-y-6">
              <div v-for="stat in home.stats" :key="stat.label">
                <dt class="font-serif text-4xl font-semibold text-secondary">{{ stat.value }}</dt>
                <dd class="mt-1 text-sm text-muted">{{ stat.label }}</dd>
              </div>
            </dl>
          </div>
        </div>
      </UContainer>
    </section>

    <!-- ============ HIGHLIGHTS ============ -->
    <section v-if="home?.highlights?.length" class="bg-default border-y border-default">
      <UContainer class="py-16 sm:py-20">
        <p class="eyebrow mb-3">Qui sommes-nous</p>
        <h2 class="font-serif text-3xl sm:text-4xl font-semibold text-highlighted mb-10">
          Un club, trois terrains, mille parties
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

    <!-- ============ PROCHAINS RENDEZ-VOUS ============ -->
    <UContainer class="py-16 sm:py-20">
      <div class="mb-8 flex items-end justify-between gap-4">
        <div>
          <p class="eyebrow mb-3">Agenda</p>
          <h2 class="font-serif text-3xl sm:text-4xl font-semibold text-highlighted">Prochains rendez-vous</h2>
        </div>
        <UButton to="/evenements" variant="link" color="primary" class="shrink-0" label="Tout l'agenda" trailing-icon="i-lucide-arrow-right" />
      </div>

      <div v-if="upcoming.length" class="border-b border-default">
        <AgendaRow
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

    <!-- ============ DERNIÈRES ACTUALITÉS ============ -->
    <section class="bg-default border-t border-default">
      <UContainer class="py-16 sm:py-20">
        <div class="mb-8 flex items-end justify-between gap-4">
          <div>
            <p class="eyebrow mb-3">À la une</p>
            <h2 class="font-serif text-3xl sm:text-4xl font-semibold text-highlighted">Dernières actualités</h2>
          </div>
          <UButton to="/actualites" variant="link" color="primary" class="shrink-0" label="Toutes les actualités" trailing-icon="i-lucide-arrow-right" />
        </div>

        <div v-if="latestNews.length" class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <ArticleCard
            v-for="n in latestNews"
            :key="n.path"
            :to="n.path"
            :title="n.title"
            :description="n.description"
            :date="n.date"
            :image="n.image"
            :category="n.category"
          />
        </div>
        <p v-else class="text-muted">Pas encore d'actualité publiée.</p>
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
