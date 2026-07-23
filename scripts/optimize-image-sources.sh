#!/usr/bin/env bash
# One-time (local) optimizer for the image masters in /image-sources, run before
# committing/uploading. Recompresses JPEGs (progressive, q82, 4:2:0), optimizes
# PNGs, and strips metadata — in place. Dimensions are left as-is (they're
# already web-sized); this only removes wasted bytes.
#
# Not part of the build/CI — needs ImageMagick locally: `magick` (v7) or `convert`.
# Safe for the Cloudflare Transformations path too: it keeps a clean, good-quality
# master for the edge to derive resized WebP/AVIF from.
#
# Usage:  ./scripts/optimize-image-sources.sh
set -euo pipefail

SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)/image-sources"
QUALITY="${QUALITY:-82}"

if command -v magick >/dev/null 2>&1; then IM="magick"
elif command -v convert >/dev/null 2>&1; then IM="convert"
else echo "ImageMagick not found (need 'magick' or 'convert')." >&2; exit 1; fi

before_total=0; after_total=0
while IFS= read -r -d '' f; do
  before=$(stat -c%s "$f")
  case "${f,,}" in
    *.jpg|*.jpeg) "$IM" "$f" -strip -interlace JPEG -sampling-factor 4:2:0 -quality "$QUALITY" "$f" ;;
    *.png)        "$IM" "$f" -strip -define png:compression-level=9 "$f" ;;
    *) continue ;;
  esac
  after=$(stat -c%s "$f")
  before_total=$((before_total + before)); after_total=$((after_total + after))
  printf "  %-40s %5dKB -> %5dKB\n" "${f#"$SRC_DIR/"}" $((before/1024)) $((after/1024))
done < <(find "$SRC_DIR" -type f \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' \) -print0)

printf "Total: %dKB -> %dKB (%d%% smaller)\n" \
  $((before_total/1024)) $((after_total/1024)) \
  $(( before_total > 0 ? (100 - after_total*100/before_total) : 0 ))
