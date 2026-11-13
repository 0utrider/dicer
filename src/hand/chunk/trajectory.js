/**
 * A recorded hand throw as a compact, JSON-safe payload (lazy hand chunk), and back (H-6, H-11):
 * every TRAJ_STRIDE-th frame is kept (positions int16 at 1/POS_SCALE die unit, rotations as
 * smallest-three: a 2-bit index plus 3 x int16), plus the final frame as raw float32, so the read
 * result is exact. Positions (dice and obstacle spots) are relative to the throw area's centre.
 * Binary sections are little-endian typed arrays in base64.
 */
import * as THREE from 'three';
import {
  CHUNK_STEPS,
  FLOATS_PER_DIE,
  IMPACT_FLOATS,
  MAX_FREE_STEPS,
  MAX_OBSTACLES,
} from '../../physics/protocol.js';
import { HULL_TYPES } from '../../physics/hulls.js';

export const TRAJ_STRIDE = 2;
/** Positions are stored in steps of 1/POS_SCALE die unit. */
export const POS_SCALE = 512;
/** The whole payload, as JSON (its base64 sections and the rest): the encoder gives null above it. */
export const MAX_TRAJECTORY_BYTES = 262144;
/** At most this many dice are decoded. */
export const MAX_REPLAY_DICE = 100;
/** H-11: a replay is never scaled below this (it may overrun a smaller area, kept on the stage). */
export const MIN_REPLAY_SCALE = 0.6;

const SHAPES = [...HULL_TYPES, 'd2'];
/** A smallest-three component lies in [-1/sqrt 2, 1/sqrt 2]. */
const ROT_SCALE = 32767 * Math.SQRT2;
/** A launched throw's frame 0 is the release state: one frame more than MAX_FREE_STEPS. */
const MAX_FRAMES = MAX_FREE_STEPS + 1;
const EVENT_BYTES = 6; // frame uint16, die int8, other int8, speed float16
const _q = [0, 0, 0, 1];

/** The payload's size as sent (JSON). */
export const trajectoryBytes = (payload) => JSON.stringify(payload).length;

