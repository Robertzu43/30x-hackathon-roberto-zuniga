#!/usr/bin/env bash
# Assembles the launch film from render.mjs's raw take (AC-111, R-155).
#   bash scripts/film/assemble.sh <raw-dir> [out-dir]     out-dir defaults to web/public/demo
# Writes thesaurus-launch.mp4 (H.264, yuv420p, constant 30 fps, 1920x1080, +faststart, silent),
# thesaurus-launch-poster.jpg (a frame of the film) and thesaurus-launch.en.vtt (the en text of docs/film/cues.json).
# Size cap 24 MiB: CRF rises until the file fits; the resolution never drops (R-155).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RAW="${1:?usage: assemble.sh <raw-dir> [out-dir]}"
OUT="${2:-$ROOT/web/public/demo}"
CUES="$ROOT/docs/film/cues.json"
CAP=25165824
POSTER_AT="${POSTER_AT:-6}" # seconds: the title card with the wordmark and the line complete

IN="$RAW/raw.mp4"; [ -f "$IN" ] || IN="$RAW/raw.webm"
[ -f "$IN" ] || { echo "no raw.mp4 or raw.webm in $RAW" >&2; exit 2; }
TRIM="$(cat "$RAW/raw.trim")"
LEN="$(node -e 'const {cues}=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(Math.max(...cues.map(c=>c.end)))' "$CUES")"
mkdir -p "$OUT"
MP4="$OUT/thesaurus-launch.mp4"

for CRF in 18 20 22 24 26 28 30 32; do
  ffmpeg -y -loglevel error -ss "$TRIM" -i "$IN" -t "$LEN" -an \
    -vf "fps=30,scale=1920:1080:flags=lanczos,format=yuv420p" \
    -c:v libx264 -preset medium -crf "$CRF" -profile:v high -r 30 -movflags +faststart "$MP4"
  SIZE="$(stat -c %s "$MP4")"
  echo "crf $CRF: $SIZE bytes"
  [ "$SIZE" -le "$CAP" ] && break
done
[ "$SIZE" -le "$CAP" ] || { echo "still over $CAP bytes at CRF $CRF" >&2; exit 1; }

ffmpeg -y -loglevel error -ss "$POSTER_AT" -i "$MP4" -frames:v 1 -q:v 3 "$OUT/thesaurus-launch-poster.jpg"

node -e '
const { cues } = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const t = (s) => new Date(Math.round(s * 1000)).toISOString().slice(11, 23);
const body = cues.map((c) => `${c.id}\n${t(c.start)} --> ${t(c.end)}\n${c.en.replace(/\n+/g, "\n")}`).join("\n\n");
require("fs").writeFileSync(process.argv[2], `WEBVTT\n\n${body}\n`);
' "$CUES" "$OUT/thesaurus-launch.en.vtt"

ls -l "$MP4" "$OUT/thesaurus-launch-poster.jpg" "$OUT/thesaurus-launch.en.vtt"
