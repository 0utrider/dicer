# Dicer Plan 2: The Look — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dicer's dice read as product photos of boutique dice:
- studio lighting;
- a layered material system (body, interior, number fill, edges, glow);
- metal, resin, marble and pearl bodies;
- ray-marched interiors inside clear dice;
- quality tiers that auto-pick, drop adaptively, and keep the Plan 1 performance guarantees.

The owner signs off the look from a gallery.

**Architecture:**
- **Appearance:** a plain-data `Appearance` object (`src/look/appearance.js`) describes a die, layer by layer. It is normalized defensively, and hashed into two keys:
  - `appearanceKey`, for the material cache, one entry per distinct look;
  - `programKey`, for shader programs, one per (body, finish, interior kind, feature flags), never per colour.
- **Materials:** `createDiceMaterial` keeps three's MeshPhysicalMaterial and injects GLSL modules from `src/render/shaders/`: engraving (moved from Plan 1), bodies/finishes, interiors.
- **Environment:** a procedural studio scene, made of emissive softbox panels rendered once through PMREM. It replaces RoomEnvironment and costs zero download bytes.
- **Quality:** a pure tier table plus an `AdaptiveQuality` controller decide the pixel ratio, interior step budget, transmission resolution, environment resolution and anisotropy.
- **Gallery:** a dev gallery and a headless visual-check script verify every shader on real WebGL.

**Tech stack:** as in Plan 1 (three.js 0.184, Vite 6 lib build with esbuild minify, Vitest, Playwright). No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-11-10-dicer-design.md` — sections G3 (look), G4 (layers, partly), G2 (performance targets), §5 (rendering, interiors, quality tiers, settings). **Roadmap:** `docs/superpowers/plans/2026-11-10-dicer-roadmap.md`, plan 2 of 8. **Prior decisions:** `docs/superpowers/plans/2026-11-10-dicer-plan-1-notes.md`. Its rulings R2–R13 still bind.

## Global Constraints

- Every Plan 1 global constraint still holds:
  - module id `dicer`;
  - Foundry v14;
  - no DSN code copied;
  - WebGL2 only;
  - `logarithmicDepthBuffer: false`;
  - no full-screen post-processing;
  - **zero** GPU work when idle;
  - resize = setSize only;
  - one physics worker;
  - `diceSoNiceRollComplete(id, [])` exactly once;
  - privacy via `isContentVisible`;
  - Prettier and ESLint configs unchanged.
- **World-start budget:** `dist/` plus `assets/fonts/digits.{png,json}` ≤ 4 MB (4,194,304 B), checked by `tests/unit/build.test.js`. Headroom at the start of this plan is 281.8 KiB. **No new binary assets**: the studio environment and every interior are procedural.
- **One shader program per `programKey`**, never per colour, per die, or per numeric parameter. Colours and numbers live in uniforms.
- **The default appearance is a clear resin die with an interior** (spec G3/§5). Interiors ship ON by default.
- **Quality tiers:** exactly `low | medium | high | ultra`.
  - The effective tier = `min(clientChoice or autoTier, worldCap)`. An adaptive drop lowers it further, for the session only.
  - The Plan 1 client setting `pixelRatioCap` stays an upper bound on every tier's pixel ratio.
- **Per-feature settings** (spec §5), each with its own toggle, default ON:
  - client: `interiors`, `engraving`, `shadows`, `glow`;
  - world: `qualityCap`.
- **Tone mapping:** `THREE.NeutralToneMapping`, exposure 1. The canvas stays transparent (`alpha: true`).
- **Look sign-off:** the plan ends with a gallery and screenshots for the owner. The owner's verdict comes after execution, not inside a task.

## Review Focus

1. **Bad or old appearance data** — a hand-edited setting, an older version, a missing or extra field, a wrong type. `normalizeAppearance` falls back field by field and never throws. Owned by Task 1.
2. **Switching look mid-roll.** Dice already on screen keep their materials and new rolls use the new look. A replaced material is disposed only after every roll using it has finished, so nothing renders a disposed material. Owned by Task 8.
3. **A shader fails to compile on some GPU.** The die must not vanish. Dicer detects the failure (`renderer.debug.onShaderError`), drops to `low` (no interior, simplest body path), recompiles, and logs once. Owned by Task 7.
4. **A pool of 20 resin dice**, with transmission costing an extra pass. `low` and `medium` set `renderer.transmissionResolutionScale` to 0.5. Owned by Task 7.
5. **The world cap sits below the client's choice or the auto-picked tier.** The effective tier honours the cap, and the UI choice persists. Owned by Task 7.

---

## File Structure

```
src/look/appearance.js        Appearance schema, DEFAULT_APPEARANCE, normalizeAppearance, appearanceKey, programKey
src/look/looks.js             curated named looks (LOOKS map; Plan 5 themes build on these)
src/render/studio-env.js      procedural studio environment scene + builder
src/render/shaders/engrave.js engraving GLSL (moved verbatim from dice-material.js)
src/render/shaders/bodies.js  body/finish GLSL: marble, pearl, metal brushed/antique, raised face border, glow
src/render/shaders/interior.js ray-marched interior GLSL (liquid, glitter, swirl, nebula, shape)
src/render/shaders/noise.js   shared hash/value-noise/fbm GLSL
src/render/dice-material.js   (modify) layered appearance → MeshPhysicalMaterial + patches
src/render/quality.js         TIERS table, effectiveTier(), AdaptiveQuality
src/render/gpu-probe.js       runProbe(renderer) → { msPerFrame, gpu }
src/render/renderer.js        (modify) tone mapping, applyTier(), warmup(), frame-time reporting
src/render/scene.js           (modify) uses studio-env; resolution param
src/render/sdf-atlas.js       (modify) 6/9 mark shape
src/core/chamfer.js           (modify) edge styles (rounded bulge / sharp), centroid fans, aEdgeDist
src/throw/dice-box.js         (modify) getAppearance(), material cache by appearanceKey, refcounted disposal
src/settings.js               (modify) look, quality, qualityCap, interiors, engraving, shadows, glow
src/main.js                   (modify) wiring
dev/looks.html  dev/looks.js  look gallery (all LOOKS × die types, fixed camera, tier switcher)
tests/visual/looks.mjs        headless WebGL check: compile errors, non-blank, screenshots, ms/frame
docs/reference/look-references.md  8–12 product-photo links (no images committed)
tests/unit/*.test.js          new and updated unit tests
```

---

### Task 1: Appearance model and curated looks

**Files:**
- Create: `src/look/appearance.js`, `src/look/looks.js`
- Test: `tests/unit/appearance.test.js`, `tests/unit/looks.test.js`

**Interfaces:**
- Produces (`appearance.js`):
  - **The `Appearance` type:**
    ```
    Appearance = {
      body:     { type: 'opaque'|'resin'|'metal'|'marble'|'pearl', color: '#rrggbb', color2: '#rrggbb',
                  finish: 'polished'|'brushed'|'antique', roughness: number /*0..1*/ },
      interior: { type: 'none'|'liquid'|'glitter'|'swirl'|'nebula'|'shape', colors: ['#rrggbb','#rrggbb'],
                  density: number /*0..1*/, shape: 'star'|'heart'|'skull'|'sphere' },
      numbers:  { fill: 'paint'|'gold'|'silver'|'enamel', color: '#rrggbb', depth: number /*0..1*/ },
      edges:    { style: 'rounded'|'sharp' },
      glow:     { color: '#rrggbb', intensity: number /*0..2*/ }   // intensity 0 = off
    }
    ```
  - **Field rules:**
    - `color2` is used by marble veins and pearl's second tint.
    - `finish` applies only to metal.
    - `interior` applies only when `body.type === 'resin'`. For any other body, `normalizeAppearance` forces `interior.type = 'none'`.
  - **`DEFAULT_APPEARANCE`** (frozen, deep):
    - body: resin `#1f5fd1`, color2 `#0b1f4a`, finish polished, roughness 0.05;
    - interior: nebula, colors `['#8a4dff', '#22d3ee']`, density 0.6, shape star;
    - numbers: gold `#e2b04a`, depth 0.5;
    - edges: rounded;
    - glow: `#ffffff`, intensity 0.
  - **`normalizeAppearance(input: unknown): Appearance`:**
    - Deep-merges `input` over `DEFAULT_APPEARANCE` field by field.
    - Rejects wrong types and out-of-range numbers (falls back to the default value), unknown enum values (falls back to the default) and malformed colours (anything not `#rgb` or `#rrggbb` falls back; `#rgb` expands to `#rrggbb` lowercase).
    - Ignores unknown keys. Never throws.
    - **Legacy Plan 1 flat input** `{ body: 'opaque'|'metal'|'resin', bodyColor, fillColor, fillMetallic, engraveDepth }` maps to:
      - `body.type` and `body.color`;
      - `numbers.color = fillColor`;
      - `numbers.fill = fillMetallic ? 'gold' : 'paint'`;
      - `numbers.depth = engraveDepth`.
  - **`appearanceKey(a: Appearance): string`** — stable over key order, e.g. canonical JSON. Equal looks give equal keys.
  - **`programKey(a: Appearance, flags: { interiors: boolean, engraving: boolean, glow: boolean, interiorSteps: number }): string`**
    - Includes body type, metal finish, interior type (or `none` when `!flags.interiors`), interior shape when the type is `shape`, the engraving and glow flags, `interiorSteps`, and the edge style.
    - **Excludes** every colour and every numeric look parameter (roughness, density, depth, glow intensity).
