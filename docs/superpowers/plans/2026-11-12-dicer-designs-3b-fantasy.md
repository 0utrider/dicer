# Dice Designs Plan 3b: Fantasy Insides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the fantasy insides the owner asked for after plan 3: a floating **sword**, **axe** and **shield**, a **dragon**, and a glowing **magic circle of runes**. Each is usable wherever looks are used today.

**Architecture:**
- **They extend the existing "floating shape" inside** (`interior.type 'shape'`, today star, heart, skull and sphere). The new shapes are new `interior.shape` values, so the editor, themes and the look API need no new inside type.
- **World start** gets only the longer shape list and the `needsLookExtras` / `fallbackLook` lines.
- **The lazy look-extras chunk** gets every new shape as an inside module under `src/render/extras/insides/`, using plan 3's inside contract: `<x>Inside(a) -> { body, uniforms? }`, registered in `MODULES`, `marchWithUp()`, and the throw safety net.
- **The weapons** are solid 3D signed-distance shapes, turning with the die like today's star and skull (`uShapeRot`).
- **The dragon and the magic circle** are flat, detailed silhouettes that face up (`dcIUp`), like plan 3's butterfly, so the top-down camera sees them whole.

**Tech Stack:** three.js r184 (MeshPhysicalMaterial + onBeforeCompile), WebGL2 GLSL, Vitest, Playwright (`tests/visual/looks.mjs`).

**Spec:** the owner's request in chat (2026-11-12): "fantasy insides? Swords, dragons etc". The owner picked "Sword / axe / shield", "Dragon" and "Runes / magic circle". This plan follows the dice designs spec `docs/superpowers/specs/2026-11-12-dicer-dice-designs-design.md` (Constraints section) and plan 3 (`docs/superpowers/plans/2026-11-12-dicer-designs-3-insides.md`), whose Global Constraints apply here unchanged except where stated.

## Global Constraints

- **Plan 3's Global Constraints all apply.** That covers G2, world start, the fallback rule, low tier, interior steps, the rule of no textures and no lights, the UI rule, repo practice, and the GLSL rules. The GLSL rules include no `pow` of a possibly negative base, guarded `atan` / `normalize` / divides, derivatives only in uniform control flow, and colours clamped to ≤ 1.
- **World-start budget:** no new re-base. Plan 3b spends from plan 3's approved 768-byte allowance over its reference 4_096_369. Plan 3 used 551, so plan 3b may add at most **217 bytes** (checked in Task 5). If it would exceed that, stop and report.
- **Fallback while the chunk is not loaded:** sword, axe, shield, dragon and runes → shape `star` (that roll only).
- **Low tier (fake tint):** each new shape tints the resin like today's `shape` inside does. The world-start `INTERIOR_TINT.shape` (0.2) already applies because the type is still `shape`, so the patch returns `{}` in fake mode.
- **`programKey`** already carries the shape name for type `shape` (`shape:sword:<steps>`), so each new shape is its own program automatically.
- **Colours:**
  - **weapons:** `colors[0]` is the grip, wrap or shield face, and `colors[1]` is the trim, gem or rim accent. Blades, axe heads and the shield boss are bright steel.
  - **dragon:** `colors[0]` is the body and `colors[1]` the wing membranes.
  - **magic circle:** `colors[0]` is the glow and `colors[1]` the inner sigil.
  - `density` sets size (0 small … 1 large), within the march sphere.
- **GLSL name prefixes:** `dcWe…` (weapons), `dcDr…` (dragon), `dcRu…` (runes). Keep main-scope names unique repo-wide.

## Review Focus

- **Today's four shapes:** byte-identical shaders and keys with the chunk loaded, and no chunk import. Test in Task 1 (keys over `LOOKS`, `DAMAGE_THEMES`) and Task 2 (shader loaded vs not, for star, heart, skull and sphere).
- **A new shape with the chunk missing, at low tier, and under safe flags:** it draws the star fallback, today's tint, or the safe program, and never throws. Plan 3's exhaustive test is extended with the five new shapes.
- **The dragon and the magic circle on dice resting on any face, and on the coin:** they face up and stay inside the march sphere. Test in Tasks 3-4 (geometry over all die rest directions, as plan 3 Task 4 did), then the gallery.
- **The weapons at every interior step count:** the existing shape march (bisection refinement, the soft silhouette) keeps them solid without holes. A weapon's thinnest part (the blade edge) is at least 0.02 thick in the canonical frame, so it survives the lowest marched tier.
- **The magic circle glows:** it is emissive, readable in a dark scene, and never above 1 per channel after clamping.

---

## File structure

