<script setup lang="ts">
// Branded error page. Nuxt renders THIS component instead of app.vue whenever
// an error escapes a page (404s from the catch-all's validate/queries included),
// so the shell — UApp locale, header, footer, page background — is reproduced
// here to keep dead inbound links inside the site instead of on Nuxt's unbranded
// fallback. /archives was imported from the old Joomla site, so stale external
// links are a permanent fact of life, not an edge case.
import type { NuxtError } from '#app'
import { fr } from '@nuxt/ui/locale'

const props = defineProps<{ error: NuxtError }>()

// Number(): the statusCode reaches this component as the string "404" when the
// error is thrown during SSR.
const is404 = computed(() => Number(props.error.statusCode) === 404)
const title = computed(() => (is404.value ? 'Page introuvable' : 'Une erreur est survenue'))

// robots meta: error pages must not advertise themselves as indexable. The
// X-Robots-Tag HEADER counterpart is set by server/plugins/error-robots.ts —
// it cannot be set from here, and useRobotsRule() CRASHES here: Nuxt renders
// this component under the internal /__nuxt_error path, which the robots
// module's context middleware skips (paths starting with /__), so the request
// context the composable writes to doesn't exist.
useSeoMeta({
  title: () => `${title.value} · Pétanque Fouesnantaise`,
  robots: 'noindex',
})

// clearError resets Nuxt's error state before leaving — a plain NuxtLink would
// navigate while the app is still flagged as errored.
function backHome() {
  clearError({ redirect: '/' })
}
</script>

<template>
  <UApp :locale="fr">
    <div class="min-h-screen flex flex-col bg-muted text-default">
      <AppHeader />
      <main class="flex-1">
        <UContainer class="py-24 sm:py-32 text-center">
          <p class="eyebrow mb-5">Erreur {{ error.statusCode }}</p>
          <h1 class="font-serif text-4xl sm:text-5xl font-semibold tracking-tight text-highlighted">
            {{ title }}
          </h1>
          <p class="mx-auto mt-4 max-w-xl text-muted">
            <template v-if="is404">
              Cette page n'existe pas ou n'existe plus. Le site a fait peau neuve en 2026 —
              certaines anciennes adresses ont changé, mais les archives sont toujours là.
            </template>
            <template v-else>
              Quelque chose s'est mal passé de notre côté. Réessayez dans un instant,
              ou revenez à l'accueil.
            </template>
          </p>
          <div class="mt-8 flex flex-wrap items-center justify-center gap-3">
            <UButton label="Retour à l'accueil" icon="i-lucide-home" size="lg" @click="backHome" />
            <UButton
              v-if="is404"
              label="Parcourir les archives"
              icon="i-lucide-archive"
              variant="outline"
              color="neutral"
              size="lg"
              to="/archives"
            />
          </div>
        </UContainer>
      </main>
      <AppFooter />
    </div>
  </UApp>
</template>
