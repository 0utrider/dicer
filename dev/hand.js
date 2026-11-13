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
import { encodeTrajectory, decodeTrajectory } from '../src/hand/chunk/trajectory.js';
import { handBuffer } from '../src/hand/chunk/replay.js';
import { createPetLayer, SPLAT_SPEED } from '../src/pet/chunk/pets.js';

// Rolling by hand, for real: the throw overlay over a real DiceBox (physics worker + wasm, the
// hand chunk attached). Grab, shake and flick with the mouse (or touch); Space throws for you, Esc
// cancels. window.__hand drives it from tests/visual/hand.mjs.
//
// Review demos (the second bar), all through the real DiceBox, hand chunk and pet layer:
//  - Throw for me: the overlay, then its own "Throw for me" button pressed for you;
//  - Cocked d20 / Cocked coin: a seeded launch that rests cocked, so the worker nudges it flat
//    (the nudge is in the recorded frames: the results line shows the nudge count);
//  - d16 read: a d16 read from below, its counted face glowing after it lands;
//  - Pet, then Splat it: a resting mimic, then a hand throw aimed at it (above Dicer's splat speed);
//  - Replay last: the last throw encoded, sent through JSON like a socket payload, and replayed
//    through the receiver's path at half the area size (H-11), pets aligned as on a receiver.

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
let pets = null;
const box = new DiceBox({
  pet: () => pets,
  renderer,
  physics,
  atlas,
  getAppearance: () => LOOKS.default.appearance,
  getFlags: () => flagsFor(TIERS.high, { interiors: true, engraving: true, glow: true }),
  getArea: stage,
  timeBeforeHide: () => 4000,
});
handFor(box);
pets = createPetLayer({
  scene: renderer.scene,
  camera: renderer.camera,
  getTier: () => TIERS.high,
  getSetting: () => undefined, // every pet default
  playSound: () => {},
  warm: (o) => renderer.warmObjects?.(o),
  wake: () => box.wake(),
  activeRolls: () => box.activeRolls,
  holding: () => box.holding,
});
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
// ---- review demos ----

const say = (text) => ($('results').textContent = text);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const PET = { userId: 'me', kind: 'mimic', color: '#d9a441', ghost: false };
/** The sim's reference area (24 x 14 die units, centred on the stage), where the launches below were found. */
const fairRect = () => {
  const s = stage();
  const w = 24 * box._diePx;
  const h = 14 * box._diePx;
  return { left: (s.width - w) / 2, top: (s.height - h) / 2, width: w, height: h };
};
const specsOf = (types) =>
  types.map((type, i) => ({
    type,
    value: getShape(type).values[0],
    free: true,
    key: `${i}:0:0`,
    shapeType: type,
  }));
let last = null; // {specs (with the read values), recording, values, rect}

/** The resting pet as {x, z, phase} in die units, or null. */
function restingPet() {
  const o = renderer.scene.children.find((c) => c.userData.dicerPet);
  return o ? { x: o.position.x, z: o.position.z, phase: o.userData.dicerPet.phase } : null;
}

/** A free, launched throw of `types` (physics decides): resolves what landed. */
async function freeThrow({ types, area, launch, seed, pet, label }) {
  let recording = null;
  const specs = specsOf(types);
  const r = box.roll(specs, { area, free: true, launch, seed, pet, record: (rec) => (recording = rec) });
  const values = await r.values;
  await r.landed;
  last = {
    specs: specs.map((s, i) => ({ ...s, value: values?.[i] ?? s.value })),
    recording,
    values,
    rect: area,
  };
  const frames = recording ? recording.chunks.reduce((n, c) => n + c.length, 0) / (7 * types.length) : 0;
  say(`${label}: values ${JSON.stringify(values)} | nudges ${JSON.stringify(recording?.nudges)} | ${frames} frames`);
  return { values, nudges: recording?.nudges ?? null };
}

