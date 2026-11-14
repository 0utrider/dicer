# Built-in Effects Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Dicer's ten JB2A-mapped built-in effects so they reach JB2A's level of polish, using code-drawn shaders and generated textures.

**Architecture:**
- A shared "look kit" in the lazy effects chunk:
  - `textures.js`: generated sprite textures;
  - `palette.js`: colour handling.
- It upgrades the shared particle pool (textured soft sprites with halos) and `ribbon.js` (tapered
  strokes with a hot core and exponential glow).
- Each effect in `catalogue.js` is then rebuilt on that kit, in three rounds. Each round ends with
  side-by-side sheets, a frame-time check and a stop for the owner's sign-off.

**Tech Stack:** three.js r184 (ShaderMaterial, DataTexture, instanced meshes), GLSL ES 3.0, Vitest, Playwright (visual harness), Vite.

**Spec:** `docs/superpowers/specs/2026-11-16-dicer-builtin-fx-rebuild-design.md`

## Global Constraints

- **Lazy chunk only:** all new code lives in `src/effects/library/`, the lazy `effects` chunk. The
  world-start bundle must not grow; `tests/unit/build.test.js` must stay green.
- **No new download:**
  - no image or video files and no third-party effect packs;
  - no tracing or sampling of JB2A art into our assets;
  - no committed JB2A pixels.
- **Effect contract unchanged:**
  - every effect keeps its `id`, `cost` and `defaults`;
  - it obeys `ctx.color`, `ctx.intensity` and `ctx.duration`;
  - `update` turns false at `duration`;
  - `stop()` leaves no scene objects behind.
- **Particle limits:** particle counts stay within the pool capacity, `round(2048 × particleScale)`.
- **No scene-wide pass:** no bloom or EffectComposer. Glow comes from additive halo layers drawn by
  each effect.
- **Colours:** every effect must look right in any die colour, including near-white `#f4f4f4`,
  near-black `#141418`, saturated red `#e02020` and saturated blue `#2050ff`.
- **Not redesigned:**
  - `shake`;
  - glow-pulse, color-shift and number-flare (unless the owner flags them on the sheets);
  - rules, damage-theme selection, the JB2A choice and privacy.
- **No new setting.** The old drawings are deleted, not kept behind a toggle.
- **Ribbon attribute limit:** `ribbon.js` must keep at most four vertex attributes (position, aPrev,
  aNext, aSide), because ANGLE's D3D11 backend fails to link a program with more.
- **Frame-time bar:** p95 frame time at most 1.05 × the baseline for each effect.
  - Measured by the offline perf probe (Task 1) with 4× CPU throttling.
  - If a round misses it, the cheap tiers (`effectBudget` ≤ 2) drop halo layers and texture
    sizes until it passes.
- **Process:**
  - The branch is `builtin-fx` in the dicer checkout.
  - Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Never push, never merge, never start or modify the owner's Foundry server.
- **Tooling:** run vitest through `rtk proxy npx vitest run <file>`. Write any probe scripts as files;
  inline `node -e` mangles backslashes.

## Review Focus

1. **Near-black dice on the dark studio table.** Expected: a visible coloured rim, never an
   invisible effect.
   - Pinned by Task 2's palette test.
   - Seen on every round's `#141418` sheet column.
2. **Ten dice critting at once.** Expected: textures are created once and shared, the pool
   overwrites its oldest particles, and nothing is allocated per particle.
   - Pinned by Task 2's "created once" test.
   - Pinned by Task 3's "10 sparkles share one texture" test.
3. **WebGL context loss and restore.** Expected: textures come back. Pinned by Task 2's test that
   pixel data is kept on the CPU (`texture.image.data` survives the upload).
4. **Intensity 2 on a big table.** Expected: rings and bursts grow, but not to fill the screen.
   Pinned by Task 8 and Task 9 tests that size at intensity 2 is at most 1.6 × size at
   intensity 1.
5. **Prefers-reduced-motion.** Expected: lightning strikes once with no strobing re-strikes, and
   the floor flash is softened. Pinned by Task 5's reduced-motion test.

## Existing code an implementer needs (read, don't change unless the task says)

- **Effect contract and layer:** `src/effects/effect-layer.js`.
  - `gate()` returns `'off'`, `'safe'` or `'on'`.
  - `reducedMotion()` reads `prefers-reduced-motion`.
  - ctx is built for each effect start.
