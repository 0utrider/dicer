import * as THREE from 'three';
import { createMotion, stepMotion, restFactor } from './motion.js';

/**
 * Living insides: per-die motion state and its four uniforms (the look-extras chunk side of the
 * insideMotion wiring; DiceBox reaches it through getLookExtras() only).
 *
 * - uInteriorTime (float): seconds since the die's roll first drew, scaled by the motion factor;
 * - uInteriorSpin (vec3): the die's smoothed angular velocity, canonical (die-local) frame;
 * - uInteriorLag (vec3, unit): a damped spring chasing world up in the die-local frame;
 * - uInteriorFlare (float 0..1): written by inside flares, never here.
 */
export const MOTION_PARS = [
  'uniform float uInteriorTime;',
  'uniform vec3 uInteriorSpin;',
  'uniform vec3 uInteriorLag;',
  'uniform float uInteriorFlare;',
].join('\n');

/** Fresh motion uniforms at their defaults. */
export const motionUniforms = () => ({
  uInteriorTime: { value: 0 },
  uInteriorSpin: { value: new THREE.Vector3(0, 0, 0) },
  uInteriorLag: { value: new THREE.Vector3(0, 1, 0) },
  uInteriorFlare: { value: 0 },
});

/** Longest step one frame may take: a paused tab must not mean hundreds of spring substeps. */
const MAX_DT = 0.1;

let reduced = null;
/** prefers-reduced-motion, read once (false where matchMedia is missing). */
function prefersReduced() {
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

// die -> { m: motion state, u: the die's isolated uniforms, last: ms of its last step }
const states = new WeakMap();
// the inner mesh's world rotation (outer x inner), reused every frame
const quat = { x: 0, y: 0, z: 0, w: 1 };

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
    return m;
  },

  /**
   * DiceBox.#frame's one call per shown roll: isolates and steps every die of `roll` whose look
   * wants motion (and whose material carries the motion uniforms), with
   * factor = restFactor(now - roll.landedAt). True while any such die still moves (factor > 0),
   * so a lingering roll keeps the loop running until its insides come to rest.
   */
  frame(box, roll, now) {
    if (roll.phase !== 'playing') roll.landedAt ??= now;
    const factor = restFactor(roll.landedAt == null ? null : now - roll.landedAt);
    let moving = false;
    for (const die of roll.dice) {
      if (!this.wants(die.appearance, roll.flags)) continue;
      let st = states.get(die);
      if (!st) {
        if (!die.inner?.material?.userData?.uniforms?.uInteriorTime) continue;
        const u = box.isolate(die);
        if (!u?.uInteriorTime) continue;
        this.step(die, u, worldQuat(die), 0, { reduced: prefersReduced(), factor });
        st = states.get(die);
      } else {
        this.step(die, st.u, worldQuat(die), (now - st.last) / 1000, { reduced: prefersReduced(), factor });
      }
      st.last = now;
      if (factor > 0) moving = true;
    }
    return moving;
  },
};
