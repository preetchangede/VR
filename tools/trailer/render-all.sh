#!/usr/bin/env bash
# Renders every trailer shot (frame-stepped) into film-out/<shot>/.
# Two lanes in parallel: SwiftShader does not scale linearly across cores.
set -u
cd "$(dirname "$0")/../.."
W=${W:-1280}; H=${H:-720}
OUT=${OUT:-film-out}
mkdir -p "$OUT"
lane() {
  for s in "$@"; do
    name=$(basename "$s" .mjs)
    if [ -f "$OUT/$name/.done" ]; then echo "[render] skip $name"; continue; fi
    echo "[render] start $name"
    node tools/film.mjs "tools/shots/$s" --w "$W" --h "$H" --out "$OUT/$name" > "$OUT/$name.log" 2>&1 \
      && touch "$OUT/$name/.done" && echo "[render] done $name" || echo "[render] FAILED $name"
  done
}
lane 01-well.mjs 03-ignite.mjs 05-supernova.mjs 07-life.mjs 09-dawn.mjs &
lane 02-gather.mjs 04-giant.mjs 06-worldsmith.mjs 08-homecoming.mjs 10-system.mjs &
wait
echo "[render] all lanes finished"