- **Helpers in `src/effects/library/catalogue.js`:**
  - `scoped(scene)`, `timed(ms, update, stop)`, `together(...handles)`, `trickle(ctx, total, window, spec)`;
  - `quadMaterial(fragment, color, extra)`, `floorGlow(ctx, {...})`, `ADDITIVE_PREMULTIPLIED`;
  - `countFor(n, ctx)`, `originOf(ctx, y)`, `sizeK(ctx)`;
  - the constants `FLOOR_Y`, `DIE_Y` and `DIE_TOP`;
  - world units: one die edge is 1, and the camera looks straight down.
- **Composites:** `composite({id, defaults, parts})` in `timeline.js`. Parts are in budget priority
  order.
- **Particle pool:** `createParticlePool(scene, capacity)` in `particles.js`.
  - `emit(spec)` takes these fields: count, origin, dir, speed, spread, life, size, kind, gravity,
    color, colorEnd, sizeEnd, stretch, spin, drag, alpha, blend, shape, now.
  - Shapes are procedural GLSL in `shapes.js`.
- **Ribbon:** `createRibbon` in `ribbon.js`. It draws screen-space glow polylines as one mesh, with
  width in CSS px at a 1080 px buffer.
- **Tests:**
  - `tests/unit/catalogue.test.js` holds the per-id contract tests (`describe.each(IDS)`), "rebuilt
    looks", tier degradation and composite staging;
  - also `tests/unit/particles.test.js`, `tests/unit/ribbon.test.js` and
    `tests/unit/effect-layer.test.js`.
- **Visual harnesses:**
  - `dev/jb2a.html` and `dev/jb2a.js` provide a d20 stage with the effect layer, JB2A on;
    `window.__jb2a.roll({fx, value}, options)`;
  - `tests/visual/jb2a.mjs` is a Playwright sheet maker (crop, thumbnails, fixed seed and area).

---

### Task 1: Sheet harness, perf probe and baseline

**Files:**
- Modify: `dev/jb2a.js`, `dev/jb2a.html`. Add URL params:
  - `jb2a=off`: `getSetting` returns `false` for `jb2aEffects`;
  - `bg=dark|light`: `light` sets the page background behind the transparent canvas to a light,
    map-like parchment gradient drawn in CSS;
  - `color`: passed through as the effect colour in `fxOf`.
- Create: `tests/visual/builtin-fx.mjs`
- Create: `tests/visual/fx-perf.mjs`
- Modify: `package.json`. Add the scripts `"test:visual:fx": "node tests/visual/builtin-fx.mjs"` and
  `"test:visual:fx-perf": "node tests/visual/fx-perf.mjs"`.

**Interfaces:**
- Produces:
  - **`builtin-fx.mjs` env:**
    - `DICER_FX_IDS`: comma-separated ids; default all ten JB2A-mapped ids;
    - `DICER_FX_ROUND`: an output folder label, for example `round-1`.
  - **`builtin-fx.mjs` output:**
    - Committed, Dicer-only sheets go to `docs/signoff/builtin-fx/<round>/<id>.png`. Each sheet
      is a grid: rows are the five colours (default, `#f4f4f4`, `#141418`, `#e02020`, `#2050ff`)
      and both backdrops; columns are frames at 120, 350, 700, 1100 and 1700 ms after landing.
      The page runs with `jb2a=off`.
    - When `jb2a-local/` exists, it also writes `artifacts/builtin-fx/<round>/<id>-vs-jb2a.png`
      (git-ignored): the default colour on the dark backdrop, a Dicer row above a JB2A row, with
      the page at `jb2a=on`.
    - When `jb2a-local/` is absent, it prints `builtin-fx: jb2a-local missing, reference skipped`
      and still exits 0.
  - **`fx-perf.mjs`:**
    - Applies CDP `Emulation.setCPUThrottlingRate` at rate 4 on `dev/jb2a.html?jb2a=off`.
    - For each id it plays the effect 5 times with a fixed seed and records `requestAnimationFrame`
      deltas from landing to landing + duration + 300 ms.
    - It writes `{ [id]: { p95, p50, frames } }` to `artifacts/builtin-fx/perf-<label>.json`, where
      `label` comes from `DICER_FX_PERF_LABEL`.
    - With `DICER_FX_PERF_BASELINE=<file>`, it prints a pass/fail line per id against
      `p95 ≤ 1.05 × baseline p95` and exits 1 on any fail.

