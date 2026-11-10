# Dicer Plan 3 — DSN Compatibility Depth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Dice So Nice integration in the survey work against Dicer unchanged. That means real registration (systems, presets, colorsets, textures, roles), dice in the roller's own colours on every screen, image-face and GLB presets, the full privacy matrix with ghost dice, the rest of the message lifecycle (appended rolls, initiative, roll order, linked messages), synchronized `showForRoll`, a public `api.js`, DSN migration and chat commands.

**Architecture:** A new `src/compat/` layer holds the DSN data model as plain, three-free modules: a registry, colorset mapping, appearance resolution, privacy, sync and migration. The model feeds the existing engine through one widened seam. `DieSpec` gains per-die `appearance`, `faces` and `ghost`, and `DiceBox` builds materials per die instead of per roll. `api.js` sits at the module root as a self-contained ES module, so third parties can import it by path. The bundle never imports it and duck-types its instances.

**Tech Stack:** Plain JS ES modules, three.js 0.184 (WebGL2), Vite 6 lib build, Vitest, ESLint 9 / Prettier 3, Playwright (live tests).

**Spec:** `docs/superpowers/specs/2026-11-10-dicer-design.md`. The sections that matter here are G1 (all), G4's "DSN content" bullet, §5 "Dice geometry and numbers", §7's compatibility and privacy suites, and §8 risks 1, 2 and 5.

**Inputs from earlier plans:**
- **Survey:** `docs/research/dsn-integration-survey.md`, the ranked must-support list in §4–5.
- **Deferred findings:** `docs/superpowers/plans/2026-11-10-dicer-plan-1-notes.md`, the Task 10 and Final items.
- **Rulings:** R13, the no-op `add*` stubs, which this plan replaces.

## Global Constraints

- **No DSN code or assets copied.** DSN is AGPL-3.0, so behaviour is reimplemented from the public contract and observed behaviour only. Reading DSN's `api.js` member names and signatures is allowed. Its function bodies, `main.js`, textures, models and colorset values are never transcribed.
- **Privacy outranks looks and compatibility (G1):** "when a DSN behaviour is ambiguous, choose the one that leaks nothing."
- **`diceSoNiceRollComplete` fires exactly once per animated message:** "that includes when dice are cleared mid-roll, the tab is hidden, WebGL is lost, or rendering throws." Every new path (appended rolls, roll order, linked messages, initiative) keeps this.
- **No stub package with id `dice-so-nice`** (§8.1). Path-import integrations are a documented known gap.
- **Download size:** world start stays ≤ 4 MB at default quality, and only about 239 KiB of headroom is left. The GLTF loader and migration code load only through dynamic `import()` chunks, never at world start.
- **No GPU work while idle.** Nothing in this plan starts the render loop outside a roll.
- **Target:** Foundry v14 only. Use `ChatMessage.author` (there is no `.user`) and `isContentVisible`.
- **Tests:** unit tests live in `tests/unit/*.test.js` (node env; add a jsdom docblock when the DOM is needed). The husky pre-commit hook runs `npm run lint && npm test`.
- **Shell:** run tests with `rtk proxy npx vitest run <file>` and builds with `node node_modules/vite/bin/vite.js build` (the rtk hook breaks `npx vite`). On Windows, write multi-line scripts to files.
- **Settings (§5):** every new user-facing behaviour gets its own setting, default on. The exceptions are the ghost-dice and immediate-display settings, whose defaults are given in their tasks.
- **Defensive integration:** a malformed call from a third party logs one warning per member and returns normally (or returns a resolved Promise for async members). It never throws into the caller's hook.

## Review Focus

1. **Malformed third-party registration.** Examples: a preset whose label count doesn't match its face count, a colorset with `background: undefined`, `addSystem` called with a string, a registration during `diceSoNiceInit` before any system exists. Expected: one warning, no throw, and the die falls back to the user's look (test in Task 1).
2. **Image faces that 404, time out or are huge.** Expected: the roll still lands and reveals on time, and the failed faces fall back to engraved digits (test in Task 5).
3. **A forged or oversized socket payload.** Examples: a `users` list that excludes me, 500 dice, garbage `roll` JSON. Expected: ignored or capped at `maxDice`, never an exception, never real faces on a client that may not see them (test in Task 11).
4. **Garbage appearance data.** Examples: user flags from an old Dicer or a hand-edited DSN shape; migration run twice; DSN flags present for only some users. Expected: defaults, idempotent migration, no lost Dicer choices (tests in Tasks 4 and 14).
5. **A message deleted or updated while waiting.** The message may be queued behind `rollOrder`, waiting on `linkedTo`, or holding hidden initiative. Expected: `diceSoNiceRollComplete` still fires exactly once and nothing stays hidden (tests in Tasks 8, 9 and 10).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/compat/registry.js` (new) | The DSN data model: systems, presets, colorsets, textures, shapes, roles, damage defaults, SFX modes and triggers. It also provides the `DiceFactory` view and `exports`. Pure, with no three.js. |
| `src/compat/colors.js` (new) | CSS colour string → `#rrggbb`. |
| `src/compat/colorset-map.js` (new) | Maps a DSN colorset to a Dicer appearance, and defines the built-in colorsets. |
| `src/compat/faces.js` (new) | Turns a preset's labels into a `FaceSet` (glyph, text or image per value). |
| `src/compat/resolve-looks.js` (new) | Decides, per term, the appearance, face set and preset for a die, from the roll, the message author and the registry. |
| `src/compat/user-looks.js` (new) | Reads and writes the `dicer.appearance` user flag; mirrors the `look` setting into it. |
| `src/compat/privacy.js` (new) | The privacy matrix: `real`, `ghost` or `none` per roll per user. |
| `src/compat/sync.js` (new) | Socket broadcast and receipt for `showForRoll(synchronize)`. |
| `src/compat/initiative.js` (new) | Hides combat-tracker initiative until the roll's dice land. |
| `src/compat/migration.js` (new, lazy chunk) | DSN flags and world settings → Dicer. |
| `src/compat/chat-commands.js` (new) | The `/dice3d`, `/d3d` and `/dsn` chat commands. |
| `src/compat/dsn-orientation.js` (new, Task 6) | Per-type rotation from DSN's model convention to Dicer's face layout. |
| `src/render/face-textures.js` (new) | Loads image and text faces into a `DataArrayTexture`, cached per face set. |
| `src/render/model-loader.js` (new, lazy chunk) | Loads a GLB preset model as a die mesh. |
| `api.js` (new, module root) | `DiceSystem`, `DiceSFX` and `DiceMap`. Self-contained, with no imports. |
| `src/api/dice3d.js` | Replaces the stubs with the full `game.dice3d` surface. |
| `src/foundry/message-gate.js` | Privacy views, the PreProcess hook, roll order, linked and flagged messages, appended rolls, companion ids. |
| `src/throw/throw-planner.js` | Per-die decoration, `showExtraDice`, ghost dice. |
| `src/throw/dice-box.js` | Per-die appearance, face set and model; ghost material. |
| `src/render/dice-material.js`, `src/render/shaders/engrave.js` | Per-face texture layers in place of SDF glyphs. |
| `src/main.js`, `src/settings.js` | Wiring, new settings, chat commands, migration trigger. |
| `README.md` | Compatibility table, known gaps, integration guide. |
| `tests/live/compat.mjs` (new) | Live privacy and compatibility smoke test, run by the owner. |

---

### Task 1: The DSN registry

**Files:**
- Create: `src/compat/registry.js`, `src/compat/colors.js`
- Test: `tests/unit/registry.test.js`, `tests/unit/colors.test.js`

