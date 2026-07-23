#!/usr/bin/env bash
# Upload image-sources/** to the R2 bucket under the "images/" key prefix, so
# object keys mirror the site paths (/images/foo.jpg -> <bucket>/images/foo.jpg).
# The originals live in /image-sources (NOT /public) so they are never shipped
# in the deploy bundle — R2 is the only place they are served from.
#
# Prereqs:
#   - wrangler authenticated:  pnpm dlx wrangler login   (or CLOUDFLARE_API_TOKEN)
#   - the bucket exists:       pnpm dlx wrangler r2 bucket create <bucket>
#
# Usage:  BUCKET=ptank-images ./scripts/upload-images-to-r2.sh
set -euo pipefail

BUCKET="${BUCKET:-ptank-images}"
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)/image-sources"

if [ ! -d "$SRC_DIR" ]; then
  echo "No $SRC_DIR — nothing to upload." >&2
  exit 1
fi

echo "Uploading $SRC_DIR/** to r2://$BUCKET/images/ ..."
count=0
while IFS= read -r -d '' file; do
  key="images/${file#"$SRC_DIR/"}"
  echo "  -> $key"
  pnpm dlx wrangler r2 object put "$BUCKET/$key" --file="$file" --remote
  count=$((count + 1))
done < <(find "$SRC_DIR" -type f \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' -o -iname '*.webp' -o -iname '*.avif' -o -iname '*.gif' -o -iname '*.svg' \) -print0)

echo "Done. Uploaded $count file(s) to $BUCKET."
echo "Next: make the bucket public (custom domain) and set NUXT_IMAGE_R2_BASE."
