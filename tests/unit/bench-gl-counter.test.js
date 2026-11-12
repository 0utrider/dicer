import { expect, test, vi } from 'vitest';
import { createGlCounter } from '../../src/bench/gl-counter.js';

// P9-R12: per-frame WebGL work per canvas (dice, Foundry board, other), for the benchmark.
function fakeGl() {
  const calls = [];
  const proto = {
    drawArrays(...a) {
      calls.push(['drawArrays', this, ...a]);
    },
    drawElements(...a) {
      calls.push(['drawElements', this, ...a]);
    },
    drawArraysInstanced(...a) {
      calls.push(['drawArraysInstanced', this, ...a]);
    },
    drawElementsInstanced(...a) {
      calls.push(['drawElementsInstanced', this, ...a]);
    },
    drawRangeElements(...a) {
      calls.push(['drawRangeElements', this, ...a]);
    },
    bindFramebuffer(...a) {
      calls.push(['bindFramebuffer', this, ...a]);
    },
    clear(...a) {
      calls.push(['clear', this, ...a]);
    },
  };
  const ctx = (canvas) => Object.assign(Object.create(proto), { canvas });
  return { proto, calls, ctx };
}

function fakeRaf() {
  const cbs = [];
  return {
    raf: (cb) => cbs.push(cb),
    tick() {
      const run = cbs.splice(0);
      for (const cb of run) cb(0);
    },
  };
}

const TRIANGLES = 4;
const TRIANGLE_STRIP = 5;
const LINES = 1;

test('counts draws, triangles, framebuffer binds and clears per canvas kind, per frame', () => {
  const { proto, calls, ctx } = fakeGl();
  const dice = { width: 2400, height: 1350 };
  const board = { width: 1920, height: 1080 };
  const r = fakeRaf();
  const c = createGlCounter({
    protos: [proto],
    classify: (canvas) => (canvas === dice ? 'dice' : canvas === board ? 'foundry' : 'other'),
    raf: r.raf,
  });
  const d = ctx(dice);
  const b = ctx(board);
  c.start();
  r.tick(); // frame 1
  d.drawElements(TRIANGLES, 300, 0, 0); // 100 triangles
  d.drawElementsInstanced(TRIANGLES, 30, 0, 0, 4); // 10 x 4
  d.bindFramebuffer(0x8d40, {}); // a render target
  d.bindFramebuffer(0x8d40, null); // back to the canvas: not a pass
  d.clear(0x4000);
  b.drawArrays(TRIANGLE_STRIP, 0, 4); // 2 triangles
  b.drawRangeElements(TRIANGLES, 0, 5, 6, 0, 0); // 2
  b.drawArrays(LINES, 0, 10); // a draw, no triangles
  b.drawArraysInstanced(TRIANGLES, 0, 3, 2); // 1 x 2
  r.tick(); // frame 2
  const out = c.stop();
  expect(out.frames).toBe(2);
  expect(out.byCanvas.dice).toEqual({ draws: 2, triangles: 140, fbBinds: 1, clears: 1, width: 2400, height: 1350 });
  expect(out.byCanvas.foundry).toEqual({ draws: 4, triangles: 6, fbBinds: 0, clears: 0, width: 1920, height: 1080 });
  // The originals still ran, with their own `this`.
  expect(calls).toHaveLength(9);
  expect(calls[0][1]).toBe(d);
});

test('stop restores the original methods and the frame loop ends', () => {
  const { proto, ctx } = fakeGl();
  const original = proto.drawArrays;
  const r = fakeRaf();
  const raf = vi.fn(r.raf);
  const c = createGlCounter({ protos: [proto], classify: () => 'dice', raf });
  c.start();
  expect(proto.drawArrays).not.toBe(original);
  c.stop();
  expect(proto.drawArrays).toBe(original);
  r.tick(); // the loop scheduled before stop must not reschedule
  const n = raf.mock.calls.length;
  r.tick();
  expect(raf.mock.calls.length).toBe(n);
  ctx({}).drawArrays(TRIANGLES, 0, 3); // no throw, not counted
});

test('missing prototypes and methods are skipped, and a classify that throws counts as other', () => {
  const proto = {
    drawArrays() {},
  };
  const r = fakeRaf();
  const c = createGlCounter({
    protos: [undefined, proto],
    classify: () => {
      throw Error('x');
    },
    raf: r.raf,
  });
  c.start();
  Object.assign(Object.create(proto), { canvas: null }).drawArrays(TRIANGLES, 0, 6);
  const out = c.stop();
  expect(out.byCanvas.other).toMatchObject({ draws: 1, triangles: 2 });
});
