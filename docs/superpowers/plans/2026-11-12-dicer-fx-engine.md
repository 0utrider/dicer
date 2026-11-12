# FX Engine Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Dicer's special effects look good: richer particles, thick glowing arcs and cracks, timed multi-stage composites, small impact effects while dice tumble, and a preview call so the owner can judge every effect without hunting for a natural 20.

**Architecture:** The effect runtime (`effect-layer.js`), the rule engine and the effect contract (`{id, cost, defaults, start(ctx)}`) stay; the library chunk gets new rendering primitives (an instanced-quad particle renderer with procedural shapes, a screen-space glow ribbon, a floor glow decal, a timeline composite) and every effect is rebuilt on them under its existing id. Impact effects ride the playback impact events the sound engine already uses.

**Tech Stack:** three.js (already bundled), WebGL2 shaders, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-10-dicer-design.md` (G7 special effects, G8 damage presets, G2 performance). Scope is the designer's call: the owner asked for better effects and skipped the questions (2026-11-12).

## Global Constraints

- Effect ids, `cost` and `defaults` of the 14 library effects stay as they are (`tests/unit/catalogue.test.js` IDS and COSTS): rules, damage themes and saved user rules keep working.
- Every effect obeys `ctx.color`, `ctx.intensity` and `ctx.duration` (G7 "every effect has adjustable colour, intensity and duration").
- The effects library stays a lazy chunk: nothing new in `src/effects/library/` may be imported by world-start code. `tests/unit/build.test.js` (world-start ratchet) must keep passing.
- G2: no rAF and no render when no dice and no effect are live; the per-tier `effectBudget` and `particleScale` (src/render/quality.js TIERS) still bound effects; the particle renderer stays at 2 draw calls (additive + normal layer).
- Blending on the premultiplied-alpha dice canvas uses `ADDITIVE_PREMULTIPLIED` (catalogue.js) or normal blending; never `THREE.AdditiveBlending` with alpha 1 on a quad (an opaque black rectangle).
- `prefers-reduced-motion: reduce` and the `screenShake` / `effects` settings keep their current meaning.
- Privacy is unchanged: effects only start where `play()` is called today; impact effects only for dice already shown to this client.
- No new dependencies. No real `THREE.Light` added to the scene: a light changes every dice program's light count (a recompile hitch) and costs per pixel every frame, even at intensity 0.
- New settings register through `register()` in `src/settings.js` (P9-R17 cache), with `DICER.Settings.<key>.Name/Hint` strings in `lang/en.json`.

## Review Focus

- A 30-die pool where a rule fires on every die (e.g. "max on any d6 → sparkles"): the budget drops the excess, the pool overwrites its oldest particles, and nothing throws. Test in Task 7.
- The low tier (effectBudget 2, particleScale 0.25): celebrate and fumble still show their essential part. Test in Task 6.
- A context loss and restore while particles or a ribbon are live: no exception; after restore new effects still render (procedural shapes need no texture re-upload). Test in Task 2.
- The loop going idle: once the last effect and the last particle are done, `update()` returns false (hold-frames and G2 depend on it), including after a timeline composite whose later parts never started (budget). Test in Task 5.
- Impact effects on a tumbling 30-die pool: at most one per die per 120 ms and at most 12 live per roll, so a pool cannot flood the particle pool. Test in Task 4.

---

## File structure

- Create `src/effects/library/shapes.js`: the procedural particle shapes (GLSL chunk + `SHAPE` enum). One responsibility: what a particle looks like.
- Modify `src/effects/library/particles.js`: Points → instanced camera-facing quads; colour/size over life; streak stretch; spin. Keeps `createParticlePool(scene, capacity)` and `emit(spec)`.
- Create `src/effects/library/ribbon.js`: `createRibbon()`, a thick screen-space glowing polyline.
- Create `src/effects/library/timeline.js`: `composite()` moved out of catalogue.js and given per-part start times.
- Modify `src/effects/library/catalogue.js`, `die-effects.js`: every effect rebuilt on the new primitives; `floorGlow` helper.
- Modify `src/effects/effect-layer.js`: `impact()`.
- Modify `src/throw/dice-box.js` `#impacts`: hand impacts to the layer too.
- Modify `src/api/dice3d.js`: `previewEffect()`.
- Modify `src/settings.js`, `lang/en.json`: `impactEffects` client setting.
- Modify `docs/` user docs where effects are described (README effects section).

---

### Task 1: `game.dice3d.previewEffect`

**Files:**
- Modify: `src/api/dice3d.js` (the public members, next to `showForRoll`)
- Test: `tests/unit/dice3d.test.js`

