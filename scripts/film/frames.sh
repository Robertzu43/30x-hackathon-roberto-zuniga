#!/usr/bin/env bash
# Review frames and measurements for the fresh reviewer (AC-111, R-158).
#   bash scripts/film/frames.sh <mp4> [out-dir]     out-dir defaults to docs/film/review
# sheet-NN.jpg: 1 frame per second, 320 px wide, 5x6 tiles. cue-NN.png: full size at each cue's midpoint (cues.json order).
# scene-NNN.png: full size at each scene change (scene > 0.3). *.log: ffprobe, freezedetect, blackdetect, mpdecimate.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MP4="${1:?usage: frames.sh <mp4> [out-dir]}"
OUT="${2:-$ROOT/docs/film/review}"
mkdir -p "$OUT"

ffmpeg -y -loglevel error -i "$MP4" -vf "fps=1,scale=320:-2,tile=5x6" -q:v 3 "$OUT/sheet-%02d.jpg"

i=0
for MID in $(node -e 'for (const c of JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).cues) console.log((c.start + c.end) / 2)' "$ROOT/docs/film/cues.json"); do
  i=$((i + 1))
  ffmpeg -y -loglevel error -ss "$MID" -i "$MP4" -frames:v 1 "$(printf '%s/cue-%02d.png' "$OUT" "$i")"
done

ffmpeg -y -loglevel error -i "$MP4" -vf "select='gt(scene,0.3)'" -fps_mode vfr "$OUT/scene-%03d.png"

ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate,pix_fmt:format=duration,size "$MP4" > "$OUT/ffprobe.log"
ffmpeg -hide_banner -i "$MP4" -vf "freezedetect=n=0.001:d=4" -an -f null - 2>&1 | grep -E 'freeze_(start|end|duration)' > "$OUT/freezedetect.log" || true
ffmpeg -hide_banner -i "$MP4" -vf "blackdetect=d=1.5" -an -f null - 2>&1 | grep -E 'black_start' > "$OUT/blackdetect.log" || true
ffmpeg -hide_banner -loglevel debug -i "$MP4" -vf mpdecimate -an -f null - 2>&1 | grep -oE '(drop|keep) pts:[0-9]+ pts_time:[0-9.]+' > "$OUT/mpdecimate.raw" || true
# Total, then dropped frames per second of film, so a drop can be placed inside its scene with cues.json.
awk '{ n++; if ($1 == "drop") d++ } END { printf "frames %d, dropped %d (%.2f %%)\n", n, d, n ? 100 * d / n : 0 }' "$OUT/mpdecimate.raw" > "$OUT/mpdecimate.log"
awk -F'pts_time:' '/^drop/ { print int($2) }' "$OUT/mpdecimate.raw" | sort -n | uniq -c | awk '{ printf "second %d: %d dropped\n", $2, $1 }' >> "$OUT/mpdecimate.log"
rm "$OUT/mpdecimate.raw"

echo "== ffprobe"; cat "$OUT/ffprobe.log"
echo "== freezedetect (n=0.001, d=4)"; cat "$OUT/freezedetect.log"
echo "== blackdetect (d=1.5)"; cat "$OUT/blackdetect.log"
echo "== mpdecimate"; head -1 "$OUT/mpdecimate.log"
ls "$OUT" | wc -l