- [ ] **Step 1:** Add the three URL params to the dev page. Check by hand that
  `dev/jb2a.html?jb2a=off&bg=light&color=%23e02020` plays a red built-in effect on a light
  backdrop.
- [ ] **Step 2:** Write `builtin-fx.mjs`. Reuse `jb2a.mjs`'s server start, GPU args, fixed `ROLL`
  seed and area, crop and thumbnail approach. It must fail on any page error.
- [ ] **Step 3:** Write `fx-perf.mjs`, reusing the same server, page and seed.
- [ ] **Step 4:** Record the "before" state on the current code:
  - `DICER_FX_ROUND=before npm run test:visual:fx`;
  - `DICER_FX_PERF_LABEL=baseline npm run test:visual:fx-perf`.

  Expected: 10 sheets in `docs/signoff/builtin-fx/before/` and `artifacts/builtin-fx/perf-baseline.json`
  with 10 ids.
- [ ] **Step 5:** Check that `npm run lint` and `rtk proxy npx vitest run` both pass.
- [ ] **Step 6:** Commit the harness, the scripts and the `before` sheets. The baseline JSON stays
  in git-ignored `artifacts/`; copy it to `.superpowers/` as a backup.

### Task 2: Look kit — generated textures and palette

**Files:**
- Create: `src/effects/library/textures.js`
- Create: `src/effects/library/palette.js`
- Test: `tests/unit/fx-textures.test.js`, `tests/unit/fx-palette.test.js`

**Interfaces:**
- Produces:
  - `export const TEX = Object.freeze({ GLOW: 'glow', PUFF: 'puff', SPARK: 'spark', FLAME: 'flame', SHARD: 'shard' })`.
  - `export function getTexture(kind: string): THREE.DataTexture`
    - It is lazy and cached: one texture per kind for the module's lifetime.
    - The pixels are an RGBA8 single-channel coverage mask in R=G=B=A, generated with
      deterministic hash noise.
    - Sizes: GLOW 64, PUFF 128, SPARK 64, FLAME 64×128, SHARD 64.
    - It uses `LinearFilter` with mipmaps, and `texture.image.data` is kept so a context restore
      re-uploads.
  - `export function disposeTextures(): void` disposes every texture and clears the cache. The pool's
    `dispose()` calls it in Task 3.
  - `export function palette(color: THREE.Color | string): { core: THREE.Color, mid: THREE.Color, edge: THREE.Color, rim: THREE.Color | null }`
    - Rules, using HSL from `THREE.Color.getHSL`:
      - **Normal colour:** core = lerp(color, white, 0.6); mid = color; edge = color × 0.55;
        rim = null.
      - **Near-white** (l ≥ 0.85 and s ≤ 0.15): core = white; mid = `#fff1d6`, a warm tint;
        edge = `#a9c4ff`, a cool tint; rim = null.
      - **Near-black** (l ≤ 0.1): core = color; mid = color; edge = color. The rim is the same
        hue at s = max(s, 0.5) and l = 0.6. If s < 0.05, the rim is `#9aa3b5`.

- [ ] **Step 1: Write failing tests**

```js
test('getTexture returns the same texture per kind and keeps CPU pixel data', () => {
  const a = getTexture(TEX.GLOW);
  expect(getTexture(TEX.GLOW)).toBe(a);
  expect(a.image.data).toBeInstanceOf(Uint8Array);
  expect(a.image.width).toBe(64);
});
test('GLOW is bright at the centre and zero at the edge', () => { /* data[centre*4] > 240, corner = 0 */ });
test('disposeTextures disposes and a later getTexture makes a fresh one', () => {
  const a = getTexture(TEX.PUFF); const spy = vi.spyOn(a, 'dispose');
  disposeTextures(); expect(spy).toHaveBeenCalled(); expect(getTexture(TEX.PUFF)).not.toBe(a);
});
test('textures are deterministic', () => { /* two fresh PUFFs after disposeTextures have equal data */ });

test('palette: normal colour has a lighter core and darker edge, no rim', () => {
  const p = palette('#e02020');
  expect(p.core.getHSL({}).l).toBeGreaterThan(p.mid.getHSL({}).l);
  expect(p.edge.getHSL({}).l).toBeLessThan(p.mid.getHSL({}).l);
  expect(p.rim).toBeNull();
});
test('palette: near-white gets a warm mid and cool edge', () => {
  const p = palette('#f4f4f4');
  expect(p.mid.getHexString()).toBe('fff1d6'); expect(p.edge.getHexString()).toBe('a9c4ff');
});
test('palette: near-black gets a visible rim of its own hue', () => {
  const p = palette('#141418'); expect(p.rim.getHexString()).toBe('9aa3b5');
  const q = palette('#200808'); expect(q.rim.getHSL({}).l).toBeCloseTo(0.6, 2);
});
```

