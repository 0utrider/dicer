/** Shared fixtures for the hand replay tests: a recorded throw that lands on chosen faces. */
import { getShape } from '../../src/core/dice-shapes.js';
import { restingQuaternion } from '../../src/core/resting.js';
import { FLOATS_PER_DIE } from '../../src/physics/protocol.js';
import { encodeTrajectory } from '../../src/hand/chunk/trajectory.js';

/**
 * A DiceBox-like recording of `dice` ([{shapeType, key, face}], face: the shape value that lands
 * up): three frames falling onto the table, the last at rest with that face up.
 */
export function recordingOf(dice, { area = { cx: 2, cz: -1, halfWidth: 4, halfDepth: 3 } } = {}) {
  const n = dice.length;
  const frames = 3;
  const data = new Float32Array(frames * n * FLOATS_PER_DIE);
  dice.forEach((d, i) => {
    const shape = getShape(d.shapeType);
    const q = restingQuaternion(shape, shape.values.indexOf(d.face));
    for (let f = 0; f < frames; f++) {
      const o = (f * n + i) * FLOATS_PER_DIE;
      data.set([area.cx + i * 1.5, 3 - f, area.cz, q.x, q.y, q.z, q.w], o);
    }
  });
  return {
    chunks: [data],
    events: new Float32Array(0),
    settledStep: frames - 1,
    dice: dice.map(({ shapeType, key }) => ({ shapeType, key })),
    area,
    obstacles: [],
    splatSpeed: null,
    edge: 1,
    hand: true,
  };
}

/** The encoded payload of recordingOf(dice). */
export const trajectoryOf = (dice, o) => encodeTrajectory(recordingOf(dice, o));

/** A Foundry-like hand roll: one d20 term with `results`, thrown by `by` under id `id`. */
export const handD20 = (results = [17], { id = 'h1', by = 'thrower', n = results.length, fallback } = {}) => ({
  options: { dicerHand: { id, by, n, ...(fallback && { fallback }) } },
  dice: [{ faces: 20, results: results.map((result) => ({ result, active: true })) }],
});