**Interfaces:**
- Produces:
  - `cssToHex(value: string, fallback?: string | null) -> string | null` in `colors.js`. It accepts `#rgb`, `#rrggbb`, `#rrggbbaa` (alpha dropped), `rgb()/rgba()` and the 16 CSS basic colour names plus `orange`, `purple` and `pink`. Anything else returns `fallback` (default `null`).
  - `createRegistry({ warn = console.warn }) -> Registry`, with these members:
    - `addSystem(system, mode = 'default') -> void`. `system` is `{id, name, group?}` or a duck-typed DiceSystem instance: an object with string `id` and `name` and a Map-like `dice`. The mode is one of `'default' | 'preferred' | 'exclusive'`; an unknown mode becomes `'default'`.
    - `addDicePreset(preset, shape?) -> Promise<void>`. `preset` is `{type, labels, system = 'standard', values?, colorset?, font?, fontScale?, modelFile?, bumpMaps?, emissiveMaps?, emissive?}`. A missing system is created implicitly with name = id. `shape` names the base shape when `type` is custom (for example `'dc'` shaped `'d10'`).
    - `addColorset(colorset, mode = 'default') -> Promise<void>`, keyed by `colorset.name`.
    - `addTexture(id, texture) -> Promise<void>`. `texture` is `{name, composite, source, bump?, material?}`.
    - `addDiceShape(def) -> void`. Read the call site in `../daggerheart-duality-dice/dist/index.js` (around L752) for the argument shape. Store the type → base-shape alias; anything unrecognised warns.
    - `addRole(role, {package} = {}) -> void`, `getRole(id) -> object | undefined`, `getRoles() -> object[]`.
    - `addDamageTypeDefaults(map: Record<string, string>) -> void`. It merges a damage type → colorset name map into `damageTypeDefaults`.
    - `addSFXTrigger(id, name, results) -> void`, `addSFXMode(sfxClass) -> void`, `addSFXDefaults(list) -> void`, `getSFXModes() -> Record<string, string>`. These are stored only; Plan 4 runs them.
    - `getLoadedDiceSystems() -> Map<string, SystemEntry>`.
    - `presetFor(systemId: string, type: string) -> PresetEntry | null`.
    - `baseShape(type: string) -> string | null`. It returns the Dicer shape for a die type, following `addDiceShape` and preset `shape` aliases; a built-in type maps to itself.
    - `onChange(cb: () => void) -> () => void`, which returns an unsubscribe function.
    - The fields `systems: Map<string, SystemEntry>`, `colorsets: Map<string, object>`, `textures: Map<string, object>` and `damageTypeDefaults: Record<string, string>`.
    - `diceFactory` is the DSN-compat view `{ systems, loaderGLTF, get(type) }`. Each `PresetEntry` carries `modelFile`, `modelLoaded` (boolean), `loadModel(loader) -> Promise<void>` and `loadTextures() -> Promise<void>`. Until Task 6 these two are resolved no-ops; Task 6 replaces them.
    - `exports` is `{ Utils: { prepareSystemList, prepareColorsetList, prepareTextureList, prepareFontList, contrastOf(hex) -> '#000000'|'#ffffff', sanitizeAppearance(a) }, COLORSETS }`. `COLORSETS` is a live object view over `colorsets`. The `prepare*List` functions return `{id: name}` objects grouped the way swade's settings dialog consumes them; check `../swade/...` or its usage in the survey, and when unsure return a flat `{id: name}`.
  - `SystemEntry`: `{ id, name, mode, group, dice: Map<string, PresetEntry>, instance: object | null }`.
  - `PresetEntry`: `{ type, shape, system, labels: string[], values: {min, max}, colorset, font, fontScale, modelFile, emissiveMaps, ... }`.
- **The `standard` system** exists from creation. It has no presets of its own; dice without a preset use Dicer's built-in faces.

- [ ] **Step 1: Write the failing tests** (`registry.test.js`):
  - `addDicePreset({type:'d20', labels:[...20 strings], system:'pf2e'})` creates system `pf2e`, and `presetFor('pf2e','d20').labels.length === 20`.
  - `values` defaults to `{min:1,max:faces}`.
  - `addSystem({id:'x',name:'X'},'preferred')` gives `getLoadedDiceSystems().get('x').mode === 'preferred'`.
  - `addSystem` with a DiceSystem-like instance stores it in `.instance`, and presets already in its `dice` Map are registered.
  - `addColorset({name:'fire', foreground:'#fff', background:'#f00'})` gives `exports.COLORSETS.fire.background === '#f00'`.
  - `addTexture` returns a Promise.
  - `addDamageTypeDefaults({fire:'fire'})` and then `({cold:'ice'})` merge.
  - `diceFactory.systems.get('pf2e').dice.get('d20').modelLoaded === false`.
  - `onChange` fires once per registration.
  - `exports.Utils.contrastOf('#ffffff') === '#000000'`.
  - `baseShape('d20') === 'd20'`. After `addDicePreset({type:'dc', labels:[...10], system:'x'}, 'd10')`, `baseShape('dc') === 'd10'`, and `baseShape('dz')` with no alias is `null`.
- [ ] **Step 2: Write the Review Focus 1 test:** `registry tolerates malformed input`.
  - The calls are `addSystem('pf2e')`, `addDicePreset({type:'d20', labels:[1,2]})` (label count ≠ 20), `addColorset({})`, `addTexture(undefined)` and `addDicePreset(null)`.
  - None throws. Each async call resolves.
  - `warn` is called once per member name, not once per call.
  - The short preset is stored with labels padded by `String(value)` and is usable.
- [ ] **Step 3: Write `colors.test.js`:** `cssToHex('#ABC') === '#aabbcc'`, `'rgb(255, 0, 0)'` → `'#ff0000'`, `'white'` → `'#ffffff'`, `'#11223344'` → `'#112233'`, and `'nonsense'` → `null`.
- [ ] **Step 4: Run them and confirm they fail:** `rtk proxy npx vitest run tests/unit/registry.test.js tests/unit/colors.test.js` should fail with module not found.
- [ ] **Step 5: Implement `colors.js` and `registry.js`** against the interfaces above.
- [ ] **Step 6: Run them and confirm they pass.**
- [ ] **Step 7: Commit:** `feat(compat): DSN registry and colour parsing`.

### Task 2: Colorsets as appearances

**Files:**
- Create: `src/compat/colorset-map.js`
- Test: `tests/unit/colorset-map.test.js`

**Interfaces:**
- Consumes: `cssToHex` from Task 1; `normalizeAppearance` from `src/look/appearance.js`.
- Produces:
  - `colorsetToAppearance(colorset, { textures?: Map, index = 0 } = {}) -> NormalizedAppearance`.
    - **Colour arrays:** `foreground`, `background`, `outline` and `edge` may each be a string or an array. With an array, the die at `index` takes `arr[index % arr.length]`, which is deterministic per die.
    - **Number fill:** `foreground` becomes `numbers.color`, with fill `'paint'`. When the material is `metal` or `chrome` and the foreground is yellowish (hue 35–60°, saturation > 0.4), the fill is `'gold'` instead.
    - `background` becomes `body.color`. `edge`, or else `outline`, becomes `body.color2`.
    - **Material:**

      | DSN material | Dicer appearance |
      |---|---|
      | `plastic`, `auto`, `none` or missing | `opaque`, roughness 0.35 |
      | `pristine` | `opaque`, roughness 0.1 |
      | `wood` | `opaque`, roughness 0.75 (Dicer has no wood body) |
      | `metal` | `metal`, finish `polished` |
      | `chrome` | `metal`, polished, roughness 0.05 |
      | `glass` | `resin`, interior `none` |
      | `stone` | `marble` |
      | `iridescent` | `pearl` |

    - **Texture name:** when a texture's name or id contains `marble` or `stone`, the body becomes `marble`; `metal` or `bronze` makes it `metal` with finish `antique`. Any other texture is ignored, and the ruling is recorded.
    - `glow` is set from `colorset.emissive` / `emissiveIntensity` if present.
  - `BUILTIN_COLORSETS: Record<string, Colorset>`: Dicer's own colorsets under the common names systems and players type as roll flavor.
    - The names are `white`, `black`, `red`, `blue`, `green`, `yellow`, `purple`, `orange`, `pink`, `grey`, `gold`, `silver`, `bronze`, `glass`, `fire`, `ice`, `poison`, `acid`, `lightning`, `thunder`, `force`, `radiant`, `necrotic`, `psychic`, `bludgeoning`, `piercing` and `slashing`.
    - The values are the designer's call, picked so each reads at a glance. Never copy DSN's values.
    - Plan 4 replaces the damage-type entries with full themes.
  - `GHOST_APPEARANCE: NormalizedAppearance`: resin body `#c8ccd4`, interior `none`, fill `paint` coloured the same as the body, glow 0.

