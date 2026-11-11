import * as THREE from 'three';
import { FLOATS_PER_DIE, IMPACT_FLOATS, STEP_SECONDS } from '../physics/protocol.js';
import { readTopFace, rotationToShow, faceForValue } from '../core/face-reader.js';

const _q = [0, 0, 0, 1];
/** Slow motion: playhead steps over which the speed eases down to the held slow speed. */
export const RAMP_STEPS = 30;
export const SLOW_SPEED = 0.35;

/**
 * Consumes streamed frame chunks and moves the dice. No die is drawn inside the roll area
 * until the final chunk has arrived and the result rotation has been applied.
 */
export class Playback {
  constructor({ dice, area, speed = 1 }) {
    this.dice = dice;
    this.area = area;
    this.speed = speed;
    this.resultsApplied = false;
    this._chunks = []; // chunk.data arrays, exactly as pushed
    this._starts = []; // first frame index of each chunk
    this._frames = 0;
    this._firstInside = -1; // first frame with any die inside the area
    this._playhead = 0;
    this._events = []; // [frame, die, other, speed], in frame order across pushes
    this._eventCursor = 0; // next event not yet handed out
    this._playing = false; // last update() returned 'playing'
    this._lastMs = undefined;
    this._landed = false;
    this._ramp = null; // { start, from, to }: slow motion (setSpeedRamp)
  }

  /**
   * Slow motion for this client only: the speed eases (smoothstep) from 1 to `toSpeed` over the
   * RAMP_STEPS playhead steps before `fromStep`, then holds until landing. Multiplies `speed`.
   */
  setSpeedRamp({ fromStep, toSpeed = SLOW_SPEED }) {
    if (!Number.isFinite(fromStep) || !(toSpeed > 0)) return;
    this._ramp = { start: fromStep - RAMP_STEPS, from: fromStep, to: Math.min(1, toSpeed) };
  }

  /** The ramp's speed factor at playhead `ph` (1 without a ramp). */
  speedAt(ph) {
    const r = this._ramp;
    if (!r || ph <= r.start) return 1;
    if (ph >= r.from) return r.to;
    const t = (ph - r.start) / RAMP_STEPS;
    return 1 + (r.to - 1) * t * t * (3 - 2 * t);
  }

  /**
   * Playback time (ms) to reach playhead `steps`, at `speed` and through the ramp. The eased
   * part is counted at the held speed, so this never undershoots (the landing watchdog).
   */
  durationMs(steps) {
    const r = this._ramp;
    let t = steps;
    if (r) {
      const fast = Math.min(steps, Math.max(0, r.start));
      t = fast + (steps - fast) / r.to;
    }
    return (t * STEP_SECONDS * 1000) / (this.speed || 1);
  }

  /** The playhead after `t` steps of time at speed 1 from `ph`, through the ramp. */
  _advance(ph, t) {
    const r = this._ramp;
    if (!r) return ph + t;
    // Bounded: at most one playhead step per pass inside the ramp (RAMP_STEPS + 2 passes).
    while (t > 1e-9) {
      if (ph < r.start) {
        const left = r.start - ph;
        const d = Math.min(left, t);
        ph = d === left ? r.start : ph + d;
        t -= d;
      } else if (ph >= r.from) {
        return ph + t * r.to;
      } else {
        const v = this.speedAt(ph);
        const left = r.from - ph;
        const d = Math.min(t * v, 1, left);
        ph = d === left ? r.from : ph + d; // exact, so the next pass is the held range
        t -= d / v;
      }
    }
    return ph;
  }

  get landed() {
    return this._landed;
  }

  /** Frames pushed so far (the last one is the settled frame once the final chunk is in). */
  get frames() {
    return this._frames;
  }

