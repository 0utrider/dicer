import * as THREE from 'three';
import { createPhysicsWorker, PhysicsClient } from '../src/physics/physics-client.js';
import { computeHulls } from '../src/physics/hulls.js';
import { DiceRenderer } from '../src/render/renderer.js';
import { loadDigitAtlas } from '../src/render/sdf-atlas.js';
import { TIERS, TIER_ORDER, flagsFor } from '../src/render/quality.js';
import { DiceBox } from '../src/throw/dice-box.js';
import { getShape } from '../src/core/dice-shapes.js';
import { readTopFace } from '../src/core/face-reader.js';
import { LOOKS } from '../src/look/looks.js';

// Preview: real throws (physics worker + wasm) with a look and a quality tier switcher and a
// frame-time log. window.__preview drives it from Playwright (tests/visual/throws.mjs).

const TYPES = ['d2', 'd4', 'd6', 'd8', 'd10', 'd12', 'd20'];
const params = new URLSearchParams(location.search);

const $ = (id) => document.getElementById(id);
const results = $('results');
let look = LOOKS[params.get('look')] ? params.get('look') : 'default';
let tier = TIERS[params.get('tier')] ? params.get('tier') : 'high';
let box = null;

const area = () => ({ left: 0, top: 0, width: window.innerWidth, height: window.innerHeight });

const atlas = await loadDigitAtlas('/assets/fonts');
const physics = new PhysicsClient(createPhysicsWorker, { hulls: computeHulls() });
const renderer = new DiceRenderer({
  container: document.body,
  pixelRatioCap: Number(params.get('cap')) || 1.5,
});
renderer.applyTier(TIERS[tier]);

// ---- frame log: the renderer's frame time (max of tick+render and the rAF interval), plus
// the GPU time the renderer itself measures with a timer query (P2-R13) when the browser
// exposes one: each newly resolved query once (the renderer's timer runs a few frames behind,
// and its last pending queries are dropped when the loop goes idle).
const frames = [];
const gpuTimes = [];
let recording = false;
let lastGpu = null;
renderer.onFrameTime((ms, sample) => {
  if (!recording) return;
  frames.push({ ms });
  if (sample?.gpu != null && sample.gpu !== lastGpu) gpuTimes.push(sample.gpu);
  lastGpu = sample?.gpu ?? null;
});
const glr = renderer.glRenderer;
const gl = glr.getContext();
const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');

// Production flags (the quality controller's flagsFor) with every client toggle on.
const flags = () => flagsFor(TIERS[tier], { interiors: true, engraving: true, glow: true });

function makeBox() {
  box?.dispose();
  box = new DiceBox({
    renderer,
    physics,
    atlas,
    getAppearance: () => LOOKS[look].appearance,
    getFlags: flags,
    getArea: area,
    timeBeforeHide: () => 1000,
  });
  window.__dicer = { box, renderer };
}

/** The value a die actually shows: the face whose world normal points up (down for d4). */
function shownValue(outer, type) {
  const shape = getShape(type);
  const inner = outer.children[0];
  const q = new THREE.Quaternion().multiplyQuaternions(outer.quaternion, inner.quaternion);
  return shape.values[readTopFace(shape, q)];
}

const randomSpec = (type) => {
  const shape = getShape(type);
  return { type, value: shape.values[Math.floor(Math.random() * shape.values.length)] };
};

async function throwSpecs(specs) {
  $('throw').disabled = $('throw10').disabled = true;
  results.textContent = '';
  const known = new Set(renderer.scene.children);
  const roll = box.roll(specs);
  await roll.landed;
  const outers = renderer.scene.children.filter((c) => !known.has(c) && c.userData.dicerDie);
  const lines = specs.map((spec, i) => {
    const shown = outers[i] ? shownValue(outers[i], spec.type) : undefined;
    const ok = shown === spec.value;
    return `<span class="${ok ? '' : 'bad'}">${spec.type}: target ${spec.value} landed ${shown} ${ok ? 'OK' : 'MISMATCH'}</span>`;
  });
  window.__dicer.last = lines.length;
  await roll.finished;
  $('throw').disabled = $('throw10').disabled = false;
  return lines;
}

const pct = (a, p) => {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

/**
 * Throws n dice (types cycle d4..d20 unless `types` is given) and returns the frame log
 * stats of that throw: renderer frame time and GPU render time, p50/p95/max.
 */
async function measuredThrow(n = 10, types = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']) {
  const specs = Array.from({ length: n }, (_, i) => randomSpec(types[i % types.length]));
  frames.length = 0;
  gpuTimes.length = 0;
  lastGpu = null;
  recording = true;
  try {
    await throwSpecs(specs);
  } finally {
    recording = false;
  }
  const ms = frames.map((f) => f.ms);
  const stats = {
    look,
    tier,
    dice: n,
    frames: ms.length,
    p50: pct(ms, 50),
    p95: pct(ms, 95),
    max: Math.max(...ms),
    gpuFrames: gpuTimes.length,
    gpuP50: pct(gpuTimes, 50),
    gpuP95: pct(gpuTimes, 95),
    pixelRatio: glr.getPixelRatio(),
    buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
  };
  const f = (x) => (x == null ? '-' : x.toFixed(2));
  results.textContent =
    `${n} dice, ${look} @ ${tier}: ${ms.length} frames, frame p50 ${f(stats.p50)} p95 ${f(stats.p95)} ms` +
    ` | GPU p50 ${f(stats.gpuP50)} p95 ${f(stats.gpuP95)} ms`;
  return stats;
}

function setLook(id) {
  if (!LOOKS[id]) throw new Error(`unknown look "${id}"`);
  look = id;
  $('look').value = id;
  box.invalidateMaterials();
}

function setTier(name) {
  if (!TIERS[name]) throw new Error(`unknown tier "${name}"`);
  tier = name;
  $('tier').value = name;
  renderer.applyTier(TIERS[name]);
  box.onResize();
  box.invalidateMaterials();
}

// ---- controls ----------------------------------------------------------------------------
for (const [id, l] of Object.entries(LOOKS)) $('look').add(new Option(l.name, id));
for (const t of TIER_ORDER) $('tier').add(new Option(t, t));
$('look').value = look;
$('tier').value = tier;
$('look').addEventListener('change', (e) => setLook(e.target.value));
$('tier').addEventListener('change', (e) => setTier(e.target.value));
window.addEventListener('resize', () => box?.onResize());
$('throw').addEventListener('click', async () => {
  results.innerHTML = (await throwSpecs(TYPES.map(randomSpec))).join('\n');
});
$('throw10').addEventListener('click', () => measuredThrow(10));
makeBox();
await physics.ready();
window.__preview = { setLook, setTier, measuredThrow, timer: !!timer };
$('status').textContent = 'ready';
$('throw').disabled = $('throw10').disabled = false;
