import * as THREE from 'three';
import { buildScene, cameraHeightFor, FOV_DEG } from '../src/render/scene.js';
import { configureRenderer } from '../src/render/renderer.js';
import { getShape } from '../src/core/dice-shapes.js';
import { buildDieGeometry } from '../src/core/chamfer.js';
import { readTopFace, rotationToShow, faceForValue } from '../src/core/face-reader.js';
import { createPetLayer } from '../src/pet/chunk/pets.js';
import { DIE_SIZE_PX } from '../src/throw/dice-box.js';

// Owner review page for the dice pets (Task 4). Every cell is the REAL pet layer (placement,
// hop, contact shadow) on the real studio lighting (buildScene + its PMREM environment), drawn
// twice: (a) the game view, Dicer's top-down camera (FOV 20, at the height that fits a 1776x998
// stage) cropped around the pet at the true 48 CSS px per die, with a d20 beside it for scale;
// (b) a 3/4 close-up to judge the modelling. window.__pets drives it from tests/visual/pets.mjs.

const errors = [];
window.addEventListener('error', (e) => errors.push(`page error: ${e.message}`));
window.addEventListener('unhandledrejection', (e) =>
  errors.push(`unhandled: ${e.reason?.stack ?? e.reason}`),
);

// The creatures' idle clock follows the page clock below, so every shot is repeatable.
let clock = 0;
performance.now = () => clock;

const STAGE = { halfWidth: 1776 / 2 / DIE_SIZE_PX, halfDepth: 998 / 2 / DIE_SIZE_PX };
const AREA = { cx: 0, cz: 0, ...STAGE };
const BG = { dark: '#3b3f38', light: '#cdbb93' }; // a dark battle map, a parchment one

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
configureRenderer(renderer);
const api = buildScene();
const { scene, camera } = api;
api.setEnvironment(renderer);
api.fitArea(STAGE);
const H = cameraHeightFor(STAGE.halfDepth, FOV_DEG);

// A d20 at rest (20 up) as the scale reference, with a blob shadow like a die's.
const d20Shape = getShape('d20');
const d20Geo = buildDieGeometry(d20Shape);
const d20 = new THREE.Mesh(
  d20Geo,
  new THREE.MeshStandardMaterial({ color: '#ece6d6', roughness: 0.35 }),
);
{
  const r = rotationToShow(
    d20Shape,
    readTopFace(d20Shape, { x: 0, y: 0, z: 0, w: 1 }),
    faceForValue(d20Shape, 20),
  );
  d20.quaternion.set(r.x, r.y, r.z, r.w);
  d20.updateMatrixWorld(true);
  d20.position.y = -new THREE.Box3().setFromObject(d20).min.y;
}
scene.add(d20);

const close = new THREE.PerspectiveCamera(26, 1, 0.1, 100);

const PHASE_MS = { enter: 350, throw: 250, react: 1200, exit: 450 };
const DICE = { crit: [20], fumble: [1], mixed: [20, 1], plain: [7] };

/** Builds a layer with one pet and runs its timeline to (phase, t). Returns { layer, pet }. */
function stagePet({ kind, color, phase, t = 0.5, reaction = 'plain', edge = 3, glance = 0 }) {
  clock = 0;
  const layer = createPetLayer({
    scene,
    getSetting: () => undefined,
    playSound: () => {},
    now: () => clock,
  });
  let centre = { x: AREA.cx, z: AREA.cz };
  layer.begin('k', {
    spec: { userId: 'u', kind, color, ghost: false },
    edge,
    area: AREA,
    centre: () => centre,
  });
  const at = (ms) => layer.update((clock = ms));
  at(0);
  if (phase === 'enter') at(t * PHASE_MS.enter);
  else if (phase === 'throw') at(PHASE_MS.enter + t * PHASE_MS.throw);
  else {
    at(700);
    if (glance) {
      // the dice drift aside: the body lags, the eyes lead
      centre = { x: AREA.cx + glance * 12, z: AREA.cz };
      at(716);
    }
    if (phase === 'react' || phase === 'exit') {
      clock = 1000;
      layer.landed(
        'k',
        DICE[reaction].map((value) => ({ type: 'd20', value })),
      );
      at(phase === 'react' ? 1000 + t * PHASE_MS.react : 2200 + Math.min(t, 0.97) * PHASE_MS.exit);
    }
  }
  const pet = scene.children.find((c) => c.userData.dicerPet);
  return { layer, pet };
}

