// Look gallery: every curated look (rows) on every die type (columns), resting face-up
// under the studio environment. One shared WebGLRenderer, one viewport/scissor per cell.
// Renders on demand only (load and tier change): no loop, no idle GPU work. No physics.
import * as THREE from 'three';
import { buildScene } from '../src/render/scene.js';
import { configureRenderer } from '../src/render/renderer.js';
import { loadDigitAtlas } from '../src/render/sdf-atlas.js';
import { createDiceMaterial } from '../src/render/dice-material.js';
import { requestLookExtras } from '../src/render/extras-loader.js';
import { NOISE_GLSL } from '../src/render/shaders/noise.js';
import { buildDieGeometry } from '../src/core/chamfer.js';
import { getShape, labelFor } from '../src/core/dice-shapes.js';
import { restingQuaternion, minY } from '../src/core/resting.js';
import { LOOKS } from '../src/look/looks.js';
import { ICON_IDS } from '../src/look/appearance.js';
import { runProbe } from '../src/render/gpu-probe.js';
import { TIERS, flagsFor } from '../src/render/quality.js';
import { createFaceTextures, FACE_FONT_FAMILY } from '../src/render/face-textures.js';
import { facesFor, atlasGlyphTest } from '../src/compat/faces.js';

export const TYPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd2'];
/** The face shown on top per type (6 and 9 show the underline mark). */
const SHOWN = { d4: 4, d6: 6, d8: 8, d10: 9, d12: 12, d20: 20, d2: 2 };
const CELL = 128;
const ROW_LABEL_PX = 170;

/**
 * Rows: every curated look, plus variants with per-row flag overrides so variant programs
 * (the engraving-off #else path, the P2-R12 safe fallback) also compile on real WebGL. An optional
 * fifth element is a numbers patch merged into the base look's appearance.numbers (dice designs),
 * a sixth a body patch merged into appearance.body (dice designs plan 2 bodies).
 */
const VARIANTS = [
  ['dwarven-brass~flat', 'dwarven-brass', 'engraving off', { engraving: false }],
  ['default~safe', 'default', 'safe fallback', { safe: true }],
  ['default~raised', 'default', 'raised numbers', {}, { relief: 'raised' }],
  ['dwarven-brass~raised', 'dwarven-brass', 'raised numbers', {}, { relief: 'raised' }],
  ['default~outline', 'default', 'outline numbers', {}, { fill: 'outline' }],
  ['default~holo', 'default', 'holographic numbers', {}, { fill: 'holo' }],
  ['default~glow', 'default', 'glow-ink numbers', {}, { fill: 'glow' }],
  ['void-star~glow', 'void-star', 'glow-ink raised numbers', {}, { fill: 'glow', relief: 'raised' }],
  // crit icons: only the d20 column shows one (on its 20); other dice keep their numbers
  ...ICON_IDS.map((id) => [`icon-${id}`, 'default', `${id} crit`, {}, { icons: { crit: id } }]),
  [
    'ruby-classic~icons',
    'ruby-classic',
    'icons, raised holo',
    {},
    { icons: { crit: 'starburst', fumble: 'broken-shield' }, relief: 'raised', fill: 'holo' },
  ],
  // iridescent bodies: Task 7 replaces the inline colours with PRESET_COLORS (src/look/body-colors.js)
  ['iridescent~chameleon', 'default', 'chameleon', {}, {}, { type: 'iridescent', preset: 'chameleon', color: '#1a9e8f', color2: '#6a2bd1', roughness: 0.15 }],
  ['iridescent~opal', 'default', 'opal', {}, {}, { type: 'iridescent', preset: 'opal', color: '#e8eef0', color2: '#7fd6e8', roughness: 0.2 }],
  ['iridescent~dichroic', 'default', 'dichroic glass', {}, {}, { type: 'iridescent', preset: 'dichroic', color: '#102030', color2: '#ff6a3d', roughness: 0.05 }],
  // gem bodies: Task 7 replaces the inline colours with PRESET_COLORS (src/look/body-colors.js)
  ['gem~amethyst', 'default', 'amethyst', {}, {}, { type: 'gem', preset: 'amethyst', color: '#7b3fb5', color2: '#2a0f45', roughness: 0.1 }],
  ['gem~malachite', 'default', 'malachite', {}, {}, { type: 'gem', preset: 'malachite', color: '#1f8a5a', color2: '#0a3a24', roughness: 0.2 }],
  ['gem~obsidian', 'default', 'obsidian', {}, {}, { type: 'gem', preset: 'obsidian', color: '#0d0c10', color2: '#4a3f5a', roughness: 0.05 }],
  ['gem~quartz', 'default', 'quartz', {}, {}, { type: 'gem', preset: 'quartz', color: '#e9e4ee', color2: '#b8b0c4', roughness: 0.15 }],
  // wood bodies: Task 7 replaces the inline colours with PRESET_COLORS (src/look/body-colors.js)
  ['wood~oak', 'default', 'oak', {}, {}, { type: 'wood', preset: 'oak', color: '#b98a52', color2: '#6e4a26', roughness: 0.55 }],
  ['wood~walnut', 'default', 'walnut', {}, {}, { type: 'wood', preset: 'walnut', color: '#5a3a22', color2: '#2a170c', roughness: 0.5 }],
  ['wood~cherry', 'default', 'cherry', {}, {}, { type: 'wood', preset: 'cherry', color: '#9c4a2c', color2: '#5a2414', roughness: 0.45 }],
  ['wood~ebony', 'default', 'ebony', {}, {}, { type: 'wood', preset: 'ebony', color: '#1c1714', color2: '#3b302a', roughness: 0.35 }],
  // aged metal finishes: Task 7 replaces the inline colours with PRESET_COLORS (src/look/body-colors.js)
  ['metal~patina', 'default', 'copper patina', {}, {}, { type: 'metal', finish: 'patina', color: '#b5653a', color2: '#3fae9a', roughness: 0.4 }],
  ['metal~worn', 'default', 'battle-worn', {}, {}, { type: 'metal', finish: 'worn', color: '#9aa0a6', color2: '#3a3d40', roughness: 0.35 }],
];
/**
 * Face rows (Task 5): DSN-style presets whose faces the digit atlas cannot draw, on a d6 only
 * (the other columns stay empty). Images are generated by scripts/make-face-pngs.mjs.
 */
