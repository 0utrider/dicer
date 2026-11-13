import * as THREE from 'three';
import { Playback } from '../../src/throw/playback.js';
import { getShape } from '../../src/core/dice-shapes.js';
import { readTopFace, faceNormals } from '../../src/core/face-reader.js';
import { readFree } from '../../src/hand/hand.js';

const area = { halfWidth: 12, halfDepth: 7 };
function die(target = 6, type = 'd6') {
  return {
    outer: new THREE.Object3D(),
    inner: new THREE.Object3D(),
    shape: getShape(type),
    targetValue: target,
  };
}
function chunk(fromStep, steps, total, done, finalQ = [0, 0, 0, 1]) {
  const data = new Float32Array(steps * 7);
  for (let i = 0; i < steps; i++) {
    const t = (fromStep + i) / (total - 1);
    data.set([-14 + 14 * t, 1, 0, ...finalQ], i * 7);
  }
  return { index: fromStep / 30, steps, data, done };
}
const worldTop = (d) => {
  const world = new THREE.Quaternion().multiplyQuaternions(d.outer.quaternion, d.inner.quaternion);
  return d.shape.values[readTopFace(d.shape, world)];
};

test('holds before entering the area until results are applied', () => {
  const d = die();
  const p = new Playback({ dice: [d], area });
  p.push(chunk(0, 30, 60, false));
  p.update(0);
  expect(p.update(1000)).toBe('waiting');
  expect(Math.abs(d.outer.position.x)).toBeGreaterThanOrEqual(area.halfWidth);
});
test('resumes after the final chunk arrives', () => {
  const d = die();
  const p = new Playback({ dice: [d], area });
  p.push(chunk(0, 30, 60, false));
  p.update(0);
  p.update(1000);
  p.push(chunk(30, 30, 60, true));
  expect(p.update(1100)).toBe('playing');
  expect(p.update(5000)).toBe('landed');
  expect(p.landed).toBe(true);
});
test('holds at frame 0 when the first frame is already inside', () => {
  const d = die();
  const data = new Float32Array(7 * 2);
  data.set([0, 1, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 1]);
  const p = new Playback({ dice: [d], area });
  p.push({ index: 0, steps: 2, data, done: false });
  p.update(0);
  expect(p.update(1000)).toBe('waiting');
  expect(d.outer.position.x).toBe(0);
});
test('speed scales the playhead', () => {
  const run = (speed) => {
    const d = die();
    const p = new Playback({ dice: [d], area, speed });
    p.push(chunk(0, 30, 60, false));
    p.push(chunk(30, 30, 60, true));
    p.update(0);
    p.update(100);
    return d.outer.position.x;
  };
  expect(run(2)).toBeGreaterThan(run(1));
});
test('applies result rotation on the final chunk and lands with the target face up', () => {
  const d = die(6);
  const p = new Playback({ dice: [d], area });
  p.push(chunk(0, 30, 60, false));
  p.push(chunk(30, 30, 60, true));
  p.update(0);
  expect(p.update(5000)).toBe('landed');
  expect(worldTop(d)).toBe(6);
});
test('release returns every chunk buffer', () => {
  const p = new Playback({ dice: [die()], area });
  const a = chunk(0, 30, 60, false);
  const b = chunk(30, 30, 60, true);
  p.push(a);
  p.push(b);
  expect(p.release()).toEqual([a.data, b.data]);
});
test('a long gap between updates (hidden tab) jumps to the end, it does not replay', () => {
  const d = die();
  const p = new Playback({ dice: [d], area });
  p.push(chunk(0, 30, 60, false));
  p.push(chunk(30, 30, 60, true));
  p.update(0);
  expect(p.update(60000)).toBe('landed');
  expect(d.outer.position.x).toBeCloseTo(0, 3);
});
describe('round trip over all die types', () => {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.7, 1.9, -1.1)).normalize();
  for (const type of ['d2', 'd4', 'd6', 'd8', 'd10', 'd12', 'd20']) {
    const { values } = getShape(type);
    const targets = [...new Set([values[0], values[Math.floor(values.length / 2)], values.at(-1)])];
    for (const v of targets) {
      test(`${type} shows ${v}`, () => {
        const d = die(v, type);
        const p = new Playback({ dice: [d], area });
        p.push(chunk(0, 30, 30, true, [q.x, q.y, q.z, q.w]));
        p.update(0);
        expect(p.update(5000)).toBe('landed');
        expect(worldTop(d)).toBe(v);
      });
    }
  }
});

