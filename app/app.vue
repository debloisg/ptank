<script setup lang="ts">
// French locale drives Nuxt UI's built-in date formatting (UBlogPost `date`),
// pagination labels, aria text, etc.
import { fr } from '@nuxt/ui/locale'

const route = useRoute()
const { siteUrl, siteName, repositoryUrl, defaultSocialImage: defaultSocialImagePath, toAbsoluteUrl } = useSiteSeo()

const canonicalUrl = computed(() => {
  return toAbsoluteUrl(route.path || '/') || siteUrl.value
})

const defaultSocialImage = computed(() => {
  const image = defaultSocialImagePath || '/images/hero-terrain.jpg'
  return toAbsoluteUrl(image)
})

useHead(() => ({
  link: [{ rel: 'canonical', href: canonicalUrl.value }],
  script: [
    {
      key: 'ld-organization',
      type: 'application/ld+json',
      children: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'SportsOrganization',
        name: siteName,
        url: siteUrl.value,
        sameAs: [repositoryUrl],
      }),
    },
    {
      key: 'ld-website',
      type: 'application/ld+json',
      children: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: siteName,
        url: siteUrl.value,
        inLanguage: 'fr-FR',
      }),
    },
  ],
}))

useSeoMeta({
  ogSiteName: siteName,
  ogType: 'website',
  ogLocale: 'fr_FR',
  ogUrl: () => canonicalUrl.value,
  ogImage: () => defaultSocialImage.value,
  twitterCard: 'summary_large_image',
  twitterImage: () => defaultSocialImage.value,
})
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
