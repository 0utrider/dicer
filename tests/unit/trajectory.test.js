import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { DiceBox } from '../../src/throw/dice-box.js';
import { buildScene } from '../../src/render/scene.js';
import { parseAtlas } from '../../src/render/sdf-atlas.js';
import { getShape } from '../../src/core/dice-shapes.js';
import { readResult } from '../../src/core/physical-read.js';
import { createSim, initPhysics, prewarm } from '../../src/physics/sim.js';
import { computeHulls } from '../../src/physics/hulls.js';
import { computeReaders } from '../../src/physics/readers.js';
import { FLOATS_PER_DIE } from '../../src/physics/protocol.js';
import {
  handFor,
  encodeTrajectory,
  decodeTrajectory,
  placeTrajectory,
  replaySource,
  trajectoryBytes,
  MAX_TRAJECTORY_BYTES,
  MIN_REPLAY_SCALE,
  TRAJ_STRIDE,
} from '../../src/hand/hand.js';

const atlas = {
  ...parseAtlas(JSON.parse(readFileSync('assets/fonts/digits.json', 'utf8'))),
  texture: new THREE.Texture(),
};
const appearance = { body: 'opaque', bodyColor: '#fff', fillColor: '#000', fillMetallic: false };
// 1440 x 720 px at 48 px per die: the stage is 15 x 7.5 half extents.
const RECT = { left: 0, top: 0, width: 1440, height: 720 };
const hulls = computeHulls();

beforeAll(async () => {
  await initPhysics(
    readFileSync('node_modules/@dimforge/rapier3d-deterministic/rapier_wasm3d_bg.wasm'),
  );
  const s = createSim({ halfWidth: 15, halfDepth: 7.5 }, hulls);
  prewarm(s, [...Object.keys(hulls), 'd2']);
  s.dispose();
});

/** The real sim behind a PhysicsClient-like face (synchronous chunks); readers come by setReaders. */
function simPhysics() {
  const sim = createSim({ halfWidth: 15, halfDepth: 7.5 }, hulls);
  const physics = {
    throws: 0,
    resize: (a) => sim.resize(a),
    recycle: () => {},
    setReaders: vi.fn((r) => sim.setReaders(r)),
    throw(req) {
      physics.throws += 1;
      const chunks = [];
      const res = sim.throw(req, (c) =>
        chunks.push({ ...c, data: c.data.slice(), events: c.events.slice() }),
      );
      return { onChunk: (cb) => chunks.forEach((c) => cb(c)), done: Promise.resolve(res) };
    },
  };
  return physics;
}

function fakeRenderer() {
  const sceneApi = buildScene();
  const r = {
    sceneApi,
    scene: sceneApi.scene,
    camera: sceneApi.camera,
    canvas: { style: { transform: '' } },
    setArea: () => {},
    startLoop: (t) => (r.tickFn = t),
    hide: () => (r.tickFn = null),
    tickFn: null,
    tick(ms) {
      if (!r.tickFn) return false;
      const again = r.tickFn(ms);
      if (!again) r.hide();
      return again;
    },
  };
  return r;
}