const FACE_IMAGES = ['circle', 'square', 'triangle', 'diamond', 'cross', 'ring'].map(
  (name, i) => `/dev/assets/face-${i + 1}-${name}.png`,
);
const FACE_ROWS = [
  ['faces-image', 'default', 'image faces', { system: 'dev', type: 'd6', labels: FACE_IMAGES }, 6],
  ['faces-fate', 'ruby-classic', 'Fate text faces', { system: 'dev', type: 'df', shape: 'd6', labels: ['-', '-', '', '', '+', '+'] }, 6],
  ['faces-fate-minus', 'ruby-classic', 'Fate text faces', { system: 'dev', type: 'df', shape: 'd6', labels: ['-', '-', '', '', '+', '+'] }, 1],
];
const looks = [
  ...Object.entries(LOOKS).map(([id, look]) => [id, look, {}]),
  ...VARIANTS.map(([id, base, note, flags, numbers, body]) => [
    id,
    {
      ...LOOKS[base],
      name: `${LOOKS[base].name} (${note})`,
      appearance: {
        ...LOOKS[base].appearance,
        numbers: { ...LOOKS[base].appearance.numbers, ...numbers },
        body: { ...LOOKS[base].appearance.body, ...body },
      },
    },
    flags,
  ]),
  ...FACE_ROWS.map(([id, base, note, preset, shown]) => [
    id,
    { ...LOOKS[base], name: `${LOOKS[base].name} (${note})` },
    {},
    { preset, shown },
  ]),
];
const ROWS = looks.length;
const COLS = TYPES.length;
const errors = [];
const $ = (id) => document.getElementById(id);

function report(message) {
  errors.push(message);
  console.error(`dicer looks: ${message}`);
  const status = $('status');
  status.textContent = `${errors.length} error(s): ${errors[0].slice(0, 200)}`;
  status.classList.add('bad');
}
window.addEventListener('error', (e) => report(`page error: ${e.message}`));
window.addEventListener('unhandledrejection', (e) =>
  report(`unhandled: ${e.reason?.stack ?? e.reason}`),
);