**Interfaces:**
- Produces: `previewEffect(id: string, opts?: {color?: string, intensity?: number, duration?: number, die?: string, value?: number}) -> Promise<boolean>`. Throws a local, unsynced, chat-free roll of one die (default `d20`, value default = the die's max) whose spec carries `fx: [{ effect: { id, ...opts without die/value } }]`, through the same DiceBox roll path `showForRoll(roll, user, false)` uses. Resolves true when the roll finished, false (and `console.warn` once per id) for an id that is neither a library id nor a `dsn:` id, or when the `effects` setting is off (with `ui.notifications.info(localize('DICER.Effects.PreviewOff'))`).

- [ ] **Step 1: Write the failing tests**

```js
test('previewEffect throws one local d20 showing 20 whose die carries the effect', async () => {
  // createDice3dApi with a fake diceBox whose roll() records its specs and resolves finished
  const ok = await api.previewEffect('celebrate', { color: '#ff0000', intensity: 2 });
  expect(ok).toBe(true);
  expect(rolled).toEqual([[expect.objectContaining({ type: 'd20', value: 20, fx: [{ effect: { id: 'celebrate', color: '#ff0000', intensity: 2 } }] })]]);
  expect(socketEmits).toHaveLength(0); // never synchronized
  expect(chatMessagesCreated).toHaveLength(0);
});
test('previewEffect honours die and value, refuses an unknown id and the effects setting', async () => {
  await api.previewEffect('sparkles', { die: 'd6', value: 3 });
  expect(rolled.at(-1)[0]).toMatchObject({ type: 'd6', value: 3 });
  expect(await api.previewEffect('nope')).toBe(false);
  settings.effects = false;
  expect(await api.previewEffect('sparkles')).toBe(false);
});
```

- [ ] **Step 2: Run them to see them fail** — `rtk proxy npx vitest run tests/unit/dice3d.test.js -t previewEffect` → FAIL (`previewEffect is not a function`).
- [ ] **Step 3: Implement `previewEffect` in `src/api/dice3d.js`**; valid ids are the library catalogue ids (import the id list as a plain constant array, not the library chunk: add `export const EFFECT_IDS = Object.freeze([...])` to a tiny new `src/effects/effect-ids.js` that `catalogue.test.js` also checks against `Object.keys(EFFECTS)`), plus any id starting `dsn:`. Add `"DICER.Effects.PreviewOff": "Effects are turned off in Dicer's settings."` to `lang/en.json`.
- [ ] **Step 4: Run** the two tests and `tests/unit/catalogue.test.js` → PASS.
- [ ] **Step 5: Commit** `feat(effects): game.dice3d.previewEffect throws a local die to show an effect`.

### Task 2: Particle renderer v2 (instanced quads, procedural shapes)

**Files:**
- Create: `src/effects/library/shapes.js`
- Modify: `src/effects/library/particles.js`
- Test: `tests/unit/particles.test.js`

**Interfaces:**
- Produces `SHAPE = Object.freeze({ DOT: 0, STREAK: 1, SMOKE: 2, GLINT: 3, SHARD: 4, FLAME: 5, FLAKE: 6, RING: 7 })` and `SHAPE_GLSL` (a GLSL function `float shapeAlpha(int shape, vec2 q, float seed)` for q in -1..1).
- `KIND` keeps its six values (behaviour: drag, flicker, floor clamp, spiral) and gains `STREAK: 6`, `FLAKE: 7`; each kind has a default shape (SPARK→DOT, EMBER→FLAME, SMOKE→SMOKE, SHARD→SHARD, SPIRAL→DOT, GLINT→GLINT, STREAK→STREAK, FLAKE→FLAKE).
- `emit(spec)` keeps every current field and adds: `shape?: SHAPE` (default: the kind's), `colorEnd?: color` (default `color`), `sizeEnd?: number` (size multiplier at death; defaults SMOKE 2.6, FLAME 0.3, others 1), `stretch?: number` (STREAK length per unit screen speed, default 0.06), `spin?: number` (rad/s, random sign; default SHARD 6, SMOKE 0.6, FLAKE 3, others 0), `drag?: number` (overrides the kind's drag).
- `createParticlePool(scene, capacity)` unchanged; still two layers (additive, normal at a quarter capacity) → 2 draw calls; `update(nowMs) -> boolean` unchanged.

- [ ] **Step 1: Write the failing tests** (in `particles.test.js`, using a real `THREE.Scene`):
  - `each layer is one draw: an InstancedBufferGeometry quad with instanceCount = capacity` (`layer.geometry.isInstancedBufferGeometry === true`, `layer.geometry.instanceCount === capacity`, the scene has exactly 2 children from the pool).
  - `emit writes shape, colorEnd, sizeEnd, stretch and spin into the instance attributes` (emit one particle with each field; read back `aShape`, `aColorEnd`, `aSizeEnd`, `aStretch`, `aSpin` at its index; defaults from the table above when omitted).
  - `old specs still work`: an emit with only the pre-v2 fields gets the kind's default shape and colorEnd = color.
  - `the fragment shader uses the shape chunk`: `material.fragmentShader.includes('shapeAlpha(')`, and `SHAPE_GLSL` from `shapes.js` defines `float shapeAlpha(`.
  - `a context restore leaves the pool usable`: call `pool.emit` after setting every attribute's `needsUpdate` (simulating three's restore path) and `update()` still returns true; no texture is used (`material.uniforms` has no sampler).
