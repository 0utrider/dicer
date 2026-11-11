import { createPhysicsWorker, PhysicsClient } from '../src/physics/physics-client.js';
import { computeHulls } from '../src/physics/hulls.js';
import { DiceRenderer } from '../src/render/renderer.js';
import { loadDigitAtlas } from '../src/render/sdf-atlas.js';
import { TIERS, flagsFor } from '../src/render/quality.js';
import { DiceBox } from '../src/throw/dice-box.js';
import { createEffectLayer } from '../src/effects/effect-layer.js';
import { EFFECTS } from '../src/effects/library/index.js';
import { createSoundEngine } from '../src/audio/sound-engine.js';
import { BUILTIN_THEMES } from '../src/themes/themes.js';
import { createThumbnailer } from '../src/themes/thumbnailer.js';

// Owner review page for Plan 5: every built-in theme as a thumbnail through the real
// thumbnailer, and a "throw" button per theme that rolls a d20 with the theme's look and its
// celebration (the theme's own natural-20 rule: effect and sound). Run `npm run dev` and open
// /dev/themes.html. window.__themes drives it from Playwright.

const $ = (id) => document.getElementById(id);
const errors = [];
const report = (m) => {
  errors.push(m);
  console.error(`dicer themes: ${m}`);
  $('status').textContent = m.slice(0, 300);
  $('status').classList.add('bad');
};
window.addEventListener('error', (e) => report(`page error: ${e.message}`));
window.addEventListener('unhandledrejection', (e) =>
  report(`unhandled: ${e.reason?.stack ?? e.reason}`),
);

const tier = 'high';
const PANEL = 720;
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
  getAppearance: () => BUILTIN_THEMES[0].appearance,
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

const celebration = (theme) => theme.rules.find((r) => r.die === 'd20' && r.result?.value === 20);

/** Throws a d20 landing on a 20 with the theme's d20 look, sound material and celebration. */
async function throwTheme(id) {
  const theme = BUILTIN_THEMES.find((t) => t.id === id);
  if (!theme) throw new Error(`unknown theme "${id}"`);
  sounds.preload(); // a click is a user gesture: the first throw also unlocks audio
  const rule = celebration(theme);
  const fx = rule
    ? [
        {
          ruleId: rule.id,
          effect: rule.effect ?? null,
          sound: rule.sound ?? null,
          macro: null,
          slowMotion: false,
        },
      ]
    : [];
  const spec = { type: 'd20', value: 20, appearance: theme.perType?.d20 ?? theme.appearance, fx };
  if (theme.soundMaterial) spec.soundMaterial = theme.soundMaterial;
  const r = box.roll([spec]);
  await r.landed;
  return r;
}

const thumbs = createThumbnailer({ atlas, warn: report });
const grid = $('grid');
const loaded = [];
for (const theme of BUILTIN_THEMES) {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.theme = theme.id;
  const blank = document.createElement('div');
  blank.className = 'blank';
  blank.textContent = '...';
  const name = document.createElement('b');
  name.textContent = theme.name;
  const sub = document.createElement('small');
  const rule = celebration(theme);
  sub.textContent = `${theme.soundMaterial ?? 'default'} | ${
    rule ? `${rule.effect?.id} + ${rule.sound?.builtin}` : 'no celebration'
  }`;
  const btn = document.createElement('button');
  btn.textContent = 'throw';
  btn.addEventListener('click', () => {
    throwTheme(theme.id).catch((err) => report(`${theme.id}: ${err?.stack ?? err}`));
  });
  card.append(blank, name, sub, btn);
  grid.appendChild(card);
  loaded.push(
    thumbs.thumbnail(theme, 'd20').then((url) => {
      if (!url) {
        report(`no thumbnail for ${theme.id}`);
        return;
      }
      const img = document.createElement('img');
      img.alt = theme.name;
      img.src = url;
      blank.replaceWith(img);
      return img.decode?.().catch(() => {});
    }),
  );
}
window.addEventListener('resize', () => box.onResize());

const ready = Promise.all(loaded).then(() => {
  const n = grid.querySelectorAll('img').length;
  $('status').textContent = `ready (${n}/${BUILTIN_THEMES.length} thumbnails)`;
  return n;
});
window.__themes = { throwTheme, ready, errors, thumbs, box, themes: BUILTIN_THEMES };