- [ ] **Step 2:** Run `rtk proxy npx vitest run tests/unit/fx-textures.test.js tests/unit/fx-palette.test.js`.
  Expected: FAIL, because the modules don't exist yet.
- [ ] **Step 3:** Implement both modules. Texture shapes:
  - **GLOW:** gaussian falloff `exp(-r²·6)`.
  - **PUFF:** 4-octave value noise in a soft disc, billowy, with no hard edge.
  - **SPARK:** a hot core and 4 thin soft rays.
  - **FLAME:** a teardrop with a noisy upper edge.
  - **SHARD:** an irregular faceted triangle with one bright edge.
- [ ] **Step 4:** Run the tests again. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 3: Particle pool — textured soft sprites with halos

**Files:**
- Modify: `src/effects/library/particles.js`, `src/effects/library/shapes.js`
- Test: `tests/unit/particles.test.js` (update the assertions that pin procedural drawing; add the
  new tests)

**Interfaces:**
- Consumes: `getTexture`, `TEX` and `disposeTextures` from Task 2.
- Produces:
  - **`emit(spec)` gains `halo` (0..1).** It defaults to 0.6 for the additive layer and 0 for normal
    blend.
    - It is the strength of a wide soft GLOW drawn around each additive particle, inside the same
      quad.
    - The quad is enlarged by `1 + 1.5 × halo` and the shape is drawn in the inner part.
  - **Shape-to-texture mapping.** SMOKE, FLAME, GLINT, SHARD and DOT/SPIRAL now sample the textures
    instead of the procedural maths:
    - SMOKE → PUFF;
    - FLAME → FLAME;
    - GLINT → SPARK;
    - SHARD → SHARD;
    - DOT → GLOW.

    The texture is chosen by a per-instance index into one 5-layer atlas. The 5 textures are packed
    side by side into one atlas texture, so each layer stays a single draw call.
  - STREAK, RING and FLAKE stay procedural.
  - `pool.dispose()` also calls `disposeTextures()`.

- [ ] **Step 1: Write failing tests**
  - `'additive particles get a default halo of 0.6 and normal ones 0'`: read the halo attribute
    after `emit`.
  - `'the pool samples one atlas texture per layer'`: the material has a `uAtlas` uniform, which is
    a THREE.Texture.
  - `'10 sparkles share one atlas: getTexture is called once per kind'`: spy, start sparkles 10
    times through the catalogue, and expect at most 5 `getTexture` calls.
  - `'dispose calls disposeTextures'`.
  - `'impact and damage-theme emits still run'`: keep the existing tests green.
- [ ] **Step 2:** Run `rtk proxy npx vitest run tests/unit/particles.test.js`. Expected: the new
  tests FAIL.
- [ ] **Step 3:** Implement it.
  - Build the atlas by drawing the 5 DataTextures into one DataTexture, laid out horizontally at a
    height of 128. The narrower ones are padded.
  - Halo sits in the fragment shader: `alpha = shape + halo * glow(r) * 0.35`.
  - The vertex attribute count per layer must not grow past today's count plus one, adding
    `aHalo`. Pack `aHalo` into an existing float attribute if needed. Check the program still
    links on ANGLE by loading `dev/jb2a.html` with no console errors.
- [ ] **Step 4:** Run `rtk proxy npx vitest run`. Expected: all pass, including catalogue,
  effect-layer and damage themes. Update only the assertions that pinned procedural shape internals,
  and list each changed assertion in the report.
- [ ] **Step 5:** Commit.

### Task 4: Ribbon — tapered strokes with a hot core and glow

**Files:**
- Modify: `src/effects/library/ribbon.js`
- Test: `tests/unit/ribbon.test.js`

