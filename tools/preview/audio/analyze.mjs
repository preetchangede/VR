#!/usr/bin/env node
// Analyze rendered WAVs: peak, RMS, DC offset, clipping, silence, click suspects, and
// EBU R128 loudness / true peak (via ffmpeg when available). Optionally draws spectrograms.
//
//   node tools/preview/audio/analyze.mjs [filter...] [--png] [--dir tools/preview/audio/out]
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dirArg = args.indexOf('--dir');
const dir = resolve(dirArg >= 0 ? args[dirArg + 1] : resolve(here, 'out'));
const filters = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--dir');
const png = args.includes('--png');

function readWav(path) {
  const b = readFileSync(path);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV');
  let o = 12;
  let fmt = null;
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4);
    const size = b.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(o + 10), sr: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) };
    if (id === 'data') {
      if (!fmt || fmt.bits !== 16) throw new Error('expected 16-bit PCM');
      const n = Math.floor(size / (2 * fmt.ch));
      const chans = Array.from({ length: fmt.ch }, () => new Float32Array(n));
      let p = o + 8;
      for (let i = 0; i < n; i++) for (let c = 0; c < fmt.ch; c++, p += 2) chans[c][i] = b.readInt16LE(p) / 32768;
      return { ...fmt, n, chans };
    }
    o += 8 + size + (size & 1);
  }
  throw new Error('no data chunk');
}

const dbv = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);

function analyze(w) {
  const { chans, sr, n } = w;
  let peak = 0;
  let sum = 0;
  let clipped = 0;
  const dc = chans.map((d) => d.reduce((a, x) => a + x, 0) / n);
  for (const d of chans) {
    for (let i = 0; i < n; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
      if (a >= 0.966) clipped++;
      sum += d[i] * d[i];
    }
  }
  const rms = Math.sqrt(sum / (n * chans.length));
  // Windowed (50 ms) RMS: loudest window, silence runs, onset.
  const win = Math.round(sr * 0.05);
  let maxWin = 0;
  let firstLoud = -1;
  let silentRun = 0;
  let longestSilent = 0;
  let lastLoud = 0;
  for (let s = 0; s + win <= n; s += win) {
    let e = 0;
    for (const d of chans) for (let i = s; i < s + win; i++) e += d[i] * d[i];
    const r = Math.sqrt(e / (win * chans.length));
    if (r > maxWin) maxWin = r;
    if (r > 0.001) {
      if (firstLoud < 0) firstLoud = s / sr;
      lastLoud = (s + win) / sr;
      silentRun = 0;
    } else if (firstLoud >= 0) {
      silentRun += win / sr;
      longestSilent = Math.max(longestSilent, silentRun);
    }
  }
  // Click suspects: a sample step far larger than its neighbourhood's typical step.
  const clicks = [];
  for (const d of chans) {
    const R = 256;
    let acc = 0;
    const diff = new Float32Array(n);
    for (let i = 1; i < n; i++) diff[i] = Math.abs(d[i] - d[i - 1]);
    for (let i = 1; i < Math.min(n, 2 * R + 1); i++) acc += diff[i];
    for (let i = R + 1; i < n - R; i++) {
      acc += diff[i + R] - diff[i - R - 1];
      const typical = acc / (2 * R + 1);
      if (diff[i] > 0.02 && diff[i] > 12 * typical) {
        if (!clicks.length || i / sr - clicks[clicks.length - 1] > 0.05) clicks.push(i / sr);
      }
    }
  }
  clicks.sort((a, b) => a - b);
  // Stereo: L/R balance and phase correlation (mono compatibility).
  let balanceDb = 0;
  let corr = 1;
  if (chans.length === 2) {
    let ll = 0;
    let rr = 0;
    let lr = 0;
    const [L, R] = chans;
    for (let i = 0; i < n; i++) {
      ll += L[i] * L[i];
      rr += R[i] * R[i];
      lr += L[i] * R[i];
    }
    balanceDb = 10 * Math.log10((ll + 1e-12) / (rr + 1e-12));
    corr = lr / Math.sqrt(ll * rr + 1e-24);
  }
  return {
    balanceDb,
    corr,
    seconds: n / sr,
    peakDb: dbv(peak),
    rmsDb: dbv(rms),
    loudestWindowDb: dbv(maxWin),
    dc,
    clipped,
    onset: firstLoud,
    tail: lastLoud,
    longestSilent,
    clicks: clicks.slice(0, 8),
    clickCount: clicks.length,
  };
}

