import { describe, expect, test, vi } from 'vitest';
import { throwUnseen } from '../../src/hand/chunk/box.js';
import { getShape } from '../../src/core/dice-shapes.js';
import { readResult } from '../../src/core/physical-read.js';
import { FLOATS_PER_DIE } from '../../src/physics/protocol.js';

/** A physics stub streaming `chunks` (each {steps, quats: [[x,y,z,w] per die] per step}). */
function physicsWith(chunks, { fail = false } = {}) {
  const recycled = [];
  const physics = {
    sent: null,
    setReaders: vi.fn(),
    recycle: (data) => recycled.push(data),
    throw(req) {
      physics.sent = req;
      let cb = null;
      const n = req.dice.length;
      const done = new Promise((resolve, reject) => {
        queueMicrotask(() => {
          chunks.forEach((c, i) => {
            const data = new Float32Array(c.steps.length * n * FLOATS_PER_DIE);
            c.steps.forEach((quats, s) =>
              quats.forEach((q, d) => data.set([0, 0, 0, ...q], (s * n + d) * FLOATS_PER_DIE)),
            );
            cb?.({ index: i, steps: c.steps.length, data, events: new Float32Array(0), done: i === chunks.length - 1 });
          });
          if (fail) reject(new Error('worker gone'));
          else resolve({ settledStep: 1, nudges: [] });
        });
      });
      return { onChunk: (f) => (cb = f), done };
    },
  };
  return { physics, recycled };
}

const ID = [0, 0, 0, 1];
const TURN = [Math.SQRT1_2, 0, 0, Math.SQRT1_2]; // 90 degrees about x

describe('throwUnseen: a free throw nobody sees', () => {
  test('reads each die on the final frame only, in spec order, and gives every chunk back', async () => {
    const { physics, recycled } = physicsWith([
      { steps: [[TURN, TURN]] }, // an early chunk: never read
      { steps: [[TURN, TURN], [ID, TURN]] }, // the final frame: ID, TURN
    ]);
    const box = { _physics: physics, hand: { read() {} } }; // handFor already attached
    const values = await throwUnseen(box, [{ type: 'd6', shapeType: 'd6' }, { type: 'd20', shapeType: 'd20' }], 7);
    const d6 = getShape('d6');
    const d20 = getShape('d20');
    expect(values).toEqual([readResult(d6, { x: 0, y: 0, z: 0, w: 1 }), readResult(d20, { x: TURN[0], y: 0, z: 0, w: TURN[3] })]);
    expect(physics.sent).toMatchObject({ free: true, seed: 7, dice: [{ type: 'd6', splat: false }, { type: 'd20', splat: false }] });
    expect(recycled).toHaveLength(2);
  });

  test("a d100's tens and ones combine in the ones slot; the tens slot is null", async () => {
    const { physics } = physicsWith([{ steps: [[ID, ID]] }]);
    const box = { _physics: physics, hand: { read() {} } };
    const values = await throwUnseen(box, [{ type: 'd10', shapeType: 'd10', variant: 'd100tens' }, { type: 'd10', shapeType: 'd10' }]);
    expect(values[0]).toBeNull();
    expect(Number.isInteger(values[1]) && values[1] >= 1 && values[1] <= 100).toBe(true);
  });

  test('a failed physics throw resolves null (the roll falls back to Foundry)', async () => {
    const { physics } = physicsWith([{ steps: [[ID]] }], { fail: true });
    expect(await throwUnseen({ _physics: physics, hand: { read() {} } }, [{ type: 'd6', shapeType: 'd6' }])).toBeNull();
  });
});
