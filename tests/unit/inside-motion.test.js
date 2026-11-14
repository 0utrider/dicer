import {
  createMotion, stepMotion, restFactor, SLOSH, REST_EASE, SPIN_TAU,
} from '../../src/render/extras/insides/motion.js';

const DT = 1 / 120;
const qAxis = (axis, ang) => {
  const s = Math.sin(ang / 2);
  return { x: axis[0] * s, y: axis[1] * s, z: axis[2] * s, w: Math.cos(ang / 2) };
};
// inverse(q) applied to (0,1,0): die-local world-up
const localUp = (q) => {
  const { x, y, z, w } = q;
  // conjugate rotation of (0,1,0)
  return [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)];
};
const angleBetween = (a, b) => {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.acos(Math.max(-1, Math.min(1, d)));
};

// Turn the die 90 deg about z after one rest step; return signed-progress samples.
function runSlosh(opts, seconds) {
  const s = createMotion();
  stepMotion(s, qAxis([0, 0, 1], 0), DT, opts);
  const q = qAxis([0, 0, 1], Math.PI / 2);
  const target = localUp(q);
  const start = [...s.lag];
  const total = angleBetween(start, target);
  const out = [];
  for (let i = 1; i * DT <= seconds + 1e-9; i++) {
    stepMotion(s, q, DT, opts);
    out.push({ t: i * DT, err: angleBetween(s.lag, target), lag: [...s.lag] });
  }
  return { out, total, target, start, s };
}

// Signed position along the start->target arc: >1 means overshoot past target.
const progress = (lag, start, target) => {
  const dir = [target[0] - start[0], target[1] - start[1], target[2] - start[2]];
  const len2 = dir[0] ** 2 + dir[1] ** 2 + dir[2] ** 2;
  const rel = [lag[0] - start[0], lag[1] - start[1], lag[2] - start[2]];
  return (rel[0] * dir[0] + rel[1] * dir[1] + rel[2] * dir[2]) / len2;
};

test('constants', () => {
  expect(SLOSH).toEqual({ omega: 13.5, zeta: 0.5 });
  expect(REST_EASE).toEqual({ from: 8000, to: 10000 });
  expect(SPIN_TAU).toBe(0.15);
});

test('slosh settles within 0.6 s and overshoots once', () => {
  const { out, total, start, target } = runSlosh({}, 1.5);
  expect(total).toBeCloseTo(Math.PI / 2, 5);
  const at06 = out.find((o) => o.t >= 0.6 - 1e-9);
  expect(at06.err).toBeLessThan(0.02 * total);
  // excursions past the target, measured as angular error while beyond it
  const prog = out.map((o) => progress(o.lag, start, target));
  const maxOver = Math.max(...prog) - 1;
  expect(maxOver).toBeGreaterThan(0.05);
  expect(maxOver).toBeLessThan(0.25);
  // every later excursion past the target (after the first overshoot ends) <= 5%
  let i = prog.findIndex((p) => p > 1);
  while (i < prog.length && prog[i] > 1) i++;
  let later = 0;
  for (; i < prog.length; i++) later = Math.max(later, Math.abs(prog[i] - 1));
  expect(later).toBeLessThanOrEqual(0.05);
  for (const o of out) expect(Math.hypot(...o.lag)).toBeCloseTo(1, 6);
});

test('reduced motion: slosh at quarter speed, time at quarter rate', () => {
  const full = runSlosh({}, 2.4);
  const red = runSlosh({ reduced: true }, 2.4);
  // reduced response at t equals full response at t/4 (omega/4, same zeta)
  const err = (r, t) => r.out.find((o) => o.t >= t - 1e-9).err;
  expect(err(red, 2.0)).toBeCloseTo(err(full, 0.5), 1);
  expect(err(full, 0.6)).toBeLessThan(0.03);
  expect(err(red, 0.6)).toBeGreaterThan(0.2); // far from settled where full is done
  expect(red.s.time).toBeCloseTo(full.s.time * 0.25, 9);
  const s = createMotion();
  stepMotion(s, qAxis([0, 1, 0], 0), 0.5, { reduced: true });
  expect(s.time).toBeCloseTo(0.125, 9);
  stepMotion(s, qAxis([0, 1, 0], 0), 0.5, { reduced: true, factor: 2 });
  expect(s.time).toBeCloseTo(0.375, 9);
});

test('spin follows a steady 2π rad/s turn in the die-local frame within 5% after 0.5 s', () => {
  const s = createMotion();
  const w = 2 * Math.PI;
  const axis = [0, 1, 0]; // world axis; local axis rotates with the die
  for (let i = 0; i <= 0.5 / DT + 1; i++) {
    stepMotion(s, qAxis(axis, w * i * DT), DT, {});
  }
  // rotation about y: die-local axis is still y
  expect(s.spin[1]).toBeGreaterThan(w * 0.95);
  expect(s.spin[1]).toBeLessThan(w * 1.05);
  expect(Math.abs(s.spin[0])).toBeLessThan(1e-6);
  expect(Math.abs(s.spin[2])).toBeLessThan(1e-6);
});

test('spin is expressed in the die-local frame', () => {
  const s = createMotion();
  const w = 2 * Math.PI;
  // base orientation: 90 deg about z, then spin about world y at w
  const base = qAxis([0, 0, 1], Math.PI / 2);
  const mul = (a, b) => ({
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  });
  for (let i = 0; i <= 0.8 / DT; i++) {
    stepMotion(s, mul(qAxis([0, 1, 0], w * i * DT), base), DT, {});
  }
  // world y axis seen from a die turned 90 about z is local +x (inverse maps y -> x)
  expect(s.spin[0]).toBeGreaterThan(w * 0.95);
  expect(s.spin[0]).toBeLessThan(w * 1.05);
  expect(Math.abs(s.spin[1])).toBeLessThan(0.05 * w);
});

test('lag equals local up for a die at rest from the start', () => {
  const s = createMotion();
  const q = qAxis([0, 0, 1], Math.PI / 2);
  for (let i = 0; i < 240; i++) stepMotion(s, q, DT, {});
  const up = localUp(q);
  for (let k = 0; k < 3; k++) expect(s.lag[k]).toBeCloseTo(up[k], 6);
  expect(s.spin).toEqual([0, 0, 0]);
  expect(s.lagVel.every((v) => Math.abs(v) < 1e-6)).toBe(true);
});

test('restFactor: 1 at 0 and 8000 ms, 0.5 at 9000, 0 at 10000 and after, 1 for null', () => {
  expect(restFactor(0)).toBe(1);
  expect(restFactor(8000)).toBe(1);
  expect(restFactor(9000)).toBeCloseTo(0.5, 9);
  expect(restFactor(10000)).toBe(0);
  expect(restFactor(20000)).toBe(0);
  expect(restFactor(null)).toBe(1);
  expect(restFactor(8500)).toBeGreaterThan(restFactor(9500));
});

test('factor 0 freezes time and spin', () => {
  const s = createMotion();
  const w = 2 * Math.PI;
  for (let i = 0; i < 60; i++) stepMotion(s, qAxis([0, 1, 0], w * i * DT), DT, { factor: 0 });
  expect(s.time).toBe(0);
  expect(s.spin).toEqual([0, 0, 0]);
});