function loudness(path) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', path, '-filter_complex', 'ebur128=peak=true', '-f', 'null', '-'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return parseR128(`${r.stdout ?? ''}\n${r.stderr ?? ''}`);
}

function parseR128(text) {
  const summary = text.slice(text.lastIndexOf('Summary:'));
  const I = /I:\s+(-?[\d.]+|-inf) LUFS/.exec(summary);
  const LRA = /LRA:\s+(-?[\d.]+) LU/.exec(summary);
  const TP = /Peak:\s+(-?[\d.]+|-inf) dBFS/.exec(summary);
  let maxS = -Infinity;
  let maxM = -Infinity;
  for (const m of text.matchAll(/S:\s*(-?[\d.]+)/g)) maxS = Math.max(maxS, Number(m[1]));
  for (const m of text.matchAll(/M:\s*(-?[\d.]+)/g)) maxM = Math.max(maxM, Number(m[1]));
  return {
    lufs: I ? Number(I[1]) : null,
    lra: LRA ? Number(LRA[1]) : null,
    truePeak: TP ? Number(TP[1]) : null,
    maxShortTerm: Number.isFinite(maxS) ? maxS : null,
    maxMomentary: Number.isFinite(maxM) ? maxM : null,
  };
}

function spectrogram(path, pngDir) {
  const out = resolve(pngDir, basename(path, '.wav') + '.png');
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', path, '-lavfi', 'showspectrumpic=s=1200x480:mode=combined:color=magma:scale=log:fscale=log:legend=1', out]);
  } catch (e) {
    console.log(`spectrogram failed for ${path}: ${e.message}`);
  }
}

let hasFfmpeg = true;
try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
} catch {
  hasFfmpeg = false;
}

const files = readdirSync(dir)
  .filter((f) => f.endsWith('.wav'))
  .filter((f) => !filters.length || filters.some((x) => f.includes(x)))
  .sort();
if (png) mkdirSync(resolve(dir, 'png'), { recursive: true });

const report = [];
const problems = [];
const fmt = (v, w = 6) => (v === null || v === undefined ? 'n/a' : Number.isFinite(v) ? v.toFixed(1) : String(v)).padStart(w);
console.log('file                             peak   rms   loud   LUFS    TP   maxS   maxM onset  tail   L/R  corr clicks  flags');
for (const f of files) {
  const path = resolve(dir, f);
  const w = readWav(path);
  const a = analyze(w);
  const l = hasFfmpeg ? loudness(path) : {};
  const flags = [];
  const trailer = f.startsWith('trailer');
  if (a.peakDb > -0.3) flags.push('CLIP');
  if (trailer && a.peakDb > -1) flags.push('PEAK>-1');
  if (trailer && l.truePeak !== null && l.truePeak > -1) flags.push('TP>-1');
  if (a.rmsDb < -65) flags.push('SILENT');
  if (a.dc.some((d) => Math.abs(d) > 0.002)) flags.push('DC');
  if (trailer && l.lufs !== null && Math.abs(l.lufs + 16) > 1) flags.push('LUFS');
  if (a.onset > 0.6 && !f.startsWith('mood_') && !trailer) flags.push('LATE');
  // Balance only matters for centred material; decorrelated noise and HRTF output sit near 0 correlation.
  if (Math.abs(a.balanceDb) > 3 && (f.startsWith('mood_') || trailer)) flags.push('L/R');
  if (a.corr < -0.3) flags.push('PHASE');
  const row = { file: f, ...a, ...l, flags };
  report.push(row);
  if (flags.length) problems.push(`${f}: ${flags.join(' ')}`);
  console.log(
    `${f.padEnd(31)}${fmt(a.peakDb)}${fmt(a.rmsDb)}${fmt(a.loudestWindowDb)}${fmt(l.lufs, 7)}${fmt(l.truePeak)}${fmt(l.maxShortTerm)}${fmt(l.maxMomentary, 7)}` +
      `${fmt(a.onset)}${fmt(a.tail)}${fmt(a.balanceDb)}${a.corr.toFixed(2).padStart(6)}${String(a.clickCount).padStart(7)}  ${flags.join(' ')}`,
  );
  if (png) spectrogram(path, resolve(dir, 'png'));
}
writeFileSync(resolve(dir, filters.length ? 'report.partial.json' : 'report.json'), JSON.stringify(report, null, 2));
console.log(problems.length ? `\n${problems.length} flagged:\n  ${problems.join('\n  ')}` : '\nno problems flagged');