const b64 = (u8) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000)
    s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const bytesOf = (a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
/** float -> IEEE half bits (round half up; tiny values flush to zero, huge ones clamp to max). */
function toHalf(v) {
  f32[0] = Math.min(Math.max(v, -65504), 65504);
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  const e = ((x >>> 23) & 0xff) - 112;
  if (e <= 0) return sign;
  const h = sign | (e << 10) | ((x & 0x7fffff) >>> 13);
  return x & 0x1000 ? h + 1 : h;
}
function fromHalf(h) {
  const e = (h >>> 10) & 0x1f;
  const m = h & 0x3ff;
  const v =
    e === 0 ? m * 2 ** -24 : e === 31 ? (m ? NaN : Infinity) : (1 + m / 1024) * 2 ** (e - 15);
  return h & 0x8000 ? -v : v;
}

/**
 * The kept frames before the final one, in order: 0, stride, 2 stride, ... (< steps - 1) and the
 * `extra` frames (off the grid, where the stride's interpolation would err: a bounce).
 */
function keptFrames(steps, stride, extra) {
  const out = [];
  for (let f = 0, e = 0; f < steps - 1; f++) {
    if (f % stride === 0) out.push(f);
    else if (extra[e] === f) out.push(extra[e++]);
  }
  return out;
}

/** The largest position (max |axis|) and rotation (rad) error of frame f against a..b's interpolation. */
function lerpError(frames, fpf, a, b, f) {
  const t = (f - a) / (b - a);
  let pos = 0;
  let rot = 0;
  for (let o = 0; o < fpf; o += FLOATS_PER_DIE) {
    const [oa, ob, of] = [a * fpf + o, b * fpf + o, f * fpf + o];
    for (let c = 0; c < 3; c++) {
      pos = Math.max(
        pos,
        Math.abs(frames[oa + c] + (frames[ob + c] - frames[oa + c]) * t - frames[of + c]),
      );
    }
    THREE.Quaternion.slerpFlat(_q, 0, frames, oa + 3, frames, ob + 3, t);
    const dot = Math.abs(_q.reduce((s, v, c) => s + v * frames[of + 3 + c], 0));
    rot = Math.max(rot, 2 * Math.acos(Math.min(1, dot)));
  }
  return [pos, rot];
}

/**
 * R6: frames between kept ones are rebuilt within 0.05 die units. The encoder keeps a frame off the
 * stride's grid wherever its interpolation would miss by more than LERP_POS (leaving room for the
 * 1/1024 rounding) or turn by more than LERP_ROT (a bounce or a fast spin).
 */
const LERP_POS = 0.045;
const LERP_ROT = (10 * Math.PI) / 180;

/**
 * @param {object} rec DiceBox's recording ({chunks, events, settledStep, dice: [{shapeType, key}],
 *   area: {cx, cz, halfWidth, halfDepth}, obstacles: [{id, x, z, r, h}], splatSpeed, edge, hand}).
 * @param {{values: (number|null)[], maxBytes?: number}} opts `values`: the throw's read results
 *   (DiceBox.roll's `values`).
 * @returns {object|null} the payload ({v: 1, n, steps, stride, extra, area, settledStep, values,
 *   keys, shapes, obstacles, splatSpeed, edge, hand, pos, rot, last, events}), or null when it would
 *   be larger than `maxBytes` (or the recording is unusable). `extra`: the frames kept off the
 *   stride's grid (bounces; see LERP_POS). `pos` / `rot` hold the kept frames in order, `last` the
 *   final one; `events` 6 bytes each: frame uint16, die int8, other int8 (-3 - i kept), speed
 *   float16.
 */
export function encodeTrajectory(rec, { values, maxBytes = MAX_TRAJECTORY_BYTES } = {}) {
  const n = rec?.dice?.length ?? 0;
  const fpf = n * FLOATS_PER_DIE;
  const total = (rec?.chunks ?? []).reduce((s, c) => s + c.length, 0);
  if (!n || !total || total % fpf) return null;
  const frames = new Float32Array(total);
  let at = 0;
  for (const c of rec.chunks) {
    frames.set(c, at);
    at += c.length;
  }
  const steps = total / fpf;
  const { cx = 0, cz = 0, halfWidth, halfDepth } = rec.area;
  // Off-grid frames to keep: every frame between two grid anchors when any of them would err.
  const extra = [];
  for (let a = 0; a < steps - 1; a += TRAJ_STRIDE) {
    const b = Math.min(a + TRAJ_STRIDE, steps - 1);
    const between = [];
    for (let f = a + 1; f < b; f++) between.push(f);
    if (
      between.some((f) => {
        const [p, r] = lerpError(frames, fpf, a, b, f);
        return p > LERP_POS || r > LERP_ROT;
      })
    )
      extra.push(...between);
  }
  const keptList = keptFrames(steps, TRAJ_STRIDE, extra);
  const kept = keptList.length;
  const count = kept * n;
  const pos = new Int16Array(count * 3);
  const rotBuf = new ArrayBuffer(count * 6 + Math.ceil(count / 4));
  const rot = new Int16Array(rotBuf, 0, count * 3);
  const idx = new Uint8Array(rotBuf, count * 6);
  const q16 = (v, k) => Math.max(-32767, Math.min(32767, Math.round(v * k)));
  for (let k = 0; k < kept; k++) {
    for (let d = 0; d < n; d++) {
      const o = keptList[k] * fpf + d * FLOATS_PER_DIE;
      const p = (k * n + d) * 3;
      pos[p] = q16(frames[o] - cx, POS_SCALE);
      pos[p + 1] = q16(frames[o + 1], POS_SCALE);
      pos[p + 2] = q16(frames[o + 2] - cz, POS_SCALE);
      // Smallest three: drop the largest component (made positive), keep the other three.
      let big = 0;
      for (let c = 1; c < 4; c++)
        if (Math.abs(frames[o + 3 + c]) > Math.abs(frames[o + 3 + big])) big = c;
      const sign = frames[o + 3 + big] < 0 ? -1 : 1;
      for (let c = 0, j = 0; c < 4; c++)
        if (c !== big) rot[p + j++] = q16(sign * frames[o + 3 + c], ROT_SCALE);
      idx[(k * n + d) >> 2] |= big << (((k * n + d) & 3) * 2);
    }
  }
  const last = frames.slice(total - fpf);
  for (let d = 0; d < n; d++) {
    last[d * FLOATS_PER_DIE] -= cx;
    last[d * FLOATS_PER_DIE + 2] -= cz;
  }
  const ev = rec.events ?? new Float32Array(0);
  const events = new DataView(new ArrayBuffer(Math.floor(ev.length / IMPACT_FLOATS) * EVENT_BYTES));
  for (let i = 0, b = 0; i + IMPACT_FLOATS <= ev.length; i += IMPACT_FLOATS, b += EVENT_BYTES) {
    events.setUint16(b, ev[i], true);
    events.setInt8(b + 2, ev[i + 1]);
    events.setInt8(b + 3, ev[i + 2]); // other: a die, -1 floor, -2 wall, -3 - i obstacle i
    events.setUint16(b + 4, toHalf(ev[i + 3]), true);
  }
  const payload = {
    v: 1,
    n,
    steps,
    stride: TRAJ_STRIDE,
    extra,
    area: { halfWidth, halfDepth },
    settledStep: Number.isInteger(rec.settledStep) ? rec.settledStep : steps - 1,
    values: Array.from({ length: n }, (_, i) => values?.[i] ?? null),
    keys: rec.dice.map((d) => (typeof d.key === 'string' ? d.key : null)),
    shapes: rec.dice.map((d) => d.shapeType),
    obstacles: (rec.obstacles ?? []).map(({ id, x, z, r, h }) => ({
      id,
      x: x - cx,
      z: z - cz,
      r,
      h,
    })),
    splatSpeed: rec.splatSpeed ?? null,
    edge: [0, 1, 2, 3].includes(rec.edge) ? rec.edge : 0,
    hand: rec.hand !== false,
    pos: b64(bytesOf(pos)),
    rot: b64(new Uint8Array(rotBuf)),
    last: b64(bytesOf(last)),
    events: b64(new Uint8Array(events.buffer)),
  };
  return trajectoryBytes(payload) > maxBytes ? null : payload;
}

const isNum = Number.isFinite;
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/**
 * The frames and events of a payload, or null for anything malformed (types, lengths, NaN,
 * counts) or larger than `maxBytes`. Frames between kept ones are rebuilt by lerp / slerp; the
 * final frame is the recorded one. Positions stay relative to the area centre (placeTrajectory).
 * @returns {{n, chunks: Float32Array[], events: Float32Array, settledStep, values, keys, shapes,
 *   obstacles, splatSpeed, edge, hand, area: {cx: 0, cz: 0, halfWidth, halfDepth}} | null}
 */
export function decodeTrajectory(
  payload,
  { maxDice = MAX_REPLAY_DICE, maxBytes = MAX_TRAJECTORY_BYTES } = {},
) {
  try {
    return decode(payload, maxDice, maxBytes);
  } catch {
    return null;
  }
}

function decode(p, maxDice, maxBytes) {
  if (!p || typeof p !== 'object' || p.v !== 1) return null;
  const { n, steps, stride, area, settledStep, values, keys, shapes, obstacles, splatSpeed } = p;
  if (!isInt(n, 1, maxDice) || !isInt(steps, 1, MAX_FRAMES) || !isInt(stride, 1, CHUNK_STEPS))
    return null;
  // settledStep: the sim's step count at rest (the frame count, or one less for a launched throw)
  if (!isInt(settledStep, 0, steps) || !isInt(p.edge, 0, 3) || typeof p.hand !== 'boolean')
    return null;
  if (!(
    area?.halfWidth > 0 &&
    area.halfDepth > 0 &&
    isNum(area.halfWidth) &&
    isNum(area.halfDepth)
  ))
    return null;
  const list = (a, ok) => Array.isArray(a) && a.length === n && a.every(ok);
  if (!list(values, (v) => v === null || isNum(v))) return null;
  if (!list(keys, (k) => k === null || typeof k === 'string')) return null;
  if (!list(shapes, (s) => SHAPES.includes(s))) return null;
  if (!Array.isArray(obstacles) || obstacles.length > MAX_OBSTACLES) return null;
  const spots = obstacles.map((o) => ({ id: o?.id, x: o?.x, z: o?.z, r: o?.r, h: o?.h }));
  if (!spots.every((o) => typeof o.id === 'string' && [o.x, o.z, o.r, o.h].every(isNum)))
    return null;
  if (splatSpeed !== null && !(isNum(splatSpeed) && splatSpeed > 0)) return null;
  if (![p.pos, p.rot, p.last, p.events].every((s) => typeof s === 'string')) return null;
  // extra: increasing frames off the grid, before the final one
  const extra = p.extra;
  if (!Array.isArray(extra) || extra.length >= steps) return null;
  if (!extra.every((f, i) => isInt(f, 1, steps - 2) && f % stride && !(f <= extra[i - 1])))
    return null;
  if (trajectoryBytes(p) > maxBytes) return null;

  const fpf = n * FLOATS_PER_DIE;
  const keptList = keptFrames(steps, stride, extra);
  const kept = keptList.length;
  const count = kept * n;
  const posBytes = unb64(p.pos);
  const rotBytes = unb64(p.rot);
  const lastBytes = unb64(p.last);
  const evBytes = unb64(p.events);
  if (posBytes.length !== count * 6 || rotBytes.length !== count * 6 + Math.ceil(count / 4))
    return null;
  if (lastBytes.length !== fpf * 4 || evBytes.length % EVENT_BYTES) return null;
  const pos = new Int16Array(posBytes.buffer, 0, count * 3);
  const rot = new Int16Array(rotBytes.buffer, 0, count * 3);
  const idx = new Uint8Array(rotBytes.buffer, count * 6);
  const last = new Float32Array(lastBytes.buffer);
  if (!last.every(isNum)) return null;

  // Anchors: the kept frames, then the final one.
  const anchors = new Float32Array((kept + 1) * fpf);
  for (let k = 0; k < kept; k++) {
    for (let d = 0; d < n; d++) {
      const i = k * n + d;
      const o = (k * n + d) * FLOATS_PER_DIE;
      anchors[o] = pos[i * 3] / POS_SCALE;
      anchors[o + 1] = pos[i * 3 + 1] / POS_SCALE;
      anchors[o + 2] = pos[i * 3 + 2] / POS_SCALE;
      const big = (idx[i >> 2] >> ((i & 3) * 2)) & 3;
      let sum = 0;
      for (let c = 0, j = 0; c < 4; c++) {
        if (c === big) continue;
        const v = rot[i * 3 + j++] / ROT_SCALE;
        anchors[o + 3 + c] = v;
        sum += v * v;
      }
      anchors[o + 3 + big] = Math.sqrt(Math.max(0, 1 - sum));
    }
  }
  anchors.set(last, kept * fpf);
  keptList.push(steps - 1); // anchor k is frame keptList[k]

  const frames = new Float32Array(steps * fpf);
  for (let f = 0, k0 = 0; f < steps; f++) {
    while (k0 < kept && keptList[k0 + 1] <= f) k0++;
    const k1 = Math.min(k0 + 1, kept);
    const a = keptList[k0];
    const t = k1 === k0 ? 0 : (f - a) / (keptList[k1] - a);
    for (let d = 0; d < n; d++) {
      const o0 = k0 * fpf + d * FLOATS_PER_DIE;
      const o1 = k1 * fpf + d * FLOATS_PER_DIE;
      const o = f * fpf + d * FLOATS_PER_DIE;
      for (let c = 0; c < 3; c++)
        frames[o + c] = anchors[o0 + c] + (anchors[o1 + c] - anchors[o0 + c]) * t;
      THREE.Quaternion.slerpFlat(_q, 0, anchors, o0 + 3, anchors, o1 + 3, t);
      frames.set(_q, o + 3);
    }
  }
  const chunks = [];
  for (let f = 0; f < steps; f += CHUNK_STEPS)
    chunks.push(frames.slice(f * fpf, Math.min(steps, f + CHUNK_STEPS) * fpf));

  const view = new DataView(evBytes.buffer);
  const ne = evBytes.length / EVENT_BYTES;
  const events = new Float32Array(ne * IMPACT_FLOATS);
  for (let i = 0; i < ne; i++) {
    const b = i * EVENT_BYTES;
    const frame = view.getUint16(b, true);
    const die = view.getInt8(b + 2);
    const other = view.getInt8(b + 3);
    const speed = fromHalf(view.getUint16(b + 4, true));
    // other: a die, -1 floor, -2 wall, -3 - i a listed obstacle
    if (frame >= steps || die < 0 || die >= n || other >= n || other < -2 - obstacles.length)
      return null;
    if (!isNum(speed)) return null;
    events.set([frame, die, other, speed], i * IMPACT_FLOATS);
  }
  return {
    n,
    chunks,
    events,
    settledStep,
    values: [...values],
    keys: [...keys],
    shapes: [...shapes],
    obstacles: spots,
    splatSpeed,
    edge: p.edge,
    hand: p.hand,
    area: { cx: 0, cz: 0, halfWidth: area.halfWidth, halfDepth: area.halfDepth },
  };
}

/**
 * H-11: a decoded throw moved into `target` (die units, {cx, cz, halfWidth, halfDepth}: DiceBox's
 * dieArea for the roller's area, grown for the dice): positions relative to the centre are scaled
 * by s = min(1, rw / tw, rd / td) on both horizontal axes, floored at MIN_REPLAY_SCALE, then
 * offset to the target's centre. Heights and die sizes are kept; obstacle spots move alike. With
 * `stage` ({halfWidth, halfDepth}), the centre is clamped so the scaled area stays on the stage.
 * Returns a new decoded throw with `scale` and its placed `area`; the input is not changed.
 */
export function placeTrajectory(decoded, target, stage) {
  const { halfWidth: tw, halfDepth: td } = decoded.area;
  const s = Math.max(MIN_REPLAY_SCALE, Math.min(1, target.halfWidth / tw, target.halfDepth / td));
  const fit = (c, half, lim) => {
    const room = lim - half * s;
    return room >= 0 ? Math.min(Math.max(c, -room), room) : 0;
  };
  const x0 = stage ? fit(target.cx ?? 0, tw, stage.halfWidth) : (target.cx ?? 0);
  const z0 = stage ? fit(target.cz ?? 0, td, stage.halfDepth) : (target.cz ?? 0);
  const chunks = decoded.chunks.map((c) => {
    const out = c.slice();
    for (let o = 0; o < out.length; o += FLOATS_PER_DIE) {
      out[o] = x0 + out[o] * s;
      out[o + 2] = z0 + out[o + 2] * s;
    }
    return out;
  });
  return {
    ...decoded,
    chunks,
    obstacles: decoded.obstacles.map((o) => ({ ...o, x: x0 + o.x * s, z: z0 + o.z * s })),
    area: { cx: x0, cz: z0, halfWidth: tw * s, halfDepth: td * s },
    scale: s,
  };
}

/**
 * A DiceBox.roll `source` (`{source, free: true}`) that plays a decoded (and placed) throw: its
 * frames as physics-like chunks, all impacts with the first, done with the recorded settledStep;
 * impacts -3 - i hit obstacleIds[i] (the recorded pets' owners).
 */
export function replaySource(decoded) {
  const { chunks, events, n } = decoded;
  return {
    onChunk(cb) {
      chunks.forEach((data, index) =>
        cb({
          index,
          steps: data.length / (n * FLOATS_PER_DIE),
          data,
          events: index ? new Float32Array(0) : events,
          done: index === chunks.length - 1,
        }),
      );
    },
    done: Promise.resolve({ settledStep: decoded.settledStep, nudges: [] }),
    obstacleIds: decoded.obstacles.map((o) => o.id),
  };
}