- [ ] **Step 1: Write the failing tests:**
  - `{foreground:'#000', background:['#f00','#0f0'], material:'metal'}` at index 1 gives `body.type === 'metal'`, `body.color === '#00ff00'` and `numbers.color === '#000000'`.
  - `material:'glass'` gives resin with interior `none`.
  - `stone` gives marble, and `iridescent` gives pearl.
  - An unknown material gives `opaque`.
  - A gold foreground on chrome gives fill `'gold'`.
  - Every `BUILTIN_COLORSETS` entry maps to an appearance whose `normalizeAppearance` round trip is unchanged.
  - `GHOST_APPEARANCE.numbers.color === GHOST_APPEARANCE.body.color`.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run them and confirm they pass.**
- [ ] **Step 5: Commit:** `feat(compat): colorset to appearance mapping and built-in colorsets`.

### Task 3: Per-die looks in the engine

**Files:**
- Modify: `src/throw/throw-planner.js`, `src/throw/dice-box.js`
- Test: `tests/unit/throw-planner.test.js`, `tests/unit/dice-box.test.js` (extend both)

**Interfaces:**
- Consumes: `GHOST_APPEARANCE` from Task 2.
- Produces:
  - `DieSpec` becomes `{ type, value, variant?, appearance?: object, faces?: FaceSet, ghost?: boolean, model?: string }`.
  - `FaceSet` is `{ key: string, labels: FaceLabel[] }`, indexed like `getShape(type).values`.
  - `FaceLabel` is one of `{kind:'glyph', text}`, `{kind:'text', text}`, `{kind:'image', url}` or `{kind:'blank'}`.
  - `planThrow(roll, { maxDice = 20, showExtra = true, decorate } = {}) -> { dice: DieSpec[], skipped }`. `decorate(term, result, termIndex) -> Partial<DieSpec> | null` is merged into each die's spec. With `showExtra` false, results with `discarded === true` or `active === false` are not thrown. A d100's two dice both receive the decoration.
  - `DiceBox.roll(specs)` normalizes each die's own `appearance` (or else `getAppearance()`). Its material key becomes `appearanceKey|programKey|type|variant|faces.key|ghost`.
  - A `ghost` die uses `GHOST_APPEARANCE` and blank faces whatever its spec says, and throws value `1`. Its real value never reaches the scene graph.
  - The geometry uses each die's own `edges.style`.
  - Until Task 5, a `faces` entry with kind `text`, `image` or `blank` renders as its glyph fallback. For `blank`, that's no label: pass an empty label string to `createDiceMaterial`.

