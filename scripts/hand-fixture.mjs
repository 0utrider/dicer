/**
 * Records the bench's hand-throw fixture (tests/fixtures/trajectory-mixed10.json): one free,
 * launched throw of the MIXED pool (1d4+2d6+2d8+2d10+2d12+1d20) through the real Rapier sim, read
 * with the Task 1 readers and encoded as a hand trajectory payload. Reproducible (fixed seed).
 *
 * `node scripts/hand-fixture.mjs` writes the file. As in scripts/fairness.mjs the sim needs Rapier's
 * wasm package, so the script loads itself through Vite's SSR loader with build/rapier-wasm-plugin.js.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const OUT = new URL('tests/fixtures/trajectory-mixed10.json', ROOT);
const SEED = 20261114;
const AREA = { halfWidth: 12, halfDepth: 7 };
/** The bench's MIXED pool: [term index in the formula, die type, count]. */
const POOL = [
  [0, 'd4', 1],
  [2, 'd6', 2],
  [4, 'd8', 2],
  [6, 'd10', 2],
  [8, 'd12', 2],
  [10, 'd20', 1],
];

export async function record() {
  const [{ initPhysics, createSim, prewarm }, hulls, readers, reader, shapes, rng, traj] =
    await Promise.all([
      import('../src/physics/sim.js'),
      import('../src/physics/hulls.js'),
      import('../src/physics/readers.js'),
      import('../src/core/physical-read.js'),
      import('../src/core/dice-shapes.js'),
      import('../src/core/rng.js'),
      import('../src/hand/chunk/trajectory.js'),
    ]);
  await initPhysics(
    readFileSync(new URL('node_modules/@dimforge/rapier3d-deterministic/rapier_wasm3d_bg.wasm', ROOT)),
  );
  const sim = createSim(AREA, hulls.computeHulls(), readers.computeReaders());
  const dice = POOL.flatMap(([term, type, n]) =>
    Array.from({ length: n }, (_, i) => ({ type, key: `${term}:${i}:0` })),
  );
  prewarm(sim, [...new Set(dice.map((d) => d.type))]);
  // A flick from the player's side of the table: dice side by side, thrown across with some spin.
  const rand = rng.mulberry32(SEED);
  const launch = dice.map((_, i) => ({
    pos: [-8 + (i % 5) * 1.6, 2 + rand() * 1.5, -3 + Math.floor(i / 5) * 3 + rand()],
    quat: [0, 0, 0, 1],
    linvel: [9 + rand() * 6, rand() * 2 - 1, (rand() - 0.5) * 6],
    angvel: [(rand() - 0.5) * 24, (rand() - 0.5) * 24, (rand() - 0.5) * 24],
  }));
  const chunks = [];
  const events = [];
  const res = sim.throw(
    { dice: dice.map((d) => ({ type: d.type })), seed: SEED, free: true, launch },
    (c) => {
      chunks.push(c.data.slice());
      events.push(...c.events);
    },
  );
  const n = dice.length;
  const last = chunks[chunks.length - 1];
  const values = dice.map((d, i) => {
    const o = last.length - (n - i) * 7;
    const q = { x: last[o + 3], y: last[o + 4], z: last[o + 5], w: last[o + 6] };
    return reader.readResult(shapes.getShape(d.type), q);
  });
  const payload = traj.encodeTrajectory(
    {
      chunks,
      events: Float32Array.from(events),
      settledStep: res.settledStep,
      dice: dice.map((d) => ({ shapeType: d.type, key: d.key })),
      area: { cx: 0, cz: 0, ...AREA },
      obstacles: [],
      splatSpeed: null,
      edge: 1,
      hand: true,
    },
    { values },
  );
  if (!payload) throw new Error('the fixture throw did not encode');
  return { payload, values };
}

export async function main() {
  const { payload, values } = await record();
  writeFileSync(OUT, `${JSON.stringify(payload)}\n`);
  console.log(`values ${values.join(' ')}; wrote ${fileURLToPath(OUT)} (${JSON.stringify(payload).length} B)`);
  return 0;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1] &&
  !globalThis.__dicerHandFixture
) {
  globalThis.__dicerHandFixture = true;
  const { createServer } = await import('vite');
  const { rapierWasmPlugin } = await import('../build/rapier-wasm-plugin.js');
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(ROOT),
    logLevel: 'error',
    plugins: [rapierWasmPlugin()],
    server: { middlewareMode: true, hmr: false, watch: null },
    ssr: { noExternal: [/@dimforge\/rapier3d-deterministic/] },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  let code = 1;
  try {
    const mod = await server.ssrLoadModule('/scripts/hand-fixture.mjs');
    code = await mod.main();
  } finally {
    await server.close();
  }
  process.exit(code);
}
