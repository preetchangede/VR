#!/usr/bin/env node
// Score-to-picture helper for the trailer.
//
// Reads the edit (timeline.json) and each shot's cues.json (written by
// tools/film.mjs: every sound cue the game fired, as shot time), then:
//   - prints every cue mapped onto trailer time, so sync can be checked;
//   - with anchors (shot -> cue -> trailer time), slides each anchored clip's
//     in/out points so that cue lands exactly on its hit, keeping the clip's
//     duration (so every later clip keeps its start time);
//   - with --write, saves the adjusted timeline.
//
// Usage: node tools/trailer/align.mjs [timeline.json] [--anchors anchors.json] [--write]
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const tlPath = resolve(args.find((a) => a.endsWith('.json') && !a.includes('anchor')) ?? 'tools/trailer/timeline.json');
const ai = args.indexOf('--anchors');
const anchors = ai >= 0 ? JSON.parse(readFileSync(resolve(args[ai + 1]), 'utf8')) : {};
const write = args.includes('--write');
const tl = JSON.parse(readFileSync(tlPath, 'utf8'));
const fps = tl.fps ?? 30;
const xfDefault = tl.xfade ?? 0.5;
const quiet = new Set(['gather-tick', 'ember-speak', 'poke', 'chime']);

const shotName = (dir) => dir.split('/').pop();
const shotLength = (dir) => readdirSync(dir).filter((f) => /^f\d+\.png$/.test(f)).length / fps;
function loadCues(dir) {
  const p = resolve(dir, 'cues.json');
  if (!existsSync(p)) return null;
  const c = JSON.parse(readFileSync(p, 'utf8'));
  // Older logs timed cues by game time from before the first step: one frame late.
  return c.cues.map((x) => ({ ...x, time: x.frame === undefined ? +(x.time - 1 / c.fps).toFixed(3) : x.time }));
}
/** First cue matching "kind:name" (optionally "kind:name#n" for the n-th, 1-based). */
function pick(cues, sel) {
  const [key, nth] = sel.split('#');
  const [kind, name] = key.split(':');
  const hits = cues.filter((c) => c.kind === kind && c.name === name);
  return hits[(+nth || 1) - 1];
}

let t = 0;
const rows = [];
tl.shots.forEach((s, k) => {
  const xf = k === 0 ? 0 : s.xfade ?? xfDefault;
  const start = k === 0 ? 0 : t - xf;
  if (s.color) {
    t = start + s.duration;
    return;
  }
  const dir = resolve(s.dir);
  const len = existsSync(dir) ? shotLength(dir) : 0;
  // The intended clip length (a shot still rendering must not shift the rest of the edit).
  const dur = s.out - s.in;
  if (len && s.out > len + 1e-6) console.log(`! ${shotName(s.dir)}: out ${s.out} is past the ${len.toFixed(2)} s rendered so far`);
  const name = shotName(s.dir);
  const cues = existsSync(dir) ? loadCues(dir) : null;
  const a = anchors[name];
  if (a && cues) {
    const c = pick(cues, a.cue);
    if (!c) console.log(`! ${name}: anchor cue ${a.cue} not found`);
    else {
      let inP = +(c.time - (a.at - start)).toFixed(3);
      let outP = +(inP + dur).toFixed(3);
      if (inP < 0 || outP > len + 1e-6) console.log(`! ${name}: anchor needs in=${inP} out=${outP}, shot is ${len.toFixed(2)} s — clamped`);
      inP = Math.max(0, Math.min(inP, Math.max(len, s.out) - dur));
      outP = +(inP + dur).toFixed(3);
      if (inP !== s.in) console.log(`  ${name}: in ${s.in} -> ${inP}, out ${s.out} -> ${outP} (${a.cue} at ${a.at})`);
      s.in = inP;
      s.out = outP;
    }
  }
  if (cues)
    for (const c of cues) {
      if (c.time < s.in - 1e-6 || c.time > s.in + dur + 1e-6) continue;
      if (c.kind === 'play' && quiet.has(c.name)) continue;
      if (c.kind === 'loop-stop' || c.kind === 'pluck') continue;
      rows.push({ at: +(start + c.time - s.in).toFixed(3), shot: name, cue: `${c.kind}:${c.name}${c.size !== undefined ? ` (${c.size})` : ''}`, shotTime: c.time });
    }
  else if (existsSync(dir)) rows.push({ at: +start.toFixed(3), shot: name, cue: '(no cues.json)', shotTime: s.in });
  rows.push({ at: +start.toFixed(3), shot: name, cue: `— clip starts (in ${s.in}, ${dur.toFixed(2)} s)`, shotTime: s.in });
  t = start + dur;
});
rows.sort((a, b) => a.at - b.at);
for (const r of rows) console.log(`${r.at.toFixed(3).padStart(7)}  ${r.shot.padEnd(14)} ${r.cue}`);
console.log(`total ${t.toFixed(2)} s`);
if (write) {
  writeFileSync(tlPath, JSON.stringify(tl, null, 2) + '\n');
  console.log(`wrote ${tlPath}`);
}