- Produces (`looks.js`): `LOOKS: Record<string, { name: string, appearance: Appearance }>`, frozen, with at least these ids:
  - `default` (= `DEFAULT_APPEARANCE`);
  - `ruby-classic` (opaque red, white paint);
  - `abyss-liquid` (resin, liquid core);
  - `starlit-glitter` (resin, glitter);
  - `galaxy-nebula` (resin, nebula);
  - `sharp-crystal` (resin, no interior, sharp edges);
  - `dwarven-brass` (metal antique, enamel);
  - `silver-brushed` (metal brushed, black enamel);
  - `gold-polished`;
  - `marble-white` (marble, gold);
  - `jade-marble`;
  - `pearl-moon`;
  - `ember-core` (resin, liquid orange, glow 0.6);
  - `frost-crystal` (resin, glitter, pale blue);
  - `void-star` (resin, shape star, near-black).

  Every entry's appearance passes `normalizeAppearance` unchanged (it is already normalized).

- [ ] **Step 1: Write the failing tests.**

```js
// tests/unit/appearance.test.js
test('default is resin with an interior', () => {
  expect(DEFAULT_APPEARANCE.body.type).toBe('resin');
  expect(DEFAULT_APPEARANCE.interior.type).not.toBe('none');
  expect(Object.isFrozen(DEFAULT_APPEARANCE.body)).toBe(true);
});
test.each([undefined, null, 42, 'x', [], { body: 'nope' }, { body: { type: 'lava', color: 'red' } }])(
  'normalize never throws and returns a full appearance for %j',
  (input) => {
    const a = normalizeAppearance(input);
    expect(a.body.type).toMatch(/^(opaque|resin|metal|marble|pearl)$/);
    expect(a.body.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(a.numbers.fill).toMatch(/^(paint|gold|silver|enamel)$/);
  },
);
test('field-level fallback keeps valid fields', () => {
  const a = normalizeAppearance({ body: { type: 'metal', color: '#ABC', roughness: 7 }, numbers: { fill: 'silver' } });
  expect(a.body).toMatchObject({ type: 'metal', color: '#aabbcc', roughness: DEFAULT_APPEARANCE.body.roughness });
  expect(a.numbers.fill).toBe('silver');
});
test('non-resin bodies have no interior', () => {
  expect(normalizeAppearance({ body: { type: 'metal' }, interior: { type: 'nebula' } }).interior.type).toBe('none');
});
test('legacy Plan 1 flat appearance maps over', () => {
  const a = normalizeAppearance({ body: 'opaque', bodyColor: '#b3202a', fillColor: '#f2f2f2', fillMetallic: false, engraveDepth: 0.4 });
  expect(a.body).toMatchObject({ type: 'opaque', color: '#b3202a' });
  expect(a.numbers).toMatchObject({ fill: 'paint', color: '#f2f2f2', depth: 0.4 });
});
test('appearanceKey is order-independent and colour-sensitive', () => {
  const a = normalizeAppearance({ body: { type: 'opaque', color: '#111111' } });
  const b = JSON.parse(JSON.stringify(a));
  const reordered = { glow: b.glow, edges: b.edges, numbers: b.numbers, interior: b.interior, body: b.body };
  expect(appearanceKey(reordered)).toBe(appearanceKey(a));
  expect(appearanceKey(normalizeAppearance({ body: { type: 'opaque', color: '#222222' } }))).not.toBe(appearanceKey(a));
});
test('programKey ignores colours and numbers, honours flags', () => {
  const flags = { interiors: true, engraving: true, glow: true, interiorSteps: 32 };
  const a = normalizeAppearance({ body: { type: 'resin', color: '#111111', roughness: 0.1 }, interior: { type: 'glitter', density: 0.2 } });
  const b = normalizeAppearance({ body: { type: 'resin', color: '#999999', roughness: 0.3 }, interior: { type: 'glitter', density: 0.9 } });
  expect(programKey(a, flags)).toBe(programKey(b, flags));
  expect(programKey(a, { ...flags, interiors: false })).not.toBe(programKey(a, flags));
  expect(programKey(a, { ...flags, interiorSteps: 16 })).not.toBe(programKey(a, flags));
});
```

