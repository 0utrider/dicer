import * as THREE from 'three';
import { getShape } from '../src/core/dice-shapes.js';
import { readTopFace, rotationToShow, faceForValue } from '../src/core/face-reader.js';

// Research rig for docs/research/dsn-model-orientation.md: observes a third-party GLB die by
// its geometry (flat-face normals) and by renders of each face, and checks a candidate model
// rotation through the same math DiceBox uses. Driven by tests/visual/model-orientation.mjs.

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#3a3f48');
scene.add(new THREE.AmbientLight(0xffffff, 1.2));
const head = new THREE.DirectionalLight(0xffffff, 2.5);
scene.add(head);
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
const holder = new THREE.Group(); // plays DiceBox's inner mesh
scene.add(holder);
const errors = [];
window.addEventListener('error', (e) => errors.push(String(e.message)));

let model = null;
const DRACO_DEV = '/node_modules/three/examples/jsm/libs/draco/gltf/';
const { loadDieModel } = await import('../src/render/model-loader.js');

async function load(url) {
  holder.clear();
  model = await loadDieModel(url, { radius: 1, decoderPath: DRACO_DEV });
  holder.add(new THREE.Mesh(model.geometry, model.material));
  return model.geometry.attributes.position.count;
}

/**
 * Flat-face clusters of the loaded geometry: triangles grouped by normal direction (cos > 0.995),
 * the `n` largest by area. Each normal is the area-weighted mean of its triangles.
 */
function clusters(n) {
  const geo = model.geometry.index ? model.geometry.toNonIndexed() : model.geometry;
  const p = geo.attributes.position;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const tris = [];
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, i + 1);
    c.fromBufferAttribute(p, i + 2);
    const cr = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    const area = cr.length() / 2;
    if (area > 0) tris.push({ n: cr.normalize(), area });
  }
  tris.sort((x, y) => y.area - x.area);
  const out = [];
  for (const t of tris) {
    const hit = out.find((k) => k.dir.dot(t.n) > 0.995);
    if (hit) {
      hit.sum.addScaledVector(t.n, t.area);
      hit.area += t.area;
      hit.dir.copy(hit.sum).normalize();
    } else out.push({ sum: t.n.clone().multiplyScalar(t.area), dir: t.n.clone(), area: t.area });
  }
  out.sort((x, y) => y.area - x.area);
  return out.slice(0, n).map((k) => ({
    normal: k.dir.toArray().map((x) => +x.toFixed(6)),
    area: +k.area.toFixed(4),
  }));
}

function render(size) {
  renderer.setSize(size, size, false);
  head.position.copy(camera.position);
  renderer.render(scene, camera);
  return canvas.toDataURL('image/png');
}

/** The loaded model (unrotated) seen straight down `normal`, from outside. */
function shot(normal, size = 320) {
  holder.quaternion.identity();
  const dir = new THREE.Vector3(...normal).normalize();
  camera.up.set(0, 1, 0);
  if (Math.abs(dir.y) > 0.9) camera.up.set(0, 0, -1);
  camera.position.copy(dir).multiplyScalar(4.2);
  camera.lookAt(0, 0, 0);
  return render(size);
}

/**
 * The model as DiceBox would show it forced to `value`: the model rotation `quat` premultiplied
 * before the face-forcing rotation (from an identity landing), seen from above the table.
 */
function verify(type, quat, value, size = 320) {
  const shape = getShape(type);
  const landed = readTopFace(shape, { x: 0, y: 0, z: 0, w: 1 });
  const r = rotationToShow(shape, landed, faceForValue(shape, value));
  const force = new THREE.Quaternion(r.x, r.y, r.z, r.w);
  holder.quaternion.copy(force).multiply(new THREE.Quaternion(...quat));
  camera.up.set(0, 0, -1);
  camera.position.set(0, 4.2, 0.0001);
  camera.lookAt(0, 0, 0);
  return render(size);
}

/** One image of `urls` (renders) in a grid, each cell tagged with its index or `tags[i]`. */
async function sheet(urls, cell = 160, tags = null) {
  const cols = Math.min(5, urls.length);
  const out = document.createElement('canvas');
  out.width = cols * cell;
  out.height = Math.ceil(urls.length / cols) * cell;
  const g = out.getContext('2d');
  for (const [i, url] of urls.entries()) {
    const img = new Image();
    img.src = url;
    await img.decode();
    const x = (i % cols) * cell;
    const y = Math.floor(i / cols) * cell;
    g.drawImage(img, x, y, cell, cell);
    g.fillStyle = '#ff0';
    g.font = 'bold 18px monospace';
    g.fillText(String(tags ? tags[i] : i), x + 4, y + 20);
  }
  return out.toDataURL('image/png');
}

window.__models = { load, clusters, shot, verify, sheet, errors };
