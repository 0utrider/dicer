import { createPhysicsWorker, PhysicsClient } from '../src/physics/physics-client.js';
import { computeHulls } from '../src/physics/hulls.js';
import { DiceRenderer } from '../src/render/renderer.js';
import { loadDigitAtlas } from '../src/render/sdf-atlas.js';
import { TIERS, TIER_ORDER, flagsFor } from '../src/render/quality.js';
import { DiceBox } from '../src/throw/dice-box.js';
import { LOOKS } from '../src/look/looks.js';
import { createEffectLayer } from '../src/effects/effect-layer.js';
import { EFFECTS } from '../src/effects/library/index.js';
import { DAMAGE_THEMES } from '../src/effects/damage-themes.js';
import { createSoundEngine } from '../src/audio/sound-engine.js';
import { RESULT_SOUNDS } from '../src/audio/sound-names.js';
import { SOUND_MATERIALS, SURFACES } from '../src/audio/synth.js';

// Owner review page for Plan 4: a d20 on the studio scene, the real DiceBox, effect layer and
// sound engine, and a button for every effect, damage theme, result sound and impact. Run it
// with `npm run dev` and open /dev/effects.html. window.__effects drives it from Playwright.

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const errors = [];
const report = (m) => {
  errors.push(m);
  console.error(`dicer effects: ${m}`);
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

const sounds = createSoundEngine();
let box = null;
const layer = createEffectLayer({
  scene: renderer.scene,
  camera: renderer.camera,
  canvas: renderer.canvas,
  getTier: () => TIERS[tier],
  getSetting: () => undefined, // every feature on
  loadLibrary: async () => ({ EFFECTS }),
  isolate: (die) => box?.isolate(die) ?? null,
});
box = new DiceBox({
  renderer,
  physics,
  atlas,
  getAppearance: () => LOOKS.default.appearance,
  getFlags: () => flagsFor(TIERS[tier], { interiors: true, engraving: true, glow: true }),
  getArea: area,
  timeBeforeHide: () => 2500,
  onImpact: (e) => sounds.impact(e),
  onLandedFx: (die, fx) => {
    for (const f of fx) if (f.sound) sounds.result(f.sound);
  },
  effects: layer,
});
await physics.ready();
layer.prefetch();

/** Throws one d20 that lands on `value`, carrying `fx` (and optionally a look). */
async function roll({ fx = [], appearance, soundMaterial, value = 20 } = {}) {
  sounds.preload(); // a click is a user gesture: the first roll also unlocks audio
  const spec = { type: 'd20', value, fx };
  if (appearance) spec.appearance = appearance;
  if (soundMaterial) spec.soundMaterial = soundMaterial;
  const r = box.roll([spec]);
  await r.landed;
  return r;
}

const fxOf = (effect, sound = null) => [
  { ruleId: 'dev', effect, sound, macro: null, slowMotion: false },
];
const playEffect = (id) => roll({ fx: fxOf({ id }) });
const playTheme = (id) => {
  const t = DAMAGE_THEMES[id];
  return roll({
    appearance: t.appearance,
    soundMaterial: t.soundMaterial,
    fx: t.landing ? fxOf(t.landing.effect, t.landing.sound) : [],
  });
};
const playResult = (name) => sounds.preload().then(() => sounds.result({ builtin: name }));
const playImpact = (material, surface) =>
  sounds.preload().then(() => sounds.impact({ material, surface, speed: 24, other: -1 }));

function buttons(containerId, items, onClick) {
  const el = $(containerId);
  for (const [label, args] of items) {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', () => {
      Promise.resolve(onClick(...args)).catch((err) => report(`${label}: ${err?.stack ?? err}`));
    });
    el.appendChild(b);
  }
}
buttons(
  'effects',
  Object.keys(EFFECTS).map((id) => [id, [id]]),
  playEffect,
);
buttons(
  'themes',
  Object.keys(DAMAGE_THEMES).map((id) => [id, [id]]),
  playTheme,
);
buttons(
  'results',
  RESULT_SOUNDS.map((n) => [n, [n]]),
  playResult,
);
buttons(
  'impacts',
  SOUND_MATERIALS.flatMap((m) => SURFACES.map((s) => [`${m} / ${s}`, [m, s]])),
  playImpact,
);

for (const t of TIER_ORDER) $('tier').add(new Option(t, t));
$('tier').value = tier;
function setTier(name) {
  if (!TIERS[name]) throw new Error(`unknown tier "${name}"`);
  tier = name;
  $('tier').value = name;
  renderer.applyTier(TIERS[name]);
  box.onResize();
  box.invalidateMaterials();
}
$('tier').addEventListener('change', (e) => setTier(e.target.value));
$('plain').addEventListener('click', () => roll({ fx: [] }));
window.addEventListener('resize', () => box.onResize());

window.__effects = { roll, playEffect, playTheme, playResult, playImpact, setTier, errors, layer, box };
$('status').textContent =
  `ready (${Object.keys(EFFECTS).length} effects, ${Object.keys(DAMAGE_THEMES).length} themes)`;
