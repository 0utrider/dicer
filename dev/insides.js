// Living-insides sheet and perf page. ?inside=<id> builds one sheet of d20s: the inside at rest
// with motion off, then 400 ms into a scripted tumble and 1 s after landing (the motion driven
// directly through motion.js stepMotion, written into each die's own material uniforms), on a dark
// and a light table at steps 16 and 48, plus a reduced-motion row. One renderer, a viewport per
// cell, render on demand. window.__insides also serves the perf probe (20 dice, moving vs frozen).
import * as THREE from 'three';
import { buildScene } from '../src/render/scene.js';
import { configureRenderer } from '../src/render/renderer.js';
import { loadDigitAtlas } from '../src/render/sdf-atlas.js';
import { createDiceMaterial } from '../src/render/dice-material.js';
import { requestLookExtras } from '../src/render/extras-loader.js';
import { buildDieGeometry } from '../src/core/chamfer.js';
import { getShape, labelFor } from '../src/core/dice-shapes.js';
import { restingQuaternion, minY } from '../src/core/resting.js';
import { LOOKS } from '../src/look/looks.js';
import { TIERS, flagsFor } from '../src/render/quality.js';
import { createMotion, stepMotion } from '../src/render/extras/insides/motion.js';
import { insideMotion } from '../src/render/extras/insides/live.js';

const CLEAR = { type: 'resin', color: '#eef4f6', color2: '#c9d8e0', roughness: 0.05 };
const from = (id, interior, body) => ({
  ...LOOKS[id].appearance,
  body: { ...LOOKS[id].appearance.body, ...body },
  interior: { ...LOOKS[id].appearance.interior, ...interior },
});
const abyss = (extra) => from('abyss-liquid', extra);
const withBody = (body, interior) => ({
  ...LOOKS.default.appearance,
  body: { ...LOOKS.default.appearance.body, ...body },
  interior: { ...LOOKS.default.appearance.interior, ...interior },
});

/** Every inside the sheets cover: body colours from looks.js presets where one exists. */
export const INSIDES = {
  liquid: () => from('abyss-liquid', {}),
  'liquid-bubble': () => abyss({ bubble: true }),
  'liquid-sand': () => abyss({ sand: true }),
  glitter: () => from('starlit-glitter', {}),
  swirl: () => from('smoke-swirl', {}),
  nebula: () => from('galaxy-nebula', {}),
  smoke: () => withBody(CLEAR, { type: 'smoke', colors: ['#2a2440', '#9a8fc8'], density: 0.6 }),
  eye: () => withBody({ ...CLEAR, color: '#e6eef2', color2: '#b8c8d4' }, { type: 'eye', colors: ['#3fae5a', '#fff4ea'], density: 0.4 }),
  runes: () =>
    withBody({ ...CLEAR, color: '#1a2036', color2: '#0a0d18' }, { type: 'shape', shape: 'runes', colors: ['#7fd0ff', '#c8a2ff'], density: 0.5 }),
  dragon: () => withBody(CLEAR, { type: 'shape', shape: 'dragon', colors: ['#8a1c1c', '#d9603a'], density: 0.5 }),
  fire: () => withBody({ ...CLEAR, color: '#3a3438', color2: '#1a1618' }, { type: 'fire', colors: ['#ffd36a', '#d8401a'], density: 0.6 }),
  lava: () => withBody({ ...CLEAR, color: '#3a3438', color2: '#1a1618' }, { type: 'lava', colors: ['#ffb030', '#c0300c'], density: 0.55 }),
};

const params = new URLSearchParams(location.search);
const INSIDE = params.get('inside') || 'liquid';
const CELL = 300;
const ROW_LABEL_PX = 150;
const TABLES = { dark: '#16181d', light: '#d9d4c7' };
const TUMBLE = { axis: new THREE.Vector3(0.4, 1, 0.3).normalize(), angle: 4, seconds: 1 };
const DT = 1 / 60;
const FLIGHT_MS = 400;
const LAND_MS = 1000;

const errors = [];
const $ = (id) => document.getElementById(id);
function report(message) {
  errors.push(message);
  console.error(`dicer insides: ${message}`);
  $('status').textContent = `${errors.length} error(s): ${errors[0].slice(0, 200)}`;
  $('status').classList.add('bad');
}
window.addEventListener('error', (e) => report(`page error: ${e.message}`));
window.addEventListener('unhandledrejection', (e) => report(`unhandled: ${e.reason?.stack ?? e.reason}`));

const canvas = document.createElement('canvas');
const renderer = configureRenderer(
  new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, logarithmicDepthBuffer: false, powerPreference: 'high-performance' }),
);
renderer.debug.checkShaderErrors = true;
renderer.debug.onShaderError = (gl, program, vs, fs) => {
  const log = [gl.getProgramInfoLog(program), gl.getShaderInfoLog(vs) && `vertex: ${gl.getShaderInfoLog(vs)}`, gl.getShaderInfoLog(fs) && `fragment: ${gl.getShaderInfoLog(fs)}`];
  report(`shader error: ${log.filter(Boolean).join(' | ').trim() || 'link failed'}`);
};
const sceneApi = buildScene();
const { scene } = sceneApi;
const camera = new THREE.PerspectiveCamera(26, 1, 0.5, 60);
const VIEW_DIR = new THREE.Vector3(0, Math.sin(THREE.MathUtils.degToRad(52)), Math.cos(THREE.MathUtils.degToRad(52)));
const VIEW_DISTANCE = 4.6;