- [ ] **Step 2: Run** `rtk proxy npx vitest run tests/unit/particles.test.js` → FAIL.
- [ ] **Step 3: Implement.** Layer = `THREE.Mesh(InstancedBufferGeometry, ShaderMaterial)`: base geometry a unit quad (4 vertices, `aCorner` in -1..1), per-instance `InstancedBufferAttribute`s for every v1 attribute plus `aShape, aColorEnd(3), aSizeEnd, aStretch, aSpin`. Vertex shader: the v1 motion formula; size `mix(1, aSizeEnd, k)`; colour `mix(aColor, aColorEnd, k)`; billboard with the camera's right/up taken from `viewMatrix`; for STREAK, orient the quad along the particle's screen-space velocity (finite difference of the projected position at t and t-0.016) and scale its long axis by `1 + aStretch * screenSpeedPx`; rotate by `aSpin * t` for spinning shapes. Fragment: `alpha = shapeAlpha(shape, q, seed) * vAlpha`; additive layer writes premultiplied colour with alpha = max channel (as `BURST_FRAGMENT` does), normal layer writes `vec4(color, alpha)`. Shapes in `shapes.js`: DOT soft disc with hot core; STREAK soft capsule; SMOKE 3-octave value noise inside a soft disc; GLINT four-point star (two crossed thin ellipses) + core; SHARD triangle; FLAME teardrop (narrow top); FLAKE diamond; RING thin annulus. Keep the head/overwrite logic and `addUpdateRange` per emitted run.
- [ ] **Step 4: Run** particles, catalogue and effect-layer tests → PASS (catalogue tests prove every existing effect still runs on the new pool).
- [ ] **Step 5: Commit** `feat(effects): particle renderer v2: instanced quads, procedural shapes, colour and size over life`.

### Task 3: Glow ribbon and floor glow

**Files:**
- Create: `src/effects/library/ribbon.js`
- Modify: `src/effects/library/catalogue.js` (add the `floorGlow` helper next to `scoped`)
- Test: `tests/unit/ribbon.test.js`, `tests/unit/catalogue.test.js`

**Interfaces:**
- Produces `createRibbon({ maxPoints: number, widthPx: number, color: THREE.Color, glow?: number }) -> { mesh: THREE.Mesh, setPolylines(lines: Array<Array<{x,y,z}>>): void, set alpha(v: number), dispose(): void }`. One mesh for any number of polylines (a strip per line, degenerate joins between them), width in CSS px at a 1080 px tall drawing buffer, scaled by `uHeightPx / 1080` (set in `onBeforeRender` like the particle pool). Fragment: across-width coordinate `w` in -1..1 → `core = smoothstep(0.35, 0, |w|)`, `halo = (1 - |w|)^2 * glow` (glow default 0.6); colour `(color * (core + halo) + vec3(core * 0.6)) * alpha`, premultiplied additive.
- Produces in catalogue.js `floorGlow(ctx, { radius: number, peak: number, ms: number }) -> handle-part` (an additive radial decal on the table at `FLOOR_Y`, colour `ctx.color`, brightness `peak * intensity`, eased in 60 ms then out over `ms`); used by Tasks 6–7.

