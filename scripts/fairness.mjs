/**
 * Physics dice fairness (rolling by hand, Task 4; G10).
 *
 * `npm run test:fairness` throws 10,000 free one-die throws per shape through the real Rapier sim
 * (half a human-like random launch, half the seeded spawn), reads each settled pose with Task 1's
 * readers, runs a chi-square test on the face counts, writes docs/research/fairness.md and exits
 * non-zero when any shape has p <= 0.01. `chiSquare` and `runFairness` are exported for the fast
 * regression test (tests/unit/fairness.test.js).
 *
 * The sim imports the Rapier package, which plain Node cannot resolve (see
 * build/rapier-wasm-plugin.js), so run as a script this file loads itself through Vite's SSR loader
 * with that plugin and calls the loaded copy.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const FAIR_TYPES = ['d2', 'd4', 'd4crystal', 'd6', 'd8', 'd10', 'd12', 'd14', 'd16', 'd20'];
/** A shape fails at p <= FAIR_P (G10). */
export const FAIR_P = 0.01;
export const FAIR_THROWS = 10000;
export const FAIR_SEED = 20261114;
/** The default stage rectangle of the sim tests (die units). */
const AREA = { halfWidth: 12, halfDepth: 7 };
const ROOT = new URL('../', import.meta.url);

// ---------------------------------------------------------------- statistics

