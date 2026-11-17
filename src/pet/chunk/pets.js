import * as THREE from 'three';
import { CREATURES } from './creatures/index.js';
import {
  phaseAt,
  ENTER_MS,
  THROW_MS,
  REACT_MS,
  REST_HOP_MS,
  WOBBLE_MS,
  SPLAT_MS,
  REFORM_MS,
} from './timeline.js';
import { createSplat } from './splat.js';
import { summarize, merge, reactionSound } from './reaction.js';
import { discTexture, starTexture, heartTexture, puffTexture, smokeTexture } from './textures.js';
import {
  edgeSpot,
  restSpot,
  inRestRing,
  offPoint,
  fitArea,
  obstacle,
  SLIDE,
  SPACING,
  EDGE_GAP,
  PET_HEIGHT,
  KIND_FOOTPRINT,
  FOOTPRINT,
} from './resting.js';
import { spotFor as chosenSpot, atEdge, placedSpot, toPlaced, validAt, TAN_HALF_FOV } from './rest-spots.js';
import { createPetting, petClickable, HUFF_IGNORE_MS } from './petting.js';
import { maySplat } from '../../physics/protocol.js';
import { elementReactions, reactionOf, resting } from './reactions.js';
import { elementOf } from '../../effects/element-of.js';
import { ELEMENT_FX, PHYSICAL, writeMotes, writePuffs } from './element-fx.js';
import { createMoods } from './moods.js';
import { petFor } from '../pet-for.js';

/** At most this many pets on screen at once. */
export const MAX_PETS = 3;
/**
 * A die hits a pet at this speed (scene units per second; the physics' relative speed) or more and
 * it splats; between WOBBLE_SPEED and it, the pet only wobbles; below WOBBLE_SPEED, nothing.
 * Measured on the real sim (see the task 4 report): a d6 arriving from a throw at full pace hits at
 * 14 (10th percentile) to 27, median 22; a die tumbling into a pet as it comes to rest at about
 * 2 to 4, rarely above 10.
 */
export const SPLAT_SPEED = 10;
export const WOBBLE_SPEED = 1.5;
/** A puddle fades this long after its splat when its owner hasn't rolled again (owner, 2026-11-14). */
export const PUDDLE_LEAVE_MS = 5000;
const PUDDLE_MS = 600; // the eyes open and blink once, then the puddle holds
const WOBBLE_PUSH = 0.3; // of the height, the recoil away from the die
// The states of a pet knocked flat: bursting, lying there, pulling back together, fading away.
const NO_LOOK = { yaw: 0 }; // shared: poses only read it
const WOBBLE_LOOK = { yaw: 0, leanX: 0, leanZ: 0 }; // reused: the push in the pet's own space
const DOWN = new Set(['splat', 'puddle', 'reform', 'fade']);
const HOP = 0.45; // of the height
const LIFT = 0.6; // of the height: how high a pet held by the mouse hangs
const LOOK_MAX = 0.6;
const GAZE_TURN_MS = 260; // a resting pet's body turning toward the cursor (its head is quicker)
const GAZE_SETTLED = 0.01; // rad: turned this close, it holds still (no more frames)
const GAZE_NEAR = 0.6; // of the height: a cursor this close above it is ignored (it would spin)
const MOVED = 1e-3; // a re-used pet farther than this from its new spot hops there
// Foundry's UI that the dice canvas draws over (v14 puts it at z-index 30, the canvas at 60): its
// widgets, not v14's #ui-left / #ui-top, which are mostly empty boxes (578 px wide, half the screen
// tall): kept off them, a top corner's pet was pushed to the bottom. Those boxes count only where
// the widgets are not found (older layouts). #scene-navigation is a full-height column: its items count.
const UI_IDS = ['scene-controls', 'players', 'hotbar', 'navigation'];
const UI_LISTS = ['scene-navigation'];
const UI_BOXES = ['ui-left', 'ui-top'];
const AREAS_HOOK = 'dicerRollAreasChanged';

const FLY_PEAK = 1.2; // the dragonling's flight arc on a move (alignFor), die units
// The dice tray's rim (petTray 'rim', deps.perch): a die hitting the tray wall at this speed or more
// within WALL_REACH of a pet sitting on the rim makes it wobble (it never reaches the pet itself).
export const WALL_FLINCH_SPEED = 4;
// The table tray (tray.js TRAY_ID / TRAY_EVENT, copied: the tray chunk is not imported here). One
// that shows only while rolling slides away between rolls: the pets on its rim leave with it.
const TRAY_ID = 'dicer-table-tray';
const TRAY_EVENT = 'dicertray';
export const WALL_REACH = 2.5;

// The crit's sparkle burst: a few additive star points thrown out around the pet.
const SPARKS = 12;
const BURST_MS = 900; // from the start of the crit reaction
const SPARK_SIZE = 1.7; // PointsMaterial size: about 0.3 die units under Dicer's FOV-20 camera
const GOLD = [1, 0.78, 0.3];
const WHITE = [1, 0.96, 0.86];
// Fixed per spark (every burst alike, nothing random per frame): direction, reach, rise, twinkle phase.
const SPARK = Array.from({ length: SPARKS }, (_, i) => {
  const j = Math.sin((i + 1) * 12.9898) * 43758.5453;
  const r = j - Math.floor(j);
  return {
    a: (i / SPARKS) * Math.PI * 2 + r * 0.5,
    reach: 0.7 + 0.5 * r,
    rise: 0.25 + 0.6 * ((r * 7) % 1),
    ph: r * Math.PI * 2,
    c: i % 3 === 0 ? WHITE : GOLD,
  };
});

// Click to pet (petting.js does the listening): the wiggle, the huff before its hop off, the hop.
export const PET_MS = 900;
export const HUFF_MS = 600;
const HUFF_HOP = 1; // of the height: how far a huffy pet hops off, toward the middle of the table
export const PICK_MARGIN = 0.15; // of the height: added to the footprint for a click's hit area
// The table under the pets: Foundry's board canvas, and Dicer's canvas and layer (pointer-events
// none today, listed in case). A click on anything else (a window, a menu, the hand overlay) is not a pet's.
const TABLE_IDS = ['board', 'dicer-canvas', 'dicer-layer'];
const HEARTS = 5; // of the sparkle's SPARKS points (reduced motion: 3)
const PUFFS = 6;
const PINK = [1, 0.4, 0.6];
const GREY = 0.55;

// Reactions to an elemental die landing by a resting pet (petElemental; reactions.js picks them).
/** The die-width unit: one world unit is one die at any diceScale (DiceBox: DIE_SIZE_PX per unit). */
export const DIE_WIDTH = 1;
export const SCORCH_MS = 1200; // fire, lava: a smoke puff, and it fans itself
export const SHIVER_MS = 1300; // frost: a shiver under a frosty tint that fades
export const BRISTLE_MS = 1000; // storm: it bristles, a few sparks
export const STARTLE_MS = 750; // any other element: a jump
const SMOKES = 8; // a scorch's smoke puffs: their own points, normally blended (grey reads as smoke)
const SMOKE_SIZE = SPARK_SIZE * 2.6;
const SMOKE_GREY = [0.03, 0.42]; // linear: charcoal and pale grey puffs in turn, smoke on any map
const SPARKLES = 9; // of the sparkle's SPARKS points
const ZAP_SIZE = SPARK_SIZE * 3.4;
const ZAP = [1, 0.9, 0.35]; // the sparks: yellow, and white
// The frosty tint: the pet's colour multiplied by a cool filter (warm channels damped, never washed
// toward white, so its own colour still shows) and a faint cold sheen.
const FROST_TINT = ELEMENT_FX.frost.tint; // [filter, glow]: (0.72, 0.88, 1) and a faint cold sheen
const iceNow = new THREE.Color(); // scratch
const glowNow = new THREE.Color(); // scratch
// Moods (petMoods; moods.js keeps each owner's recent d20s): a resting pet settles into its owner's
// mood pose over MOOD_MS and then holds it, static. A proud pet's settle has one soft twinkle.
export const MOOD_MS = 800;
const MOODS = new Set(['proud', 'sulk']);
const TWINKLES = 3; // of the sparkle's SPARKS points
/**
 * Every layer's mood history (one per page: a rebuilt engine's new layer keeps it; only a reload
 * clears it). deps.moods replaces it (tests, the dev page).
 */
const pageMoods = createMoods();
// Cheering (petCheer): someone else's natural 20 lands and every other resting pet turns to the
// dice, cheers (two hops and a few gold stars, each a single swell, never a flicker) and turns back.
export const CHEER_MS = 1300;
const CHEERS = 6; // of the sparkle's SPARKS points (reduced motion: 3, dimmer)
// A pet in the middle of one of these does not cheer: a huff, a reaction, a cheer already.
const BUSY = new Set(['huff', 'scorch', 'shiver', 'bristle', 'startle', 'cheer']);
/** How long each of a resting pet's animations (pet.anim.kind) runs. */
const ANIM_MS = { pet: PET_MS, huff: HUFF_MS, scorch: SCORCH_MS, shiver: SHIVER_MS, bristle: BRISTLE_MS, startle: STARTLE_MS, proud: MOOD_MS, sulk: MOOD_MS, cheer: CHEER_MS };

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (x) => (x > 0 ? (x < 1 ? x : 1) : 0);

/**
 * The pet layer (lazy chunk): one pet per roller, driven by DiceBox's PetHook. A pet's whole life
 * is a timeline (timeline.js); update() poses and places it each frame and removes it when gone.
 * A pet re-used by overlapping rolls keeps each roll's ghost flag and landed summary by key: it
 * reacts once every live roll has landed, to their merged summaries (reaction.js).
 */
