import { expect, test, vi } from 'vitest';

// The worker hands the whole THROW request to the sim: obstacles and splatSpeed included.
const throws = [];
vi.mock('virtual:rapier-wasm-url', () => ({ default: 'rapier.wasm' }));
vi.mock('../../src/physics/sim.js', () => ({
  initPhysics: async () => {},
  prewarm: () => {},
  createSim: () => ({
    throw: (req) => (throws.push(req), { settledStep: 1 }),
  }),
}));

test('the worker passes obstacles and splatSpeed to sim.throw', async () => {
  const posted = [];
  globalThis.self = { postMessage: (m) => posted.push(m) };
  await import('../../src/physics/physics.worker.js');
  await self.onmessage({ data: { type: 'init', hulls: {} } });
  const obstacles = [{ x: 1, z: 2, r: 0.9, h: 1.5 }];
  await self.onmessage({
    data: { type: 'throw', id: 4, dice: [{ type: 'd6' }], seed: 9, obstacles, splatSpeed: 10 },
  });
  expect(throws[0]).toMatchObject({ dice: [{ type: 'd6' }], seed: 9, obstacles, splatSpeed: 10 });
  expect(posted.at(-1)).toMatchObject({ type: 'done', id: 4, settledStep: 1 });
  delete globalThis.self;
});