  push(chunk) {
    const stride = this.dice.length * FLOATS_PER_DIE;
    const base = this._frames;
    this._starts.push(base);
    this._chunks.push(chunk.data);
    this._frames += chunk.steps;
    if (this._firstInside < 0) {
      for (let s = 0; s < chunk.steps; s++) {
        if (this._anyInside(chunk.data, s * stride)) {
          this._firstInside = base + s;
          break;
        }
      }
    }
    const ev = chunk.events;
    if (ev) {
      for (let i = 0; i + IMPACT_FLOATS <= ev.length; i += IMPACT_FLOATS) {
        this._events.push([ev[i], ev[i + 1], ev[i + 2], ev[i + 3]]);
      }
    }
    if (chunk.done) this._applyResults(chunk.data, (chunk.steps - 1) * stride);
  }

  _anyInside(data, offset) {
    const { halfWidth, halfDepth } = this.area;
    for (let d = 0; d < this.dice.length; d++) {
      const o = offset + d * FLOATS_PER_DIE;
      if (Math.abs(data[o]) < halfWidth && Math.abs(data[o + 2]) < halfDepth) return true;
    }
    return false;
  }

  _applyResults(data, offset) {
    this.dice.forEach((die, d) => {
      const o = offset + d * FLOATS_PER_DIE;
      const q = { x: data[o + 3], y: data[o + 4], z: data[o + 5], w: data[o + 6] };
      const landed = readTopFace(die.shape, q);
      const target = faceForValue(die.shape, die.targetValue);
      const r = rotationToShow(die.shape, landed, target);
      die.inner.quaternion.set(r.x, r.y, r.z, r.w);
      // A model die: its model rotation first, then the face-forcing one.
      if (die.modelQuat) die.inner.quaternion.multiply(die.modelQuat);
    });
    this.resultsApplied = true;
  }

  /** Returns [data, offset] of frame f within the pushed chunk arrays. */
  _locate(f) {
    const stride = this.dice.length * FLOATS_PER_DIE;
    let c = this._starts.length - 1;
    while (c > 0 && this._starts[c] > f) c--;
    return [this._chunks[c], (f - this._starts[c]) * stride];
  }

  _place(playhead) {
    const last = this._frames - 1;
    const i0 = Math.min(Math.floor(playhead), last);
    const i1 = Math.min(i0 + 1, last);
    const t = i1 === i0 ? 0 : playhead - i0;
    const [d0, o0] = this._locate(i0);
    const [d1, o1] = this._locate(i1);
    this.dice.forEach((die, d) => {
      const a = o0 + d * FLOATS_PER_DIE;
      const b = o1 + d * FLOATS_PER_DIE;
      die.outer.position.set(
        d0[a] + (d1[b] - d0[a]) * t,
        d0[a + 1] + (d1[b + 1] - d0[a + 1]) * t,
        d0[a + 2] + (d1[b + 2] - d0[a + 2]) * t,
      );
      THREE.Quaternion.slerpFlat(_q, 0, d0, a + 3, d1, b + 3, t);
      die.outer.quaternion.fromArray(_q);
    });
  }

  update(nowMs) {
    if (this._frames === 0) return 'waiting';
    if (this._lastMs === undefined) this._lastMs = nowMs;
    const dt = Math.max(0, nowMs - this._lastMs) / 1000;
    this._lastMs = nowMs;
    const last = this._frames - 1;
    let limit = last;
    if (!this.resultsApplied && this._firstInside >= 0) {
      limit = Math.max(0, this._firstInside - 1);
    }
    let ph = this._advance(this._playhead, (dt * this.speed) / STEP_SECONDS);
    let state = 'playing';
    if (ph >= limit) {
      ph = limit;
      if (this.resultsApplied && limit === last) {
        state = 'landed';
        this._landed = true;
      } else {
        state = 'waiting';
      }
    }
    this._playhead = ph;
    this._place(ph);
    this._playing = state === 'playing';
    return state;
  }

  /**
   * Impact events whose frame the playhead crossed since the last call. Only while the last
   * update() was 'playing'; events before the dice entered the area are dropped silently.
   */
  takeEvents() {
    if (!this._playing) return [];
    const out = [];
    const ev = this._events;
    while (this._eventCursor < ev.length && ev[this._eventCursor][0] <= this._playhead) {
      const [frame, die, other, speed] = ev[this._eventCursor++];
      if (frame >= this._firstInside) out.push({ die, other, speed });
    }
    return out;
  }

  release() {
    return this._chunks.slice();
  }
}