const _v = new THREE.Vector3();
/** Renders the game view: the real camera, a window of w x h px centred on the pet. */
const OUT = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
function gameView(pet, w, h, bg, edge = 3, onPet = false) {
  scene.background = new THREE.Color(bg);
  d20.visible = true;
  // The pet's standing place (as pets.js computes it) and a d20 beside it along the edge.
  const [ox, oz] = OUT[edge];
  const d = (edge < 2 ? AREA.halfWidth : AREA.halfDepth) - 0.6 * 1.5;
  const bx = AREA.cx + ox * d;
  const bz = AREA.cz + oz * d;
  d20.position.x = bx - oz * 2.3;
  d20.position.z = bz + ox * 2.3;
  const full = { w: STAGE.halfWidth * 2 * DIE_SIZE_PX, h: STAGE.halfDepth * 2 * DIE_SIZE_PX };
  camera.clearViewOffset();
  camera.position.set(0, H, 0);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  if (onPet) _v.set(pet.position.x, 0.5, pet.position.z).project(camera);
  else _v.set((bx + d20.position.x) / 2, 0.5, (bz + d20.position.z) / 2).project(camera);
  const cx = ((_v.x + 1) / 2) * full.w;
  const cy = ((1 - _v.y) / 2) * full.h;
  camera.setViewOffset(full.w, full.h, cx - w / 2, cy - h / 2, w, h);
  renderer.setSize(w, h, false);
  renderer.render(scene, camera);
  camera.clearViewOffset();
}

/** Renders a 3/4 close-up from the front-right, above. */
function closeUp(pet, w, h, bg, { dist = 4.6, height = 2.6, side = 1.6, follow = true } = {}) {
  scene.background = new THREE.Color(bg);
  d20.visible = false;
  // the pet's forward in the world
  const yaw = pet.rotation.y;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  // follow: aim at the pet's middle (it may be in the air); else a fixed aim, so jumps show
  const target = follow
    ? new THREE.Box3().setFromObject(pet.children[0]).getCenter(_v)
    : _v.set(pet.position.x, 0.9, pet.position.z);
  target.y = Math.max(0.6, target.y);
  // back off for the mimic's wide chest, so every pet fills the cell alike
  const wide = pet.children[0].name === 'mimic' ? 1.3 : 1;
  dist *= wide;
  height = 0.6 + (height - 0.6) * wide;
  side *= wide;
  close.aspect = w / h;
  close.position.set(
    target.x + fx * dist + fz * side,
    target.y - 0.6 + height,
    target.z + fz * dist - fx * side,
  );
  close.up.set(0, 1, 0);
  close.lookAt(target);
  close.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  renderer.render(scene, close);
}

function newSheet(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#1d1f24';
  g.fillRect(0, 0, w, h);
  return { c, g };
}
function label(g, text, x, y, { size = 13, color = '#e8e8e8', align = 'left' } = {}) {
  g.font = `600 ${size}px system-ui, sans-serif`;
  g.fillStyle = color;
  g.textAlign = align;
  g.fillText(text, x, y);
}
const blit = (g, x, y) => g.drawImage(renderer.domElement, x, y);

const KINDS = ['mimic', 'slime', 'dragonling'];
const COLUMNS = [
  { name: 'enter', phase: 'enter', t: 0.55 },
  { name: 'throw', phase: 'throw', t: 0.5 },
  { name: 'watch', phase: 'watch', glance: 1 },
  { name: 'react: crit', phase: 'react', reaction: 'crit', t: 0.5 },
  { name: 'react: fumble', phase: 'react', reaction: 'fumble', t: 0.8 },
  { name: 'react: mixed', phase: 'react', reaction: 'mixed', t: 0.4 },
  { name: 'react: plain', phase: 'react', reaction: 'plain', t: 0.72 },
];
const KIND_COLOR = { mimic: '#c0392b', slime: '#2e9e5b', dragonling: '#7b4bc4' };

