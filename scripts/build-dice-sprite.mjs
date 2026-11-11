// Builds assets/sounds/dice-hits.mp3 + dice-hits.json from the Halfwits & Failed Crits
// "SFX Pack - Rolling Dice" (CC0): finds the individual hits in the single-die recordings,
// buckets them by original loudness (heavy / medium / light), normalizes each, and packs them
// into one mono audio sprite with a JSON map. Needs ffmpeg on PATH.
//
// Usage: node scripts/build-dice-sprite.mjs "<unzipped pack folder>"
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const RATE = 48000;
const GAP_S = 0.05;
const MAX_HIT_S = 0.2;
const PER_BUCKET = { heavy: 12, medium: 12, light: 9 };
const DICE = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'];

const packDir = process.argv[2];
if (!packDir) throw new Error('usage: node scripts/build-dice-sprite.mjs "<pack folder>" ["<kenney casino Audio folder>"]');
// Optional second argument: Kenney's "Casino Audio" (CC0) Audio folder. Its die/dice throws were
// recorded on a felt casino table (spectral centroid ~1 kHz vs ~2.4 kHz for the hard-table
// pack), so they become the felt-table hits.
const feltDir = process.argv[3];

function decode(file) {
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'], {
    maxBuffer: 1 << 28,
  });
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

/** Onsets of hits in a recording, each cut to at most MAX_HIT_S, faded and normalized. */
function hitsIn(x, die, maxHit = MAX_HIT_S) {
  const win = Math.round(RATE * 0.002);
  const env = new Float32Array(Math.ceil(x.length / win));
  for (let i = 0; i < env.length; i++) {
    let m = 0;
    for (let j = i * win; j < Math.min(x.length, (i + 1) * win); j++) m = Math.max(m, Math.abs(x[j]));
    env[i] = m;
  }
  const peak = env.reduce((a, b) => Math.max(a, b), 0);
  const floor = [...env].sort((a, b) => a - b)[Math.floor(env.length * 0.3)];
  const thr = Math.max(peak * 0.12, floor * 6);
  const minGap = Math.round(0.06 / 0.002);
  const onsets = [];
  let last = -minGap;
  for (let i = 1; i < env.length; i++) {
    if (env[i] >= thr && env[i - 1] < thr && i - last >= minGap) onsets.push((last = i));
  }
  const out = [];
  onsets.forEach((o, k) => {
    const start = Math.max(0, o * win - Math.round(RATE * 0.003));
    const next = k + 1 < onsets.length ? onsets[k + 1] * win - Math.round(RATE * 0.004) : x.length;
    const end = Math.min(x.length, start + Math.round(RATE * maxHit), next);
    if (end - start < RATE * 0.04) return;
    const cut = x.slice(start, end);
    const p = cut.reduce((a, s) => Math.max(a, Math.abs(s)), 0);
    if (!p) return;
    const fade = Math.min(cut.length, Math.round(RATE * 0.03));
    for (let i = 0; i < fade; i++) cut[cut.length - 1 - i] *= i / fade;
    for (let i = 0; i < 48; i++) cut[i] *= i / 48;
    for (let i = 0; i < cut.length; i++) cut[i] *= 0.9 / p;
    out.push({ die, rel: p / peak, samples: cut });
  });
  return out;
}

const all = [];
for (const die of DICE) {
  for (const n of [1, 2]) {
    try {
      all.push(...hitsIn(decode(join(packDir, die, `Roll ${n}${die}.wav`)), die));
    } catch {
      // a missing file just contributes nothing
    }
  }
}
const bucketOf = (h) => (h.rel >= 0.6 ? 'heavy' : h.rel >= 0.3 ? 'medium' : 'light');

// Spread each bucket's picks across die types (round-robin), loudest first within a die.
const picked = [];
for (const [bucket, count] of Object.entries(PER_BUCKET)) {
  const byDie = new Map(DICE.map((d) => [d, all.filter((h) => bucketOf(h) === bucket && h.die === d).sort((a, b) => b.rel - a.rel)]));
  let added = 0;
  while (added < count && [...byDie.values()].some((l) => l.length)) {
    for (const d of DICE) {
      const next = byDie.get(d).shift();
      if (next && added < count) {
        picked.push({ ...next, bucket });
        added++;
      }
    }
  }
}

/** Packs picked hits into one mono sprite: `<base>.mp3` + `<base>.json` under assets/sounds. */
function writeSprite(picked, base, source) {
  const gap = Math.round(RATE * GAP_S);
  const total = picked.reduce((n, h) => n + h.samples.length + gap, gap);
  const sprite = new Float32Array(total);
  const hits = [];
  let at = gap;
  for (const h of picked) {
    sprite.set(h.samples, at);
    hits.push({ start: +(at / RATE).toFixed(4), duration: +(h.samples.length / RATE).toFixed(4), level: h.bucket, die: h.die });
    at += h.samples.length + gap;
  }
  const work = join(tmpdir(), `dicer-sprite-${process.pid}-${base}`);
  mkdirSync(work, { recursive: true });
  const raw = join(work, 'sprite.f32');
  writeFileSync(raw, Buffer.from(sprite.buffer));
  const outDir = join(import.meta.dirname, '..', 'assets', 'sounds');
  mkdirSync(outDir, { recursive: true });
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(RATE), '-ac', '1', '-i', raw, '-c:a', 'libmp3lame', '-b:a', '96k', join(outDir, `${base}.mp3`)]);
  writeFileSync(join(outDir, `${base}.json`), JSON.stringify({ source, rate: RATE, hits }, null, 1) + '\n');
  rmSync(work, { recursive: true, force: true });
  const counts = ['heavy', 'medium', 'light'].map((b) => `${b}=${hits.filter((h) => h.level === b).length}`).join(' ');
  console.log(`${base}: ${hits.length} hits, ${(total / RATE).toFixed(2)} s ${counts}`);
}

writeSprite(picked, 'dice-hits', 'Halfwits & Failed Crits, SFX Pack - Rolling Dice (CC0)');

if (feltDir) {
  // Felt decays fast: shorter hits. Casino dice are d6s.
  const felt = [];
  for (const name of ['die-throw-1', 'die-throw-2', 'die-throw-3', 'die-throw-4', 'dice-throw-1', 'dice-throw-2', 'dice-throw-3']) {
    try {
      felt.push(...hitsIn(decode(join(feltDir, `${name}.ogg`)), 'd6', 0.15));
    } catch {
      // a missing file just contributes nothing
    }
  }
  writeSprite(felt.map((h) => ({ ...h, bucket: bucketOf(h) })), 'dice-hits-felt', 'Kenney, Casino Audio 1.1 (CC0), recorded on a felt table');
}
