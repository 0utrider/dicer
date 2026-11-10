import * as THREE from 'three';
import { createPhysicsWorker, PhysicsClient } from '../src/physics/physics-client.js';
import { computeHulls } from '../src/physics/hulls.js';
import { DiceRenderer } from '../src/render/renderer.js';
import { loadDigitAtlas } from '../src/render/sdf-atlas.js';
import { DiceBox } from '../src/throw/dice-box.js';
import { getShape } from '../src/core/dice-shapes.js';
import { readTopFace } from '../src/core/face-reader.js';

const TYPES = ['d2', 'd4', 'd6', 'd8', 'd10', 'd12', 'd20'];
const BODIES = ['opaque', 'metal', 'resin'];
const BODY_COLORS = { opaque: '#b3202a', metal: '#7d8794', resin: '#1f6f8b' };

const $ = (id) => document.getElementById(id);
const results = $('results');
let body = 'opaque';
let box = null;

const area = () => ({ left: 0, top: 0, width: window.innerWidth, height: window.innerHeight });

const atlas = await loadDigitAtlas('/assets/fonts');
const physics = new PhysicsClient(createPhysicsWorker, { hulls: computeHulls() });
const renderer = new DiceRenderer({ container: document.body });

function makeBox() {
  box?.dispose();
  box = new DiceBox({
    renderer,
    physics,
    atlas,
    appearance: {
      body,
      bodyColor: BODY_COLORS[body],
      fillColor: '#f2f2f2',
      fillMetallic: body === 'metal',
    },
    getArea: area,
    timeBeforeHide: () => 2000,
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

async function throwAll() {
  const specs = TYPES.map((type) => {
    const shape = getShape(type);
    return { type, value: shape.values[Math.floor(Math.random() * shape.values.length)] };
  });
  $('throw').disabled = true;
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
  results.innerHTML = lines.join('\n');
  window.__dicer.last = lines.length;
  await roll.finished;
  $('throw').disabled = false;
}

for (const name of BODIES) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = name;
  b.dataset.body = name;
  b.setAttribute('aria-pressed', String(name === body));
  b.addEventListener('click', () => {
    body = name;
    for (const other of $('bodies').children) {
      other.setAttribute('aria-pressed', String(other.dataset.body === name));
    }
    makeBox();
  });
  $('bodies').appendChild(b);
}

window.addEventListener('resize', () => box?.onResize());
$('throw').addEventListener('click', () => throwAll());
makeBox();
await physics.ready();
$('status').textContent = 'ready';
$('throw').disabled = false;
