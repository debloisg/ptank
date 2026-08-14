#!/usr/bin/env bash
# Uploads the derived -800/-ph image variants staged by
# scripts/generate-image-variants.mjs (.image-variants/images/**) to R2.
#
# Same parallel-wrangler pattern as upload-archive-import-to-r2.sh and for the
# same reason: `wrangler r2 object put` costs ~2.5s per object almost entirely
# in Node startup, so ~5400 objects need parallelism to finish in minutes.
#
# Prereqs: wrangler authenticated (`pnpm dlx wrangler login`), bucket exists.
#
# Usage:
#   ./scripts/upload-image-variants-to-r2.sh
#   JOBS=16 ./scripts/upload-image-variants-to-r2.sh
set -euo pipefail

BUCKET="${BUCKET:-ptank-images}"
JOBS="${JOBS:-12}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DIR="$ROOT/.image-variants"
WRANGLER="$ROOT/node_modules/.bin/wrangler"

[ -d "$SRC_DIR" ] || { echo "No $SRC_DIR — run scripts/generate-image-variants.mjs first." >&2; exit 1; }
[ -x "$WRANGLER" ] || { echo "No local wrangler at $WRANGLER — run pnpm install." >&2; exit 1; }

total=$(find "$SRC_DIR" -type f -iname '*.webp' | wc -l)
echo "Uploading $total variant(s) from $SRC_DIR to r2://$BUCKET/ with $JOBS parallel jobs..."

FAILED="$SRC_DIR/upload-failures.txt"
: > "$FAILED"

put_one() {
  file="$1"; bucket="$2"; src_dir="$3"; wrangler="$4"; failed="$5"
  # Keys mirror the staging layout: .image-variants/images/x/y-800.webp is
  # served from /images/x/y-800.webp and so must land at key images/x/y-800.webp.
  key="${file#"$src_dir/"}"
  if ! out=$("$wrangler" r2 object put "$bucket/$key" --file="$file" --remote 2>&1); then
    printf '%s\t%s\n' "$key" "$(printf '%s' "$out" | tr '\n' ' ')" >> "$failed"
    printf 'FAIL %s\n' "$key"
  else
    printf 'ok   %s\n' "$key"
  fi
}
export -f put_one

find "$SRC_DIR" -type f -iname '*.webp' -print0 \
  | xargs -0 -P "$JOBS" -I{} bash -c 'put_one "$@"' _ {} \
      "$BUCKET" "$SRC_DIR" "$WRANGLER" "$FAILED"

fail_count=$(wc -l < "$FAILED")
echo
if [ "$fail_count" -gt 0 ]; then
  echo "$fail_count upload(s) FAILED — keys in $FAILED. Re-run to retry (puts are idempotent)."
  exit 1
fi
echo "All $total variant(s) uploaded."