// --- the dodge (pet dodge Task 2) -------------------------------------------------------------
// The real layer: the pet rests after a roll (petStay Always), the cursor comes up beside it on
// the table side (a pointermove through the layer's own listener), and the clock runs into the
// move. Seeded, so every frame of a strip takes the same path.
const MOVE_MS = { mimic: 450, slime: 450, dragonling: 600 };
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function stageMove({ kind, color, t = 0.5 }) {
  clock = 0;
  let onMove = null;
  const win = { addEventListener: (type, fn) => type === 'pointermove' && (onMove = fn), removeEventListener() {} };
  const layer = createPetLayer({
    scene,
    getSetting: (k) => (k === 'petStay' ? -1 : undefined),
    playSound: () => {},
    now: () => clock,
    random: seeded(7),
    win,
    activeRolls: () => 0,
  });
  const px = { w: STAGE.halfWidth * 2 * DIE_SIZE_PX, h: STAGE.halfDepth * 2 * DIE_SIZE_PX };
  layer.areaChanged({ cx: 0, cz: 0, ...STAGE, rect: { left: 0, top: 0, width: px.w, height: px.h } });
  const at = (ms) => layer.update((clock = ms));
  layer.begin('k', {
    spec: { userId: 'u', kind, color, ghost: false },
    edge: 3,
    area: AREA,
    centre: () => ({ x: AREA.cx, z: AREA.cz }),
  });
  for (let ms = 0; ms <= 900; ms += 16) at(ms);
  clock = 1000;
  layer.landed('k', [{ type: 'd20', value: 7 }]);
  layer.leave('k', 0);
  layer.end('k');
  for (let ms = 1000; ms <= 4000; ms += 16) at(ms);
  const pet = scene.children.find((c) => c.userData.dicerPet);
  const from = { x: pet.position.x, z: pet.position.z };
  // the cursor comes up on the pet's table side
  const len = Math.hypot(from.x, from.z) || 1;
  const cx = from.x - (from.x / len) * 0.8;
  const cz = from.z - (from.z / len) * 0.8;
  onMove({ clientX: px.w / 2 + cx * DIE_SIZE_PX, clientY: px.h / 2 + cz * DIE_SIZE_PX, target: null });
  const t0 = 4016;
  at(t0);
  const ob = layer.obstaclesFor({ spec: null, edge: 0, area: AREA }).find((o) => o.id === 'u');
  const to = { x: ob.x, z: ob.z };
  if (t > 0) at(t0 + t * MOVE_MS[kind]);
  return { layer, pet, from, to };
}

/** A fixed 3/4 view across the dodge's path, from its side, aimed at the pet's spot on the floor. */
function moveClose(pet, w, h, bg, from, to, dist = 7.5) {
  scene.background = new THREE.Color(bg);
  d20.visible = false;
  let dx = to.x - from.x;
  let dz = to.z - from.z;
  const len = Math.hypot(dx, dz) || 1;
  dx /= len;
  dz /= len;
  // from the side of the path (its right), a little in front, above
  const sx = dz;
  const sz = -dx;
  close.aspect = w / h;
  close.position.set(pet.position.x + sx * dist + dx * 2, 4.2, pet.position.z + sz * dist + dz * 2);
  close.up.set(0, 1, 0);
  close.lookAt(pet.position.x, 0.9, pet.position.z);
  close.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  renderer.render(scene, close);
}

function shot(opts, fn) {
  const staged = opts.phase === 'move' ? stageMove(opts) : stagePet(opts);
  const { layer, pet } = staged;
  try {
    if (!pet) throw new Error(`no pet for ${JSON.stringify(opts)}`);
    fn(pet, staged);
  } finally {
    layer.dispose();
  }
}