// ---- page layout -------------------------------------------------------------------------
const grid = $('grid');
grid.style.gridTemplateColumns = `${ROW_LABEL_PX}px repeat(${COLS}, ${CELL}px)`;
grid.style.gridTemplateRows = `24px repeat(${ROWS}, ${CELL}px)`;
grid.appendChild(document.createElement('div'));
for (const type of TYPES) {
  const h = document.createElement('div');
  h.className = 'head';
  h.textContent = type;
  grid.appendChild(h);
}
looks.forEach(([id, look, rowFlags], row) => {
  const r = document.createElement('div');
  r.className = 'row';
  r.style.gridArea = `${row + 2} / 1`;
  const a = look.appearance;
  const detail = [a.body.type, a.body.type === 'metal' ? a.body.finish : a.body.preset, a.numbers.fill];
  if (a.interior.type !== 'none') detail.push(a.interior.type);
  if (a.edges.style !== 'rounded') detail.push(a.edges.style);
  if (rowFlags.engraving === false) detail.push('no engraving');
  if (rowFlags.safe) detail.push('safe');
  if (looks[row][3]) detail.push(`d6 shows ${looks[row][3].shown}`);
  r.innerHTML = `<span>${look.name}</span><small>${id}</small><small>${detail.filter(Boolean).join(' · ')}</small>`;
  grid.appendChild(r);
});
const stage = document.createElement('div');
stage.id = 'stage';
stage.style.gridArea = `2 / 2 / span ${ROWS} / span ${COLS}`;
grid.appendChild(stage);

// ---- renderer and scene ------------------------------------------------------------------
const canvas = document.createElement('canvas');
stage.appendChild(canvas);
const renderer = configureRenderer(
  new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    logarithmicDepthBuffer: false,
    powerPreference: 'high-performance',
  }),
);
renderer.setClearColor(0x000000, 0);
renderer.debug.checkShaderErrors = true;
renderer.debug.onShaderError = (gl, program, vs, fs) => {
  const log = [
    gl.getProgramInfoLog(program),
    gl.getShaderInfoLog(vs) && `vertex: ${gl.getShaderInfoLog(vs)}`,
    gl.getShaderInfoLog(fs) && `fragment: ${gl.getShaderInfoLog(fs)}`,
  ];
  report(`shader error: ${log.filter(Boolean).join(' | ').trim() || 'link failed'}`);
};
const gl = renderer.getContext();

const sceneApi = buildScene();
const { scene } = sceneApi;
const camera = new THREE.PerspectiveCamera(26, 1, 0.5, 20);
const VIEW_DIR = new THREE.Vector3(0, Math.sin(THREE.MathUtils.degToRad(52)), 0);
VIEW_DIR.z = Math.cos(THREE.MathUtils.degToRad(52));
const VIEW_DISTANCE = 4.6;

const geometries = new Map(); // type|style
function geometryFor(type, style) {
  const key = `${type}|${style}`;
  if (!geometries.has(key)) {
    const geo = buildDieGeometry(getShape(type), { style });
    geo.computeBoundingSphere();
    geometries.set(key, geo);
  }
  return geometries.get(key);
}

let atlas = null;
const cells = [];

const faceTextures = createFaceTextures({
  loadFont: async () => {
    const face = new FontFace(FACE_FONT_FAMILY, 'url("/assets/fonts/DMSerifDisplay-Regular.woff")');
    document.fonts.add(await face.load());
  },
});

/** The labels DiceBox sends for a face set: glyph text, '' for blank and layered faces. */
function faceLabels(type, faces, faceTex) {
  return getShape(type).values.map((v, i) => {
    const f = faces.labels[i];
    if (f.kind === 'glyph') return f.text;
    if (f.kind === 'blank' || faceTex.layers[i] >= 0) return '';
    return labelFor(type, v);
  });
}

