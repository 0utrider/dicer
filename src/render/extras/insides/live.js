import * as THREE from 'three';
import { createMotion, stepMotion, restFactor } from './motion.js';

/**
 * Living insides: per-die motion state and its four uniforms (the look-extras chunk side of the
 * insideMotion wiring; DiceBox reaches it through getLookExtras() only).
 *
 * - uInteriorTime (float): seconds since the die's roll first drew, scaled by the motion factor;
 * - uInteriorSpin (vec3): the die's smoothed angular velocity, canonical (die-local) frame;
 * - uInteriorLag (vec3, unit): a damped spring chasing world up in the die-local frame;
 * - uInteriorFlare (float 0..1): written by inside flares (effects/library/inside-flare.js), never
 *   here; read here only to speed glitter's swirl;
 * - uInteriorSwirl (vec3): glitter's swirl rotation vector, integrated (motion.js SWIRL).
 */
export const MOTION_PARS = [
  'uniform float uInteriorTime;',
  'uniform vec3 uInteriorSpin;',
  'uniform vec3 uInteriorLag;',
  'uniform float uInteriorFlare;',
  'uniform vec3 uInteriorSwirl;',
].join('\n');

/**
 * `text` with the first `from` replaced by `to`; throws where `from` is missing, so a GLSL edit
 * whose anchor drifted fails loudly (patchMaterial then draws the fallback look) instead of
 * silently leaving the inside still.
 */
export function swap(text, from, to) {
  if (!text.includes(from)) throw new Error(`dicer: inside motion anchor missing: ${from}`);
  return text.replace(from, () => to);
}

const INTERIOR_SIG = 'vec4 dcInterior( vec3 p, vec3 rd, float dt )';

/**
 * A moving inside's `body` brightened by the inside flare: its dcInterior renamed
 * `dc<prefix>Base` and wrapped, the colour (premultiplied: the emission) x (1 + uInteriorFlare),
 * the opacity kept. Flare 0 changes nothing; no extra noise lookup. For the insides with no
 * agitation of their own (the flare's "others brighten").
 */
export function brighten(body, prefix) {
  return `${swap(body, INTERIOR_SIG, `vec4 dc${prefix}Base( vec3 p, vec3 rd, float dt )`)}
${INTERIOR_SIG} {
	vec4 c = dc${prefix}Base( p, rd, dt );
	return vec4( c.rgb * ( 1.0 + uInteriorFlare ), c.a );
}
`;
}

/** Fresh motion uniforms at their defaults. */
export const motionUniforms = () => ({
  uInteriorTime: { value: 0 },
  uInteriorSpin: { value: new THREE.Vector3(0, 0, 0) },
  uInteriorLag: { value: new THREE.Vector3(0, 1, 0) },
  uInteriorFlare: { value: 0 },
  uInteriorSwirl: { value: new THREE.Vector3(0, 0, 0) },
});

/** Longest step one frame may take: a paused tab must not mean hundreds of spring substeps. */
const MAX_DT = 0.1;

let reduced = null;
/**
 * prefers-reduced-motion, read once (false where matchMedia is missing). The motion stepping
 * reads it, and so does insidePatch (index.js): a live inside's patch gets the DICER_CALM define
 * under reduced motion (storm's sparks hold instead of flashing).
 */
export function prefersReduced() {
  if (reduced === null) {
    try {
      reduced = !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    } catch {
      reduced = false;
    }
  }
  return reduced;
}

/** Test seam: forget the cached reduced-motion answer. */
export function _resetReducedMotion() {
  reduced = null;
}

/** Test / sheet seam: force the reduced-motion answer (dev/insides.js builds its reduced row with it). */
export function _setReducedMotion(v) {
  reduced = !!v;
}

// set when frame() threw: it warned once and steps nothing more (the insides stay where they are)
let failed = false;

/** Test seam: forget a frame() failure. */
export function _resetInsideMotion() {
  failed = false;
}

// die -> { m: motion state, u: the die's isolated uniforms, last: ms of its last step }
const states = new WeakMap();
// the inner mesh's world rotation (outer x inner), reused every frame
const quat = { x: 0, y: 0, z: 0, w: 1 };
// the step options, reused every call (stepMotion reads them synchronously)
const stepOpts = { reduced: false, factor: 1, flare: 0 };

function worldQuat(die) {
  const a = die.outer.quaternion;
  const b = die.inner.quaternion;
  quat.x = a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y;
  quat.y = a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x;
  quat.z = a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w;
  quat.w = a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z;
  return quat;
}

export const insideMotion = {
  /** True when this look's inside is marched with motion: resin, an inside, interiors on, steps > 0, insideMotion. */
  wants(a, flags) {
    const type = a?.interior?.type;
    return (
      a?.body?.type === 'resin' &&
      !!type &&
      type !== 'none' &&
      !!flags?.interiors &&
      flags.interiorSteps > 0 &&
      !!flags.insideMotion
    );
  },

  /** Steps the die's motion by dtSec with `quat` (its inner world rotation) and writes `uniforms`. */
  step(die, uniforms, q, dtSec, opts) {
    let st = states.get(die);
    if (!st) states.set(die, (st = { m: createMotion(), u: uniforms, last: null }));
    const m = stepMotion(st.m, q, Math.min(MAX_DT, Math.max(0, dtSec)), opts);
    uniforms.uInteriorTime.value = m.time;
    uniforms.uInteriorSpin.value.set(m.spin[0], m.spin[1], m.spin[2]);
    uniforms.uInteriorLag.value.set(m.lag[0], m.lag[1], m.lag[2]);
    uniforms.uInteriorSwirl.value.set(m.swirl[0], m.swirl[1], m.swirl[2]);
    return m;
  },

  /**
   * DiceBox.#frame's one call per shown roll: isolates and steps every die of `roll` whose look
   * wants motion (and whose material carries the motion uniforms), with
   * factor = restFactor(now - roll.landedAt). True while any such die still moves (factor > 0),
   * so a lingering roll keeps the loop running until its insides come to rest.
   * DiceBox calls it unguarded: a throw warns once and stops all stepping (false from then on).
   */
  frame(box, roll, now) {
    if (failed) return false;
    try {
      return this.frameRoll(box, roll, now);
    } catch (err) {
      failed = true;
      console.warn('Dicer | living insides stopped', err);
      return false;
    }
  },

  /** frame()'s body. */
  frameRoll(box, roll, now) {
    if (roll.phase !== 'playing') roll.landedAt ??= now;
    const factor = restFactor(roll.landedAt == null ? null : now - roll.landedAt);
    let moving = false;
    stepOpts.reduced = prefersReduced();
    stepOpts.factor = factor;
    for (let d = 0; d < roll.dice.length; d++) {
      const die = roll.dice[d];
      if (!this.wants(die.appearance, roll.flags)) continue;
      let st = states.get(die);
      if (!st) {
        if (!die.inner?.material?.userData?.uniforms?.uInteriorTime) continue;
        const u = box.isolate(die);
        if (!u?.uInteriorTime) continue;
        stepOpts.flare = 0;
        this.step(die, u, worldQuat(die), 0, stepOpts);
        st = states.get(die);
      } else {
        // the die's inside flare (inside-flare.js) speeds glitter's swirl (motion.js)
        stepOpts.flare = st.u.uInteriorFlare?.value ?? 0;
        this.step(die, st.u, worldQuat(die), (now - st.last) / 1000, stepOpts);
      }
      st.last = now;
      if (factor > 0) moving = true;
    }
    return moving;
  },
};
