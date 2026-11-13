import { createPhysicsWorker, PhysicsClient } from '../src/physics/physics-client.js';
import { computeHulls } from '../src/physics/hulls.js';
import { DiceRenderer } from '../src/render/renderer.js';
import { loadDigitAtlas } from '../src/render/sdf-atlas.js';
import { TIERS, flagsFor } from '../src/render/quality.js';
import { DiceBox } from '../src/throw/dice-box.js';
import { LOOKS } from '../src/look/looks.js';
import { getShape } from '../src/core/dice-shapes.js';
import { handFor } from '../src/hand/chunk/box.js';
import { openThrowOverlay } from '../src/hand/chunk/overlay.js';

// Rolling by hand, for real: the throw overlay over a real DiceBox (physics worker + wasm, the
// hand chunk attached). Grab, shake and flick with the mouse (or touch); Space throws for you, Esc
// cancels. window.__hand drives it from tests/visual/hand.mjs.

const $ = (id) => document.getElementById(id);
const stage = () => ({ left: 0, top: 0, width: window.innerWidth, height: window.innerHeight });
// A player's area: the bottom-left quarter (as a roll area preset would give).
const playerArea = () => {
  const s = stage();
  return {
    left: 40,
    top: Math.round(s.height * 0.45),
    width: Math.round(s.width * 0.42),
    height: Math.round(s.height * 0.45),
  };
};

// The overlay's strings, as Foundry's i18n would give them.
const lang = await (await fetch('/lang/en.json')).json();
globalThis.game = { i18n: { localize: (k) => k.split('.').reduce((o, p) => o?.[p], lang) ?? k } };

const atlas = await loadDigitAtlas('/assets/fonts');
const physics = new PhysicsClient(createPhysicsWorker, { hulls: computeHulls() });
const renderer = new DiceRenderer({ container: document.body, pixelRatioCap: 1.5 });
renderer.applyTier(TIERS.high);
const box = new DiceBox({
  renderer,
  physics,
  atlas,
  getAppearance: () => LOOKS.default.appearance,
  getFlags: () => flagsFor(TIERS.high, { interiors: true, engraving: true, glow: true }),
  getArea: stage,
  timeBeforeHide: () => 4000,
});
handFor(box);
window.addEventListener('resize', () => box.onResize());

/** Opens the overlay; resolves with what it resolved, plus the read values per die. */
async function hold({
  dice = ['d20'],
  where = 'area',
  ghost = false,
  timeoutMs = 60000,
  seed = 1,
} = {}) {
  const specs = dice.map((type, i) => ({
    type,
    value: getShape(type).values[0], // the placeholder face (look only: physics decides)
    free: true,
    key: `${i}:0:0`,
    shapeType: type,
  }));
  let s = seed >>> 0;
  const rng = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const out = await openThrowOverlay({
    specs,
    rect: where === 'area' ? playerArea() : stage(),
    stage: stage(),
    diePx: box._diePx,
    diceBox: box,
    timeoutMs,
    ghostOnRelease: ghost,
    label: dice.length === 1 ? `1${dice[0]}` : dice.join(' + '),
    rng,
  });
  const text = out.values
    ? `values ${JSON.stringify(out.values)} | recording ${out.recording ? `${out.recording.chunks.length} chunks, settled step ${out.recording.settledStep}, nudges ${JSON.stringify(out.recording.nudges)}` : 'none'}`
    : JSON.stringify(out);
  $('results').textContent = text;
  return {
    ...out,
    handle: undefined,
    recording: out.recording
      ? {
          settledStep: out.recording.settledStep,
          nudges: out.recording.nudges,
          chunks: out.recording.chunks.length,
        }
      : null,
  };
}

$('open').addEventListener('click', () =>
  hold({ dice: $('dice').value.split(','), where: $('where').value, ghost: $('ghost').checked }),
);
await physics.ready();
window.__hand = { hold, box, playerArea, stage, holding: () => box.holding };
$('status').textContent = 'ready';
$('open').disabled = false;
