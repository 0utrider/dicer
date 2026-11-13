/**
 * Shapes the fairness run (scripts/fairness.mjs, docs/research/fairness.md) could not pass at
 * p > 0.01 and that could not be fixed. They are never thrown by hand: Foundry rolls them and the
 * chat card notes it (owner decision; H-15 `partial`). Task 7's shell imports this; it stays a
 * dependency-free leaf so the world-start shell or the lazy hand chunk can import it cheaply.
 * @type {readonly string[]}
 */
export const HAND_UNFAIR = Object.freeze([]);
