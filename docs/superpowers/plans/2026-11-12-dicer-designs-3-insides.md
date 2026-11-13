# Dice Designs Plan 3: Insides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the four inside designs the owner chose: foil flakes, a floating eye that stays upright, real-object inclusions (flower, moss, butterfly), and a smoke plume, plus two liquid options (an air bubble that floats to the top and sand that settles to the bottom). Each is usable wherever looks are used today.

**Architecture:**
- **Insides stay resin-only, ray-marched in die-local space** like today's (`src/render/shaders/interior.js`).
- **World start gets only:**
  - the new option lists and their normalisation;
  - a `programKey` part for the liquid options;
  - the `needsLookExtras` / `fallbackLook` extensions;
  - an `interior` field on the extras patch, which `createDiceMaterial` uses instead of `interiorChunk(...)`;
  - two exports from `interior.js`: its shared parts and its march loop.
- **The lazy look-extras chunk** gets every new inside under `src/render/extras/insides/`. Each returns `{ pars, main }` built from those shared parts, as `interiorChunk` does.
- **Gravity-aligned effects** (the eye, the bubble, the sand) need the world's "up" in the die's frame. The chunk builds its `main` from the exported march loop with one inserted line that sets `dcIUp` from the die's rotation, so "up" follows the die every frame at no world-start cost.

