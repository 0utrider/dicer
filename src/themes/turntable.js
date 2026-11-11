// Pure motion model of the theme preview die: a slow turntable around a slightly tilted vertical
// axis, a drag that spins it by hand (with inertia that settles back to the slow turn) and a pitch
// that eases back to level. No three.js and no DOM: update(dt) returns {yaw, pitch, tilt}.
export const TURN_SECONDS = 8;
export const TILT = (12 * Math.PI) / 180;
const AUTO = (2 * Math.PI) / TURN_SECONDS;
const SPIN_SETTLE = 1.6; // 1/s: how fast a flung spin decays back to the slow turn
const PITCH_SETTLE = 2.4; // 1/s: how fast a dragged pitch eases back to level
const MAX_PITCH = (70 * Math.PI) / 180;
const DRAG_RAD_PER_PX = 0.012;
const MAX_SPIN = 14; // rad/s

export function createTurntable({ reducedMotion = false } = {}) {
  let yaw = 0;
  let pitch = 0;
  let omega = reducedMotion ? 0 : AUTO;
  let dragging = false;
  let lastMove = 0;
  const base = () => (reducedMotion ? 0 : AUTO);

  return {
    get dragging() {
      return dragging;
    },
    /** True while something is still moving (so the loop must keep drawing). */
    get moving() {
      return dragging || Math.abs(omega - base()) > 1e-3 || Math.abs(pitch) > 1e-3 || base() !== 0;
    },
    pose: () => ({ yaw, pitch, tilt: TILT }),
    set(next = {}) {
      if (Number.isFinite(next.yaw)) yaw = next.yaw;
      if (Number.isFinite(next.pitch)) pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, next.pitch));
    },
    grab() {
      dragging = true;
      omega = 0;
    },
    /** dx, dy in pixels, dt in seconds since the previous move. */
    drag(dx, dy, dt = 0.016) {
      if (!dragging) return;
      const d = dx * DRAG_RAD_PER_PX;
      yaw += d;
      pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch + dy * DRAG_RAD_PER_PX));
      const v = d / Math.max(dt, 0.008);
      omega = Math.max(-MAX_SPIN, Math.min(MAX_SPIN, 0.6 * omega + 0.4 * v));
      lastMove = 0;
    },
    release() {
      if (!dragging) return;
      dragging = false;
      if (reducedMotion || lastMove > 0.12) omega = base(); // held still before letting go: no fling
    },
    reset() {
      yaw = 0;
      pitch = 0;
      omega = base();
      dragging = false;
    },
    update(dt) {
      const step = Math.max(0, Math.min(dt, 0.1));
      if (dragging) {
        lastMove += step;
        if (lastMove > 0.12) omega = 0;
      } else {
        omega = base() + (omega - base()) * Math.exp(-SPIN_SETTLE * step);
        pitch *= reducedMotion ? 1 : Math.exp(-PITCH_SETTLE * step);
        yaw += omega * step;
      }
      return { yaw, pitch, tilt: TILT };
    },
  };
}
