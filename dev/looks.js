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
import { PRESET_COLORS } from '../src/look/body-colors.js';
import { runProbe } from '../src/render/gpu-probe.js';
import { TIERS, flagsFor } from '../src/render/quality.js';
import { createFaceTextures, FACE_FONT_FAMILY } from '../src/render/face-textures.js';
import { facesFor, atlasGlyphTest } from '../src/compat/faces.js';

export const TYPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd2', 'd14', 'd16', 'd4crystal'];
/** The face shown on top per type (6 and 9 show the underline mark). */
const SHOWN = { d4: 4, d6: 6, d8: 8, d10: 9, d12: 12, d20: 20, d2: 2, d14: 14, d16: 16, d4crystal: 4 };
const CELL = 128;
const ROW_LABEL_PX = 170;

/**
 * Rows: every curated look, plus variants with per-row flag overrides so variant programs
 * (the engraving-off #else path, the P2-R12 safe fallback) also compile on real WebGL. An optional
 * fifth element is a numbers patch merged into the base look's appearance.numbers (dice designs),
 * a sixth a body patch merged into appearance.body, a seventh an interior patch (dice designs
 * plans 2 and 3). The flags element covers per-row engraving / safe.
 */
const VARIANTS = [
  ['dwarven-brass~flat', 'dwarven-brass', 'engraving off', { engraving: false }],
  ['default~safe', 'default', 'safe fallback', { safe: true }],
  ['default~raised', 'default', 'raised numbers', {}, { relief: 'raised' }],
  ['dwarven-brass~raised', 'dwarven-brass', 'raised numbers', {}, { relief: 'raised' }],
  ['default~outline', 'default', 'outline numbers', {}, { fill: 'outline' }],
  ['default~holo', 'default', 'holographic numbers', {}, { fill: 'holo' }],
  // numbers.offsetY: positive moves the numbers up along their own up (toward the face's first vertex), negative down
  ['default~offset-up', 'default', 'numbers up 0.2', {}, { offsetY: 0.2 }],
  ['default~offset-down', 'default', 'numbers down 0.2', {}, { offsetY: -0.2 }],
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
  // pips (the d6 column only) and coin motifs (the d2 column only); the combo row shows icons,
  // pips and a motif on one look (each die its own composed atlas)
  ['ruby~pips', 'ruby-classic', 'pipped d6', {}, { pips: true }],
  ['gold~coin-sun-moon', 'gold-polished', 'coin: sun and moon', {}, { coin: 'sun-moon' }],
  ['gold~coin-heads-tails', 'gold-polished', 'coin: heads and tails', {}, { coin: 'heads-tails' }],
  ['combo~icons-pips-coin', 'default', 'icons, pips, coin, raised', {}, { icons: { crit: 'crown' }, pips: true, coin: 'heads-tails', relief: 'raised' }],
  // iridescent bodies
  ['iridescent~chameleon', 'default', 'chameleon', {}, {}, { type: 'iridescent', preset: 'chameleon', ...PRESET_COLORS.chameleon }],
  ['iridescent~opal', 'default', 'opal', {}, {}, { type: 'iridescent', preset: 'opal', ...PRESET_COLORS.opal }],
  ['iridescent~dichroic', 'default', 'dichroic glass', {}, {}, { type: 'iridescent', preset: 'dichroic', ...PRESET_COLORS.dichroic }],
  // gem bodies
  ['gem~amethyst', 'default', 'amethyst', {}, {}, { type: 'gem', preset: 'amethyst', ...PRESET_COLORS.amethyst }],
  ['gem~malachite', 'default', 'malachite', {}, {}, { type: 'gem', preset: 'malachite', ...PRESET_COLORS.malachite }],
  ['gem~obsidian', 'default', 'obsidian', {}, {}, { type: 'gem', preset: 'obsidian', ...PRESET_COLORS.obsidian }],
  ['gem~quartz', 'default', 'quartz', {}, {}, { type: 'gem', preset: 'quartz', ...PRESET_COLORS.quartz }],
  // wood bodies
  ['wood~oak', 'default', 'oak', {}, {}, { type: 'wood', preset: 'oak', ...PRESET_COLORS.oak }],
  ['wood~walnut', 'default', 'walnut', {}, {}, { type: 'wood', preset: 'walnut', ...PRESET_COLORS.walnut }],
  ['wood~cherry', 'default', 'cherry', {}, {}, { type: 'wood', preset: 'cherry', ...PRESET_COLORS.cherry }],
  ['wood~ebony', 'default', 'ebony', {}, {}, { type: 'wood', preset: 'ebony', ...PRESET_COLORS.ebony }],
  // aged metal finishes
  ['metal~patina', 'default', 'copper patina', {}, {}, { type: 'metal', finish: 'patina', ...PRESET_COLORS.patina }],
  ['metal~worn', 'default', 'battle-worn', {}, {}, { type: 'metal', finish: 'worn', ...PRESET_COLORS.worn }],
  // foil insides (dice designs plan 3)
  ['resin~foil-gold', 'default', 'gold and copper foil', {}, {}, { type: 'resin', color: '#d9e6f0', color2: '#9fb3c8', roughness: 0.05 }, { type: 'foil', colors: ['#ffcf5a', '#d9814a'], density: 0.5 }],
  ['resin~foil-silver', 'default', 'silver foil', {}, {}, { type: 'resin', color: '#2b4a66', color2: '#0f2236', roughness: 0.05 }, { type: 'foil', colors: ['#e8edf2', '#f3dc9a'], density: 0.5 }],
  // eye insides
  ['resin~eye-green', 'default', 'green eye', {}, {}, { type: 'resin', color: '#e6eef2', color2: '#b8c8d4', roughness: 0.05 }, { type: 'eye', colors: ['#3fae5a', '#fff4ea'], density: 0.4 }],
  ['resin~eye-red', 'default', 'red eye', {}, {}, { type: 'resin', color: '#3a1a22', color2: '#1a0a10', roughness: 0.05 }, { type: 'eye', colors: ['#c8322a', '#ffe6dc'], density: 0.6 }],
  // botanical insides
  ['resin~flower', 'default', 'pressed flower', {}, {}, { type: 'resin', color: '#eef4f6', color2: '#c9d8e0', roughness: 0.05 }, { type: 'botanical', inclusion: 'flower', colors: ['#f28fb0', '#f6d24a'], density: 0.5 }],
  ['resin~moss', 'default', 'moss', {}, {}, { type: 'resin', color: '#eef4f6', color2: '#c9d8e0', roughness: 0.05 }, { type: 'botanical', inclusion: 'moss', colors: ['#4f8a3a', '#b9d36a'], density: 0.5 }],
  ['resin~butterfly', 'default', 'butterfly', {}, {}, { type: 'resin', color: '#eef4f6', color2: '#c9d8e0', roughness: 0.05 }, { type: 'botanical', inclusion: 'butterfly', colors: ['#2f7fe0', '#111a2c'], density: 0.5 }],
  // smoke inside, liquid bubble and sand
  ['resin~smoke', 'default', 'smoke plume', {}, {}, { type: 'resin', color: '#eef4f6', color2: '#c9d8e0', roughness: 0.05 }, { type: 'smoke', colors: ['#2a2440', '#9a8fc8'], density: 0.6 }],
  ['resin~liquid-bubble', 'default', 'liquid, air bubble', {}, {}, { type: 'resin', color: '#eef4f6', color2: '#c9d8e0', roughness: 0.05 }, { type: 'liquid', colors: ['#1f7fd1', '#bfe6ff'], density: 0.5, bubble: true }],
  ['resin~liquid-sand', 'default', 'liquid, sand', {}, {}, { type: 'resin', color: '#eef4f6', color2: '#c9d8e0', roughness: 0.05 }, { type: 'liquid', colors: ['#1f7fd1', '#bfe6ff'], density: 0.5, sand: true }],
  ['resin~liquid-bubble-sand', 'default', 'liquid, bubble and sand', {}, {}, { type: 'resin', color: '#eef4f6', color2: '#c9d8e0', roughness: 0.05 }, { type: 'liquid', colors: ['#1f7fd1', '#bfe6ff'], density: 0.5, bubble: true, sand: true }],
  // fantasy shapes (dice designs plan 3b): floating weapons in clear resin
  ['resin~sword', 'default', 'floating sword', {}, {}, { type: 'resin', color: '#eef4f6', color2: '#c9d8e0', roughness: 0.05 }, { type: 'shape', shape: 'sword', colors: ['#5a2e1a', '#e0b040'], density: 0.5 }],
  ['resin~axe', 'default', 'floating axe', {}, {}, { type: 'resin', color: '#eef4f6', color2: '#c9d8e0', roughness: 0.05 }, { type: 'shape', shape: 'axe', colors: ['#6b4423', '#9aa3ad'], density: 0.5 }],
  ['resin~shield', 'default', 'floating shield', {}, {}, { type: 'resin', color: '#eef4f6', color2: '#c9d8e0', roughness: 0.05 }, { type: 'shape', shape: 'shield', colors: ['#8a1f1f', '#d9a93a'], density: 0.5 }],
  ['resin~dragon-red', 'default', 'red dragon', {}, {}, { type: 'resin', color: '#eef4f6', color2: '#c9d8e0', roughness: 0.05 }, { type: 'shape', shape: 'dragon', colors: ['#8a1c1c', '#d9603a'], density: 0.5 }],
  ['resin~dragon-green', 'default', 'green dragon', {}, {}, { type: 'resin', color: '#eef4f6', color2: '#c9d8e0', roughness: 0.05 }, { type: 'shape', shape: 'dragon', colors: ['#1f5a2e', '#6fbf5a'], density: 0.5 }],
  ['resin~runes-arcane', 'default', 'arcane rune circle', {}, {}, { type: 'resin', color: '#1a2036', color2: '#0a0d18', roughness: 0.05 }, { type: 'shape', shape: 'runes', colors: ['#7fd0ff', '#c8a2ff'], density: 0.5 }],
  ['resin~runes-fire', 'default', 'fire rune circle', {}, {}, { type: 'resin', color: '#eef4f6', color2: '#c9d8e0', roughness: 0.05 }, { type: 'shape', shape: 'runes', colors: ['#ff9a3a', '#ffd27a'], density: 0.5 }],
  // combinations (the compile check for body x numbers x interior x flags interactions)
  ['combo~patina-outline-raised', 'default', 'patina, outline raised', {}, { fill: 'outline', relief: 'raised' }, { type: 'metal', finish: 'patina', ...PRESET_COLORS.patina }],
  ['combo~worn-holo', 'default', 'worn, holo numbers', {}, { fill: 'holo' }, { type: 'metal', finish: 'worn', ...PRESET_COLORS.worn }],
  ['combo~amethyst-holo', 'default', 'amethyst, holo numbers', {}, { fill: 'holo' }, { type: 'gem', preset: 'amethyst', ...PRESET_COLORS.amethyst }],
  ['combo~chameleon-glow', 'default', 'chameleon, glow-ink', {}, { fill: 'glow' }, { type: 'iridescent', preset: 'chameleon', ...PRESET_COLORS.chameleon }],
  ['combo~oak-flat', 'default', 'oak, engraving off', { engraving: false }, {}, { type: 'wood', preset: 'oak', ...PRESET_COLORS.oak }],
  // plan 3 insides with plan 1 numbers
  [
    'resin~eye+outline-raised',
    'default',
    'eye, outline raised',
    {},
    { fill: 'outline', relief: 'raised' },
    { type: 'resin', color: '#e6eef2', color2: '#b8c8d4', roughness: 0.05 },
    { type: 'eye', colors: ['#3fae5a', '#fff4ea'], density: 0.4 },
  ],
  [
    'resin~foil+holo',
    'default',
    'foil, holo numbers',
    {},
    { fill: 'holo' },
    { type: 'resin', color: '#2b4a66', color2: '#0f2236', roughness: 0.05 },
    { type: 'foil', colors: ['#e8edf2', '#f3dc9a'], density: 0.5 },
  ],
  ['combo~patina-effects-off', 'default', 'patina, safe', { safe: true }, {}, { type: 'metal', finish: 'patina', ...PRESET_COLORS.patina }],
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
  // faces on an aged metal body (the face-layer path with the patina colour chunk)
  ['faces-image-patina', 'default', 'image faces, patina', { system: 'dev', type: 'd6', labels: FACE_IMAGES }, 6, { type: 'metal', finish: 'patina', ...PRESET_COLORS.patina }],
  ['faces-fate-patina', 'ruby-classic', 'Fate faces, patina', { system: 'dev', type: 'df', shape: 'd6', labels: ['-', '-', '', '', '+', '+'] }, 6, { type: 'metal', finish: 'patina', ...PRESET_COLORS.patina }],
];
/**
 * Edge strips (edges.strip): paint, metal and glow on an opaque, a resin and a metal body at
 * radius 0.25 and 1, plus a metal strip on gem and wood (the bevel coat gate). The d6, d20 and the
 * d2 rim only. Row element 5 is the column filter.
 */