// Launches found with the real sim, each of which rests cocked first (so the worker nudges it
// flat) when thrown from the left of the fairness area (24 x 14 die units).
const LAUNCH = (linvel, angvel) => [{ pos: [-5, 2.2, 0], quat: [0, 0, 0, 1], linvel, angvel }];
const DEMOS = {
  'cocked-d20': () =>
    freeThrow({ types: ['d20'], area: fairRect(), seed: 7, launch: LAUNCH([3, 0, 0], [3, 2, 1]), label: 'cocked d20' }),
  'cocked-coin': () =>
    freeThrow({ types: ['d2'], area: fairRect(), seed: 2678, launch: LAUNCH([7, 0, 0.8], [1, 0, -6]), label: 'cocked coin' }),
  // The d16 counts the kite paired with the one on the table; it glows for RESULT_GLOW_MS after landing.
  'd16-read': () =>
    freeThrow({ types: ['d16'], area: fairRect(), seed: 11, launch: LAUNCH([7, 0, -0.8], [-2, -5, 5]), label: 'd16 (counted face glows)' }),
  'pet-place': async () => {
    // An ordinary forced throw: the pet hops in, throws, then rests in the area.
    await box.roll([{ type: 'd6', value: 4, key: '0:0:0' }], { area: playerArea(), pet: PET }).landed;
    await wait(1500);
    const p = restingPet();
    say(p ? `the mimic rests at x ${p.x.toFixed(1)}, z ${p.z.toFixed(1)}` : 'the pet has not settled yet');
    return { pet: p };
  },
  'pet-splat': async () => {
    const p = restingPet();
    if (!p) {
      say('place the pet first');
      return { pet: null };
    }
    // Two dice flicked at the pet from its left, above the splat speed.
    const v = [SPLAT_SPEED * 1.8, -0.5, 0];
    const at = (dx, dz) => ({ pos: [p.x - 6 - dx, 1.6, p.z + dz], quat: [0, 0, 0, 1], linvel: v, angvel: [4, 2, 6] });
    const out = await freeThrow({
      types: ['d6', 'd6'],
      area: playerArea(),
      launch: [at(0, 0), at(1.4, 0.6)],
      seed: 3,
      pet: PET,
      label: 'pet splat throw',
    });
    await wait(300);
    return { ...out, pet: restingPet() };
  },
};

/** Last throw: encode, send through JSON like the socket, replay at half the area size. */
async function replayLast() {
  if (!last?.recording) {
    say('throw something first (a cocked die, the d16, or a hand throw)');
    return null;
  }
  const payload = JSON.parse(JSON.stringify(encodeTrajectory(last.recording, { values: last.values })));
  const decoded = decodeTrajectory(payload);
  if (!decoded) throw new Error('the payload did not decode');
  const s = stage();
  const half = { width: Math.round(last.rect.width / 2), height: Math.round(last.rect.height / 2) };
  // the right of the screen, level with the thrower's area
  const rect = { left: s.width - half.width - 40, top: last.rect.top + Math.round(half.height / 2), ...half };
  const n = last.specs.length;
  const landed = handBuffer().replay(decoded, {
    roll: { options: { dicerHand: { id: 'dev', by: 'me', n } } },
    author: 'me',
    specs: last.specs,
    full: () => last.specs,
    opts: { area: rect, capacityDice: n },
    cast: (sp, o) => box.roll(sp, o).landed,
    diceBox: box,
    alive: () => true,
  });
  if (!landed) throw new Error('the replay did not start');
  await landed;
  const bytes = JSON.stringify(payload).length;
  say(`replayed ${n} dice from ${bytes} B at half the area (${half.width} x ${half.height} px); the thrower read ${JSON.stringify(last.values)}`);
  return { bytes, values: last.values };
}

/** Opens the overlay, then presses its own "Throw for me" button. */
async function throwForMe(o) {
  const done = hold(o);
  for (let i = 0; i < 40 && !document.querySelector('.dicer-hand-overlay [data-action="auto"]'); i++)
    await wait(50);
  document.querySelector('.dicer-hand-overlay [data-action="auto"]')?.click();
  return done;
}

const demo = async (name) => {
  try {
    return await DEMOS[name]();
  } catch (err) {
    say(`${name} failed: ${err?.message ?? err}`);
    console.error(err);
    return null;
  }
};
for (const id of Object.keys(DEMOS)) $(id).addEventListener('click', () => demo(id));
$('replay').addEventListener('click', () =>
  replayLast().catch((e) => (say(`replay failed: ${e.message}`), console.error(e))),
);
$('throw-for-me').addEventListener('click', () =>
  throwForMe({ dice: $('dice').value.split(','), where: $('where').value, ghost: $('ghost').checked }),
);

await physics.ready();
window.__hand = {
  hold,
  box,
  playerArea,
  stage,
  holding: () => box.holding,
  demo,
  replayLast,
  throwForMe,
  restingPet,
};
$('status').textContent = 'ready';
for (const b of document.querySelectorAll('#bar button, #demos button')) b.disabled = false;