- **Modify `src/look/appearance.js`:** `SHAPES` += `sword`, `axe`, `shield`, `dragon`, `runes`, plus the `needsLookExtras` and `fallbackLook` lines.
- **Create `src/render/extras/insides/weapons.js`** (sword, axe, shield), **`dragon.js`** and **`runes.js`**.
- **Modify `src/render/extras/insides/index.js`:** register the modules. A module may apply to `type 'shape'` with a given `shape`. Plain star, heart, skull and sphere stay unpatched.
- **Modify the editor:** `src/ui/appearance-form.js` (the literal shape list) and `lang/en.json` (shape labels; follow the existing key prefix for shapes). Modify `templates/appearance-editor.hbs` and `styles/dicer.css` only if the shape chips need it.
- **Modify `dev/looks.js`:** gallery rows. Modify `README.md`.

---

### Task 1: Appearance model and fallback

**Files:**
- Modify: `src/look/appearance.js`
- Test: `tests/unit/appearance.test.js`

**Interfaces:**
- `SHAPES = ['star','heart','skull','sphere','sword','axe','shield','dragon','runes']`.
- `needsLookExtras(a)` is also true for a resin body with `interior.type === 'shape'` and one of the five new shapes.
- `fallbackLook(a)` maps those to `shape: 'star'`.

  Fold the five ids into plan 3's existing structures (the `NEW_INSIDES` map or a sibling) so as few world-start bytes as possible are added.

- [ ] **Step 1: Write the failing tests:**
  - `the five fantasy shapes normalise; unknown shapes still fall back`;
  - `programKey shape:<name> for each; every look in LOOKS and DAMAGE_THEMES keeps its programKey`;
  - `needsLookExtras true only for the new shapes on resin; fallbackLook maps them to star`.
- [ ] **Step 2: Run** `rtk proxy npx vitest run tests/unit/appearance.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS. Measure world start and record the plan-3b figure (≤ 217) in the ledger.
- [ ] **Step 5: Commit** `feat(look): sword, axe, shield, dragon and runes shapes in the appearance model`.

### Task 2: Sword, axe and shield

**Files:**
- Create: `src/render/extras/insides/weapons.js`
- Modify: `src/render/extras/insides/index.js`, `dev/looks.js`
- Test: `tests/unit/look-extras.test.js`

**Interfaces:**
- `weaponsInside(a)` returns a `body` that defines `dcInterior` with the same march behaviour as `interior.js`'s shape march:
  - a signed-distance function rotated by `uShapeRot` and scaled by `INTERIOR.shapeScale × mix(0.8, 1.15, density)`;
  - bisection refinement on a hit;
  - a soft anti-aliased silhouette;
  - a `colors[1]` haze halo.

  Copy the structure; don't import world-start GLSL beyond `INTERIOR_PARS`. One program per shape (the key already differs). A `#define DC_WE_KIND 0/1/2` selects the shape and its material zones.
