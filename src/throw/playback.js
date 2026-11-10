import * as THREE from 'three';
import { FLOATS_PER_DIE, STEP_SECONDS } from '../physics/protocol.js';
import { readTopFace, rotationToShow, faceForValue } from '../core/face-reader.js';

const _q = [0, 0, 0, 1];

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
    this._lastMs = undefined;
    this._landed = false;
  }

  get landed() {
    return this._landed;
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
    let ph = this._playhead + (dt * this.speed) / STEP_SECONDS;
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
    return state;
  }

  release() {
    return this._chunks.slice();
  }
}