**Tech Stack:** three.js r184 (MeshPhysicalMaterial + onBeforeCompile), WebGL2 GLSL, Vite lazy chunks, Vitest, Playwright (`tests/visual/looks.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-12-dicer-dice-designs-design.md` (items 9-12 and the Constraints section). Plans 1-2 built the chunk, the loader, the hook, `mergePatches` (`src/render/extras/merge.js`) and the body modules this plan sits beside.

## Global Constraints

- **G2, "each option costs only when used":**
  - A look with today's interior types, and no bubble or sand, gets exactly today's `programKey`, shader text, defines and uniforms, and never imports the chunk.
  - Today's interiors (liquid, glitter, swirl, nebula, shape) are unchanged.
- **World start:** new shader code lives in `src/render/extras/` only. World-start code gets only the lists, normalisation, `programKey`, `needsLookExtras`, `fallbackLook`, the `p.interior` hook and the two `interior.js` exports.
- **World-start budget (needs the owner's approval at plan review):**
  - Plan 2 left 310 bytes of its 1,024, and this plan needs about 400.
  - Task 1 re-bases the ratchet once, on purpose, to the bundle as it stands before Task 1's code change.
  - All of plan 3 may grow world start by at most **768 bytes** over that new reference (checked in Task 7). The 4 MiB budget keeps about 95 KB of headroom.
- **Fallback rule** (while the chunk is not loaded; that roll only):
  - foil → glitter;
  - eye → shape `sphere`;
  - botanical → swirl;
  - smoke → swirl;
  - bubble and sand → off.

  Safe flags have no interior, as today.
- **Low tier** (interior steps 0, the "fake" tint): a new inside tints the resin body like today's do. The patch supplies the tint share through `uResinTint.w`, from an `INSIDE_TINT` table in the chunk: foil 0.15, eye 0.2, botanical 0.25, smoke 0.4. No world-start table changes.
- **Interior steps** (the `DICER_STEPS` define, the tier) apply unchanged. A new inside must look right at the lowest marched tier's step count. Glitter-style exact per-segment tests (flake and card intersections) keep thin objects from vanishing between steps.
- **Keep vertex attributes unchanged.** Add no `THREE.Light` and no textures: every inclusion is procedural.
- **Appearance fields** are normalised: an unknown value falls back, and each field is part of `appearanceKey` (automatically).
  - `programKey`'s interior part already carries the type, so each new type is its own program.
  - The inclusion kind is a uniform (one program for all three).
  - Bubble and sand change `programKey` (`liquid+b`, `liquid+s`, `liquid+bs`).
- **UI:** every new option is in the appearance editor's inside section, with strings under `DICER.Appearance.*` in `lang/en.json`.
- **Repo practice:**
  - Use the Grep tool.
  - Files are CRLF.
  - Run tests as `rtk proxy npx vitest run <file>` and lint with `npm run -s lint`.
  - Importing a world-start symbol that `dist/dicer.js` does not already export into the chunk costs about 10 world-start bytes each. Count it.
  - Measure world start with a scratch script summing `worldStartFiles()` from `build/world-start.js` after a build.
- **GLSL rules learned in plans 1-2:**
  - Use distinct name prefixes per module (`dcFo…` foil, `dcEy…` eye, `dcBo…` botanical, `dcSm…` smoke, `dcLq…` liquid options).
  - Keep main-scope names unique repo-wide.
  - Keep derivatives in uniform control flow.
  - Clamp colours to ≤ 1.

## Review Focus

- **Saved looks, themes and damage themes with today's insides:** identical `programKey` and program, and no chunk import. Tests: Task 1 (keys over every look in `LOOKS` and `DAMAGE_THEMES`, hard-coded from the base commit) and Task 2 (same shader with the chunk loaded).
- **A new inside on a non-resin body:** it is hidden, as today (normalisation forces `none`). Switching back to resin restores it. Bubble or sand on a non-liquid inside is ignored: no key part, and no chunk import because of it. Test in Task 1.
- **A new inside rolled before the chunk loads, and at low tier:** the fallback draws without throwing, and the fake tint uses the patch's share. Tests: Task 2 (dice-box first roll) and Task 2 (the fake mode `uResinTint.w`).
- **The eye, bubble and sand while the die tumbles:** "up" is taken from the die's current rotation. A die resting on any face shows the pupil, the bubble at the top and the sand at the bottom. Tests in Tasks 3 and 5 (shader text: `dcIUp` set from `dcRm` before the march loop). Then the real-GPU gallery, where dice rest on different faces.
- **A coin (d2) with each new inside:** the canonical frame squashes the volume into the caps, as today. Nothing is clipped to a hard edge or turned edge-on and invisible. Each task's gallery check includes the d2 column.

---

## File structure

- **Modify `src/look/appearance.js`:**
  - `INTERIOR_TYPES` += `foil`, `eye`, `botanical`, `smoke`;
  - new `INCLUSIONS = ['flower','moss','butterfly']`;
  - `interior.inclusion`, `interior.bubble` and `interior.sand` normalisation;
  - the `programKey` liquid part;
  - `needsLookExtras` and `fallbackLook`.
- **Modify `src/render/shaders/interior.js`:** export `INTERIOR_PARS` (today's `COMMON_PARS`) and `INTERIOR_MARCH` (today's `MARCH`). Both are already strings; only the export is new.
- **Modify `src/render/dice-material.js`:** when marching, `const interior = p.interior ?? interiorChunk(type, shape)`.
- **Modify `src/render/extras/merge.js`:** `interior`, last wins.
- **Create `src/render/extras/insides/`:**
  - `index.js`: `insidePatch(a, flags)`, `INSIDE_TINT`, `marchWithUp()`;
  - `foil.js`, `eye.js`, `botanical.js`, `smoke.js`, `liquid-extras.js`.
- **Modify `src/render/extras/look-extras.js`:** merge `insidePatch`.
- **Modify the editor:** `src/ui/appearance-form.js`, `src/ui/appearance-editor.js`, `templates/appearance-editor.hbs`, `styles/dicer.css`, `lang/en.json` (the inside section).
- **Modify `tests/unit/build.test.js`:** the re-base.
- **Modify `dev/looks.js`:** gallery rows.
- **Modify `README.md`:** the Inside part of the Material bullet.

---

### Task 1: Appearance model, world-start hooks and the ratchet re-base

**Files:**
- Modify: `src/look/appearance.js`, `src/render/shaders/interior.js`, `src/render/dice-material.js`, `tests/unit/build.test.js`
- Test: `tests/unit/appearance.test.js`, `tests/unit/dice-material.test.js`

**Interfaces:**
- `DEFAULT_APPEARANCE.interior` gains `inclusion: 'flower'`, `bubble: false` and `sand: false`. Normalisation:
  - `inclusion` is picked from `INCLUSIONS`, default `'flower'`;
  - `bubble` and `sand` are `=== true`.

  They are stored whatever the type, as `shape` is today.
- `programKey`: when the interior is active, `a.interior.type === 'liquid'` and bubble or sand is set, the interior part becomes `liquid+b:<steps>`, `liquid+s:<steps>` or `liquid+bs:<steps>`. Otherwise it is unchanged.
- `needsLookExtras(a)` is also true when:
  - the body is resin and the interior type is foil, eye, botanical or smoke;
  - or the body is resin, the type is liquid, and bubble or sand is set.
- `fallbackLook(a)` maps the interior as the Global Constraints say:
  - `type`: foil → glitter, eye → `shape` with `shape: 'sphere'`, botanical → swirl, smoke → swirl;
  - `bubble` and `sand` → false.
- `ExtrasPatch` gains `interior?: { pars: string, main: string }`. `createDiceMaterial` uses `p.interior` in place of `interiorChunk(...)` when it is set and the mode is `march`.
- `interior.js` exports `INTERIOR_PARS` and `INTERIOR_MARCH`. These are the same strings `interiorChunk` already joins; `interiorChunk`'s output is byte-identical.

- [ ] **Step 1: Re-base the ratchet with no code change.**
  - Build, then read the world-start total.
  - Set the reference in `tests/unit/build.test.js`, with the comment "Dice designs plan 3 re-based it on purpose (<value>): plan 3 may spend at most 768 bytes of the next 2 KB."
  - Commit `test(build): re-base the world-start ratchet for dice designs plan 3`.
- [ ] **Step 2: Write the failing tests:**
  - appearance:
    - `new interior types, inclusion, bubble and sand normalise; unknown values fall back`;
    - `liquid with bubble/sand gets liquid+b / +s / +bs in programKey; non-liquid insides ignore them`;
    - `every look in LOOKS and DAMAGE_THEMES keeps its programKey and needsLookExtras false` (keys hard-coded from the base commit);
    - `a new inside on a non-resin body is none and needs no extras`;
    - `fallbackLook maps foil→glitter, eye→shape:sphere, botanical→swirl, smoke→swirl, bubble/sand→false`.
  - dice-material:
    - `a patch's interior replaces interiorChunk in the march` (a stubbed chunk returns `{ interior: { pars: '// PARS-X', main: '// MAIN-X' } }` for a foil look; the fragment shader contains both markers, and no `dcInterior` from a built-in type);
    - `interiorChunk output is unchanged` (compare with the base commit's string for each built-in type).
- [ ] **Step 3: Run** `rtk proxy npx vitest run tests/unit/appearance.test.js tests/unit/dice-material.test.js` → FAIL.
- [ ] **Step 4: Implement.** Keep it compact: world start.
- [ ] **Step 5: Run** those tests and `tests/unit/build.test.js` → PASS. Note the plan-3 growth in the ledger.
- [ ] **Step 6: Commit** `feat(look): foil, eye, botanical and smoke insides, liquid bubble and sand in the appearance model`.

### Task 2: The inside patch skeleton and foil flakes

**Files:**
- Create: `src/render/extras/insides/index.js`, `src/render/extras/insides/foil.js`
- Modify: `src/render/extras/look-extras.js`, `src/render/extras/merge.js`, `dev/looks.js`
- Test: `tests/unit/look-extras.test.js`, `tests/unit/dice-box.test.js`

**Interfaces:**
- `insidePatch(a, flags) -> ExtrasPatch` returns `{}` unless the body is resin and an inside module applies. Otherwise:
  - **Marched** (`flags.interiors && flags.interiorSteps > 0`): `{ interior: { pars, main }, uniforms }`.
  - **Fake** (steps 0): `{ uniforms: { uResinTint: <Vector4 tint target as createDiceMaterial computes it, with w = INSIDE_TINT[type]> } }`. Reuse the target maths by passing the computed colour, or recompute it the same way, and document which.
- `INSIDE_TINT = { foil: 0.15, eye: 0.2, botanical: 0.25, smoke: 0.4 }`.
- `marchWithUp() -> string` returns `INTERIOR_MARCH` with one line inserted directly after the `dcIKey = …;` line:
  ```glsl
  dcIUp = normalize( transpose( dcRm ) * vec3( 0.0, 1.0, 0.0 ) * dcIs );
  ```
  The patch's `interior.main` is that string. Every module's pars declare `vec3 dcIUp;`, so a module that doesn't use it still compiles. The test asserts the inserted line appears once, after `dcIKey`.
- Every inside module exports `<type>Inside(a) -> { body: string /* its GLSL, defining vec4 dcInterior( vec3 p, vec3 rd, float dt ) */, uniforms?: object }`. `index.js` builds `pars` as `[NOISE_GLSL if needed, INTERIOR_PARS, 'vec3 dcIUp;', body].join('\n')`, so `NOISE_GLSL` is included once.
- **`foil.js`:** larger, irregular, crumpled metal-foil shards, sparser than glitter. Each is a flat polygon-ish shard (an irregular outline from a few hashed radii) tested exactly per segment, like glitter's flakes. Each flashes strongly where its normal mirrors the key light into the eye, and stays dim otherwise. `colors[0]` is the main foil colour, and `colors[1]` is the second foil colour for about 30% of the shards. `density` sets how many shards there are.

- [ ] **Step 1: Write the failing tests:**
  - `today's insides get no inside patch and keep today's shader with the chunk loaded` (liquid, glitter, swirl, nebula and each shape, loaded vs not: fragment shader, defines, key);
  - `foil: interior pars/main come from the patch; dcIUp declared once; the up line inserted once after dcIKey; NOISE_GLSL once`;
  - `fake mode: uResinTint.w = INSIDE_TINT.foil, no interior chunk`;
  - dice-box: `a foil look rolled before the chunk loads draws glitter, then foil after it loads`.
- [ ] **Step 2: Run** `rtk proxy npx vitest run tests/unit/look-extras.test.js tests/unit/dice-box.test.js` → FAIL.
- [ ] **Step 3: Implement** `insides/index.js`, `foil.js`, the `interior` merge in `merge.js`, and the merge in `patchMaterial`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Real-GPU check:**
  - Add gallery rows `resin~foil-gold` (a clear resin with gold and copper foil) and `resin~foil-silver`.
  - Run `node tests/visual/looks.mjs` (dev, then the stripped run described in its header, reverted; `git diff build vite.config.js` empty) → zero shader errors on every tier.
  - The foil flashes on some faces and reads as foil, not glitter. Check the low tier and the d2.
- [ ] **Step 6: Commit** `feat(extras): foil flake insides`.

### Task 3: The floating eye

**Files:**
- Create: `src/render/extras/insides/eye.js`
- Modify: `src/render/extras/insides/index.js`, `dev/looks.js`
- Test: `tests/unit/look-extras.test.js`

**Interfaces:**
- `eyeInside(a)` defines one eyeball, a sphere of radius about 0.42 in the canonical frame, centred. Its pupil axis is `dcIUp`, so the pupil always faces up whatever face the die rests on.
- Shading:
  - a white-ish sclera with faint red veins towards the back;
  - an iris disc around the up axis in `colors[0]`, with radial fibres and a darker limbal ring;
  - a black pupil;
  - a wet specular highlight from the key light;
  - `colors[1]` tints the sclera slightly.
- Opaque where hit (it ends the march, as shape does), with a soft anti-aliased silhouette as shape's `DC_SHAPE_AA`. `density` sets pupil size (0 small … 1 wide).

- [ ] **Step 1: Write the failing test:** `eye: dcIUp is used for the pupil axis; one program; patch interior present; fake tint 0.2`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Real-GPU check:**
  - Add rows `resin~eye-green` and `resin~eye-red`.
  - Run looks.mjs (dev and stripped, reverted) → zero errors.
  - On the PNG every die (resting on different faces) shows the pupil facing up, towards the camera from above. The d2 shows a squashed but readable eye.
- [ ] **Step 6: Commit** `feat(extras): floating eye inside that stays upright`.

### Task 4: Flower, moss and butterfly inclusions

**Files:**
- Create: `src/render/extras/insides/botanical.js`
- Modify: `src/render/extras/insides/index.js`, `dev/looks.js`
- Test: `tests/unit/look-extras.test.js`

**Interfaces:**
- `botanicalInside(a)` returns uniforms `{ uBoKind: { value: INCLUSIONS index (0 flower, 1 moss, 2 butterfly) } }`. It is one program; the kind is a uniform branch.
- **Flower and butterfly:** 2-3 small "cards" (planes) at hashed positions and tilts inside the volume, each tested exactly per segment like glitter's flakes. Each card draws a procedural 2D shape with an anti-aliased alpha edge:
  - **flower:** 5-6 rounded petals in `colors[0]` around a `colors[1]` centre, with a slight petal gradient;
  - **butterfly:** two pairs of wing lobes in `colors[0]` with `colors[1]` veins and spots, and a thin dark body.

  Cards are lit by `dcILight` and the key light, two-sided, and slightly translucent at the edges.
- **Moss:** a soft, fuzzy, volumetric clump in the lower-centre, built from fbm density, in `colors[0]` with `colors[1]` tips. It is not a card; it sits low in die-local space (not gravity-aligned, like a pressed specimen).
- `density` sets card size (flower, butterfly) or clump size (moss).

- [ ] **Step 1: Write the failing test:** `botanical: one program for the three kinds (same key), uBoKind 0/1/2, fake tint 0.25`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Real-GPU check:**
  - Add rows `resin~flower`, `resin~moss` and `resin~butterfly`.
  - Run looks.mjs (dev and stripped, reverted) → zero errors.
  - Each inclusion is recognisable at close-up size and does not flicker between tiers.
- [ ] **Step 6: Commit** `feat(extras): flower, moss and butterfly inclusions`.

### Task 5: Smoke plume, and bubble and sand for liquid

**Files:**
- Create: `src/render/extras/insides/smoke.js`, `src/render/extras/insides/liquid-extras.js`
- Modify: `src/render/extras/insides/index.js`, `dev/looks.js`
- Test: `tests/unit/look-extras.test.js`

**Interfaces:**
- **`smokeInside(a)`:** a wispy ink or smoke plume. It is built from curl-like warped fbm with thin, stretched tendrils (not a uniform cloud; nebula already is one), in `colors[0]`, with `colors[1]` where it is thin or lit. It rises along die-local y with a soft base. `density` sets thickness.
- **`liquidExtrasInside(a)`:** today's liquid core, copied from `interior.js` LIQUID's maths into the chunk so world start is untouched, plus:
  - **bubble:** one air bubble (radius about 0.09) at the top of the volume along `dcIUp`, just inside the liquid boundary. It is a clear sphere with a bright rim and a highlight, and it displaces the core.
  - **sand:** a settled layer at the bottom along `-dcIUp`. It is a flat-topped granular band (fine hashed grains, `colors[1]`, slightly darker) filling up to about 22% of the volume's height.
- Liquid with bubble or sand uses `liquidExtrasInside` and its own program (the `liquid+…` key from Task 1). Plain liquid is never patched.

- [ ] **Step 1: Write the failing tests:**
  - `smoke: patch interior, fake tint 0.4`;
  - `liquid + bubble / sand / both: patched, dcIUp used, keys distinct; plain liquid unpatched`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Real-GPU check:**
  - Add rows `resin~smoke`, `resin~liquid-bubble`, `resin~liquid-sand` and `resin~liquid-bubble-sand`.
  - Run looks.mjs (dev and stripped, reverted) → zero errors.
  - On dice resting on different faces, the bubble is always at the top and the sand always at the bottom.
- [ ] **Step 6: Commit** `feat(extras): smoke plume inside, liquid bubble and sand`.

### Task 6: Appearance editor: the new insides

**Files:**
- Modify: `src/ui/appearance-form.js`, `src/ui/appearance-editor.js`, `templates/appearance-editor.hbs` (the inside section), `styles/dicer.css`, `lang/en.json`, `dev/looks.js` (only if rows need tidying)
- Test: `tests/unit/appearance-editor.test.js`, `tests/visual/editors.mjs`

**Interfaces:**
- `appearance-form.js`:
  - the interior type list gains `'foil','eye','botanical','smoke'`;
  - `INCLUSION_LIST` is a literal copy of `INCLUSIONS`, pinned by a test;
  - the form's `interior` gains `inclusion`, `bubble` and `sand`;
  - `visibleSections()` gains `inclusion: type === 'botanical'` and `liquidOptions: type === 'liquid'`.
- Template:
  - the inside-type chips gain four entries;
  - an inclusion chip radiogroup (`data-field="interior.inclusion"`) shows for botanical;
  - two toggles (`interior.bubble`, `interior.sand`) show for liquid, reusing the editor's existing toggle pattern if there is one, or a checkbox styled like the others.
- `lang/en.json` under `DICER.Appearance`:
  - `InteriorType.foil` "Foil flakes", `InteriorType.eye` "Floating eye", `InteriorType.botanical` "Inclusion", `InteriorType.smoke` "Smoke";
  - `Interior.Inclusion` "Inclusion", `Inclusion.flower` "Flower", `Inclusion.moss` "Moss", `Inclusion.butterfly` "Butterfly";
  - `Interior.Bubble` "Air bubble", `Interior.Sand` "Sand".

  Check the existing key prefix for interior types (it may be `Interior.` or `InteriorType.`) and follow it.
- Colour labels: today's two inside colours keep their labels. For the eye, the first colour's label reads "Iris colour" (`Interior.IrisColor`) when the type is eye.

- [ ] **Step 1: Write the failing tests:**
  - `form round-trips every new inside, inclusion, bubble and sand`;
  - `the form's lists are exactly what normalisation accepts`;
  - `inclusion chips only for botanical; bubble and sand only for liquid; iris label for the eye`;
  - extend the i18n key table, and check every key resolves.
- [ ] **Step 2: Run** `rtk proxy npx vitest run tests/unit/appearance-editor.test.js tests/unit/templates.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** those tests and the full suite → PASS. Then `npm run test:visual:editors` → passes.
- [ ] **Step 5: Commit** `feat(ui): foil, eye, inclusions, smoke, bubble and sand in the appearance editor`.

### Task 7: Owner look check, budgets and docs

**Files:**
- Modify: `README.md` (the Material bullet's Inside sentence)

- [ ] **Step 1:** `rtk proxy npx vitest run` and `npm run -s lint` → all pass. Plan-3 world-start growth must be ≤ 768 over the Task 1 reference.
- [ ] **Step 2:** `npm run test:visual` → zero shader errors on every tier. The existing rows' distinct `programKey` count is unchanged.
- [ ] **Step 3: Owner look check in Foundry:**
  - In the appearance editor (clear resin), try each new inside in the live preview: turn the die and watch the foil flash; check that the eye keeps looking up; try each inclusion; try smoke; try liquid with the bubble and the sand.
  - Press Throw for each: the eye, bubble and sand stay upright as the dice tumble.
  - The owner signs off. Rejected looks go back to Tasks 2-6.
- [ ] **Step 4:** `npm run test:live:bench -- --quick --only throttled` → no new failures beyond the known first-frame rows. Skip it only if the owner says so.
- [ ] **Step 5:** Update the README. Commit `docs(insides): foil flakes, floating eye, flower, moss and butterfly inclusions, smoke, bubble and sand`.
