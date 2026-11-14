# Living Insides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resin dice insides move (slosh, swirl, drift), four elemental insides exist (fire, storm, frost, lava), damage types pick them, and roll effects flare the inside.

**Architecture:** All new shader and motion code lives in the lazy look-extras chunk (src/render/extras/), which already patches resin insides. When `insideMotion` is on, today's base insides (liquid, glitter, swirl, nebula) are served by animated variants from that chunk, exactly as liquid-extras serves liquid-with-bubbles today. Per-die inputs (time, spin, lag, flare) live on the die's isolated material (`DiceBox.isolate`) and are stepped from `DiceBox.#frame` through one small call into the chunk.

**Tech Stack:** three.js r184, WebGL2 GLSL, vitest, Playwright (visual/perf scripts), Foundry v14.

**Spec:** docs/superpowers/specs/2026-11-14-dicer-living-insides-design.md

## Global Constraints

- World-start must not grow past the `tests/unit/build.test.js` ratchet. New logic goes in the look-extras chunk (`look-extras-*.js`) or the effects chunk (`effects-*.js`); world-start files (dice-box.js, dice-material.js, shaders/interior.js, appearance.js, damage-themes.js, settings.js) get only the minimum wiring. No new `three` imports in world-start code.
- Inside module contract (insides/index.js): `vec4 dcInterior( vec3 p, vec3 rd, float dt )`, only INTERIOR_PARS, `dcIUp`, the four new uniforms below, and own `dc<Prefix>` names; `USES_NOISE` export.
- New uniforms (names exact): `uInteriorTime` (float, seconds since the die's roll spawned, scaled by the motion factor), `uInteriorSpin` (vec3, canonical frame), `uInteriorLag` (vec3, unit, canonical frame), `uInteriorFlare` (float 0..1).
- Canonical frame for spin and lag: the same transform as `dcIUp` (UP_LINE in insides/index.js).
- Elemental insides hold up at 16 march steps; at most four noise lookups per sample with an early out (smoke's budget).
- Settings (exact keys, scope, default): `insideMotion` client true; `insideFlare` client true; `elementalDamageInsides` world true. Strings in lang/en.json under the same keys (Name/Hint), a README bullet each.
- Reduced motion (`prefers-reduced-motion` / ctx.reducedMotion): motion factor × 0.25, slosh spring at quarter speed (ω/4, same ζ), flare rise 300 ms with no agitation strobe, storm sparks hold instead of flash.
- Linger: while a landed roll with moving insides lingers, the loop keeps drawing; the motion factor eases 1 → 0 between 8 s and 10 s after landing, then that roll no longer keeps the loop awake.
- Damage map: only the built-in default rows switch (fire → `fire`, cold → `frost`, electricity → `storm`), keeping their colours and density; world-map and user-override insides are used as written.
- Flare: local only, runs where die effects run (no flare for an effect that is not shown), capped at 1, overlapping flares take the max.
- No image textures, no JB2A pixels, no extra render pass.
- Perf bar: animated inside vs the same die frozen, CPU frame time via the fx-perf probe method, ≤ max(1.05×, +0.05 ms), with 20 such dice.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push.

## Review Focus

1. Changing a die's look mid-roll (theme applied late) keeps its motion state and flare — `#reisolate` must carry all four uniforms. Test in Task 2.
2. `insideMotion` toggled off: shaders are byte-identical to today (the existing "today's insides get no inside patch" test keeps passing with motion off). Test in Task 3.
3. The look-extras chunk not loaded yet (or failing): motion and elementals degrade to today's insides / the fallback type without errors. Test in Tasks 3 and 6.
4. Low tier (interiorSteps 0) and non-resin dice: no isolation, no stepping, no cost. Test in Task 2.
5. A very long `timeBeforeHide`: the loop goes back to 'hold' 10 s after landing. Test in Task 2.

---

## Round 1 — motion

### Task 1: Motion math (lazy, pure)

**Files:**
- Create: `src/render/extras/insides/motion.js`
- Test: `tests/unit/inside-motion.test.js`

**Interfaces:**
- Produces:
  - `SLOSH = Object.freeze({ omega: 13.5, zeta: 0.5 })`, `REST_EASE = Object.freeze({ from: 8000, to: 10000 })`, `SPIN_TAU = 0.15`.
  - `createMotion() -> { time: 0, spin: [0,0,0], lag: [0,1,0], lagVel: [0,0,0], prevQuat: null }`
  - `stepMotion(state, quat /* {x,y,z,w} die world rotation */, dtSec, { reduced = false, factor = 1 }) -> state` — mutates and returns state: `time += dt * factor * (reduced ? 0.25 : 1)`; spin = exponentially smoothed (τ = SPIN_TAU) angular velocity from prevQuat→quat, rotated into the die-local frame, scaled like time; lag = damped spring (SLOSH; ω/4 when reduced) pulling toward die-local world-up, kept unit length.
  - `restFactor(msSinceLanded) -> number` — 1 before REST_EASE.from, smoothstep down to 0 at REST_EASE.to; 1 when not landed (`null`).

- [ ] **Step 1: Write the failing tests**

```js
test('slosh settles within 0.6 s and overshoots once', () => {
  // die turned 90° about z at t=0, then held; step at 1/120 s
  // angle(lag, localUp) < 2% of 90° by 0.6 s; first overshoot between 5% and 25%;
  // every later excursion past the target ≤ 5%
});
test('reduced motion: slosh at quarter speed, time at quarter rate', () => {});
test('spin follows a steady 2π rad/s turn in the die-local frame within 5% after 0.5 s', () => {});
test('lag equals local up for a die at rest from the start', () => {});
test('restFactor: 1 at 0 and 8000 ms, 0.5 at 9000, 0 at 10000 and after, 1 for null', () => {});
test('factor 0 freezes time and spin', () => {});
```

- [ ] **Step 2:** `npx vitest run tests/unit/inside-motion.test.js` → FAIL (module missing).
- [ ] **Step 3:** Implement motion.js (plain math on arrays, no three import).
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `feat(insides): motion math for living insides`.

### Task 2: Per-die motion wiring, uniforms, `insideMotion` setting

**Files:**
- Modify: `src/throw/dice-box.js` (spawn isolation, `#frame`, `#reisolate`), `src/render/extras/look-extras.js` (export the stepping entry), `src/render/extras/insides/index.js` (declare the four uniforms in the patch pars and supply their initial values), `src/render/dice-material.js` (flag `insideMotion` in material flags / programKey only), `src/settings.js`, `lang/en.json`, `README.md`
- Test: `tests/unit/dice-box.test.js`, `tests/unit/settings.test.js`, `tests/unit/build.test.js` (must still pass)

**Interfaces:**
- Consumes: Task 1 `createMotion`, `stepMotion`, `restFactor`.
- Produces:
  - look-extras export `insideMotion = { wants(appearance, flags) -> boolean, step(die, uniforms, quat, dtSec, opts) }`; `wants` is true only for resin + inside ≠ 'none' + `flags.interiorSteps > 0` + `flags.insideMotion`.
  - The four uniforms exist on every patched inside material with defaults time 0, spin (0,0,0), lag (0,1,0), flare 0.
  - DiceBox: dice for which `wants` is true are isolated at spawn; `#frame` steps them each frame with `factor = restFactor(now - roll.landedAt)`; a lingering roll keeps `moving = true` while any of its dice has factor > 0; `#reisolate` carries `uInteriorTime`, `uInteriorSpin`, `uInteriorLag`, `uInteriorFlare` alongside uFxTint/uFxFlare.
  - Setting `insideMotion` (client, Boolean, true) feeds `flags.insideMotion`; changing it rebuilds materials the way `interiors` does.

- [ ] **Step 1: Write the failing tests** (dice-box.test.js, in its existing fake-renderer style):
  - `a resin die with an inside is isolated at spawn when insideMotion is on; an opaque die and a low-tier die are not`
  - `#frame advances uInteriorTime on an isolated inside die`
  - `a lingering roll with a moving inside returns true until 10 s after landing, then 'hold'` (fake clock; timeBeforeHide 60000)
  - `a look change mid-roll keeps the same uInteriorTime/Spin/Lag/Flare objects` (#reisolate)
  - `insideMotion off: nothing isolated for motion, frame result as today`
  - settings.test.js: `insideMotion is registered (client, true) and has strings`
- [ ] **Step 2:** `npx vitest run tests/unit/dice-box.test.js tests/unit/settings.test.js` → new tests FAIL.
- [ ] **Step 3:** Implement. dice-box.js reaches the chunk through `getLookExtras()` (extras-loader.js) and does nothing while it is null.
- [ ] **Step 4:** `npx vitest run` (whole suite, includes build.test after `npm run build`) → PASS.
- [ ] **Step 5:** Commit `feat(insides): per-die inside motion state and insideMotion setting`.

### Task 3: Animated variants of today's insides

**Files:**
- Create: `src/render/extras/insides/living.js` (animated liquid, glitter, swirl, nebula)
- Modify: `src/render/extras/insides/index.js` (route base types to living.js when `flags.insideMotion`), `src/render/extras/insides/liquid-extras.js` (bubbles/sand use the lagged surface), `src/render/extras/insides/smoke.js` (drift)
- Test: `tests/unit/look-extras.test.js` (`describe('insides')`)

**Interfaces:**
- Consumes: Task 2 uniforms.
- Produces: `livingInside(a) -> { body, uniforms? }` per inside contract, `USES_NOISE`.
- Behaviour (from spec): liquid surface uses `uInteriorLag` instead of `dcIUp`; glitter cells advect along a swirl about `uInteriorSpin`'s axis, angle ∝ time × (0.15 + |spin|); swirl/nebula/smoke sample positions drift with `uInteriorTime` (slow: one feature width per ~4 s).

- [ ] **Step 1: Write the failing tests**
  - `with insideMotion, liquid/glitter/swirl/nebula get the living patch and read uInteriorTime`
  - `liquid's living patch reads uInteriorLag, not dcIUp, for the surface`
  - `without insideMotion, today's insides get no inside patch` (the existing test, run with `insideMotion: false` added to FLAGS — must stay byte-identical)
  - `chunk missing: insideMotion looks render today's shader` (via `_setLookExtrasImport`, as the existing test)
  - `every living inside compiles at 16 and 48 steps`
- [ ] **Step 2:** `npx vitest run tests/unit/look-extras.test.js` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same → PASS; then full `npx vitest run` → PASS.
- [ ] **Step 5:** Commit `feat(insides): liquid slosh, glitter swirl, cloud drift`.

### Task 4: Life touches for the other insides

**Files:**
- Modify: `src/render/extras/insides/eye.js`, `runes.js`, `dragon.js` (and `botanical.js`, `foil.js`, `weapons.js` only if cheap)
- Test: `tests/unit/look-extras.test.js`

**Interfaces:** Consumes Task 2 uniforms. Each touch is gated on `flags.insideMotion` (no change to the shader when off).

- Eye: pupil offset toward the view ray by up to 0.15 iris radii, eased with time. Runes: glow pulses 0.7–1.0 over 2.5 s. Dragon: glow breathes 0.8–1.0 over 3 s. Others: drop any touch that adds a noise lookup.

- [ ] **Step 1:** Tests: `each touched inside reads uInteriorTime only with insideMotion`; `shader unchanged with insideMotion off`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(insides): small life touches for eye, runes, dragon`.

### Task 5: Insides visual sheet and perf probe

**Files:**
- Create: `tests/visual/insides.mjs`, `tests/visual/insides-perf.mjs` (reuse `fx-common.mjs`, `fx-vite.config.mjs`)
- Modify: `dev/looks.js` (URL params: `inside=<type>`, `motion=0|1`, `steps=16|32|48`, `bg=light`, `t=<ms>` freeze-at time, `spin=` scripted tumble), `package.json` scripts `test:visual:insides`, `test:visual:insides-perf`

**Interfaces:** Produces sheets `docs/signoff/insides/<round>/<type>.png`: rows dark/light table × moments (400 ms into flight, 1 s after landing) × steps 16/48, plus a reduced-motion row; perf JSON `artifacts/insides/perf.json` (20 dice, frozen vs moving, best of 7).

- [ ] **Step 1:** Write the scripts; run `npm run test:visual:insides -- --round round-1`; expected: one PNG per base inside + smoke + eye/runes/dragon, no page errors.
- [ ] **Step 2:** Run `npm run test:visual:insides-perf`; expected: prints frozen/moving ms per frame per inside and PASS/FAIL against the bar.
- [ ] **Step 3:** Commit `test(insides): visual sheets and perf probe` (sheets committed under docs/signoff/insides/round-1).

### Checkpoint A (controller): perf run, sheets sent to owner, STOP for sign-off.

---

## Round 2 — elemental insides

### Task 6: `fire` and `lava` insides

**Files:**
- Create: `src/render/extras/insides/fire.js`, `src/render/extras/insides/lava.js`
- Modify: `src/render/extras/insides/index.js` (MODULES, INSIDE_TINT fire 0.45, lava 0.45), `src/look/appearance.js` (INTERIOR_TYPES + NEW_INSIDES fallbacks: fire → liquid, lava → liquid), `src/ui/appearance-form.js` (INTERIOR_TYPES), `src/ui/appearance-editor.js` (INSIDE_ICONS fire `fa-fire`, lava `fa-volcano`), `lang/en.json`, `tests/visual/insides.mjs` (types)
- Test: `tests/unit/look-extras.test.js`, `tests/unit/appearance.test.js` (or the existing normalize test file)

**Interfaces:** Each module per the inside contract; colors[0] = hot core, colors[1] = cool edge; density = fill. Fire: flames rise from the bottom toward `dcIUp` (world up, so flames rise whichever way the die lies), flicker with time, roar with flare (Task 9 reads `uInteriorFlare`; declare its use now as `1.0 + uInteriorFlare`). Lava: glowing body under a dark crust (colour = body colour darkened) whose cracks open and reseal over ~3 s.

- [ ] **Step 1:** Tests: `fire and lava normalize as interior types`; `chunk missing: fire draws liquid, lava draws liquid`; `fire/lava compile at 16 and 48 steps and stay within four noise lookups` (count `dcNoise3`/`dcFbm3` calls in the body); `motion off: they render a still frame (time read is constant 0)`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS, full suite + build.test PASS.
- [ ] **Step 5:** Commit `feat(insides): fire and lava insides`.

### Task 7: `storm` and `frost` insides

Same files and pattern as Task 6 (create `storm.js`, `frost.js`; fallbacks storm → nebula, frost → glitter; icons storm `fa-cloud-bolt`, frost `fa-snowflake`; INSIDE_TINT storm 0.45, frost 0.3).

- Storm: dark cloud (colors[1]) with short forked sparks (colors[0]) at hashed spots, each flashing ≤ 120 ms then fading, one every ~0.4 s; reduced motion: sparks hold steady at half brightness.
- Frost: ice spikes growing inward from the sphere wall to a radius set by density, cold haze, a glint crawling over the spikes with time.

- [ ] **Step 1:** Tests as Task 6 for storm/frost, plus `reduced motion define makes storm sparks steady` (whatever flag carries reduced motion into the material — use the existing reduced-motion source; if none exists in materials, a define `DICER_CALM` set from `matchMedia` in the chunk).
- [ ] **Step 2–4:** Run → FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(insides): storm and frost insides`.

### Task 8: Damage types pick the elementals, `elementalDamageInsides` setting

**Files:**
- Modify: `src/effects/damage-themes.js`, `src/settings.js`, `lang/en.json`, `README.md`
- Test: `tests/unit/damage-themes.test.js`, `tests/unit/settings.test.js`

**Interfaces:** With the setting on, the default rows' interiors become `{ type: 'fire' | 'frost' | 'storm', colors, density }` with that row's existing colours and density; off → today's rows. World map / user override values naming another theme or inside are untouched.

- [ ] **Step 1:** Tests: `fire/cold/electricity default rows use fire/frost/storm with the setting on, same colours and density`; `setting off: today's interiors`; `a world map entry pointing fire at another theme is unchanged`; `elementalDamageInsides registered (world, true) with strings`.
- [ ] **Step 2–4:** FAIL → implement → PASS (full suite + build.test).
- [ ] **Step 5:** Commit `feat(insides): damage themes use elemental insides`.

### Checkpoint B (controller): sheets for the four elementals (round-2), perf, STOP for sign-off.

---

## Round 3 — flare

### Task 9: Inside flare from roll effects, `insideFlare` setting

**Files:**
- Create: `src/effects/library/inside-flare.js`
- Modify: `src/effects/library/die-effects.js` and the crit/fumble effects in `src/effects/library/catalogue.js` (lightning, frost, fumble, celebrate, light-burst, shockwave: those that have a die in ctx), every inside module's GLSL (agitation by `uInteriorFlare`), `src/settings.js`, `lang/en.json`, `README.md`
- Test: `tests/unit/inside-flare.test.js`, `tests/unit/catalogue.test.js`, `tests/unit/look-extras.test.js`, `tests/unit/settings.test.js`

**Interfaces:**
- Produces: `flareInside(ctx, die, { amount = 1, duration }) -> stop()` in inside-flare.js: writes `uInteriorFlare` on `ctx.isolate(die)`; envelope rise 80 ms (300 ms reduced, no overshoot), linear-ish decay to 0 at `duration`; value = max of all active flares on that die, capped at 1; no-op when `insideFlare` is off, the die has no inside uniform, or isolate returns null.
- Agitation per inside: liquid boils (surface noise amplitude × (1 + 3·flare)), glitter scatters (swirl speed × (1 + 4·flare)), fire roars (height and brightness × (1 + flare)), storm strikes (spark rate × (1 + 5·flare)), frost flashes (glint × (1 + 3·flare)), lava cracks wide, others brighten (emission × (1 + flare)).

- [ ] **Step 1:** Tests: `envelope: 0 at 0, ≥ 0.95 at 80 ms, 0 at duration`; `two flares overlap → max, capped at 1`; `reduced motion: rise 300 ms, monotonic`; `off / no inside / isolate null → no write`; catalogue: `lightning/frost/fumble on a die with an inside raise uInteriorFlare`; look-extras: `every inside's body reads uInteriorFlare`; settings: `insideFlare registered (client, true) with strings`.
- [ ] **Step 2–4:** FAIL → implement → PASS (full suite + build.test).
- [ ] **Step 5:** Commit `feat(insides): roll effects flare the inside`.

### Task 10: Public hook for Animater and other modules

**Files:**
- Modify: `src/api/dice3d.js` (method next to `previewEffect`), `README.md` (API section), `docs/` API doc if present
- Test: the api test file covering `previewEffect`

**Interfaces:** `flareInside(target, { die, amount = 1, duration = 900 } = {}) -> boolean` — `target` is a roll id or a ChatMessage id of a roll on this screen; `die` an index (default: every die of that roll); returns false (no-op) when the setting is off, nothing matches, or no die has an inside. Local only; never broadcast.

- [ ] **Step 1:** Tests: `flares every inside die of a roll on screen`; `die index picks one`; `unknown id → false`; `setting off → false`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(api): flareInside for other modules`.

### Checkpoint C (controller): flare sheets (crit and fumble on fire/glitter/liquid dice), final whole-branch review, STOP for owner.
