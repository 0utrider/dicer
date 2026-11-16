import * as THREE from 'three';
import { buildScene, cameraHeightFor, FOV_DEG } from '../src/render/scene.js';
import { configureRenderer } from '../src/render/renderer.js';
import { getShape } from '../src/core/dice-shapes.js';
import { buildDieGeometry } from '../src/core/chamfer.js';
import { readTopFace, rotationToShow, faceForValue } from '../src/core/face-reader.js';
import { createPetLayer, SCORCH_MS, SHIVER_MS, BRISTLE_MS, STARTLE_MS, MOOD_MS } from '../src/pet/chunk/pets.js';
import { createMoods } from '../src/pet/chunk/moods.js';
import { REST_HOP_MS } from '../src/pet/chunk/timeline.js';
import { REST_SPOTS } from '../src/pet/chunk/rest-spots.js';
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
function gameView(pet, w, h, bg, edge = 3, onPet = false, dieAt = null) {
  scene.background = new THREE.Color(bg);
  d20.visible = true;
  // Where the pet is (it rests in the ring around the middle, or is hopping there) and a d20
  // beside it, along the edge (dieAt: there instead).
  const [ox, oz] = OUT[edge];
  const bx = pet.position.x;
  const bz = pet.position.z;
  d20.position.x = dieAt ? dieAt.x : bx - oz * 2.3;
  d20.position.z = dieAt ? dieAt.z : bz + ox * 2.3;
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
function closeUp(pet, w, h, bg, { dist = 4.6, height = 2.6, side = 1.6, follow = true, die = false } = {}) {
  scene.background = new THREE.Color(bg);
  d20.visible = die; // die: the d20 where it was put (the reactions sheet's landed die)
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

// --- the move (a hand replay's alignFor; the cursor dodge is gone) ----------------------------
// The real layer: the pet rests after a roll (petStay Always), a hand replay puts it 4.5 die
// units along (alignFor), and the clock runs into the move. Seeded, so every frame of a strip
// takes the same path.
const MOVE_MS = REST_HOP_MS;
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
  const layer = createPetLayer({
    scene,
    getSetting: (k) => (k === 'petStay' ? -1 : undefined),
    playSound: () => {},
    now: () => clock,
    random: seeded(7),
    activeRolls: () => 1, // the replay flies: the pet stays where it put it
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
  // the thrower's layout has it 4.5 units along, toward the middle
  const to = { x: from.x - Math.sign(from.x || 1) * 4.5, z: from.z };
  const t0 = 4016;
  clock = t0;
  layer.alignFor([{ id: 'u', x: to.x, z: to.z, r: 0.9, h: 1.5 }], AREA, () => 100);
  at(t0);
  if (t > 0) at(t0 + t * MOVE_MS);
  return { layer, pet, from, to };
}

/** A fixed 3/4 view across the move's path, from its side, aimed at the pet's spot on the floor. */
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
  // a replay's move (alignFor): a side view across its path, then the game camera on the pet
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

// --- where pets rest (petRestSpot, pet interactions Task 2) ----------------------------------
// The real layer on a 1280 x 800 table (the window less the sidebar, which sits beside it) with
// Foundry-like UI drawn over the board: the scene controls, the scene navigation, the players
// list and the macro bar, fed to the layer through its document seam (uiRects). Three pets roll
// one after another in a roll area in the middle and come to rest at each choice.
const REST_PX = { w: 1280, h: 800 };
const REST_STAGE = {
  cx: 0,
  cz: 0,
  halfWidth: REST_PX.w / 2 / DIE_SIZE_PX,
  halfDepth: REST_PX.h / 2 / DIE_SIZE_PX,
  rect: { left: 0, top: 0, width: REST_PX.w, height: REST_PX.h },
};
const REST_UI = {
  'ui-left': { left: 0, top: 0, width: 60, height: 800, label: 'controls' },
  navigation: { left: 70, top: 10, width: 520, height: 40, label: 'navigation' },
  players: { left: 10, top: 640, width: 230, height: 150, label: 'players' },
  hotbar: { left: 380, top: 720, width: 520, height: 70, label: 'macro bar' },
};
const restDoc = {
  getElementById: (id) => (REST_UI[id] ? { getBoundingClientRect: () => REST_UI[id] } : null),
};
const REST_AREA = { cx: 0, cz: 0, halfWidth: 7, halfDepth: 4.5 };
function stageRest(choice) {
  clock = 0;
  const layer = createPetLayer({
    scene,
    getSetting: (k) => (k === 'petStay' ? -1 : k === 'petRestSpot' ? choice : undefined),
    playSound: () => {},
    now: () => clock,
    random: seeded(3),
    doc: restDoc,
    activeRolls: () => 0,
  });
  layer.areaChanged(REST_STAGE);
  const at = (ms) => layer.update((clock = ms));
  KINDS.forEach((kind, i) => {
    const key = `k${i}`;
    const t0 = clock;
    layer.begin(key, {
      spec: { userId: `u${i}`, kind, color: KIND_COLOR[kind], ghost: false },
      edge: 3,
      area: REST_AREA,
      centre: () => ({ x: REST_AREA.cx, z: REST_AREA.cz }),
    });
    for (let ms = t0; ms <= t0 + 900; ms += 16) at(ms);
    clock = t0 + 1000;
    layer.landed(key, [{ type: 'd20', value: 7 }]);
    layer.leave(key, 0);
    layer.end(key);
    for (let ms = t0 + 1000; ms <= t0 + 3000; ms += 16) at(ms);
  });
  return layer;
}
/** Six panels (each choice), the 1280 x 800 game view at half size with the UI outlined. */
function restSpots() {
  const SCALE = 0.5;
  const PW = REST_PX.w * SCALE;
  const PH = REST_PX.h * SCALE;
  const GAP = 16;
  const HEAD = 26;
  const COLS = 3;
  const rows = Math.ceil(REST_SPOTS.length / COLS);
  const { c, g } = newSheet(GAP + COLS * (PW + GAP), rows * (HEAD + PH + GAP) + GAP);
  api.fitArea(REST_STAGE);
  d20.visible = false;
  try {
    REST_SPOTS.forEach((choice, i) => {
      const x = GAP + (i % COLS) * (PW + GAP);
      const y = GAP + Math.floor(i / COLS) * (HEAD + PH + GAP);
      label(g, `${choice}${choice === 'dice' ? ' (default: the ring around the roll area)' : ''}`, x, y + 16, { size: 14 });
      const layer = stageRest(choice);
      try {
        scene.background = new THREE.Color(BG.dark);
        camera.clearViewOffset();
        renderer.setSize(REST_PX.w, REST_PX.h, false);
        renderer.render(scene, camera);
        g.drawImage(renderer.domElement, x, y + HEAD, PW, PH);
      } finally {
        layer.dispose();
      }
      // Foundry's UI over the board, and the roll area the pets threw in
      g.save();
      g.lineWidth = 1.5;
      for (const r of Object.values(REST_UI)) {
        g.fillStyle = 'rgba(40, 44, 60, 0.55)';
        g.strokeStyle = '#8fa3ff';
        g.fillRect(x + r.left * SCALE, y + HEAD + r.top * SCALE, r.width * SCALE, r.height * SCALE);
        g.strokeRect(x + r.left * SCALE, y + HEAD + r.top * SCALE, r.width * SCALE, r.height * SCALE);
        label(g, r.label, x + (r.left + 4) * SCALE + 2, y + HEAD + (r.top + 4) * SCALE + 12, { size: 10, color: '#c9d2ff' });
      }
      const ax = x + (REST_PX.w / 2 + (REST_AREA.cx - REST_AREA.halfWidth) * DIE_SIZE_PX) * SCALE;
      const ay = y + HEAD + (REST_PX.h / 2 + (REST_AREA.cz - REST_AREA.halfDepth) * DIE_SIZE_PX) * SCALE;
      g.setLineDash([5, 4]);
      g.strokeStyle = 'rgba(255, 220, 120, 0.6)';
      g.strokeRect(ax, ay, REST_AREA.halfWidth * 2 * DIE_SIZE_PX * SCALE, REST_AREA.halfDepth * 2 * DIE_SIZE_PX * SCALE);
      g.restore();
      g.strokeStyle = '#555b66';
      g.strokeRect(x - 0.5, y + HEAD - 0.5, PW + 1, PH + 1);
    });
  } finally {
    api.fitArea(STAGE);
  }
  return c.toDataURL('image/png');
}

// --- reactions to elemental dice (round 2, Task 4) -------------------------------------------
// The real layer: the pet rests after its roll (petStay Always), then another player's die with
// an element lands just inside the 2-die-width reach to its right (toward the close-up camera), drawn as the d20 in the
// element's colour. Each reaction at 3 moments in the close-up, and its middle one in the game view.
const REACTIONS = [
  { name: 'scorch', damageType: 'fire', ms: SCORCH_MS, die: '#ff7a2a', moments: [0.12, 0.4, 0.7] },
  { name: 'shiver', damageType: 'cold', ms: SHIVER_MS, die: '#9fdcff', moments: [0.15, 0.35, 0.75] },
  { name: 'bristle', damageType: 'electricity', ms: BRISTLE_MS, die: '#ffe14a', moments: [0.2, 0.42, 0.7] },
  { name: 'startle', damageType: 'acid', ms: STARTLE_MS, die: '#8fdc3a', moments: [0.08, 0.3, 0.6] },
];
function stageReaction({ kind, color, reaction, t }) {
  clock = 0;
  const layer = createPetLayer({
    scene,
    getSetting: (k) => (k === 'petStay' ? -1 : undefined),
    playSound: () => {},
    now: () => clock,
    random: seeded(7),
    activeRolls: () => 0,
    reducedMotion: () => false,
  });
  const px = { w: STAGE.halfWidth * 2 * DIE_SIZE_PX, h: STAGE.halfDepth * 2 * DIE_SIZE_PX };
  layer.areaChanged({ cx: 0, cz: 0, ...STAGE, rect: { left: 0, top: 0, width: px.w, height: px.h } });
  const at = (ms) => layer.update((clock = ms));
  const centre = () => ({ x: AREA.cx, z: AREA.cz });
  layer.begin('k', { spec: { userId: 'u', kind, color, ghost: false }, edge: 3, area: AREA, centre });
  for (let ms = 0; ms <= 900; ms += 16) at(ms);
  clock = 1000;
  layer.landed('k', [{ type: 'd20', value: 7 }]);
  layer.leave('k', 0);
  layer.end('k');
  for (let ms = 1000; ms <= 4000; ms += 16) at(ms);
  const pet = scene.children.find((c) => c.userData.dicerPet);
  // the die lands just inside the reach (2 die widths) to the pet's right, where the close-up sees it
  const fx = Math.sin(pet.rotation.y);
  const fz = Math.cos(pet.rotation.y);
  const dieAt = { x: pet.position.x + fz * 1.9, z: pet.position.z - fx * 1.9 };
  // another player throws it, their pet at the far edge (hidden: not part of the shot)
  layer.begin('o', {
    spec: { userId: 'o', kind: 'slime', color: '#888888', ghost: false },
    edge: pet.position.z > 0 ? 3 : 2,
    area: AREA,
    centre,
  });
  at(4016);
  clock = 4100;
  layer.landed('o', [{ type: 'd20', value: 7, ghost: false, x: dieAt.x, z: dieAt.z, damageType: reaction.damageType }]);
  at(4116);
  if (t > 0) at(4100 + t * reaction.ms);
  const other = scene.children.find((c) => c.userData.dicerPet && c !== pet);
  if (other) other.visible = false;
  return { layer, pet, dieAt };
}
/**
 * The game view as the player sees it: the whole stage rendered at its real size (so point sprites,
 * which size by the canvas height, are true to the game; gameView's small view-offset window draws
 * them several times too small), then the w x h window around the pet copied into the sheet.
 */
function fullGameCrop(g, pet, w, h, bg, dieAt, dx, dy) {
  scene.background = new THREE.Color(bg);
  d20.visible = true;
  d20.position.x = dieAt.x;
  d20.position.z = dieAt.z;
  const full = { w: STAGE.halfWidth * 2 * DIE_SIZE_PX, h: STAGE.halfDepth * 2 * DIE_SIZE_PX };
  camera.clearViewOffset();
  camera.position.set(0, H, 0);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  _v.set(pet.position.x, 0.5, pet.position.z).project(camera);
  const cx = ((_v.x + 1) / 2) * full.w;
  const cy = ((1 - _v.y) / 2) * full.h;
  renderer.setSize(full.w, full.h, false);
  renderer.render(scene, camera);
  g.drawImage(renderer.domElement, cx - w / 2, cy - h / 2, w, h, dx, dy, w, h);
}
/** 3 kinds x scorch/shiver/bristle/startle: 3 close-up moments and the game view at the middle one. */
function reactions() {
  const LW = 130;
  const CW = 230;
  const CH = 200;
  const HEAD = 30;
  const rows = KINDS.flatMap((kind) => REACTIONS.map((reaction) => ({ kind, reaction })));
  // the frosty tint on light pets: their own colour must still show
  for (const [kind, color] of [
    ['mimic', '#f2c9a0'],
    ['slime', '#f4e04d'],
  ])
    rows.push({ kind, color, reaction: REACTIONS[1] });
  const { c, g } = newSheet(LW + CW * 4, HEAD + rows.length * (CH + 4));
  ['moment 1', 'moment 2', 'moment 3', 'game view (48 px/die), moment 2'].forEach((n, i) =>
    label(g, n, LW + i * CW + CW / 2, 20, { align: 'center' }),
  );
  const was = d20.material.color.getHex();
  try {
    rows.forEach(({ kind, color = KIND_COLOR[kind], reaction }, r) => {
      const y = HEAD + r * (CH + 4);
      label(g, kind, 8, y + 22, { size: 14 });
      label(g, `${reaction.name} (${reaction.damageType})`, 8, y + 42, { size: 12, color: '#9aa0aa' });
      if (color !== KIND_COLOR[kind]) label(g, `light: ${color}`, 8, y + 60, { size: 12, color: '#9aa0aa' });
      d20.material.color.set(reaction.die);
      const cells = [...reaction.moments.map((t) => ({ t, game: false })), { t: reaction.moments[1], game: true }];
      cells.forEach(({ t, game }, i) => {
        const staged = stageReaction({ kind, color, reaction, t });
        try {
          d20.position.set(staged.dieAt.x, d20.position.y, staged.dieAt.z);
          if (game) fullGameCrop(g, staged.pet, CW - 2, CH - 2, BG.dark, staged.dieAt, LW + i * CW + 1, y + 1);
          else {
            closeUp(staged.pet, CW - 2, CH - 2, '#5b616b', { dist: 6.6, height: 3.4, side: 2.8, follow: false, die: true });
            blit(g, LW + i * CW + 1, y + 1);
          }
        } finally {
          staged.layer.dispose();
        }
        label(g, `t ${t.toFixed(2)} (${Math.round(t * reaction.ms)} ms)`, LW + i * CW + 8, y + CH - 10, { size: 11, color: '#d0d4da' });
      });
    });
  } finally {
    d20.material.color.setHex(was);
  }
  return c.toDataURL('image/png');
}

// --- moods (round 3, Task 5) -----------------------------------------------------------------
// The real layer: the owner's recent d20s are already in the mood history (neutral: none; proud:
// 20, 20, 15; sulk: 1, 1, 4), their pet rolls a d6 (no reaction of its own, the history unchanged)
// and comes to rest (petStay Always), where it settles into the mood. Settled, static: the shots.
const MOOD_HISTORY = { neutral: [], proud: [20, 20, 15], sulk: [1, 1, 4] };
/** `settle`: stop that far (0..1) into the mood's settle instead of after it (null: settled). */
function stageMood({ kind, color, mood, settle = null }) {
  clock = 0;
  const history = createMoods();
  history.record('u', MOOD_HISTORY[mood]);
  const layer = createPetLayer({
    scene,
    getSetting: (k) => (k === 'petStay' ? -1 : undefined),
    playSound: () => {},
    now: () => clock,
    random: seeded(7),
    activeRolls: () => 0,
    reducedMotion: () => false,
    moods: history,
  });
  const px = { w: STAGE.halfWidth * 2 * DIE_SIZE_PX, h: STAGE.halfDepth * 2 * DIE_SIZE_PX };
  layer.areaChanged({ cx: 0, cz: 0, ...STAGE, rect: { left: 0, top: 0, width: px.w, height: px.h } });
  const at = (ms) => layer.update((clock = ms));
  const centre = () => ({ x: AREA.cx, z: AREA.cz });
  layer.begin('k', { spec: { userId: 'u', kind, color, ghost: false }, edge: 3, area: AREA, centre });
  for (let ms = 0; ms <= 900; ms += 16) at(ms);
  clock = 1000;
  layer.landed('k', [{ type: 'd6', value: 4 }]);
  layer.leave('k', 0);
  layer.end('k');
  const pet = scene.children.find((c) => c.userData.dicerPet);
  let ms = 1000;
  for (; ms <= 4000 + MOOD_MS; ms += 16) {
    at(ms);
    if (settle !== null && pet.userData.dicerPet.phase === mood) break;
  }
  if (settle !== null) at(ms + settle * MOOD_MS);
  return { layer, pet };
}
/** 3 kinds x neutral, proud, sulk at rest (close-up), the proud settle's twinkle, and the game view of each. */
function moods() {
  const LW = 110;
  const CW = 210;
  const CH = 190;
  const HEAD = 30;
  const MOODS = ['neutral', 'proud', 'sulk'];
  const cols = [
    ...MOODS.map((mood) => ({ mood, name: mood })),
    { mood: 'proud', settle: 0.55, name: 'proud, settling (twinkle)' },
    ...MOODS.map((mood) => ({ mood, game: true, name: `game view: ${mood}` })),
  ];
  const { c, g } = newSheet(LW + CW * cols.length, HEAD + KINDS.length * (CH + 4));
  cols.forEach((col, i) => label(g, col.name, LW + i * CW + CW / 2, 20, { align: 'center', size: 12 }));
  KINDS.forEach((kind, r) => {
    const y = HEAD + r * (CH + 4);
    label(g, kind, 8, y + 22, { size: 14 });
    cols.forEach((col, i) => {
      const staged = stageMood({ kind, color: KIND_COLOR[kind], mood: col.mood, settle: col.settle ?? null });
      try {
        const { pet } = staged;
        if (col.game) {
          const fx = Math.sin(pet.rotation.y);
          const fz = Math.cos(pet.rotation.y);
          const dieAt = { x: pet.position.x + fz * 2.3, z: pet.position.z - fx * 2.3 };
          fullGameCrop(g, pet, CW - 2, CH - 2, BG.dark, dieAt, LW + i * CW + 1, y + 1);
        } else {
          pet.updateMatrixWorld(true); // never rendered yet: closeUp aims at its box
          closeUp(pet, CW - 2, CH - 2, '#5b616b', { dist: 5.6, height: 3, side: 2.2 });
          blit(g, LW + i * CW + 1, y + 1);
        }
      } finally {
        staged.layer.dispose();
      }
    });
  });
  return c.toDataURL('image/png');
}

const show = (url) => (document.getElementById('sheet').src = url);
const SHEETS = { grid, colours, strips, splat, restSpots, reactions, moods };
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
window.__pets = { grid, colours, strips, splat, restSpots, reactions, moods, moves: () => strips(KINDS, 'move'), errors, ready: true };
