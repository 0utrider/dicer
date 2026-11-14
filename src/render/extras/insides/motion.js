// Living-insides motion math: pure, no three import. Quaternions are {x,y,z,w}.
export const SLOSH = Object.freeze({ omega: 13.5, zeta: 0.5 });
export const REST_EASE = Object.freeze({ from: 8000, to: 10000 });
export const SPIN_TAU = 0.15;
// glitter swirl: rotation vector += dt x rate x (1 + flare x the inside flare) x (rest x local up + spin x spin), rad
export const SWIRL = Object.freeze({ rest: 0.15, spin: 0.08, flare: 4 });

const REDUCED_RATE = 0.25;
const MAX_SUBSTEP = 1 / 120;

export function createMotion() {
  return { time: 0, spin: [0, 0, 0], lag: [0, 1, 0], lagVel: [0, 0, 0], swirl: [0, 0, 0], prevQuat: null };
}

// scratch vectors: stepMotion allocates nothing per call
const UP_AXIS = [0, 1, 0];
const _up = [0, 0, 0];
const _raw = [0, 0, 0];
const _om = [0, 0, 0];

// Rotate v by the inverse of unit quaternion q (world -> die-local), into out.
function rotateInv(q, v, out) {
  const x = -q.x, y = -q.y, z = -q.z, w = q.w;
  // t = 2 * cross(qv, v); v' = v + w*t + cross(qv, t)
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  out[0] = v[0] + w * tx + (y * tz - z * ty);
  out[1] = v[1] + w * ty + (z * tx - x * tz);
  out[2] = v[2] + w * tz + (x * ty - y * tx);
  return out;
}

// World-frame angular velocity (rad/s) turning prev into cur over dt, into out.
function worldOmega(prev, cur, dt, out) {
  // dq = cur * conj(prev)
  const px = -prev.x, py = -prev.y, pz = -prev.z, pw = prev.w;
  let w = cur.w * pw - cur.x * px - cur.y * py - cur.z * pz;
  let x = cur.w * px + cur.x * pw + cur.y * pz - cur.z * py;
  let y = cur.w * py - cur.x * pz + cur.y * pw + cur.z * px;
  let z = cur.w * pz + cur.x * py - cur.y * px + cur.z * pw;
  if (w < 0) { w = -w; x = -x; y = -y; z = -z; } // shortest arc
  const s = Math.hypot(x, y, z);
  if (s < 1e-9) { out[0] = out[1] = out[2] = 0; return out; }
  const k = (2 * Math.atan2(s, w)) / s / dt;
  out[0] = x * k; out[1] = y * k; out[2] = z * k;
  return out;
}

const NO_OPTS = Object.freeze({});

export function stepMotion(state, quat, dtSec, opts = NO_OPTS) {
  const reduced = opts.reduced ?? false;
  const factor = opts.factor ?? 1;
  const rate = factor * (reduced ? REDUCED_RATE : 1);
  const up = rotateInv(quat, UP_AXIS, _up);
  state.time += dtSec * rate;

  if (!state.prevQuat) {
    state.spin[0] = state.spin[1] = state.spin[2] = 0;
    state.lag[0] = up[0]; state.lag[1] = up[1]; state.lag[2] = up[2];
    state.lagVel[0] = state.lagVel[1] = state.lagVel[2] = 0;
  } else if (dtSec > 0) {
    const raw = rotateInv(quat, worldOmega(state.prevQuat, quat, dtSec, _om), _raw);
    const a = 1 - Math.exp(-dtSec / SPIN_TAU);
    for (let i = 0; i < 3; i++) state.spin[i] += (raw[i] * rate - state.spin[i]) * a;
    // integrated, so it only ever slows when the spin dies (no unwind) and stops at rate 0; an
    // inside flare (0..1) speeds it x (1 + 4 flare): the glitter scatters, and never jumps back
    const sw = dtSec * rate * (1 + SWIRL.flare * (opts.flare ?? 0));
    for (let i = 0; i < 3; i++) state.swirl[i] += sw * (SWIRL.rest * up[i] + SWIRL.spin * state.spin[i]);

    const omega = reduced ? SLOSH.omega * REDUCED_RATE : SLOSH.omega;
    const damp = 2 * SLOSH.zeta * omega;
    const n = Math.max(1, Math.ceil(dtSec / MAX_SUBSTEP));
    const h = dtSec / n;
    const lag = state.lag, vel = state.lagVel;
    for (let s = 0; s < n; s++) {
      for (let i = 0; i < 3; i++) {
        vel[i] += (-omega * omega * (lag[i] - up[i]) - damp * vel[i]) * h;
        lag[i] += vel[i] * h;
      }
    }
    const len = Math.hypot(lag[0], lag[1], lag[2]);
    if (len > 1e-9) { lag[0] /= len; lag[1] /= len; lag[2] /= len; } else { lag[0] = up[0]; lag[1] = up[1]; lag[2] = up[2]; }
  }

  const p = state.prevQuat || (state.prevQuat = { x: 0, y: 0, z: 0, w: 1 });
  p.x = quat.x; p.y = quat.y; p.z = quat.z; p.w = quat.w;
  return state;
}

// 1 until REST_EASE.from ms after landing, smoothstep to 0 at REST_EASE.to; 1 when not landed.
export function restFactor(msSinceLanded) {
  if (msSinceLanded == null) return 1;
  const { from, to } = REST_EASE;
  const t = Math.min(1, Math.max(0, (msSinceLanded - from) / (to - from)));
  return 1 - t * t * (3 - 2 * t);
}