const EDGE_TYPES = ['d6', 'd20', 'd2'];
const STRIP_COLORS = { paint: '#f3ead0', metal: '#e2b04a', glow: '#3ad7ff' };
const EDGE_BODIES = [
  ['opaque', LOOKS['ruby-classic'].appearance.body, LOOKS['ruby-classic'].appearance.numbers],
  ['resin', { type: 'resin', color: '#1f5fd1', color2: '#0b1f4a', roughness: 0.05 }],
  ['metal', LOOKS['silver-brushed'].appearance.body, LOOKS['silver-brushed'].appearance.numbers],
];
const edgeRow = (body, numbers, style, radius, tag) => [
  `edge~${style}-${tag}-r${radius}`,
  {
    ...LOOKS.default,
    name: `${style} strip, ${tag}, r ${radius}`,
    appearance: {
      ...LOOKS.default.appearance,
      body,
      numbers: numbers ?? LOOKS.default.appearance.numbers,
      interior: { ...LOOKS.default.appearance.interior, type: 'none' },
      edges: { radius, strip: { style, color: STRIP_COLORS[style], strength: 1 } },
    },
  },
  {},
  undefined,
  EDGE_TYPES,
];
const EDGE_ROWS = [
  ...EDGE_BODIES.flatMap(([tag, body, numbers]) =>
    ['paint', 'metal', 'glow'].flatMap((style) => [0.25, 1].map((r) => edgeRow(body, numbers, style, r, tag))),
  ),
  edgeRow({ type: 'gem', preset: 'amethyst', ...PRESET_COLORS.amethyst }, null, 'metal', 1, 'gem'),
  edgeRow({ type: 'wood', preset: 'oak', ...PRESET_COLORS.oak }, null, 'metal', 1, 'wood'),
];
const looks = [
  ...Object.entries(LOOKS).map(([id, look]) => [id, look, {}]),
  ...VARIANTS.map(([id, base, note, flags, numbers, body, interior]) => [
    id,
    {
      ...LOOKS[base],
      name: `${LOOKS[base].name} (${note})`,
      appearance: {
        ...LOOKS[base].appearance,
        numbers: { ...LOOKS[base].appearance.numbers, ...numbers },
        body: { ...LOOKS[base].appearance.body, ...body },
        interior: { ...LOOKS[base].appearance.interior, ...interior },
      },
    },
    flags,
  ]),
  ...FACE_ROWS.map(([id, base, note, preset, shown, body]) => [
    id,
    {
      ...LOOKS[base],
      name: `${LOOKS[base].name} (${note})`,
      appearance: { ...LOOKS[base].appearance, body: { ...LOOKS[base].appearance.body, ...body } },
    },
    {},
    { preset, shown },
  ]),
  ...EDGE_ROWS,
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
  if (a.edges.strip && a.edges.strip.style !== 'body') detail.push(`${a.edges.strip.style} strip r${a.edges.radius}`);
  else if (a.edges.style !== 'rounded') detail.push(a.edges.style);
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

const geometries = new Map(); // type|style|radius
// radius (the edge-strip rows, as DiceBox builds them) wins over style
function geometryFor(type, style, radius) {
  const key = `${type}|${style}|${radius}`;
  if (!geometries.has(key)) {
    const geo = buildDieGeometry(getShape(type), radius === undefined ? { style } : { radius });
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
  looks.forEach(([id, look, rowFlags, faceRow, onlyTypes], row) => {
    TYPES.forEach((type, col) => {
      if (faceRow && type !== 'd6') return;
      if (onlyTypes && !onlyTypes.includes(type)) return;
      const shape = getShape(type);
      const { style, radius } = look.appearance.edges;
      const geometry = geometryFor(type, style, onlyTypes ? radius : undefined);
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
