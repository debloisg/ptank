<script setup lang="ts">
// Editable adhésion text comes from content/contact.md (title, description, body).
const { data: page } = await useAsyncData('contact', () =>
  queryCollection('pages').path('/contact').first(),
)

const CLUB_EMAIL = 'contact@petanque-fouesnantaise.fr'

const form = reactive({ name: '', email: '', message: '' })

// Static site (no backend): opens the visitor's mail client pre-filled.
function submit() {
  const subject = encodeURIComponent(`Contact site — ${form.name || 'Message'}`)
  const body = encodeURIComponent(
    `${form.message}\n\n— ${form.name}${form.email ? ` (${form.email})` : ''}`,
  )
  window.location.href = `mailto:${CLUB_EMAIL}?subject=${subject}&body=${body}`
}

useSeoMeta({
  title: 'Nous rejoindre · La Pétanque Fouesnantaise',
  description: 'Rejoignez La Pétanque Fouesnantaise ou contactez le club.',
})
</script>

<template>
  <UContainer class="py-12 sm:py-16">
    <!-- Hero -->
    <UPageHeader
      headline="Nous rejoindre"
      :title="page?.title ?? 'Contact & Adhésion'"
      :description="page?.description"
    />

    <div class="mt-12 max-w-xl">
      <!-- Form -->
      <h2 class="font-serif text-2xl font-semibold text-highlighted mb-6">Écrivez-nous</h2>
      <form class="space-y-5" @submit.prevent="submit">
        <UFormField label="Nom" name="name">
          <UInput v-model="form.name" size="lg" placeholder="Prénom Nom" class="w-full" />
        </UFormField>
        <UFormField label="E-mail" name="email">
          <UInput v-model="form.email" type="email" size="lg" placeholder="vous@exemple.fr" class="w-full" />
        </UFormField>
        <UFormField label="Votre message" name="message">
          <UTextarea v-model="form.message" :rows="6" size="lg" placeholder="Bonjour, je souhaite…" class="w-full" />
        </UFormField>
        <UButton type="submit" color="primary" size="lg" class="rounded-full px-7" label="Envoyer" />
        <p class="text-xs text-muted">Ce formulaire ouvre votre logiciel de messagerie.</p>
      </form>
    </div>

    <!-- Editable adhésion text -->
    <div v-if="page?.body" class="mt-16 border-t border-default pt-12">
      <ContentRenderer :value="page" class="content-prose max-w-3xl" />
    </div>
  </UContainer>
</template>