/** ln Γ(x), Lanczos (g = 7, n = 9); |error| < 1e-13 for x > 0. */
function lnGamma(x) {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Regularized upper incomplete gamma Q(a, x) = Γ(a, x) / Γ(a): series below a + 1, else Lentz. */
export function gammaQ(a, x) {
  if (x <= 0) return 1;
  const lead = -x + a * Math.log(x) - lnGamma(a);
  if (x < a + 1) {
    let sum = 1 / a;
    let term = sum;
    for (let n = 1; n < 1000 && Math.abs(term) > Math.abs(sum) * 1e-15; n++) {
      term *= x / (a + n);
      sum += term;
    }
    return Math.max(0, 1 - sum * Math.exp(lead));
  }
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.exp(lead) * h;
}

/**
 * Pearson's chi-square goodness of fit of `counts` against a uniform die: stat, degrees of
 * freedom (faces - 1) and p = Q(df / 2, stat / 2).
 * @param {number[]} counts
 * @returns {{stat: number, df: number, p: number}}
 */
export function chiSquare(counts) {
  const total = counts.reduce((s, c) => s + c, 0);
  const e = total / counts.length;
  const stat = counts.reduce((s, c) => s + (c - e) ** 2 / e, 0);
  const df = counts.length - 1;
  return { stat, df, p: gammaQ(df / 2, stat / 2) };
}

// ---------------------------------------------------------------- the run

/** Seed of throw i of a shape: a 32-bit mix of seed0, the shape's name and i. */
function throwSeed(seed0, type, i) {
  let h = (seed0 ^ 0x811c9dc5) >>> 0;
  for (const ch of `${type}:${i}`) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return h;
}

/**
 * A human-like release: anywhere in the area away from the walls, 1.5..4 up, any orientation,
 * flicked 6..30 units/s in any horizontal direction (slightly up or down) with 3..25 rad/s of spin.
 */
function humanLaunch(rand, { halfWidth, halfDepth }) {
  const u = [rand(), rand(), rand()];
  const a = Math.sqrt(1 - u[0]);
  const b = Math.sqrt(u[0]);
  const dir = rand() * 2 * Math.PI;
  const speed = 6 + rand() * 24;
  const ax = rand() * 2 - 1;
  const az = rand() * 2 * Math.PI;
  const r = Math.sqrt(1 - ax * ax);
  const spin = 3 + rand() * 22;
  return {
    pos: [
      (rand() * 2 - 1) * (halfWidth - 2),
      1.5 + rand() * 2.5,
      (rand() * 2 - 1) * (halfDepth - 2),
    ],
    quat: [
      a * Math.sin(2 * Math.PI * u[1]),
      a * Math.cos(2 * Math.PI * u[1]),
      b * Math.sin(2 * Math.PI * u[2]),
      b * Math.cos(2 * Math.PI * u[2]),
    ],
    linvel: [Math.cos(dir) * speed, rand() * 4 - 2, Math.sin(dir) * speed],
    angvel: [r * Math.cos(az) * spin, ax * spin, r * Math.sin(az) * spin],
  };
}

let ready = null;
/** The real sim, Task 1's readers and the shape table, initialised once per process. */
function load() {
  ready ??= (async () => {
    const [
      { initPhysics, createSim, prewarm },
      { computeHulls, computeReaders },
      reader,
      shapes,
      rng,
    ] = await Promise.all([
      import('../src/physics/sim.js'),
      import('../src/physics/hulls.js'),
      import('../src/core/face-reader.js'),
      import('../src/core/dice-shapes.js'),
      import('../src/core/rng.js'),
    ]);
    await initPhysics(
      readFileSync(
        new URL('node_modules/@dimforge/rapier3d-deterministic/rapier_wasm3d_bg.wasm', ROOT),
      ),
    );
    const sim = createSim(AREA, computeHulls(), computeReaders());
    prewarm(sim, FAIR_TYPES);
    return { sim, reader, shapes, rng };
  })();
  return ready;
}

/** One free one-die throw: the settled pose, its nudges and whether it ended cocked. */
function oneThrow({ sim }, req) {
  let last = null;
  const res = sim.throw(req, (c) => {
    if (c.done) last = c.data.slice((c.steps - 1) * 7, c.steps * 7);
    sim.recycle(c.data, c.events);
  });
  const q = { x: last[3], y: last[4], z: last[5], w: last[6] };
  return { q, p: [last[0], last[1], last[2]], nudges: res.nudges[0] };
}

/**
 * Throws `throws` free one-die throws per type (even i: a human-like launch from
 * mulberry32(seed ^ 0x5bd1e995); odd i: the seeded spawn), reads each settled pose and tests the
 * face counts.
 * - counts[v - 1]: throws whose read value is v (the face that counts; d16 from below, H-1).
 * - nudged: share of throws with at least one nudge (cocked or outside at rest; H-2).
 * - cocked: share still cocked after the last nudge (read anyway: the reading stands).
 * - rimRate (d2): share of coin throws whose first rest was on the rim (the same throw without
 *   `free` ends cocked); null for dice.
 * @returns {Promise<Record<string, {counts: number[], stat: number, df: number, p: number,
 *   nudged: number, cocked: number, rimRate: number|null, throws: number}>>}
 */
export async function runFairness({
  types = FAIR_TYPES,
  throws = FAIR_THROWS,
  seed0 = FAIR_SEED,
} = {}) {
  const env = await load();
  const { reader, shapes, rng } = env;
  const out = {};
  for (const type of types) {
    const shape = shapes.getShape(type);
    const faces = Math.max(...shape.values);
    const counts = Array(faces).fill(0);
    let nudged = 0;
    let cocked = 0;
    let rims = 0;
    for (let i = 0; i < throws; i++) {
      const seed = throwSeed(seed0, type, i);
      const req = { dice: [{ type }], seed, free: true };
      if (i % 2 === 0) req.launch = [humanLaunch(rng.mulberry32(seed ^ 0x5bd1e995), AREA)];
      const r = oneThrow(env, req);
      counts[reader.readResult(shape, r.q) - 1]++;
      if (reader.isCocked(shape, r.q)) cocked++;
      if (r.nudges > 0) {
        nudged++;
        // Identical frames up to the first rest: the plain throw shows what was nudged.
        if (type === 'd2' && reader.isCocked(shape, oneThrow(env, { ...req, free: false }).q))
          rims++;
      }
    }
    out[type] = {
      throws,
      counts,
      ...chiSquare(counts),
      nudged: nudged / throws,
      cocked: cocked / throws,
      rimRate: type === 'd2' ? rims / throws : null,
    };
  }
  return out;
}

// ---------------------------------------------------------------- the report

const pct = (x) => `${(x * 100).toFixed(2)} %`;

/** docs/research/fairness.md from a run. */
export function reportOf(results, { date, commit, seconds, unfair }) {
  const rows = Object.entries(results).map(
    ([t, r]) =>
      `| ${t} | ${r.throws} | ${r.df} | ${r.stat.toFixed(2)} | ${r.p.toFixed(4)} | ${
        r.p > FAIR_P ? 'pass' : '**fail**'
      } | ${pct(r.nudged)} | ${pct(r.cocked)} |`,
  );
  const counts = Object.entries(results).map(([t, r]) => `| ${t} | ${r.counts.join(' ')} |`);
  const coin = results.d2?.rimRate;
  const failing = Object.entries(results)
    .filter(([, r]) => r.p <= FAIR_P)
    .map(([t]) => t);
  return `# Physics dice fairness

Generated by \`npm run test:fairness\` (scripts/fairness.mjs) on ${date} at commit ${commit}, in
${seconds.toFixed(0)} s.

## Method

- Each shape gets ${Object.values(results)[0]?.throws ?? 0} free one-die throws (\`free: true\`, Task 2) through the real
  Rapier sim (\`createSim\` with \`computeHulls()\` and \`computeReaders()\`), on the default
  ${AREA.halfWidth * 2} x ${AREA.halfDepth * 2} die-unit stage.
- Even throws are a human-like launch: released anywhere at least 2 units inside the walls, 1.5..4
  units up, uniformly random orientation, flicked 6..30 units/s in a random horizontal direction
  (vertical -2..2) with 3..25 rad/s of spin about a random axis. Odd throws are the seeded spawn
  (the automatic throw's entry from beyond the stage edge). Seeds are fixed (seed0 ${FAIR_SEED}),
  so a run is reproducible.
- The settled pose is read by Task 1's \`readResult\` (the d4 and the d16 from below, the d16 as its
  paired top kite, H-1; the crystal d4 among its four read faces). A die that rests cocked or
  outside the area is nudged (at most 3 times); the reading then stands.
- Pearson's chi-square against a uniform die, df = faces - 1, p from the regularized upper gamma
  function Q(df/2, stat/2). A shape fails at p <= ${FAIR_P}.
- With ${Object.keys(results).length} shapes tested at 1 %, a perfectly fair set still shows one false failure about
  ${((1 - (1 - FAIR_P) ** Object.keys(results).length) * 100).toFixed(0)} % of the time; a failure is investigated, not taken on its own.

## Results

| Shape | Throws | df | chi-square | p | Result | Nudged | Cocked at end |
| --- | --- | --- | --- | --- | --- | --- | --- |
${rows.join('\n')}

"Nudged": throws with at least one nudge (a rest cocked or outside the area). "Cocked at end": still
cocked after the last nudge (3 used, or no time left); the reading stands, so these are counted.

Coin rim rate (first rest on the rim, then nudged flat): ${coin == null ? 'not run' : pct(coin)}.

Failing shapes: ${failing.length ? failing.join(', ') : 'none'}. \`HAND_UNFAIR\` (src/hand/unfair.js): ${
    unfair.length ? unfair.join(', ') : '[] (empty)'
  }.

### Face counts (value 1 first)

| Shape | Counts |
| --- | --- |
${counts.join('\n')}

## Hull notes

- Every die collides as Dicer's rounded hull for its type (\`hullPointsFor\`: the shrunk polyhedron
  plus a border radius, the exact Minkowski solid the rounded mesh draws). Sharp-edged looks and
  3D models reuse that rounded collider and read through the hull's pose (H-4), so their fairness
  is the rounded hull's, measured here.
- The coin is a cylinder collider; the d10 hull also throws the d100's two dice; relabel variants
  (d3 as d6, and the like) inherit their base shape's result.
- Rapier derives each body's mass properties from its collider (uniform density), so the centre
  of mass is the hull's own centroid, the same for every look.
`;
}

async function main() {
  const t0 = performance.now();
  const results = await runFairness();
  const seconds = (performance.now() - t0) / 1000;
  const { HAND_UNFAIR } = await import('../src/hand/unfair.js');
  let commit = 'unknown';
  try {
    const git = (args) =>
      execSync(`git ${args}`, { cwd: fileURLToPath(ROOT) })
        .toString()
        .trim();
    commit = git('rev-parse --short HEAD');
    if (git('status --porcelain -- src scripts'))
      commit += ' (plus uncommitted src/scripts changes)';
  } catch {
    // not a checkout
  }
  const date = new Date().toISOString().slice(0, 10);
  const file = new URL('docs/research/fairness.md', ROOT);
  // Formatted like every other doc (prettier is a dev dependency).
  const prettier = await import('prettier');
  const options = { ...(await prettier.resolveConfig(fileURLToPath(file))), parser: 'markdown' };
  const md = reportOf(results, { date, commit, seconds, unfair: HAND_UNFAIR });
  writeFileSync(file, await prettier.format(md, options));
  for (const [t, r] of Object.entries(results)) {
    console.log(
      `${t.padEnd(10)} n=${r.throws} chi2=${r.stat.toFixed(2)} df=${r.df} p=${r.p.toFixed(4)} ${
        r.p > FAIR_P ? 'pass' : 'FAIL'
      } nudged=${pct(r.nudged)} cocked=${pct(r.cocked)}${r.rimRate == null ? '' : ` rim=${pct(r.rimRate)}`}`,
    );
  }
  console.log(`${seconds.toFixed(1)} s; wrote docs/research/fairness.md`);
  return Object.values(results).some((r) => r.p <= FAIR_P) ? 1 : 0;
}

export { main };

// Run as a script: load this file through Vite (the Rapier plugin) and run the loaded copy.
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1] &&
  !globalThis.__dicerFairness
) {
  globalThis.__dicerFairness = true;
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
    const mod = await server.ssrLoadModule('/scripts/fairness.mjs');
    code = await mod.main();
  } finally {
    await server.close();
  }
  process.exit(code);
}
