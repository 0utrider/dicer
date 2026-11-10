# Dicer Plan 1: Foundation and First Roll — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When anyone posts a dice roll to chat in Foundry v14, Dicer throws chamfered 3D dice with engraved numbers that land on the real result. The chat message stays hidden until they land, the DSN-compatible hooks fire exactly once, and Dicer does no GPU work at all while idle.

**Architecture:**
- **Physics:** Rapier physics runs in one long-lived Web Worker. It streams simulated frames in chunks to the main thread. Dice spawn just outside the roll area, so the worker finishes the whole simulation before any die becomes visible. That lets each die's visual mesh be rotated so the real result lands face-up without a visible snap.
- **Rendering:** three.js draws on a single overlay canvas. The canvas is created once and never rebuilt, and it renders only while dice move.
- **Numbers:** drawn in the shader from an MSDF digit atlas. Engraving is derived from the distance field, so no textures are generated per appearance.
- **Chat:** a message gate hides intercepted chat messages with `dsn-hide`, and reveals them on landing or when a watchdog timer fires.

**Tech stack:**
- three.js `0.184.x`
- `@dimforge/rapier3d-deterministic-compat`, falling back to `@dimforge/rapier3d-compat` (Task 2 decides)
- Vite 6 library build
- Vitest with jsdom (designer's call: a Jest-compatible API that shares Vite's ESM and worker handling; the owner's other modules use Jest)
- ESLint 9 and Prettier 3 with the same configs as `pf2e-leveler`
- husky
- Playwright for the live smoke test
- `msdf-bmfont-xml` at build time

**Spec:** `docs/superpowers/specs/2026-11-10-dicer-design.md`. **Roadmap:** `docs/superpowers/plans/2026-11-10-dicer-roadmap.md`. This is plan 1 of 8.

## Global Constraints

- **Module id and paths:** module id `dicer`, title `Dicer`. Repo root is `C:\Users\User\AppData\Local\FoundryVTT\Data\modules\dicer`.
- **Foundry version:** Foundry `compatibility.minimum` "14", `verified` "14".
- **Copying:** no DSN code or assets are copied. DSN behaviour is reimplemented from its observed API.
- **DSN names are kept verbatim:** the hook names `diceSoNiceInit`, `diceSoNiceReady`, `diceSoNiceRollStart`, `diceSoNiceRollComplete` and `diceSoNiceMessageProcessed`, the CSS class `dsn-hide`, and the flag scope `dice-so-nice`.
- **Mutual exclusion:** if DSN (`game.modules.get('dice-so-nice')?.active`) is active, Dicer registers nothing (no hooks, no `game.dice3d`), and shows the GM a one-time notice.
- **Renderer settings:** WebGL2 only. `logarithmicDepthBuffer: false`. No full-screen post-processing. Pixel ratio defaults to `min(devicePixelRatio, 1.5)`.
- **Idle cost:** **zero** GPU work when no dice are on screen. No rAF callback is pending, and the canvas is hidden (`display:none`).
- **Resize** calls `renderer.setSize` only. It never recreates the renderer, the scene or the worker.
- **One physics worker** for the session, terminated in `dispose()`.
- **Bundle size:** `dist/` total is ≤ 4 MB. Checked by a test.
- **Hook guarantee:** `diceSoNiceRollComplete` fires exactly once per animated message. That includes deletion mid-roll, a hidden tab, context loss and render exceptions. Watchdog: landed, or 15000 ms after the start, whichever comes first.
- **Privacy:** a message whose content isn't visible to this user (`!message.isContentVisible`) is never animated on that client. The full privacy matrix is Plan 3.
- **Formatting and globals:** Prettier config is identical to `pf2e-leveler/.prettierrc.json` (printWidth 100, singleQuote, trailingComma all). ESLint globals as in `pf2e-leveler/eslint.config.mjs`.

## Review Focus

1. **Huge pools** (`100d6`): only `maxDice` (default 20) dice animate, and the message is still revealed on landing. Owned by Task 9.
2. **Unsupported dice** (`1d7`, `4dF`, custom terms) and `d100`: unsupported ones are skipped. If nothing is left, nothing animates and the message isn't hidden. `d100` becomes a tens d10 plus a ones d10. Owned by Task 9.
3. **Message deleted mid-animation:** no exceptions, the dice clear, and `diceSoNiceRollComplete` fires once. Owned by Task 10.
4. **Two rolls arriving within the same frame:** both animate, and both reveal independently. Owned by Task 10.
5. **Tab hidden during a roll** (rAF paused): the watchdog reveals the message within 15 s, and stale dice don't replay when the tab returns. Owned by Tasks 8 and 10.

---

## File Structure

```
dicer/
  module.json                     Foundry manifest → dist/dicer.js, styles/dicer.css
  package.json  vite.config.js  vitest.config.js  eslint.config.mjs  .prettierrc.json  .gitignore
  styles/dicer.css                .dsn-hide, overlay canvas styles
  scripts/build-sdf.mjs           generates assets/fonts/digits.{png,json}
  assets/fonts/                   OFL font source + generated MSDF atlas + LICENSE
  src/main.js                     Foundry entry: coexistence check, settings, wiring
  src/settings.js                 setting registration + typed getters
  src/foundry/coexistence.js      DSN detection + GM notice
  src/foundry/message-gate.js     chat interception, hide/reveal, hooks, watchdog
  src/api/dice3d.js               minimal game.dice3d surface
  src/core/dice-shapes.js         polyhedron definitions, face values, labels
  src/core/face-reader.js         top face detection + result rotation math
  src/core/chamfer.js             chamfered BufferGeometry with face ids and face UVs
  src/core/rng.js                 seeded RNG (mulberry32)
  src/physics/sim.js              pure Rapier simulation (Node + worker)
  src/physics/protocol.js         worker message types + chunk layout constants
  src/physics/physics.worker.js   worker shell around sim.js
  src/physics/physics-client.js   main-thread client, buffer pool, streams
  src/render/renderer.js          DiceRenderer: canvas lifecycle, on-demand loop
  src/render/scene.js             camera fit, lights, environment, blob shadows
  src/render/sdf-atlas.js         atlas loading + label layout
  src/render/dice-material.js     MeshPhysicalMaterial + MSDF engraving patch
  src/throw/throw-planner.js      Roll → DieSpec[]
  src/throw/playback.js           chunk playback, visibility gate, result rotation
  src/throw/dice-box.js           orchestrates physics + render + playback per roll
  dev/preview.html  dev/preview.js  standalone look/dev page (vite dev server)
  tests/unit/*.test.js
  tests/live/smoke.mjs  tests/live/world.js
  docs/research/dsn-integration-survey.md
```

---

### Task 1: DSN integration survey and licence check (spec §8.1, §8.2)

**Files:**
- Create: `docs/research/dsn-integration-survey.md`

**Interfaces:** none. This is a research deliverable that Plan 3 consumes.

- [ ] **Step 1: Check DSN's licence.** Read `C:\Users\User\AppData\Local\FoundryVTT\Data\modules\dice-so-nice\` for a licence file, plus the GitLab repo `gitlab.com/riccisi/foundryvtt-dice-so-nice` (LICENSE file). Record the licence name and what it allows: reading for API behaviour only, and no copying.
- [ ] **Step 2: Survey integrations.**
  - **What to search:** the GitHub/GitLab source of dnd5e, pf2e, swade, wfrp4e, sw5e, CoC7, cyberpunk-red-core, pf2e-toolbelt, and the 5 most-installed dice-set modules on foundryvtt.com. Search each for `dice-so-nice`, `dice3d` and `diceSoNice`.
  - **What to record per package:** (a) the hooks used, (b) the `game.dice3d` members used, (c) any import of `/modules/dice-so-nice/api.js` (static or dynamic, with a code link), and (d) any reach into internals (`box`, `DiceFactory`, three.js objects).
- [ ] **Step 3: Write the survey doc.** Write `docs/research/dsn-integration-survey.md` with:
  - a table, one row per package, columns `package | hooks | dice3d members | api.js import | internals`;
  - a "Must-support list for Plan 3" ranked by how many packages use each member;
  - the licence finding.
- [ ] **Step 4: Commit.**

```bash
git add docs/research/dsn-integration-survey.md
git commit -m "docs: DSN integration survey and licence check"
```

### Task 2: Scaffold, build and bundle-size guard

**Files:**
- Create: `module.json`, `package.json`, `vite.config.js`, `vitest.config.js`, `eslint.config.mjs`, `.prettierrc.json`, `.gitignore`, `styles/dicer.css`, `src/main.js`
- Test: `tests/unit/build.test.js`

**Interfaces:**
- Produces:
  - `npm run build` → `dist/dicer.js` (ES module, the single entry), with workers inlined via `?worker&inline`.
  - `npm test` → vitest run.
  - `npm run dev` → vite dev server serving `dev/preview.html`.
  - `npm run lint`.

- [ ] **Step 1: Choose the Rapier package.**
  - Run `npm view @dimforge/rapier3d-deterministic-compat version`. If it resolves, depend on it. Otherwise depend on `@dimforge/rapier3d-compat`, and add a note to the survey doc that cross-browser determinism must be verified in Plan 6.
  - Also depend on `three@~0.184.0`.
  - Dev dependencies: `vite@^6`, `vitest`, `jsdom`, `eslint@^9`, `@eslint/js`, `eslint-config-prettier`, `eslint-plugin-prettier`, `globals`, `prettier@^3`, `husky`, `playwright`, `msdf-bmfont-xml`.
- [ ] **Step 2: Write the manifest and build config.**
  - `module.json`:
    - id, title and compatibility as in the Global Constraints;
    - `"esmodules": ["dist/dicer.js"]`, `"styles": ["styles/dicer.css"]`, `"socket": true`;
    - author `RoiLeaf` (discord `RoiLeaf`), matching `pf2e-leveler/module.json`.
  - `vite.config.js`: library mode, entry `src/main.js`, `formats: ['es']`, `fileName: () => 'dicer.js'`, `outDir: 'dist'`, `emptyOutDir: true`. The dev server root serves `dev/`.
  - `.gitignore`: `node_modules/`, `dist/`, `artifacts/`, `coverage/`.
  - `src/main.js`: for now, only `Hooks.once('init', () => console.log('dicer | init'))`.
- [ ] **Step 3: Write the failing build test.** In `tests/unit/build.test.js`:

```js
import { execSync } from 'node:child_process';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('build', () => {
  beforeAll(() => execSync('npx vite build', { stdio: 'pipe' }), 120000);
  it('emits dist/dicer.js referenced by module.json', () => {
    const manifest = JSON.parse(readFileSync('module.json', 'utf8'));
    expect(manifest.esmodules).toEqual(['dist/dicer.js']);
    expect(statSync('dist/dicer.js').isFile()).toBe(true);
  });
  it('keeps dist under 4 MB', () => {
    const total = readdirSync('dist', { recursive: true })
      .map((f) => join('dist', f))
      .filter((p) => statSync(p).isFile())
      .reduce((sum, p) => sum + statSync(p).size, 0);
    expect(total).toBeLessThanOrEqual(4 * 1024 * 1024);
  });
});
```

- [ ] **Step 4: Run the build test.** Run `npx vitest run tests/unit/build.test.js`. Expected: PASS. The scaffold is tiny, so both tests pass now; they guard every later task.
- [ ] **Step 5: Set up the pre-commit hook.** Run `npx husky init`, and set `.husky/pre-commit` to `npm run lint && npm test`.
- [ ] **Step 6: Commit.**

```bash
git add -A
git commit -m "chore: scaffold dicer module with vite build and size guard"
```

### Task 3: Die shapes, face reading and result rotation

**Files:**
- Create: `src/core/dice-shapes.js`, `src/core/face-reader.js`, `src/core/rng.js`
- Test: `tests/unit/dice-shapes.test.js`, `tests/unit/face-reader.test.js`

**Interfaces:**
- Produces:
  - **Types:** `DieType = 'd2'|'d4'|'d6'|'d8'|'d10'|'d12'|'d20'`.
  - **Shape definition:** `ShapeDef = { type, kind: 'polyhedron'|'coin', vertices: number[][], faces: number[][], values: number[], readMode: 'up'|'down' }`.
    - Vertices are unit circumradius, and faces are CCW when seen from outside.
    - `values[i]` is the result for face `i`.
  - **Shape lookup:** `getShape(type: DieType): ShapeDef`, and `dieTypeForFaces(faces: number): DieType | null`, which returns `null` for anything other than 2, 4, 6, 8, 10, 12 or 20.
  - **Labels:** `labelFor(type: DieType, value: number, variant?: 'd100tens'): string`.
    - d10: value 10 shows `"0"`, and value `1..9` shows the digit.
    - d100tens: value `10..90` shows `"10".."90"`, and value 100 or 0 shows `"00"`.
    - `6` and `9` get the suffix `"."`, so `"6."` and `"9."` are drawn with an underline mark.
  - **Face maths** (`{x,y,z,w}` and `{x,y,z}` are plain objects):
    - `faceNormals(shape): {x,y,z}[]` — local unit normals; for a coin, the two cap normals.
    - `readTopFace(shape, q: {x,y,z,w}): number` — the face index whose world normal has the largest +Y component (smallest, for `readMode 'down'`).
    - `faceForValue(shape, value): number`.
    - `rotationToShow(shape, landedFace, targetFace): {x,y,z,w}` — a local rotation `R` such that `R · n_target = n_landed`. Applied to the inner mesh, it makes the target face occupy the landed face's world direction.
  - **RNG:** `mulberry32(seed: number): () => number` (in `rng.js`).

- [ ] **Step 1: Write the failing tests.**

```js
// tests/unit/dice-shapes.test.js
const TYPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'];
const SUMS = { d6: 7, d8: 9, d12: 13, d20: 21 };
test.each(TYPES)('%s has one value per face and all values 1..n', (t) => {
  const s = getShape(t);
  const n = Number(t.slice(1));
  expect(s.faces.length).toBe(n);
  expect([...s.values].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
});
test.each(Object.entries(SUMS))('%s opposite faces sum to %i', (t, sum) => {
  const s = getShape(t);
  const normals = faceNormals(s);
  normals.forEach((n, i) => {
    const opp = normals.findIndex((m) => n.x * m.x + n.y * m.y + n.z * m.z < -0.999);
    expect(s.values[i] + s.values[opp]).toBe(sum);
  });
});
test('d10 labels and d100 tens labels', () => {
  expect(labelFor('d10', 10)).toBe('0');
  expect(labelFor('d10', 6)).toBe('6.');
  expect(labelFor('d10', 100, 'd100tens')).toBe('00');
  expect(labelFor('d10', 90, 'd100tens')).toBe('90');
});
test('dieTypeForFaces', () => {
  expect(dieTypeForFaces(20)).toBe('d20');
  expect(dieTypeForFaces(7)).toBeNull();
  expect(dieTypeForFaces(100)).toBeNull();
});
```

```js
// tests/unit/face-reader.test.js
const ALL = ['d2', 'd4', 'd6', 'd8', 'd10', 'd12', 'd20'];
test.each(ALL)('%s: rotationToShow maps every target face onto every landed face', (t) => {
  const s = getShape(t);
  const normals = faceNormals(s);
  for (let landed = 0; landed < normals.length; landed++)
    for (let target = 0; target < normals.length; target++) {
      const R = new THREE.Quaternion().copy(rotationToShow(s, landed, target));
      const v = new THREE.Vector3().copy(normals[target]).applyQuaternion(R);
      expect(v.dot(new THREE.Vector3().copy(normals[landed]))).toBeGreaterThan(0.9999);
    }
});
test.each(ALL)('%s: readTopFace finds the face rotated to point up', (t) => {
  const s = getShape(t);
  faceNormals(s).forEach((n, i) => {
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3().copy(n),
      new THREE.Vector3(0, s.readMode === 'down' ? -1 : 1, 0),
    );
    expect(readTopFace(s, q)).toBe(i);
  });
});
test('mulberry32 is deterministic', () => {
  const a = mulberry32(42), b = mulberry32(42);
  expect([a(), a(), a()]).toEqual([b(), b(), b()]);
});
```

- [ ] **Step 2: Run the tests to see them fail.** Run `npx vitest run tests/unit/dice-shapes.test.js tests/unit/face-reader.test.js`. Expected: FAIL (modules not found).
- [ ] **Step 3: Implement the shapes.**
  - **Shapes:** d4 tetrahedron (`readMode 'down'`), d6 cube, d8 octahedron, d10 pentagonal trapezohedron, d12 dodecahedron, d20 icosahedron. d2 is `kind 'coin'`: cap faces 0 (value 1, +Y) and 1 (value 2, −Y), with an empty vertex list. Chamfer handles it as a cylinder.
  - **Face values** are assigned so that opposite faces sum to n+1 where the tests require it. For the d10, opposite faces sum to 11 (10 shows as "0").
  - **rotationToShow:** use `setFromUnitVectors(n_target, n_landed)`, then add a twist around `n_landed` that aligns the target face's first-edge direction with the landed face's first-edge direction. That keeps the numbers upright relative to the face, which the test doesn't check but the look needs. For the coin, use π about X when the faces differ.
- [ ] **Step 4: Run the tests to see them pass.** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add src/core tests/unit/dice-shapes.test.js tests/unit/face-reader.test.js
git commit -m "feat: die shapes, face reading and result rotation"
```

### Task 4: Chamfered geometry

**Files:**
- Create: `src/core/chamfer.js`
- Test: `tests/unit/chamfer.test.js`

**Interfaces:**
- Consumes: `getShape`, `faceNormals` (Task 3).
- Produces: `buildDieGeometry(shape: ShapeDef, opts?: { chamfer?: number = 0.06, bevelSegments?: number = 2 }): THREE.BufferGeometry`.
  - **Attributes:**
    - `position` and `normal`.
    - `aFaceId` (Float32, 1 component): the face index, or `-1` on chamfer and corner triangles.
    - `aFaceUV` (Float32, 2 components): face-local 2D coordinates, origin at the face centroid, scaled so the face's inradius is 1. The +V axis points from the centroid towards the face's first vertex (or, for the d4, its labelling convention).
  - **Group/userData:** `geometry.userData.faceCount`.

- [ ] **Step 1: Write the failing tests.**

```js
const ALL = ['d2', 'd4', 'd6', 'd8', 'd10', 'd12', 'd20'];
test.each(ALL)('%s fits inside the unit sphere', (t) => {
  const g = buildDieGeometry(getShape(t));
  g.computeBoundingSphere();
  expect(g.boundingSphere.radius).toBeLessThanOrEqual(1.0001);
});
test.each(ALL)('%s face triangles carry their face normal', (t) => {
  const s = getShape(t);
  const g = buildDieGeometry(s);
  const ids = g.getAttribute('aFaceId'), nrm = g.getAttribute('normal');
  const normals = faceNormals(s);
  const seen = new Set();
  for (let i = 0; i < ids.count; i++) {
    const f = ids.getX(i);
    if (f < 0) continue;
    seen.add(f);
    const d = nrm.getX(i) * normals[f].x + nrm.getY(i) * normals[f].y + nrm.getZ(i) * normals[f].z;
    expect(d).toBeGreaterThan(0.9998);
  }
  expect(seen.size).toBe(normals.length);
});
test('chamfer produces bevel triangles; chamfer 0 produces none', () => {
  const ids = (c) => buildDieGeometry(getShape('d20'), { chamfer: c }).getAttribute('aFaceId').array;
  expect(Array.from(ids(0.06)).some((f) => f === -1)).toBe(true);
  expect(Array.from(ids(0)).some((f) => f === -1)).toBe(false);
});
test('aFaceUV is ~0 at face centroids and within inradius-scaled bounds', () => {
  const g = buildDieGeometry(getShape('d6'));
  const uv = g.getAttribute('aFaceUV'), ids = g.getAttribute('aFaceId');
  for (let i = 0; i < uv.count; i++)
    if (ids.getX(i) >= 0) expect(Math.hypot(uv.getX(i), uv.getY(i))).toBeLessThanOrEqual(Math.SQRT2 + 1e-4);
});
```

- [ ] **Step 2: Run the tests to see them fail.** Run `npx vitest run tests/unit/chamfer.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement `buildDieGeometry`.**
  - Shrink each face towards its centroid along the face plane by `chamfer`, and push it inward along its normal so the bevel stays inside the unit sphere.
  - Bridge each shared edge with a `bevelSegments`-strip whose normals rotate from one face normal to the other (slerp).
  - Fill each original vertex with a fan whose normals blend all the adjacent face normals.
  - Output is non-indexed. The coin is a cylinder (radius 1, height 0.25) with rounded rims, built the same way.
- [ ] **Step 4: Run the tests to see them pass.** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add src/core/chamfer.js tests/unit/chamfer.test.js
git commit -m "feat: chamfered die geometry with face ids and face UVs"
```

### Task 5: Physics simulation, worker and client

**Files:**
- Create: `src/physics/sim.js`, `src/physics/protocol.js`, `src/physics/physics.worker.js`, `src/physics/physics-client.js`
- Test: `tests/unit/sim.test.js`, `tests/unit/physics-client.test.js`

**Interfaces:**
- Consumes: `getShape` (Task 3), `mulberry32` (Task 3).
- Produces:
  - **`protocol.js`:**
    - `FLOATS_PER_DIE = 7` (layout `px,py,pz,qx,qy,qz,qw`), `CHUNK_STEPS = 30`, `MAX_STEPS = 600`, `STEP_SECONDS = 1/60`.
    - Message types: `'init'|'resize'|'throw'|'chunk'|'done'|'recycle'|'error'`.
  - **`sim.js`:**
    - `initPhysics(): Promise<void>`.
    - `createSim(area: { halfWidth: number, halfDepth: number }): Sim`. World units: 1 = the die's circumradius. The floor is at y = 0, with walls on the 4 sides of the half-extents.
    - **`Sim.throw(req, onChunk)`:**
      - Request: `req = { dice: { type: DieType }[], seed: number }`.
      - Callback: `onChunk({ index: number, steps: number, data: Float32Array, done: boolean })`. `data.length = steps × dice.length × 7`.
      - Returns `{ settledStep: number }`.
      - Dice spawn just **outside** one seeded edge of the area: at least 1.5 units beyond the wall, which is opened for spawning. Each die gets an initial velocity towards a seeded point inside the inner 60% of the area, plus a seeded spin.
      - The walls close behind the dice when every die is inside.
      - It stops when every body is asleep, or at `MAX_STEPS`.
    - Also on `Sim`: `resize(area)` and `dispose()`.
  - **`physics-client.js`:**
    - `class PhysicsClient { constructor(createWorker: () => Worker); ready(): Promise<void>; resize(area): void; throw(req): ThrowStream; recycle(buffer: Float32Array): void; terminate(): void }`.
    - `ThrowStream = { onChunk(cb: (chunk) => void): void, done: Promise<{ settledStep: number }> }`.
    - Chunk buffers are transferred both ways. `recycle` returns buffers to the worker's pool.

- [ ] **Step 1: Write the failing sim tests.** These run Rapier in Node.

```js
beforeAll(() => initPhysics());
const area = { halfWidth: 12, halfDepth: 7 };
function run(dice, seed) {
  const sim = createSim(area);
  const chunks = [];
  const res = sim.throw({ dice: dice.map((type) => ({ type })), seed }, (c) => chunks.push({ ...c, data: c.data.slice() }));
  sim.dispose();
  return { res, chunks };
}
test('same seed gives identical frames', () => {
  const a = run(['d20', 'd6', 'd6'], 7), b = run(['d20', 'd6', 'd6'], 7);
  expect(a.chunks.map((c) => Array.from(c.data))).toEqual(b.chunks.map((c) => Array.from(c.data)));
});
test.each([1, 10, 30])('%i dice settle inside the area before MAX_STEPS', (n) => {
  const { res, chunks } = run(Array(n).fill('d6'), 3);
  expect(res.settledStep).toBeLessThan(MAX_STEPS);
  const last = chunks.at(-1);
  expect(last.done).toBe(true);
  const base = (last.steps - 1) * n * FLOATS_PER_DIE;
  for (let d = 0; d < n; d++) {
    const o = base + d * FLOATS_PER_DIE;
    expect(Math.abs(last.data[o])).toBeLessThan(area.halfWidth);
    expect(Math.abs(last.data[o + 2])).toBeLessThan(area.halfDepth);
  }
});
test('dice start outside the area', () => {
  const { chunks } = run(['d20'], 11);
  const [x, , z] = chunks[0].data;
  expect(Math.abs(x) > area.halfWidth || Math.abs(z) > area.halfDepth).toBe(true);
});
test('first chunk arrives in under 50 ms for 30 dice', () => {
  const sim = createSim(area);
  const t0 = performance.now();
  let first = null;
  sim.throw({ dice: Array(30).fill({ type: 'd6' }), seed: 1 }, () => (first ??= performance.now()));
  sim.dispose();
  expect(first - t0).toBeLessThan(50);
});
```

- [ ] **Step 2: Run the sim tests to see them fail.** Run `npx vitest run tests/unit/sim.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement `sim.js`.**
  - **Colliders:** `ColliderDesc.convexHull` from the shape vertices, scaled to match the chamfered visual hull. The coin uses `ColliderDesc.cylinder(0.125, 1)`.
  - **Physics settings:** gravity `-9.81 × 4` (dice-scale units), restitution 0.35 and friction 0.5 for dice, friction 0.8 for the floor.
  - **Rendering of state:** CCD is enabled on the dice. The integration step is `STEP_SECONDS`.
  - **Output buffers:** `onChunk` is called every `CHUNK_STEPS` steps, and once more with `done: true` for the final partial chunk. Take the next buffer from an internal pool, so no allocation happens per chunk once the pool is warm.
- [ ] **Step 4: Run the sim tests to see them pass.** Run the same command. Expected: PASS.
- [ ] **Step 5: Write the failing client tests.** These use a fake worker.

```js
class FakeWorker { constructor() { this.sent = []; this.terminated = false; } postMessage(m, t) { this.sent.push({ m, t }); } terminate() { this.terminated = true; } emit(data) { this.onmessage({ data }); } }
test('throw before ready is queued, chunks are forwarded in order, done resolves', async () => {
  const w = new FakeWorker();
  const client = new PhysicsClient(() => w);
  const stream = client.throw({ dice: [{ type: 'd20' }], seed: 1 });
  expect(w.sent.some((s) => s.m.type === 'throw')).toBe(false);
  w.emit({ type: 'ready' });
  await client.ready();
  const throwMsg = w.sent.find((s) => s.m.type === 'throw').m;
  const got = [];
  stream.onChunk((c) => got.push(c.index));
  w.emit({ type: 'chunk', id: throwMsg.id, index: 0, steps: 30, data: new Float32Array(210), done: false });
  w.emit({ type: 'chunk', id: throwMsg.id, index: 1, steps: 5, data: new Float32Array(35), done: true });
  w.emit({ type: 'done', id: throwMsg.id, settledStep: 35 });
  await expect(stream.done).resolves.toEqual({ settledStep: 35 });
  expect(got).toEqual([0, 1]);
});
test('recycle transfers the buffer back; terminate terminates the single worker', () => {
  let created = 0;
  const w = new FakeWorker();
  const client = new PhysicsClient(() => (created++, w));
  const buf = new Float32Array(7);
  client.recycle(buf);
  expect(w.sent.at(-1).t).toEqual([buf.buffer]);
  client.resize({ halfWidth: 5, halfDepth: 5 });
  expect(created).toBe(1);
  client.terminate();
  expect(w.terminated).toBe(true);
});
```

- [ ] **Step 6: Run the client tests to see them fail.** Run `npx vitest run tests/unit/physics-client.test.js`. Expected: FAIL.
- [ ] **Step 7: Implement the client and worker.**
  - `physics-client.js`: each throw gets an incrementing `id`, and chunks are routed by id.
  - `physics.worker.js`: on `init`, call `initPhysics()` then post `{type:'ready'}`. It holds one `Sim`, and handles `resize`, `throw` and `recycle` (returned buffers go back into the sim's pool). Errors are posted as `{type:'error', id, message}`, and the client rejects that stream's `done`.
  - In `main.js` (Task 10), the worker is created via `import PhysicsWorker from './physics/physics.worker.js?worker&inline'`.
- [ ] **Step 8: Run all physics tests to see them pass.** Run `npx vitest run tests/unit/sim.test.js tests/unit/physics-client.test.js`. Expected: PASS.
- [ ] **Step 9: Commit.**

```bash
git add src/physics tests/unit/sim.test.js tests/unit/physics-client.test.js
git commit -m "feat: Rapier simulation in a worker with streamed, pooled frame chunks"
```

### Task 6: MSDF digit atlas and the engraved dice material

**Files:**
- Create: `scripts/build-sdf.mjs`, `assets/fonts/` (an OFL-licensed serif TTF of the builder's choice, its `OFL.txt`, and the generated `digits.png` + `digits.json`), `src/render/sdf-atlas.js`, `src/render/dice-material.js`
- Modify: `package.json` (add the `"build:sdf": "node scripts/build-sdf.mjs"` script)
- Test: `tests/unit/sdf-atlas.test.js`, `tests/unit/dice-material.test.js`

**Interfaces:**
- Consumes: `labelFor`, `getShape` (Task 3); `aFaceId` and `aFaceUV` (Task 4).
- Produces:
  - **`sdf-atlas.js`:**
    - `parseAtlas(json): Atlas`, where `Atlas = { glyphs: Map<string, { u0, v0, u1, v1, w, h }>, distanceRange: number }`.
    - `loadDigitAtlas(baseUrl: string): Promise<Atlas & { texture: THREE.Texture }>`.
    - `layoutLabel(label: string, atlas: Atlas, size?: number = 0.62): Float32Array(12)`. Each of up to 2 glyphs is packed as `[x0,y0,x1,y1 (face-local), u0,v0,…]`, with `"."` meaning the underline mark. The block is centred at the origin, and unused slots are zero.
  - **`dice-material.js`:**
    - `createDiceMaterial(appearance: { body: 'opaque'|'metal'|'resin', bodyColor: string, fillColor: string, fillMetallic: boolean, engraveDepth?: number = 0.5 }, atlas, shape: ShapeDef, labels: string[]): THREE.MeshPhysicalMaterial`.
      - Uniforms are on `material.userData.uniforms`: `uAtlas`, `uLabels` (a DataTexture, faceCount × 3 RGBA float texels), `uFillColor`, `uEngrave`.
      - `customProgramCacheKey()` returns `'dicer-' + appearance.body`, so there is one shader program per body type, never per colour or per die.
    - `updateLabels(material, labels: string[], atlas)` rewrites `uLabels` in place.

- [ ] **Step 1: Write the failing tests.**

```js
// tests/unit/sdf-atlas.test.js
const atlas = parseAtlas(JSON.parse(readFileSync('assets/fonts/digits.json', 'utf8')));
test('atlas has 0-9 and the underline mark', () => {
  for (const c of '0123456789.') expect(atlas.glyphs.has(c)).toBe(true);
});
test('two-digit label lays out two centred, non-overlapping glyphs', () => {
  const L = layoutLabel('20', atlas);
  const [ax0, , ax1] = L, [bx0, , bx1] = L.slice(6);
  expect(ax1).toBeLessThanOrEqual(bx0 + 1e-6);
  expect((ax0 + bx1) / 2).toBeCloseTo(0, 3);
});
test('"6." lays out a digit and an underline below it', () => {
  const L = layoutLabel('6.', atlas);
  expect(L[6 + 3]).toBeLessThan(L[1]); // underline top below digit bottom
});
```

```js
// tests/unit/dice-material.test.js
const atlas = { ...parseAtlas(JSON.parse(readFileSync('assets/fonts/digits.json', 'utf8'))), texture: new THREE.Texture() };
const s = getShape('d20');
const labels = s.values.map((v) => labelFor('d20', v));
test('program cache key depends on body only', () => {
  const a = createDiceMaterial({ body: 'resin', bodyColor: '#f00', fillColor: '#fc0', fillMetallic: true }, atlas, s, labels);
  const b = createDiceMaterial({ body: 'resin', bodyColor: '#00f', fillColor: '#fff', fillMetallic: false }, atlas, s, labels);
  expect(a.customProgramCacheKey()).toBe(b.customProgramCacheKey());
});
test('label texture has 3 texels per face and updates in place', () => {
  const m = createDiceMaterial({ body: 'opaque', bodyColor: '#fff', fillColor: '#000', fillMetallic: false }, atlas, s, labels);
  const tex = m.userData.uniforms.uLabels.value;
  expect(tex.image.width * tex.image.height).toBe(s.faces.length * 3);
  updateLabels(m, labels.slice().reverse(), atlas);
  expect(m.userData.uniforms.uLabels.value).toBe(tex);
  expect(tex.needsUpdate || tex.version > 0).toBeTruthy();
});
test('body presets', () => {
  const metal = createDiceMaterial({ body: 'metal', bodyColor: '#c90', fillColor: '#210', fillMetallic: false }, atlas, s, labels);
  const resin = createDiceMaterial({ body: 'resin', bodyColor: '#28f', fillColor: '#fc0', fillMetallic: true }, atlas, s, labels);
  expect(metal.metalness).toBe(1);
  expect(resin.transmission).toBeGreaterThan(0.5);
});
```

- [ ] **Step 2: Generate the atlas.** Write `scripts/build-sdf.mjs`. It uses `msdf-bmfont-xml` on the TTF with the charset `0123456789` plus a rendered underline glyph mapped to `"."`, field type `msdf`, size 64, distance range 8, and writes `assets/fonts/digits.png` + `digits.json`. Run `npm run build:sdf` and commit both outputs, so the build doesn't need the generator.
- [ ] **Step 3: Run the tests to see them fail.** Run `npx vitest run tests/unit/sdf-atlas.test.js tests/unit/dice-material.test.js`. Expected: FAIL (modules missing).
- [ ] **Step 4: Implement the atlas loader and the material.**
  - **Body presets:**
    - opaque: roughness 0.35, clearcoat 0.6;
    - metal: metalness 1, roughness 0.28;
    - resin: transmission 0.9, thickness 1.2, ior 1.52, attenuation colour = bodyColor, roughness 0.05, clearcoat 1.
  - **Shader patch** via `onBeforeCompile`: pass `aFaceId` and `aFaceUV` as varyings. In the fragment shader:

```glsl
// for faceId >= 0: fetch 3 texels from uLabels → up to 2 glyph rects (+ uv rects)
// for each glyph: if vFaceUV inside rect → sample MSDF, d = median(r,g,b) - 0.5, scaled by distanceRange
// mask = smoothstep(-w, w, d) where w = fwidth(d)
// engraving: inside the glyph the surface sits uEngrave * 0.02 below; within a bevel band |d| < band,
//   perturb the normal along the SDF gradient (dFdx/dFdy of d) so glyph walls catch light
// diffuseColor = mix(body, uFillColor, mask); metalness/roughness = mix(body, fill, mask)
//   (fillMetallic → metalness 1, roughness 0.3; else metalness 0, roughness 0.6);
//   transmission *= 1 - mask (fill is opaque)
```

- [ ] **Step 5: Run the tests to see them pass.** Run the same command. Expected: PASS.
- [ ] **Step 6: Commit.**

```bash
git add scripts/build-sdf.mjs assets/fonts src/render/sdf-atlas.js src/render/dice-material.js tests/unit/sdf-atlas.test.js tests/unit/dice-material.test.js package.json
git commit -m "feat: MSDF digit atlas and engraved dice material"
```

### Task 7: Renderer lifecycle and scene

**Files:**
- Create: `src/render/renderer.js`, `src/render/scene.js`
- Test: `tests/unit/renderer.test.js`

**Interfaces:**
- Produces:
  - **The renderer class:** `class DiceRenderer`.
    - **Constructor:** `constructor({ container: HTMLElement, createRenderer?: (canvas) => WebGLRendererLike, raf?, caf?, pixelRatioCap?: number = 1.5 })`.
      - The default `createRenderer` is `new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, logarithmicDepthBuffer: false, powerPreference: 'high-performance' })`.
      - It creates exactly one `<canvas id="dicer-canvas">` in `container`, initially hidden (`display:none`).
    - **Members:**
      - `setArea(rect: { left, top, width, height }): void` — sets the canvas position and CSS size, and calls `renderer.setSize(width, height, false)` and `setPixelRatio(min(devicePixelRatio, cap))`.
      - `startLoop(tick: (nowMs) => boolean): void` — shows the canvas and runs rAF while `tick` returns true. Each frame calls `tick` and then `renderer.render(scene, camera)`. When `tick` returns false, no rAF is left pending.
      - `hide(): void`.
      - `get isLooping(): boolean`.
      - `onContextLost(cb)` and `onContextRestored(cb)`.
      - `scene`, `camera`, `dispose(): void`.
  - **The scene builder:** `buildScene(): { scene, camera, fitArea(areaWorld: { halfWidth, halfDepth }): void, shadowFor(mesh): THREE.Mesh }`.
    - **Camera:** perspective, fov 20°, looking straight down. Its height is chosen so the floor rectangle `halfWidth × halfDepth` exactly fills the view.
    - **Environment:** RoomEnvironment via PMREM, generated once and reused (Plan 2 replaces it with the studio map).
    - **Lights:** one key DirectionalLight, no shadow map.
    - **Shadows:** `shadowFor` returns a pooled blob-shadow plane (a radial gradient texture shared by all) that follows a die on the floor.
  - **Units:** world-to-pixel scale is `areaWorld.halfWidth = (rect.width / 2) / dieSizePx`, with `dieSizePx = 48 × diceScale` (a designer's call; tune in Plan 2).

- [ ] **Step 1: Write the failing tests.** These use a fake renderer and a manual rAF.

```js
function setup() {
  const frames = [];
  const raf = (cb) => (frames.push(cb), frames.length);
  const caf = vi.fn();
  const fake = { setSize: vi.fn(), setPixelRatio: vi.fn(), render: vi.fn(), dispose: vi.fn() };
  const createRenderer = vi.fn(() => fake);
  const container = document.createElement('div');
  const r = new DiceRenderer({ container, createRenderer, raf, caf });
  const step = () => frames.splice(0).forEach((cb) => cb(performance.now()));
  return { r, fake, createRenderer, container, frames, step };
}
test('idle: canvas hidden, no frame pending', () => {
  const { r, container, frames } = setup();
  expect(container.querySelector('#dicer-canvas').style.display).toBe('none');
  expect(frames.length).toBe(0);
  expect(r.isLooping).toBe(false);
});
test('loop runs while tick returns true, then leaves nothing pending', () => {
  const { r, fake, frames, step } = setup();
  let n = 3;
  r.startLoop(() => --n > 0);
  step(); step(); step();
  expect(fake.render).toHaveBeenCalledTimes(3);
  expect(frames.length).toBe(0);
  expect(r.isLooping).toBe(false);
});
test('resizing 10 times never recreates the renderer', () => {
  const { r, fake, createRenderer } = setup();
  for (let i = 0; i < 10; i++) r.setArea({ left: 0, top: 0, width: 800 + i, height: 600 });
  expect(createRenderer).toHaveBeenCalledTimes(1);
  expect(fake.setSize).toHaveBeenLastCalledWith(809, 600, false);
});
test('pixel ratio is capped at 1.5', () => {
  globalThis.devicePixelRatio = 3;
  const { r, fake } = setup();
  r.setArea({ left: 0, top: 0, width: 100, height: 100 });
  expect(fake.setPixelRatio).toHaveBeenLastCalledWith(1.5);
});
test('context loss stops the loop; restore notifies', () => {
  const { r, container, frames } = setup();
  const lost = vi.fn(), restored = vi.fn();
  r.onContextLost(lost); r.onContextRestored(restored);
  r.startLoop(() => true);
  const canvas = container.querySelector('#dicer-canvas');
  canvas.dispatchEvent(new Event('webglcontextlost'));
  expect(lost).toHaveBeenCalled();
  expect(r.isLooping).toBe(false);
  canvas.dispatchEvent(new Event('webglcontextrestored'));
  expect(restored).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the tests to see them fail.** Run `npx vitest run tests/unit/renderer.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement `DiceRenderer` and `buildScene`.**
  - On `webglcontextlost`, call `preventDefault()`, cancel any pending rAF, set `isLooping=false`, and notify.
  - On `webglcontextrestored`, notify. The owner (DiceBox) re-uploads materials, which three.js does automatically on the next render.
  - The canvas CSS is in `styles/dicer.css`: `position:fixed; pointer-events:none; z-index: 60`, placed directly after `#board`. That's above the scene and below Foundry's UI apps.
- [ ] **Step 4: Run the tests to see them pass.** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add src/render/renderer.js src/render/scene.js styles/dicer.css tests/unit/renderer.test.js
git commit -m "feat: on-demand dice renderer with resize, pixel-ratio cap and context-loss handling"
```

### Task 8: Playback

**Files:**
- Create: `src/throw/playback.js`
- Test: `tests/unit/playback.test.js`

**Interfaces:**
- Consumes: `FLOATS_PER_DIE`, `STEP_SECONDS` (Task 5); `readTopFace`, `rotationToShow`, `faceForValue` (Task 3).
- Produces: `class Playback`.
  - **Constructor:** `constructor({ dice: { outer: THREE.Object3D, inner: THREE.Object3D, shape: ShapeDef, targetValue: number }[], area: { halfWidth, halfDepth }, speed?: number = 1 })`.
  - **`push(chunk)`** appends frames. When `chunk.done`, it reads each die's final orientation, computes `inner.quaternion = rotationToShow(shape, readTopFace(shape, q_final), faceForValue(shape, targetValue))`, and sets `resultsApplied = true`.
  - **`update(nowMs: number): 'waiting'|'playing'|'landed'`.** The playhead advances by real elapsed time × speed, interpolating between frames.
    - **Visibility gate:** no die may be drawn inside the area until `resultsApplied`. If the playhead would put any die inside before that, the playhead holds (returns `'waiting'`).
    - The first call sets the start time.
    - It returns `'landed'` once the playhead reaches the last frame and `resultsApplied` is true.
  - **`release(): Float32Array[]`** returns the chunk buffers, for `PhysicsClient.recycle`.
  - **`get landed`.**

- [ ] **Step 1: Write the failing tests.** Build synthetic chunks: one d6 sliding from x = −14 (outside the area, which has halfWidth 12) to x = 0, ending with a known quaternion.

```js
const area = { halfWidth: 12, halfDepth: 7 };
function die(target = 6) { return { outer: new THREE.Object3D(), inner: new THREE.Object3D(), shape: getShape('d6'), targetValue: target }; }
function chunk(fromStep, steps, total, done, finalQ = [0, 0, 0, 1]) {
  const data = new Float32Array(steps * 7);
  for (let i = 0; i < steps; i++) {
    const t = (fromStep + i) / (total - 1);
    data.set([-14 + 14 * t, 1, 0, ...finalQ], i * 7);
  }
  return { index: fromStep / 30, steps, data, done };
}
test('holds before entering the area until results are applied', () => {
  const d = die();
  const p = new Playback({ dice: [d], area });
  p.push(chunk(0, 30, 60, false));
  p.update(0);
  expect(p.update(1000)).toBe('waiting');
  expect(Math.abs(d.outer.position.x)).toBeGreaterThanOrEqual(area.halfWidth);
});
test('applies result rotation on the final chunk and lands with the target face up', () => {
  const d = die(6);
  const p = new Playback({ dice: [d], area });
  p.push(chunk(0, 30, 60, false));
  p.push(chunk(30, 30, 60, true));
  p.update(0);
  expect(p.update(5000)).toBe('landed');
  const world = new THREE.Quaternion().multiplyQuaternions(d.outer.quaternion, d.inner.quaternion);
  expect(d.shape.values[readTopFace(d.shape, world)]).toBe(6);
});
test('release returns every chunk buffer', () => {
  const p = new Playback({ dice: [die()], area });
  const a = chunk(0, 30, 60, false), b = chunk(30, 30, 60, true);
  p.push(a); p.push(b);
  expect(p.release()).toEqual([a.data, b.data]);
});
test('a long gap between updates (hidden tab) jumps to the end, it does not replay', () => {
  const d = die();
  const p = new Playback({ dice: [d], area });
  p.push(chunk(0, 30, 60, false)); p.push(chunk(30, 30, 60, true));
  p.update(0);
  expect(p.update(60000)).toBe('landed');
  expect(d.outer.position.x).toBeCloseTo(0, 3);
});
```

- [ ] **Step 2: Run the tests to see them fail.** Run `npx vitest run tests/unit/playback.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement `Playback`.** Read frames straight from the chunk Float32Arrays, with no copying. Position: lerp. Rotation: slerp.
- [ ] **Step 4: Run the tests to see them pass.** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add src/throw/playback.js tests/unit/playback.test.js
git commit -m "feat: streamed playback with visibility gate and result rotation"
```

### Task 9: Throw planner and DiceBox orchestrator

**Files:**
- Create: `src/throw/throw-planner.js`, `src/throw/dice-box.js`
- Test: `tests/unit/throw-planner.test.js`, `tests/unit/dice-box.test.js`

**Interfaces:**
- Consumes: `dieTypeForFaces`, `getShape`, `labelFor` (Task 3); `buildDieGeometry` (Task 4); `PhysicsClient` (Task 5); `createDiceMaterial` (Task 6); `DiceRenderer`, `buildScene` (Task 7); `Playback` (Task 8).
- Produces:
  - **`planThrow(roll, { maxDice?: number = 20 }): { dice: DieSpec[], skipped: number }`.**
    - `DieSpec = { type: DieType, value: number, variant?: 'd100tens' }`.
    - Walks `roll.dice`. For each term:
      - faces = `term.faces`, and supported types come from `dieTypeForFaces`;
      - `faces === 100` becomes a tens d10 (variant `'d100tens'`, value = `Math.floor(r % 100 / 10) * 10`, where 0 means "00") plus a ones d10 (value = `r % 10 || 10`);
      - all other faces are skipped (counted in `skipped`).
    - Includes every entry in `term.results` except those with `hidden: true`.
    - Stops at `maxDice` dice; the rest are counted in `skipped`.
  - **`class DiceBox`:**
    - **Constructor:** `constructor({ renderer: DiceRenderer, physics: PhysicsClient, atlas, appearance, getArea: () => {left,top,width,height}, diceScale: () => number, timeBeforeHide: () => number })`.
    - **`roll(specs: DieSpec[]): { landed: Promise<void>, finished: Promise<void> }`:**
      - Several concurrent rolls share one renderer loop, and each roll lands independently.
      - Geometry is cached per die type, and materials per (body, type).
      - After landing, the dice stay for `timeBeforeHide()` ms (default 2000), then fade over 400 ms and are removed. Then `finished` resolves, and if no roll remains, the loop stops and the canvas hides.
    - **`clear(): void`** removes all dice now and resolves every pending `landed` and `finished`.
    - **`onResize(): void`** calls `renderer.setArea` and `physics.resize`.
    - **`get activeRolls(): number`.**

- [ ] **Step 1: Write the failing planner tests.**

```js
const term = (faces, results) => ({ faces, results: results.map((r) => (typeof r === 'number' ? { result: r, active: true } : r)) });
test('basic dice', () => {
  expect(planThrow({ dice: [term(20, [17]), term(6, [3, 4])] }).dice).toEqual([
    { type: 'd20', value: 17 }, { type: 'd6', value: 3 }, { type: 'd6', value: 4 },
  ]);
});
test('d100 becomes tens + ones', () => {
  expect(planThrow({ dice: [term(100, [47, 100, 10])] }).dice).toEqual([
    { type: 'd10', value: 40, variant: 'd100tens' }, { type: 'd10', value: 7 },
    { type: 'd10', value: 0, variant: 'd100tens' }, { type: 'd10', value: 10 },
    { type: 'd10', value: 10, variant: 'd100tens' }, { type: 'd10', value: 10 },
  ]);
});
test('unsupported faces are skipped', () => {
  expect(planThrow({ dice: [term(7, [3]), term(3, [2])] })).toEqual({ dice: [], skipped: 2 });
});
test('hidden results are not thrown', () => {
  expect(planThrow({ dice: [term(6, [{ result: 2, active: true, hidden: true }, 5])] }).dice).toEqual([{ type: 'd6', value: 5 }]);
});
test('100d6 is capped at maxDice', () => {
  const r = planThrow({ dice: [term(6, Array(100).fill(1))] }, { maxDice: 20 });
  expect(r.dice.length).toBe(20);
  expect(r.skipped).toBe(80);
});
```

- [ ] **Step 2: Run the planner tests to see them fail.** Run `npx vitest run tests/unit/throw-planner.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement `planThrow`.** Run the tests again. Expected: PASS.
- [ ] **Step 4: Write the failing DiceBox tests.**
  - **Test doubles:**
    - **Fake physics:** its `throw()` returns a stream that emits two chunks (`done` on the second) when the test calls `fake.flush()`.
    - **Fake renderer:** records `startLoop` and `hide`; `fake.tick(ms)` invokes the stored tick.
    - **Real Playback.** Fake timers for `timeBeforeHide`.
  - **Test cases:**
    - `landed resolves after playback lands; finished after timeBeforeHide + fade; then the loop stops and the canvas hides`.
    - `two concurrent rolls each resolve landed independently, and the loop keeps running until both finish`.
    - `clear() resolves all pending landed/finished promises and leaves no rolls`.
    - `chunk buffers are recycled to physics after each roll finishes` (counts `physics.recycle` calls equal to the chunks emitted).
    - `geometry is built once per die type across rolls` (spy on `buildDieGeometry` via `vi.mock`).
- [ ] **Step 5: Run the DiceBox tests to see them fail.** Run `npx vitest run tests/unit/dice-box.test.js`. Expected: FAIL.
- [ ] **Step 6: Implement `DiceBox`.**
  - Each die is an `outer` Group (positioned from the physics frames) containing an `inner` Mesh (result rotation), plus a blob shadow from `shadowFor`.
  - The fade uses material opacity on cloned materials, only during the 400 ms fade.
  - The seed is `crypto.getRandomValues(new Uint32Array(1))[0]`.
  - **Tens dice** (`variant 'd100tens'`):
    - The Playback `targetValue` is `spec.value / 10 || 10`, which maps onto the d10's face values 1..10.
    - Face labels are `labelFor('d10', faceValue * 10, 'd100tens')`, so face value 10 is labelled `"00"`.
    - Use a separate material label set per variant.
- [ ] **Step 7: Run all throw tests to see them pass.** Run `npx vitest run tests/unit/throw-planner.test.js tests/unit/dice-box.test.js`. Expected: PASS.
- [ ] **Step 8: Commit.**

```bash
git add src/throw tests/unit/throw-planner.test.js tests/unit/dice-box.test.js
git commit -m "feat: throw planner and DiceBox orchestration with concurrent rolls"
```

### Task 10: Foundry integration — message gate, hooks, `game.dice3d`, coexistence, settings

**Files:**
- Create: `src/foundry/message-gate.js`, `src/foundry/coexistence.js`, `src/api/dice3d.js`, `src/settings.js`
- Modify: `src/main.js`
- Test: `tests/unit/message-gate.test.js`, `tests/unit/coexistence.test.js`, `tests/unit/dice3d.test.js`

**Interfaces:**
- Consumes: `planThrow`, `DiceBox` (Task 9); `PhysicsClient` (Task 5); `DiceRenderer` (Task 7); `loadDigitAtlas` (Task 6).
- Produces:
  - **Settings** (`settings.js`): `registerSettings(): void` and `getSetting(key)`. Keys, all under scope `dicer`:

    | Key | Scope | Type and default |
    |---|---|---|
    | `enabled` | client | Boolean, true |
    | `pixelRatioCap` | client | Number, choices 1/1.5/2, default 1.5 |
    | `diceScale` | client | Number, range 0.5–2, step 0.1, default 1 |
    | `timeBeforeHide` | client | Number in ms, default 2000 |
    | `maxDice` | world | Number, default 20 |
    | `dsnNoticeShown` | world | Boolean, hidden, false |

  - **Coexistence** (`coexistence.js`):
    - `dsnIsActive(game): boolean`.
    - `notifyGmOnce(game, ui): Promise<void>`: if `game.user.isGM` and the `dsnNoticeShown` setting is false, it calls `ui.notifications.warn(<localized "Dicer is inactive while Dice So Nice is enabled. Disable one of them.">)` and sets the setting to true.
  - **Message gate** (`message-gate.js`): `createMessageGate({ diceBox, planThrow, hooks, getSetting, setTimeoutFn?, clearTimeoutFn?, documentRef? }): Gate`.
    - `Gate = { onCreate(message), onRender(message, html: HTMLElement), onDelete(message), isAnimating(id): boolean, waitFor(id): Promise<boolean>, disabled: boolean }`.
    - Constant: `WATCHDOG_MS = 15000`.
  - **`game.dice3d`** (`dice3d.js`): `createDice3dApi({ diceBox, gate, planThrow, getSetting })` returns:
    - `isEnabled(): boolean`;
    - `showForRoll(roll, user?, synchronize?, users?, blind?, messageID?, speaker?, options?): Promise<boolean>`. Animates locally and resolves `true` on landing, or `false` if nothing was animatable or `blind` is true. `synchronize` is accepted but local-only until Plan 3;
    - `waitFor3DAnimationByMessageID(id): Promise<boolean>`, which delegates to `gate.waitFor`;
    - `messageHookDisabled`, a get/set proxy to `gate.disabled`;
    - `_debug: { get isLooping(), get activeRolls() }`, used by the live test.

- [ ] **Step 1: Write the failing gate tests.**
  - **Test doubles:**
    - **Fake hooks:** `{ calls: [], callAll(name, ...a) { this.calls.push([name, ...a]) } }`.
    - **Fake diceBox:** `roll()` returns controllable deferreds.
    - Fake timers; a jsdom document holding `<li data-message-id="m1">`.
  - **Message stub:** `{ id: 'm1', rolls: [roll], isContentVisible: true, flags: {}, user: {} }`, where `roll` has a single 1d20 term.
  - **Test cases:**
    - `hides the message (dsn-hide on render and on an already-rendered element), fires MessageProcessed(willTrigger3DRoll true) and RollStart(id, {roll, user, users, blind:false, dsnRoll})`.
    - `on landed: removes dsn-hide and fires diceSoNiceRollComplete(id, []) exactly once`.
    - `RollStart listener setting context.blind=true → no animation, message revealed, RollComplete once`.
    - `not visible (isContentVisible false) → never animated, never hidden, MessageProcessed(willTrigger3DRoll false)`.
    - `flags['dice-so-nice'].skip → not animated`.
    - `no animatable dice (planThrow returns empty) → not hidden, MessageProcessed false`.
    - `enabled setting false or gate.disabled → not animated`.
    - `watchdog: landed never resolves → revealed and RollComplete fired at 15000 ms, once; a later landed does not fire again`.
    - `diceBox.roll throws synchronously → revealed immediately, RollComplete once, error logged`.
    - `deleted mid-animation → RollComplete once, waitFor resolves true, later landed fires nothing`.
    - `two messages created in the same tick → both hidden, each revealed by its own landed`.
    - `waitFor(id) on an unknown id resolves true immediately`.
- [ ] **Step 2: Run the gate tests to see them fail.** Run `npx vitest run tests/unit/message-gate.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement `createMessageGate`.**
  - **Order in `onCreate`:**
    1. Run the eligibility checks (enabled, not disabled, visible, not skipped, has rolls, plan non-empty).
    2. Add the id to the animating set and add `dsn-hide` to any existing `[data-message-id]` element.
    3. Fire `diceSoNiceMessageProcessed`, then `diceSoNiceRollStart` with a mutable context.
    4. If `context.blind`, reveal.
    5. Otherwise, roll every roll in `message.rolls` (use `context.dsnRoll` for the first if a listener replaced it), and reveal when all of them have landed or the watchdog fires.
  - **`reveal` is idempotent per id.**
- [ ] **Step 4: Run the gate tests to see them pass.** Run the same command. Expected: PASS.
- [ ] **Step 5: Write the failing coexistence and API tests.**
  - `dsnIsActive true when game.modules.get('dice-so-nice').active`, plus false for missing and false for inactive.
  - `notifyGmOnce warns only for GM and only while dsnNoticeShown is false, then sets it`.
  - `showForRoll resolves true after landing; false for blind; false for a roll with only d7s`.
  - `messageHookDisabled proxies gate.disabled`.
- [ ] **Step 6: Run those tests to see them fail, then implement, then run them to see them pass.** Run `npx vitest run tests/unit/coexistence.test.js tests/unit/dice3d.test.js`. Expected: FAIL first, then PASS.
- [ ] **Step 7: Wire it up in `src/main.js`.**
  - **`init`:**
    - If `dsnIsActive(game)`, register only the `dsnNoticeShown` setting, and set a module-level `dormant = true`.
    - Otherwise call `registerSettings()`, and register `createChatMessage` → `gate.onCreate`, `renderChatMessageHTML` → `gate.onRender` and `deleteChatMessage` → `gate.onDelete` lazily, through a getter that returns no-ops until `ready`.
  - **`ready`:**
    - If dormant, call `notifyGmOnce` and stop.
    - Otherwise, load the atlas from `modules/dicer/assets/fonts/digits`.
    - Create the `PhysicsClient` with the inline worker, the `DiceRenderer` in `document.body`, and the `DiceBox`. The default appearance is opaque, bodyColor `#b3202a`, fillColor `#f2f2f2` (Plan 2 replaces it with themes).
    - The area is the window minus `#sidebar` width.
    - Set `game.dice3d = createDice3dApi(...)`.
    - Fire `Hooks.callAll('diceSoNiceInit', game.dice3d)`, then `Hooks.callAll('diceSoNiceReady', game.dice3d)`.
    - Listen to `window` `resize` with a 150 ms debounce → `diceBox.onResize()`, and to the `collapseSidebar` hook → `diceBox.onResize()`.
  - **`styles/dicer.css`:** `.dsn-hide { display: none !important; }`.
- [ ] **Step 8: Run the full suite and lint.** Run `npm test && npm run lint`. Expected: all PASS, 0 lint errors.
- [ ] **Step 9: Commit.**

```bash
git add src tests/unit styles
git commit -m "feat: chat message gate, DSN hooks, minimal game.dice3d and DSN coexistence"
```

### Task 11: Dev preview page and live smoke test

**Files:**
- Create: `dev/preview.html`, `dev/preview.js`, `tests/live/smoke.mjs`, `tests/live/world.js`, `README.md`
- Modify: `package.json` (add the `"test:live": "node tests/live/smoke.mjs"` script)

**Interfaces:**
- Consumes: `DiceRenderer`, `buildScene`, `PhysicsClient`, `DiceBox`, `loadDigitAtlas`; `game.dice3d._debug` (Task 10).
- Produces:
  - **The preview page** (`npm run dev`): a dev page showing all 7 die types.
    - Body buttons: opaque, metal, resin.
    - A "Throw" button that throws one of each with random target values; the landed values are printed under the canvas.
  - **The live smoke test:** `npm run test:live`.

- [ ] **Step 1: Build the preview page.** It reuses DiceBox with a full-window area and no Foundry.
  - **Manual check:** run `npm run dev`, open it, and press Throw 5 times. Expected:
    - every printed landed value equals its target;
    - no console errors;
    - in DevTools Performance, no task longer than 50 ms during a throw;
    - the frame loop stops about 2.4 s after landing (no more rAF in the Performance panel).
  - Save a screenshot to `artifacts/preview-plan1.png` for the owner.
- [ ] **Step 2: Write the live smoke test.**
  - **`tests/live/world.js`:** a module served by Foundry at `/modules/dicer/tests/live/world.js`, matching the RPC pattern in `pf2e-leveler/tests/live/run.mjs`. It exports `rollAndTrack(formula)`. That function:
    - registers one-shot listeners for `diceSoNiceRollComplete`;
    - calls `new Roll(formula).toMessage()`;
    - samples whether `[data-message-id=<id>]` has `dsn-hide` 100 ms after creation;
    - resolves `{ id, hiddenEarly, completeCount, msToComplete, loopingAfter }`, where `loopingAfter` is `game.dice3d._debug.isLooping`, read 4000 ms after completion.
  - **`tests/live/smoke.mjs`:** Playwright Chromium against the env vars:
    - `DICER_FOUNDRY_URL` (default `http://localhost:30000`);
    - `DICER_GM_USER` / `DICER_GM_PASSWORD`, read from the environment, never hard-coded;
    - the world must already be launched, with Dicer enabled and DSN disabled.

    It logs in as the GM and runs `rollAndTrack('1d20')`, `rollAndTrack('3d6+2')`, `rollAndTrack('1d100')` and `rollAndTrack('1d7')`.
  - **Assertions:**
    - for the first three: `hiddenEarly === true`, `completeCount === 1`, `msToComplete < 15000`, `loopingAfter === false`;
    - for `1d7`: `hiddenEarly === false`;
    - no `pageerror` events.

    It writes `artifacts/live/smoke.json`.
- [ ] **Step 3: Run the live smoke test.**
  - **Build and set up:** run `npm run build`. With Foundry running locally, the world launched, DSN disabled and Dicer enabled, run `npm run test:live`.
  - **Expected:** it prints `smoke: 4/4 passed` and exits with code 0.
- [ ] **Step 4: Write `README.md`.** It covers what Plan 1 delivers, how to build (`npm i && npm run build`), that DSN must be disabled, the dev page, and the live test env vars.
- [ ] **Step 5: Commit.**

```bash
git add dev tests/live README.md package.json
git commit -m "feat: dev preview page and live smoke test"
```

---

## Self-review notes
- **Spec coverage for this plan's slice:**
  - G1 core: Task 10 covers the gate, hooks, minimal `game.dice3d` and mutual exclusion.
  - G2 lifecycle: Task 7 covers zero idle cost, resize, context loss and the pixel ratio; Task 5 covers first-chunk latency; Task 2 covers the size cap.
  - §5 rendering, geometry and numbers: Tasks 4, 6 and 7. Physics and streaming: Tasks 5 and 8.
  - §8.1 and §8.2: Task 1.
- **Deferred to later plans, per the roadmap:**
  - G3 looks, interiors and tiers → Plan 2.
  - The full DSN API, privacy matrix, colorsets, migration and `showForRoll` synchronize → Plan 3.
  - G5–G10 → Plans 4–7.
  - Head-to-head benchmarks → Plan 8.