- [ ] **Step 1: Write the failing tests:**
  - **Planner:** `decorate` output is merged per die. The d100 tens and ones dice both get it. `showExtra:false` drops `discarded` and inactive results, and `skipped` doesn't count them.
  - **DiceBox (existing fake renderer):** two specs with different appearances build two materials. Two dice with equal appearances share one. A ghost spec built with `value: 17` throws a die whose `targetValue === 1`, and its material was built from `GHOST_APPEARANCE` with blank labels.
  - The refcount and invalidate tests still pass.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement it.**
  - Move `roll.appearance` to per-die `die.appearance` (`#rematerialize` uses each die's own).
  - `acquireWarmup` keeps using `getAppearance()`.
- [ ] **Step 4: Run the full suite** (`rtk proxy npx vitest run`) and confirm it passes.
- [ ] **Step 5: Commit:** `feat(engine): per-die appearance, face sets and ghost dice`.

### Task 4: Whose dice look like what

**Files:**
- Create: `src/compat/user-looks.js`, `src/compat/resolve-looks.js`
- Modify: `src/settings.js`, `src/main.js`
- Test: `tests/unit/user-looks.test.js`, `tests/unit/resolve-looks.test.js`

**Interfaces:**
- Consumes: the Registry (Task 1), `colorsetToAppearance` and `BUILTIN_COLORSETS` (Task 2), `LOOKS` and `DEFAULT_APPEARANCE`, and `planThrow`'s `decorate` (Task 3).
- Produces:
  - **User flag `dicer.appearance`:** `{ global: LookRef, [dieType]: LookRef }`, where `LookRef = { look?: string, appearance?: object, colorset?: string, system?: string }`.
  - `readUserLooks(user) -> Record<string, LookRef>`. It returns `{global:{look:'default'}}` when the flag is missing or malformed, and drops entries that aren't objects.
  - `lookRefToAppearance(ref, registry) -> object | null`. Precedence is `appearance` > `colorset` (registry, then built-ins) > `look` (`LOOKS[id].appearance`).
  - `mirrorLookSetting(user, lookId) -> Promise`. It sets `global = { look: lookId }` and keeps per-type entries.
  - `createLookResolver({ registry, getUser: (id) => User | undefined, warn }) -> { decorate(message|null, roll, authorId) -> (term, result, termIndex) => Partial<DieSpec> }`. The first matching rule wins, per term:
    1. `term.options.appearance` (an object). `.system` is read here too.
    2. `term.options.colorset` (a registry or built-in name).
    3. The term's `flavor`. A flavor of the form `die:Name` names a colorset; otherwise a flavor that exactly equals a colorset name (case-insensitive) is used.
    4. `term.options.dsnActorId`: that actor's `flags.dicer.appearance` `LookRef` if present (the per-actor UI is Plan 7).
    5. The author's `dicer.appearance[type]`, then `.global`.
    6. `DEFAULT_APPEARANCE`.
  - **System and preset:** the system comes from `term.options.appearance.system` or the matched `LookRef.system`, else `'standard'`.
    - When `registry.presetFor(system, type)` exists, the die gets `faces` from `facesFor(preset)` (Task 5 fills it in; until then return `undefined`) and `model: preset.modelFile`.
    - The preset's `colorset` replaces steps 5–6 only.
  - **Custom die types:** the die keeps its type as `spec.type`, and `planThrow` asks `registry.baseShape(type)` for the shape before `dieTypeForFaces` (pass `shapeFor` into `planThrow` as an option). An unknown shape is skipped, as today.
  - **Settings:** `look`'s onChange also calls `mirrorLookSetting(game.user, value)`. At `ready` the client mirrors once if the flag is missing.
  - **Wiring:** the gate and `showForRoll` pass `decorate: resolver.decorate(message, roll, authorId)` into `planThrow`.

- [ ] **Step 1: Write the failing tests:**
  - `readUserLooks` of `undefined`, `'x'` or `{global: 5}` returns the default.
  - `lookRefToAppearance({colorset:'fire'})` uses a registry colorset ahead of the built-in of the same name.
  - Resolver precedence is one test per rule, in order: a term with both `options.colorset` and a matching flavor uses the colorset; a `die:fire` flavor works; an author with `{d20:{look:'crystal'}}` gets crystal on d20s and global on d6s.
  - A preset registered for system `pf2e` attaches its `model`.
  - The two authors in one test resolve independently, which proves remote rollers keep their own colours.
- [ ] **Step 2: Write the Review Focus 4 test:** `resolver survives garbage flags`. With `flags.dicer.appearance = {global:{appearance:'nope'}, d20: null}`, the resolver returns `DEFAULT_APPEARANCE` and doesn't throw.
- [ ] **Step 3: Run them and confirm they fail.**
- [ ] **Step 4: Implement it, then wire the gate and `showForRoll`.**
  - `main.js` creates the registry and resolver before `createDice3dApi`.
  - The gate takes `decorateFor(message, roll)` as a new injected dependency (default `() => undefined`).
- [ ] **Step 5: Run the full suite and confirm it passes.**
- [ ] **Step 6: Commit:** `feat(compat): per-roller appearance resolution from terms, flavors and user flags`.

### Task 5: Image and text faces

**Files:**
- Create: `src/compat/faces.js`, `src/render/face-textures.js`
- Modify: `src/render/dice-material.js`, `src/render/shaders/engrave.js`, `src/throw/dice-box.js`, `src/compat/resolve-looks.js`
- Test: `tests/unit/faces.test.js`, `tests/unit/face-textures.test.js` (jsdom), plus a `dev/looks.html` entry for a visual check

**Interfaces:**
- Consumes: `FaceSet` (Task 3) and `PresetEntry` (Task 1).
- Produces:
  - `facesFor(preset, atlasHasGlyphs: (text) => boolean) -> FaceSet`.
    - A label ending in `.png`, `.jpg`, `.jpeg`, `.webp`, `.svg` or `.gif` (case-insensitive, query ignored) becomes `image`.
    - `''` becomes `blank`.
    - A string whose characters are all in the digit atlas becomes `glyph`.
    - Anything else becomes `text`.
    - The `key` is `system|type|` plus a hash of the label list.
  - `createFaceTextures({ loadImage = (url) => Promise<ImageBitmap|HTMLImageElement>, size = 128, timeoutMs = 4000 }) -> { acquire(faceSet) -> Promise<{ texture: THREE.DataArrayTexture | null, layers: Int16Array }>, release(faceSet) }`.
    - It builds one RGBA layer per non-glyph face. Images are drawn fitted to the square; text is drawn white on transparent in DM Serif Display, at a size that fits.
    - `layers[i]` is the layer for face `i`, or `-1` for glyph and blank faces.
    - Results are cached and refcounted by `faceSet.key`.
    - A face whose image fails or times out gets layer `-1`, so it falls back to the glyph `String(value)`, and the console warns once per URL.
  - **Material:** `createDiceMaterial(appearance, atlas, shape, labels, flags, faceTex?)`. With `faceTex`, a per-face `uFaceLayer[]` uniform selects the layer, and layer ≥ 0 samples the array instead of the MSDF.
    - An `image` layer draws as a flat colour decal at its own colour, under the clear coat. Engraving is off for that face.
    - A `text` layer is a mask tinted by `numbers.color`, as a flat inlay.
    - The ruling: rasterized faces get no recess, because SDF-derived engraving needs the MSDF. Cost: symbol dice look flatter than digit dice.
  - Add the define `DICER_FACE_LAYERS` to `programKey`'s inputs only through `customProgramCacheKey`. `appearance.programKey` stays pure; append `|fl1` in `dice-material.js`.
  - **DiceBox:** for a die whose `faces` has any non-glyph label, the roll awaits `acquire(faces)` before its first chunk is shown. The physics throw starts at once, and the visibility gate holds the dice hidden. Faces resolve with no wait at all when cached. Release happens on finish.
  - The wait is capped by `timeoutMs`. A timed-out face uses its fallback for this roll.

- [ ] **Step 1: Write the failing tests:**
  - `facesFor` classifies `['1','icons/a.webp?v=2','','+','A']` as glyph, image, blank, text, text (the digit atlas has digits only).
  - Two equal label lists give equal keys.
  - **face-textures** (fake `loadImage`, jsdom canvas stub): 3 non-glyph faces give 3 layers. Acquiring twice gives one build. Releasing both drops the cache.
- [ ] **Step 2: Write the Review Focus 2 test:** `failed and slow faces fall back`. One `loadImage` rejects and one never resolves (fake timers advanced by 4000 ms). Expected: `acquire` resolves with both layers `-1`, one warning per URL, and in a DiceBox test the roll's `landed` still resolves.
- [ ] **Step 3: Run them and confirm they fail.**
- [ ] **Step 4: Implement it.** Add a dev gallery card with a 6-face image preset (local test PNGs under `dev/assets/`, generated, not downloaded) and a Fate-style text preset (`+`, `-`, blank).
- [ ] **Step 5: Run the full suite, then the visual harness:** `npm run test:visual`. Check that the image and text faces render on the d6 card. Save a screenshot to `docs/signoff/plan-3/faces.png`.
- [ ] **Step 6: Commit:** `feat(render): image and text die faces from DSN presets`.

### Task 6: GLB model presets

**Files:**
- Create: `src/render/model-loader.js` (dynamic-import chunk), `src/compat/dsn-orientation.js`, `docs/research/dsn-model-orientation.md`
- Modify: `src/compat/registry.js` (`loadModel` and `loadTextures`), `src/throw/dice-box.js`
- Test: `tests/unit/model-loader.test.js`, `tests/unit/dsn-orientation.test.js`

**Interfaces:**
- Consumes: `spec.model` (Task 4) and `PresetEntry` (Task 1).
- Produces:
  - `loadDieModel(url) -> Promise<{ geometry: THREE.BufferGeometry, material: THREE.Material | null }>`. It uses `GLTFLoader` from `three/examples/jsm/loaders/GLTFLoader.js` and takes the first mesh. The geometry is recentred and scaled so its bounding radius matches Dicer's die of that shape. Results are cached by URL.
  - `MODEL_ROTATIONS: Record<dieType, [x, y, z, w]>`: the rotation from DSN's model axes to Dicer's face layout for each type, or `null` when unknown.
  - **`DiceBox` behaviour:**
    - For a die with `spec.model` and a known rotation, the roll uses the model mesh as the inner visual. The collider stays Dicer's shape. The inner mesh gets the model rotation premultiplied before the face-forcing rotation, and keeps the model's own material.
    - If the rotation is `null` or the load fails, the die renders as Dicer's procedural die with the preset's faces and colorset. `diceSoNiceModelLoaded` doesn't fire.
    - The model load follows the same capped-wait rule as faces in Task 5.
  - `PresetEntry.loadModel()` loads and sets `modelLoaded = true`, then fires `diceSoNiceModelLoaded(preset)` through the injected hooks.
- **Research step (designer's call):**
  - DSN's GLB dice are authored in DSN's face layout, which Dicer doesn't share. Determine that layout **by observation only**: load a DSN-compatible GLB from a locally installed dice module, render it in `dev/`, and match its face normals and the numbers visible on each face to values.
  - Record each type's rotation and the evidence in `docs/research/dsn-model-orientation.md`.
  - Any type you can't settle stays `null`.
  - Ruling for the ledger: a wrong rotation shows the wrong number up, which is a visible lie. So any type that isn't verified falls back to the procedural die.

- [ ] **Step 1: Do the research.** Search `Data/modules/*` for `modelFile` presets. Produce the doc and fill in `MODEL_ROTATIONS`.
- [ ] **Step 2: Write the failing tests:**
  - **dsn-orientation:** every non-null quaternion is unit length. For each verified type, rotating the model's recorded face normal for value v by the rotation lands on Dicer's `getShape(type)` normal for v, within 1e-3 (normals copied into the test from the research doc).
  - **model-loader** (stub `GLTFLoader` through an injected loader): it recentres and scales to the target radius, caches by URL, and rejects cleanly on a bad URL.
  - **DiceBox:** a model spec whose type has a `null` rotation renders procedurally, and the roll lands.
- [ ] **Step 3: Run them and confirm they fail.**
- [ ] **Step 4: Implement it.** `model-loader.js` is reached only through `import('./model-loader.js')`.
- [ ] **Step 5: Run the build and check the budget.**
  - Run `node node_modules/vite/bin/vite.js build`.
  - Confirm the GLTF loader is in its own chunk, and that the world-start total (the main entry plus its static imports plus the atlas) is still ≤ 4 MB.
  - Record the numbers in the commit message.
- [ ] **Step 6: Run the full suite.**
- [ ] **Step 7: Commit:** `feat(render): GLB model presets with verified DSN orientation`.

### Task 7: The privacy matrix

**Files:**
- Create: `src/compat/privacy.js`
- Modify: `src/foundry/message-gate.js`, `src/settings.js`, `lang/en.json`
- Test: `tests/unit/privacy.test.js`, `tests/unit/message-gate.test.js` (extend)

**Interfaces:**
- Produces:
  - `viewFor({ contentVisible: boolean, isGM: boolean, isAuthor: boolean, blind: boolean, whispered: boolean, rollGhost: boolean, rollSecret: boolean, showGhostDice: boolean }) -> 'real' | 'ghost' | 'none'`. Rules, first match wins:

    | Condition | View |
    |---|---|
    | `rollSecret` and not (`isGM` and `contentVisible`) | `none` |
    | `!contentVisible` and `showGhostDice` and (`whispered` or (`blind` and `isAuthor`)) | `ghost` |
    | `!contentVisible` | `none` |
    | `rollGhost` | `ghost` (for everyone, GM included; ruling: privacy-first reading of DSN's ghost flag) |
    | otherwise | `real` |

  - **New world setting `showGhostDice`** (Boolean, default **false**). Ruling: ghost dice reveal *that* a hidden roll happened, so the privacy-first default is off. Cost: tables used to DSN's ghost dice turn it on.
  - **Gate:** `isEligible` no longer rejects invisible messages outright. It computes the view per roll.
    - `none` rolls aren't thrown.
    - `ghost` rolls go through `decorate` with `{ghost: true}`.
    - A message with no real or ghost dice is not animated, and fires `diceSoNiceMessageProcessed(id, {willTrigger3DRoll:false})`.
    - A message animated only with ghost dice is not hidden from a user who can't see its content anyway. The `dsn-hide` class is still applied, and revealed on landing, so the timing matches.
  - `context.blind` (set by a RollStart listener) now forces the view to `none`, not an instant reveal of a still-animating roll. The existing "blind makes reveal immediate" behaviour is kept for the local user.
- **Ghost content:** a ghost die never carries the real value (Task 3). A ghost roll fires no result-specific hook data beyond what DSN sends. Check what `diceSoNiceRollComplete` passes: just the ids.

- [ ] **Step 1: Write the failing tests:**
  - `privacy.test.js` has one test per row, plus the cross product of `{contentVisible, isGM, isAuthor, blind, whispered, rollGhost, rollSecret, showGhostDice}` checked against the invariant "real only if contentVisible and !rollGhost and (!rollSecret or isGM)".
  - **Gate:**
    - A whisper the current user isn't in, with `showGhostDice` false: no dice, and MessageProcessed fires with false.
    - The same with it true: the dice are all ghosts, and RollComplete fires once.
    - A blind roll on the author's client: ghost or none, never real.
    - `roll.secret` on a player's client: none.
    - A two-roll message with one `roll.ghost`: one ghost group and one real group.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run the full suite.**
- [ ] **Step 5: Commit:** `feat(privacy): privacy matrix with ghost dice`.

### Task 8: Message lifecycle depth

**Files:**
- Modify: `src/foundry/message-gate.js`, `src/settings.js`, `lang/en.json`
- Test: `tests/unit/message-gate.test.js` (extend)

**Interfaces:**
- Produces:
  - **New hook, before eligibility:** `diceSoNiceMessagePreProcess(messageId, interception)`. `interception` is `{ willTrigger3DRoll: boolean }`, and a listener may set it to false to cancel the animation.
  - `diceSoNiceMessageProcessed(id, {willTrigger3DRoll:false})` now also fires for messages without rolls (a Plan 1 deferred finding).
  - `context.users` is `message.whisper` when non-empty, else `null` (a Plan 1 deferred finding).
  - **Roll order:** `rollOrder`, read from `roll.options.rollOrder` or the lowest `term.options.rollOrder`, groups a message's rolls. Groups are thrown in ascending order, each after the previous one lands; rolls without an order go in group 0. The watchdog runs `WATCHDOG_MS` per group, measured from that group's start.
  - **Message flags** (`flags['dice-so-nice']`; also read `flags.dicer`):

    | Flag | Behaviour |
    |---|---|
    | `skip` | No animation (existing behaviour). |
    | `persistent` | Ignored gracefully: the message animates normally (non-goal §3). |
    | `pendingCard` | No animation (G10 owns it, Plan 6). |
    | `interactiveThrow` | Animates normally (Plan 6). |
    | `linkedTo: <id>` | The message isn't animated itself. If `<id>` is animating, this message is hidden until `<id>` reveals, and it's added to `<id>`'s companion ids. Otherwise it shows at once. |

    `diceSoNiceRollComplete(id, companionIds)` passes the companions that were revealed with it.
  - **New world setting `immediatelyDisplayChatMessages`** (Boolean, default false). When true, messages aren't hidden, but the dice still animate and the hooks still fire.
  - **New client setting `showExtraDice`** (Boolean, default true), passed as `planThrow`'s `showExtra`. `game.dice3d.showExtraDiceByDefault()` returns it.
  - `planAll` runs once per message (a Plan 1 deferred finding): cache the plan between `isEligible` and the throw.

- [ ] **Step 1: Write the failing tests:**
  - **PreProcess cancel:** a listener sets the flag false, so no dice are thrown, the message isn't hidden, and Processed fires with false.
  - Processed fires for a roll-less message.
  - `context.users === null` for a public message.
  - **Roll order:** two rolls with orders 2 and 1 are thrown 1 then 2. The second throw starts only after the first lands. RollComplete fires once, after both.
  - **`linkedTo`:** B is linked to animating A, so B is hidden until A reveals, and A's RollComplete gets `[B.id]`. B linked to a non-animating id shows at once and fires no RollComplete.
  - `immediatelyDisplayChatMessages`: nothing is hidden, and RollComplete still fires.
  - `pendingCard`: no animation.
- [ ] **Step 2: Write the Review Focus 5 test:** `deleted while queued`. A message with two rollOrder groups is deleted while group 1 is in flight. RollComplete fires exactly once, group 2 is never thrown, and a linked B that was waiting on it is revealed.
- [ ] **Step 3: Run them and confirm they fail.**
- [ ] **Step 4: Implement it.**
- [ ] **Step 5: Run the full suite.**
- [ ] **Step 6: Commit:** `feat(gate): PreProcess hook, roll order, linked and flagged messages`.

### Task 9: Appended rolls

**Files:**
- Modify: `src/foundry/message-gate.js`, `src/main.js`, `src/api/dice3d.js`
- Test: `tests/unit/message-gate.test.js` (extend)

**Interfaces:**
- Produces:
  - `gate.onUpdate(message, changes)`, registered on `updateChatMessage`. When `changes.rolls` is present and the message has more rolls than the gate last saw for that id, only the new rolls are animated, using the same privacy, roll order and PreProcess rules.
  - The roll count is remembered per id from `onCreate` and `onUpdate` in a bounded LRU of 200 ids. On an update to an unknown id, the update's previous count is unknown, so nothing is animated. Ruling: no false animation of old rolls.
  - **While the appended dice fly:**
    - By default, the whole message is hidden.
    - If `setMessageUpdateHideSelector(selector)` has set a selector, only the elements matching it inside the message are hidden. They're found again on each render.
  - On reveal, `diceSoNiceRollComplete(id, [])` fires once per update animation.
  - `game.dice3d.setMessageUpdateHideSelector(selector: string | null) -> void`.

- [ ] **Step 1: Write the failing tests:**
  - **Create with 1 roll, then an update to 2 rolls:** only the second roll is thrown, the message is hidden until it lands, and RollComplete fires once more.
  - **With a selector `.dice-roll:last-child`:** only the matching element gets `dsn-hide`.
  - **An update with no new rolls:** nothing happens.
  - **An update to an unknown id:** nothing happens.
  - **Deleted mid-append:** RollComplete fires once and nothing stays hidden (Review Focus 5).
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run the full suite.**
- [ ] **Step 5: Commit:** `feat(gate): animate rolls appended to existing messages`.

### Task 10: Initiative stays hidden until the dice land

**Files:**
- Create: `src/compat/initiative.js`
- Modify: `src/main.js`, `styles/dicer.css`
- Test: `tests/unit/initiative.test.js` (jsdom)

**Interfaces:**
- Consumes: `gate.isAnimating(id)` and `gate.waitFor(id)`.
- Produces: `createInitiativeHider({ gate, getCombat: () => Combat | null, documentRef })`, which returns `{ onCreateMessage(message), onRenderTracker(app, html) }`.
  - **Initiative messages:** a message with `flags.core.initiativeRoll === true` that the gate is animating. Its combatants are the current combat's combatants matching `message.speaker.token`, or `.actor` when there's no token.
  - Their ids are held until `gate.waitFor(id)` resolves, then the tracker is re-rendered (`ui.combat?.render()`).
  - **The hook:** register `renderCombatTracker`. While a held combatant renders, its `.token-initiative` (and `[data-combatant-id] .initiative` for v14 markup; check the v14 template in the Foundry client source) gets the class `dicer-hide-initiative` (`visibility: hidden`).
  - A combatant is never held past `WATCHDOG_MS` plus 1000 ms.
  - **New world setting `hideInitiative`** (default true).

- [ ] **Step 1: Write the failing tests:**
  - An initiative message for token T, while animating, hides T's initiative element in a rendered tracker fragment.
  - Once `waitFor` resolves, a re-render shows it.
  - A non-initiative message leaves the tracker alone.
  - A message deleted mid-roll releases the hold (Review Focus 5).
  - A message for an actor not in combat does nothing.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run the full suite.**
- [ ] **Step 5: Commit:** `feat(compat): hide initiative until its dice land`.

### Task 11: `showForRoll`, `show`, `animateRoll` and synchronize

**Files:**
- Create: `src/compat/sync.js`
- Modify: `src/api/dice3d.js`, `src/main.js`
- Test: `tests/unit/sync.test.js`, `tests/unit/dice3d.test.js` (extend)

**Interfaces:**
- Consumes: `viewFor` (Task 7), the resolver (Task 4) and `planThrow`.
- Produces:
  - **The socket:** `createSync({ socket, currentUser: () => User, onShow: (payload) => Promise<void>, getMaxDice })`, which returns `{ broadcast(payload), dispose() }`.
    - The event is `'module.dicer'` (`module.json` already has `"socket": true`).
    - The payload is `{ v: 1, kind: 'show', roll: object /* roll.toJSON() */, userId, users: string[] | null, blind: boolean, ghost: boolean, secret: boolean, messageID: string | null, speaker: object | null }`.
  - **On receipt**, a payload is ignored when any of these holds:
    - `v !== 1` or `kind !== 'show'`;
    - `users` is non-null and excludes the current user;
    - the roll JSON fails `Roll.fromData` (try/catch).

    Otherwise the view is `viewFor` with `contentVisible = !blind || isGM` and `whispered = Boolean(users)`, so that `ghost` and `secret` apply. The dice are capped at `maxDice`.
  - **Signature:** `showForRoll(roll, user = game.user, synchronize = false, users = null, blind = false, messageID = null, speaker = null, options = {}) -> Promise<boolean>`.
    - `options` is `{ghost, secret}`, merged with `roll.ghost` and `roll.secret`.
    - It animates locally (the local view uses `contentVisible = !blind || isGM`) and resolves `true` once landed, or `false` if nothing was animated.
    - With `synchronize`, it broadcasts first.
    - If `messageID` is given, `waitFor3DAnimationByMessageID(messageID)` waits on this animation as well.
  - `animateRoll(roll, options = {}) -> Promise<boolean>`: local only, equivalent to `showForRoll(roll, game.user, false, null, false, null, null, options)`.
  - `show(data, user, synchronize, users, blind) -> Promise<boolean>`: the legacy shape `{throws: [{dice: [{type, result, resultLabel?, options?}]}]}`. It's converted to a Roll-like object `{dice: [{faces, results:[{result}], options}]}` and goes through the same path.
  - **Hook for local showForRoll:** DSN fires `diceSoNiceRollStart(messageID, context)` from showForRoll only when there's a messageID. Do the same, and fire `diceSoNiceRollComplete(messageID, [])` once after landing.

- [ ] **Step 1: Write the failing tests:**
  - `showForRoll(roll)` resolves true after `landed`.
  - A blind showForRoll on a player's client resolves false, or animates ghosts only if `showGhostDice` is on.
  - `synchronize=true` broadcasts one payload with `users` and `blind` copied.
  - A receiver in `users` animates, and one outside it doesn't.
  - Receiving `secret` on a player's client animates nothing.
  - `show(legacy)` throws 2 dice for a 2-die legacy payload.
  - `animateRoll` never broadcasts.
  - `waitFor3DAnimationByMessageID('m1')` resolves only after a showForRoll with `messageID` `'m1'` lands.
- [ ] **Step 2: Write the Review Focus 3 test:** `forged payloads are harmless`. Send in turn: `users: ['someone-else']`; 500 dice with `maxDice` 20 (at most 20 thrown); `roll: {garbage: true}`; `v: 2`; `kind: 'x'`. No exception reaches the socket handler, and no real face is drawn where the view says none.
- [ ] **Step 3: Run them and confirm they fail.**
- [ ] **Step 4: Implement it.**
- [ ] **Step 5: Run the full suite.**
- [ ] **Step 6: Commit:** `feat(api): showForRoll with synchronize, show and animateRoll`.

### Task 12: The rest of `game.dice3d`

**Files:**
- Modify: `src/api/dice3d.js`, `src/main.js`
- Test: `tests/unit/dice3d.test.js` (extend)

**Interfaces:**
- Consumes: the Registry (Task 1).
- Produces the full member list from spec G1. Every `add*` and `get*` delegates to the registry, and the stubs are deleted. The remaining members:

  | Member | Behaviour |
  |---|---|
  | `preloadPresets(withTextures = true) -> Promise<void>` | Loads the face textures and models of every preset the current user's looks reference. Never starts the render loop. |
  | `loadSaveFile(name) -> Promise<void>` | Delegates through `import('../compat/migration.js')` to `loadSaveFile(user, name)`, which Task 14 adds. Until Task 14 lands, it warns and resolves. |
  | `getScreenPosition(vec3: {x,y,z}) -> {x, y}` | CSS px, through the renderer camera and the area offset. |
  | `enableDebugMode() -> void` | Sets `game.dice3d._debug.verbose = true` and logs gate decisions. |
  | `DiceFactory` | `registry.diceFactory`. |
  | `exports` | `registry.exports`. |
  | `box` | `{}` (survey tier 3: box internals are declared unsupported). |
  | `canvas` | The renderer's canvas element (read-only). |
  | `uniforms` | A plain object that accepts any write; `moonPhase` defaults to 0. Writes are ignored by the shaders (ruling; survey tier 2 consumers only set custom glow). |
  | `config` | A live read-only view `{ enabled, maxDice, hideAfterRoll: timeBeforeHide > 0, showGhostDice, immediatelyDisplayChatMessages }` (midi-qol reads `dice3d.config`). |
  | `getRole`, `getRoles`, `addRole` | Delegate to the registry. |
  | `DiceSystem` | Getter returning `globalThis.DicerAPI?.DiceSystem ?? null` (set by Task 13). |

- **Hooks:**
  - `diceSoNiceOnMaterialReady(material, diceType, appearance)` fires once per new material built for a die whose preset belongs to a non-standard system.
  - `diceSoNiceModelLoaded` is Task 6's.
  - The `diceSoNicePendingThrow*` hooks are not fired (Plan 6).
- **The ready argument:** `diceSoNiceReady`'s argument still passes pf2e's duck-type check (`addSystem`, `addDicePreset`, `addTexture` and `addColorset` are all `in` the object).

- [ ] **Step 1: Write the failing tests:**
  - A **contract test** iterates the full G1 member list and asserts each one exists with the right arity or kind. Method `length` checks are only for members DSN code calls positionally: `showForRoll` ≥ 1, `addDicePreset` ≥ 1.
  - `config.enabled` tracks the setting.
  - `uniforms.foo = 1` doesn't throw.
  - `loadSaveFile('missing')` warns and resolves.
  - `getScreenPosition` maps the area centre to the area-rect centre.
  - `preloadPresets` calls the face and model loaders for a referenced preset and doesn't start the loop.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run the full suite.**
- [ ] **Step 5: Commit:** `feat(api): complete game.dice3d surface`.

### Task 13: `api.js` (DiceSystem, DiceSFX)

**Files:**
- Create: `api.js` (module root, plain ESM, no imports)
- Modify: `src/main.js` (expose it), `src/throw/dice-box.js` / `src/render/dice-material.js` (apply system callbacks), `vite.config.js` only if `api.js` must be listed as a static asset (it ships beside `module.json`, not in `dist/`)
- Test: `tests/unit/api-js.test.js`

**Interfaces:**
- Produces, at `modules/dicer/api.js`: `export { DiceSystem, DiceSFX, DiceMap }`.
  - **This is Dicer's own implementation of DSN's public interface.** Member names and signatures follow DSN's shipped `api.js`; the bodies are written fresh.
  - **`DiceSystem`:**
    - Static members:
      - `SETTING_SCOPE {LOCAL:0, SHARED:1}`
      - `SETTING_TYPE {BOOLEAN:'boolean', SELECT:'select', COLOR:'color', FILE:'file', RANGE:'range', STRING:'string'}`
      - `SETTING_FORMATING {SEPARATOR:'separator', HTML:'html'}`
      - `DICE_EVENT_TYPE {SPAWN:0, CLICK:1, RESULT:2, COLLIDE:3, DESPAWN:4}`
      - `generateHash(str) -> int`
    - `constructor(id, name, mode = 'default', group = null)`, with getters `id`, `name`, `dice` (a `DiceMap`), `mode`, `group` and `roleDefaults`.
    - Role methods: `setRoleDefaults(role, defaults)`, `includeRoles(...)`, `excludeRoles(...)`, `isAvailableForRole(role)`.
    - Settings: the `settings` getter, `addSettingSeparator`, `addSettingHTML`, `addSettingBoolean`, `addSettingColor`, `addSettingRange`, `addSettingFile`, `addSettingSelect`, `addSettingString`, `getSettingsByDiceType(type, scope = 'basic')`, `updateSettings(type, settings, scope)`, `loadSettings()` (reads `dicer.appearance[*].systemSettings`), `getScopedSettingValue`, `getDefaultSettings()`.
    - Events: `on(type, cb)`, `off(type, cb)`, `fire(type, event)`. An invalid type throws, as DSN's does, because callers expect it.
    - Materials: `getCacheString(appearance)`, `processMaterial(type, material, appearance)`, `beforeShaderCompile(shader, material)`, `registerProcessMaterialCallback(cb)`, `registerBeforeShaderCompileCallback(cb)`.
    - `getDiceByShapeAndValues(shape, values)`.
    - `getSettingsDialogContent` returns `''` (the config dialog is Plan 7).
  - **`DiceMap extends Map`:** `set(type, preset)` stamps `preset.system = owner.id`.
  - **`DiceSFX`:**
    - `static id`, `static specialEffectName`, `static PLAY_ONLY_ONCE_PER_MESH = false`.
    - `constructor(box, dicemesh, options)`, `static async init()`, `nameLocalized()`, `computeScale()`, `play() -> Promise<void>` (resolves at once in the base), `static async loadAsset(loader, url)`, `static getDialogContent() -> ''`.
- **Runtime glue:**
  - `main.js` does `import(foundry.utils.getRoute('modules/dicer/api.js'))` at `init` and sets `globalThis.DicerAPI` to the result. The registry duck-types instances, so a subclass imported from the same URL works without a shared class identity.
  - When a die's preset belongs to a system with an `instance`, its material key appends `instance.getCacheString(appearance)`.
  - After creation, `instance.processMaterial(type, material, appearance)` runs.
  - The material's `onBeforeCompile` chains `instance.beforeShaderCompile(shader, material)` after Dicer's own patch.
  - A throwing callback is caught. The die falls back to the plain Dicer material and warns once per system (spec §8.5).
  - `RESULT` events fire on landing with `{dice: [{type, value}], system}`, and `SPAWN` and `DESPAWN` fire per die. `CLICK` and `COLLIDE` aren't fired; Plan 4 owns collisions.

- [ ] **Step 1: Write the failing tests** (import `../../api.js` directly):
  - The constants are equal to the values listed above.
  - `on` with an invalid type throws.
  - A `fire` → `on` round trip works.
  - `addSettingColor` appears in `settings`, and a separator doesn't.
  - `DiceMap.set` stamps the system.
  - `getCacheString` differs for different appearances.
  - **Integration with a registry and fake materials:**
    - A subclass's `processMaterial` callback runs once per new material.
    - A throwing callback gives a fallback material and one warning.
    - The material cache key includes the cache string.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Check the shipped files.** Run the full suite and the build, then confirm `api.js` is in the package root list. Check `package.json` `files` or the release script, if one exists; if not, note in the commit that `api.js` must ship beside `module.json`.
- [ ] **Step 5: Commit:** `feat(api): public api.js with DiceSystem and DiceSFX`.

### Task 14: Migration from DSN

**Files:**
- Create: `src/compat/migration.js` (reached only through `import()`)
- Modify: `src/main.js`, `src/settings.js`
- Test: `tests/unit/migration.test.js`

**Interfaces:**
- Consumes: `colorsetToAppearance` (Task 2), `cssToHex`, and the `LookRef` shape (Task 4).
- Produces:
  - `dsnAppearanceToLooks(dsnAppearance) -> Record<string, LookRef>`.
    - DSN's per-scope entries are `{global|dN: {labelColor, diceColor, outlineColor, edgeColor, texture, material, font, colorset, system}}`.
    - Each entry becomes a `LookRef`. With a named `colorset` (other than `'custom'`) it's `{colorset, system}`. Otherwise it's `{appearance: colorsetToAppearance({foreground: labelColor, background: diceColor, outline: outlineColor, edge: edgeColor, material, texture}), system}`.
  - `migrateUser(user) -> Promise<boolean>`.
    - It reads the raw `user._source.flags?.['dice-so-nice']?.appearance` and writes `dicer.appearance`, only where Dicer has no entry for that scope yet. Dicer choices always win.
    - It sets the user flag `dicer.migratedFromDsn = 1`.
    - It returns true if anything was written. When the flag is already set, it doesn't touch anything.
  - `migrateWorld(worldSettings: { get(key) }) -> Promise<Record<string, unknown>>`. Run by the GM only, it maps DSN world settings, read from the world settings storage by `dice-so-nice.<key>`:

    | DSN setting | Dicer setting |
    |---|---|
    | `maxDiceNumber` | `maxDice` |
    | `immediatelyDisplayChatMessages` | `immediatelyDisplayChatMessages` |
    | `showGhostDice` | `showGhostDice` |
    | `hideNpcRolls` | (nothing yet: logged as unmapped) |
    | `diceCanBeFlipped` | (nothing yet: logged as unmapped) |

    It sets the world setting `dsnWorldMigrated = 1` and returns what was mapped.
  - **Wiring:** at `ready`, if the user flag or (for the GM) the world flag is unset and DSN data exists, `main.js` dynamically imports `migration.js` and runs it. Then it shows one info notification, `DICER.Notice.Migrated`. Migration failures are caught and warned, never fatal.
  - **New world setting `migrateFromDsn`** (default true), to turn it off.
  - `loadSaveFile(user, name) -> Promise<boolean>` backs `game.dice3d.loadSaveFile` (Task 12).
    - It reads the DSN save profile `user._source.flags['dice-so-nice'].saves[name]`; the raw source is read because the DSN scope isn't active.
    - It maps the profile's appearance through `dsnAppearanceToLooks` and overwrites `dicer.appearance` with it, since loading a save is an explicit choice.
    - A missing profile warns and returns false.

- [ ] **Step 1: Write the failing tests:**
  - A DSN global and d20 entry with `colorset:'fire'` gives `{global:{colorset:'fire'}}`.
  - A custom entry gives an appearance with `body.color` equal to `diceColor` in hex.
  - `migrateUser` writes the flags and sets the migrated flag.
- [ ] **Step 2: Write the Review Focus 4 tests:**
  - **Idempotent:** a second `migrateUser` writes nothing.
  - **Existing choices kept:** a user with a Dicer `global` gets only the missing `d20` entry.
  - **No DSN flags:** the user isn't migrated and no flag is set, so a later DSN install isn't hidden.
  - **Garbage DSN appearance:** an input like `{global:'x', d6:{diceColor:42}}` gives defaults or skips, and doesn't throw.
  - `migrateWorld` with only `maxDiceNumber: 40` sets `maxDice` 40, and running it again does nothing.
- [ ] **Step 3: Run them and confirm they fail.**
- [ ] **Step 4: Implement it.**
- [ ] **Step 5: Run the full suite and the build.** Confirm `migration.js` is in its own chunk.
- [ ] **Step 6: Commit:** `feat(compat): migrate DSN appearances and world settings`.

### Task 15: Chat commands, compatibility docs, live compatibility test

**Files:**
- Create: `src/compat/chat-commands.js`, `tests/live/compat.mjs`
- Modify: `src/main.js`, `README.md`, `lang/en.json`, `package.json` (add a `test:live:compat` script)
- Test: `tests/unit/chat-commands.test.js`

**Interfaces:**
- Produces:
  - `registerChatCommands(chatCommands, { openSettings: () => void })`. It registers `/dice3d`, `/d3d` and `/dsn`, each with module `dicer` and a callback that calls `openSettings()` and returns `{}` so no chat message is posted.
    - **Wiring:** `main.js` hooks `chatCommandsReady` and checks for `register` on the API.
    - `openSettings` opens Foundry's settings config on the Dicer tab. Ruling: Dicer's own dialog is Plan 7. Cost: the command opens the generic settings until then.
  - **README additions:**
    - A **compatibility table**: one row per surveyed package (from the survey §3), with the status Works / Works with gaps / Not supported and a one-line note.
    - **Known gaps:**
      - path imports of `/modules/dice-so-nice/api.js` and DSN's bundled three.js;
      - `game.modules.get('dice-so-nice')` checks (for example CoC7's version gates);
      - DSN-scoped user flags and settings read directly by integrations;
      - `box`, `pipeline`, `persistent` and `pendingThrows` internals;
      - GLB types without a verified orientation.
    - **Integration guide:** about five lines showing `game.modules.get('dicer')?.active` alongside DSN, and importing `modules/dicer/api.js`.
  - **`tests/live/compat.mjs`:** follows `tests/live/smoke.mjs` (same env vars, plus `DICER_PLAYER_USER` and `DICER_PLAYER_PASSWORD` for a second browser context). It needs a running world with DSN disabled and pf2e or dnd5e. With the GM and player logged in, it checks:
    1. A public roll animates on both clients, and RollComplete fires on both.
    2. A GM whisper roll: the player gets no `[data-message-id]` reveal and no dice frames while `showGhostDice` is false (the scene canvas stays hidden); the GM sees dice.
    3. A blind player roll: the player's canvas shows ghost dice or none, never real ones. Check the material through `game.dice3d._debug` (add `_debug.lastRollViews`).
    4. `showForRoll(roll, game.user, true)` from the GM animates on the player's client.
    5. An initiative roll hides the tracker value until reveal.

- [ ] **Step 1: Write the failing unit test:** with a fake `chatCommands.register`, three commands are registered, and the callback calls `openSettings` and returns `{}`.
- [ ] **Step 2: Run it and confirm it fails.**
- [ ] **Step 3: Implement the commands, README and live test.** The live test must exit non-zero with a clear message when the env vars are missing or Foundry is unreachable.
- [ ] **Step 4: Run the full suite, lint and build.** Confirm `node tests/live/compat.mjs` with no env vars prints the missing-env message and exits 1. As in Plan 1 Task 11, running the live test against Foundry is deferred to the owner.
- [ ] **Step 5: Commit:** `feat(compat): chat commands, compatibility table, live compat test`.

---

## Self-review notes (writer)

- **Spec coverage, G1, by task:**
  - Registration: Tasks 1 and 12.
  - SFX registration: Task 1 (stored; Plan 4 runs it).
  - Loading: Task 12.
  - Message handling and the hide selector: Tasks 8 and 9.
  - Showing dice: Task 11.
  - Utilities: Tasks 8 and 12.
  - Fields: Task 12.
  - Hooks: Tasks 6, 7, 8, 11 and 12. The PendingThrow hooks are deferred, as the spec allows.
  - Chat behaviour: Tasks 7–10.
  - Per-roll controls: Tasks 3, 4, 7 and 8.
  - Privacy: Task 7, plus the Task 11 socket rules.
  - `api.js`: Task 13.
  - Chat commands: Task 15.
  - Mutual exclusion: already shipped in Plan 1.
  - Migration: Task 14.
  - **G4 DSN content** (image faces, GLB): Tasks 5 and 6.
- **Deferred to other plans, by spec:**
  - running SFX: Plan 4;
  - the damage-theme visuals: Plan 4. Task 2 ships names only;
  - per-actor UI, the config dialog and the GM push: Plan 7;
  - pending and interactive throws: Plan 6.
- **Plan 1 deferred findings closed here:**
  - `context.users` null: Task 8.
  - Processed for roll-less messages: Task 8.
  - `planAll` run twice: Task 8.