/** 3 kinds x 7 columns, each a game-view cell over a close-up cell. */
function grid() {
  const LW = 104;
  const CW = 240;
  const GH = 190;
  const CH = 230;
  const HEAD = 30;
  const { c, g } = newSheet(LW + CW * COLUMNS.length, HEAD + KINDS.length * (GH + CH + 6));
  COLUMNS.forEach((col, i) => label(g, col.name, LW + i * CW + CW / 2, 20, { align: 'center' }));
  KINDS.forEach((kind, k) => {
    const y0 = HEAD + k * (GH + CH + 6);
    label(g, kind, 8, y0 + 20, { size: 15 });
    label(g, 'game view', 8, y0 + 40, { size: 11, color: '#9aa0aa' });
    label(g, '(48 px/die)', 8, y0 + 54, { size: 11, color: '#9aa0aa' });
    label(g, 'close-up', 8, y0 + GH + 20, { size: 11, color: '#9aa0aa' });
    COLUMNS.forEach((col, i) => {
      shot({ kind, color: KIND_COLOR[kind], ...col }, (pet) => {
        gameView(pet, CW - 2, GH - 2, BG.dark);
        blit(g, LW + i * CW + 1, y0 + 1);
        closeUp(pet, CW - 2, CH - 2, '#5b616b');
        blit(g, LW + i * CW + 1, y0 + GH + 1);
      });
    });
  });
  return c.toDataURL('image/png');
}

const COLOURS = ['#1b2340', '#c0392b', '#f4f1de'];
/** Each kind in a very dark, a mid and a very light colour, on a dark and a light map. */
function colours() {
  const LW = 104;
  const CW = 200;
  const CH = 170;
  const HEAD = 46;
  const per = 3;
  const { c, g } = newSheet(LW + CW * COLOURS.length * per, HEAD + KINDS.length * (CH + 6));
  COLOURS.forEach((col, i) => {
    const x = LW + i * CW * per;
    label(g, col, x + (CW * per) / 2, 18, { align: 'center' });
    ['dark map', 'light map', 'close-up'].forEach((n, j) =>
      label(g, n, x + j * CW + CW / 2, 38, { size: 11, color: '#9aa0aa', align: 'center' }),
    );
  });
  KINDS.forEach((kind, k) => {
    const y = HEAD + k * (CH + 6);
    label(g, kind, 8, y + 20, { size: 15 });
    COLOURS.forEach((color, i) => {
      const x = LW + i * CW * per;
      shot(
        { kind, color, phase: 'react', reaction: 'plain', t: 0.05, edge: [3, 2, 3][k] },
        (pet) => {
          gameView(pet, CW - 2, CH - 2, BG.dark, [3, 2, 3][k]);
          blit(g, x + 1, y + 1);
          gameView(pet, CW - 2, CH - 2, BG.light, [3, 2, 3][k]);
          blit(g, x + CW + 1, y + 1);
          closeUp(pet, CW - 2, CH - 2, '#5b616b');
          blit(g, x + 2 * CW + 1, y + 1);
        },
      );
    });
  });
  return c.toDataURL('image/png');
}

const STRIP_ROWS = [
  { phase: 'enter' },
  { phase: 'throw' },
  { phase: 'react', reaction: 'crit' },
  { phase: 'react', reaction: 'fumble' },
  { phase: 'react', reaction: 'mixed' },
  { phase: 'react', reaction: 'plain' },
  { phase: 'exit', reaction: 'fumble' },
  // the game camera at the true 48 px/die, centred on the pet
  { phase: 'react', reaction: 'crit', view: 'game' },
  { phase: 'react', reaction: 'fumble', view: 'game' },
  // the dodge out of the cursor's way: a side view across its path, then the game camera on the pet
  { phase: 'move' },
  { phase: 'move', view: 'game' },
];
/** Each phase as 8 frames (t = 0 .. 1) of the close-up: the motion curves at a glance. */
function strips(kinds = KINDS, only = null) {
  const LW = 120;
  const N = 8;
  const S = 130;
  const rows = kinds.flatMap((kind) => STRIP_ROWS.filter((r) => !only || r.phase === only).map((r) => ({ kind, ...r })));
  const { c, g } = newSheet(LW + N * S, 24 + rows.length * S);
  for (let i = 0; i < N; i++)
    label(g, `t ${(i / (N - 1)).toFixed(2)}`, LW + i * S + S / 2, 16, {
      size: 11,
      align: 'center',
    });
  rows.forEach((row, r) => {
    const y = 24 + r * S;
    label(g, row.kind, 6, y + 20, { size: 13 });
    const name = row.reaction ? `${row.phase}: ${row.reaction}` : row.phase;
    label(g, row.view ? `${name} (game)` : name, 6, y + 38, {
      size: 11,
      color: '#9aa0aa',
    });
    for (let i = 0; i < N; i++) {
      shot({ kind: row.kind, color: KIND_COLOR[row.kind], ...row, t: i / (N - 1) }, (pet, staged) => {
        if (row.view === 'game') gameView(pet, S - 2, S - 2, BG.dark, 3, true);
        else if (row.phase === 'move') moveClose(pet, S - 2, S - 2, '#5b616b', staged.from, staged.to);
        else
          closeUp(pet, S - 2, S - 2, '#5b616b', {
            dist: 6.4,
            height: 3.4,
            side: 2.2,
            follow: false,
          });
        blit(g, LW + i * S + 1, y + 1);
      });
    }
  });
  return c.toDataURL('image/png');
}