function makeBox(physics = simPhysics(), rect = RECT) {
  const renderer = fakeRenderer();
  const box = new DiceBox({ renderer, physics, atlas, appearance, getArea: () => rect });
  handFor(box);
  return { box, renderer, physics };
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
const d6s = (n) => Array.from({ length: n }, (_, i) => ({ type: 'd6', value: 1, key: `0:${i}:0` }));

/** A free throw recorded through DiceBox on the real sim: {rec, values}. */
async function recordThrow(specs, opts = {}) {
  const { box, renderer } = makeBox();
  let rec = null;
  const r = box.roll(specs, { free: true, seed: 11, record: (x) => (rec = x), ...opts });
  await flush();
  renderer.tick(0);
  renderer.tick(100000);
  const values = await r.values;
  box.clear();
  return { rec, values, edge: r.handle.edge };
}

/** All frames of `chunks` as one array. */
const framesOf = (chunks) => {
  const out = new Float32Array(chunks.reduce((s, c) => s + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
};
const angle = (a, o, b, p) => {
  const dot = Math.abs(
    a[o] * b[p] + a[o + 1] * b[p + 1] + a[o + 2] * b[p + 2] + a[o + 3] * b[p + 3],
  );
  return (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
};

/** A small synthetic recording: n dice moving and turning over `steps` frames. */
function synthRec(n = 2, steps = 9, extra = {}) {
  const data = new Float32Array(steps * n * FLOATS_PER_DIE);
  for (let s = 0; s < steps; s++) {
    for (let d = 0; d < n; d++) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(s * 0.1, d * 0.3, s * 0.05));
      data.set([1 + s * 0.2, 0.5, d - 0.5, q.x, q.y, q.z, q.w], (s * n + d) * FLOATS_PER_DIE);
    }
  }
  return {
    chunks: [data],
    events: new Float32Array(0),
    settledStep: steps - 1,
    nudges: Array(n).fill(0),
    dice: Array.from({ length: n }, (_, i) => ({ shapeType: 'd6', key: `0:${i}:0` })),
    area: { cx: 0, cz: 0, halfWidth: 10, halfDepth: 5 },
    obstacles: [],
    splatSpeed: null,
    edge: 2,
    hand: true,
    ...extra,
  };
}

describe('recorded free throws', () => {
  let ten;
  beforeAll(async () => {
    ten = await recordThrow(d6s(10));
  });
  afterEach(() => vi.useRealTimers());

  test('round trip on a recorded 10d6 free throw: position error <= 1/512 kept, <= 0.05 between; rotation <= 0.5 deg kept', () => {
    const { rec, values } = ten;
    expect(rec.chunks.length).toBeGreaterThan(1);
    const payload = encodeTrajectory(rec, { values });
    const dec = decodeTrajectory(JSON.parse(JSON.stringify(payload)));
    expect(dec).not.toBeNull();
    const a = framesOf(rec.chunks);
    const b = framesOf(dec.chunks);
    expect(b.length).toBe(a.length);
    const n = 10;
    const steps = a.length / (n * FLOATS_PER_DIE);
    const { cx, cz } = rec.area;
    let keptPos = 0;
    let midPos = 0;
    let keptRot = 0;
    let midRot = 0;
    for (let f = 0; f < steps; f++) {
      const kept = f % TRAJ_STRIDE === 0 || f === steps - 1;
      for (let d = 0; d < n; d++) {
        const o = (f * n + d) * FLOATS_PER_DIE;
        const e = Math.max(
          Math.abs(b[o] + cx - a[o]),
          Math.abs(b[o + 1] - a[o + 1]),
          Math.abs(b[o + 2] + cz - a[o + 2]),
        );
        const r = angle(a, o + 3, b, o + 3);
        if (kept) [keptPos, keptRot] = [Math.max(keptPos, e), Math.max(keptRot, r)];
        else [midPos, midRot] = [Math.max(midPos, e), Math.max(midRot, r)];
      }
    }
    console.info(
      `trajectory 10d6: ${steps} frames; kept pos ${keptPos.toFixed(5)} rot ${keptRot.toFixed(4)} deg; ` +
        `between pos ${midPos.toFixed(4)} rot ${midRot.toFixed(3)} deg; ${trajectoryBytes(payload)} B`,
    );
    expect(keptPos).toBeLessThanOrEqual(1 / 512);
    expect(keptRot).toBeLessThanOrEqual(0.5);
    expect(midPos).toBeLessThanOrEqual(0.05);
    expect(midRot).toBeLessThanOrEqual(10);
    expect(payload.extra.length).toBeLessThan(steps / 2); // most frames stay on the stride grid
  });

  test('the final frame is exact: readResult gives the recorded values', () => {
    const { rec, values } = ten;
    const dec = decodeTrajectory(encodeTrajectory(rec, { values }));
    const a = rec.chunks.at(-1);
    const b = dec.chunks.at(-1);
    const off = b.length - 10 * FLOATS_PER_DIE;
    const aoff = a.length - 10 * FLOATS_PER_DIE;
    for (let d = 0; d < 10; d++) {
      const o = off + d * FLOATS_PER_DIE;
      for (let k = 3; k < 7; k++) expect(b[o + k]).toBe(a[aoff + d * FLOATS_PER_DIE + k]);
      const q = { x: b[o + 3], y: b[o + 4], z: b[o + 5], w: b[o + 6] };
      expect(readResult(getShape('d6'), q)).toBe(values[d]);
    }
    expect(dec.values).toEqual(values);
    expect(values.every((v) => v >= 1 && v <= 6)).toBe(true);
  });

  test('10d6 typical encodes under 32 KiB; 30 dice under MAX_TRAJECTORY_BYTES; above the cap the encoder gives null', async () => {
    const { rec, values } = ten;
    const p10 = encodeTrajectory(rec, { values });
    expect(trajectoryBytes(p10)).toBeLessThan(32 * 1024);
    const thirty = await recordThrow(d6s(30), { seed: 5 });
    const p30 = encodeTrajectory(thirty.rec, { values: thirty.values });
    expect(p30).not.toBeNull();
    console.info(
      `trajectory sizes: 10d6 ${trajectoryBytes(p10)} B, 30d6 ${trajectoryBytes(p30)} B`,
    );
    expect(trajectoryBytes(p30)).toBeLessThanOrEqual(MAX_TRAJECTORY_BYTES);
    expect(encodeTrajectory(rec, { values, maxBytes: trajectoryBytes(p10) - 1 })).toBeNull();
    expect(encodeTrajectory(rec, { values, maxBytes: trajectoryBytes(p10) })).toEqual(p10);
  });

  test('the payload carries the edge, the hand flag, keys and shapes', () => {
    const { rec, values, edge } = ten;
    const p = encodeTrajectory(rec, { values });
    expect(p).toMatchObject({ v: 1, n: 10, stride: TRAJ_STRIDE, edge, hand: true });
    expect(p.keys).toEqual(d6s(10).map((s) => s.key));
    expect(p.shapes).toEqual(Array(10).fill('d6'));
    expect(p.area).toEqual({ halfWidth: rec.area.halfWidth, halfDepth: rec.area.halfDepth });
    const dec = decodeTrajectory(p);
    expect(dec).toMatchObject({ edge, hand: true, keys: p.keys, shapes: p.shapes, n: 10 });
  });

  test('replaySource through DiceBox lands with the recorded values (no physics, placed into another area)', async () => {
    vi.useFakeTimers();
    const { rec, values } = ten;
    const dec = decodeTrajectory(encodeTrajectory(rec, { values }));
    const physics = { resize: () => {}, recycle: vi.fn(), throw: vi.fn() };
    // a smaller screen: 960 x 480 px
    const { box, renderer } = makeBox(physics, { left: 0, top: 0, width: 960, height: 480 });
    const target = box.dieArea({ left: 100, top: 50, width: 600, height: 300 }, 10);
    const placed = placeTrajectory(dec, target);
    const r = box.roll(d6s(10), { source: replaySource(placed), free: true });
    expect(physics.throw).not.toHaveBeenCalled();
    await flush();
    renderer.tick(0);
    renderer.tick(100000);
    expect(await r.values).toEqual(values);
    expect(physics.recycle).not.toHaveBeenCalled();
    box.clear();
  });
});

describe('the codec on synthetic recordings', () => {
  const payloadOf = (extra, n, steps) =>
    encodeTrajectory(synthRec(n, steps, extra), { values: [3, 4] });

  test('events keep -3-i and obstacle ids', () => {
    const obstacles = [
      { id: 'u1', x: 3, z: 1, r: 1, h: 2 },
      { id: 'u2', x: -3, z: 1.5, r: 0.8, h: 1.5 },
    ];
    const events = new Float32Array([5, 0, -1, 7.5, 6, 1, -4, 12.25, 7, 0, 1, 3, 8, 1, -3, 0.5]);
    const area = { cx: 2, cz: -1, halfWidth: 10, halfDepth: 5 };
    const p = payloadOf({ obstacles, events, area, splatSpeed: 9 });
    const dec = decodeTrajectory(p);
    expect([...dec.events]).toEqual([5, 0, -1, 7.5, 6, 1, -4, 12.25, 7, 0, 1, 3, 8, 1, -3, 0.5]);
    // spots relative to the area centre
    expect(dec.obstacles).toEqual([
      { id: 'u1', x: 1, z: 2, r: 1, h: 2 },
      { id: 'u2', x: -5, z: 2.5, r: 0.8, h: 1.5 },
    ]);
    expect(dec.splatSpeed).toBe(9);
    expect(replaySource(dec).obstacleIds).toEqual(['u1', 'u2']);
    // speeds go through float16: close, not exact
    const odd = decodeTrajectory(payloadOf({ events: new Float32Array([1, 0, -1, 7.3]) }));
    expect(odd.events[3]).toBeCloseTo(7.3, 2);
  });

  test('replaySource streams the frames as chunks, the impacts with the first, done with settledStep', async () => {
    const dec = decodeTrajectory(payloadOf({ events: new Float32Array([5, 0, -1, 7.5]) }, 2, 70));
    const src = replaySource(dec);
    const got = [];
    src.onChunk((c) => got.push(c));
    expect(got.map((c) => c.steps)).toEqual([30, 30, 10]);
    expect(got.map((c) => c.done)).toEqual([false, false, true]);
    expect([...got[0].events]).toEqual([5, 0, -1, 7.5]);
    expect(got[1].events).toHaveLength(0);
    expect(await src.done).toEqual({ settledStep: 69, nudges: [] });
  });

  test('malformed, truncated, NaN, oversized, too many dice -> null', () => {
    const p = payloadOf({
      obstacles: [{ id: 'u1', x: 3, z: 1, r: 1, h: 2 }],
      events: new Float32Array([5, 0, -3, 7.5]),
    });
    expect(decodeTrajectory(p)).not.toBeNull();
    const reb64 = (s, edit) => {
      const u = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
      edit(u);
      return btoa(String.fromCharCode(...u));
    };
    const nanLast = reb64(p.last, (u) => new Float32Array(u.buffer).fill(NaN, 3, 4));
    const evAt = (die, other) =>
      reb64(p.events, (u) => {
        const v = new DataView(u.buffer);
        v.setInt8(2, die);
        v.setInt8(3, other);
      });
    const bad = [
      null,
      'x',
      42,
      {},
      { ...p, v: 2 },
      { ...p, n: 0 },
      { ...p, n: 3 },
      { ...p, n: 2.5 },
      { ...p, steps: 0 },
      { ...p, steps: 100000 },
      { ...p, steps: p.steps + 1 },
      { ...p, stride: 0 },
      { ...p, extra: null },
      { ...p, extra: [2] }, // on the grid
      { ...p, extra: [3, 1] }, // not increasing
      { ...p, extra: [p.steps - 1] }, // the final frame
      { ...p, extra: [1.5] },
      { ...p, settledStep: p.steps + 1 },
      { ...p, settledStep: -1 },
      { ...p, edge: 4 },
      { ...p, hand: 'yes' },
      { ...p, area: { halfWidth: 0, halfDepth: 5 } },
      { ...p, area: { halfWidth: NaN, halfDepth: 5 } },
      { ...p, area: null },
      { ...p, values: [3] },
      { ...p, values: [NaN, 4] },
      { ...p, keys: ['a'] },
      { ...p, keys: [1, 2] },
      { ...p, shapes: ['d6', 'd7'] },
      { ...p, obstacles: [...Array(4)].map(() => ({ id: 'a', x: 0, z: 0, r: 1, h: 1 })) },
      { ...p, obstacles: [{ id: 'u1', x: NaN, z: 1, r: 1, h: 2 }] },
      { ...p, obstacles: [{ id: 7, x: 3, z: 1, r: 1, h: 2 }] },
      { ...p, obstacles: 'none' },
      { ...p, splatSpeed: -1 },
      { ...p, pos: p.pos.slice(0, -8) },
      { ...p, rot: p.rot.slice(0, -4) },
      { ...p, last: p.last.slice(0, -8) },
      { ...p, events: btoa('12345') },
      { ...p, pos: '%%%' },
      { ...p, pos: null },
      { ...p, last: nanLast },
      { ...p, events: evAt(2, -1) }, // die out of range
      { ...p, events: evAt(0, 2) }, // other die out of range
      { ...p, events: evAt(0, -4) }, // obstacle 1 is not listed
    ];
    bad.forEach((b, i) => expect(decodeTrajectory(b), `case ${i}`).toBeNull());
    // the caps: too many dice for this receiver, a payload over the byte cap
    expect(decodeTrajectory(p, { maxDice: 1 })).toBeNull();
    expect(decodeTrajectory(p, { maxBytes: trajectoryBytes(p) - 1 })).toBeNull();
    expect(decodeTrajectory(p, { maxBytes: trajectoryBytes(p) })).not.toBeNull();
    expect(encodeTrajectory(null, { values: [] })).toBeNull();
    expect(
      encodeTrajectory(synthRec(2, 9, { chunks: [new Float32Array(5)] }), { values: [] }),
    ).toBeNull();
  });

  test('a bounce between two kept frames keeps the frame between (interpolated error <= 0.05)', () => {
    const rec = synthRec(1, 9);
    const data = rec.chunks[0];
    // frame 3 bounces: off by 0.3 from the straight line between frames 2 and 4
    data[3 * FLOATS_PER_DIE + 1] += 0.3;
    const p = encodeTrajectory(rec, { values: [1] });
    expect(p.extra).toEqual([3]);
    const b = framesOf(decodeTrajectory(p).chunks);
    expect(Math.abs(b[3 * FLOATS_PER_DIE + 1] - data[3 * FLOATS_PER_DIE + 1])).toBeLessThanOrEqual(
      1 / 512,
    );
    const plain = encodeTrajectory(synthRec(1, 9), { values: [1] });
    expect(plain.extra).toEqual([]);
  });

  test('a one-frame and an even-length recording round-trip (the final frame is the recorded one)', () => {
    for (const steps of [1, 2, 8]) {
      const rec = synthRec(2, steps);
      const dec = decodeTrajectory(encodeTrajectory(rec, { values: [1, 2] }));
      const a = framesOf(rec.chunks);
      const b = framesOf(dec.chunks);
      expect(b.length).toBe(a.length);
      const last = a.length - 2 * FLOATS_PER_DIE;
      expect([...b.slice(last)]).toEqual([...a.slice(last)]);
    }
  });
});

describe('placeTrajectory (H-11)', () => {
  const dec = () =>
    decodeTrajectory(
      encodeTrajectory(synthRec(2, 9, { obstacles: [{ id: 'u1', x: 4, z: -2, r: 1, h: 2 }] }), {
        values: [1, 2],
      }),
    );
  const xs = (d) => framesOf(d.chunks).filter((_, i) => i % FLOATS_PER_DIE === 0);
  const zs = (d) => framesOf(d.chunks).filter((_, i) => i % FLOATS_PER_DIE === 2);
  const ys = (d) => framesOf(d.chunks).filter((_, i) => i % FLOATS_PER_DIE === 1);

  test('same area -> identity; a 0.7-size area -> s 0.7; a 0.4-size area -> s 0.6 (floor); obstacle spots transformed alike', () => {
    const d = dec();
    const same = placeTrajectory(d, { cx: 0, cz: 0, halfWidth: 10, halfDepth: 5 });
    expect(same.scale).toBe(1);
    expect([...framesOf(same.chunks)]).toEqual([...framesOf(d.chunks)]);
    expect(same.obstacles).toEqual(d.obstacles);

    const small = placeTrajectory(d, { cx: 3, cz: -1, halfWidth: 7, halfDepth: 3.5 });
    expect(small.scale).toBeCloseTo(0.7, 10);
    xs(small).forEach((x, i) => expect(x).toBeCloseTo(3 + 0.7 * xs(d)[i], 5));
    zs(small).forEach((z, i) => expect(z).toBeCloseTo(-1 + 0.7 * zs(d)[i], 5));
    expect(ys(small)).toEqual(ys(d)); // heights (and die sizes) kept
    expect(small.obstacles[0]).toMatchObject({ id: 'u1', r: 1, h: 2 });
    expect(small.obstacles[0].x).toBeCloseTo(3 + 0.7 * 4, 10);
    expect(small.obstacles[0].z).toBeCloseTo(-1 + 0.7 * -2, 10);
    expect(small.area).toMatchObject({ cx: 3, cz: -1 });
    expect(small.area.halfWidth).toBeCloseTo(7, 10);

    // the smaller ratio wins: 0.9 wide but 0.7 deep -> 0.7
    expect(placeTrajectory(d, { halfWidth: 9, halfDepth: 3.5 }).scale).toBeCloseTo(0.7, 10);
    // a bigger area never enlarges
    expect(placeTrajectory(d, { halfWidth: 20, halfDepth: 10 }).scale).toBe(1);

    const tiny = placeTrajectory(d, { cx: 0, cz: 0, halfWidth: 4, halfDepth: 2 });
    expect(tiny.scale).toBe(MIN_REPLAY_SCALE);
    xs(tiny).forEach((x, i) => expect(x).toBeCloseTo(0.6 * xs(d)[i], 5));
    expect(tiny.obstacles[0].x).toBeCloseTo(0.6 * 4, 10);
    expect(d.obstacles[0].x).toBe(4); // the input is untouched
  });

  test('with a stage, the centre is clamped so the scaled area stays on it', () => {
    const d = dec();
    const p = placeTrajectory(
      d,
      { cx: 12, cz: 0, halfWidth: 4, halfDepth: 2 },
      { halfWidth: 15, halfDepth: 7.5 },
    );
    expect(p.scale).toBe(0.6);
    expect(p.area.cx).toBeCloseTo(15 - 0.6 * 10, 10);
    expect(p.area.cz).toBe(0);
    const inside = placeTrajectory(
      d,
      { cx: 2, cz: 1, halfWidth: 10, halfDepth: 5 },
      { halfWidth: 15, halfDepth: 7.5 },
    );
    expect(inside.area).toMatchObject({ cx: 2, cz: 1 });
  });
});
