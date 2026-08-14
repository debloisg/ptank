// Every site image has a pre-generated ~24px blur placeholder sibling in R2
// (`foo.webp` -> `foo-ph.webp`, ~300 B — see scripts/generate-image-variants.mjs).
// NuxtImg's `placeholder` prop takes this URL as-is (no provider resolution),
// so it must be absolute. GIFs have no variants and get none.
const VARIANT_SRC = /\.(webp|jpe?g|png)$/i

export function imagePlaceholder(src?: string): string | undefined {
  if (!src || !VARIANT_SRC.test(src)) return undefined
  const base = useRuntimeConfig().public.imageR2Base
  return `${base}${src.replace(VARIANT_SRC, '-ph.webp')}`
}