// --- the splat (Task 5) ---------------------------------------------------------------------
// Each cell drives the real layer: the pet stands watching, a die hits it (PetHook.hit) at
// HIT_AT, and the clock runs to the frame: a wobble (a slow hit), the burst (SPLAT_MS 500), the
// puddle settling (PUDDLE_MS 600) and the reform on the owner's next roll (REFORM_MS 400).
const HIT_AT = 700;
const SPLAT = { wobble: 400, burst: 500, puddle: 600, reform: 400 };
function stageSplat({ kind, color, phase, t = 0, edge = 3 }) {
  const { layer, pet } = stagePet({ kind, color, phase: 'watch', edge });
  // the die comes from the dice side, so the pet recoils outward
  const [ox, oz] = OUT[edge];
  const hitFrom = { x: pet.position.x - ox, z: pet.position.z - oz };
  const at = (ms) => layer.update((clock = ms));
  if (phase === 'wobble') {
    layer.hit('u', { speed: 5, position: hitFrom });
    at(HIT_AT + t * SPLAT.wobble);
    return { layer, pet };
  }
  layer.hit('u', { speed: 20, position: hitFrom });
  if (phase === 'burst') {
    at(HIT_AT + t * SPLAT.burst);
    return { layer, pet };
  }
  at(HIT_AT + SPLAT.burst);
  if (phase === 'puddle') {
    at(HIT_AT + SPLAT.burst + t * SPLAT.puddle);
    return { layer, pet };
  }
  at(HIT_AT + SPLAT.burst + SPLAT.puddle + 50); // at rest
  const t0 = HIT_AT + SPLAT.burst + SPLAT.puddle + 400;
  clock = t0;
  layer.begin('k2', {
    spec: { userId: 'u', kind, color, ghost: false },
    edge,
    area: AREA,
    centre: () => ({ x: AREA.cx, z: AREA.cz }),
  });
  at(t0);
  at(t0 + t * SPLAT.reform);
  return { layer, pet };
}
function splatShot(opts, fn) {
  const { layer, pet } = stageSplat(opts);
  try {
    if (!pet) throw new Error(`no pet for ${JSON.stringify(opts)}`);
    fn(pet);
  } finally {
    layer.dispose();
  }
}

/** The game camera at 48 px/die: the pet left of centre, a d20 beside it along the edge. */
function splatGame(pet, w, h, bg, edge = 3) {
  scene.background = new THREE.Color(bg);
  d20.visible = true;
  const [ox, oz] = OUT[edge];
  // along the edge (perpendicular to the way out)
  const ax = -oz;
  const az = ox;
  d20.position.x = pet.position.x + ax * 3.0;
  d20.position.z = pet.position.z + az * 3.0;
  const full = { w: STAGE.halfWidth * 2 * DIE_SIZE_PX, h: STAGE.halfDepth * 2 * DIE_SIZE_PX };
  camera.clearViewOffset();
  camera.position.set(0, H, 0);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  _v.set(pet.position.x + ax * 0.45, 0.2, pet.position.z + az * 0.45).project(camera);
  const cx = ((_v.x + 1) / 2) * full.w;
  const cy = ((1 - _v.y) / 2) * full.h;
  camera.setViewOffset(full.w, full.h, cx - w / 2, cy - h / 2, w, h);
  renderer.setSize(w, h, false);
  renderer.render(scene, camera);
  camera.clearViewOffset();
}

