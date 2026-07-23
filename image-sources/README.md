# image-sources

Originals of the site's images. **Not** served by the app and **not** part of
the deploy bundle — they live here only as the source to upload to R2.

The site loads every image from the R2 bucket via `@nuxt/image` (see the
`image` block in `nuxt.config.ts`). Paths mirror this folder under an `images/`
prefix: `image-sources/hero-terrain.jpg` → `/images/hero-terrain.jpg` in
content/components → `<bucket>/images/hero-terrain.jpg` in R2.

## Add or replace an image

1. Drop the file here (keep the `partenaires/` subfolder layout).
2. Reference it in content/Studio as `/images/<name>` (the Studio media picker
   still uses these paths).
3. Upload to R2: `BUCKET=<bucket> ./scripts/upload-images-to-r2.sh`
