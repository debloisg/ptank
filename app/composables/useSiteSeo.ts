export function useSiteSeo() {
  const runtimeConfig = useRuntimeConfig()
  const siteUrl = computed(() => (runtimeConfig.public.siteUrl as string).replace(/\/$/, ''))
  const siteName = runtimeConfig.public.siteName as string
  const repositoryUrl = runtimeConfig.public.repositoryUrl as string
  const defaultSocialImage = runtimeConfig.public.defaultSocialImage as string

  function toAbsoluteUrl(pathOrUrl?: string | null) {
    if (!pathOrUrl)
      return undefined
    try {
      return new URL(pathOrUrl, `${siteUrl.value}/`).toString()
    }
    catch {
      return undefined
    }
  }

  return {
    siteUrl,
    siteName,
    repositoryUrl,
    defaultSocialImage,
    toAbsoluteUrl,
  }
}
