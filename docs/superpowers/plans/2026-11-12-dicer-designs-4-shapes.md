# Dice Designs Plan 4: Shapes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the four shape designs the owner chose:
- **Fate dice and d3 / d5:** relabelled d6 and d10.
- **Crystal d4:** an alternative d4 shape chosen in the look.
- **d14 and d16, and d7:** d7 is a relabelled d14.
- **Pipped d6 and coin motifs.**

Foundry's `dF`, `d3`, `d5`, `d7`, `d14` and `d16` change from "falls back" to "animates".

**Architecture:**
- **Shapes stay pure data** in `src/core/dice-shapes.js`:
  - one generalised trapezohedron builder makes d10 (byte-identical to today), d14 and d16;
  - a new `d4crystal` builder makes the crystal d4.
  - Shapes gain an optional `readFaces` (the faces a result can be read from). The crystal's pointed caps carry no number and are never a result.
- **The physics worker** gets hulls for the three new shape types at init.
- **Relabelled dice need no new geometry.** The throw planner turns a Foundry term into a die of an existing shape with a `variant`, and labels follow the variant: `d3` and `dF` on the d6, `d5` on the d10, `d7` on the d14.
- **Fate dice** use the existing text-face system (`FaceSet`, the same path as preset glyph faces) for `+`, `−` and blank, so no shader work is needed.
- **Pips and coin motifs are look options** drawn as glyphs in the lazy look-extras chunk, reusing plan 1's icon-atlas machinery.