const shape = getShape('d20');
const geometry = buildDieGeometry(shape, { style: 'rounded' });
geometry.computeBoundingSphere();
const REST = restingQuaternion(shape, shape.values.indexOf(20));
const REST_Y = -minY(geometry, REST);
const labels = shape.values.map((v) => labelFor('d20', v));
let atlas = null;
const tierFlags = flagsFor(TIERS.ultra, { interiors: true, engraving: true, glow: true });

const makeMaterial = (appearance, extra) =>
  createDiceMaterial(appearance, atlas, shape, labels, { ...tierFlags, ...extra });

/** The scripted tumble's orientation at t seconds: spinning down about a tilted axis, face-up at 1 s. */
function tumbleQuat(t, out = new THREE.Quaternion()) {
  const s = Math.max(0, 1 - t / TUMBLE.seconds);
  out.setFromAxisAngle(TUMBLE.axis, TUMBLE.angle * s * s);
  return out.multiply(REST);
}

/** Steps a fresh motion over the script to `endSec` and returns it. */
function simulate(endSec, reduced) {
  const m = createMotion();
  const q = new THREE.Quaternion();
  for (let t = 0; t <= endSec + 1e-9; t += DT) stepMotion(m, tumbleQuat(t, q), t === 0 ? 0 : DT, { reduced, factor: 1 });
  return m;
}

function writeMotion(material, m) {
  const u = material.userData.uniforms;
  if (!u.uInteriorTime) return false;
  u.uInteriorTime.value = m.time;
  u.uInteriorSpin.value.set(m.spin[0], m.spin[1], m.spin[2]);
  u.uInteriorLag.value.set(m.lag[0], m.lag[1], m.lag[2]);
  u.uInteriorSwirl.value.set(m.swirl[0], m.swirl[1], m.swirl[2]);
  return true;
}

// ---- the sheet -----------------------------------------------------------------------------
const COLUMNS = [
  { name: 'motion off\n(at rest)', motion: false, at: null },
  { name: `400 ms into flight`, motion: true, at: FLIGHT_MS / 1000 },
  { name: `1 s after landing`, motion: true, at: TUMBLE.seconds + LAND_MS / 1000 },
];
const ROWS = [
  { name: 'dark table\nsteps 16', table: 'dark', steps: 16 },
  { name: 'dark table\nsteps 48', table: 'dark', steps: 48 },
  { name: 'light table\nsteps 16', table: 'light', steps: 16 },
  { name: 'light table\nsteps 48', table: 'light', steps: 48 },
  { name: 'reduced motion\ndark, steps 48', table: 'dark', steps: 48, reduced: true },
];
const cells = [];

function buildSheet() {
  const appearance = INSIDES[INSIDE]();
  $('title').textContent = `${INSIDE}: ${appearance.body.type} ${appearance.body.color}, inside ${appearance.interior.type}${appearance.interior.shape && appearance.interior.type === 'shape' ? ' ' + appearance.interior.shape : ''}${appearance.interior.bubble ? ' + bubble' : ''}${appearance.interior.sand ? ' + sand' : ''}`;
  const grid = $('grid');
  grid.style.gridTemplateColumns = `${ROW_LABEL_PX}px repeat(${COLUMNS.length}, ${CELL}px)`;
  grid.style.gridTemplateRows = `36px repeat(${ROWS.length}, ${CELL}px)`;
  grid.appendChild(document.createElement('div'));
  for (const c of COLUMNS) {
    const h = document.createElement('div');
    h.className = 'head';
    h.style.whiteSpace = 'pre-line';
    h.textContent = c.name;
    grid.appendChild(h);
  }
  ROWS.forEach((r, row) => {
    const d = document.createElement('div');
    d.className = 'row';
    d.style.gridArea = `${row + 2} / 1`;
    d.textContent = r.name;
    grid.appendChild(d);
  });
  const stage = document.createElement('div');
  stage.id = 'stage';
  stage.style.gridArea = `2 / 2 / span ${ROWS.length} / span ${COLUMNS.length}`;
  stage.appendChild(canvas);
  grid.appendChild(stage);

  ROWS.forEach((r, row) =>
    COLUMNS.forEach((c, col) => {
      if (r.reduced && !c.motion) return;
      const mesh = new THREE.Mesh(geometry, makeMaterial(appearance, { interiorSteps: r.steps, insideMotion: c.motion }));
      mesh.position.y = REST_Y;
      mesh.visible = false;
      scene.add(mesh);
      const shadow = sceneApi.shadowFor({ position: mesh.position, geometry });
      shadow.visible = false;
      if (c.motion) {
        const m = simulate(c.at, !!r.reduced);
        if (!writeMotion(mesh.material, m)) report(`${INSIDE} row ${r.name} col ${c.name}: material has no motion uniforms`);
        tumbleQuat(c.at, mesh.quaternion);
      } else mesh.quaternion.copy(REST);
      cells.push({ row, col, mesh, shadow, table: r.table });
    }),
  );
}

