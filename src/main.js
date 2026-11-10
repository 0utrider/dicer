Hooks.once('init', () => console.log('dicer | init'));

// Exported (until Task 10 wires the client into the roll pipeline) so the build includes the
// physics worker chunk and the Rapier wasm asset, and the 4 MB dist guard measures them.
export { createPhysicsWorker, PhysicsClient } from './physics/physics-client.js';
export { computeHulls } from './physics/hulls.js';