export function createPetLayer(deps) {
  const { scene, getSetting, playSound, warm } = deps;
  const clock = deps.now || (() => performance.now()); // test seam; DiceBox's update() is on this clock
  const rand = deps.random || Math.random; // test seam: the rest spots
  const setTimer = deps.setTimer || ((fn, ms) => setTimeout(fn, ms)); // test seams: the idle timer
  const clearTimer = deps.clearTimer || ((id) => clearTimeout(id));
  const doc = deps.doc || globalThis.document; // test seam: Foundry's UI, which rest spots avoid
  const hooks = deps.hooks || globalThis.Hooks; // test seam: Foundry's hooks (area edits)
  const userOf = deps.userOf || ((id) => globalThis.game?.users?.get?.(id)); // test seam: alignFor's absent pets
  const moods = deps.moods || pageMoods;
  // test seam: saves a client setting (where a dropped pet rests); null where nothing can be saved
  const saveSetting =
    deps.setSetting ?? (globalThis.game?.settings?.set ? (k, v) => globalThis.game.settings.set('dicer', k, v) : null);
  // The last stage DiceBox told us ({cx, cz, halfWidth, halfDepth, rect?}: rect is its px rect): a
  // rest area is always fitted inside it.
  let stage = null;
  const pets = new Map(); // userId -> pet
  const keyOwner = new Map(); // roll key -> userId
  // roll key -> {userId, ghost} of every begun pet roll until it lands or ends, pet placed or not
  // (and kept through a splat): whose recent d20s its landing adds to (moods)
  const keyRoller = new Map();
  // userId -> {area, spot}: the rest spot obstaclesFor chose for a pet that has none yet, which
  // begin then takes (so the physics and the pet agree on it)
  const pending = new Map();
  let shadowTex = null;
  let shadowGeo = null;
  let sparkTex = null;
  let sparkMat = null;
  let heartMat = null; // petting's hearts and a huff's puff: the sparkle's points, another sprite
  let puffMat = null;
  let smokeMat = null; // a scorch's smoke (makeSmoke) and a bristle's sparks (bigger star sprites)
  let zapMat = null;
  let petting = null; // the click listeners (petting.js) while a pet is shown
  let disposed = false;
  let timer = null; // the one timer, aimed at the earliest leaveAt (so a held loop wakes up)
  let timerAt = Infinity;

  const makeShadow = () => {
    shadowTex ??= discTexture();
    shadowGeo ??= new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2);
    const shadow = new THREE.Mesh(
      shadowGeo,
      new THREE.MeshBasicMaterial({
        map: shadowTex,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
      }),
    );
    shadow.name = 'petShadow';
    shadow.position.y = 0.01;
    return shadow;
  };

  /** The burst's points: one shared material, a small geometry per pet rewritten in place. */
  const makeSparkle = () => {
    sparkTex ??= starTexture();
    sparkMat ??= new THREE.PointsMaterial({
      size: SPARK_SIZE,
      map: sparkTex,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const geo = new THREE.BufferGeometry();
    for (const name of ['position', 'color'])
      geo.setAttribute(
        name,
        new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3).setUsage(THREE.DynamicDrawUsage),
      );
    const pts = new THREE.Points(geo, sparkMat);
    pts.name = 'petSparkle';
    pts.visible = false;
    pts.frustumCulled = false; // its bounds change every frame
    return pts;
  };

  /**
   * A scorch's smoke puffs: soft grey discs, normally blended so they darken like smoke, each with
   * its own alpha (an RGBA colour). One shared material, a small geometry per pet made on its first
   * scorch.
   */
  const makeSmoke = () => {
    smokeMat ??= new THREE.PointsMaterial({
      size: SMOKE_SIZE,
      map: smokeTexture(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    const geo = new THREE.BufferGeometry();
    for (const [name, n] of [
      ['position', 3],
      ['color', 4],
    ])
      geo.setAttribute(name, new THREE.BufferAttribute(new Float32Array(SMOKES * n), n).setUsage(THREE.DynamicDrawUsage));
    const pts = new THREE.Points(geo, smokeMat);
    pts.name = 'petSmoke';
    pts.renderOrder = 2; // after the slime's see-through shell (1), which would veil it from above
    pts.visible = false;
    pts.frustumCulled = false;
    return pts;
  };

  /** Writes the burst at s (0..1) in the pet's own space, anchored to the ground while it jumps. */
  function burst(pts, s, h, hop, calm) {
    const pos = pts.geometry.attributes.position;
    const col = pts.geometry.attributes.color;
    const P = pos.array;
    const C = col.array;
    const grow = 1 - (1 - s) ** 3;
    const fade = 1 - s * s;
    for (let i = 0; i < SPARKS; i++) {
      const sp = SPARK[i];
      const k = i * 3;
      const r = sp.reach * h * grow;
      P[k] = Math.sin(sp.a) * r;
      P[k + 1] = h * (0.55 + sp.rise * grow) - 0.5 * h * s * s;
      P[k + 2] = Math.cos(sp.a) * r;
      const b = Math.min(1, fade * (calm ? 0.8 : 0.6 + 0.4 * Math.sin(s * 22 + sp.ph))); // twinkle (none when calm), clamped
      C[k] = sp.c[0] * b;
      C[k + 1] = sp.c[1] * b;
      C[k + 2] = sp.c[2] * b;
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    pts.position.y = -hop;
  }

  /** A sprite material like the sparkle's (the same shader program, so nothing new to compile). */
  const spriteMat = (map, size = SPARK_SIZE) =>
    new THREE.PointsMaterial({
      size,
      map,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });

  /**
   * Petting's hearts, a huff's puff, a bristle's sparks, a proud settle's twinkle or a cheer's stars
   * (`kind`, pet.anim's), at e (0..1) in the
   * pet's sparkle points; false for a kind with none (scorch has its own smoke points; shiver,
   * startle). Only the sparks may flicker, and not with `calm` (reduced motion: no flashing);
   * everything else fades in and out once. `calm` also means fewer hearts and less sway.
   */
  function float(pet, e, kind, calm) {
    const huff = kind === 'huff';
    const spark = kind === 'bristle';
    const proud = kind === 'proud';
    const cheer = kind === 'cheer';
    if (!huff && !spark && !proud && !cheer && kind !== 'pet') return false;
    const pts = pet.sparkle;
    pts.material = proud || cheer
      ? sparkMat
      : spark
        ? (zapMat ??= spriteMat(starTexture(), ZAP_SIZE))
        : huff
          ? (puffMat ??= spriteMat(puffTexture()))
          : (heartMat ??= spriteMat(heartTexture()));
    const h = pet.creature.height;
    const pos = pts.geometry.attributes.position;
    const col = pts.geometry.attributes.color;
    const P = pos.array;
    const C = col.array;
    const n = huff ? PUFFS : spark ? SPARKLES : proud ? TWINKLES : cheer ? (calm ? 3 : CHEERS) : calm ? 3 : HEARTS;
    for (let i = 0; i < SPARKS; i++) {
      const k = i * 3;
      P[k] = P[k + 1] = P[k + 2] = C[k] = C[k + 1] = C[k + 2] = 0; // unused: black adds nothing
      if (i >= n) continue;
      const sp = SPARK[i];
      let b;
      if (proud) {
        // one soft twinkle each, in turn, about its head as it puffs up: a single swell and fade,
        // never a flicker (dimmer when calm)
        const s = clamp01((e - 0.3 - 0.12 * i) / 0.45);
        const a = (i - 1) * 0.9;
        P[k] = Math.sin(a) * 0.45 * h;
        P[k + 1] = h * (1.05 + 0.12 * (i % 2) + 0.08 * s);
        P[k + 2] = Math.cos(a) * 0.3 * h;
        b = Math.sin(Math.PI * s) * (calm ? 0.6 : 1);
        const c = i === 1 ? WHITE : GOLD;
        C[k] = c[0] * b;
        C[k + 1] = c[1] * b;
        C[k + 2] = c[2] * b;
      } else if (cheer) {
        // gold stars popping up and out above its head in turn, with its hops: each a single swell
        // and fade, never a flicker (dimmer when calm)
        const s = clamp01((e - 0.12 - 0.07 * i) / 0.5);
        const r = (0.3 + 0.35 * s) * h;
        P[k] = Math.sin(sp.a) * r;
        P[k + 1] = h * (1 + 0.15 * sp.rise + 0.45 * s);
        P[k + 2] = Math.cos(sp.a) * r * 0.7;
        b = Math.sin(Math.PI * s) * (calm ? 0.55 : 1);
        const c = i % 3 === 0 ? WHITE : GOLD;
        C[k] = c[0] * b;
        C[k + 1] = c[1] * b;
        C[k + 2] = c[2] * b;
      } else if (spark) {
        // sparks crackling about its body in three waves, so some are always lit; they flicker
        // unless calm
        const s = clamp01((e - (i % 3) * 0.22 - 0.02 * i) / 0.42);
        const r = (0.65 + 0.3 * sp.reach * s) * h; // outside its body, where they show
        P[k] = Math.sin(sp.a) * r;
        P[k + 1] = h * (0.3 + 0.75 * sp.rise + 0.2 * s);
        P[k + 2] = Math.cos(sp.a) * r;
        b = Math.sin(Math.PI * s) ** 0.5;
        if (!calm) b *= Math.sin(s * 37 + sp.ph) > -0.3 ? 1 : 0.3;
        const c = i % 3 === 1 ? WHITE : ZAP;
        C[k] = c[0] * b;
        C[k + 1] = c[1] * b;
        C[k + 2] = c[2] * b;
      } else if (huff) {
        // a short puff out of each side of its face, spreading and fading
        const s = clamp01((e - 0.35) / 0.5);
        P[k] = (i % 2 ? 1 : -1) * (0.35 + 0.5 * s * sp.reach) * h;
        P[k + 1] = h * (0.6 + 0.15 * s * sp.rise);
        P[k + 2] = h * (0.25 + 0.1 * (i % 3));
        b = GREY * Math.sin(Math.PI * s);
        C[k] = C[k + 1] = C[k + 2] = b;
      } else {
        // hearts rising from its head one after another, swaying a little
        const s = clamp01((e - i * 0.08) / 0.6);
        const sway = (calm ? 0.05 : 0.12) * h * Math.sin(s * Math.PI * 2 + sp.ph);
        P[k] = Math.sin(sp.a) * 0.35 * h + sway;
        P[k + 1] = h * (1 + 0.8 * s);
        P[k + 2] = Math.cos(sp.a) * 0.35 * h;
        b = Math.sin(Math.PI * s);
        C[k] = PINK[0] * b;
        C[k + 1] = PINK[1] * b;
        C[k + 2] = PINK[2] * b;
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    pts.position.y = 0;
    pts.visible = true;
    return true;
  }

  /**
   * A scorch's smoke at e (0..1), or (e null) none: grey puffs rising one after another from just
   * above the top of its body (pet.anim.top, measured when the scorch began, so it clears the
   * mimic's open lid) and a little in front, swelling, drifting and fading. `calm`: less drift.
   */
  function smoke(pet, e, calm) {
    if (e === null) {
      if (pet.smoke) pet.smoke.visible = false;
      return;
    }
    if (!pet.smoke) pet.group.add((pet.smoke = makeSmoke()));
    const h = pet.creature.height;
    const top = pet.anim?.top ?? h;
    const pos = pet.smoke.geometry.attributes.position;
    const col = pet.smoke.geometry.attributes.color;
    const P = pos.array;
    const C = col.array;
    for (let i = 0; i < SMOKES; i++) {
      const sp = SPARK[i];
      const s = clamp01((e - i * 0.06) / 0.6);
      const drift = (calm ? 0.06 : 0.16) * h * Math.sin(s * Math.PI * 1.5 + sp.ph);
      const k = i * 3;
      P[k] = Math.sin(sp.a) * (0.12 + 0.25 * s) * h + drift;
      P[k + 1] = top + h * (0.05 + 0.6 * s * (0.75 + 0.25 * sp.rise));
      P[k + 2] = 0.2 * h + Math.cos(sp.a) * (0.12 + 0.2 * s) * h;
      const g = SMOKE_GREY[i % 2];
      C[i * 4] = C[i * 4 + 1] = C[i * 4 + 2] = g;
      C[i * 4 + 3] = 0.95 * Math.min(1, 3 * s) * (1 - s * s); // in fast, then thins out as it rises
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    pet.smoke.visible = true;
  }

  /**
   * An element's motes (element-fx.js writeMotes) at e in the pet's sparkle points, glowing star
   * sprites: fewer when calm (reduced motion).
   */
  function motes(pet, e, m, calm) {
    const pts = pet.sparkle;
    sparkTex ??= starTexture();
    pts.material = sparkMat ??= spriteMat(sparkTex);
    const pos = pts.geometry.attributes.position;
    const col = pts.geometry.attributes.color;
    writeMotes(pos.array, col.array, SPARKS, calm ? 6 : SPARKS, e, m.pattern, m.colors, pet.creature.height, SPARK, calm);
    pos.needsUpdate = true;
    col.needsUpdate = true;
    pts.position.y = 0;
    pts.visible = true;
  }

  /** An element's puffs (element-fx.js writePuffs) at e in the pet's smoke points: dust, a haze, drops. */
  function puffs(pet, e, p, calm) {
    if (!pet.smoke) pet.group.add((pet.smoke = makeSmoke()));
    const pos = pet.smoke.geometry.attributes.position;
    const col = pet.smoke.geometry.attributes.color;
    const h = pet.creature.height;
    writePuffs(pos.array, col.array, SMOKES, e, p.pattern, p.color, h, pet.anim?.top ?? h, SPARK, calm);
    pos.needsUpdate = true;
    col.needsUpdate = true;
    pet.smoke.visible = true;
  }

  /**
   * A reaction's look at e for its element (element-fx.js ELEMENT_FX): smoke or puffs, sparks or
   * motes, and a tint that comes and goes.
   */
  function elementFx(pet, e, fx, calm) {
    const lit = fx.sparks ? float(pet, e, 'bristle', calm) : fx.motes ? (motes(pet, e, fx.motes, calm), true) : false;
    if (!lit) pet.sparkle.visible = false;
    if (fx.smoke) smoke(pet, e, calm);
    else if (fx.puffs) puffs(pet, e, fx.puffs, calm);
    if (fx.tint) frost(pet, smooth(clamp01(e / 0.12)) * (1 - smooth(clamp01((e - 0.35) / 0.65))), fx.tint);
  }

  /**
   * An element's tint, `amount` 0..1, on every lit material of the pet's creature: the colour through
   * a filter (`tint` [filter, glow], linear RGB; frost's cool ICE by default, never washed toward
   * white, so its own colour still shows) and a faint glow (uniforms only: no shader recompiles).
   * 0 puts the colours back.
   */
  function frost(pet, amount, tint = FROST_TINT) {
    let t = pet.tint;
    if (!t || t.creature !== pet.creature) {
      if (!(amount > 0)) return;
      const mats = new Set();
      pet.creature.root.traverse((o) => {
        for (const m of [o.material].flat()) if (m?.color && m.emissive) mats.add(m);
      });
      t = pet.tint = { creature: pet.creature, mats: [...mats] };
      t.color = t.mats.map((m) => m.color.clone());
      t.glow = t.mats.map((m) => m.emissive.clone());
    }
    const a = clamp01(amount);
    const [f, g] = tint;
    iceNow.setRGB(1 - a * (1 - f[0]), 1 - a * (1 - f[1]), 1 - a * (1 - f[2]));
    glowNow.setRGB(g[0], g[1], g[2]);
    t.mats.forEach((m, i) => {
      m.color.copy(t.color[i]).multiply(iceNow);
      m.emissive.copy(t.glow[i]).lerp(glowNow, a);
    });
    if (a === 0) pet.tint = null;
  }
  /** Ends a resting pet's animation early (it rolled, left, was hit): its tint goes too. */
  function dropAnim(pet) {
    pet.anim = null;
    if (pet.tint) frost(pet, 0);
    smoke(pet, null);
  }

  function removePet(pet) {
    pets.delete(pet.userId);
    pending.delete(pet.userId);
    for (const k of pet.rolls.keys()) keyOwner.delete(k);
    pet.rolls.clear();
    scene.remove(pet.group);
    try {
      pet.creature.dispose();
    } catch {
      /* already torn down */
    }
    pet.shadow.material.dispose();
    pet.sparkle.geometry.dispose();
    pet.smoke?.geometry.dispose();
    dropSplat(pet);
  }

  /** The pet's splat (made when it first needs one), in the pet's own colour. */
  function ensureSplat(pet) {
    if (!pet.splat) {
      pet.splat = createSplat(pet.kind, pet.color);
      pet.splat.root.scale.setScalar(size);
      pet.group.add(pet.splat.root);
    }
    return pet.splat;
  }
  function dropSplat(pet) {
    if (!pet.splat) return;
    pet.group.remove(pet.splat.root);
    pet.splat.dispose();
    pet.splat = null;
  }

  /**
   * The pet size in die units: petScale (on-screen size, like diceScale for dice) over diceScale,
   * so the two settings are independent. 1 with both unset.
   */
  function sizeFactor() {
    const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 1);
    const get = (k) => {
      try {
        return typeof getSetting === 'function' ? getSetting(k) : undefined;
      } catch {
        return undefined;
      }
    };
    return num(get('petScale')) / num(get('diceScale'));
  }
  let size = sizeFactor(); // the factor the pets were last sized to
  const kindFootprint = (kind) => (KIND_FOOTPRINT[kind] != null ? KIND_FOOTPRINT[kind] * size : undefined);

  /**
   * Wraps a creature's root in a sizer group (once) and sizes it by k: its height and footprint,
   * which the layer measures everything by, follow. The creature still animates its own root.
   */
  function sizeCreature(creature, k) {
    if (!creature._base) {
      const sizer = new THREE.Group();
      sizer.add(creature.root);
      creature._base = { height: creature.height, footprint: creature.footprint };
      creature.root = sizer;
    }
    creature.root.scale.setScalar(k);
    creature.height = creature._base.height * k;
    if (creature._base.footprint != null) creature.footprint = creature._base.footprint * k;
  }

  /** Re-sizes every pet when petScale or diceScale changed; true if anything changed. */
  function resize() {
    const k = sizeFactor();
    if (Math.abs(k - size) < 1e-6) return false;
    size = k;
    for (const pet of pets.values()) {
      sizeCreature(pet.creature, k);
      pet.shadow.scale.setScalar(pet.creature.height * 0.7);
      pet.splat?.root.scale.setScalar(k);
    }
    return true;
  }

  /** Puts a new creature in the pet (the first, or a new kind or colour); the old one is freed. */
  function setCreature(pet, creature, spec) {
    sizeCreature(creature, size);
    if (pet.creature) {
      pet.group.remove(pet.creature.root);
      try {
        pet.creature.dispose();
      } catch {
        /* already torn down */
      }
    }
    pet.creature = creature;
    pet.kind = spec.kind;
    pet.color = spec.color;
    pet.group.add(creature.root);
    pet.group.children.unshift(pet.group.children.pop()); // the creature stays the first child
    pet.shadow.scale.setScalar(creature.height * 0.7);
    if (pet.splat) {
      dropSplat(pet); // a new kind or colour: the puddle is made again in it
      ensureSplat(pet);
    }
  }

  function place(pet, edge, area) {
    const { out, base, inward } = edgeSpot(edge, area, pet.creature.height);
    pet.out = out;
    pet.base = base;
    pet.inward = inward;
  }

  const wake = () => {
    try {
      deps.wake?.();
    } catch {
      /* a stopped engine */
    }
  };
  /** Whether pets are allowed and shown. */
  const shown = () => {
    try {
      return getSetting('petsAllowed') !== false && getSetting('showPets') !== false;
    } catch {
      return true;
    }
  };
  /** Whether resting is on: petStay is not 0 (leave after the roll), and pets allowed and shown. */
  const stays = () => {
    try {
      return getSetting('petStay') !== 0 && shown();
    } catch {
      return true;
    }
  };
  /** petStay in seconds: 0 leaves after the roll, -1 never leaves. */
  const stayFor = () => {
    try {
      const v = getSetting('petStay');
      return typeof v === 'number' ? v : 60;
    } catch {
      return 60;
    }
  };
  /** Aims the single idle timer at `at` (Infinity: none); it only wakes the loop. */
  function arm(at) {
    if (at === timerAt) return;
    if (timer !== null) clearTimer(timer);
    timer = null;
    timerAt = at;
    if (at === Infinity || disposed) return;
    timer = setTimer(
      () => {
        if (disposed) return;
        timer = null;
        timerAt = Infinity;
        wake();
      },
      Math.max(0, at - clock()),
    );
  }
  const pos = (pet) => ({ x: pet.px ?? pet.base.x, z: pet.pz ?? pet.base.z, y: pet.hop ?? 0 });
  /** Where a pet stands (or will, at the end of its hop): what the others keep their distance from. */
  const spotOf = (pet) => pet.spot ?? pet.base;
  const standing = (pet) => pet.state !== 'off' && pet.state !== 'fade';
  /** Whether dice bump into it: a standing pet that is not a splat or a puddle. */
  const solid = (pet) => standing(pet) && pet.state !== 'splat' && pet.state !== 'puddle';

  /** Starts a hop of the pet from where it is to `to` (a rest spot, or off the table). */
  function hopTo(pet, to, state, now) {
    const from = pos(pet);
    pet.hopFrom = from;
    pet.hopTo = to;
    pet.hopAt = now;
    pet.state = state;
    if (state === 'hop') {
      pet.spot = to;
      pet.yaw0 = pet.yaw;
      pet.yawTo = Math.atan2(pet.area.cx - to.x, pet.area.cz - to.z); // faces the middle of the table
    }
    wake();
  }
  /**
   * Foundry's UI on the stage (I-4: the dice canvas draws over it), in die units from the stage
   * centre: measured now, so a players list opened since counts. Missing or hidden parts are left out.
   */
  /** The page-to-stage mapping: px per die unit and the stage centre in page px; null with no stage rect. */
  function pageMap() {
    const r = stage?.rect;
    if (!r || !(stage.halfWidth > 0) || !(r.width > 0)) return null;
    return { r, px: r.width / 2 / stage.halfWidth, ox: r.left + r.width / 2, oz: r.top + r.height / 2 };
  }
  function uiRects() {
    const out = [];
    const map = pageMap();
    if (!map) return out;
    const { px, ox, oz } = map;
    const byId = (id) => doc?.getElementById?.(id);
    const els = [...UI_IDS, ...(byId('scene-controls') ? [] : UI_BOXES)].map(byId);
    for (const id of UI_LISTS) els.push(...(byId(id)?.children ?? []));
    for (const el of els) {
      try {
        const b = el?.getBoundingClientRect?.();
        if (!(b?.width > 0 && b.height > 0)) continue;
        out.push({
          x0: (b.left - ox) / px,
          x1: (b.left + b.width - ox) / px,
          z0: (b.top - oz) / px,
          z1: (b.top + b.height - oz) / px,
        });
      } catch {
        /* unreadable: ignored */
      }
    }
    return out;
  }
  /**
   * A free rest spot in `area` for user `userId`'s pet of `height`: spaced from the other pets
   * (but not `skip`, a pet about to be sent off), off Foundry's UI, and where `clear` holds
   * (restSpot's).
   */
  function spotFor(userId, area, height, skip, clear) {
    const taken = [];
    for (const o of pets.values())
      if (o.userId !== userId && o !== skip && standing(o)) taken.push(spotOf(o));
    return restSpot(area, height, taken, rand, uiRects(), clear);
  }

  // ---- the dice tray's rim (petTray 'rim') ----
  /** The rim pets sit on ({cx, cz, halfWidth, halfDepth}: the strip along the tray's top edge), or null. */
  const perch = () => {
    try {
      return deps.perch?.() ?? null;
    } catch {
      return null;
    }
  };
  /**
   * `userId`'s pet's place on the rim, or null with no rim: one of MAX_PETS places along it, by user
   * id among the pets on screen.
   */
  /** Pets sit on the tray's rim (petTray 'rim', the default), but the tray has slid away. */
  const rimAway = () => {
    try {
      const mode = getSetting('petTray') ?? 'rim';
      return mode === 'rim' && doc?.getElementById?.(TRAY_ID)?.classList.contains('is-hidden') === true;
    } catch {
      return false;
    }
  };
  /** The tray slid in or out: slid away, the pets resting on its rim hop off with it (begin brings them back). */
  function onTray() {
    if (disposed || !rimAway()) return;
    const now = clock();
    for (const pet of pets.values()) if (['rest', 'hop', 'move'].includes(pet.state)) sendOff(pet, now);
    wake();
  }
  doc?.addEventListener?.(TRAY_EVENT, onTray);

  function perchSpot(userId) {
    const p = perch();
    if (!p) return null;
    const ids = [...new Set([...pets.keys(), userId])].sort();
    // MAX_PETS fixed places along it, so a pet stays put as others come and go
    const i = ids.indexOf(userId) % MAX_PETS;
    return { x: p.cx + ((2 * (i + 1)) / (MAX_PETS + 1) - 1) * p.halfWidth, z: p.cz };
  }

  const activeRolls = () => {
    try {
      return deps.activeRolls?.() ?? 0;
    } catch {
      return 0;
    }
  };
  /** True while the throw overlay holds dice (H-8: pets hold still, so a player may aim at one). */
  const holding = () => {
    try {
      return deps.holding?.() === true;
    } catch {
      return false;
    }
  };

  // ---- where pets rest on this screen (petRestSpot) ----
  /** The petRestSpot choice ('dice' when unreadable): read when a pet comes to rest, and by update. */
  const choice = () => {
    try {
      return getSetting('petRestSpot') ?? 'dice';
    } catch {
      return 'dice';
    }
  };
  // A pet just dropped: where it was put, until the saved settings say so too (saving is async).
  let dropped = null;
  /** petRestAt, the spot of 'placed' (a just-dropped pet's spot first), or null when unusable. */
  const placedAt = () => {
    let at = null;
    try {
      at = getSetting('petRestAt');
    } catch {
      /* unreadable */
    }
    if (dropped && validAt(at) && at.x === dropped.x && at.z === dropped.z) dropped = null; // saved
    return dropped ?? (validAt(at) ? at : null);
  };
  /** The choice in force: a just-dropped pet's 'placed', else petRestSpot. */
  const current = () => (dropped ? 'placed' : choice());
  /** A choice that rests at fixed slots (a corner, an edge, or a placed spot), not the dice ring. */
  const fixed = (c) => atEdge(c) || (c === 'placed' && !!placedAt());
  /** The choice and, for 'placed', its spot: what a resting pet notes it rests by. */
  const restKey = (c) => {
    const at = c === 'placed' ? placedAt() : null;
    return at ? `placed ${at.x} ${at.z}` : c;
  };
  /** Whether a resting pet or puddle sits by another choice than `c` (cornerSpot notes its own). */
  const stale = (pet, c) =>
    pet.restChoice !== undefined &&
    pet.restChoice !== restKey(c) &&
    ['hop', 'rest', 'move', 'splat', 'puddle'].includes(pet.state);
  /** Saves a placed spot (petRestSpot 'placed' and petRestAt `at`); the layer uses it at once. */
  function savePlaced(at) {
    dropped = at;
    if (!saveSetting) return; // used on this screen until it reloads
    try {
      Promise.resolve(saveSetting('petRestAt', at))
        .then(() => saveSetting('petRestSpot', 'placed'))
        .catch((err) => console.warn('Dicer | pet', err));
    } catch (err) {
      console.warn('Dicer | pet', err);
    }
  }
  /**
   * The pet's spot at this screen's corner or edge choice, or null for 'dice' (the ring of its
   * owner's area) or with no stage yet. It keeps its slot while no other pet holds it (so it goes
   * back to the same place after its owner's roll); otherwise it takes the lowest free one: slots
   * go in the order pets arrive. Sets pet.slot (null for 'dice').
   */
  function cornerSpot(pet) {
    let c = current();
    const h = pet.creature.height;
    if (stage && atEdge(c) && saveSetting) {
      // a corner or edge choice of 0.2: from now on the placed spot at its first slot
      const at = chosenSpot(c, 0, stage, h, uiRects());
      if (at) {
        savePlaced(toPlaced(at, stage));
        c = 'placed';
      }
    }
    pet.restChoice = restKey(c); // the choice it now rests by
    if (!stage || !fixed(c)) {
      pet.slot = null;
      return null;
    }
    const held = new Set();
    for (const o of pets.values()) if (o !== pet && o.slot != null && standing(o)) held.add(o.slot);
    let slot = pet.slot != null && !held.has(pet.slot) ? pet.slot : null;
    for (let k = 0; slot === null && k < MAX_PETS; k++) if (!held.has(k)) slot = k;
    pet.slot = slot ?? 0;
    return c === 'placed' ? placedSpot(placedAt(), pet.slot, stage, h) : chosenSpot(c, pet.slot, stage, h, uiRects());
  }
  /** A move of a standing pet from `at` to `to` over `ms` (stepMove), facing `yawTo` at the end. */
  function goTo(pet, at, to, ms, yawTo, now) {
    pet.goFrom = at;
    pet.goTo = to;
    pet.goAt = now;
    pet.goMs = ms;
    pet.spot = to; // obstaclesFor reports the destination (a throw may start mid-move)
    pet.state = 'move';
    pet.yaw0 = pet.yaw;
    pet.yawGo = Math.atan2(to.x - at.x, to.z - at.z); // faces where it goes
    pet.yawTo = yawTo;
    wake();
  }
  /** A fresh spot for a puddle: its corner slot, or a ring spot in its owner's area. */
  const freeSpot = (pet) => {
    const at = cornerSpot(pet);
    pet.cornered = !!at; // at its corner: its owner's next roll is watched from the roll area
    return at ?? spotFor(pet.userId, pet.area, pet.creature.height);
  };
  const fitted = (area) => (stage ? fitArea(area, stage) : area);
  const sameArea = (a, b) => ['cx', 'cz', 'halfWidth', 'halfDepth'].every((k) => a[k] === b[k]);
  /**
   * Where `userId`'s pet will rest if it has no resting spot yet: the one obstaclesFor chose (kept
   * while its area is the same and it still clears the others), or a new one. `keep` leaves it
   * pending (obstaclesFor); begin takes it.
   */
  function newSpot(userId, area, height, skip, keep) {
    const a = fitted(area);
    const p = pending.get(userId);
    let spot = null;
    if (p && sameArea(p.area, a)) {
      const clear = [...pets.values()].every(
        (o) =>
          o.userId === userId ||
          o === skip ||
          !standing(o) ||
          Math.hypot(spotOf(o).x - p.spot.x, spotOf(o).z - p.spot.z) >= SPACING * height - 1e-9,
      );
      if (clear) spot = p.spot;
    }
    spot ??= spotFor(userId, a, height, skip);
    if (keep) pending.set(userId, { area: a, spot });
    else pending.delete(userId);
    return spot;
  }
  /**
   * The spot a pet watches its owner's roll from, when it already has a resting one: where it rests
   * (or will, at the end of its hop), a puddle's spot, or the spot its roll is already using.
   */
  function restingSpot(pet) {
    if (!pet) return null;
    if (pet.state === 'hop' || pet.state === 'rest' || pet.state === 'move') return pet.spot ?? { x: pet.px, z: pet.pz };
    if (pet.state === 'splat' || pet.state === 'puddle')
      return pet.moveTo ?? pet.spot ?? { x: pet.px ?? pet.base.x, z: pet.pz ?? pet.base.z };
    if (pet.state === 'reform' && pet.atRest) return { x: pet.px ?? pet.base.x, z: pet.pz ?? pet.base.z };
    if (pet.state === 'routine' && pet.atRest) return pet.base;
    return null;
  }
  /**
   * Where a pet watches its owner's roll from: where it rests, a placed spot included (the player
   * put it there), but not a 0.2 corner nothing could save as one (it hops out to the roll area);
   * a hand replay's pet from the thrower's spot it was put on (alignFor).
   */
  const watchSpot = (pet) =>
    pet?.cornered && !pet.aligned && !String(pet.restChoice).startsWith('placed') ? null : restingSpot(pet);
  const restOf = (pet, now) => {
    pet.aligned = false;
    pet.huff = null; // a new spot: no going back to the one it huffed away from
    if (pet.state === 'routine') pet.idleAt = now; // idle since its routine ended
    if (stage) pet.area = fitArea(pet.area, stage);
    // its routine ended after the tray slid away: it leaves with it, rather than rest on the floor
    if (rimAway()) return sendOff(pet, now);
    const onRim = perchSpot(pet.userId);
    if (onRim) {
      // on the tray's rim: there it rests (a little hop in place when it watched from there)
      pet.cornered = false;
      pet.atRest = true;
      hopTo(pet, onRim, 'hop', now);
      if (pet.base && Math.hypot(onRim.x - pet.base.x, onRim.z - pet.base.z) < MOVED) pet.yawTo = pet.yaw;
      return;
    }
    const corner = cornerSpot(pet);
    pet.cornered = !!corner;
    if (!corner && pet.state === 'routine' && pet.atRest && inRestRing(pet.area, pet.creature.height, pet.base)) {
      // it watched from its resting spot: it stays, with a little hop in place
      hopTo(pet, { x: pet.base.x, z: pet.base.z }, 'hop', now);
      pet.yawTo = pet.yaw; // no turning round
      return;
    }
    pet.atRest = false;
    hopTo(pet, corner ?? spotFor(pet.userId, pet.area, pet.creature.height), 'hop', now);
  };
  const sendOff = (pet, now) => {
    pet.aligned = false;
    pet.slot = null; // its corner slot is free for the next pet to arrive
    pet.cornered = false;
    if (pet.state === 'off' || pet.state === 'fade') return;
    if (pet.state === 'puddle') {
      pet.state = 'fade'; // a puddle does not hop: it fades
      pet.fadeAt = now;
      wake();
      return;
    }
    hopTo(pet, offPoint(pet.area, pos(pet), pet.creature.height), 'off', now);
  };

  /**
   * Whether a pet of `userId` may stand: it has a place already, or there is a free place, or a
   * resting pet (never one mid-routine, nor one of `spare`, a Set of user ids) can give its place
   * up; the one idle longest goes (victim).
   */
  function slotFor(userId, spare) {
    const mine = pets.get(userId);
    let count = 0;
    let victim = null;
    for (const p of pets.values()) {
      if (p === mine || !standing(p)) continue;
      count++;
      if (
        !spare?.has(p.userId) &&
        (p.state === 'hop' || p.state === 'rest' || p.state === 'move' || p.state === 'puddle') &&
        (!victim || p.idleAt < victim.idleAt)
      )
        victim = p;
    }
    return count < MAX_PETS ? { ok: true } : { ok: !!victim, victim };
  }

  /** A new pet of `spec` in the scene, not yet placed (its creature made from CREATURES). */
  function makePet(spec) {
    const group = new THREE.Group();
    group.userData.dicerPet = { phase: 'enter' };
    const shadow = makeShadow();
    const sparkle = makeSparkle();
    group.add(shadow, sparkle);
    const pet = { userId: spec.userId, group, shadow, sparkle, creature: null, rolls: new Map(), state: 'routine' };
    setCreature(pet, CREATURES[spec.kind](spec.color), spec);
    scene.add(group);
    pets.set(spec.userId, pet);
    return pet;
  }

  /**
   * A roll with a pet begins (PetHook.begin). `hand` (H-5): a hand throw, with no throw pose; its
   * edge is the hand edge. A pet alignFor put at the thrower's spot watches from there.
   */
  function begin(key, { spec, edge, area, centre, hand }) {
    if (disposed) return;
    keyRoller.set(key, { userId: spec.userId, ghost: !!spec.ghost }); // moods: even with no room for its pet
    const make = CREATURES[spec.kind];
    let pet = pets.get(spec.userId);
    const fresh = !pet;
    if (!make && fresh) return;
    const down = !fresh && DOWN.has(pet.state); // a splat or puddle: reforms before the routine
    if (fresh || pet.state === 'off' || pet.state === 'fade') {
      const slot = slotFor(spec.userId);
      if (!slot.ok) return;
      if (slot.victim) sendOff(slot.victim, clock());
    }
    if (fresh) pet = makePet(spec);
    else if (make && (pet.kind !== spec.kind || pet.color !== spec.color)) {
      setCreature(pet, make(spec.color), spec); // the editor's Throw shows the new pick at once
    }
    const now = clock();
    // resting is on: the pet watches from where it rests (a first appearance hops straight to a new
    // rest spot, the one obstaclesFor sent the physics); otherwise it takes the edge spot.
    // A hand replay's pet that alignFor placed at the thrower's spot watches from it (petStay 0 too).
    // One resting at a placed spot watches from there; one at a 0.2 corner nothing could save as a
    // placed spot hops out to the roll area to watch, and back to its slot afterwards.
    const rest = perchSpot(spec.userId) ?? (stays()
      ? (watchSpot(pet) ?? newSpot(spec.userId, area, pet.creature.height, null, false))
      : hand && pet.aligned
        ? restingSpot(pet)
        : null);
    if (!rest) pending.delete(spec.userId);
    pet.cornered = false;
    if (down) {
      pet.group.scale.setScalar(1);
      pet.wobble = null;
      if (pet.state === 'splat')
        pet.reformNext = true; // the burst finishes, then it reforms
      else if (pet.state !== 'reform') {
        pet.state = 'reform';
        pet.reformAt = now;
      }
    } else pet.state = 'routine'; // a resting or leaving pet starts its routine from where it stands
    pet.gone = false;
    pet.leaveAt = null; // its idle time starts again when this roll ends
    pet.spot = null;
    pet.area = { ...area }; // the owner's resting area: that of their most recent roll
    pet.rolls.set(key, { ghost: !!spec.ghost, summary: null, consumed: false });
    keyOwner.set(key, spec.userId);
    // The newest roll (pet.current) owns the throw, the place and the leave; each roll keeps its
    // own ghost flag and summary for the merged reaction.
    pet.current = key;
    pet.centre = centre;
    const was = fresh ? null : { x: pet.px, z: pet.pz, y: pet.hop };
    if (rest) {
      pet.base = { x: rest.x, z: rest.z };
      pet.atRest = true;
      pet.spot = pet.base;
      const off = offPoint(area, rest, pet.creature.height);
      const len = Math.hypot(off.x - rest.x, off.z - rest.z) || 1;
      pet.out = [(off.x - rest.x) / len, (off.z - rest.z) / len];
      pet.inward = Math.atan2(-pet.out[0], -pet.out[1]);
      if (fresh) pet.yaw = Math.atan2(centre().x - rest.x, centre().z - rest.z);
    } else {
      place(pet, edge, area);
      pet.atRest = false;
      pet.yaw = pet.inward;
    }
    pet.reaction = 'plain';
    pet.soundDone = false;
    pet.exitFrom = null;
    pet.lastNow = now;
    // A re-used pet standing at its new spot restarts from the throw, with no re-enter; one that
    // is elsewhere (mid-exit, another edge or area) hops there from where it is.
    const moved =
      !!was && (Math.hypot(was.x - pet.base.x, was.z - pet.base.z) > MOVED || was.y > MOVED);
    // a first appearance at a rest spot hops in from just outside the area
    const outside = rest && fresh ? { ...offPoint(area, rest, pet.creature.height), y: 0 } : null;
    pet.from = moved ? was : outside;
    pet.track = { beganAt: fresh || moved ? now : now - ENTER_MS, hand: !!hand };
  }

  const petOf = (key) => {
    const u = keyOwner.get(key);
    return u === undefined ? null : pets.get(u) || null;
  };

  /**
   * Starts the reaction once every live, not yet reacted-to roll of the pet has landed, to their
   * merged summaries; those rolls are then consumed, so a roll is reacted to once (a later roll
   * of the same roller never re-cheers an earlier 20). A consumed roll keeps the pet until its end.
   */
  function settle(pet) {
    if (pet.track.landedAt != null) return;
    const summaries = [];
    for (const r of pet.rolls.values()) {
      if (r.consumed) continue;
      if (!r.summary) return;
      summaries.push(r.summary);
    }
    for (const r of pet.rolls.values()) r.consumed = true;
    pet.reaction = merge(summaries);
    pet.soundDone = false;
    pet.track.landedAt = clock();
  }

  /**
   * A roll landed: its pet's reaction (by `key`), the other resting pets' cheer for a natural 20,
   * and every resting pet's reaction to its elemental dice (a cheering pet only cheers).
   */
  function landed(key, dice) {
    // a roll with no pet of its own: nobody's roll on screen, so every resting pet may cheer
    if (key == null) return elemental(dice, cheer(dice, { ghost: false }, null));
    const roller = keyRoller.get(key); // gone once the roll has landed: it is cheered for once
    noteMood(key, dice);
    const pet = petOf(key);
    const roll = pet?.rolls.get(key);
    if (!roll || roll.summary) {
      // no pet for this roll (no room, or an unknown kind): the others still cheer and react to its
      // dice, once (a second landed of the same key finds its roller gone)
      if (roller) elemental(dice, cheer(dice, roller, null));
      return;
    }
    roll.summary = summarize(dice, roll.ghost); // a ghost roll only ever says 'plain'
    const wasWatching = watching(pet); // before settle: its landing turns the watch into the reaction
    settle(pet);
    // On the tray's rim no die reaches its own pet: one with nothing to cheer or mourn reacts to
    // the roll's element instead of its plain nod. Watching from its rim spot, it does at once (its
    // routine ends there: it rests where it sits); otherwise once back at rest (toRest), and a pet
    // that leaves after its roll voices it at its reaction (show).
    if (perch() && pet.track.landedAt != null && pet.reaction === 'plain' && !roll.ghost) {
      const at = { state: 'rest', px: pet.base?.x, pz: pet.base?.z };
      const element = elementReactions(dice, [at], { dieWidth: Infinity })[0]?.element ?? null;
      const now = clock();
      if (element && stays() && pet.atRest && wasWatching && getSetting('petElemental') !== false) {
        pet.state = 'rest';
        pet.spot = { x: pet.base.x, z: pet.base.z };
        pet.px = pet.base.x;
        pet.pz = pet.base.z;
        pet.hop = 0;
        pet.idleAt = now;
        react(pet, element, now);
        wake();
      } else pet.elementAfter = element;
    }
    elemental(dice, roller ? cheer(dice, roller, pet) : null);
  }

  /**
   * Someone's natural 20 (a visible roll whose visible d20s say 'crit'; never a ghost roll or a
   * ghost die): every resting pet but the roller's own turns toward the mean of the roll's visible
   * dice and cheers, starting as the roller's pet (`own`, if any) starts its crit reaction. One
   * chirp for them all, unless the roller's pet chirps for its crit already. petCheer, and pets
   * allowed and shown. Returns the cheering pets (a Set), or null.
   */
  function cheer(dice, roller, own) {
    let on = false;
    try {
      on = !disposed && shown() && getSetting('petCheer') !== false;
    } catch {
      on = false;
    }
    if (!on || roller.ghost || summarize(dice, false) !== 'crit') return null;
    let x = 0;
    let z = 0;
    let n = 0;
    for (const d of dice)
      if (d && !d.ghost && Number.isFinite(d.x) && Number.isFinite(d.z)) {
        x += d.x;
        z += d.z;
        n++;
      }
    if (!n) return null;
    x /= n;
    z /= n;
    const now = clock();
    const t = own?.track;
    const at = t?.landedAt != null ? Math.max(t.landedAt, t.beganAt + ENTER_MS + (t.hand ? 0 : THROW_MS)) : now;
    const cheering = new Set();
    for (const pet of pets.values()) {
      if (pet.userId === roller.userId || !resting(pet) || BUSY.has(pet.anim?.kind)) continue;
      dropAnim(pet);
      const px = pet.px ?? pet.base.x;
      const pz = pet.pz ?? pet.base.z;
      pet.anim = { kind: 'cheer', at, calm: calmNow(), yaw: pet.yaw ?? 0, to: Math.atan2(x - px, z - pz) };
      pet.idleAt = now;
      cheering.add(pet);
    }
    if (!cheering.size) return null;
    if (own?.reaction !== 'crit' || t?.landedAt == null) [...cheering][0].anim.chirp = true;
    wake();
    return cheering;
  }

  /**
   * A pet roll landed: its active d20 values (every visible d20; advantage gives two) go to its
   * roller's mood history, whether their pet is shown or not. A ghost roll, or a ghost die, never
   * counts: its value is not this viewer's to see. Once per roll.
   */
  function noteMood(key, dice) {
    const r = keyRoller.get(key);
    keyRoller.delete(key);
    if (!r || r.ghost) return;
    const values = [];
    for (const d of dice || []) if (d && !d.ghost && d.type === 'd20' && Number.isFinite(d.value)) values.push(d.value);
    if (values.length) moods.record(r.userId, values);
  }
  /** The mood pose a resting pet holds (petMoods on): 'proud', 'sulk', or null for neutral. */
  function moodPose(pet) {
    try {
      if (getSetting('petMoods') === false) return null;
    } catch {
      return null;
    }
    const m = moods.moodOf(pet.userId);
    return MOODS.has(m) ? m : null;
  }

  /**
   * A landing's elemental dice: each resting pet with one within reach reacts to the nearest
   * (reactions.js; a ghost die never counts). petElemental, and pets allowed and shown. The loop
   * wakes for the reaction and goes idle again when it is over. A pet of `skip` (a Set: cheering
   * for this landing) does not react.
   */
  function elemental(dice, skip) {
    let on = false;
    try {
      on = !disposed && shown() && getSetting('petElemental') !== false;
    } catch {
      on = false;
    }
    if (!on) return;
    const now = clock();
    let any = false;
    const near = skip ? [...pets.values()].filter((p) => !skip.has(p)) : [...pets.values()];
    // on the tray's rim the dice never land beside a pet: it reacts to the nearest one anywhere
    const dieWidth = perch() ? Infinity : DIE_WIDTH;
    for (const { pet, element } of elementReactions(dice, near, { dieWidth })) {
      react(pet, element, now);
      any = true;
    }
    if (any) wake();
  }

  /**
   * Whether `pet` watches its owner's dice fly (its routine's watch phase, standing still): a die
   * with an element that hits it then sets it off too (hit), between its throw and its reaction.
   */
  function watching(pet) {
    return pet.state === 'routine' && !pet.gone && !pet.wobble && phaseAt(pet.track, clock()).phase === 'watch';
  }
  /** `pet` reacts to `element` (reactions.js reactionOf): the anim replaces whatever it was doing. */
  function react(pet, element, now) {
    dropAnim(pet); // a shiver's tint or a scorch's smoke cut short by the next reaction
    const kind = reactionOf(element);
    pet.anim = { kind, at: now, calm: calmNow(), element };
    // smoke and puffs start from the top of its body as it stands (the mimic's open lid included)
    const fx = ELEMENT_FX[element];
    if (fx?.smoke || fx?.puffs) pet.anim.top = new THREE.Box3().setFromObject(pet.creature.root).max.y - pet.group.position.y;
    pet.idleAt = now; // a startled pet does not wander off just then
    voice(fx?.sound ?? 'petYelp');
  }

  /**
   * The element of a die that hit a resting pet, when it sets it off instead of knocking it
   * (petElemental on, pets shown, never a ghost die, never a weapon blow: those still splat), else null.
   */
  function hitElement(pet, die) {
    try {
      if (!die || die.ghost || !(resting(pet) || watching(pet)) || disposed || !shown() || getSetting('petElemental') === false)
        return null;
      // the damage type alone: a die that only looks fiery (a lava or fire inside) is no fire
      const element = elementOf(null, die.damageType) ?? null;
      return PHYSICAL.includes(element) ? null : element;
    } catch {
      return null;
    }
  }

  function leave(key, msLeft) {
    const pet = petOf(key);
    if (!pet || pet.current !== key) return;
    pet.track.leaveAt = clock();
    pet.track.leaveMs = msLeft;
  }

  function end(key) {
    // DiceBox ends a roll after taking it off its list: the last one over, a move held back while
    // it flew (a petRestSpot change, a replay's pets going home) wakes the loop now.
    if (!disposed && activeRolls() === 0 && [...pets.values()].some((p) => p.aligned || stale(p, choice())))
      wake();
    const pet = petOf(key);
    keyOwner.delete(key);
    keyRoller.delete(key);
    if (!pet) return;
    pet.rolls.delete(key);
    if (pet.rolls.size) return settle(pet); // the rolls still on screen may all have landed now
    if (pet.state !== 'routine') return; // resting or leaving: the pet outlives its roll
    if (stays() && !pet.gone) restOf(pet, clock());
    else removePet(pet);
  }

  /** Poses and places the pet for this frame: the shared end of every state's step. */
  function show(pet, now, phase, t, px, pz, hop, shadows) {
    const h = pet.creature.height;
    pet.px = px;
    pet.pz = pz;
    pet.hop = hop;
    const dt = Math.max(0, now - (pet.lastNow ?? now));
    pet.lastNow = now;
    let look = 0;
    if (phase === 'watch' || phase === 'react') {
      const c = pet.centre();
      const toDice = Math.atan2(c.x - px, c.z - pz);
      pet.yaw = wrap(pet.yaw + wrap(toDice - pet.yaw) * (1 - Math.exp(-dt / 90)));
      look = Math.max(-LOOK_MAX, Math.min(LOOK_MAX, wrap(toDice - pet.yaw)));
    } else if (phase === 'exit' && t === 1 && pet.gaze) {
      // resting, it looks at the cursor: the head at once, the body turning after it, more slowly
      const to = Math.atan2(pet.gaze.x - px, pet.gaze.z - pz);
      pet.yaw = wrap(pet.yaw + wrap(to - pet.yaw) * (1 - Math.exp(-Math.min(dt, 50) / GAZE_TURN_MS)));
      look = Math.max(-LOOK_MAX, Math.min(LOOK_MAX, wrap(to - pet.yaw)));
    }
    // A wobble: a squash on the creature and a push away from the die, out and back.
    let wt = -1;
    let push = 0;
    if (pet.wobble) {
      const e = (now - pet.wobble.at) / WOBBLE_MS;
      if (e < 1) {
        wt = clamp01(e);
        push = WOBBLE_PUSH * h * Math.sin(wt * Math.PI);
      } else pet.wobble = null; // over: nothing carries into the next frame or roll
    }
    pet.group.position.set(
      px + (wt >= 0 ? pet.wobble.dx * push : 0),
      hop,
      pz + (wt >= 0 ? pet.wobble.dz * push : 0),
    );
    pet.group.rotation.y = pet.yaw;
    pet.group.userData.dicerPet.phase = phase;
    if (!MOODS.has(phase)) pet.mood = null; // posed out of its mood: the next rest settles back in
    pet.shadow.position.y = 0.01 - hop;
    pet.shadow.visible = shadows;
    if (wt >= 0) {
      // the push direction turned into the creature's space (the group is turned by pet.yaw)
      const cy = Math.cos(pet.yaw);
      const sy = Math.sin(pet.yaw);
      WOBBLE_LOOK.leanX = pet.wobble.dx * cy - pet.wobble.dz * sy;
      WOBBLE_LOOK.leanZ = pet.wobble.dx * sy + pet.wobble.dz * cy;
      pet.creature.pose('wobble', wt, pet.reaction, WOBBLE_LOOK);
    } else pet.creature.pose(phase, t, pet.reaction, { yaw: look, calm: pet.anim?.calm });
    // A ghost roll is never 'crit', so it never bursts.
    const s = phase === 'react' && pet.reaction === 'crit' ? (t * REACT_MS) / BURST_MS : 1;
    pet.sparkle.visible = s < 1;
    if (s < 1) {
      pet.sparkle.material = sparkMat; // petting may have lent the points its hearts
      burst(pet.sparkle, s, h, hop, calmNow()); // reduced motion: a steady burst, no twinkle
    }
    if (phase === 'react' && !pet.soundDone) {
      pet.soundDone = true;
      // a pet that leaves after its roll never rests to react to its element: it voices it here
      const el = !stays() && pet.elementAfter;
      const name = reactionSound(pet.reaction) ?? (el ? (ELEMENT_FX[el]?.sound ?? 'petYelp') : null);
      if (name && getSetting('petSounds') !== false && getSetting('sounds') !== false)
        playSound({ builtin: name });
    }
  }

  /** The pet comes to rest: from here it costs nothing until something wakes the loop. */
  function toRest(pet) {
    pet.state = 'rest';
    const element = pet.elementAfter;
    pet.elementAfter = null;
    if (element && perch() && getSetting('petElemental') !== false) {
      react(pet, element, clock()); // its roll's element, now it sits on the rim again
      wake();
    }
  }

  // ---- click to pet (petClick; petting.js listens) ----
  /** Reduced motion (test seam deps.reducedMotion): gentler wiggles, fewer hearts. */
  const calmNow = () => {
    try {
      return deps.reducedMotion ? !!deps.reducedMotion() : !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    } catch {
      return false;
    }
  };
  /**
   * The resting pet under page point (x, y), or null: its footprint (KIND_FOOTPRINT, which is in
   * scene units at PET_HEIGHT, scaled by its height) plus PICK_MARGIN x height, around the point
   * under its middle (half its height up, as the top-down camera sees it), in page px. The nearest
   * wins. Only a shown pet settled at its spot: not hopping, throwing, down, wobbling or huffing.
   * Only a click where the pet is drawn on top (petClickable: the table, or the interface under the
   * dice canvas, such as the player list or a module's HUD bar), never one on a window, menu or the
   * hand-throw overlay above a pet; and none while dice are held (the overlay grabs them).
   */
  function pickPet(x, y, target) {
    const map = pageMap();
    const above = !!target?.ownerDocument?.getElementById?.('dicer-canvas')?.classList?.contains('dicer-above');
    const onTable = TABLE_IDS.includes(target?.id) || petClickable(target, above);
    if (!map || disposed || !shown() || !onTable || holding()) return null;
    const camH = stage.halfDepth / TAN_HALF_FOV; // the camera's height above the table
    let best = null;
    let bestD = Infinity;
    for (const pet of pets.values()) {
      if (pet.state !== 'rest' || pet.gone || pet.wobble || pet.huff) continue;
      const h = pet.creature.height;
      const k = camH / Math.max(1e-6, camH - h / 2); // the camera's lean at half height
      const foot = (KIND_FOOTPRINT[pet.kind] ?? FOOTPRINT * PET_HEIGHT) * (h / PET_HEIGHT);
      const r = (foot + PICK_MARGIN * h) * k * map.px;
      const d = Math.hypot(map.ox + (pet.px ?? pet.base.x) * k * map.px - x, map.oz + (pet.pz ?? pet.base.z) * k * map.px - y);
      if (d <= r && d < bestD) {
        best = pet;
        bestD = d;
      }
    }
    return best;
  }
  /** Ends whatever a clicked pet was doing (smoke, frost, a cheer's turn) before petting starts. */
  function stopAnim(pet) {
    if (pet.anim?.kind === 'cheer') pet.yaw = pet.anim.yaw; // faces where it faced before the cheer
    dropAnim(pet);
  }
  /** A click on a resting pet: the happy wiggle, hearts and a chirp; the loop runs only for them. */
  function petPet(pet) {
    if (disposed || pet.state !== 'rest') return;
    const now = clock();
    stopAnim(pet);
    pet.anim = { kind: 'pet', at: now, calm: calmNow() };
    pet.idleAt = now; // a pet being petted does not wander off
    voice('petPurr'); // a rolling little trill
    wake();
  }
  /** The pet says `name` (a builtin pet sound), unless pet sounds or sounds are off. Never throws. */
  function voice(name) {
    try {
      if (name && getSetting('petSounds') !== false && getSetting('sounds') !== false) playSound({ builtin: name });
    } catch {
      /* no sound */
    }
  }
  /**
   * Too many clicks: it puffs and turns its back (HUFF_MS), hops HUFF_HOP x height toward the middle
   * of the table, and hops back to its spot once petting.js stops ignoring it (HUFF_IGNORE_MS).
   */
  function huffPet(pet) {
    if (disposed || pet.state !== 'rest') return;
    const now = clock();
    const home = spotOf(pet);
    stopAnim(pet);
    pet.anim = { kind: 'huff', at: now, calm: calmNow() };
    pet.huff = { home: { x: home.x, z: home.z }, yaw: pet.yaw, backAt: now + HUFF_IGNORE_MS };
    pet.idleAt = now;
    voice('petHuff'); // "hmph"
    wake();
  }
  /** Where a huffy pet hops: HUFF_HOP x height from its spot toward the stage's middle. */
  function huffSpot(pet) {
    const at = spotOf(pet);
    const cx = stage?.cx ?? pet.area?.cx ?? 0;
    const cz = stage?.cz ?? pet.area?.cz ?? 0;
    const step = HUFF_HOP * pet.creature.height;
    const d = Math.hypot(cx - at.x, cz - at.z);
    if (d < 1e-6) return { x: at.x + step, z: at.z };
    const k = Math.min(1, step / d);
    return { x: at.x + (cx - at.x) * k, z: at.z + (cz - at.z) * k };
  }
  // ---- looking at the cursor (petting.js passes its moves on) ----
  let cursor = null; // the cursor on the table (die units), or null
  /**
   * Whether a resting pet should turn to the cursor this frame: one standing plain (no reaction,
   * mood, wobble, huff or carry), with the cursor moved since it last settled and not right over it.
   */
  function gazing(pet) {
    if (!cursor || pet.gazeDone === cursor || pet.anim || pet.mood || pet.wobble || pet.huff || pet.held) return false;
    const x = pet.px ?? pet.base.x;
    const z = pet.pz ?? pet.base.z;
    return Math.hypot(cursor.x - x, cursor.z - z) > GAZE_NEAR * pet.creature.height;
  }
  /** The cursor moved to page (x, y): resting pets look at it (one frame wakes them; they settle). */
  function pointer(x, y) {
    if (disposed) return;
    const at = tableAt(x, y);
    if (!at) return;
    cursor = at;
    for (const pet of pets.values())
      if (pet.state === 'rest' && gazing(pet)) {
        wake();
        return;
      }
  }

  // ---- drag to place (petClick; petting.js tells a drag from a pat) ----
  /** Page point (x, y) on the table in die units (where a dropped pet stands), or null with no stage. */
  function tableAt(x, y) {
    const map = pageMap();
    if (!map || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x: (x - map.ox) / map.px, z: (y - map.oz) / map.px };
  }
  /** A drag picks up a resting pet (not one huffing, or while a roll flies: the physics has it). */
  function dragStart(pet) {
    if (disposed || pet.state !== 'rest' || pet.huff || pet.gone || activeRolls() > 0 || holding()) return false;
    stopAnim(pet);
    pet.held = { x: pet.px ?? spotOf(pet).x, z: pet.pz ?? spotOf(pet).z };
    pet.idleAt = clock(); // a pet being carried does not wander off
    voice('petWhoa');
    wake();
    return true;
  }
  function drag(pet, x, y) {
    if (!pet.held) return;
    const at = tableAt(x, y);
    if (at) pet.held = at;
    wake();
  }
  /**
   * Released: it lands where it was dropped, which is now where pets rest on this screen (petRestSpot
   * 'placed', petRestAt), it in the first slot and the others hopping beside it. A cancelled drag
   * (no point) or one with nowhere to save hops it back to its spot.
   */
  function drop(pet, x, y) {
    const held = pet.held;
    if (!held) return;
    pet.held = null;
    const now = clock();
    pet.idleAt = now;
    const h = pet.creature.height;
    pet.px = held.x;
    pet.pz = held.z;
    pet.hop = LIFT * h; // it drops from where it hung
    const at = tableAt(x, y);
    if (pet.state !== 'rest' || !at || !stage) {
      if (pet.state === 'rest') hopTo(pet, spotOf(pet), 'hop', now);
      return;
    }
    const cx = stage.cx ?? 0;
    const cz = stage.cz ?? 0;
    const m = EDGE_GAP * h;
    const pin = (v, c, hw) => Math.max(c - hw, Math.min(c + hw, v));
    savePlaced(toPlaced({ x: pin(at.x, cx, stage.halfWidth - m), z: pin(at.z, cz, stage.halfDepth - m) }, stage));
    for (const o of pets.values()) if (o !== pet) o.slot = null; // the others line up beside it
    pet.slot = 0;
    pet.spot = null;
    restOf(pet, now);
    restSpotChanged(now); // the others (no-op while a roll flies: update moves them after)
  }

  /**
   * A resting pet's petting wiggle, huff, elemental reaction, mood settle or cheer, for this frame;
   * a huff ends in its hop off.
   */
  function stepAnim(pet, now, shadows) {
    const a = pet.anim;
    const huff = a.kind === 'huff';
    const e = clamp01((now - a.at) / (ANIM_MS[a.kind] ?? PET_MS));
    if (huff) pet.yaw = wrap(pet.huff.yaw + Math.PI * smooth(clamp01((e - 0.3) / 0.7))); // turns its back
    if (a.kind === 'cheer') {
      // turns to the dice, cheers, and turns back to where it faced
      pet.yaw = wrap(a.yaw + wrap(a.to - a.yaw) * (smooth(clamp01(e / 0.2)) - smooth(clamp01((e - 0.8) / 0.2))));
      if (a.chirp && now >= a.at) {
        a.chirp = false;
        try {
          if (getSetting('petSounds') !== false && getSetting('sounds') !== false) playSound({ builtin: 'petHappy' });
        } catch {
          /* no sound */
        }
      }
    }
    show(pet, now, a.kind, e, pet.px, pet.pz, 0, shadows);
    if (e < 1) {
      // an elemental reaction: its element's look; anything else (petting, a huff, a cheer, a mood) its own
      const fx = a.element ? ELEMENT_FX[a.element] : null;
      if (fx) elementFx(pet, e, fx, a.calm);
      else if (!float(pet, e, a.kind, a.calm)) pet.sparkle.visible = false;
      return true;
    }
    dropAnim(pet);
    pet.sparkle.visible = false;
    if (huff) {
      hopTo(pet, huffSpot(pet), 'hop', now);
      pet.yawTo = pet.yaw; // keeps its back turned
      return stepHop(pet, now, shadows);
    }
    if (MOODS.has(a.kind)) {
      show(pet, now, a.kind, 1, pet.px, pet.pz, 0, shadows); // settled: held, nothing redraws after
      pet.mood = a.kind;
      return true;
    }
    show(pet, now, 'exit', 1, pet.px, pet.pz, 0, shadows); // the standing pose: nothing redraws after
    return true;
  }
  /** The click listeners: on while any pet is shown (petting.js reads petClick on each click). */
  function syncPetting() {
    const want = !disposed && pets.size > 0 && shown();
    if (want && !petting) {
      const win = deps.win ?? globalThis.window;
      if (win?.addEventListener)
        petting = createPetting({
          win,
          pickPet,
          onPet: petPet,
          onHuff: huffPet,
          onDragStart: dragStart,
          onDrag: drag,
          onDrop: drop,
          onPointer: pointer,
          now: clock,
          setting: getSetting,
        });
    } else if (!want && petting) {
      petting.dispose();
      petting = null;
    }
  }

  /** A hop to a rest spot or off the table, on the exit pose. Returns false once a leaver is gone. */
  function stepHop(pet, now, shadows) {
    const e = Math.min(1, Math.max(0, (now - pet.hopAt) / REST_HOP_MS));
    const { hopFrom: from, hopTo: to } = pet;
    const s = smooth(e);
    if (pet.state === 'off' && e >= 1) return false;
    if (pet.state === 'hop') pet.yaw = wrap(pet.yaw0 + wrap(pet.yawTo - pet.yaw0) * s);
    const px = from.x + (to.x - from.x) * s;
    const pz = from.z + (to.z - from.z) * s;
    const hop = e >= 1 ? 0 : from.y * (1 - s) + Math.sin(s * Math.PI) * HOP * pet.creature.height;
    show(pet, now, 'exit', e, px, pz, hop, shadows);
    if (e >= 1) toRest(pet); // the last frame is posed: from here nothing redraws
    return true;
  }

  /**
   * A move (alignFor), on the creature's 'move' pose: the dragonling takes off, flies over in an
   * arc and lands; the slime boings over in two hops (its pose does the springs, airborne from 0.2
   * to 0.8 of each); the mimic scuttles over low. It turns to face the way it goes, then to
   * `yawTo` as it settles.
   */
  function stepMove(pet, now, shadows) {
    const e = clamp01((now - pet.goAt) / pet.goMs);
    const { goFrom: from, goTo: to } = pet;
    let s;
    let hop = 0;
    if (pet.kind === 'dragonling') {
      s = smooth(clamp01((e - 0.12) / 0.78)); // up first, then across, then down
      hop = FLY_PEAK * (smooth(clamp01(e / 0.35)) - smooth(clamp01((e - 0.65) / 0.35)));
    } else if (pet.kind === 'slime') {
      const i = e < 0.5 ? 0 : 1; // it travels while it is in the air
      s = (i + smooth(clamp01((e * 2 - i - 0.2) / 0.6))) / 2;
    } else s = smooth(e);
    const turn = wrap(pet.yaw0 + wrap(pet.yawGo - pet.yaw0) * smooth(clamp01(e / 0.2)));
    pet.yaw = wrap(turn + wrap(pet.yawTo - pet.yawGo) * smooth(clamp01((e - 0.75) / 0.25)));
    const px = from.x + (to.x - from.x) * s;
    const pz = from.z + (to.z - from.z) * s;
    show(pet, now, 'move', e, px, pz, e >= 1 ? 0 : hop, shadows);
    if (e >= 1) toRest(pet); // posed on the standing pose: nothing redraws from here
    return true;
  }

  /** A puddle (or a splat that is becoming one) snaps to the spot the stage change gave it. */
  function moveDown(pet) {
    const to = pet.moveTo;
    pet.moveTo = null;
    pet.px = to.x;
    pet.pz = to.z;
    pet.spot = to;
  }

  /**
   * A splat bursting, a puddle, a puddle reforming or fading, for this frame. The creature is
   * hidden while it is down; the splat is the visual. Returns like step().
   */
  function stepDown(pet, now, shadows, stay) {
    const g = pet.group;
    const sp = ensureSplat(pet);
    g.userData.dicerPet.phase = pet.state;
    g.position.set(pet.px ?? pet.base.x, 0, pet.pz ?? pet.base.z);
    g.rotation.y = pet.yaw;
    pet.hop = 0;
    pet.sparkle.visible = false;
    if (pet.state === 'splat') {
      pet.creature.root.visible = false;
      pet.shadow.visible = false;
      const e = clamp01((now - pet.splatAt) / SPLAT_MS);
      sp.pose('burst', e);
      if (e >= 1) {
        pet.puddleAt = now;
        pet.puddleDone = false;
        if (pet.moveTo) moveDown(pet);
        pet.state = pet.reformNext ? 'reform' : 'puddle';
        pet.reformAt = now;
        pet.reformNext = false;
      }
      return true;
    }
    if (pet.state === 'puddle') {
      if (!stay || pet.gone) {
        pet.state = 'fade';
        pet.fadeAt = now;
        return true;
      }
      if (pet.puddleDone) return 'rest'; // it lies there: nothing redraws
      const e = clamp01((now - pet.puddleAt) / PUDDLE_MS);
      sp.pose('puddle', e);
      if (e >= 1) pet.puddleDone = true;
      return e < 1 ? true : 'rest';
    }
    if (pet.state === 'reform') {
      const e = clamp01((now - pet.reformAt) / REFORM_MS);
      pet.creature.root.visible = true;
      pet.shadow.visible = shadows && e > 0.5;
      sp.pose('reform', e);
      pet.creature.pose('reform', e, 'plain', NO_LOOK);
      if (e >= 1) {
        dropSplat(pet);
        pet.shadow.visible = shadows;
        pet.state = 'routine';
        pet.lastNow = now;
        pet.track.beganAt = pet.from ? now : now - ENTER_MS; // hops to its edge spot from the puddle
      }
      return true;
    }
    // fade: it shrinks away, and the pet is gone
    const e = clamp01((now - pet.fadeAt) / REST_HOP_MS);
    if (e >= 1) return false;
    pet.shadow.visible = false;
    g.scale.setScalar(Math.max(1e-3, 1 - smooth(e)));
    return true;
  }

  /** One pet, one frame: true if it moved, 'rest' if it sits still, false once it is gone. */
  function step(pet, now, shadows, stay) {
    if (DOWN.has(pet.state)) return stepDown(pet, now, shadows, stay);
    if (pet.state === 'rest') {
      if (stay && pet.held) {
        // held by the mouse: it hangs under the pointer, its legs dangling (the startled pose)
        show(pet, now, 'startle', 0.5, pet.held.x, pet.held.z, LIFT * pet.creature.height, shadows);
        return true;
      }
      if (pet.held) pet.held = null; // resting went off mid-drag: let go
      if (stay && pet.wobble) {
        show(pet, now, 'exit', 1, pet.px, pet.pz, 0, shadows); // the wobble, or the plain pose once it is over (show clears it)
        if (pet.wobble) return true; // over: on to its mood below
      }
      if (stay && pet.anim) return stepAnim(pet, now, shadows);
      if (stay) {
        // its owner's mood (petMoods): it settles into the pose, or back out of it to standing
        const mood = moodPose(pet);
        if (mood !== (pet.mood ?? null)) {
          if (mood) {
            pet.anim = { kind: mood, at: now, calm: calmNow() };
            return stepAnim(pet, now, shadows);
          }
          show(pet, now, 'exit', 1, pet.px, pet.pz, 0, shadows);
          return true;
        }
        if (gazing(pet)) {
          // the cursor moved: it turns to look, then holds still once it faces it
          pet.gaze = cursor;
          show(pet, now, 'exit', 1, pet.px, pet.pz, 0, shadows);
          const off = Math.abs(wrap(Math.atan2(cursor.x - pet.px, cursor.z - pet.pz) - pet.yaw));
          if (off > GAZE_SETTLED) return true;
          pet.gazeDone = cursor;
        }
        const was = pet.shadow.visible;
        pet.shadow.visible = shadows; // the only thing that can change while it sits
        return was !== shadows || 'rest'; // a frame to draw it; otherwise nothing moves
      }
      sendOff(pet, now);
    }
    if ((pet.state === 'hop' || pet.state === 'move') && !stay) sendOff(pet, now);
    if (pet.state === 'move') return stepMove(pet, now, shadows);
    if (pet.state !== 'routine') return stepHop(pet, now, shadows);
    const { phase, t } = phaseAt(pet.track, now);
    if ((phase === 'exit' || phase === 'gone') && stay && !pet.gone) {
      restOf(pet, now); // the exit becomes a hop to a resting spot (in place, if it watched from one)
      return stepHop(pet, now, shadows);
    }
    if ((phase === 'exit' || phase === 'gone') && pet.atRest) {
      sendOff(pet, now); // resting is off, or its user left: it hops out from its spot, not slides
      return stepHop(pet, now, shadows);
    }
    if (phase === 'gone') return false;
    if (pet.anim?.element) {
      // a die with an element hit it while it watched: it reacts in place, then watches on
      if (phase === 'watch') return stepAnim(pet, now, shadows);
      dropAnim(pet); // the dice landed: its own reaction takes over
      pet.sparkle.visible = false;
    }
    const h = pet.creature.height;
    const { base, out } = pet;
    let px = base.x;
    let pz = base.z;
    let hop = 0;
    if (phase === 'enter') {
      const e = smooth(t);
      const from = pet.from;
      if (from) {
        // a re-used pet hops from where it was to its new spot
        px = from.x + (base.x - from.x) * e;
        pz = from.z + (base.z - from.z) * e;
        hop = from.y * (1 - e) + Math.sin(e * Math.PI) * HOP * h;
      } else {
        const slide = (1 - e) * SLIDE * h;
        px += out[0] * slide;
        pz += out[1] * slide;
        hop = Math.sin(e * Math.PI) * HOP * h;
      }
    } else if (phase === 'exit') {
      // Leave from wherever the pet is now (a leave can land mid-hop), not from its base.
      const from = (pet.exitFrom ??= { x: pet.px ?? base.x, z: pet.pz ?? base.z, y: pet.hop ?? 0 });
      const e = smooth(t);
      px = from.x + (base.x + out[0] * SLIDE * h - from.x) * e;
      pz = from.z + (base.z + out[1] * SLIDE * h - from.z) * e;
      hop = from.y * (1 - e) + Math.sin(e * Math.PI) * HOP * h;
    }
    show(pet, now, phase, t, px, pz, hop, shadows);
    return true;
  }

  /**
   * One frame. true while anything moves; 'rest' when pets stand but nothing moves (DiceBox holds
   * the last frame with no rAF; wake() restarts it); false with no pets. A resting pet is not
   * posed again, so it costs nothing until its owner rolls, or a setting, a user or the area
   * changes (each of those wakes the loop).
   */
  function update(now) {
    syncPetting();
    if (!pets.size) {
      arm(Infinity);
      return false;
    }
    let shadows = true;
    try {
      shadows = getSetting('shadows') !== false; // once per frame, not per pet
    } catch {
      /* unreadable: keep the default */
    }
    const stay = stays();
    const idle = stayFor();
    // Dice held by hand (H-8) count as busy too, and no idle leave is armed while they are: the
    // first frame after the release (or drop) arms it again.
    const held = holding();
    const busy = held || activeRolls() > 0; // once per frame
    // No roll in flight (the physics fixed every pet's spot when a throw started): a new
    // petRestSpot moves the resting pets, and a replay's pets go home. Held back until then.
    if (stay && !busy) {
      try {
        restSpotChanged(now);
      } catch (err) {
        console.warn('Dicer | pet', err);
      }
    }
    let nextLeave = Infinity;
    let moving = false;
    for (const pet of [...pets.values()]) {
      let alive = false;
      try {
        // a resting pet or puddle leaves once its idle time is up (a hop off, or a fade)
        // (a puddle fades PUDDLE_LEAVE_MS after its splat, whatever petStay says, unless sooner)
        const waits = ['rest', 'hop', 'move', 'puddle'].includes(pet.state);
        const wait =
          pet.state === 'puddle' ? (idle > 0 ? Math.min(idle * 1000, PUDDLE_LEAVE_MS) : PUDDLE_LEAVE_MS) : idle * 1000;
        pet.leaveAt = stay && wait > 0 && waits && Number.isFinite(pet.idleAt) ? pet.idleAt + wait : null;
        if (pet.leaveAt !== null) {
          // An overdue leave waits while any roll is in flight (the physics has the pet as an
          // obstacle, and the owner's roll may be between obstaclesFor and begin); the timer is
          // not aimed at it (it would spin the loop), and the roll's end runs update anyway.
          if (now >= pet.leaveAt) {
            if (!busy) sendOff(pet, now);
          } else if (!held) nextLeave = Math.min(nextLeave, pet.leaveAt);
        }
        // Petting belongs to a resting pet: one that rolled, left, splatted or moved drops it.
        // (an elemental reaction a watching pet got from a die hitting it plays out over its watch)
        if (pet.anim && pet.state !== 'rest' && !(pet.state === 'routine' && pet.anim.element)) dropAnim(pet);
        if (pet.held && pet.state !== 'rest') pet.held = null; // its owner rolled mid-drag: let go
        if (pet.huff && (pet.gone || (pet.state !== 'rest' && pet.state !== 'hop'))) pet.huff = null;
        if (pet.huff && now >= pet.huff.backAt) {
          // over its huff: back to its spot (not while a roll flies: the physics has it where it is)
          if (!busy && pet.state === 'rest' && !pet.anim) {
            const { home, yaw } = pet.huff;
            pet.huff = null;
            hopTo(pet, home, 'hop', now);
            pet.yawTo = yaw;
          }
        } else if (pet.huff) nextLeave = Math.min(nextLeave, pet.huff.backAt);
        // A pet alignFor placed stays while the replay flies, even with petStay 0 (not mid-routine:
        // that one follows its own roll).
        alive = step(pet, now, shadows, stay || (pet.aligned && busy && pet.state !== 'routine'));
      } catch (err) {
        console.warn('Dicer | pet', err);
      }
      if (alive === false) removePet(pet);
      else if (alive === true) moving = true;
    }
    arm(nextLeave);
    return moving ? true : pets.size > 0 ? 'rest' : false;
  }

  /**
   * The pets the physics should treat as fixed, for a throw about to start (PetHook.obstaclesFor):
   * every standing pet, a resting one at its spot (one moving at its destination) and
   * a rolling one at its edge spot, and, for
   * `spec`'s own user, the edge spot its pet is about to take, from the same placement as begin
   * (which replaces that pet's own entry). A pet leaving, or about to be replaced, stands no more.
   */
  function obstaclesFor({ spec, edge, area, stage: now }) {
    if (now) stage = now; // the layer may have loaded after DiceBox's last areaChanged
    const own = spec ? slotFor(spec.userId) : null;
    const list = [];
    if (own?.ok) {
      const mine = pets.get(spec.userId);
      const h = mine?.creature.height ?? PET_HEIGHT * size;
      // with resting on the pet rolls from its resting spot (a first appearance: the one it will hop
      // to, kept pending for begin); otherwise from the edge spot
      const at = perchSpot(spec.userId) ?? (stays()
        ? (watchSpot(mine) ?? newSpot(spec.userId, area, h, own.victim, true))
        : edgeSpot(edge, area, h).base);
      list.push(obstacle(at, h, spec.userId, mine?.creature.footprint ?? kindFootprint(spec.kind)));
    }
    for (const p of pets.values())
      if (solid(p) && p !== own?.victim && !(own?.ok && p.userId === spec.userId))
        list.push(obstacle(spotOf(p), p.creature.height, p.userId, p.creature.footprint));
    return list;
  }

  /**
   * H-6: a hand replay is about to play here with the thrower's pet layout (`list`: {id, x, z, r, h}
   * in this screen's die units, placed like the dice; `area`: the replay's area; `paths(x, z)`: the
   * distance to the nearest recorded die centre over the whole replay). Each listed standing pet
   * moves to its spot (REST_HOP_MS); a listed pet not here hops in to it at rest, if slotFor finds
   * it a place (a full cap sends the longest-idle resting pet off, never one mid-routine or listed);
   * a listed pet mid-routine, splatted, a puddle or fading stays as it is (a puddle is no obstacle:
   * its die passes over it), and one with no place or no pet here is skipped (its die bounces off
   * empty air, and its splat finds no pet). An unlisted standing pet whose footprint the paths come
   * within r + 1 of moves to a rest spot they clear, if it finds one. Nothing with pets hidden or
   * not allowed, or while dice are held (H-8: the held throw's pets stay where its player aims).
   * A pet whose owner is gone is never moved or brought back. A placed or moved pet stays while
   * the replay flies, even with petStay 0. Returns the Set of listed ids standing at their spot
   * (or hopping to it): only those take the replay's hits (the caller drops the others).
   */
  function alignFor(list, area, paths) {
    const done = new Set();
    if (disposed || !shown() || holding()) return done;
    const now = clock();
    const items = (Array.isArray(list) ? list : []).filter(
      (o) => o && o.id != null && Number.isFinite(o.x) && Number.isFinite(o.z),
    );
    const spare = new Set(items.map((o) => o.id));
    const yawAt = (to) => Math.atan2(area.cx - to.x, area.cz - to.z); // faces the replay's dice
    const absent = [];
    for (const o of items) {
      const pet = pets.get(o.id);
      const to = { x: o.x, z: o.z };
      if (!pet || pet.state === 'off') absent.push([o, to]);
      else if (!pet.gone && (pet.state === 'hop' || pet.state === 'rest' || pet.state === 'move')) {
        const at = pos(pet);
        pet.aligned = true;
        done.add(o.id);
        if (Math.hypot(at.x - to.x, at.z - to.z) > MOVED || at.y > MOVED)
          goTo(pet, at, to, REST_HOP_MS, yawAt(to), now);
      }
    }
    for (const [o, to] of absent) {
      let pet = pets.get(o.id);
      if (pet?.gone) continue;
      const spec = pet ? null : petFor({ user: userOf(o.id), view: 'real', getSetting });
      if (!pet && !CREATURES[spec?.kind]) continue;
      const slot = slotFor(o.id, spare);
      if (!slot.ok) continue;
      if (slot.victim) sendOff(slot.victim, now);
      if (!pet) {
        pet = makePet({ ...spec, userId: o.id });
        let own = null;
        try {
          own = deps.areaOf?.(o.id);
        } catch {
          /* no area: the replay's */
        }
        pet.area = fitted(own ?? area);
        const from = offPoint(area, to, pet.creature.height); // hops in from just outside
        pet.px = from.x;
        pet.pz = from.z;
        pet.hop = 0;
        pet.base = to;
        pet.yaw = Math.atan2(to.x - from.x, to.z - from.z);
        pet.reaction = 'plain';
        pet.lastNow = now;
      }
      pet.atRest = true;
      pet.idleAt = now;
      hopTo(pet, to, 'hop', now);
      pet.aligned = true;
      done.add(o.id);
    }
    for (const pet of pets.values()) {
      if (spare.has(pet.userId) || pet.gone || !(pet.state === 'hop' || pet.state === 'rest' || pet.state === 'move')) continue;
      const r = pet.creature.footprint ?? 0.45 * pet.creature.height;
      const clear = (p) => paths(p.x, p.z) > r + 1;
      const at = spotOf(pet);
      if (clear(at)) continue;
      pet.area = fitted(pet.area);
      const to = spotFor(pet.userId, pet.area, pet.creature.height, null, clear);
      if (!clear(to)) continue; // nowhere the paths clear: it stays
      pet.aligned = true;
      goTo(pet, pos(pet), to, REST_HOP_MS, yawAt(to), now);
    }
    return done;
  }

  /** The user left: their resting pet hops off; one mid-routine leaves when its roll ends. */
  function userGone(userId) {
    const pet = pets.get(userId);
    if (!pet) return;
    pet.gone = true;
    if (['hop', 'rest', 'move', 'puddle'].includes(pet.state))
      sendOff(pet, clock());
  }

  /** Whether petSplat is on. */
  const splatOn = () => {
    try {
      return getSetting('petSplat') !== false;
    } catch {
      return true;
    }
  };

  /** A die hit the standing pet hard: its routine ends (no reaction), and it bursts into a puddle. */
  function splat(pet, now) {
    for (const k of pet.rolls.keys()) keyOwner.delete(k); // the roll's landed, leave and end now find no pet
    pet.rolls.clear();
    pet.current = null;
    pet.spot = { x: pet.px ?? pet.base.x, z: pet.pz ?? pet.base.z }; // the puddle lies where it was hit
    pet.wobble = null;
    pet.reformNext = false;
    pet.state = 'splat';
    pet.splatAt = now;
    pet.idleAt = now;
    ensureSplat(pet).root.visible = true;
    if (getSetting('petSounds') !== false && getSetting('sounds') !== false)
      playSound({ builtin: 'petSplat' });
    wake();
  }

  /**
   * DiceBox's PetHook.hit(id, { speed, position, dieKey, die }), at playback time: a die touches the
   * pet of user `id`. A die with an element (`die`: its appearance, damageType, ghost) sets a resting
   * pet off in that element (petElemental), however hard it hits: fire scorches, frost chills,
   * storm shocks; it never splats or wobbles it. Otherwise, at SPLAT_SPEED or more (and petSplat on)
   * a check's d20 splats it (maySplat: never a damage die or another die); from WOBBLE_SPEED it wobbles, pushed away from `position` (a new hit restarts it);
   * less does nothing. A splat, puddle or pet already down is not hit again, so several hits in one
   * frame give one splat and one sound.
   */
  function hit(id, info) {
    if (disposed) return;
    const pet = pets.get(id);
    if (!pet || !['routine', 'hop', 'rest', 'move'].includes(pet.state)) return;
    const speed = info?.speed;
    const now = clock();
    const element = hitElement(pet, info?.die);
    if (element) {
      // the same element going on (a second die of the roll, a bounce) does not restart it
      if (pet.anim?.element !== element) {
        react(pet, element, now);
        wake();
      }
      return;
    }
    if (!(speed >= WOBBLE_SPEED)) return; // also NaN
    // only a check's d20 splats (maySplat; a die with no type, from an old caller, still may)
    const d = info?.die;
    if (speed >= SPLAT_SPEED && splatOn() && (!d?.type || maySplat(d.type, d.damageType))) return splat(pet, now);
    let dx = (pet.px ?? pet.base.x) - (info.position?.x ?? 0);
    let dz = (pet.pz ?? pet.base.z) - (info.position?.z ?? 0);
    const len = Math.hypot(dx, dz);
    if (len > 1e-6 && Number.isFinite(len)) ((dx /= len), (dz /= len));
    else ((dx = 1), (dz = 0));
    pet.wobble = { at: now, dx, dz };
    dropAnim(pet); // a die knocks a petting wiggle, a huff or a reaction out of it
    wake();
  }

  /**
   * DiceBox's PetHook.wall(position, speed): a die hit the roll area's wall at `position`. With the
   * pets on the tray's rim, one standing within WALL_REACH wobbles away from the hit (at
   * WALL_FLINCH_SPEED or more): the dice reach the rim it sits on, never the pet. A pet already
   * wobbling is left to finish.
   */
  function wall(position, speed) {
    if (disposed || !(speed >= WALL_FLINCH_SPEED) || !position || !perch()) return;
    const now = clock();
    for (const pet of pets.values()) {
      if (!['routine', 'hop', 'rest', 'move'].includes(pet.state)) continue;
      if (pet.wobble && now - pet.wobble.at < WOBBLE_MS) continue;
      const x = pet.px ?? pet.base?.x ?? 0;
      const z = pet.pz ?? pet.base?.z ?? 0;
      const d = Math.hypot(x - position.x, z - position.z);
      if (!(d < WALL_REACH)) continue;
      const k = d > 1e-6 ? 1 / d : 0;
      pet.wobble = { at: now, dx: k ? (x - position.x) * k : 0, dz: k ? (z - position.z) * k : 1 };
      dropAnim(pet);
      wake();
    }
  }

  /**
   * The stage changed size. Each resting pet hops to a fresh valid spot inside its owner's area:
   * the area of that owner's most recent roll (kept on the pet at begin), shrunk and shifted to fit
   * the new stage. Rolling pets keep their edge spot: their roll has its own area.
   */
  function areaChanged(next) {
    const resized = resize(); // diceScale or petScale changed (both come here through resizeDice)
    const same =
      !resized &&
      stage &&
      ['cx', 'cz', 'halfWidth', 'halfDepth'].every((k) => (stage[k] ?? 0) === (next[k] ?? 0));
    stage = next;
    if (same) return; // a resize event with the same size: nobody hops for no visible reason
    const now = clock();
    for (const pet of pets.values()) replace(pet, now);
  }

  /**
   * Where pets rest may have changed (petRestSpot's onChange wakes the loop, and update asks here
   * each frame with no roll in flight; also the layer's restSpotChanged()). On a new choice the
   * resting pets hop, and puddles snap, to it, taking corner slots in the order they came to rest
   * (corner to corner keeps each pet's slot). A pet a hand replay moved (alignFor) goes back to this
   * viewer's spot once it stands there and the replay is over: its corner slot, or under 'dice' a
   * ring spot in its own area (one already in that ring stays). Nothing while a
   * roll is in flight, dice are held or resting is off. Afterwards the layer goes idle again.
   */
  function restSpotChanged(now = clock()) {
    if (disposed || activeRolls() > 0 || holding() || !stays()) return;
    const c = current();
    // only those resting by another choice: one that came to rest since already sits by this one
    const order = [...pets.values()].filter((p) => stale(p, c)).sort((a, b) => (a.idleAt ?? 0) - (b.idleAt ?? 0));
    for (const pet of order) replace(pet, now);
    const corner = !!stage && fixed(c);
    for (const pet of pets.values()) {
      if (!pet.aligned || pet.state === 'routine' || pet.state === 'hop' || pet.state === 'move') continue; // not there yet
      if (pet.state !== 'rest' || pet.gone) pet.aligned = false; // a puddle stays; one leaving goes
      // 'dice': a spot of the replay's that is already in its own ring is a rest spot of this viewer's
      else if (!corner && inRestRing(fitted(pet.area), pet.creature.height, spotOf(pet))) pet.aligned = false;
      else restOf(pet, now);
    }
  }

  /**
   * A resting pet hops to a fresh spot in its (re-fitted) area; a puddle snaps to one, and a splat
   * gets one when it becomes a puddle. Its old spot keeps nobody away. Others are left alone.
   */
  function replace(pet, now) {
    if (pet.state === 'splat' || pet.state === 'puddle') {
      if (stage) pet.area = fitArea(pet.area, stage);
      pet.spot = null;
      pet.moveTo = freeSpot(pet);
      if (pet.state === 'puddle') {
        moveDown(pet);
        pet.puddleDone = false; // drawn again, once, at the new spot
        pet.puddleAt = now - PUDDLE_MS;
        wake();
      } else pet.spot = { x: pet.px ?? pet.base.x, z: pet.pz ?? pet.base.z };
    } else if (pet.state === 'hop' || pet.state === 'rest' || pet.state === 'move') {
      pet.spot = null;
      pet.atRest = false; // a new area: a new spot
      restOf(pet, now);
    }
  }

  /**
   * The GM edited the roll areas (main's dicerRollAreasChanged): a resting pet or puddle whose
   * owner's area is now another moves into it. `deps.areaOf(userId)` is that user's area in die
   * units, from the resolver DiceBox throws with; a user whose area did not change keeps their spot.
   */
  function onAreas() {
    if (disposed) return;
    const now = clock();
    for (const pet of pets.values()) {
      let a = null;
      try {
        a = deps.areaOf?.(pet.userId);
      } catch {
        /* no area: the pet stays */
      }
      if (!a || ['cx', 'cz', 'halfWidth', 'halfDepth'].every((k) => a[k] === pet.area?.[k])) continue;
      // A pet mid-routine rests in the new area once its roll is over.
      pet.area = { cx: a.cx, cz: a.cz, halfWidth: a.halfWidth, halfDepth: a.halfDepth };
      replace(pet, now);
    }
  }
  const areasHook = hooks?.on?.(AREAS_HOOK, onAreas);

  // One of each creature, plus a shadow and a sparkle, compiled up front so the first pet costs no
  // programs mid-roll. They stay alive (never in the scene) until dispose(): freeing their
  // materials would release, and so delete, the programs just compiled.
  const samples = [];
  let sampleShadow = null;
  let sampleSparkle = null;
  let sampleSmoke = null;
  if (warm) {
    try {
      const objs = [];
      for (const make of Object.values(CREATURES)) {
        const c = make('#ffffff');
        samples.push(c);
        c.root.traverse((o) => {
          if (o.isMesh || o.isPoints) objs.push(o);
        });
      }
      for (const kind of Object.keys(CREATURES)) {
        const sp = createSplat(kind, '#ffffff'); // a splat has the same dispose()
        samples.push(sp);
        sp.root.traverse((o) => {
          if (o.isMesh) objs.push(o);
        });
      }
      sampleShadow = makeShadow();
      sampleSparkle = makeSparkle();
      sampleSmoke = makeSmoke(); // its RGBA colours are another program: compiled up front too
      objs.push(sampleShadow, sampleSparkle, sampleSmoke);
      Promise.resolve(warm(objs)).catch(() => {}); // a context loss or timeout: compiled on use
    } catch (err) {
      console.warn('Dicer | pet', err);
    }
  }

  function dispose() {
    disposed = true;
    arm(Infinity);
    syncPetting(); // the click listeners go
    try {
      hooks?.off?.(AREAS_HOOK, areasHook);
    } catch {
      /* Foundry is gone */
    }
    doc?.removeEventListener?.(TRAY_EVENT, onTray);
    for (const pet of [...pets.values()]) removePet(pet);
    for (const c of samples) {
      try {
        c.dispose();
      } catch {
        /* already torn down */
      }
    }
    samples.length = 0;
    sampleShadow?.material.dispose();
    sampleSparkle?.geometry.dispose();
    sampleSmoke?.geometry.dispose();
    sampleShadow = sampleSparkle = sampleSmoke = null;
    shadowTex?.dispose();
    shadowGeo?.dispose();
    sparkTex?.dispose();
    sparkMat?.dispose();
    for (const m of [heartMat, puffMat, smokeMat, zapMat]) {
      m?.map.dispose();
      m?.dispose();
    }
    shadowTex = shadowGeo = sparkTex = sparkMat = heartMat = puffMat = smokeMat = zapMat = null;
  }

  return {
    begin,
    landed,
    leave,
    end,
    update,
    obstaclesFor,
    alignFor,
    userGone,
    areaChanged,
    /** petRestSpot may have changed: resting pets move to the new spot (update also checks). */
    restSpotChanged: () => restSpotChanged(),
    hit,
    wall,
    dispose,
    /** The contact speed at which the physics splats a pet (THROW splatSpeed); null: petSplat off. */
    get splatSpeed() {
      return splatOn() ? SPLAT_SPEED : null;
    },
  };
}
