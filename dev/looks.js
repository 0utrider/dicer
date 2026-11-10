// Look gallery: every curated look (rows) on every die type (columns), resting face-up
// under the studio environment. One shared WebGLRenderer, one viewport/scissor per cell.
// Renders on demand only (load and tier change): no loop, no idle GPU work. No physics.
import * as THREE from 'three';
import { buildScene } from '../src/render/scene.js';
import { configureRenderer } from '../src/render/renderer.js';
import { loadDigitAtlas } from '../src/render/sdf-atlas.js';
import { createDiceMaterial } from '../src/render/dice-material.js';
import { NOISE_GLSL } from '../src/render/shaders/noise.js';
import { buildDieGeometry } from '../src/core/chamfer.js';
import { getShape, labelFor } from '../src/core/dice-shapes.js';
import { faceNormals } from '../src/core/face-reader.js';
import { LOOKS } from '../src/look/looks.js';

export const TYPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd2'];
/** The face shown on top per type (6 and 9 show the underline mark). */
const SHOWN = { d4: 4, d6: 6, d8: 8, d10: 9, d12: 12, d20: 20, d2: 2 };
const CELL = 128;
const ROW_LABEL_PX = 170;

/**
 * Quality tiers as planned for src/render/quality.js (Task 7). The gallery keeps its own
 * copy until that module exists; only the fields the gallery applies are used.
 */
const TIERS = {
  low: { pixelRatio: 1, interiorSteps: 0, transmissionScale: 0.5, envResolution: 128 },
  medium: { pixelRatio: 1.25, interiorSteps: 16, transmissionScale: 0.5, envResolution: 256 },
  high: { pixelRatio: 1.5, interiorSteps: 32, transmissionScale: 1, envResolution: 256 },
  ultra: { pixelRatio: 2, interiorSteps: 48, transmissionScale: 1, envResolution: 512 },
};

/**
 * Rows: every curated look, plus variants with per-row flag overrides so variant programs
 * (e.g. the engraving-off #else path) also compile on real WebGL.
 */
const VARIANTS = [['dwarven-brass~flat', 'dwarven-brass', 'engraving off', { engraving: false }]];
const looks = [
  ...Object.entries(LOOKS).map(([id, look]) => [id, look, {}]),
  ...VARIANTS.map(([id, base, note, flags]) => [
    id,
    { ...LOOKS[base], name: `${LOOKS[base].name} (${note})` },
    flags,
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
  const detail = [a.body.type, a.body.type === 'metal' ? a.body.finish : null, a.numbers.fill];
  if (a.interior.type !== 'none') detail.push(a.interior.type);
  if (a.edges.style !== 'rounded') detail.push(a.edges.style);
  if (rowFlags.engraving === false) detail.push('no engraving');
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

/** Rotation putting face `f` up with its label upright (face V axis towards screen-up, -Z). */
function restingQuaternion(shape, f) {
  const up = new THREE.Vector3(0, 1, 0);
  const n = new THREE.Vector3().copy(faceNormals(shape)[f]);
  let v;
  if (shape.kind === 'coin') {
    v = new THREE.Vector3(0, 0, 1); // chamfer.js: V = +Z on both caps
  } else {
    const face = shape.faces[f];
    const c = new THREE.Vector3();
    for (const i of face) c.add(new THREE.Vector3(...shape.vertices[i]));
    c.divideScalar(face.length);
    v = new THREE.Vector3(...shape.vertices[face[0]]).sub(c);
    v.addScaledVector(n, -v.dot(n)).normalize();
  }
  const swing = new THREE.Quaternion().setFromUnitVectors(n, up);
  v.applyQuaternion(swing);
  const target = new THREE.Vector3(0, 0, -1);
  const angle = Math.atan2(up.dot(new THREE.Vector3().crossVectors(v, target)), v.dot(target));
  return new THREE.Quaternion().setFromAxisAngle(up, angle).multiply(swing);
}

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

/** Lowest point of a geometry under rotation q (so the die can rest on y = 0). */
function minY(geo, q) {
  const p = geo.getAttribute('position');
  const v = new THREE.Vector3();
  let min = Infinity;
  for (let i = 0; i < p.count; i++)
    min = Math.min(min, v.fromBufferAttribute(p, i).applyQuaternion(q).y);
  return min;
}

let atlas = null;
const cells = [];

function buildCells() {
  looks.forEach(([id, look, rowFlags], row) => {
    TYPES.forEach((type, col) => {
      const shape = getShape(type);
      const geometry = geometryFor(type, look.appearance.edges.style);
      const face = shape.values.indexOf(SHOWN[type]);
      const mesh = new THREE.Mesh(geometry);
      mesh.quaternion.copy(restingQuaternion(shape, face));
      mesh.position.y = -minY(geometry, mesh.quaternion);
      mesh.visible = false;
      scene.add(mesh);
      const shadow = sceneApi.shadowFor({ position: mesh.position, geometry });
      shadow.visible = false;
      const labels = shape.values.map((v) => labelFor(type, v));
      cells.push({ id, look, rowFlags, type, row, col, shape, labels, mesh, shadow });
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
    c.mesh.material = createDiceMaterial(c.look.appearance, atlas, c.shape, c.labels, {
      ...flags,
      ...c.rowFlags,
    });
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

/**
 * Alpha at every cell centre, read right after a render (no preserveDrawingBuffer). The
 * blob shadows are left out: they sit under every die and would make a cell whose die
 * failed to draw look non-blank.
 */
function cellAlphas() {
  renderGrid({ shadows: false });
  const pr = renderer.getPixelRatio();
  const px = new Uint8Array(4);
  return cells.map((c) => {
    const x = Math.floor((c.col * CELL + CELL / 2) * pr);
    const y = Math.floor(((ROWS - 1 - c.row) * CELL + CELL / 2) * pr);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return { id: c.id, type: c.type, alpha: px[3], rgb: [px[0], px[1], px[2]] };
  });
}

async function setTier(name) {
  if (!TIERS[name]) throw new Error(`unknown tier "${name}"`);
  tier = name;
  const t = TIERS[name];
  flags = { interiors: true, engraving: true, glow: true, interiorSteps: t.interiorSteps };
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
  buildCells();
  noiseProbe();
  await setTier($('tier').value || 'high');
}

const ready = init().catch((err) => report(`init failed: ${err?.stack ?? err}`));
$('tier').addEventListener('change', (e) => {
  setTier(e.target.value).catch((err) => report(`setTier failed: ${err?.stack ?? err}`));
});

window.__looks = { ready, errors, msPerFrame, setTier, cellAlphas, info, noiseProbe };