test('takeEvents hands each event once, in playhead order, none while waiting', () => {
  const d = die();
  const p = new Playback({ dice: [d], area });
  const c0 = chunk(0, 30, 60, false);
  c0.events = new Float32Array([5, 0, -1, 7, 10, 0, -1, 9, 12, 0, -2, 3]);
  const c1 = chunk(30, 30, 60, true);
  c1.events = new Float32Array([40, 0, -1, 1]);
  p.push(c0);
  p.update(0);
  expect(p.update(1000)).toBe('waiting');
  expect(p.takeEvents()).toEqual([]);
  p.push(c1);
  expect(p.update(1000)).toBe('playing');
  expect(p.takeEvents()).toEqual([]);
  // frame 5 was before the dice were on screen (dropped); the hop crosses 10 and 12, not 40
  expect(p.update(1000 + 20 * (1000 / 60))).toBe('playing');
  expect(p.takeEvents()).toEqual([
    { die: 0, other: -1, speed: 9 },
    { die: 0, other: -2, speed: 3 },
  ]);
  expect(p.takeEvents()).toEqual([]);
  expect(p.update(9000)).toBe('landed');
  expect(p.takeEvents()).toEqual([]);
});

describe('slow-motion speed ramp (Plan 4 Task 8)', () => {
  // 120 frames; the ramp eases over frames 60..90 and holds 0.35 from 90 to landing (119).
  const make = () => {
    const d = die();
    const p = new Playback({ dice: [d], area });
    for (let c = 0; c < 4; c++) p.push(chunk(c * 30, 30, 120, c === 3));
    return p;
  };
  const STEP_MS = 1000 / 60;
  test('full speed before the ramp, ~0.35x in the held range, and the landing frame is still reached', () => {
    const p = make();
    p.setSpeedRamp({ fromStep: 90 });
    p.update(0);
    p.update(30 * STEP_MS); // 30 steps at speed 1
    expect(p._playhead).toBeCloseTo(30, 5);
    // through the ramp, into the held range
    let t = 30 * STEP_MS;
    while (p._playhead < 95) p.update((t += STEP_MS));
    const ph0 = p._playhead;
    p.update((t += 10 * STEP_MS));
    expect((p._playhead - ph0) / 10).toBeCloseTo(0.35, 2);
    let state = 'playing';
    for (let i = 0; i < 2000 && state !== 'landed'; i++) state = p.update((t += STEP_MS));
    expect(state).toBe('landed');
    expect(p.landed).toBe(true);
  });
  test('the ramp eases (speed strictly between 1 and toSpeed mid-ramp)', () => {
    const p = make();
    p.setSpeedRamp({ fromStep: 90, toSpeed: 0.5 });
    expect(p.speedAt(10)).toBe(1);
    expect(p.speedAt(60)).toBe(1);
    expect(p.speedAt(75)).toBeGreaterThan(0.5);
    expect(p.speedAt(75)).toBeLessThan(1);
    expect(p.speedAt(90)).toBe(0.5);
    expect(p.speedAt(119)).toBe(0.5);
  });
  test('durationMs accounts for the slower range (used by the landing watchdog)', () => {
    const p = make();
    const plain = p.durationMs(119);
    expect(plain).toBeCloseTo(119 * STEP_MS, 5);
    p.setSpeedRamp({ fromStep: 90 });
    const slow = p.durationMs(119);
    // at least the true time: 60 steps at 1, a 30-step ease, 29 held steps at 0.35
    expect(slow).toBeGreaterThanOrEqual((60 + 30 / 0.675 + 29 / 0.35) * STEP_MS * 0.99);
  });
  test('without a ramp nothing changes', () => {
    const p = make();
    expect(p.speedAt(100)).toBe(1);
  });
});