**Interfaces:**
- Produces:
  - `createRibbon(...)` options gain:
    - `taper: (t: number) => number`: width factor along each line, t from 0 to 1, default `() => 1`;
    - `core: number`: core width fraction, default 0.25;
    - `glow: number`: glow falloff length as a fraction of half-width, default 0.5.
  - The taper is encoded in `|aSide|` (aSide = ±taper(t)), so the attribute count stays at four.
  - The fragment shader draws `core` with `1 - smoothstep(core*0.6, core, d)` plus
    `exp(-d/glow) * 0.6`, where d is the distance across the stroke, 0 to 1. The core is whitened
    with `mix(color, white, 0.7)`.

- [ ] **Step 1: Write failing tests**
  - `'taper is written into |aSide| along the line'`: with a 3-point line and
    `taper: t => 1 - t`, the aSide magnitudes are [1, 1, 0.5, 0.5, 0, 0].
  - `'ribbon geometry still has exactly four attributes'`.
  - `'core and glow are uniforms'`.
- [ ] **Step 2:** Run `rtk proxy npx vitest run tests/unit/ribbon.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement it.
- [ ] **Step 4:** Run `rtk proxy npx vitest run`. Expected: all pass.
- [ ] **Step 5:** Commit.

### Task 5: Lightning

**Files:**
- Modify: `src/effects/library/catalogue.js` (the `lightning` effect only)
- Modify: `src/effects/effect-layer.js`, to add `ctx.reducedMotion: boolean` to every effect ctx
  from the existing `reducedMotion()`
- Test: `tests/unit/catalogue.test.js`, `tests/unit/effect-layer.test.js`

**Interfaces:**
- Consumes: the Task 4 ribbon options, Task 2 `palette`, and the Task 3 pool with `halo`.
- Produces: `ctx.reducedMotion` for every later effect.

**Look:**
- A main bolt strikes from above the die down to the table. It is midpoint-displaced, with 2–4
  branches.
- Width is about 14 px, tapering to 30% at the tips. Branches are about 7 px.
- The core and glow use `palette(ctx.color)`; near-black colours draw the rim colour as the glow.
- There are 3 strikes inside the duration, at 0, 22% and 48%. Each re-strike regenerates the bolt
  path and flashes brighter than the previous strike fades.
- With `ctx.reducedMotion`, there is 1 strike and no flicker.
- Each strike flashes a floor glow (`floorGlow`) and throws a short spray of SPARK particles at the
  impact point.
- The cost stays at 2.

- [ ] **Step 1: Write failing tests**
  - `'lightning strikes three times: the ribbon geometry is rebuilt at 0, 22% and 48% of duration'`:
    count the position-buffer rewrites while stepping update.
  - `'lightning with ctx.reducedMotion strikes once'`.
  - `'lightning bolt tapers'`: the ribbon is created with a taper whose value at t = 1 is 0.3.
  - `'the effect layer passes ctx.reducedMotion from prefers-reduced-motion'`, in
    effect-layer.test.
  - Keep the existing contract tests green.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement it, deleting the old lightning drawing.
- [ ] **Step 4:** Run `rtk proxy npx vitest run` and
  `DICER_FX_ROUND=round-1 DICER_FX_IDS=lightning npm run test:visual:fx`. Look at the sheet:
  - the bolt must be clearly thick and glowing in all 5 colours;
  - the near-black row must show the rim glow.
- [ ] **Step 5:** Commit the code and the sheet.

### Task 6: Frost

**Files:** Modify `src/effects/library/catalogue.js` (`frost` only); test in `tests/unit/catalogue.test.js`.

**Look:**
- Ice crystals grow outward from the die base along 6–8 rays, as tapered ribbons with branching
  side spikes.
- A pale frost disc spreads on the floor, a soft GLOW tinted with `palette().edge`.
- SHARD-shaped ice crystals pop up at the ray tips.
- Drifting cold mist uses PUFF with normal blend.
- It all fades by `duration`. The cost stays at 2.

- [ ] **Step 1: Write failing tests**
  - `'frost grows rays: visible ray length at 30% duration < at 60%'`: read a draw-range or uniform
    the implementation exposes on the ribbon (`userData.grow`).
  - `'frost spawns SHARD crystals at the ray tips'`: a pool emit spy finds `shape: SHAPE.SHARD`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement it.
- [ ] **Step 4:** Run the tests and the `round-1` sheet for frost, and look at it as in Task 5.
- [ ] **Step 5:** Commit.

### Task 7: Fumble (smoke, crack, fizzle)

**Files:** Modify `src/effects/library/catalogue.js` (`fumbleSmoke`, `crackPart`, `fizzlePart`, `fumble` composite timing); test in `tests/unit/catalogue.test.js`.

**Look:**
- **Crack:** a jagged tapered crack spreads across the floor from under the die. It is a
  dark-cored ribbon with a dim ember-red glow at the edges, and it opens over about 200 ms.
- **Smoke:** a heavy, dark, curling PUFF plume rises slowly and sags.
- **Fizzle:** a few dying sparks fall and go dark.
- The parts, their order and the staging (0, 80 and 150 ms) are unchanged, so the tier degradation
  tests stay valid.

- [ ] **Step 1: Write failing tests**
  - `'fumble crack is a tapered ribbon that opens over ~200 ms'`.
  - `'fumble smoke uses PUFF, normal blend, at least 8 puffs at intensity 1'`.
  - The existing `'fumble on low is smoke only'` test and the staging tests stay green.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement it.
- [ ] **Step 4:** Run the tests and the `round-1` sheet for fumble.
- [ ] **Step 5:** Commit.

### Checkpoint A: Round 1 sign-off (controller, not an implementer task)

- [ ] Run `DICER_FX_ROUND=round-1 DICER_FX_IDS=lightning,frost,fumble npm run test:visual:fx`.
- [ ] Also capture the impact effects and one damage theme from `dev/effects.html`, the existing
  `tests/visual/effects.mjs` with `DICER_EFFECT`. These show the pool change.
- [ ] Run
  `DICER_FX_PERF_LABEL=round-1 DICER_FX_PERF_BASELINE=artifacts/builtin-fx/perf-baseline.json npm run test:visual:fx-perf`.
  If it fails, lighten the cheap tiers (see Global Constraints) and re-run.
- [ ] Judge the sheets against the spec's look.
  - Send an effect back to its implementer for up to 3 revision passes if it is clearly short.
  - After 3 passes it goes to the owner as it is, with a note.
- [ ] **Stop.** Show the owner the sheets (SendUserFile) and the local `-vs-jb2a` sheets, and wait
  for sign-off or redirection before Task 8.

### Task 8: Ring kit and shockwave

**Files:** Modify `src/effects/library/catalogue.js` (`RING_FRAGMENT`, `shockwave`); test in `tests/unit/catalogue.test.js`.

**Interfaces:**
- Produces: `RING_FRAGMENT` uniforms gain `uEdge` (leading-edge width), `uNoise` (edge breakup
  0..1) and `uTrail` (trail length). Tasks 9 and 10 reuse it.

**Look:**
- A gradient band with a soft inner glow, a thin hot white leading edge, and noise-broken edges so
  it is not a perfect circle.
- A fading trail sits behind the ring.
- The second ring follows 90 ms behind, as today.
- The dust puffs now use PUFF.

- [ ] **Step 1: Write failing tests**
  - `'ring material has uEdge, uNoise, uTrail'`.
  - `'shockwave size at intensity 2 ≤ 1.6 × size at intensity 1'`. Today it is linear 7 ×
    intensity, so change it to `7 × min(1.6, sqrt(intensity))`, or similar.
  - Keep `'shockwave draws two rings, the second 90 ms later and fainter'` green.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement it.
- [ ] **Step 4:** Run the tests and a `round-2` sheet for shockwave.
- [ ] **Step 5:** Commit.

### Task 9: Light-burst

**Files:** Modify `src/effects/library/catalogue.js` (`BURST_FRAGMENT`, `lightBurst`); test in `tests/unit/catalogue.test.js`.

**Look:**
- A brief anticipation: a glow shrinks for about 60 ms.
- Then a bright bloom-like burst: a layered GLOW halo, and soft god-rays with varied lengths that
  slowly turn.
- A thin ring kit ring (Task 8) runs on the floor, together with the existing floor glow.
- A palette core to edge gradient.

- [ ] **Step 1: Write failing tests**
  - `'light-burst size at intensity 2 ≤ 1.6 × size at intensity 1'`.
  - `'light-burst anticipates: halo scale at 40 ms < scale at 0 ms'`.
  - Keep the existing floor glow and uRays tests green, updating the uRays test only if the ray
    mask uniform is renamed.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement it.
- [ ] **Step 4:** Run the tests and a `round-2` sheet.
- [ ] **Step 5:** Commit.

### Task 10: Celebrate

**Files:** Modify `src/effects/library/catalogue.js` (`sparkBurstPart`, `glitterPart`, `celebrate` composite tuning); test in `tests/unit/catalogue.test.js`.

**Look:**
- It is built on the rebuilt light-burst and shockwave.
- The spark burst becomes glowing STREAK and SPARK sparks with halos and gravity arcs.
- Glitter becomes twinkling SPARK glints that fade out slowly.
- The part order and staging (0, 120 and 200 ms) are unchanged.

- [ ] **Step 1: Write failing tests**
  - `'celebrate spark burst emits STREAK with halo > 0'`.
  - `'glitter emits GLINT/SPARK that twinkle (alpha varies across life)'`: assert on whatever
    attribute the twinkle uses.
  - The existing budget and staging tests stay green.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement it.
- [ ] **Step 4:** Run the tests and a `round-2` sheet.
- [ ] **Step 5:** Commit.

### Checkpoint B: Round 2 sign-off (controller)

Do as Checkpoint A, with `round-2` and ids `shockwave,light-burst,celebrate`. **Stop** for the
owner's sign-off before Task 11.

### Task 11: Sparkles and embers

**Files:** Modify `src/effects/library/catalogue.js` (`sparkles`, `embers`); test in `tests/unit/catalogue.test.js`.

**Look:**
- **Sparkles:** spiralling SPARK glints with halos rise around the die. They are larger, about
  0.12–0.2 die edges, and twinkle, burning out through `palette().core` to white.
- **Embers:**
  - FLAME tongues lick up from the die base;
  - glowing embers drift up with a gentle sway;
  - the floor glow stays;
  - the die must stay visible: no particle born over the die's top face stays opaque there for
    more than 100 ms.

- [ ] **Step 1: Write failing tests**
  - `'sparkles particles are at least 0.12 die edges at intensity 1'`.
  - `'embers emits FLAME tongues and EMBER particles with halo'`.
  - `'embers never covers the die: no normal-blend emit with origin within 0.5 of die centre'`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement it.
- [ ] **Step 4:** Run the tests and `round-3` sheets.
- [ ] **Step 5:** Commit.

### Task 12: Smoke and shatter

**Files:** Modify `src/effects/library/catalogue.js` (`smoke`, `smokeStart`, `shatter`); test in `tests/unit/catalogue.test.js`.

**Look:**
- **Smoke:** a dense billowing PUFF column that curls, grows about 3× and drifts, with darker edges
  from `palette().edge`. Fumble's smoke (Task 7) must still be distinct: it is darker and sags.
- **Shatter:**
  - a bright GLINT flash;
  - SHARD fragments with a lit edge that tumble out with spin and gravity, bounce once on the
    floor (y clamps at `FLOOR_Y` with damping), then fade;
  - a faint PUFF dust puff;
  - the cost stays at 3.

- [ ] **Step 1: Write failing tests**
  - `'smoke puffs use PUFF and grow ≥ 2.8x'`.
  - `'shatter shards use SHARD with spin and gravity, cost 3'`.
  - `'shatter flash is a GLINT/SPARK at the die'`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement it. If the floor bounce needs pool support, add a `floor: number` emit
  field: y is clamped and the velocity is reflected × 0.35 in the vertex shader. Test it in
  particles.test.
- [ ] **Step 4:** Run the tests and `round-3` sheets.
- [ ] **Step 5:** Commit.

### Checkpoint C: Round 3 sign-off and finish (controller)

- [ ] Do as Checkpoint A, with `round-3` and ids `sparkles,embers,smoke,shatter`.
- [ ] Run a full `npm run test:visual:fx` and the perf probe over all ten ids.
- [ ] Run `npm run lint`, `rtk proxy npx vitest run` and `npm run build`. Expected: all green, and
  the build test confirms the world-start size is unchanged.
- [ ] **Stop.** Ask the owner for:
  - sign-off;
  - the live Foundry check with JB2A off (the `previewEffect` loop);
  - optionally, `npm run test:live:bench` against their own server, which Claude never starts.
- [ ] Final whole-branch review. The merge happens only when the owner asks.