- [ ] **Step 1: Write the failing tests**: `setPolylines writes 2 vertices per point and degenerate joins between lines` (2 lines of 3 points → expected index/vertex counts, drawRange covers them); `width scales with the drawing buffer height` (call `mesh.onBeforeRender` with a stub renderer reporting height 2160 → `uHeightPx` 2160); `dispose frees geometry and material`; `floorGlow adds one mesh on the floor and removes it at ms`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** (vertex shader: each point carries `prev`, `next` and `side` ±1; extrude perpendicular to the screen-space tangent by `widthPx/2 * uHeightPx/1080` pixels converted to clip space).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(effects): screen-space glow ribbon and floor glow`.

### Task 4: Impact effects while dice tumble

**Files:**
- Modify: `src/effects/effect-layer.js`, `src/throw/dice-box.js` (`#impacts`), `src/settings.js`, `lang/en.json`
- Test: `tests/unit/effect-layer.test.js`, `tests/unit/dice-box.test.js`, `tests/unit/settings.test.js`

**Interfaces:**
- Produces `layer.impact({ position: {x, y, z}, speed: number, surface?: string, dieKey?: string }) -> void`. Nothing when: the library is not loaded, `effects` or `impactEffects` is false, reduced motion, `speed < 11` (the sound engine's medium hit), the same `dieKey` fired < 120 ms ago, or 12 impact emits are already live. Otherwise emits into the pool: a dust ring (KIND.SMOKE, shape RING, `blend: 'normal'`, colour `#d8cfc0` at α 0.35, count `round(3 + 5 * s)`) and, when `speed >= 18`, a few streak sparks (KIND.STREAK, `#fff3d0`, count `round(2 + 4 * s)`), where `s = clamp01((speed - 11) / 7)`, scaled by `particleScale`. Costs no budget; the pool's own life keeps the loop running.
- DiceBox `#impacts` calls `this.#effectsCall((e) => e.impact({ position: d.outer.position, speed, surface, dieKey }))` for each event it already hands to `onImpact` (ghost dice included: an impact reveals no result).
- New client setting `impactEffects` (Boolean, default `true`, config true, `DICER.Settings.impactEffects.Name: "Impact effects"`, `.Hint: "Small dust and sparks where dice hit the table."`).

- [ ] **Step 1: Write the failing tests**: `impact below speed 11 emits nothing; at 14 a dust ring; at 20 dust and sparks` (spy on the injected pool's `emit`); `impact debounces per die for 120 ms and caps 12 live emits`; `impactEffects false, effects false or reduced motion stops impacts`; dice-box: `each playback impact event reaches effects.impact with the die position`; settings: `impactEffects is a client Boolean, default on`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(effects): dust and sparks where dice hit, with an Impact effects setting`.

### Task 5: Timeline composites

**Files:**
- Create: `src/effects/library/timeline.js` (move `composite` and `partContext` from catalogue.js)
- Modify: `src/effects/library/catalogue.js` (import `composite`)
- Test: `tests/unit/timeline.test.js`

**Interfaces:**
- Produces `composite({ id, defaults, parts }) -> effect module`, parts `{ mod, at?: number /* ms after start, default 0 */, color?, intensity?, duration?: number /* ms, default the part's default scaled like today */ }`. Budget rule unchanged (P4-R10): the first part is essential and sets the declared cost; others start, at their `at`, only while `used + cost <= ctx.tier.effectBudget` (decided at composite start, so a skipped part never starts later); free parts always start. `at` scales with `ctx.duration / defaults.duration` like durations do. The composite's `update()` returns true until every started part has ended and no part is still waiting, or `ctx.duration` has passed; `stop()` stops started parts and cancels waiting ones.

- [ ] **Step 1: Write the failing tests**: `a part with at: 200 starts on the first update at or after 200 ms`; `at scales with the composite duration`; `a part the budget skips never starts and does not keep the composite alive` (essential ends at 300 ms → `update(300)` false); `stop() before a part's start cancels it`; existing catalogue celebrate/fumble tests still pass.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** timeline + catalogue tests → PASS.
- [ ] **Step 5: Commit** `refactor(effects): composites get per-part start times (timeline.js)`.

### Task 6: Celebrate and fumble, staged

**Files:**
- Modify: `src/effects/library/catalogue.js`
- Test: `tests/unit/catalogue.test.js`

**Interfaces:** consumes Tasks 2, 3, 5; ids, costs and defaults unchanged (celebrate essential `light-burst` cost 1, duration 1400; fumble essential `smoke` cost 2, duration 1500).

Celebrate (`#ffe27a`): at 0 `number-flare` and `glow-pulse` (anticipation on the die); at 120 `light-burst` (essential, rebuilt in Task 7), `floorGlow` (radius 3, peak 1.2, 700 ms), `shockwave`, a burst of 24 streak sparks (KIND.STREAK, speed 5, spread 1.2, life 0.6, `colorEnd #ff9a3c`) and `tinyShake 0.3 / 280 ms`; at 200 glitter (KIND.FLAKE, 30, from 2.5 above the die falling with gravity −2.5, spin, `#ffffff → color`) for the rest. Essential stays `light-burst` (moved to index 0 with `at: 120`).

Fumble (`#8c8c92`): at 0 `smoke` (essential, noise puffs, `colorEnd #3a3a40`) and `color-shift #3a3a40 / 0.8`; at 80 a grey crack (`createRibbon`, 6 rays, width 3 px, glow 0.2, `#5a5a60`, spreading over 250 ms) and `tinyShake 0.15 / 220 ms`; at 150 a fizzle (8 dim streaks falling, gravity −6, `#c8a070 → #402010`).

- [ ] **Step 1: Write the failing tests**: `celebrate stages: flare at 0, burst parts at 120, glitter at 200` (spy part starts by time); `fumble stages: smoke at 0, crack at 80, fizzle at 150`; `on the low tier (effectBudget 2) celebrate still starts light-burst and fumble still starts smoke`; `celebrate and fumble end and update() turns false by their duration`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(effects): staged celebrate and fumble`.

### Task 7: Rebuild the library looks

**Files:**
- Modify: `src/effects/library/catalogue.js`, `src/effects/library/die-effects.js`
- Test: `tests/unit/catalogue.test.js`

**Interfaces:** consumes Tasks 2, 3; every id, cost and default unchanged. New looks:

| Effect | New look |
|---|---|
| light-burst | billboard halo (BURST_FRAGMENT, softer falloff) + 8 thin rays rotating slowly (RING_FRAGMENT-style angular mask in the same quad shader, `uRays` uniform) + `floorGlow` radius 2.5 |
| shockwave | two rings 90 ms apart, the second fainter; inner edge soft, outer edge sharp; a dust ring (KIND.SMOKE shape RING, normal blend) at the base |
| sparkles | GLINT stars (spinning, twinkle) + spiral DOTs with `colorEnd` white; trickle unchanged |
| embers | FLAME shapes rising (KIND.EMBER, `colorEnd #ff2a00`, sizeEnd 0.3) + 6 streaks + `floorGlow` orange radius 1.6, peak 0.5 for the duration |
| smoke | SMOKE noise puffs, `sizeEnd 2.6`, spin 0.6, normal blend, `colorEnd` 30% darker |
| frost | `createRibbon` cracks (9 rays + branches, width 2.5 px, glow 0.8) spreading over 300 ms + SHARD spray with spin + a pale mist (2 SMOKE puffs, `#e8f8ff`, α 0.3) |
| lightning | `createRibbon` arcs (width 3 px core, glow 1.0) regenerated every 60 ms, with one forked branch per arc + a STREAK spark burst at each arc's end + `floorGlow` blue radius 2, flickering with the arc |
| shatter | SHARD particles at double size with spin 8, `colorEnd` 50% transparent-dark, plus a short GLINT flash at the die |
| glow-pulse | unchanged shell + a soft billboard halo behind the die pulsing in phase |
| color-shift, number-flare, shake | unchanged |

- [ ] **Step 1: Write the failing tests**: `lightning and frost draw with a ribbon, not LineSegments` (no `isLineSegments` child after start); `embers, lightning and light-burst add a floor glow`; `every effect still obeys color, intensity and duration and ends by its duration` (extend the existing table test to assert `update(duration)` is false and the scene is back to its children before start); `a 30-die pool firing sparkles on every die stays within the low tier's budget and never throws` (30 `layer.play` calls with TIERS.low, then 120 updates).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the table.
- [ ] **Step 4: Run** the full suite (`rtk proxy npx vitest run`) and `npm run -s lint` → PASS, including the world-start ratchet.
- [ ] **Step 5: Commit** `feat(effects): rebuild the effect library on the new particles, ribbons and floor glow`.

### Task 8: Live look check and docs

**Files:**
- Modify: `tests/live/effects.mjs` (if it lists effect ids, use `EFFECT_IDS`), the user README's effects section

- [ ] **Step 1:** In Foundry, run `for (const id of ['celebrate','fumble','light-burst','shockwave','sparkles','embers','smoke','frost','lightning','shatter','glow-pulse','color-shift','number-flare']) await game.dice3d.previewEffect(id);` and roll a 30d6 with Impact effects on. Owner signs off the looks; anything they reject goes back to Task 6 or 7.
- [ ] **Step 2:** Run the low-end head-to-head (`npm run test:live:bench -- --quick --only throttled`): no new failures beyond the known first-frame rows, and no quality drop note.
- [ ] **Step 3:** Document `previewEffect` and the Impact effects setting in the README; commit `docs(effects): previewEffect and impact effects`.