/** Builds the face rows' face sets and layers (awaited before the first render). */
async function buildFaceCells() {
  const test = atlasGlyphTest(atlas);
  for (const c of cells.filter((x) => x.faceRow)) {
    const faces = facesFor(c.faceRow.preset, test);
    c.faceTex = await faceTextures.acquire(faces);
    if (!c.faceTex.texture) report(`${c.id}: no face layers were built`);
    c.labels = faceLabels(c.type, faces, c.faceTex);
  }
}

function buildCells() {
  looks.forEach(([id, look, rowFlags, faceRow], row) => {
    TYPES.forEach((type, col) => {
      if (faceRow && type !== 'd6') return;
      const shape = getShape(type);
      const geometry = geometryFor(type, look.appearance.edges.style);
      const face = shape.values.indexOf(faceRow ? faceRow.shown : SHOWN[type]);
      const mesh = new THREE.Mesh(geometry);
      mesh.quaternion.copy(restingQuaternion(shape, face));
      mesh.position.y = -minY(geometry, mesh.quaternion);
      mesh.visible = false;
      scene.add(mesh);
      const shadow = sceneApi.shadowFor({ position: mesh.position, geometry });
      shadow.visible = false;
      const labels = shape.values.map((v) => labelFor(type, v));
      cells.push({ id, look, rowFlags, faceRow, type, row, col, shape, labels, mesh, shadow });
    });
  });
}

let tier = null;
let flags = null;

function buildMaterials() {
  for (const c of cells) {
    if (c.mesh.material?.userData?.uniforms) {
      c.mesh.material.userData.uniforms.uLabels.value.dispose();
      c.mesh.material.dispose();
    }
    c.mesh.material = createDiceMaterial(
      c.look.appearance,
      atlas,
      c.shape,
      c.labels,
      { ...flags, ...c.rowFlags },
      c.faceTex,
    );
  }
}

const _target = new THREE.Vector3();
function renderGrid({ shadows = true } = {}) {
  renderer.setScissorTest(true);
  for (const c of cells) {
    const x = c.col * CELL;
    const y = (ROWS - 1 - c.row) * CELL; // three's viewport origin is bottom-left
    renderer.setViewport(x, y, CELL, CELL);
    renderer.setScissor(x, y, CELL, CELL);
    _target.set(0, c.mesh.position.y * 0.85, 0);
    camera.position.copy(_target).addScaledVector(VIEW_DIR, VIEW_DISTANCE);
    camera.lookAt(_target);
    c.mesh.visible = true;
    c.shadow.visible = shadows;
    try {
      renderer.render(scene, camera);
    } finally {
      c.mesh.visible = c.shadow.visible = false;
    }
  }
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, COLS * CELL, ROWS * CELL);
}

/** Forces the GPU to finish everything queued so far. */
function syncGpu() {
  const px = new Uint8Array(4);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
}

/**
 * Compiles and runs the noise library on the GPU (Task 4 ships it; Task 5+ use it) and checks
 * that dcFbm3 / dcNoise3 / dcHash13 produce finite, varying values in [0, 1].
 */