/** A steep 3/4 close-up aimed at the pet's spot on the floor (the creature may be hidden). */
function splatClose(pet, w, h, bg) {
  scene.background = new THREE.Color(bg);
  d20.visible = false;
  const yaw = pet.rotation.y;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const tx = pet.position.x;
  const tz = pet.position.z;
  close.aspect = w / h;
  close.position.set(tx + fx * 4.2 + fz * 1.6, 5.4, tz + fz * 4.2 - fx * 1.6);
  close.up.set(0, 1, 0);
  close.lookAt(tx, 0.35, tz);
  close.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  renderer.render(scene, close);
}

const SPLAT_ROWS = [
  { name: 'wobble', phase: 'wobble', ts: [0.05, 0.15, 0.3, 0.5, 0.75] },
  { name: 'burst', phase: 'burst', ts: [0, 0.08, 0.18, 0.3, 0.45, 0.65, 1] },
  { name: 'puddle', phase: 'puddle', ts: [0, 0.3, 0.54, 0.8, 1] },
  { name: 'reform', phase: 'reform', ts: [0.1, 0.25, 0.38, 0.47, 0.58, 0.75, 1] },
];
const SPLAT_COLOURS = ['#1b2340', '#c0392b', '#f4f1de'];
/**
 * Per kind: wobble, burst, puddle and reform frames (game view over close-up), then the resting
 * puddle in a dark, a mid and a very light colour on a dark and a light map.
 */
function splat(kinds = KINDS) {
  const LW = 110;
  const CW = 236;
  const GH = 170;
  const CH = 160;
  const N = 7;
  const HEAD = 8;
  const rowH = 18 + GH + CH + 6;
  const colourH = 22 + GH + 6;
  const { c, g } = newSheet(
    LW + CW * N,
    HEAD + kinds.length * (SPLAT_ROWS.length * rowH + colourH + 12),
  );
  let y = HEAD;
  for (const kind of kinds) {
    for (const row of SPLAT_ROWS) {
      label(g, kind, 8, y + 34, { size: 15 });
      label(g, row.name, 8, y + 52, { size: 12, color: '#9aa0aa' });
      label(g, 'game (48 px/die)', 8, y + 78, { size: 10, color: '#9aa0aa' });
      label(g, 'close-up', 8, y + 18 + GH + 20, { size: 10, color: '#9aa0aa' });
      row.ts.forEach((t, i) => {
        label(g, `t ${t.toFixed(2)}`, LW + i * CW + CW / 2, y + 13, {
          size: 11,
          align: 'center',
          color: '#c8ccd4',
        });
        splatShot({ kind, color: KIND_COLOR[kind], phase: row.phase, t }, (pet) => {
          splatGame(pet, CW - 2, GH - 2, BG.dark);
          blit(g, LW + i * CW + 1, y + 18 + 1);
          splatClose(pet, CW - 2, CH - 2, '#5b616b');
          blit(g, LW + i * CW + 1, y + 18 + GH + 1);
        });
      });
      y += rowH;
    }
    label(g, kind, 8, y + 34, { size: 15 });
    label(g, 'puddle colours', 8, y + 52, { size: 12, color: '#9aa0aa' });
    SPLAT_COLOURS.forEach((color, i) => {
      ['dark map', 'light map'].forEach((map, j) => {
        const x = LW + (i * 2 + j) * CW;
        label(g, `${color} ${map}`, x + CW / 2, y + 15, {
          size: 11,
          align: 'center',
          color: '#c8ccd4',
        });
        splatShot({ kind, color, phase: 'puddle', t: 1 }, (pet) => {
          splatGame(pet, CW - 2, GH - 2, j ? BG.light : BG.dark);
          blit(g, x + 1, y + 22 + 1);
        });
      });
    });
    y += colourH + 12;
  }
  return c.toDataURL('image/png');
}

const show = (url) => (document.getElementById('sheet').src = url);
const SHEETS = { grid, colours, strips, splat };
for (const b of document.querySelectorAll('[data-sheet]'))
  b.addEventListener('click', () => {
    try {
      show(SHEETS[b.dataset.sheet]());
    } catch (err) {
      errors.push(String(err?.stack ?? err));
    }
  });
show(grid());
document.getElementById('status').textContent = 'ready';
window.__pets = { grid, colours, strips, splat, moves: () => strips(KINDS, 'move'), errors, ready: true };
