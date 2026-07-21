<script setup lang="ts">
// French locale drives Nuxt UI's built-in date formatting (UBlogPost `date`),
// pagination labels, aria text, etc.
import { fr } from '@nuxt/ui/locale'
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