**Tech Stack:** three.js r184, Rapier (physics worker), Vitest, Playwright (`tests/visual/looks.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-12-dicer-dice-designs-design.md`, items 13-16 and the Constraints section. Items 13-16 say:
- **13.** "relabelled existing dice: no new geometry or physics";
- **14.** "must be fair (symmetric faces)";
- **15.** "built the way the d10 is; fair by symmetry";
- **16.** "a pips option for the d6 … coin faces with motifs".

## Global Constraints

- **G2:** today's dice (d2-d20 and the d100 pair) and looks render, roll and read exactly as before. That means the same vertices, faces, values, hulls, labels, programKeys and shader text. A new shape costs only when a die of it is thrown. A pips or coin-motif look costs only when used, via the chunk.
- **Fairness (spec):**
  - every labelled face of a new shape is congruent: equal area, equal distance from the centre, and the same angles;
  - opposite labelled faces exist and sum to n + 1, like the d10;
  - the crystal d4's 4 long faces are congruent;
  - its 8 cap faces are unstable (the centre of mass projects outside each cap face, so a die can never rest on a cap);
  - face reading is reliable: every labelled face, set exactly up (crystal) or down (classic d4), reads back as itself, and so does every face tilted by up to 20°.

  These go in the same test file as today's shape tests.
- **World-start budget (needs the owner's approval at plan review):**
  - Shapes, the planner, the face reader, the hulls and dice-box all load at world start.
  - Task 1 re-bases the ratchet once, on purpose, to the bundle as it stands before Task 1's code change.
  - All of plan 4 may grow world start by at most **1,536 bytes** over that new reference (checked in Task 6). The 4 MiB budget keeps about 95 KB of headroom.
  - Pip and motif glyph code lives in the lazy chunk.
- **DSN compatibility:** DSN presets, colorsets and terms keep working:
  - `dsnTypeOf(term)` stays the key for per-type looks: `df`, `d3`, `d5`, `d7`, `d14`, `d16`.
  - A die skipped today because of its face count is now thrown.
  - Unsupported face counts are still skipped and counted.
- **Physics:**
  - A die keeps its Foundry type for its value. Its shape type picks the hull, geometry and reader: `d4` with the crystal look uses `d4crystal`.
  - The physics worker's hull map gains `d14`, `d16` and `d4crystal`, computed at init like today's.
  - A look change still never changes today's dice's physics.
- **Keep vertex attributes unchanged.** Add no textures, except the existing face-layer canvas for Fate faces.
- **UI:** every new look option is in the appearance editor, with strings under `DICER.Appearance.*`.
- **Repo practice:**
  - Use the Grep tool.
  - Files are CRLF.
  - Run tests as `rtk proxy npx vitest run <file>` and lint with `npm run -s lint`.
  - Measure world start with a scratch script summing `worldStartFiles()` after a build.
  - Importing a world-start symbol that `dist/dicer.js` does not export into the chunk costs about 10 bytes each.

## Review Focus

- **A roll mixing old and new dice** (`/r 1d20 + 1dF + 1d7 + 1d16`): each die animates, shows its own result, and counts correctly in `skipped`. A d100 is unaffected. Test in Task 3 (planner) plus the dice-box test.
- **Ghost dice and multi-client sync for relabelled dice:** every client shows the same face value. The face choice is deterministic (from the result index), never random. Test in Task 3.
- **Crystal d4 landing:** it always settles on a long face, never balances on a point, and the turn-to-result rotation (`rotationToShow`) shows the right number upright. Tests in Task 1 (stability, reader) and Task 2 (`rotationToShow` per long face), plus the real-GPU / physics check.
- **A per-type look for the new types** (a theme's `perType.d14`, a DSN preset for `df`): it applies. A d7 die looks up `d7`, not `d14`. Test in Task 3.
- **Pips or a coin motif with icons, raised relief, outline fill, or a d100 / ghost / preset face:** the rules match plan 1's icons:
  - pips only on a plain d6;
  - coin motifs only on the d2;
  - preset faces, ghosts and other types keep their labels.

  Test in Task 5.

---

## File structure

- **Modify `src/core/dice-shapes.js`:**
  - `buildTrapezohedron(n)` (d10 identical);
  - `d14` and `d16`;
  - `buildD4Crystal()`;
  - `readFaces`;
  - `dieTypeForFaces` (14 and 16);
  - `labelFor` variants (`d3`, `d5`, `d7`).
- **Modify `src/core/face-reader.js`:** respect `readFaces`.
- **Modify `src/physics/hulls.js`:** `HULL_TYPES` += `d14`, `d16`, `d4crystal`.
- **Modify `src/core/chamfer.js` and the geometry and label layout** only as needed for 7- and 8-kite trapezohedra and for the crystal (long rectangular faces, unlabelled caps).
- **Modify `src/throw/throw-planner.js`:** the face-count and denomination mapping, variants, and Fate faces.
- **Modify `src/throw/dice-box.js`:** shape type from the look (crystal d4); material and geometry cache keys split by variant and shape type.
- **Modify `src/look/appearance.js`:** `shapes.d4` (`'classic' | 'crystal'`), `numbers.pips` (bool) and `numbers.coin` (`'numbers' | 'heads-tails' | 'sun-moon'`).
- **Create `src/render/extras/glyphs.js`:** pips and coin motifs, drawn into the label atlas like plan 1's icons.
- **Modify the editor** files and `lang/en.json`, `dev/looks.js` (gallery columns and rows) and `README.md`.

---

### Task 1: Shape builders, fairness, face reading and hulls (with the ratchet re-base)

**Files:**
- Modify: `src/core/dice-shapes.js`, `src/core/face-reader.js`, `src/physics/hulls.js`, `tests/unit/build.test.js`
- Test: `tests/unit/dice-shapes.test.js`, `tests/unit/face-reader.test.js`

**Interfaces:**
- **`buildTrapezohedron(type, n)`:** an n-gonal trapezohedron, generalising `buildD10`.
  - Rings are at angles 2πk/n and 2πk/n + π/n.
  - Kite planarity gives `h = a(1 + cos(π/n)) / (1 − cos(π/n))`.
  - Values come from `oppositeValues`.
  - `getShape('d10')` must deep-equal today's output (vertices, faces, values, readMode).
- **`getShape('d14')`** (n = 7) and **`getShape('d16')`** (n = 8) are new.
- **`dieTypeForFaces`** returns `d14` for 14 and `d16` for 16.
- **`buildD4Crystal()`**, type `'d4crystal'`: an elongated square bipyramid.
  - **Vertices:** a square ring of 4 at ±s in x and z and height ±L (8 vertices), plus tips at ±T on y, with T > L.
  - **Faces:** 4 long rectangular side faces, plus 4 triangular cap faces at each end.
  - **Values:** the long faces get 1-4 so that opposite long faces sum to 5. The caps get value 0.
  - **`readFaces`:** the 4 long-face indices.
  - **`readMode`:** `'up'` (the face opposite the resting face).
  - **Proportions** are the builder's call within: long faces at least 2.2× as long as they are wide, tips steep enough that every cap face is unstable (see the fairness test), and the overall circumradius 1, like the other shapes.
- **Face reader:** `readTopFace(shape, q)` considers only `shape.readFaces` when present. `faceForValue` and `rotationToShow` work for every labelled face of the new shapes.
- **Hulls:** `HULL_TYPES` += `'d14'`, `'d16'`, `'d4crystal'`.

- [ ] **Step 1: Re-base the ratchet with no code change.**
  - Build, then read the world-start total.
  - Set the reference in `tests/unit/build.test.js`, with the comment "Dice designs plan 4 re-based it on purpose (<value>): plan 4 may spend at most 1,536 bytes of the next 2 KB."
  - Commit `test(build): re-base the world-start ratchet for dice designs plan 4`.
- [ ] **Step 2: Write the failing tests:**
  - `d10 from the generalised builder deep-equals today's d10` (hard-code today's values, or compare with a frozen copy);
  - `d14/d16: 14/16 congruent kites (equal area, equal centre distance), planar, CCW from outside, opposite faces sum to n+1, unit circumradius`;
  - `d4crystal: 4 congruent long faces valued 1-4 with opposites summing to 5; 8 cap faces valued 0; readFaces = the long faces; every cap face unstable (the centre's projection onto the cap's plane lies outside the cap triangle); every long face stable`;
  - face-reader:
    - `every labelled face of d14, d16, d4crystal reads back exactly and tilted 20°`;
    - `the crystal never reads a cap`;
    - `rotationToShow shows each long face of the crystal upright`;
  - hulls: `computeHulls includes d14, d16, d4crystal; today's hulls unchanged` (compare point arrays).
- [ ] **Step 3: Run** `rtk proxy npx vitest run tests/unit/dice-shapes.test.js tests/unit/face-reader.test.js` → FAIL.
- [ ] **Step 4: Implement.** Keep it compact: world start.
- [ ] **Step 5: Run** those tests and `tests/unit/build.test.js` → PASS. Note the plan-4 growth in the ledger.
- [ ] **Step 6: Commit** `feat(shapes): d14, d16 and the crystal d4 shapes, fair and readable`.

### Task 2: Geometry, labels and physics for the new shapes

**Files:**
- Modify: `src/core/chamfer.js` and the geometry / label-layout module(s) that build a die mesh and place its number (find them from `getShape` callers in `src/render/` and `src/throw/`); the physics worker init path (`src/physics/sim.js` / the worker) only if new types need wiring beyond `HULL_TYPES`; `dev/looks.js`
- Test: the existing geometry / label tests for the touched modules, `tests/unit/physics-client.test.js`

**Interfaces:**
- **d14 and d16:** rounded meshes at all 5 edge steps, like the d10. The number sits on each kite like the d10's, sized to the kite.
- **Crystal:** the number lies along the long axis of each long face, upright when that face is up; caps are blank.
- **Physics:** a `d14`, `d16` or `d4crystal` body uses its hull. A thrown crystal settles on a long face.

- [ ] **Step 1: Write the failing tests:**
  - `geometry builds for d14, d16, d4crystal at every edge step, with one label slot per labelled face`;
  - `crystal caps carry no label`;
  - `the physics client sends hulls for d14, d16 and d4crystal at init`.

  If the repo has a headless physics test path (check `physics-client.test.js` and `sim.js`), add `a d4crystal dropped from 20 random orientations rests on a long face (readTopFace in readFaces, |up · face normal| > 0.99)`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Real-GPU check:**
  - Add gallery columns or rows for `d14`, `d16` and `d4crystal` in `dev/looks.js`. Check how the die-type columns are defined and the `SHOWN` max-face rule.
  - Run `node tests/visual/looks.mjs` (dev, then stripped, reverted) → zero errors.
  - The new dice look right at every tier, and the numbers are readable and upright.
- [ ] **Step 6: Commit** `feat(shapes): meshes, labels and physics for d14, d16 and the crystal d4`.

### Task 3: Foundry terms: dF, d3, d5, d7, d14, d16

**Files:**
- Modify: `src/throw/throw-planner.js`, `src/core/dice-shapes.js` (`labelFor` variants), `src/throw/dice-box.js` (cache keys by variant), `src/compat/faces.js` (a built-in Fate `FaceSet`, if it is the right home)
- Test: `tests/unit/throw-planner.test.js`, `tests/unit/dice-shapes.test.js`, `tests/unit/dice-box.test.js`

**Interfaces:**
- **`diceFor`** maps the Foundry term (it needs the term, not only `faces`; pass `dsnTypeOf(term)` or the term) to dice. Every face choice uses the result's index in its term, never randomness:

| Term | Die | Value / face | Labels |
|---|---|---|---|
| `df` (FateDie) | d6, `variant: 'dF'` | result +1 → face value 1 or 2, 0 → 3 or 4, −1 → 6 or 5 (the second of each pair for an odd result index) | a built-in Fate `FaceSet` on the d6: values 1, 2 `+`; 3, 4 blank; 5, 6 `−` |
| faces 3 | d6, `variant: 'd3'` | value v → face v (even index) or v + 3 (odd) | ((face − 1) mod 3) + 1 |
| faces 5 | d10, `variant: 'd5'` | value v → face v or v + 5 | ((face − 1) mod 5) + 1 |
| faces 7 | d14, `variant: 'd7'` | value v → face v or v + 7 | ((face − 1) mod 7) + 1 |
| faces 14, 16 | d14, d16 | as is | as is |

- **`labelFor(type, value, variant)`:** handles `d3`, `d5` and `d7` as in the table. 6 and 9 keep their `.` mark only when the drawn number is 6 or 9.
- **Fate faces:** `+` and `−` render through the existing text-face path. Find how preset faces flow from `DieSpec.faces` to `createFaceTextures` and the face-layer material. Blank faces use `{ kind: 'blank' }`.
- **Dice-box caches** (material and label) are keyed by variant and Fate face set, as `d100tens` already is. Two dice of the same shape with different variants never share labels.
- **Per-type looks:** a die's look lookup uses `dsnTypeOf(term)` (`df`, `d3`, `d5`, `d7`, `d14`, `d16`). The fallback chain is unchanged.

- [ ] **Step 1: Write the failing tests:**
  - planner:
    - `dF, d3, d5, d7, d14, d16 are thrown with the table's type/variant/value; the face choice follows the result index`;
    - `unsupported counts (d9) still skipped`;
    - `a mixed roll counts skipped correctly`;
    - `the d100 pair is unchanged`.
  - labels: `labelFor variants; 6./9. marks only on drawn 6 and 9`.
  - dice-box:
    - `a d7 and a d14 in one roll get different label sets`;
    - `a Fate die uses the Fate faces`;
    - `perType.d7 and perType.df looks apply`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS, plus the full suite (sync and ghost tests included).
- [ ] **Step 5: Commit** `feat(throw): dF, d3, d5, d7, d14 and d16 animate as relabelled and new dice`.

### Task 4: The crystal d4 look option

**Files:**
- Modify: `src/look/appearance.js`, `src/throw/dice-box.js`
- Test: `tests/unit/appearance.test.js`, `tests/unit/dice-box.test.js`

**Interfaces:**
- **`DEFAULT_APPEARANCE`** gains `shapes: { d4: 'classic' }`. It normalises to `'classic' | 'crystal'`, and is part of `appearanceKey` automatically. Shape choice is not a shader concern, so it is not in `programKey`.
- **dice-box:** a die of Foundry type `d4` whose resolved look has `shapes.d4 === 'crystal'` uses shape type `d4crystal` for geometry, physics hull, reader and labels. Its value semantics stay d4.

- [ ] **Step 1: Write the failing tests:**
  - `shapes.d4 normalises; legacy looks get classic; every LOOKS / DAMAGE_THEMES programKey unchanged`;
  - `a d4 with a crystal look is thrown as d4crystal (hull, geometry key, reader) and shows the rolled value`;
  - `other types ignore shapes.d4`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(look): crystal d4 as a look option`.

### Task 5: Pipped d6 and coin motifs

**Files:**
- Modify: `src/look/appearance.js` (`numbers.pips`, `numbers.coin`, `needsLookExtras` / `fallbackLook`), `src/render/extras/look-extras.js`
- Create: `src/render/extras/glyphs.js`
- Test: `tests/unit/appearance.test.js`, `tests/unit/glyphs.test.js` (new)

**Interfaces:**
- **Normalisation:** `numbers.pips` (bool, default false) and `numbers.coin` (`'numbers' | 'heads-tails' | 'sun-moon'`, default `'numbers'`).
- **`needsLookExtras`** is true for pips or a coin motif. **`fallbackLook`** sets `pips: false` and `coin: 'numbers'`.
- **`glyphs.js`:**
  - **Pips:** for a plain d6 (labels equal `labelFor('d6', v)`), each face's label becomes a pip glyph for its value (1-6 classic layouts, round pips).
  - **Coin motifs:** for the d2, labels become motif glyphs: heads = a crowned head in profile, tails = a laurel wreath; sun = a rayed sun, moon = a crescent.
  - Glyphs are drawn into the label atlas with plan 1's icon machinery (reuse `composeAtlas`, `cropGlyph`, the `withIcons`-style cache; extract shared helpers from `icons.js` if that keeps it DRY), so they take the number's fill, depth and relief.
  - Merged in `patchMaterial`. Icons (plan 1) win on the d20 only, so there is no conflict: pips are d6-only and motifs d2-only.
  - Ghosts, preset faces, d100 and other types keep their labels.

- [ ] **Step 1: Write the failing tests:**
  - `pips/coin normalise and need extras; fallback clears them; programKey unchanged`;
  - `pips: a plain d6's labels become 6 distinct pip chars; a preset-face d6 and other types unchanged`;
  - `coin motifs: d2 labels become the motif pair; other types unchanged`;
  - `glyph atlas composes like icons (font glyph boxes unchanged, glyphs below)`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Real-GPU check:**
  - Add rows `ruby~pips` (d6 pips) and `gold~coin-sun-moon`, `gold~coin-heads-tails`.
  - Run looks.mjs (dev and stripped, reverted) → zero errors.
  - Pips read as real pipped dice, and the motifs read at coin size.
- [ ] **Step 6: Commit** `feat(extras): pipped d6 and coin motifs`.

### Task 6: Editor, owner look check, budget and docs

**Files:**
- Modify: `src/ui/appearance-form.js`, `src/ui/appearance-editor.js`, `templates/appearance-editor.hbs`, `styles/dicer.css`, `lang/en.json`, `README.md`
- Test: `tests/unit/appearance-editor.test.js`, `tests/visual/editors.mjs`

**Interfaces:**
- **Edges section:** a "d4 shape" segmented control (`shapes.d4`), with `Shapes.D4` "d4 shape", `Shapes.classic` "Classic" and `Shapes.crystal` "Crystal".
- **Numbers section:** a "Pips on the d6" checkbox (`numbers.pips`, label `Numbers.Pips`) and a "Coin faces" chip group (`numbers.coin`): `Coin.numbers` "1 and 2", `Coin.heads-tails` "Heads and tails", `Coin.sun-moon` "Sun and moon".
- Follow plans 1-3's patterns: literal lists pinned by tests, real booleans from checkboxes, and the i18n key table.

- [ ] **Step 1: Write the failing tests:**
  - `round trip of shapes.d4, pips, coin`;
  - `lists pinned to normalisation`;
  - `controls render with their labels`;
  - extend the i18n key table.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full suite and lint → PASS. Run `npm run test:visual:editors` and `npm run test:visual` → pass, with zero shader errors. Plan-4 world-start growth must be ≤ 1,536.
- [ ] **Step 5: Owner look check in Foundry:**
  - roll `/r 4dF`, `/r 1d3 + 1d5 + 1d7`, `/r 1d14 + 1d16`;
  - roll a d4 with the crystal look;
  - roll a d6 with pips and a d2 with each motif.

  The owner signs off. Rejected items go back to Tasks 1-5.
- [ ] **Step 6:** `npm run test:live:bench -- --quick --only throttled` → no new failures. Skip it only if the owner says so.
- [ ] **Step 7:** Update the README: the supported dice list (dF, d3, d5, d7, d14, d16), the crystal d4, pips and coin faces. Commit `feat(ui): crystal d4, pips and coin faces in the appearance editor` and `docs(shapes): new dice and options`.
