<script setup lang="ts">
// French locale drives Nuxt UI's built-in date formatting (UBlogPost `date`),
// pagination labels, aria text, etc.
import { fr } from '@nuxt/ui/locale'

// Site-wide structured data. @nuxtjs/seo already emits WebSite/WebPage; what was
// missing is the club as a real-world entity. `SportsClub` (a LocalBusiness
// subtype) with a postal address and opening hours is what lets Google answer
// "pétanque fouesnant" with a knowledge panel, a map pin and the training hours —
// by far the highest-value structured data for a local club.
useSchemaOrg([
  defineLocalBusiness({
    // SportsClub is a real schema.org type (SportsActivityLocation → LocalBusiness)
    // but it's missing from nuxt-schema-org's subtype union, hence the cast: the
    // emitted JSON-LD is what matters and Google understands SportsClub.
    '@type': 'SportsClub' as 'SportsActivityLocation',
    'name': 'Pétanque Fouesnantaise',
    'description':
      'Club de pétanque affilié à la FFPJP, à Fouesnant (Finistère). Entraînements, concours et compétitions officielles.',
    'email': 'contact@petanque-fouesnantaise.fr',
    // No `telephone`: the only number on the site was the placeholder
    // 02 98 00 00 00. Structured data is consumed by machines — Google can turn
    // it into a click-to-call button in a knowledge panel — so publishing a fake
    // number is worse than publishing none. Add it here once there's a real one.
    'foundingDate': '1982',
    'address': {
      // The boulodrome, not the registered office (mairie) — this is the address
      // a visitor needs.
      streetAddress: "Allée de Loc'Hilaire",
      addressLocality: 'Fouesnant',
      postalCode: '29170',
      addressRegion: 'Bretagne',
      addressCountry: 'FR',
    },
    'openingHoursSpecification': [
      {
        dayOfWeek: ['Monday', 'Wednesday', 'Saturday'],
        opens: '14:00',
        closes: '19:00',
      },
    ],
    'sameAs': ['https://petanque-fouesnantaise.fr'],
  }),
])
</script>

<template>
  <UApp :locale="fr">
    <NuxtRouteAnnouncer />
    <div class="min-h-screen flex flex-col bg-muted text-default">
      <AppHeader />
      <main class="flex-1">
        <NuxtPage />
      </main>
      <AppFooter />
    </div>
  </UApp>
</template>
