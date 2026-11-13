# Dice Designs Plan 2: Bodies and Materials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the four body-layer designs the owner chose: iridescent bodies (chameleon, opal, dichroic), gemstones (amethyst, malachite, obsidian, quartz), wood (oak, walnut, cherry, ebony), two more metal finishes (copper patina, battle-worn), and a luminous (glow-in-the-dark) option for any body. Each is usable wherever looks are used today.

**Architecture:** This follows plan 1's pattern.
- **World start** gets only:
  - the new option lists and their normalisation;
  - the `programKey` part for luminous;
  - the `needsLookExtras` / `fallbackLook` extensions;
  - a `params` field in the extras patch, so a body can set its MeshPhysicalMaterial parameters;
  - the sound-material entries.
- **The lazy look-extras chunk** gets every new shader, under `src/render/extras/bodies/`:
  - one module per body, plus one for the metal finishes and one for luminous;
  - the chunk's `patchMaterial` merges a `bodyPatch(a, flags)` beside the plan 1 patches.
- **Presets:** a body's preset (gem, wood or iridescent kind) is a uniform. So there is one program per body type, not one per preset.

**Tech Stack:** three.js r184 (MeshPhysicalMaterial + onBeforeCompile), WebGL2 GLSL, Vite lazy chunks, Vitest, Playwright (the real-GPU gallery `tests/visual/looks.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-12-dicer-dice-designs-design.md` (items 5-8 and the Constraints section). Parent: `docs/superpowers/specs/2026-11-10-dicer-design.md` (G2, G3, G4). Plan 1 (`docs/superpowers/plans/2026-11-12-dicer-designs-1-numbers.md`) built the chunk, loader and hook this plan extends.

## Global Constraints

- **G2, "each option costs only when used":**
  - A look whose body type, finish and luminous are today's values gets exactly today's `programKey`, shader text, defines and uniforms, and never imports the chunk.
  - The opaque, resin, metal (polished/brushed/antique), marble and pearl programs are unchanged.
- **World start:**
  - New shader code lives in `src/render/extras/` only.
  - World-start code gets only the lists, normalisation, `programKey`, `needsLookExtras`, `fallbackLook`, the `params` hook in `dice-material.js` and the `soundMaterialOf` entries.
- **World-start budget (needs the owner's approval at plan review):**
  - Plan 1 left 528 bytes of the ratchet's 2,048 (reference 4_094_135), and plan 3 still needs room.
  - Task 1 re-bases the ratchet once, on purpose, to the bundle as it stands before Task 1's code change.
  - All of plan 2 may grow world start by at most **1,024 bytes** over that new reference (checked in Task 8).
- **Fallback rule** (while the chunk is not loaded, and always under safe flags): a die draws `fallbackLook(a)`, for that roll only. `refreshMaterials()` runs when the chunk lands, as in plan 1. The mappings:
  - iridescent → pearl (same colours);
  - gem → marble (same colours);
  - wood → opaque (`color`);
  - patina and worn → antique;
  - luminous → 0.
- **Keep vertex attributes unchanged** (WebGL2/ANGLE attribute limits). **Add no `THREE.Light`.** No new textures: every pattern is procedural (die-local 3D noise from `src/render/shaders/noise.js`, as marble does).
- **Appearance fields** are normalised: an unknown value falls back, and each field is part of `appearanceKey` (automatically). `programKey` changes for:
  - a new body type (already a key part);
  - a new metal finish (already a key part);
  - luminous > 0 (a new `lum` part).

  The body preset is a uniform, never a key part.
- **Interiors stay resin-only**, as today: the new body types have no inside.
- **Real refraction and ray-traced gems are a non-goal.** Gems and dichroic glass are procedural surface and volume colour.
- **UI:** every new option is in the appearance editor's material section, with strings under `DICER.Appearance.*` in `lang/en.json`.
- **DSN:** colorset and preset mapping (`src/compat/colorset-map.js`) is not changed. DSN looks keep today's bodies. Only `soundMaterialOf` learns the new body types.
- **Repo practice:**
  - Use the Grep tool (a shell hook mangles grep).
  - Files are CRLF.
  - Run tests as `rtk proxy npx vitest run <file>` and lint with `npm run -s lint`.
  - Importing a world-start symbol that `dist/dicer.js` does not already export into the chunk makes `dicer.js` export it, at about 10 bytes each. Count it.

## Review Focus

- **Saved looks, themes, damage themes and legacy flat looks with today's bodies:** identical `programKey` and program, and no chunk import. Tests: Task 1 (keys, `needsLookExtras` false over every built-in look in `LOOKS` and `DAMAGE_THEMES`) and Task 2 (same shader with the chunk loaded).
- **A preset that does not belong to the body type:** for example `{type:'wood', preset:'opal'}`, or a type switched in the editor that keeps its old preset. It normalises to that type's first preset, and a body type without presets stores `preset: null`. Test in Task 1.
- **A gem, wood or iridescent look rolled before the chunk loads:** it draws the fallback body without throwing, and the next roll draws the real body. Test in Task 2 (dice-box, as plan 1 Task 2 did for numbers).
- **Patina or worn on a non-metal body:** the finish is ignored, just as brushed and antique are today. The key part is `-`, there is no chunk import because of the finish, and the fallback is unchanged. Test in Task 1.
- **Luminous on every body type, with glow off, engraving off and safe flags:** it never throws. Safe flags draw the single safe program with no luminous. With `flags.glow` off, luminous still shows: it is a body property, not the glow effect. Tests in Task 1 (key) and Task 6 (patch).

---

## File structure

- **Modify `src/look/appearance.js`:**
  - `BODY_TYPES` += `iridescent`, `gem`, `wood`;
  - `FINISHES` += `patina`, `worn`;
  - new exported `BODY_PRESETS`;
  - `body.preset` and `body.luminous` normalisation;
  - the `programKey` `lum` part;
  - `needsLookExtras` and `fallbackLook`.
- **Modify `src/render/dice-material.js`:** apply `p.params` with `material.setValues(p.params)` after the body preset.
- **Modify `src/audio/sound-material.js`:** `BODY` gains `wood: 'wood'`, `gem: 'stone'`, `iridescent: 'glass'`.
- **Create `src/render/extras/bodies/`:**
  - `index.js`: `bodyPatch(a, flags)`;
  - `iridescent.js`, `gem.js`, `wood.js`, `metal-finishes.js`, `luminous.js`.
- **Modify `src/render/extras/look-extras.js`:** merge `bodyPatch`.
- **Create `src/look/body-colors.js`:** `PRESET_COLORS`, the default colours and roughness per preset and per new finish. It is imported only by the editor and `dev/looks.js`, never by world start.
- **Modify the editor:** `src/ui/appearance-form.js`, `src/ui/appearance-editor.js`, `templates/appearance-editor.hbs`, `styles/dicer.css`, `lang/en.json` (the material section).
- **Modify `build/world-start.js`** only if a new lazy chunk name appears. Modify `tests/unit/build.test.js` for the re-base.
- **Modify `dev/looks.js`:** gallery rows, the real-GPU compile check.
- **Modify `README.md`:** the Material bullet.

---

### Task 1: Appearance model, world-start hooks and the ratchet re-base

**Files:**
- Modify: `src/look/appearance.js`, `src/render/dice-material.js`, `src/audio/sound-material.js`, `tests/unit/build.test.js`
- Test: `tests/unit/appearance.test.js`, `tests/unit/dice-material.test.js`, `tests/unit/sound-material.test.js` (create if absent)

**Interfaces:**
- Produces in `appearance.js`:
  - `export const BODY_PRESETS = Object.freeze({ iridescent: ['chameleon', 'opal', 'dichroic'], gem: ['amethyst', 'malachite', 'obsidian', 'quartz'], wood: ['oak', 'walnut', 'cherry', 'ebony'] })`.
  - `DEFAULT_APPEARANCE.body` gains `preset: null` and `luminous: 0`.
  - Normalisation:
    - `preset` is `BODY_PRESETS[type]` containing the value ? the value : that list's first entry, and it is `null` for a type without presets;
    - `luminous` is `num(0..1, 0)`;
    - `finish` keeps today's rule (it is stored, and only metal reads it).
- `programKey`: when `a.body.luminous > 0`, push `'lum'` (non-safe only; the safe key is unchanged).
- `needsLookExtras(a)` is also true when:
  - `BODY_PRESETS[a.body.type]` exists;
  - or `a.body.type === 'metal'` and the finish is `patina` or `worn`;
  - or `a.body.luminous > 0`.
- `fallbackLook(a)` also maps the body (per Global Constraints):
  - `type`: `{iridescent:'pearl', gem:'marble', wood:'opaque'}[type] ?? type`;
  - `finish`: `patina`/`worn` → `'antique'`;
  - `luminous` → 0;
  - `preset` → null.
- `ExtrasPatch` gains `params?: object`. `createDiceMaterial` calls `material.setValues(p.params)` after `p.defines`/`p.uniforms` are merged, when `p.params` is set.
- `soundMaterialOf`: wood → 'wood', gem → 'stone', iridescent → 'glass'.

- [ ] **Step 1: Re-base the ratchet first, with no code change yet.**
  - Build, then read the world-start total.
  - Set the reference in `tests/unit/build.test.js` to that value. Its comment says: "Dice designs plan 2 re-based it on purpose (<value>): plan 2 may spend at most 1,024 bytes of the next 2 KB."
  - Commit `test(build): re-base the world-start ratchet for dice designs plan 2`.
- [ ] **Step 2: Write the failing tests:**
  - appearance:
    - `new body types, finishes and presets normalise; a preset not of its type falls back to the type's first; types without presets store null`;
    - `luminous is 0..1, default 0`;
    - `programKey gains lum only for luminous > 0 and never under safe flags`;
    - `every look in LOOKS and DAMAGE_THEMES keeps its programKey and needsLookExtras false` (compare with the key computed at the base commit, hard-coded in the test);
    - `patina or worn on a non-metal body: key part '-', needsLookExtras false`;
    - `fallbackLook maps iridescent→pearl, gem→marble, wood→opaque, patina/worn→antique, luminous→0, preset→null`.
  - dice-material: `a patch's params reach the material (setValues)`, using a stubbed chunk whose `patchMaterial` returns `{ params: { clearcoat: 0.25 } }` for a wood look.
  - sound-material: `wood, gem and iridescent bodies get wood, stone and glass`.
- [ ] **Step 3: Run** `rtk proxy npx vitest run tests/unit/appearance.test.js tests/unit/dice-material.test.js tests/unit/sound-material.test.js` → FAIL.
- [ ] **Step 4: Implement** the three source changes. Keep them compact: these bytes are world start.
- [ ] **Step 5: Run** those tests and `tests/unit/build.test.js` → PASS. Note the plan-2 growth in the ledger.
- [ ] **Step 6: Commit** `feat(look): iridescent, gem and wood bodies, patina and worn finishes, luminous in the appearance model`.

### Task 2: The body patch skeleton and the iridescent body

**Files:**
- Create: `src/render/extras/bodies/index.js`, `src/render/extras/bodies/iridescent.js`
- Modify: `src/render/extras/look-extras.js`, `dev/looks.js`
- Test: `tests/unit/look-extras.test.js`, `tests/unit/dice-box.test.js`

**Interfaces:**
- `bodyPatch(a, flags) -> ExtrasPatch` merges, with `mergePatches`, each body module's patch for `a`. It returns `{}` for today's bodies.
  - A module that uses noise exports `USES_NOISE = true`.
  - `bodyPatch` prepends `NOISE_GLSL` (from `src/render/shaders/noise.js`) to `chunks.pars` once, when any merged module uses it. The world-start `bodyChunks` only adds it for marble and antique, which never combine with a new body or finish, so it is never included twice.
- Every new body module exports:
  - `PRESET_PARAMS: Record<presetId, number[4]>`: per-preset shape parameters (frequency, warp, contrast, sparkle or similar; the meanings are the module's call, documented in it);
  - a `<body>Patch(a) -> ExtrasPatch` that returns:
    - `defines: { DICER_<BODY>: '' }`;
    - `uniforms: { uBodyPreset: { value: new THREE.Vector4(...PRESET_PARAMS[a.body.preset]) } }`;
    - `chunks: { pars, colorPre, roughness?, normal?, coat? }`;
    - `params`: its MeshPhysical parameters.
  - Colours always come from `diffuseColor` (`body.color`) and `uBodyColor2` (`body.color2`), never from constants.
- `iridescent.js`:
  - `params`: `{ clearcoat: 1, clearcoatRoughness: 0.05, sheen: 0.3, sheenColor: color2 }`.
  - Shading: the colour turns from `color` towards `color2` with view angle, going the short way round the hue wheel (in HSV or a YIQ hue rotation).
  - **Chameleon:** a smooth, strong shift.
  - **Opal:** a milky base (`color`) with small spectral flashes, using cellular or high-frequency noise in die-local space and lit by view angle, so the flashes move as the die turns.
  - **Dichroic:** a dark, glossy base with a sharp flip between `color` and `color2` at a threshold angle, plus a few streaks.

- [ ] **Step 1: Write the failing tests:**
  - `today's bodies get no body patch and keep today's shader with the chunk loaded` (compare the fragment shader, defines and key, loaded vs not, for opaque, resin, each metal finish, marble and pearl);
  - `iridescent: one program for all three presets (same key), uBodyPreset differs, params set, fragment compiles the DICER_IRIDESCENT chunk once`;
  - dice-box: `an iridescent look rolled before the chunk loads draws pearl, then iridescent after it loads`.
- [ ] **Step 2: Run** `rtk proxy npx vitest run tests/unit/look-extras.test.js tests/unit/dice-box.test.js` → FAIL.
- [ ] **Step 3: Implement** `bodies/index.js`, `iridescent.js` and the merge in `patchMaterial`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Real-GPU check.**
  - Add gallery rows `iridescent~chameleon`, `iridescent~opal` and `iridescent~dichroic`, using `PRESET_COLORS` values from Task 7. Until Task 7 exists, put those colours inline in the row and Task 7 replaces them with the import.
  - Run `node tests/visual/looks.mjs`, then the stripped-shader run described in its header, and revert (`git diff build vite.config.js` empty) → zero shader errors on every tier.
  - Look at `artifacts/visual/looks-high.png`: the colour shifts across the faces of each die.
- [ ] **Step 6: Commit** `feat(extras): iridescent bodies (chameleon, opal, dichroic)`.

### Task 3: Gemstones

**Files:**
- Create: `src/render/extras/bodies/gem.js`
- Modify: `src/render/extras/bodies/index.js`, `dev/looks.js`
- Test: `tests/unit/look-extras.test.js`

**Interfaces:**
- `gemPatch(a)` follows the Task 2 module contract. `params`: `{ clearcoat: 1, clearcoatRoughness: 0.02, specularIntensity: 1, ior: 1.55 }`.
- Patterns in die-local space, so they turn with the die, and each reads as volume colour, not a printed surface:
  - **Amethyst:** banded `color` to `color2`, the bands warped, deepening towards the centre.
  - **Malachite:** concentric bands, using rings of a warped distance field, alternating `color` and `color2`.
  - **Obsidian:** near-uniform glassy `color` with a faint `color2` sheen in soft flows.
  - **Quartz:** milky `color` with cloudy `color2` veins and a higher translucency feel (a brighter rim and softer veins).

- [ ] **Step 1: Write the failing test:** `gem: one program for the four presets; each preset's uBodyPreset is distinct; params set; the DICER_GEM chunk is present once; NOISE_GLSL is included exactly once`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `gem.js` and register it in `bodies/index.js`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Real-GPU check:** add rows `gem~amethyst`, `gem~malachite`, `gem~obsidian` and `gem~quartz`. Run looks.mjs (dev and stripped, reverted) → zero errors. On the PNG each gem is recognisable.
- [ ] **Step 6: Commit** `feat(extras): gemstone bodies (amethyst, malachite, obsidian, quartz)`.

### Task 4: Wood

**Files:**
- Create: `src/render/extras/bodies/wood.js`
- Modify: `src/render/extras/bodies/index.js`, `dev/looks.js`
- Test: `tests/unit/look-extras.test.js`

**Interfaces:**
- `woodPatch(a)` follows the Task 2 module contract. `params`: `{ clearcoat: 0.5, clearcoatRoughness: 0.25 }` (a varnish).
- Grain: rings around a die-local axis tilted per preset, warped by fbm, with fine streaks along the grain and slightly rougher pores. Ring lines use `color2`. The roughness chunk adds pore roughness.
- Presets:
  - **Oak:** wide, prominent rings.
  - **Walnut:** wavy, dark.
  - **Cherry:** fine and even.
  - **Ebony:** dense, low-contrast streaks.

- [ ] **Step 1: Write the failing test:** `wood: one program for the four presets; preset params distinct; params set; roughness chunk present`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Real-GPU check:** add rows `wood~oak`, `wood~walnut`, `wood~cherry` and `wood~ebony`. Run looks.mjs (dev and stripped, reverted) → zero errors. The grain reads as wood and runs continuously across faces and edges.
- [ ] **Step 6: Commit** `feat(extras): wood bodies (oak, walnut, cherry, ebony)`.

### Task 5: Copper patina and battle-worn metal finishes

**Files:**
- Create: `src/render/extras/bodies/metal-finishes.js`
- Modify: `src/render/extras/bodies/index.js`, `dev/looks.js`
- Test: `tests/unit/look-extras.test.js`

**Interfaces:**
- `metalFinishPatch(a) -> ExtrasPatch` returns `{}` unless `a.body.type === 'metal'` and the finish is `patina` or `worn`. Otherwise it returns `defines: { DICER_PATINA: '' }` or `{ DICER_WORN: '' }`, plus chunks:
  - **Patina:**
    - **`colorPost`:** it runs after ENGRAVE_COLOR, so `dcD` and `dcMask` exist, as ANTIQUE_COLOR uses them. It writes `float dcPatina`:
      - green-blue oxidation (`color2`) in recesses: the face-edge channel `vEdgeDist`, just outside the glyph walls (`-dcD`), and in the border;
      - plus fbm blotches on the faces;
      - never on the number fill (`* ( 1.0 - dcMask )`).
    - **`roughness`:** pushes the patina towards 0.85.
    - **`replace`:** one pair that turns `metalnessFactor = mix( metalnessFactor, uFillPBR.x, dcMask );` into the same line with `metalnessFactor` first mixed towards 0 by `dcPatina`. Oxide is not metal. The `from` is written without leading whitespace, so it survives `glsl-minify`. It must apply exactly once alongside plan 1's raised and outline pairs.
  - **Worn:**
    - **`colorPost`:** thin random scratches in face UV, brighter and rougher, faded where a scratch is under a pixel wide (as BRUSHED_COLOR fades). Edges near `vEdgeDist < 0.1` and the bevels (`vFaceId < -0.5`) are worn to bright bare metal, lighter and smoother. Darker grime (`color2`) sits in the recesses, lighter than antique's.
    - **`roughness`:** scratches rougher, worn edges smoother.

- [ ] **Step 1: Write the failing tests:**
  - `patina and worn: own programs (key finish part), other metal finishes untouched`;
  - `patina's metalness pair applies exactly once, also with raised + outline numbers, and survives GLSL stripping`;
  - `metalFinishPatch is {} for a non-metal body with finish patina`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Real-GPU check:** add rows `metal~patina` (copper colours) and `metal~worn`. Run looks.mjs (dev and stripped, reverted) → zero errors. The patina sits in the recesses, and the worn edges shine.
- [ ] **Step 6: Commit** `feat(extras): copper patina and battle-worn metal finishes`.

### Task 6: Luminous (glow in the dark)

**Files:**
- Create: `src/render/extras/bodies/luminous.js`
- Modify: `src/render/extras/bodies/index.js`, `dev/looks.js`
- Test: `tests/unit/look-extras.test.js`

**Interfaces:**
- `LUMINOUS_MAX = 0.6` (the emission at luminous 1 in full darkness, in body-colour units).
- `luminousPatch(a) -> ExtrasPatch` returns `{}` when `a.body.luminous === 0`. Otherwise it returns `uniforms: { uLuminous: { value: a.body.luminous * LUMINOUS_MAX } }` and a `lighting` chunk. The `lighting` slot runs after `transmission_fragment`, after any resin refraction, where `totalDiffuse` and `totalEmissiveRadiance` exist:
  ```glsl
  float dcLumIn = dot( totalDiffuse, vec3( 0.2126, 0.7152, 0.0722 ) ) / max( dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ), 0.02 );
  totalEmissiveRadiance += diffuseColor.rgb * uLuminous * ( 1.0 - smoothstep( 0.0, 0.8, dcLumIn ) ) * ( 1.0 - dcMask );
  ```
  The glow is strongest where the die is lit least: shadowed faces, and a darkened scene when the dice lighting follows it. The numbers keep their own fill.
- Works on every body type, the new ones included. It does not depend on `flags.glow`.

- [ ] **Step 1: Write the failing tests:**
  - `luminous: lum key part, the lighting chunk lands after the resin refraction on a resin body, uLuminous = luminous x LUMINOUS_MAX`;
  - `luminous 0 adds nothing`;
  - `luminous works with flags.glow false and engraving false; safe flags: no luminous, safe key`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Real-GPU check:** add rows `opaque~luminous` (a pale green body, luminous 1) and `wood~ebony~luminous` (combined with a new body). Run looks.mjs (dev and stripped, reverted) → zero errors. The shadowed sides glow.
- [ ] **Step 6: Commit** `feat(extras): luminous (glow-in-the-dark) bodies`.

### Task 7: Appearance editor: the new bodies, presets, finishes and luminous

**Files:**
- Create: `src/look/body-colors.js`
- Modify: `src/ui/appearance-form.js`, `src/ui/appearance-editor.js` (`_prepareContext`), `templates/appearance-editor.hbs` (material section, lines ~38-62), `styles/dicer.css` (body swatches), `lang/en.json`, `dev/looks.js` (use `PRESET_COLORS`)
- Test: `tests/unit/appearance-editor.test.js`, `tests/visual/editors.mjs`

**Interfaces:**
- `body-colors.js`: `export const PRESET_COLORS = { <preset or finish id>: { color, color2, roughness } }`:

| id | color | color2 | roughness |
|---|---|---|---|
| chameleon | #1a9e8f | #6a2bd1 | 0.15 |
| opal | #e8eef0 | #7fd6e8 | 0.2 |
| dichroic | #102030 | #ff6a3d | 0.05 |
| amethyst | #7b3fb5 | #2a0f45 | 0.1 |
| malachite | #1f8a5a | #0a3a24 | 0.2 |
| obsidian | #0d0c10 | #4a3f5a | 0.05 |
| quartz | #e9e4ee | #b8b0c4 | 0.15 |
| oak | #b98a52 | #6e4a26 | 0.55 |
| walnut | #5a3a22 | #2a170c | 0.5 |
| cherry | #9c4a2c | #5a2414 | 0.45 |
| ebony | #1c1714 | #3b302a | 0.35 |
| patina | #b5653a | #3fae9a | 0.4 |
| worn | #9aa0a6 | #3a3d40 | 0.35 |

- In `appearance-form.js`:
  - `BODY_TYPES` gains `'iridescent','gem','wood'`;
  - `FINISHES` gains `'patina','worn'`;
  - `BODY_PRESET_LISTS` is a literal copy of `BODY_PRESETS`, pinned by a test, as plan 1 did, to avoid world-start export bytes;
  - the form's `body` gains `preset` and `luminous`;
  - `TWO_TONE` gains the three new types;
  - `visibleSections()` gains `preset: !!BODY_PRESET_LISTS[type]` and `luminous: true`.
- Picking a preset sets `color`, `color2` and `roughness` from `PRESET_COLORS` (`setField` on `body.preset` applies them).
  - Picking a new body type selects its first preset and applies its colours.
  - Picking the patina or worn finish applies that finish's colours.
  - The user can still change every colour afterwards.
- Editor context: `bodyPresets` (via `active(...)`, `DICER.Appearance.Preset.`) and `finishes` from the extended list. `luminousPct` is shown like roughness.
- Template:
  - the body-type chips gain three swatches;
  - a preset chip radiogroup (`data-field="body.preset"`) appears under the type when `show.preset`;
  - the finish segmented control lists five finishes;
  - a range `body.luminous` (0..1, step 0.05) appears under "Glow in the dark".
- `lang/en.json` under `DICER.Appearance`:
  - `BodyType.iridescent` "Iridescent", `BodyType.gem` "Gemstone", `BodyType.wood` "Wood";
  - `Body.Preset` "Style";
  - `Preset.chameleon` "Chameleon", `Preset.opal` "Opal", `Preset.dichroic` "Dichroic glass", `Preset.amethyst` "Amethyst", `Preset.malachite` "Malachite", `Preset.obsidian` "Obsidian", `Preset.quartz` "Quartz", `Preset.oak` "Oak", `Preset.walnut` "Walnut", `Preset.cherry` "Cherry", `Preset.ebony` "Ebony";
  - `Finish.patina` "Copper patina", `Finish.worn` "Battle-worn";
  - `Body.Luminous` "Glow in the dark".
- CSS:
  - `.dicer-ae-swatch-iridescent`: a conic gradient from `--c` to `--c2`;
  - `.dicer-ae-swatch-gem`: a faceted linear gradient;
  - `.dicer-ae-swatch-wood`: repeating ring stripes in `--c` and `--c2`.

- [ ] **Step 1: Write the failing tests** (`appearance-editor.test.js`):
  - `form round-trips every new body type, preset, finish and luminous`;
  - `picking a preset applies its PRESET_COLORS; picking a new type picks its first preset`;
  - `the form's body lists are exactly what normalisation accepts` (`BODY_PRESET_LISTS` deep-equals `BODY_PRESETS`; each type and finish survives `normalizeAppearance`);
  - `the material section renders preset chips only for types with presets, five finishes for metal, and the luminous range`;
  - extend the i18n key table: `BodyType.` has 8 ids, `Preset.` has 11, `Finish.` has 5, and every key resolves in `lang/en.json`.
- [ ] **Step 2: Run** `rtk proxy npx vitest run tests/unit/appearance-editor.test.js tests/unit/templates.test.js` → FAIL.
- [ ] **Step 3: Implement** the form helpers, context, template, CSS and strings. Switch the `dev/looks.js` rows to `PRESET_COLORS`.
- [ ] **Step 4: Run** those tests and the full suite → PASS. Then `npm run test:visual:editors` → passes.
- [ ] **Step 5: Commit** `feat(ui): iridescent, gem and wood bodies, patina and worn finishes and glow in the dark in the appearance editor`.

### Task 8: Owner look check, budgets and docs

**Files:**
- Modify: `README.md` (the Material bullet near line 105)

- [ ] **Step 1:** `rtk proxy npx vitest run` and `npm run -s lint` → all pass. Plan-2 world-start growth over the Task 1 reference must be ≤ 1,024. If it is larger, move code out of world start before going on.
- [ ] **Step 2:** `npm run test:visual` → zero shader errors on every tier. The existing rows' distinct `programKey` count is unchanged.
- [ ] **Step 3: Owner look check in Foundry:**
  - In the appearance editor, try each new body and each preset in the live preview: turn the iridescent dice, and look at the gems and woods up close.
  - Try copper patina and battle-worn on metal.
  - Try glow in the dark on a pale die and on a wood die: turn the preview so a face is in shadow.
  - Press Throw for each, then roll with a world theme that uses one.
  - The owner signs off. Rejected looks go back to Tasks 2-7.
- [ ] **Step 4:** `npm run test:live:bench -- --quick --only throttled` → no new failures beyond the known first-frame rows. Skip it only if the owner says so.
- [ ] **Step 5:** Update the README Material bullet with the new bodies, presets, finishes and glow in the dark. Commit `docs(bodies): iridescent, gem and wood bodies, patina and worn metal, glow in the dark`.