test('"inside" uses an offset area (cx, cz)', () => {
  // The die rolls from x = -14 to 0 at z = 0. An area centred at x = -10 (half width 2) is
  // entered at x = -12, long before the stage-centred check (|x| < 2) would see it.
  const offsetArea = { cx: -10, cz: 0, halfWidth: 2, halfDepth: 7 };
  const d = die();
  const p = new Playback({ dice: [d], area: offsetArea });
  p.push(chunk(0, 30, 60, false));
  p.update(0);
  expect(p.update(1000)).toBe('waiting');
  expect(d.outer.position.x).toBeLessThanOrEqual(-12);
  // A z offset excludes a die whose x is inside but whose z is not.
  // (A centred check, |x| < 12, would hold at x = -12; never inside, it plays the whole chunk.)
  const far = { cx: -10, cz: 20, halfWidth: 12, halfDepth: 3 };
  const d2 = die();
  const p2 = new Playback({ dice: [d2], area: far });
  p2.push(chunk(0, 30, 60, false));
  p2.update(0);
  p2.update(1000);
  expect(d2.outer.position.x).toBeGreaterThan(-8);
});
describe('free dice (rolling by hand)', () => {
  const free = (type = 'd6', extra = {}) => ({ ...die(1, type), free: true, ...extra });
  /** n dice per frame, inside the area: x runs 0 -> 5 over the chunk, then rests with `qs[d]`. */
  const inside = (n, steps, done, qs = []) => {
    const data = new Float32Array(steps * 7 * n);
    for (let s = 0; s < steps; s++) {
      for (let d = 0; d < n; d++) {
        data.set([(5 * s) / (steps - 1), 1, d * 1.5, ...(qs[d] ?? [0, 0, 0, 1])], (s * n + d) * 7);
      }
    }
    return { steps, data, done };
  };
  /** The pose with face i of `type` pointing along dir (+1 up, -1 down). */
  const pose = (type, i, dir = 1) => {
    const n = faceNormals(getShape(type))[i];
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(n.x, n.y, n.z),
      new THREE.Vector3(0, dir, 0),
    );
    return [q.x, q.y, q.z, q.w];
  };

  test('free dice inside the area play from frame 0 before the final chunk', () => {
    const d = free();
    const p = new Playback({ dice: [d], area });
    p.push(inside(1, 30, false));
    p.update(0);
    expect(p.update(250)).toBe('playing');
    expect(d.outer.position.x).toBeGreaterThan(1);
    expect(p.update(5000)).toBe('waiting'); // the end of what has arrived: not landed yet
    expect(d.outer.position.x).toBeCloseTo(5, 5);
    expect(p.resultsApplied).toBe(false);
    // a forced die in the same spot holds at frame 0
    const f = die();
    const q = new Playback({ dice: [f], area });
    q.push(inside(1, 30, false));
    q.update(0);
    q.update(250);
    expect(f.outer.position.x).toBe(0);
  });

  test('free dice are not rotated: inner quaternion identity (modelQuat kept)', () => {
    const a = free();
    const b = free('d6', {
      modelQuat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 0.2, 0)),
    });
    a.inner.quaternion.set(0.5, 0.5, 0.5, 0.5);
    const p = new Playback({ dice: [a, b], area, read: readFree });
    p.push(inside(2, 30, true, [pose('d6', 2), pose('d6', 4)]));
    p.update(0);
    expect(p.update(5000)).toBe('landed');
    expect(a.inner.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    expect(b.inner.quaternion.angleTo(b.modelQuat)).toBeCloseTo(0, 6);
  });

  test('readValue/value from the final pose for d6, d16, d4crystal, d3, dF, dc, d100 pair', () => {
    const d6 = getShape('d6');
    const d16 = getShape('d16');
    const crystal = getShape('d4crystal');
    const d10 = getShape('d10');
    const i10 = (v) => d10.values.indexOf(v);
    const cases = [
      [free('d6'), pose('d6', 3), d6.values[3]],
      // d16: the face on the table counts its paired top kite (17 - table value)
      [free('d16'), pose('d16', 5, -1), 17 - d16.values[5]],
      [
        free('d4crystal'),
        pose('d4crystal', crystal.readFaces[1]),
        crystal.values[crystal.readFaces[1]],
      ],
      [free('d6', { variant: 'd3' }), pose('d6', d6.values.indexOf(5)), 2],
      [free('d6', { variant: 'dF' }), pose('d6', d6.values.indexOf(6)), -1],
      [free('d2', { variant: 'dc' }), [1, 0, 0, 0], 0], // flipped: face 2 (tails) up
      [free('d10', { variant: 'd100tens' }), pose('d10', i10(3)), 30],
      [free('d10'), pose('d10', i10(7)), 37], // the ones die carries the combined d100
      [free('d10', { variant: 'd100tens' }), pose('d10', i10(10)), 0],
      [free('d10'), pose('d10', i10(10)), 100],
    ];
    const dice = cases.map((c) => c[0]);
    const p = new Playback({ dice, area, read: readFree });
    p.push(
      inside(
        dice.length,
        30,
        true,
        cases.map((c) => c[1]),
      ),
    );
    p.update(0);
    expect(p.update(5000)).toBe('landed');
    expect(dice.map((d) => d.value)).toEqual(cases.map((c) => c[2]));
    expect(dice.map((d) => d.readValue)).toEqual([...cases.slice(0, 7).map((c) => c[2]), 7, 0, 10]);
    expect(dice[1].readFace).toBe(d16.values.indexOf(17 - d16.values[5]));
  });

  test('the reader is the hand chunk: without one a free die is neither read nor forced', () => {
    const a = free('d6');
    a.inner.quaternion.set(0, 0, 0, 1);
    const p = new Playback({ dice: [a], area });
    p.push(inside(1, 30, true, [pose('d6', 2)]));
    p.update(0);
    expect(p.update(5000)).toBe('landed');
    expect(a.readValue).toBeUndefined();
    expect(a.value).toBeUndefined(); // untouched
    expect(a.inner.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    const read = vi.fn();
    const b = free('d6');
    const q = new Playback({ dice: [b], area, read });
    const c = inside(1, 30, true, [pose('d6', 2)]);
    q.push(c);
    expect(read).toHaveBeenCalledWith([b], c.data, 29 * 7);
  });

  test('a free ghost reads its value but never carries it', () => {
    const g = free('d6', { ghost: true });
    const p = new Playback({ dice: [g], area, read: readFree });
    p.push(inside(1, 30, true, [pose('d6', 0)]));
    p.update(0);
    p.update(5000);
    expect(g.readValue).toBe(getShape('d6').values[0]);
    expect(g.value).toBeUndefined();
  });
});