- **Shapes** (proportions are the builder's call within these):
  - **Sword:** a long, tapering, double-edged blade with a central fuller, a crossguard, a wrapped grip and a round pommel. It is about 0.9 of the march sphere's diameter, laid diagonally.
  - **Axe:** a haft with a crescent blade and a back spike or second blade.
  - **Shield:** a round or heater shield, slightly domed, with a rim, a central boss and a simple emblem relief on the face.
- **Materials by zone:**
  - Steel blades, axe heads and the shield boss: high specular from the key light, a cool environment tint from `dcILight`, and a bright edge glint.
  - Grip and shield face: `colors[0]`, rougher.
  - Trim, pommel gem and rim: `colors[1]`, glossy.
  - Shading: wrap diffuse, specular and ambient occlusion from the SDF, as the shape march does.
- `index.js` applies `weaponsInside` to `type 'shape'` with shape `sword`, `axe` or `shield`. Plain star, heart, skull and sphere return `{}`.

- [ ] **Step 1: Write the failing tests:**
  - `today's four shapes unpatched and byte-identical with the chunk loaded`;
  - `sword/axe/shield: patch interior, distinct keys, DC_WE_KIND per shape, uShapeRot used, no derivatives, dcWe prefix`;
  - extend plan 3's exhaustive never-throws test with the five new shapes.
- [ ] **Step 2: Run** `rtk proxy npx vitest run tests/unit/look-extras.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Real-GPU check:**
  - Add rows `resin~sword` (clear resin; grip #5a2e1a, trim gold #e0b040), `resin~axe` (haft #6b4423, trim #9aa3ad) and `resin~shield` (face #8a1f1f, rim gold #d9a93a).
  - Run `node tests/visual/looks.mjs` (dev, then stripped, reverted) → zero shader errors on every tier.
  - Each weapon is instantly recognisable in close-ups, the steel reads as metal, and there are no holes at the lowest marched tier.
- [ ] **Step 6: Commit** `feat(extras): floating sword, axe and shield insides`.

### Task 3: The dragon

**Files:**
- Create: `src/render/extras/insides/dragon.js`
- Modify: `src/render/extras/insides/index.js`, `dev/looks.js`
- Test: `tests/unit/look-extras.test.js`

**Interfaces:**
- `dragonInside(a)` draws one detailed dragon silhouette on a card (a plane) facing `dcIUp`, centred in the canonical frame, sized by `density`. It is tested exactly per segment, as plan 3's botanical cards are, reusing their frame construction.
- The 2D shape:
  - a sinuous body and neck;
  - a horned head with a jaw;
  - a long tail ending in a spade;
  - four legs with claws;
  - two spread bat wings, with finger bones in `colors[0]` and membranes in `colors[1]`. The membranes are slightly translucent, with veins.

  All edges are anti-aliased. There are scales as a subtle pattern on the body. It is two-sided, lit by `dcILight` and the key light.
- `index.js` applies it to `type 'shape'` with shape `dragon`.

- [ ] **Step 1: Write the failing tests:**
  - `dragon: patch interior, dcIUp-facing card (frame from dcIUp), inside the march sphere at density 1 over all die rest directions, dcDr prefix, no derivatives`;
  - the exhaustive test still green.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Real-GPU check:**
  - Add rows `resin~dragon-red` (body #8a1c1c, membrane #d9603a) and `resin~dragon-green` (body #1f5a2e, membrane #6fbf5a).
  - Run looks.mjs (dev and stripped, reverted) → zero errors.
  - The dragon is unmistakable from above on every resting face and on the d2.
- [ ] **Step 6: Commit** `feat(extras): dragon inside`.

### Task 4: The magic circle of runes

**Files:**
- Create: `src/render/extras/insides/runes.js`
- Modify: `src/render/extras/insides/index.js`, `dev/looks.js`
- Test: `tests/unit/look-extras.test.js`

**Interfaces:**
- `runesInside(a)` draws a glowing magic circle on a card facing `dcIUp`, centred, tested exactly per segment:
  - an outer double ring with a band of 12-16 procedural rune glyphs between the rings (angular strokes from hashed segment patterns, so each glyph differs);
  - an inner geometric sigil (a hexagram or heptagram with a small inner ring) in `colors[1]`;
  - a soft volumetric halo above and below the plane.
- **Emissive:** the circle's colour is `colors[0] × 1.6`, clamped per channel to ≤ 1 after adding to the segment, so it reads in the dark. It is not lit by the key light.
- `index.js` applies it to `type 'shape'` with shape `runes`.

- [ ] **Step 1: Write the failing test:** `runes: patch interior, dcIUp-facing card, emissive term present and clamped, 12-16 glyph sectors, dcRu prefix, no derivatives`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Real-GPU check:**
  - Add rows `resin~runes-arcane` (glow #7fd0ff, sigil #c8a2ff, on a dark resin body) and `resin~runes-fire` (glow #ff9a3a, sigil #ffd27a).
  - Run looks.mjs (dev and stripped, reverted) → zero errors.
  - The circle reads as a glowing rune circle from above on every resting face.
- [ ] **Step 6: Commit** `feat(extras): magic circle of runes inside`.

### Task 5: Editor, owner look check, budget and docs

**Files:**
- Modify: `src/ui/appearance-form.js` (the literal shape list, pinned to `SHAPES` by the existing test pattern), `lang/en.json`, `README.md`; the template and CSS only if needed
- Test: `tests/unit/appearance-editor.test.js`, `tests/visual/editors.mjs`

**Interfaces:**
- `lang/en.json` gains the shape labels "Sword", "Axe", "Shield", "Dragon" and "Magic circle", under the existing key prefix for the floating-shape choices (find it from the "Star" label).

- [ ] **Step 1: Write the failing tests:** `the shape chips list nine shapes with their labels; the form's shape list equals SHAPES; round trip for each new shape`.
- [ ] **Step 2: Run** `rtk proxy npx vitest run tests/unit/appearance-editor.test.js` → FAIL.
- [ ] **Step 3: Implement** the list, the strings and any chip layout fix.
- [ ] **Step 4: Run** the full suite and lint → PASS. Run `npm run test:visual:editors` and `npm run test:visual` → pass, with zero shader errors. Plan-3b world-start growth must be ≤ 217.
- [ ] **Step 5: Owner look check in Foundry:** in the appearance editor (clear resin, Inside: floating shape), try each new shape in the live preview and press Throw. The owner signs off; rejected looks go back to Tasks 2-4.
- [ ] **Step 6:** Update the README Inside sentence (floating shapes now include a sword, axe, shield, dragon and a glowing magic circle). Commit `feat(ui): fantasy shapes in the appearance editor` and `docs(insides): fantasy shapes`.