```js
// tests/unit/looks.test.js
const REQUIRED = ['default', 'ruby-classic', 'abyss-liquid', 'starlit-glitter', 'galaxy-nebula', 'sharp-crystal',
  'dwarven-brass', 'silver-brushed', 'gold-polished', 'marble-white', 'jade-marble', 'pearl-moon',
  'ember-core', 'frost-crystal', 'void-star'];
test.each(REQUIRED)('%s exists and is already normalized', (id) => {
  expect(LOOKS[id].name).toBeTruthy();
  expect(normalizeAppearance(LOOKS[id].appearance)).toEqual(LOOKS[id].appearance);
});
test('every body type and interior type appears at least once', () => {
  const all = Object.values(LOOKS).map((l) => l.appearance);
  for (const t of ['opaque', 'resin', 'metal', 'marble', 'pearl']) expect(all.some((a) => a.body.type === t)).toBe(true);
  for (const t of ['liquid', 'glitter', 'swirl', 'nebula', 'shape']) expect(all.some((a) => a.interior.type === t)).toBe(true);
});
```

(The interior type `swirl` must appear in at least one look. Use it in `jade-marble`'s resin sibling, or add `smoke-swirl`; the builder chooses.)

- [ ] **Step 2: Run the tests to see them fail.** Run `npx vitest run tests/unit/appearance.test.js tests/unit/looks.test.js`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement `appearance.js` and `looks.js`.** Pure, three-free modules. The colour values of each look are the builder's choice, tuned later in Task 9.
- [ ] **Step 4: Run the tests to see them pass.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat: layered appearance model and curated looks"`

### Task 2: Edge styles and face-edge distance

**Files:**
- Modify: `src/core/chamfer.js`
- Test: `tests/unit/chamfer.test.js` (extend)

**Interfaces:**
- Consumes: `getShape`, `faceNormals` (Plan 1).
- Produces: `buildDieGeometry(shape, { chamfer?: number, bevelSegments?: number = 3, style?: 'rounded'|'sharp' = 'rounded' })`.
  - **`'rounded'`:** chamfer 0.07. The bevel strip rows are offset outward along their slerped normal so the silhouette is a true round (a circular-arc profile between the two inset edges), not a flat chamfer.
  - **`'sharp'`:** chamfer 0.012, bevelSegments 1 (a crisp highlight line).
  - Passing `chamfer` explicitly still overrides.
  - **All positions stay within the unit sphere**, including at bevelSegments 32. This fixes the Plan 1 deferred torus-arc 1.00014 overshoot.
  - **Face triangles become centroid fans:** one extra centroid vertex per face, so each face triangle is (centroid, vᵢ, vᵢ₊₁).
  - **New attribute `aEdgeDist`** (Float32, 1 component): for face triangles, the distance in face units (original face inradius = 1) from the point to the triangle's polygon edge (vᵢ, vᵢ₊₁). It is linear within each fan triangle: the centroid holds the inset face's inradius in face units, and the polygon vertices hold 0. On bevel and corner triangles it is 0.
  - The `geometry.userData.style` is set to the style used.

- [ ] **Step 1: Write the failing tests** (added to chamfer.test.js).
  - `test.each(ALL)('%s rounded stays within the unit sphere at bevelSegments 32')` — the bounding sphere radius is ≤ 1.0001.
  - `'rounded silhouette bulges'` — for a d6, sample bevel vertices of one edge strip and assert that the middle row's distance from the die centre is greater than the linear interpolation of the two end rows' distances, by at least 0.003.
  - `test.each(ALL)('%s face triangles are centroid fans with aEdgeDist')`:
    - for every face triangle, exactly one vertex has `aEdgeDist` equal to the max for that face (the centroid) and two have 0;
    - the centroid vertex's `aFaceUV` is ≈ (0, 0) (|uv| < 1e-6).
  - `'sharp has a much narrower bevel than rounded'` — the bevel-triangle area sum for sharp is < 0.25 × rounded, on a d20.
  - The existing Plan 1 chamfer tests still pass (winding outward, face normals, unit sphere, UV handedness).
- [ ] **Step 2: Run the tests to see them fail.** Run `npx vitest run tests/unit/chamfer.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Rounded profile:** for the strip rows between inset edge points A (on face 1) and B (on face 2), with edge-centre normal slerp nₜ, place each row at the point on the circular arc tangent to both faces at A and B. Equivalently, the arc centre is the intersection of the inward offsets of the two face planes by radius ρ = w / tan(θ/2), where θ is the dihedral turn.
  - **Corners:** use the same construction on the sphere of radius ρ around the corner's offset centre.
  - **Keep it inside the sphere:** scale uniformly by 1/max(|p|) if any |p| > 1.
  - The coin keeps a rounded rim with the same profile.
- [ ] **Step 4: Run the tests to see them pass.** Expected: PASS. Also run the full suite: the hull points (physics), the dice-box geometry cache, and the build must all stay green.
- [ ] **Step 5: Commit.** `git commit -m "feat: rounded and sharp edge styles, centroid face fans with edge distance"`

### Task 3: Studio environment and tone mapping

**Files:**
- Create: `src/render/studio-env.js`
- Modify: `src/render/scene.js`, `src/render/renderer.js`
- Test: `tests/unit/studio-env.test.js`, `tests/unit/renderer.test.js` (extend)

**Interfaces:**
- Produces (`studio-env.js`): `createStudioScene(): THREE.Scene`. It contains a dark backdrop sphere (inside-facing, colour `#0d0f14`) and these emissive panels (MeshBasicMaterial, colour × intensity):
  - a large overhead softbox (intensity 6, 6×6 units at y = +8);
  - a key strip on the upper left (intensity 10, 1×5 at (−6, 4, 2), angled at the origin);
  - a rim strip on the right (intensity 8, 1×5 at (6, 3, −3));
  - a warm fill card low in front (intensity 1.5, colour `#ffe6c7`, 5×2 at (0, 1, 7)).

  These values are the builder's starting point; tuning in Task 9 is allowed.
- Produces (`scene.js`): `setEnvironment(renderer, { resolution = 256 } = {})` builds the PMREM from `createStudioScene()` with `pmrem.fromScene(studio, 0.02, 0.1, 100, { size: resolution })`. That is three r184's options form; check the signature in node_modules/three. `resetEnvironment()` is unchanged. A call with a different resolution regenerates; the same resolution is a no-op. The studio scene's geometries and materials are disposed after the PMREM build.
- Produces (`renderer.js`): the WebGLRenderer is created with `toneMapping = THREE.NeutralToneMapping` and `toneMappingExposure = 1`, and the canvas stays transparent. `startLoop` passes the current environment resolution to `setEnvironment` (default 256; Task 7 sets it per tier).

- [ ] **Step 1: Write the failing tests.**
  - `studio-env.test.js`:
    - `createStudioScene` has exactly 4 emissive panel meshes plus 1 backdrop;
    - the overhead panel has the highest y;
    - every panel's normal faces the origin (dot(normal, −position) > 0);
    - no textures are used (no material has `.map`), which proves there are zero asset bytes.
  - `renderer.test.js`:
    - with a fake renderer flagged `isWebGLRenderer`, `startLoop` calls `sceneApi.setEnvironment(renderer, { resolution: 256 })`;
    - the default `createRenderer` sets NeutralToneMapping (test it by constructing a fake-free renderer config through an exported `rendererOptions()`/`configureRenderer(r)` helper that applies tone mapping, so it's testable without WebGL).
- [ ] **Step 2: Run the tests to see them fail, implement, then run them to see them pass.** Run `npx vitest run tests/unit/studio-env.test.js tests/unit/renderer.test.js`.
- [ ] **Step 3: Commit.** `git commit -m "feat: procedural studio environment and neutral tone mapping"`

### Task 4: Layered material, shader modules, look gallery and visual check

**Files:**
- Create: `src/render/shaders/engrave.js`, `src/render/shaders/noise.js`, `dev/looks.html`, `dev/looks.js`, `tests/visual/looks.mjs`
- Modify: `src/render/dice-material.js`, `src/render/sdf-atlas.js`, `src/throw/dice-box.js` (call-site only), `dev/preview.js` (call-site only), `package.json` (the `"test:visual": "node tests/visual/looks.mjs"` script)
- Test: `tests/unit/dice-material.test.js`, `tests/unit/sdf-atlas.test.js` (update)

**Interfaces:**
- Consumes: `normalizeAppearance`, `programKey`, `LOOKS` (Task 1); `buildDieGeometry(shape, { style })` and `aEdgeDist` (Task 2); `setEnvironment` (Task 3).
- Produces (`dice-material.js`):
  - **`createDiceMaterial(appearance: Appearance, atlas, shape, labels, flags = { interiors: true, engraving: true, glow: true, interiorSteps: 32 }): THREE.MeshPhysicalMaterial`**
    - **Breaking change:** the first argument is now a layered Appearance, normalized internally, so legacy input still works through normalize.
    - `customProgramCacheKey()` returns `'dicer-' + programKey(appearance, flags)`.
    - **Body presets in this task:** `opaque` (roughness from `body.roughness`, clearcoat 0.6), `metal` (polished only; metalness 1), `resin` (transmission 0.9, thickness 1.2, ior 1.52, attenuationColor = color, attenuationDistance 0.8, clearcoat 1).
    - `marble`, `pearl` and the other metal finishes render as `opaque` / polished metal until Task 5.
    - **Fills:**
      - `paint`: metalness 0, roughness 0.6;
      - `gold`: metalness 1, roughness 0.3, colour = numbers.color;
      - `silver`: metalness 1, roughness 0.25, colour = numbers.color;
      - `enamel`: metalness 0, roughness 0.15, clearcoat-like gloss.

      Stored in `uFillPBR` (vec2) plus a new `uFillGloss`.
    - **`flags.engraving === false`:** the numbers are still drawn (colour mask) but with no recess or normal perturbation.
  - `updateLabels(material, labels, atlas)` is unchanged.
  - `material.userData.programKey` is set for tests and the cache.
- Produces (`shaders/engrave.js`): `ENGRAVE_PARS`, `ENGRAVE_NORMAL`, `ENGRAVE_COLOR` — the GLSL strings moved verbatim from Plan 1, plus an `#ifdef DICER_ENGRAVE` guard around the normal and depth part.
- Produces (`shaders/noise.js`): `NOISE_GLSL`, defining `float dcHash13(vec3)`, `float dcNoise3(vec3)` (value noise) and `float dcFbm3(vec3, int octaves)`.
- Produces (`sdf-atlas.js`): the 6/9 mark becomes a short, thick bar: width 0.45 × digit ink width, thickness 0.16 × digit height, gap 0.26 × digit height. That fixes the Plan 1 deferred finding that the mark reads as a "1" when rotated.
- Produces (`dev/looks.html` + `dev/looks.js`), served at `/dev/looks.html` by `npm run dev`:
  - a grid with one row per entry in `LOOKS` and one column per die type (d4, d6, d8, d10, d12, d20, d2);
  - each die rests face-up under the studio environment, on one shared WebGLRenderer using scissor/viewport per cell;
  - a tier dropdown (low/medium/high/ultra) that rebuilds materials with that tier's flags;
  - `window.__looks = { ready: Promise, errors: string[], msPerFrame(): Promise<number>, setTier(t) }`;
  - shader compile errors are captured through `renderer.debug.onShaderError`.
- Produces (`tests/visual/looks.mjs`):
  - Starts `vite` dev in the background (`node node_modules/vite/bin/vite.js --port 5179 --strictPort`).
  - Opens `/dev/looks.html` in Playwright Chromium with `--use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist` (GPU when available; it falls back to SwiftShader, and records which one was used).
  - Waits for `__looks.ready`, then asserts `errors.length === 0`.
  - Asserts each grid cell is non-blank: sample the canvas pixels at cell centres, alpha > 0.
  - Saves `artifacts/visual/looks-<tier>.png` for every tier, and prints `msPerFrame` per tier.
  - Exits non-zero on any failure, and stops the dev server.

- [ ] **Step 1: Update the unit tests first.**
  - `dice-material.test.js`:
    - same programKey (hence `customProgramCacheKey`) for two looks that differ only in colours;
    - the SAME key for paint vs gold fill (fill is uniform-driven);
    - legacy flat input still builds;
    - `engraving: false` changes the program key and leaves `DICER_ENGRAVE` undefined in `material.defines`;
    - every shader injection anchor (Plan 1 test) is still present.
  - `sdf-atlas.test.js`: the "6." underline rect width ≤ 0.5 × the digit rect width, its height ≥ 0.15 × the digit height, and the gap between them ≥ 0.25 × the digit height.
- [ ] **Step 2: Run the tests to see them fail.** Run `npx vitest run tests/unit/dice-material.test.js tests/unit/sdf-atlas.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Refactor `dice-material.js` onto the shader modules.
  - Change the 6/9 mark.
  - Update the two call sites (DiceBox passes its appearance through unchanged — it is normalized inside; `dev/preview.js` likewise).
  - Build the gallery and `tests/visual/looks.mjs`.
- [ ] **Step 4: Run the tests to see them pass.** Run `npx vitest run` → all PASS. Then `npm run test:visual` → it prints the per-tier ms/frame and `visual: OK (0 shader errors, N cells non-blank)`, and exits with code 0.
- [ ] **Step 5: Commit.** `git commit -m "feat: layered dice material on shader modules, look gallery and visual check"`

### Task 5: Bodies and finishes — marble, pearl, metal finishes, raised borders, glow

**Files:**
- Create: `src/render/shaders/bodies.js`
- Modify: `src/render/dice-material.js`
- Test: `tests/unit/dice-material.test.js` (extend)

**Interfaces:**
- Consumes: `NOISE_GLSL` (Task 4); `aEdgeDist` (Task 2); the appearance fields `body.color2`, `body.finish`, `glow` (Task 1).
- Produces: body behaviour in `createDiceMaterial`:
  - **`marble`:**
    - Opaque base `color`, with veins in `color2` from domain-warped fbm in *object space* (the veins turn with the die). Vein sharpness is fixed, and vein scale is uniform `uVeinScale` = 1.6.
    - A subsurface-like softness: three's `sheen` (sheen 0.4, sheenColor = color) and roughness 0.3.
    - Defines `DICER_MARBLE`.
  - **`pearl`:** `iridescence` 1, iridescenceIOR 1.3, iridescenceThicknessRange [250, 650], sheen 0.6 with sheenColor = color2, roughness 0.25, clearcoat 1. Defines `DICER_PEARL` (a uniform-only tint pass).
  - **`metal` finishes:**
    - `polished`: roughness 0.18.
    - `brushed`: `anisotropy` 0.8, roughness 0.35. The anisotropy direction follows face U (from `aFaceUV` derivatives). Defines `DICER_BRUSHED`.
    - `antique`: roughness 0.45, plus cavity darkening, i.e. darkening near the engraved glyph walls and near face edges (`aEdgeDist` < 0.12), with fbm grime. Defines `DICER_ANTIQUE`.
  - **Raised face border** (every metal finish): within `aEdgeDist` ∈ [0.06, 0.14] a raised lip, with the normal tilted outward-then-inward across the band (a smoothstep bump of height 0.012). Defines `DICER_BORDER`. The border also darkens slightly on `antique`.
  - **Glow:** when `glow.intensity > 0` and `flags.glow`, the number fill gets emissive glow `color × intensity` (through `totalEmissiveRadiance`, masked to the glyph). Defines `DICER_GLOW`. No post-processing.
  - Every body's colours and numbers are uniforms. The defines are part of `programKey` (Task 1 already includes body type, finish and glow flag).

- [ ] **Step 1: Write the failing tests.**
  - For each body/finish, the expected `material` properties (anisotropy > 0 only for brushed; iridescence 1 only for pearl; sheen > 0 for marble and pearl) and the expected `defines` keys.
  - A glow intensity of 0 yields no `DICER_GLOW` define.
  - The marble and pearl program keys differ from opaque.
  - The injected fragment source contains `dcFbm3` only when the body is marble or the finish is antique.
- [ ] **Step 2: Run the tests to see them fail.** Run `npx vitest run tests/unit/dice-material.test.js`.
- [ ] **Step 3: Implement `bodies.js` and the wiring.**
- [ ] **Step 4: Verify.** Run `npx vitest run` → PASS. Run `npm run test:visual` → 0 shader errors at every tier, and screenshots saved.
- [ ] **Step 5: Commit.** `git commit -m "feat: marble, pearl and metal finishes with raised borders and glow"`

### Task 6: Ray-marched interiors

**Files:**
- Create: `src/render/shaders/interior.js`
- Modify: `src/render/dice-material.js`
- Test: `tests/unit/dice-material.test.js` (extend), `tests/unit/interior.test.js`

**Interfaces:**
- Consumes: `NOISE_GLSL`; `interior.*` and `flags.interiorSteps` (Task 1); the resin body (Task 4).
- Produces (`interior.js`): `interiorChunk(type: 'liquid'|'glitter'|'swirl'|'nebula'|'shape', shape?: string): { pars: string, main: string }`. `pars` declares uniforms and functions; `main` is the code injected after lighting.
  - **The march:**
    - Runs in **die-local space**. Varyings `vLocalPos` (object-space position) and `vLocalCam` (camera position in object space, computed per vertex from `inverse(modelMatrix)`; per-vertex is fine since it's uniform per object) give the local ray.
    - The ray is refracted at entry with ior 1.52.
    - It marches inside a sphere of radius `0.62` (inside every die's inradius × chamfer). The step count is the `#define DICER_STEPS N`, from `flags.interiorSteps`.
    - Density and colour come from the type function, with front-to-back compositing and early-out at alpha ≥ 0.98.
  - **Types** (all object-space, so they rotate with the die; no time animation in Plan 2):
    - `liquid`: a soft core blob of `colors[0]` with a wavy fbm boundary, in a thin `colors[1]` haze. `density` scales the core radius.
    - `glitter`: hashed cells holding tiny flakes. Each flake has a random normal and sparkles when its normal reflects the key light direction toward the eye (a specular spike). `density` sets the flake count per cell.
    - `swirl`: banded domain-warped noise ribbons in the two colours.
    - `nebula`: fbm clouds mixing the two colours, plus a sparse hashed star field (emissive points).
    - `shape`: an SDF (`star` = 5-point extruded star, `heart`, `skull` = simplified rounded skull, `sphere`) at the centre, scale 0.35, shaded matte in `colors[0]`, with `colors[1]` haze.
  - **Compositing:**
    - The interior colour is added to the resin's transmitted light.
    - Transmission is scaled by `(1 − interiorAlpha)`.
    - The interior colour goes into `outgoingLight`, mixed by `interiorAlpha`, before the number fill mask, so the numbers stay on top.
  - **`flags.interiors === false` or `interiorSteps === 0`:** no interior chunk; a plain resin program.
  - **The `low` tier** (interiorSteps 0) gets the **cheap fake**: when the appearance has an interior but steps is 0, it tints the attenuationColor toward the interior's `colors[0]`, with no march.
- Produces: per-material uniforms `uInteriorColors` (vec3[2]), `uInteriorDensity`, `uKeyLightDir`. `uKeyLightDir` is updated from the scene's key light by DiceBox; for now, a constant matching the Task 3 key strip.

- [ ] **Step 1: Write the failing tests.**
  - `interior.test.js`:
    - each type's `interiorChunk` returns non-empty `pars`/`main`;
    - `main` references `DICER_STEPS`;
    - `shape` with each shape name includes that shape's SDF function name;
    - an unknown type throws (it's internal; normalize already guarded user input).
  - `dice-material.test.js`:
    - a resin + nebula + `interiorSteps 32` program key differs from steps 16;
    - `interiors: false` produces the same key as a resin with `interior.type 'none'`;
    - `interiorSteps 0` with interior nebula has no `DICER_STEPS` define, and `attenuationColor` ≠ body colour (the tint is applied);
    - a non-resin body never gets interior defines.
- [ ] **Step 2: Run the tests to see them fail.** Run `npx vitest run tests/unit/interior.test.js tests/unit/dice-material.test.js`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.**
  - Run `npx vitest run` → PASS.
  - Run `npm run test:visual` → 0 shader errors at every tier, interior cells non-blank, and screenshots saved.
  - Record `msPerFrame` per tier for the gallery in the report.
- [ ] **Step 5: Commit.** `git commit -m "feat: ray-marched resin interiors with a cheap low-tier fallback"`

### Task 7: Quality tiers — table, auto-pick, adaptive drop, shader-failure fallback, warm-up

**Files:**
- Create: `src/render/quality.js`, `src/render/gpu-probe.js`
- Modify: `src/render/renderer.js`
- Test: `tests/unit/quality.test.js`, `tests/unit/renderer.test.js` (extend)

**Interfaces:**
- Produces (`quality.js`):
  - **The tier table:**
    ```
    TIERS = {
      low:    { pixelRatio: 1,    interiorSteps: 0,  transmissionScale: 0.5, envResolution: 128, anisotropy: false },
      medium: { pixelRatio: 1.25, interiorSteps: 16, transmissionScale: 0.5, envResolution: 256, anisotropy: true },
      high:   { pixelRatio: 1.5,  interiorSteps: 32, transmissionScale: 1,   envResolution: 256, anisotropy: true },
      ultra:  { pixelRatio: 2,    interiorSteps: 48, transmissionScale: 1,   envResolution: 512, anisotropy: true },
    }
    ```
  - `TIER_ORDER = ['low','medium','high','ultra']`.
  - **`effectiveTier({ choice: 'auto'|Tier, autoTier: Tier, cap: Tier, dropped: number /*≥0*/ }): Tier`** = `min(choice==='auto' ? autoTier : choice, cap)`, lowered by `dropped` steps, floored at `low`.
  - **`tierFromProbe({ msPerFrame }): Tier`:** < 4 ms → ultra; < 8 → high; < 16 → medium; else low.
  - **`class AdaptiveQuality`:**
    - `constructor({ budgetMs = 20, window = 30, onDrop })`.
    - `frame(ms: number)` is called once per rendered frame *while a roll is animating*.
    - It keeps an EMA (α 0.1), seeded with the first sample after construction or `reset()`. When the EMA exceeds `budgetMs` for `window` consecutive frames, it increments `dropped`, resets, and calls `onDrop(dropped)`.
    - `reset()`; `get dropped`.
- Produces (`gpu-probe.js`): `runProbe(renderer, { frames = 20 }) → Promise<{ msPerFrame: number, gpu: string }>`.
  - It renders a fixed offscreen test (3 resin dice with the High-tier interior program) into a 256×256 render target, `frames` times.
  - It times with `EXT_disjoint_timer_query_webgl2` when present, else with wall clock around `gl.finish()`.
  - `gpu` comes from `WEBGL_debug_renderer_info` when available.
  - It never throws: on any error it returns `{ msPerFrame: 16, gpu: 'unknown' }` (→ medium).
  - The result is cached in client localStorage under `dicer.probe.v1`, keyed by the gpu string, wrapped in try/catch.
- Produces (`renderer.js`):
  - **`applyTier(tierConfig)`:**
    - sets the pixel ratio to `min(devicePixelRatio, tier.pixelRatio, pixelRatioCap)`;
    - sets `renderer.transmissionResolutionScale = tier.transmissionScale`, where supported (check r184);
    - stores `envResolution` for the next `setEnvironment`.
  - **`warmup(materials: Material[], geometry)`:** `renderer.compileAsync` on a hidden scene containing one mesh per material, plus the fade (transparent) variants. It runs when idle and doesn't start the loop. This fixes the Plan 1 deferred first-roll compile hitch and first-fade compile.
  - **`onShaderError(cb)`:** wires `renderer.debug.onShaderError` and calls `cb(programInfo)`.
  - **Frame timing:** `startLoop` measures each frame's tick+render wall time and exposes `onFrameTime(cb)`.

- [ ] **Step 1: Write the failing tests.**
  - `quality.test.js`:
    - `effectiveTier`: choice auto with autoTier ultra and cap high → high; choice ultra with cap medium → medium; choice high with dropped 1 → medium; dropped 9 → low.
    - `tierFromProbe` boundaries: 3.9 → ultra, 4 → high, 7.9 → high, 15.9 → medium, 16 → low.
    - `AdaptiveQuality`: 29 slow frames → no drop; 30 → `onDrop(1)`; a fast frame in between resets the streak; after a drop the counter restarts.
    - The tier table has exactly four tiers, and `interiorSteps` is 0 only at low.
  - `renderer.test.js` (fake renderer):
    - `applyTier(TIERS.ultra)` with `devicePixelRatio` 3 and `pixelRatioCap` 1.5 → `setPixelRatio(1.5)`;
    - `transmissionResolutionScale` is set;
    - `onShaderError` registers on `renderer.debug`;
    - `onFrameTime` gets a number per frame.
  - `gpu-probe` gets one test with a renderer whose `getContext` throws → resolves to `{ msPerFrame: 16, gpu: 'unknown' }`.
- [ ] **Step 2: Run the tests to see them fail.** Run `npx vitest run tests/unit/quality.test.js tests/unit/renderer.test.js`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests to see them pass.** Run `npx vitest run` → PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat: quality tiers with GPU probe, adaptive drop, shader-failure hook and warm-up"`

### Task 8: Foundry wiring — settings, appearance per roll, tier control

**Files:**
- Modify: `src/settings.js`, `src/throw/dice-box.js`, `src/main.js`, `lang/en.json`
- Test: `tests/unit/settings.test.js`, `tests/unit/dice-box.test.js` (extend), `tests/unit/quality-controller.test.js`
- Create: `src/render/quality-controller.js`

**Interfaces:**
- Produces (`settings.js`): new settings, all under `dicer`:

  | Key | Scope | Type and default |
  |---|---|---|
  | `look` | client | String, choices = `LOOKS` ids → names, default `'default'` |
  | `quality` | client | String, choices `auto`/`low`/`medium`/`high`/`ultra`, default `'auto'` |
  | `qualityCap` | world | String, choices low/medium/high/ultra, default `'ultra'` |
  | `interiors` | client | Boolean, true |
  | `engraving` | client | Boolean, true |
  | `shadows` | client | Boolean, true |
  | `glow` | client | Boolean, true |

  Each has an `onChange` callback, passed through `registerSettings({ onAreaChange, onLookChange, onQualityChange })`.
- Produces (`dice-box.js`): new constructor options `getAppearance: () => Appearance` (it replaces the fixed `appearance`, which is still accepted for back-compat as a constant getter), `getFlags: () => { interiors, engraving, glow, interiorSteps }`, `shadows: () => boolean`.
  - The material cache key is `appearanceKey(appearance) + '|' + programKey(appearance, flags) + '|' + type + '|' + variant`.
  - **Refcounted disposal:** each roll holds references to its materials. `invalidateMaterials()` marks every cached material stale and drops it from the cache. A stale material is disposed when its last roll finishes, or immediately if unused.
  - `shadows() === false` → no blob shadows are created.
- Produces (`quality-controller.js`): `createQualityController({ renderer, getSetting, probe = runProbe, notify, storage })` → `{ ready: Promise<void>, tier: Tier, config: TierConfig, flags(): {interiors, engraving, glow, interiorSteps}, onChange(cb) }`.
  - It runs the probe once (cached), computes `effectiveTier`, calls `renderer.applyTier`, and attaches `AdaptiveQuality` to `renderer.onFrameTime`.
  - **On an adaptive drop:** re-apply the tier, call `onChange`, and `notify` once per session with the localized `DICER.Quality.Dropped` message.
  - **On a shader error:** force the `low` tier (dropped = enough to reach low), call `onChange`, and log once.
- Produces (`main.js`):
  - Wires the controller.
  - `getAppearance = () => LOOKS[getSetting('look')]?.appearance ?? DEFAULT_APPEARANCE`.
  - **When the look or quality changes** (settings or controller): call `diceBox.invalidateMaterials()`, then `renderer.warmup(...)` for the current look's materials.
  - **At ready:** warm up after the controller is ready.

- [ ] **Step 1: Write the failing tests.**
  - `settings.test.js` (extend the existing Foundry settings stub): every new key is registered with its scope, type, default and choices, and the `onChange` callbacks fire.
  - `dice-box.test.js`:
    - `two looks give different cached materials; same look reuses`;
    - `invalidateMaterials during a roll keeps the rolling dice rendering with their material, disposes it after finished` (spy on `material.dispose`);
    - `an unused stale material is disposed immediately`;
    - `shadows() false creates no shadow planes`;
    - `flags change the programKey part of the cache key`.
  - `quality-controller.test.js` (fake renderer, fake probe):
    - the probe result → the tier honours the cap;
    - an adaptive drop re-applies the lower tier and notifies once (a second drop doesn't notify again);
    - a shader error forces low;
    - `flags()` returns `interiorSteps` from the tier, and `interiors` comes from the setting AND the tier.
- [ ] **Step 2: Run the tests to see them fail.** Run `npx vitest run tests/unit/settings.test.js tests/unit/dice-box.test.js tests/unit/quality-controller.test.js`.
- [ ] **Step 3: Implement**, adding the lang strings for every new setting name/hint and `DICER.Quality.Dropped`.
- [ ] **Step 4: Verify.** Run `npx vitest run` and `npm run lint` → PASS. Run `node node_modules/vite/bin/vite.js build` → the size guard passes. Report the headroom.
- [ ] **Step 5: Commit.** `git commit -m "feat: look and quality settings, per-roll appearance and tier control in Foundry"`

### Task 9: Look tuning and the sign-off package

**Files:**
- Create: `docs/reference/look-references.md`
- Modify: `src/look/looks.js` (values only), `src/render/studio-env.js` (values only), `src/render/shaders/*.js` (tuning constants only)
- Test: `tests/visual/looks.mjs` (run)

**Interfaces:** none new. This task tunes values and produces evidence.

- [ ] **Step 1: Collect the references.** Put 8–12 links to boutique dice product photos in `docs/reference/look-references.md`. Cover each trait in spec G3: engraved inked opaque, liquid core, nebula, sharp-edge clear, gold/copper/brass metal with enamel, marble, pearl. Links only; no images committed. Add one line per link saying what it shows.
- [ ] **Step 2: Tune.** Render the gallery at `high`. Compare it side by side with the references, and tune `LOOKS` colours, studio panel intensities and the shader constants until each look reads as its reference category. Keep a short tuning log in the task report.
- [ ] **Step 3: Measure.**
  - Run `npm run test:visual`. It must report 0 shader errors at every tier, and print ms/frame per tier and which GPU path was used.
  - Then run a 10-die resin + nebula throw on the preview page (`dev/preview.html` with the look switched to `galaxy-nebula`) at each tier. Record the p95 frame time from `__looks.msPerFrame` or the preview's frame log.
  - **Target on the owner's GPU (gaming PC):** `high` p95 ≤ 8 ms.
  - **Target with Chromium 4× CPU throttle via CDP, forced to `medium`:** p95 ≤ 16.7 ms. Report these as estimates of the low end, per spec G2.
- [ ] **Step 4: Capture the sign-off package.**
  - `artifacts/visual/looks-{low,medium,high,ultra}.png`.
  - A close-up sheet `artifacts/visual/closeups.png`, holding 6 hero looks at 3× scale: default, abyss-liquid, galaxy-nebula, dwarven-brass, marble-white, pearl-moon.
  - The measured numbers.
- [ ] **Step 5: Final check.** Run `npx vitest run`, `npm run lint` and the build size guard → all PASS.
- [ ] **Step 6: Commit.** `git commit -m "chore: tune looks against references; sign-off screenshots and measurements"`

---

## Self-review notes
- **Spec coverage:**
  - G3: engraved numbers (Task 4, existing), real edges (Task 2), interiors (Task 6), metal + borders + enamel (Task 5), opaque/marble softness (Task 5), studio lighting (Task 3), grounded contact shadows (existing; toggle in Task 8). The reference set and sign-off are Task 9.
  - §5: interiors with tier budgets and the low fallback (Tasks 6, 7), quality tiers with auto-pick, adaptive drop and world cap (Tasks 7, 8), per-feature settings (Task 8), environment ≤ 512 KB (procedural, 0 B; Task 3). The optional high-res environment is satisfied by Ultra's 512 PMREM, with no download.
  - G2: no new idle work (warm-up runs once, off the loop), the size guard is kept, the interior performance proof is in Task 9 (full benchmarking is Plan 8).
  - G4: the layered appearance (Task 1). The editor, per-role/actor assignment and sharing are Plan 7; themes are Plan 5.
- **Deferred findings from Plan 1 closed here:** the 6/9 mark (Task 4), the flat chamfer silhouette and torus overshoot (Task 2), the first-roll and first-fade compile hitch (Task 7 warm-up), the material cache ignoring colour (Task 8).
- **Still deferred:** atlas mipmaps and the linger re-render (Plan 8); the shadow fade (cosmetic).
