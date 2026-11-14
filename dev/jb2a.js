import { createPhysicsWorker, PhysicsClient } from '../src/physics/physics-client.js';
import { computeHulls } from '../src/physics/hulls.js';
import { DiceRenderer } from '../src/render/renderer.js';
import { loadDigitAtlas } from '../src/render/sdf-atlas.js';
import { TIERS, TIER_ORDER, flagsFor } from '../src/render/quality.js';
import { DiceBox } from '../src/throw/dice-box.js';
import { LOOKS } from '../src/look/looks.js';
import { createEffectLayer } from '../src/effects/effect-layer.js';
import * as library from '../src/effects/library/index.js';
import { JB2A_EFFECTS } from '../src/jb2a/chunk/catalogue.js';

// JB2A review page: a d20 on the studio scene with the real DiceBox and effect layer, wired to
// JB2A as in Foundry but reading the files from /jb2a-local/ (tests/visual/jb2a.mjs copies them
// there from ../jb2a_patreon). Run it with `npm run dev` and open /dev/jb2a.html once the files
// are copied. window.__jb2a drives it from Playwright.

const params = new URLSearchParams(location.search);
// Review params: jb2a=off plays the built-in effects only; bg=dark|light picks the backdrop behind
// the transparent canvas; color=#rrggbb recolours the built-in effect (fx entry colour).
const jb2aOff = params.get('jb2a') === 'off';
const state = { color: params.get('color') || undefined };
const BACKDROPS = {
  dark: '#2b2f36',
  light: 'radial-gradient(ellipse at 30% 25%, #f3e6c4 0%, #e6d2a2 55%, #cdb584 100%), #e6d2a2',
};
function setBg(name) {
  document.body.style.background = BACKDROPS[name] ?? BACKDROPS.dark;
}
setBg(params.get('bg'));
const $ = (id) => document.getElementById(id);
const errors = [];
const report = (m) => {
  errors.push(m);
  console.error(`dicer jb2a: ${m}`);
  $('status').textContent = m.slice(0, 300);
  $('status').classList.add('bad');
};
window.addEventListener('error', (e) => report(`page error: ${e.message}`));
window.addEventListener('unhandledrejection', (e) =>
  report(`unhandled: ${e.reason?.stack ?? e.reason}`),
);

let tier = TIERS[params.get('tier')] ? params.get('tier') : 'high';
const PANEL = 340;
const area = () => ({
  left: PANEL,
  top: 0,
  width: window.innerWidth - PANEL,
  height: window.innerHeight,
});

const atlas = await loadDigitAtlas('/assets/fonts');
const physics = new PhysicsClient(createPhysicsWorker, { hulls: computeHulls() });
const renderer = new DiceRenderer({ container: document.body, pixelRatioCap: 1.5 });
renderer.applyTier(TIERS[tier]);

let box = null;
const layer = createEffectLayer({
  scene: renderer.scene,
  camera: renderer.camera,
  canvas: renderer.canvas,
  getTier: () => TIERS[tier],
  getSetting: (key) => (jb2aOff && key === 'jb2aEffects' ? false : undefined), // every feature on
  loadLibrary: async () => library, // the whole module, as in Foundry: EFFECTS plus the particle pool
  isolate: (die) => box?.isolate(die) ?? null,
  jb2a: {
    source: () => ({ moduleId: 'jb2a_patreon', location: '/jb2a-local' }),
    load: () => import('../src/jb2a/jb2a.js'),
  },
});
box = new DiceBox({
  renderer,
  physics,
  atlas,
  getAppearance: () => LOOKS.default.appearance,
  getFlags: () => flagsFor(TIERS[tier], { interiors: true, engraving: true, glow: true }),
  getArea: area,
  timeBeforeHide: () => 2500,
  effects: layer,
});
await physics.ready();
await layer.prefetch();

/**
 * Throws one d20 that lands on `value`, carrying `fx`; resolves when it has landed. `options` go to
 * DiceBox.roll (the harness passes a small centred `area` and a fixed `seed`).
 */
async function roll({ fx = [], value = 20 } = {}, options) {
  const r = box.roll([{ type: 'd20', value, fx }], options);
  await r.landed;
  return r;
}

const fxOf = (effect) => [{ ruleId: 'dev', effect, sound: null, macro: null, slowMotion: false }];
const playEffect = (id, options) =>
  roll({ fx: fxOf(state.color ? { id, color: state.color } : { id }) }, options);
const ids = Object.keys(JB2A_EFFECTS);

for (const id of ids) {
  const b = document.createElement('button');
  b.textContent = id;
  b.addEventListener('click', () =>
    playEffect(id).catch((err) => report(`${id}: ${err?.stack ?? err}`)),
  );
  $('effects').appendChild(b);
}

for (const t of TIER_ORDER) $('tier').add(new Option(t, t));
$('tier').value = tier;
$('tier').addEventListener('change', (e) => {
  tier = e.target.value;
  renderer.applyTier(TIERS[tier]);
  box.onResize();
  box.invalidateMaterials();
});
$('plain').addEventListener('click', () => roll());
window.addEventListener('resize', () => box.onResize());

const { EFFECTS } = library;
const durations = Object.fromEntries(
  ids.map((id) => [id, EFFECTS[id]?.defaults?.duration ?? 1000]),
);
const setColor = (c) => (state.color = c || undefined);

window.__jb2a = { roll, playEffect, ids, durations, setColor, setBg, errors, layer, box };
$('status').textContent = `ready (${ids.length} JB2A effects)`;
