// The crit scenes chunk (scenes-[hash].js, lazy: build/world-start.js LAZY): short animated
// vignettes around a landed die. The effects chunk's stand-ins (effects/library/scene-stubs.js)
// import it on the first scene and call SCENES[id].play(ctx). Its keys are exactly the catalogued
// ids (effects/library/scene-catalog.js); every scene passes tests/unit/scene-contract.js.
// natural 20s
import { shadowThief } from './shadow-thief.js';
import { meteor } from './meteor.js';
import { portalHop } from './portal-hop.js';
import { lightningVerdict } from './lightning-verdict.js';
import { goldenAscension } from './golden-ascension.js';
import { dragonCoil } from './dragon-coil.js';
import { fireworks } from './fireworks.js';
import { crownDrop } from './crown-drop.js';
import { phoenix } from './phoenix.js';
import { runeCircle } from './rune-circle.js';
// natural 1s
import { bananaPeel } from './banana-peel.js';
import { rainCloud } from './rain-cloud.js';
import { ghostOut } from './ghost-out.js';
import { anvil } from './anvil.js';
import { blackHole } from './black-hole.js';
import { crackAndTape } from './crack-and-tape.js';
import { wiltedFlower } from './wilted-flower.js';
import { tumbleweed } from './tumbleweed.js';
import { crows } from './crows.js';
import { pratfall } from './pratfall.js';

/** Marks this chunk in tests (it must never be found in dist/dicer.js). */
export const CHUNK = 'dicer-scenes-chunk';

const ALL = [
  shadowThief,
  meteor,
  portalHop,
  lightningVerdict,
  goldenAscension,
  dragonCoil,
  fireworks,
  crownDrop,
  phoenix,
  runeCircle,
  bananaPeel,
  rainCloud,
  ghostOut,
  anvil,
  blackHole,
  crackAndTape,
  wiltedFlower,
  tumbleweed,
  crows,
  pratfall,
];

export const SCENES = Object.freeze(Object.fromEntries(ALL.map((s) => [s.id, s])));
