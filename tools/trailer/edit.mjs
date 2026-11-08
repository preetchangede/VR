#!/usr/bin/env node
// Assembles the trailer from frame-stepped shots, title overlays and the
// music bed, using a single ffmpeg filter graph.
//
//   node tools/trailer/edit.mjs <timeline.json>
//
// timeline.json:
// { "fps": 30, "width": 1920, "height": 1080, "out": "film-out/sunsmith-trailer.mp4",
//   "shots": [ { "dir": "film-out/01-well", "in": 0, "out": 5.5, "fadeIn": 0.6 }, ... ],
//   "xfade": 0.5,
//   "titles": [ { "png": "film-out/titles/logo.png", "start": 13, "end": 16.5, "fade": 0.6 } ],
//   "audio": "tools/preview/audio/out/trailer_bed.wav", "audioFadeOut": 3 }
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const tl = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const fps = tl.fps ?? 30;
const W = tl.width ?? 1920;
const H = tl.height ?? 1080;
const xf = tl.xfade ?? 0.5;

const inputs = [];
const filters = [];
let idx = 0;

// Shots: image sequences -> scaled, trimmed, faded clips.
const clipLabels = [];
for (const [k, s] of tl.shots.entries()) {
  if (!existsSync(s.dir)) throw new Error(`missing shot ${s.dir}`);
  const n = readdirSync(s.dir).filter((f) => /^f\d+\.png$/.test(f)).length;
  inputs.push('-framerate', String(fps), '-start_number', '0', '-i', `${s.dir}/f%05d.png`);
  const dur = s.out - s.in;
  let f = `[${idx}:v]trim=start=${s.in}:end=${Math.min(s.out, n / fps)},setpts=PTS-STARTPTS,scale=${W}:${H}:flags=lanczos,format=yuv420p,setsar=1`;
  if (s.grade !== false) f += `,eq=contrast=1.04:saturation=1.08`;
  if (s.fadeIn) f += `,fade=t=in:st=0:d=${s.fadeIn}`;
  if (s.fadeOut) f += `,fade=t=out:st=${dur - s.fadeOut}:d=${s.fadeOut}`;
  filters.push(`${f}[c${k}]`);
  clipLabels.push({ label: `c${k}`, dur, black: !!s.black });
  idx++;
}

// Chain clips with crossfades (xfade), or hard cuts where xfade = 0.
let cur = clipLabels[0].label;
let curDur = clipLabels[0].dur;
for (let k = 1; k < clipLabels.length; k++) {
  const next = clipLabels[k];
  const d = tl.shots[k].xfade ?? xf;
  const out = `x${k}`;
  if (d > 0) {
    filters.push(`[${cur}][${next.label}]xfade=transition=fade:duration=${d}:offset=${(curDur - d).toFixed(3)}[${out}]`);
    curDur = curDur + next.dur - d;
  } else {
    filters.push(`[${cur}][${next.label}]concat=n=2:v=1:a=0[${out}]`);
    curDur = curDur + next.dur;
  }
  cur = out;
}

// Title overlays with fades.
for (const [k, t] of (tl.titles ?? []).entries()) {
  inputs.push('-loop', '1', '-framerate', String(fps), '-t', String(t.end + 1), '-i', t.png);
  const fade = t.fade ?? 0.6;
  filters.push(
    `[${idx}:v]format=rgba,scale=${W}:${H},fade=t=in:st=${t.start}:d=${fade}:alpha=1,fade=t=out:st=${t.end - fade}:d=${fade}:alpha=1[t${k}]`,
  );
  filters.push(`[${cur}][t${k}]overlay=0:0:enable='between(t,${t.start},${t.end})'[o${k}]`);
  cur = `o${k}`;
  idx++;
}
filters.push(`[${cur}]format=yuv420p[vout]`);

const args = ['-y', ...inputs];
let audioMap = [];
if (tl.audio && existsSync(tl.audio)) {
  args.push('-i', tl.audio);
  const a = idx;
  const fo = tl.audioFadeOut ?? 3;
  filters.push(`[${a}:a]atrim=0:${curDur.toFixed(3)},afade=t=out:st=${(curDur - fo).toFixed(3)}:d=${fo}[aout]`);
  audioMap = ['-map', '[aout]', '-c:a', 'aac', '-b:a', '256k'];
}
args.push('-filter_complex', filters.join(';'), '-map', '[vout]', ...audioMap);
args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-r', String(fps));
args.push('-t', curDur.toFixed(3), tl.out);
console.log(`[edit] ${clipLabels.length} shots, ${(tl.titles ?? []).length} titles, duration ${curDur.toFixed(2)} s`);
const r = spawnSync('ffmpeg', args, { stdio: ['ignore', 'inherit', 'inherit'] });
if (r.status !== 0) process.exit(r.status ?? 1);
console.log(`[edit] wrote ${tl.out}`);