function noiseProbe() {
  const size = 16;
  const rt = new THREE.WebGLRenderTarget(size, size);
  const material = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      void main() { vPos = position; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`,
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      varying vec3 vPos;
      void main() {
        vec3 p = vPos * 4.0 + 0.37;
        float v = 0.5 * dcFbm3( p, 5 ) + 0.3 * dcNoise3( p * 2.0 ) + 0.2 * dcHash13( p );
        gl_FragColor = vec4( vec3( clamp( v, 0.0, 1.0 ) ), 1.0 );
      }`,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  const probeScene = new THREE.Scene();
  probeScene.add(quad);
  const data = new Uint8Array(size * size * 4);
  try {
    renderer.setRenderTarget(rt);
    renderer.render(probeScene, camera);
    renderer.readRenderTargetPixels(rt, 0, 0, size, size, data);
  } finally {
    renderer.setRenderTarget(null);
    rt.dispose();
    material.dispose();
    quad.geometry.dispose();
  }
  let min = 255;
  let max = 0;
  for (let i = 0; i < data.length; i += 4) {
    min = Math.min(min, data[i]);
    max = Math.max(max, data[i]);
  }
  if (max - min < 10) report(`noise probe: output is flat (min ${min}, max ${max})`);
  return { min, max };
}

/** Side of the centre patch (CSS px) whose mean colour the harness checks per cell. */
const PATCH = 6;

/**
 * Alpha at every cell centre, plus the mean RGB of a PATCH x PATCH centre patch (so a black
 * or NaN render shows up), read right after a render (no preserveDrawingBuffer). The blob
 * shadows are left out: they sit under every die and would make a cell whose die failed to
 * draw look non-blank.
 */
function cellAlphas() {
  renderGrid({ shadows: false });
  const pr = renderer.getPixelRatio();
  const px = new Uint8Array(4);
  const side = Math.max(1, Math.round(PATCH * pr));
  const patch = new Uint8Array(side * side * 4);
  return cells.map((c) => {
    const cx = (c.col * CELL + CELL / 2) * pr;
    const cy = ((ROWS - 1 - c.row) * CELL + CELL / 2) * pr;
    gl.readPixels(Math.floor(cx), Math.floor(cy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.readPixels(Math.floor(cx - side / 2), Math.floor(cy - side / 2), side, side, gl.RGBA, gl.UNSIGNED_BYTE, patch);
    let sum = 0;
    let covered = 0;
    for (let i = 0; i < patch.length; i += 4) {
      sum += (patch[i] + patch[i + 1] + patch[i + 2]) / 3;
      if (patch[i + 3] > 0) covered++;
    }
    return {
      id: c.id,
      type: c.type,
      alpha: px[3],
      rgb: [px[0], px[1], px[2]],
      meanRgb: Number((sum / (side * side)).toFixed(1)),
      coverage: covered / (side * side),
    };
  });
}

async function setTier(name) {
  if (!TIERS[name]) throw new Error(`unknown tier "${name}"`);
  tier = name;
  const t = TIERS[name];
  // Production flags: the same flagsFor() the quality controller uses, with every client
  // toggle at its default (on). Low therefore draws the interior fake, exactly as Foundry does.
  flags = flagsFor(t, { interiors: true, engraving: true, glow: true });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, t.pixelRatio));
  renderer.setSize(COLS * CELL, ROWS * CELL);
  renderer.transmissionResolutionScale = t.transmissionScale;
  sceneApi.setEnvironment(renderer, { resolution: t.envResolution });
  buildMaterials();
  renderGrid();
  syncGpu();
  $('tier').value = name;
  if (!errors.length) {
    $('status').textContent =
      `tier ${name}: ${cells.length} cells, ${renderer.info.programs.length} programs`;
  }
}

async function msPerFrame(frames = 10) {
  renderGrid();
  syncGpu();
  const t0 = performance.now();
  for (let i = 0; i < frames; i++) renderGrid();
  syncGpu();
  return (performance.now() - t0) / frames;
}

/**
 * Close-up of one cell (look id x die type) at size x size CSS px, as a PNG data URL. The
 * grid is re-rendered afterwards. For judging interiors that are too small at cell size.
 */
function closeup(id, type, size = 300) {
  const c = cells.find((x) => x.id === id && x.type === type);
  if (!c) throw new Error(`no cell ${id}/${type}`);
  const prev = renderer.getSize(new THREE.Vector2());
  renderer.setSize(size, size, false);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, size, size);
  _target.set(0, c.mesh.position.y * 0.85, 0);
  camera.position.copy(_target).addScaledVector(VIEW_DIR, VIEW_DISTANCE);
  camera.lookAt(_target);
  c.mesh.visible = c.shadow.visible = true;
  let url;
  try {
    renderer.render(scene, camera);
    url = canvas.toDataURL('image/png');
  } finally {
    c.mesh.visible = c.shadow.visible = false;
    renderer.setSize(prev.x, prev.y);
    renderGrid();
  }
  return url;
}