const _target = new THREE.Vector3();
function renderSheet() {
  renderer.setScissorTest(true);
  for (const c of cells) {
    const x = c.col * CELL;
    const y = (ROWS.length - 1 - c.row) * CELL;
    renderer.setViewport(x, y, CELL, CELL);
    renderer.setScissor(x, y, CELL, CELL);
    renderer.setClearColor(TABLES[c.table], 1);
    _target.set(0, REST_Y * 0.85, 0);
    camera.position.copy(_target).addScaledVector(VIEW_DIR, VIEW_DISTANCE);
    camera.lookAt(_target);
    c.mesh.visible = c.shadow.visible = true;
    try {
      renderer.render(scene, camera);
    } finally {
      c.mesh.visible = c.shadow.visible = false;
    }
  }
  renderer.setScissorTest(false);
}

// ---- perf: 20 dice, moving vs frozen ---------------------------------------------------------
const PERF_COLS = 5;
const PERF_ROWS = 4;
let perfDice = [];
function perfSetup({ motion, steps = 32 }) {
  for (const d of perfDice) {
    scene.remove(d.mesh);
    d.mesh.material.dispose();
  }
  const appearance = INSIDES[INSIDE]();
  perfDice = [];
  for (let i = 0; i < PERF_COLS * PERF_ROWS; i++) {
    const mesh = new THREE.Mesh(geometry, makeMaterial(appearance, { interiorSteps: steps, insideMotion: motion }));
    mesh.position.set(((i % PERF_COLS) - (PERF_COLS - 1) / 2) * 2.5, REST_Y, (Math.floor(i / PERF_COLS) - (PERF_ROWS - 1) / 2) * 2.5);
    scene.add(mesh);
    const axis = new THREE.Vector3(Math.sin(i * 1.7), 1 + Math.cos(i), Math.sin(i * 0.6 + 1)).normalize();
    perfDice.push({ mesh, axis, spin: 2 + (i % 5), u: mesh.material.userData.uniforms });
  }
  renderer.setScissorTest(false);
  renderer.setPixelRatio(1);
  renderer.setSize(1280, 800, false);
  camera.aspect = 1.6;
  camera.updateProjectionMatrix();
  renderer.setClearColor(TABLES.dark, 1);
  _target.set(0, 0, 0);
  camera.position.copy(_target).addScaledVector(VIEW_DIR, 21);
  camera.lookAt(_target);
  return { motion, programs: renderer.info.programs?.length ?? 0, hasUniforms: perfDice.every((d) => !!d.u.uInteriorTime) === motion };
}

/** Mean main-thread ms per frame (rAF callback: tumble, motion stepping, render submit) over `frames`. */
function perfRun({ motion, frames = 120, warm = 20 }) {
  return new Promise((resolve) => {
    const q = new THREE.Quaternion();
    let last = null;
    let n = -warm;
    let total = 0;
    const loop = (now) => {
      const t0 = performance.now();
      const dt = last == null ? 0 : (now - last) / 1000;
      last = now;
      for (const d of perfDice) {
        q.setFromAxisAngle(d.axis, d.spin * (now / 1000)).multiply(REST);
        d.mesh.quaternion.copy(q);
        if (motion) insideMotion.step(d.mesh, d.u, q, dt, { reduced: false, factor: 1 });
      }
      renderer.render(scene, camera);
      const ms = performance.now() - t0;
      if (n >= 0) total += ms;
      if (++n >= frames) return resolve(total / frames);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
}

const ready = (async () => {
  try {
    atlas = await loadDigitAtlas('/assets/fonts');
    if (!(await requestLookExtras())) report('look extras chunk failed to load');
    if (!INSIDES[INSIDE]) throw new Error(`unknown inside "${INSIDE}"`);
    renderer.setPixelRatio(1);
    renderer.setSize(COLUMNS.length * CELL, ROWS.length * CELL);
    renderer.transmissionResolutionScale = TIERS.ultra.transmissionScale;
    sceneApi.setEnvironment(renderer, { resolution: TIERS.ultra.envResolution });
    if (!params.has('perf')) {
      buildSheet();
      renderSheet();
      renderer.getContext().readPixels(0, 0, 1, 1, renderer.getContext().RGBA, renderer.getContext().UNSIGNED_BYTE, new Uint8Array(4));
      if (!errors.length) $('status').textContent = `${INSIDE}: ${cells.length} cells`;
    } else document.getElementById('sheet').appendChild(canvas);
  } catch (err) {
    report(`init failed: ${err?.stack ?? err}`);
  }
})();

window.__insides = { ready, errors, perfSetup, perfRun, id: INSIDE, sync: () => renderer.getContext().finish() };
