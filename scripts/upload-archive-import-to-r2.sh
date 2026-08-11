#!/usr/bin/env bash
# One-time uploader for the 2026 archive import (see scripts/import-archives.mjs
# and scripts/import-archive-photos.mjs, which populate .archive-import/).
#
# Why this exists alongside scripts/upload-images-to-r2.sh: that script walks
# /image-sources (the curated, LFS-tracked masters) and uploads them one at a
# time. The archive import is ~3000 files, and `wrangler r2 object put` costs
# ~2.5s per object almost entirely in Node startup — serial upload would take
# over two hours. This script parallelises the puts and pre-shrinks the
# originals, which the article importer copied verbatim.
#
# The archive masters deliberately do NOT live in /image-sources: they are the
# raw Joomla dump (~420 MB) and committing them to Git LFS would bloat the repo
# for no benefit. .archive-import/ is gitignored; the SFTP backup remains the
# master copy, and the import scripts are reproducible from it.
#
# Prereqs: wrangler authenticated (`pnpm dlx wrangler login`), bucket exists,
#          ImageMagick v7 (`magick`) for the --shrink pass.
#
# Usage:
#   ./scripts/upload-archive-import-to-r2.sh --shrink        # downscale in place, then upload
#   ./scripts/upload-archive-import-to-r2.sh                 # upload only
#   ./scripts/upload-archive-import-to-r2.sh --shrink-only   # downscale, don't upload
#   JOBS=16 ./scripts/upload-archive-import-to-r2.sh         # tune parallelism
set -euo pipefail

BUCKET="${BUCKET:-ptank-images}"
JOBS="${JOBS:-12}"
MAX_EDGE="${MAX_EDGE:-2000}"
QUALITY="${QUALITY:-82}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DIR="$ROOT/.archive-import/images"
WRANGLER="$ROOT/node_modules/.bin/wrangler"

DO_SHRINK=0
DO_UPLOAD=1
for arg in "$@"; do
  case "$arg" in
    --shrink)      DO_SHRINK=1 ;;
    --shrink-only) DO_SHRINK=1; DO_UPLOAD=0 ;;
    *) echo "Unknown flag: $arg" >&2; exit 2 ;;
  esac
done

[ -d "$SRC_DIR" ] || { echo "No $SRC_DIR — run the import scripts first." >&2; exit 1; }
[ -x "$WRANGLER" ] || { echo "No local wrangler at $WRANGLER — run pnpm install." >&2; exit 1; }

# ── Shrink pass ───────────────────────────────────────────────────────────────
# Only the per-article images need this: import-archive-photos.mjs already
# downscaled the gallery, but import-archives.mjs copies article images verbatim
# so the markdown's filenames (and therefore extensions) stay valid. So this
# resizes IN PLACE and NEVER changes a filename or extension — rewriting .png to
# .jpg here would break every `![](…)` the converter emitted.
#
# GIFs are skipped entirely: many are animated decorative dividers, and
# ImageMagick would either flatten them to a single frame or balloon the size.
if [ "$DO_SHRINK" = "1" ]; then
  command -v magick >/dev/null 2>&1 || { echo "ImageMagick v7 (magick) not found." >&2; exit 1; }
  echo "Shrinking oversized images in place (max ${MAX_EDGE}px, q${QUALITY})..."
  before=$(du -sb "$SRC_DIR" | cut -f1)

  # -auto-orient BEFORE the resize so EXIF-rotated phone photos come out upright
  # (and so the long-edge test applies to the rotated dimensions).
  # `>` on the geometry means "shrink only, never upscale".
  shrink_one() {
    f="$1"; max="$2"; q="$3"
    read -r w h < <(magick identify -format '%w %h' "$f[0]" 2>/dev/null) || return 0
    [ -n "${w:-}" ] || return 0
    # Leave small, already-web-sized images alone — recompressing a 71px divider
    # gains nothing and risks visible artefacts.
    if [ "$w" -le "$max" ] && [ "$h" -le "$max" ] && [ "$(stat -c%s "$f")" -le 204800 ]; then
      return 0
    fi
    case "${f,,}" in
      *.png)
        magick "$f" -auto-orient -resize "${max}x${max}>" -strip \
          -define png:compression-level=9 "$f" ;;
      *.jpg|*.jpeg)
        magick "$f" -auto-orient -resize "${max}x${max}>" -strip \
          -interlace JPEG -sampling-factor 4:2:0 -quality "$q" "$f" ;;
    esac
  }
  export -f shrink_one

  # Scoped to archives/ ONLY. import-archive-photos.mjs already encoded galerie/
  # at this exact quality; running it through a second q82 JPEG round-trip would
  # be pure generation loss for no size win.
  find "$SRC_DIR/archives" -type f \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' \) -print0 \
    | xargs -0 -P "$JOBS" -I{} bash -c 'shrink_one "$@"' _ {} "$MAX_EDGE" "$QUALITY"

  after=$(du -sb "$SRC_DIR" | cut -f1)
  printf "Shrink done: %dMB -> %dMB (%d%% smaller)\n" \
    $((before/1048576)) $((after/1048576)) \
    $(( before > 0 ? (100 - after*100/before) : 0 ))
fi

[ "$DO_UPLOAD" = "1" ] || exit 0

# ── Upload pass ───────────────────────────────────────────────────────────────
# Object keys mirror the public paths the site requests: a file staged at
# .archive-import/images/galerie/x/y.jpg is served from /images/galerie/x/y.jpg
# and so must land at key images/galerie/x/y.jpg.
total=$(find "$SRC_DIR" -type f \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' \
  -o -iname '*.gif' -o -iname '*.webp' -o -iname '*.avif' \) | wc -l)
echo "Uploading $total file(s) from $SRC_DIR to r2://$BUCKET/images/ with $JOBS parallel jobs..."

FAILED="$ROOT/.archive-import/upload-failures.txt"
: > "$FAILED"

put_one() {
  file="$1"; bucket="$2"; src_dir="$3"; wrangler="$4"; failed="$5"
  key="images/${file#"$src_dir/"}"
  # --remote targets the real bucket (not the local miniflare simulation).
  if ! out=$("$wrangler" r2 object put "$bucket/$key" --file="$file" --remote 2>&1); then
    printf '%s\t%s\n' "$key" "$(printf '%s' "$out" | tr '\n' ' ')" >> "$failed"
    printf 'FAIL %s\n' "$key"
  else
    printf 'ok   %s\n' "$key"
  fi
}
export -f put_one

find "$SRC_DIR" -type f \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' \
  -o -iname '*.gif' -o -iname '*.webp' -o -iname '*.avif' \) -print0 \
  | xargs -0 -P "$JOBS" -I{} bash -c 'put_one "$@"' _ {} \
      "$BUCKET" "$SRC_DIR" "$WRANGLER" "$FAILED"

fail_count=$(wc -l < "$FAILED")
echo
if [ "$fail_count" -gt 0 ]; then
  echo "Done with $fail_count failure(s). See $FAILED — rerun this script to retry (puts are idempotent)."
  exit 1
fi
rm -f "$FAILED"
echo "Done. Uploaded $total file(s) to $BUCKET."
