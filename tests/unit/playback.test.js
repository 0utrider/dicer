import * as THREE from 'three';
import { Playback } from '../../src/throw/playback.js';
import { getShape } from '../../src/core/dice-shapes.js';
import { readTopFace } from '../../src/core/face-reader.js';

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