const pct = (a, p) => {
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

/**
 * Full-screen per-pixel interior cost (spec G2): one die (look id x type) filling ~70% of the
 * height of a width x height drawing buffer at `pixelRatio`, at quality tier `tierName`.
 * Renders `frames` frames; each is timed with EXT_disjoint_timer_query_webgl2 (GPU ms) and by
 * wall clock with a readback per frame (ms incl. CPU submit). Returns p50/p95 of both.
 * The grid canvas and tier are restored afterwards.
 */
async function fullscreenCost({
  id = 'galaxy-nebula',
  type = 'd20',
  tier: tierName = 'high',
  width = 1920,
  height = 1080,
  pixelRatio = 1,
  frames = 120,
  fill = 0.7,
} = {}) {
  const prevTier = tier;
  await setTier(tierName);
  const c = cells.find((x) => x.id === id && x.type === type);
  if (!c) throw new Error(`no cell ${id}/${type}`);
  const prevSize = renderer.getSize(new THREE.Vector2());
  const prevRatio = renderer.getPixelRatio();
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height, false);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, width, height);
  const cam = camera.clone();
  cam.aspect = width / height;
  // the die's bounding sphere spans `fill` of the vertical field of view
  const r = c.mesh.geometry.boundingSphere.radius;
  const dist = r / (fill * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)));
  _target.set(0, c.mesh.position.y, 0);
  cam.position.copy(_target).addScaledVector(VIEW_DIR, dist);
  cam.lookAt(_target);
  cam.updateProjectionMatrix();
  c.mesh.visible = true;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const wall = [];
  const queries = [];
  try {
    renderer.render(scene, cam); // warm-up
    syncGpu();
    if (ext) gl.getParameter(ext.GPU_DISJOINT_EXT);
    for (let i = 0; i < frames; i++) {
      const t0 = performance.now();
      let q = null;
      if (ext) {
        q = gl.createQuery();
        gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      }
      renderer.render(scene, cam);
      if (q) {
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        queries.push(q);
      }
      syncGpu();
      wall.push(performance.now() - t0);
    }
    const gpu = [];
    let disjoint = false;
    for (const q of queries) {
      for (let k = 0; k < 500 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); k++)
        await new Promise((res) => setTimeout(res, 2));
      if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE))
        gpu.push(Number(gl.getQueryParameter(q, gl.QUERY_RESULT)) / 1e6);
      gl.deleteQuery(q);
    }
    if (ext && gl.getParameter(ext.GPU_DISJOINT_EXT)) disjoint = true;
    return {
      id,
      type,
      tier: tierName,
      buffer: [Math.round(width * pixelRatio), Math.round(height * pixelRatio)],
      steps: TIERS[tierName].interiorSteps,
      frames,
      timer: !!ext && !disjoint && gpu.length === frames,
      gpuP50: gpu.length ? pct(gpu, 50) : null,
      gpuP95: gpu.length ? pct(gpu, 95) : null,
      wallP50: pct(wall, 50),
      wallP95: pct(wall, 95),
    };
  } finally {
    c.mesh.visible = false;
    renderer.setPixelRatio(prevRatio);
    renderer.setSize(prevSize.x, prevSize.y);
    if (prevTier && prevTier !== tierName) await setTier(prevTier);
    else renderGrid();
  }
}

function info() {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const keys = new Set(cells.map((c) => c.mesh.material?.userData?.programKey));
  return {
    tier,
    cells: cells.length,
    rows: ROWS,
    cols: COLS,
    cell: CELL,
    pixelRatio: renderer.getPixelRatio(),
    webgl2: renderer.capabilities.isWebGL2 !== false,
    vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    programs: renderer.info.programs.length,
    programKeys: keys.size,
  };
}

async function init() {
  atlas = await loadDigitAtlas('/assets/fonts');
  // The look-extras chunk first, so the extras rows draw their real looks, not the fallbacks.
  if (!(await requestLookExtras())) report('look extras chunk failed to load');
  buildCells();
  await buildFaceCells();
  noiseProbe();
  await setTier($('tier').value || 'high');
}

const ready = init().catch((err) => report(`init failed: ${err?.stack ?? err}`));
$('tier').addEventListener('change', (e) => {
  setTier(e.target.value).catch((err) => report(`setTier failed: ${err?.stack ?? err}`));
});

window.__looks = {
  ready,
  errors,
  probe: (frames) => runProbe(renderer, { frames, atlas }),
  msPerFrame,
  setTier,
  cellAlphas,
  info,
  noiseProbe,
  closeup,
  fullscreenCost,
};
