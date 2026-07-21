<script setup lang="ts">
// Editable adhésion text comes from content/contact.md (title, description, body).
const { data: page } = await useAsyncData('contact', () =>
  queryCollection('pages').path('/contact').first(),
)

const CLUB_EMAIL = 'contact@petanque-fouesnantaise.fr'

// Practical info block — change these once here if the club details evolve.
const infos = [
  { label: 'Adresse', value: "Allée de Loc'Hilaire, 29170 Fouesnant" },
  { label: 'E-mail', value: CLUB_EMAIL, href: `mailto:${CLUB_EMAIL}` },
  { label: 'Téléphone', value: '02 98 00 00 00', href: 'tel:+33298000000' },
  { label: 'Cotisation adulte', value: '45 € / an (licence FFPJP incluse)' },
  { label: 'Cotisation jeune', value: '20 € / an' },
  { label: 'Créneaux', value: 'Lundi, mercredi & samedi, 14h à 19h' },
]

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
    <div class="max-w-2xl">
      <p class="eyebrow mb-3">Nous rejoindre</p>
      <h1 class="font-serif text-4xl sm:text-5xl font-semibold tracking-tight text-highlighted">
        {{ page?.title ?? 'Contact & Adhésion' }}
      </h1>
      <p v-if="page?.description" class="mt-4 text-lg text-muted">{{ page.description }}</p>
    </div>

    <div class="mt-12 grid gap-12 lg:grid-cols-2">
      <!-- Form -->
      <div>
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

      <!-- Informations pratiques -->
      <div>
        <h2 class="font-serif text-2xl font-semibold text-highlighted mb-6">Informations pratiques</h2>
        <dl class="divide-y divide-default border-y border-default">
          <div v-for="info in infos" :key="info.label" class="py-4">
            <dt class="eyebrow !text-[0.7rem] !text-dimmed mb-1">{{ info.label }}</dt>
            <dd class="text-toned">
              <a v-if="info.href" :href="info.href" class="hover:text-highlighted">{{ info.value }}</a>
              <span v-else>{{ info.value }}</span>
            </dd>
          </div>
        </dl>
      </div>
    </div>

    <!-- Editable adhésion text -->
    <div v-if="page?.body" class="mt-16 border-t border-default pt-12">
      <ContentRenderer :value="page" class="content-prose max-w-3xl" />
    </div>
  </UContainer>
</template>
