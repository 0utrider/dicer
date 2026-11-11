import { createPhysicsWorker, PhysicsClient } from '../src/physics/physics-client.js';
import { computeHulls } from '../src/physics/hulls.js';
import { DiceRenderer } from '../src/render/renderer.js';
import { loadDigitAtlas } from '../src/render/sdf-atlas.js';
import { TIERS, flagsFor } from '../src/render/quality.js';
import { DiceBox } from '../src/throw/dice-box.js';
import { LOOKS } from '../src/look/looks.js';
import { PRESETS, resolveArea } from '../src/areas/area-model.js';

// Owner review page for Plan 5: the four presets and a custom area drawn over a fake usable
// region (resolveArea), and two simultaneous throws into two different areas through the real
// DiceBox.roll(specs, {area}). Run `npm run dev` and open /dev/areas.html. window.__areas drives
// it from Playwright.

const $ = (id) => document.getElementById(id);
const errors = [];
const report = (m) => {
  errors.push(m);
  console.error(`dicer areas: ${m}`);
  $('status').textContent = m.slice(0, 300);
  $('status').classList.add('bad');
};
window.addEventListener('error', (e) => report(`page error: ${e.message}`));
window.addEventListener('unhandledrejection', (e) =>
  report(`unhandled: ${e.reason?.stack ?? e.reason}`),
);

const tier = 'high';
const PANEL = 300;
const INSET = 24;
const COLORS = {
  full: '#ffffff',
  centre: '#5ec8ff',
  bottom: '#7dff8a',
  corner: '#ffb454',
  custom: '#ff7ad9',
};
/** The fake usable region: the window right of the panel, inset. */
const usable = () => ({
  left: PANEL + INSET,
  top: INSET,
  width: window.innerWidth - PANEL - 2 * INSET,
  height: window.innerHeight - 2 * INSET,
});

const atlas = await loadDigitAtlas('/assets/fonts');
const physics = new PhysicsClient(createPhysicsWorker, { hulls: computeHulls() });
const renderer = new DiceRenderer({ container: document.body, pixelRatioCap: 1.5 });
renderer.applyTier(TIERS[tier]);
const box = new DiceBox({
  renderer,
  physics,
  atlas,
  getAppearance: () => LOOKS.default.appearance,
  getFlags: () => flagsFor(TIERS[tier], { interiors: true, engraving: true, glow: true }),
  getArea: usable,
  timeBeforeHide: () => 4000,
});
await physics.ready();

const customDef = () => ({
  preset: 'custom',
  x: Number($('cx').value),
  y: Number($('cy').value),
  w: Number($('cw').value),
  h: Number($('ch').value),
});
const defOf = (name) => (name === 'custom' ? customDef() : { preset: name });
const scale = () => Number($('scale').value);
/** The px rect an area name resolves to over the fake region (what the live module computes). */
const rectOf = (name) => resolveArea(defOf(name), usable(), { scale: scale() });

function draw() {
  const overlay = $('overlay');
  overlay.replaceChildren();
  const u = usable();
  const frame = document.createElement('div');
  frame.className = 'rect';
  Object.assign(frame.style, {
    left: `${u.left}px`,
    top: `${u.top}px`,
    width: `${u.width}px`,
    height: `${u.height}px`,
    borderColor: 'rgba(255,255,255,0.35)',
    borderStyle: 'solid',
  });
  frame.textContent = 'usable region';
  overlay.appendChild(frame);
  for (const name of [...Object.keys(PRESETS), 'custom']) {
    if (!document.querySelector(`[data-show="${name}"]`).checked) continue;
    const r = rectOf(name);
    const el = document.createElement('div');
    el.className = 'rect';
    el.dataset.area = name;
    Object.assign(el.style, {
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
      borderColor: COLORS[name],
      color: COLORS[name],
    });
    el.textContent = `${name} ${Math.round(r.width)}x${Math.round(r.height)}`;
    overlay.appendChild(el);
  }
}

for (const id of ['areaA', 'areaB'])
  for (const name of [...Object.keys(PRESETS), 'custom']) $(id).add(new Option(name, name));
$('areaA').value = 'corner';
$('areaB').value = 'centre';
for (const el of document.querySelectorAll('[data-show], #cx, #cy, #cw, #ch, #scale'))
  el.addEventListener('input', draw);

/** Two rolls started in the same tick, each into its own area. */
async function throwBoth(a = $('areaA').value, b = $('areaB').value) {
  const ra = box.roll(
    [
      { type: 'd20', value: 17 },
      { type: 'd6', value: 4 },
    ],
    { area: rectOf(a) },
  );
  const areaA = box.lastRollArea;
  const rb = box.roll(
    [
      { type: 'd12', value: 9 },
      { type: 'd8', value: 5 },
    ],
    { area: rectOf(b) },
  );
  const areaB = box.lastRollArea;
  await Promise.all([ra.landed, rb.landed]);
  return { a: areaA, b: areaB };
}

$('both').addEventListener('click', () => {
  throwBoth().catch((err) => report(`throw: ${err?.stack ?? err}`));
});
window.addEventListener('resize', () => {
  box.onResize();
  draw();
});

draw();
window.__areas = { throwBoth, rectOf, draw, errors, box };
$('status').textContent = 'ready';
