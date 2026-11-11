# Dicer Plan 5 — Themes and Roll Areas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One click changes how a player's dice look, sound and celebrate (themes: a library of 22, a browser with live 3D thumbnails, custom and world themes, assignment by user, die type, roll role, actor and damage type), and the GM decides where each player's dice land on every screen (roll areas: presets, a drag-and-resize editor that can't lose the area, per-player areas, a GM-only corner for private rolls, and an API).

**Architecture:**

- **Themes are look references.** A theme id rides in the existing `dicer.appearance` LookRef (`{theme: id}`), so every client already reads the roller's choice. The look resolver turns it into an appearance (per die type when the theme has one), a sound material and a theme id; the fx resolver uses the theme id to swap in the theme's own celebration rules. Built-in themes are a compact table in the main bundle (needed synchronously at plan time); the browser, editor and thumbnail renderer are lazy chunks.
- **Roll areas are sub-rectangles of one stage.** The canvas and camera keep covering the usable window (window minus sidebar), so nothing about rendering changes. Each throw gets its own area: physics walls and the spawn edge are built around that rectangle, and Playback checks "inside" against it. So two players' dice can fly at once in different places.
- **Areas are fractions, resolved per screen.** Stored as fractions of the usable region, resolved to clamped pixel rectangles on each client, then converted to die units relative to the stage.

**Tech Stack:** Plain JS ES modules, three.js 0.184 (WebGL2), Rapier3D deterministic (worker), Foundry v14 ApplicationV2 (`HandlebarsApplicationMixin`), Vite 6 lib build, Vitest, ESLint 9 / Prettier 3, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-10-dicer-design.md` — G5 (themes), G6 (roll area), with G1's privacy rule, G2's size and idle rules, §5 "Settings".

**Inputs from earlier plans:** `docs/superpowers/plans/2026-11-11-dicer-plan-4-notes.md` (rule engine and damage themes; theme appearances should be deep-frozen — Plan 4 deferred minor), `docs/superpowers/plans/2026-11-10-dicer-plan-2-notes.md` P2-R8 (LOOKS appearances are theme building blocks).

## Design calls made in this plan (owner can overturn)

- **P5-D1 A player's area follows the roller, on every screen.** G6 says the GM gives each player an area "so each player's dice land in a predictable place on every screen". So the area of a throw is the roller's area, resolved on each viewer's screen; ghost dice land there too (the roller is already public in chat). Cost if wrong: switch the lookup key from roller to viewer in one resolver.
- **P5-D2 The client override is a scale, not a second area.** "Each client can still override how big the whole area appears on their own screen" becomes a client setting `areaScale` (0.5–1.5) that scales every area around its centre on that screen only. Cost if wrong: add a per-client area on top; the resolver already takes a scale.
- **P5-D3 Only the GM edits areas.** Players get the scale and a "show my area" preview. Cost if wrong: let players write a client override area through the same editor.
- **P5-D4 A theme's celebration replaces the world rule with the same id, for that roller's dice only.** The rule engine is additive, so a theme adding its own nat-20 rule would celebrate twice. A theme rule whose id equals a world rule id (`dicer.nat20`, `dicer.nat1`) replaces it for dice resolved to that theme; other theme rules add. Cost if wrong: themes could only add effects.
- **P5-D5 Thumbnails use their own small offscreen renderer.** One 256×256 `WebGLRenderer`, created when the browser opens and disposed when it closes, renders one theme at a time. This never touches the live dice canvas (hidden when idle, sized to the stage) or its loop. Cost if wrong: a second WebGL context while the browser is open; the alternative (render targets on the live renderer) needs tone-mapping and environment juggling.
- **P5-D6 Thumbnails are cached in memory for the session**, keyed by theme appearance key and size, as object URLs. Cost if wrong: re-rendering the gallery after a reload (about 22 × ~30 ms, one at a time, idle-paced).
- **P5-D7 The GM private corner is opt-in** (world setting off by default), since moving the GM's own private rolls is a preference, not a fix. Cost if wrong: flip a default.

## Global Constraints

- **Privacy (G1):** a viewer whose view is `ghost` or `none` never resolves a real look, theme, theme rules or damage type (looks and fx come only from the real-view decorator; Plans 3–4). Roll areas reveal nothing beyond who rolled. The GM private corner applies only on a GM's own client to rolls only GMs can see.
- **No GPU work while idle (G2):** the thumbnail renderer exists only while the browser is open; area changes never start the render loop.
- **Window resize (G2):** no renderer rebuild; areas re-resolve from fractions. A resize mid-throw does not move in-flight dice (physics already uses a fresh world per throw).
- **Download size:** world start stays ≤ 4 MiB (P3-R7). Headroom is about 111 KiB. The built-in theme table must stay under 6 KiB minified in `dicer.js`; the theme browser, theme editor, thumbnailer and area editor are lazy chunks listed in `tests/unit/build.test.js` and prefetched by `preloadEditors`.
- **Area safety (G6, DSN #548):** an area can never be smaller than `MIN_AREA_PX = {width: 240, height: 180}` on screen (or the whole usable region when that is smaller), never extends outside the usable region, and Reset always restores the default preset.
- **Settings (§5):** every feature has its own setting; defaults given per task.
- **Defensive integration:** malformed stored themes, areas or imported files warn once and fall back (default theme / default area); unreadable stored entries are kept, never silently deleted on save (Plan 4 precedent).
- **Target:** Foundry v14. File export/import with `foundry.utils.saveDataToFile` and `foundry.utils.readTextFromFile`.
- **Tests:** `tests/unit/*.test.js` (jsdom docblock when the DOM is needed). Husky pre-commit runs lint + tests. `rtk proxy npx vitest run <file>`; build `node node_modules/vite/bin/vite.js build`. Windows: write multi-line scripts to files.

## Review Focus

1. **Areas after a window or sidebar change.** A window shrunk to 800×600, the sidebar collapsed or expanded, a stored area that was dragged to the far corner on a 4K screen and now opened on a laptop. Expected: still on screen, at least the minimum size, same relative place (test in Task 1).
2. **Two players rolling at once in different areas.** Expected: each throw's dice stay inside their own area, neither throw distorts the other, both land and reveal (test in Task 2).
3. **A theme that references something missing.** A user theme deleted while assigned, a world theme id on an actor after the GM removed it, an imported file from a newer version with unknown fields, a theme naming an unknown effect. Expected: falls back to the default look with one warning; the roll still lands (tests in Tasks 6 and 7).
4. **A hidden roll by a themed player.** Blind/whispered/secret roll by a player whose theme has a custom celebration. Expected: no theme look, no theme celebration, no theme sound on any client whose view is not `real`; ghost dice look neutral and land in the roller's area (test in Tasks 3 and 8).
5. **The browser opened on a weak machine or with WebGL failing.** Expected: thumbnails render one at a time without blocking the UI; if the offscreen context cannot be created, cards show the theme's colour swatch instead and the browser still works (test in Task 9).

---

## File Structure

| File                                                                                                 | Responsibility                                                                              |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `src/areas/area-model.js` (new)                                                                      | Area definitions, presets, fraction → clamped pixel rect, pixel rect → die-unit area. Pure. |
| `src/areas/area-resolver.js` (new)                                                                   | Which area a throw uses (roller, GM private corner, client scale).                          |
| `src/physics/sim.js`, `protocol.js`, `physics.worker.js`, `physics-client.js`                        | Per-throw area (centre + half extents).                                                     |
| `src/throw/playback.js`, `src/throw/dice-box.js`                                                     | Per-roll area.                                                                              |
| `src/foundry/area.js`, `src/foundry/message-gate.js`, `src/api/dice3d.js`, `src/main.js`             | Usable region, per-roll area wiring, roll-area API.                                         |
| `src/ui/area-editor.js` (new, lazy)                                                                  | Drag/resize overlay editor.                                                                 |
| `src/themes/themes.js` (new)                                                                         | Theme shape, normalization, built-in library, lookup.                                       |
| `src/compat/user-looks.js`, `src/compat/resolve-looks.js`                                            | `{theme}` refs, role slots, theme id on specs.                                              |
| `src/effects/fx-resolver.js`, `src/effects/damage-themes.js`                                         | Theme rules; theme ids as damage-map values.                                                |
| `src/themes/thumbnailer.js` (new, lazy)                                                              | Offscreen thumbnail renderer and cache.                                                     |
| `src/ui/theme-browser.js`, `src/ui/theme-form.js` (new; browser lazy), `templates/theme-browser.hbs` | Gallery, assignment, custom/world themes, export/import.                                    |
| `src/settings.js`, `lang/en.json`, `styles/dicer.css`                                                | Settings, menus, strings, styles.                                                           |

---

### Task 1: Area model

**Files:**

- Create: `src/areas/area-model.js`
- Modify: `src/foundry/area.js` (export `measureUsable`)
- Test: `tests/unit/area-model.test.js`, `tests/unit/area.test.js`

**Interfaces:**

- Produces:
  - `AreaDef = {preset: 'full' | 'centre' | 'bottom' | 'corner' | 'custom', x?: number, y?: number, w?: number, h?: number}` — fractions of the usable region, used only for `custom`.
  - `PRESETS`: frozen map preset → `{x, y, w, h}`: `full {0, 0, 1, 1}`, `centre {0.2, 0.15, 0.6, 0.7}`, `bottom {0, 0.62, 1, 0.38}`, `corner {0.62, 0.55, 0.38, 0.45}`.
  - `MIN_AREA_PX = {width: 240, height: 180}`.
  - `normalizeAreaDef(raw) -> AreaDef`: unknown/malformed → `{preset: 'full'}`; custom fractions clamped to [0, 1] with `w`, `h` ≥ 0.05 and `x + w ≤ 1`, `y + h ≤ 1`.
  - `measureUsable({doc, win}) -> {left, top, width, height}` in `src/foundry/area.js`: today's `measureArea` result (window minus sidebar); `measureArea` stays as an alias.
  - `resolveArea(def, usable, {scale = 1} = {}) -> {left, top, width, height}` (px): fractions → rect inside `usable`; scaled around its centre by `scale` (clamped 0.5–1.5); grown to `MIN_AREA_PX` (capped at `usable`'s size) around its centre; then shifted fully inside `usable`.
  - `toDieArea(rect, stage, diePx) -> {cx, cz, halfWidth, halfDepth}`: die units relative to the stage centre (`x` right, `z` down the screen, matching the camera with `up = (0,0,-1)`).
- [ ] **Step 1: Failing tests:** each preset on a 1920×1080 usable region gives the expected rect; a custom def dragged to `{x: 0.95, y: 0.95, w: 0.3, h: 0.3}` normalizes inside; Review Focus 1 — a custom area that fits a 4K region resolved on an 800×600 region is on screen and ≥ 240×180; `scale 1.5` on `full` stays inside; `scale 0.1` clamps to 0.5; a region smaller than the minimum gives the whole region; `toDieArea` of the full stage is `{cx: 0, cz: 0, halfWidth: stage.width/2/diePx, halfDepth: stage.height/2/diePx}`, and a bottom-right corner rect has positive `cx` and `cz`; garbage defs → full.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(areas): area model with presets and safe resolution`.

---

### Task 2: Per-throw areas in physics, playback and the dice box

**Files:**

- Modify: `src/physics/sim.js`, `src/physics/protocol.js`, `src/physics/physics.worker.js`, `src/physics/physics-client.js`, `src/throw/playback.js`, `src/throw/dice-box.js`
- Test: `tests/unit/sim.test.js`, `tests/unit/physics-client.test.js`, `tests/unit/playback.test.js`, `tests/unit/dice-box.test.js`

**Interfaces:**

- Consumes: `toDieArea` (Task 1).
- Produces:
  - `sim.throw({dice, seed, area?}, onChunk)`: `area = {cx, cz, halfWidth, halfDepth}`; walls, spawn edge and aim (inner 60%) are built around `(cx, cz)`; without `area` the sim uses its resized stage area centred at 0 (today's behaviour, determinism unchanged for the default). The floor stays shared.
  - `MSG.THROW` carries `area`; `PhysicsClient.throw({dice, seed, area})`.
  - `new Playback({dice, area, speed})` where `area` may carry `cx, cz`: "inside" checks use the offset rectangle.
  - `DiceBox.roll(specs, {area} = {})`: `area` is a pixel rect (`{left, top, width, height}`) or absent (the stage). DiceBox converts it with `toDieArea(rect, stageRect, DIE_SIZE_PX × diceScale)`, clamped inside the stage. The camera and canvas stay fitted to the stage.
- [ ] **Step 1: Failing tests:** `sim.test` "dice settle inside an offset area": a throw with `{cx: 6, cz: 3, halfWidth: 4, halfDepth: 3}` settles every die within that rectangle (plus die radius); "same seed + same area → identical frames"; "no area → identical to before" (compare against a recorded default-throw frame hash from the current code); `physics-client.test` passes `area` through; `playback.test` "inside" uses the offset; `dice-box.test` Review Focus 2 — two rolls started together with different areas: each roll's request carries its own area, both land, `fitArea` is called only by `onResize` (never by `roll`).
- [ ] **Step 2–4:** run, implement, pass; full suite.
- [ ] **Step 5: Commit** `feat(areas): per-throw areas in physics and the dice box`.

---

### Task 3: Area settings and which area a throw uses

**Files:**

- Create: `src/areas/area-resolver.js`
- Modify: `src/foundry/message-gate.js`, `src/api/dice3d.js`, `src/main.js`, `src/settings.js`, `lang/en.json`
- Test: `tests/unit/area-resolver.test.js`, `tests/unit/message-gate.test.js`, `tests/unit/dice3d.test.js`, `tests/unit/settings.test.js`

**Interfaces:**

- Consumes: Tasks 1–2.
- Produces:
  - Settings:

    | Key               | Scope  | Type                              | Default                                  |
    | ----------------- | ------ | --------------------------------- | ---------------------------------------- |
    | `rollAreas`       | world  | Object, `config: false`           | `{default: {preset: 'full'}, users: {}}` |
    | `areaScale`       | client | Number (range 0.5–1.5, step 0.05) | 1                                        |
    | `gmPrivateCorner` | world  | Boolean                           | false                                    |
    | `gmPrivateArea`   | world  | Object, `config: false`           | `{preset: 'corner'}`                     |
    | `perPlayerAreas`  | world  | Boolean                           | true                                     |

  - `createAreaResolver({getSetting, measureUsable, currentUser}) -> {rectFor({rollerId, gmPrivate}) -> {left, top, width, height} | null, stage() -> rect}`: `gmPrivate && currentUser().isGM && gmPrivateCorner` → `gmPrivateArea`; else (`perPlayerAreas` on) `rollAreas.users[rollerId]` when present; else `rollAreas.default`. Resolved with `resolveArea(def, stage, {scale: areaScale})`. Returns `null` when the result is the whole stage at scale 1 (so DiceBox throws as before).
  - Gate (`planAll`/`throwGroups`): passes `{area: resolver.rectFor({rollerId: message.author.id, gmPrivate})}` to `diceBox.roll`, where `gmPrivate` = this client's view is `real` and only GMs can see the message (`message.blind`, or every whisper recipient is a GM).
  - `throwHere` (showForRoll): roller = the verified sender id (P4-R8); `gmPrivate` from `s.blind` or `s.users` all GMs.
  - Ghost throws use the same roller area (P5-D1).
- [ ] **Step 1: Failing tests:** resolver: default; per-user wins; `perPlayerAreas` off ignores users; GM private corner only for GM clients and only when the setting is on; `areaScale` applied; malformed stored settings → default with one warning. Gate: a player's roll is thrown with that player's area on every viewer (two viewer stubs); Review Focus 4 — a themed player's blind roll seen by another player as ghost lands in the roller's area and carries no look/fx; a GM's blind roll on the GM client uses the private corner when on, and a player's client never does. dice3d: showForRoll uses the sender's area.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(areas): per-player areas and the GM private corner`.

---

### Task 4: The roll-area API

**Files:**

- Modify: `src/api/dice3d.js`, `src/main.js`
- Test: `tests/unit/dice3d.test.js`

**Interfaces:**

- Produces `game.dice3d.rollAreas` (enumerable; Dicer's own API — DSN has none, DSN #287):
  - `presets -> string[]` (`['full', 'centre', 'bottom', 'corner']`).
  - `get(userId = null) -> AreaDef` (copy): the user's area, or the default for `null`.
  - `rect(userId = null) -> {left, top, width, height}`: resolved on this screen.
  - `set(userId, def) -> Promise<boolean>`: GM only (else resolves `false` with one warning); `userId` `null` sets the default; `def` normalized; `set(userId, null)` removes a user's area.
  - `setGmPrivateArea(def) -> Promise<boolean>`: GM only.
  - Hook `dicerRollAreasChanged(areas)` fires on every client when `rollAreas` or `gmPrivateArea` changes (setting `onChange`).
- [ ] **Step 1: Failing tests:** get/rect/set round trip; a player's `set` resolves false and writes nothing; a malformed def is normalized; the hook fires once per change; `get` returns a copy (mutating it changes nothing).
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(api): roll-area API`.

---

### Task 5: The roll-area editor

**Files:**

- Create: `src/ui/area-editor.js` (lazy chunk), `styles/dicer.css` additions
- Modify: `src/settings.js` (menu `rollAreaEditor` via `registerEditorMenu`), `src/main.js` (`preloadEditors` list), `lang/en.json`, `tests/unit/build.test.js`
- Test: `tests/unit/area-editor.test.js` (jsdom)

**Interfaces:**

- Consumes: Tasks 1, 3, 4.
- Produces:
  - `openAreaEditor()`: a full-screen overlay (plain DOM above the board, below Foundry's own windows' z-index) showing the usable region and a draggable, resizable rectangle with 8 handles, the target selector (Default, each player, GM private corner), preset buttons, **Reset** (target back to `full`, or `corner` for the GM corner), Save, Cancel and Esc to cancel. Players open it read-only ("show my area").
  - Dragging and resizing work in fractions; every move is passed through `normalizeAreaDef` and shown resolved with `resolveArea`, so the rectangle can't go off-screen or below `MIN_AREA_PX`.
  - The overlay follows window resizes while open.
  - Pure helpers exported for tests: `dragTo(def, dx, dy, usable) -> AreaDef`, `resizeTo(def, handle, dx, dy, usable) -> AreaDef`.
  - Save writes through `game.dice3d.rollAreas.set` / `setGmPrivateArea`.
- [ ] **Step 1: Failing tests:** dragging past every edge stays inside; resizing below the minimum stops at it; Reset gives the preset; a player's Save is not offered and the save handler refuses; Esc restores the stored value; an unreadable stored user area is kept unless that user's area was edited.
- [ ] **Step 2–4:** run, implement, pass; build; lazy list.
- [ ] **Step 5: Commit** `feat(ui): roll-area editor`.

---

### Task 6: Themes and the built-in library

**Files:**

- Create: `src/themes/themes.js`
- Test: `tests/unit/themes.test.js`

**Interfaces:**

- Produces:
  - `Theme = {id, name, appearance, perType: {[dieType]: appearance}, soundMaterial: 'plastic'|'metal'|'wood'|'glass'|'stone'|null, rules: Rule[], source: 'builtin'|'world'|'user'}`. `rules` are normalized with source `'theme'` (P5-D4); `perType` keys are standard die types.
  - `normalizeTheme(raw, source, warn) -> Theme | null`: null (one warning) for no id/name/appearance; unknown fields dropped; appearances normalized and deep-frozen; invalid rules dropped individually (warned); `soundMaterial` validated.
  - `BUILTIN_THEMES`: 22 frozen themes. Sixteen are built from the existing `LOOKS` (same id and name, appearance by reference, each with a fitting `soundMaterial` and, for the dramatic ones, a celebration rule replacing `dicer.nat20`). Six are new, each with per-type appearances or custom celebrations that show off the bundle idea: `dragon-hoard` (gold metal d20, gold-flecked resin others; `embers` + `fanfare`), `stormcaller` (electric nebula; `lightning` + `zap`), `blood-moon` (dark red liquid core; `smoke` red), `celestial` (pearl and starlit glitter; `sparkles` + `chime`), `obsidian` (black glass, sharp edges; `shatter` on nat 1), `verdant` (jade marble with wood sound). Visual tuning is the builder's call, reviewed on the dev page.
  - Theme ids: built-in ids are plain; world themes `world.<slug>`; user themes `user.<userId>.<slug>`.
  - `findTheme(id, {worldThemes, userThemes}) -> Theme | null`: built-in, else world list, else that user's list (from the roller's flag).
  - Minified size of this module ≤ 6 KiB (asserted by `build.test.js` measuring the theme table in `dicer.js` via a unique marker string).
- [ ] **Step 1: Failing tests:** ≥ 20 themes, unique ids, every appearance normalizes to itself, every rule normalizes; per-type themes give different appearances for d20 and d6; `normalizeTheme` rejections each warn once; Review Focus 3 — an imported theme with unknown fields and an unknown effect id loads with the rule dropped and one warning; `findTheme` for a missing user theme → null.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(themes): theme model and the built-in library`.

---

### Task 7: Themes in the look chain

**Files:**

- Modify: `src/compat/user-looks.js`, `src/compat/resolve-looks.js`, `src/effects/damage-themes.js`, `src/main.js`, `src/settings.js`
- Test: `tests/unit/user-looks.test.js`, `tests/unit/resolve-looks.test.js`, `tests/unit/damage-themes.test.js`

**Interfaces:**

- Consumes: Task 6; `roleOf(message)` from `src/effects/roll-context.js`.
- Produces:
  - `LookRef` gains `theme?: string`; precedence within a ref: `appearance > colorset > theme > look`.
  - `lookRefToAppearance(ref, registry, index, {dieType, themes}) -> {appearance, themeId?, soundMaterial?} | null` (was appearance-only; callers updated): a theme ref gives `theme.perType[dieType] ?? theme.appearance`, its `soundMaterial`, and `themeId`.
  - Roller ref order in the resolver: `role:<role>` (when `roleOf(message)` is known) → `[type]` → `[baseShape]` → `global`. Actor flag refs may also name a theme.
  - Resolver output adds `themeId` (and `soundMaterial` from the theme when no damage theme set one).
  - Damage map values (`damageTypeMap`, `damageThemeOverrides`) may name a theme id: `resolveDamageTheme` returns `{appearance, soundMaterial, landing: null, themeId}` for it (after damage-theme ids, before colorsets).
  - `themes` lookups use world setting `worldThemes` (Array, `config: false`, `[]`) and the roller's user flag `dicer.themes` (Array).
  - The client `look` setting becomes `theme` (String, client, default `'default'`, choices from `BUILTIN_THEMES`); the old `look` value migrates once (same ids) and keeps mirroring into `dicer.appearance.global = {theme}`.
- [ ] **Step 1: Failing tests:** a global theme ref resolves per type; a role ref (`role:attack`) beats a type ref on an attack roll and is ignored on a damage roll; an actor's theme ref beats the user's; a damage-map value naming a theme gives its look; Review Focus 3 — a ref to a deleted user theme falls back to the default look with one warning per roller; a ghost view never calls the resolver (existing gate pin still passes); `look` → `theme` migration keeps the user's choice.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(themes): themes in the look chain`.

---

### Task 8: Theme sounds and celebrations

**Files:**

- Modify: `src/effects/fx-resolver.js`, `src/main.js`
- Test: `tests/unit/fx-resolver.test.js`, `tests/unit/message-gate.test.js`

**Interfaces:**

- Consumes: resolver output `themeId` (Task 7), `findTheme` (Task 6).
- Produces: in the fx decorator, a die whose look has `themeId` uses `effectiveRules({world: worldMinusReplaced, roller, module, theme: theme.rules})` where `worldMinusReplaced` drops world rules whose id equals a theme rule id (P5-D4), and theme rules fire after the roller's. Same gates as other rules (`effects`, `showOthersEffects`, discarded dice, macros roller-only). `effectiveRules` gains the optional `theme` array.
- [ ] **Step 1: Failing tests:** a `dragon-hoard` nat 20 plays `embers`/`fanfare` once (not also `celebrate`); a non-themed die still plays the world rule; `showOthersEffects` off hides another roller's theme celebration; Review Focus 4 — blind roll by a themed player: ghost views get no theme fx (gate pin with a themed roller).
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(themes): theme sounds and celebrations`.

---

### Task 9: The thumbnail renderer

**Files:**

- Create: `src/themes/thumbnailer.js` (lazy, part of the theme-browser chunk)
- Test: `tests/unit/thumbnailer.test.js`

**Interfaces:**

- Produces `createThumbnailer({atlas, createRenderer = () => new THREE.WebGLRenderer({canvas: new OffscreenCanvas-or-canvas(256, 256), alpha: true, antialias: true}), size = 256, idle, warn}) -> {thumbnail(theme, dieType = 'd20') -> Promise<string | null>, dispose()}`:
  - One renderer per thumbnailer (P5-D5); `configureRenderer` and a small studio scene (`buildScene()` + `setEnvironment` at resolution 128); the die rests on its top face (port the resting-orientation helper from `dev/looks.js` into `src/core/` if needed), material from `createDiceMaterial` at the `medium` tier flags, rendered once, read back with `canvas.convertToBlob` / `toBlob` → object URL.
  - Requests are queued and rendered one at a time, each in its own idle slice (P5-D6 cache: `Map` keyed `appearanceKey|dieType|size`; a repeat request returns the cached URL without rendering).
  - Materials and geometry are disposed after each render; `dispose()` revokes URLs, disposes the renderer and environment.
  - Review Focus 5: when `createRenderer` throws or the context is lost, `thumbnail` resolves `null` (one warning) and later calls resolve `null` without retrying the context.
- [ ] **Step 1: Failing tests** with an injected fake renderer (records renders; `toBlob` stub): cache hit renders nothing; two concurrent requests render sequentially; dispose revokes every URL and disposes materials; a throwing `createRenderer` → `null` and one warning.
- [ ] **Step 2–4:** run, implement, pass. Manually confirm on a dev page (`dev/themes.html`, Task 11) that thumbnails look like the dice.
- [ ] **Step 5: Commit** `feat(themes): offscreen thumbnail renderer`.

---

### Task 10: The theme browser

**Files:**

- Create: `src/ui/theme-browser.js` (lazy chunk), `src/ui/theme-form.js`, `templates/theme-browser.hbs`
- Modify: `src/settings.js` (menu `themeBrowser`), `src/main.js` (`preloadEditors`; a scene-controls or settings button is enough), `src/api/dice3d.js` (non-enumerable `_themeContext()`), `lang/en.json`, `styles/dicer.css`, `tests/unit/build.test.js`
- Test: `tests/unit/theme-browser.test.js` (jsdom)

**Interfaces:**

- Produces:
  - Gallery of built-in, world and my themes, each card with a lazily rendered thumbnail (Task 9; swatch fallback), name and source badge; a filter (All / Built-in / World / Mine).
  - **Use** actions on a card: as my default; for a die type; for a roll role (`attack`, `damage`, `save`, `skill`, `initiative`, `check`); for one of my owned actors (actor flag `dicer.appearance.global = {theme}`); for a damage type (players: `damageThemeOverrides`; GM: also `damageTypeMap`). Writes go to `dicer.appearance` (user flag, merged per slot) or the relevant setting. **Clear** removes a slot.
  - **Duplicate** a theme into My themes and edit a simple form: name, base look (from `LOOKS`) or keep, per-type overrides (pick a look per die type), impact sound material, celebration (effect + sound for nat 20 and nat 1). The full appearance editor is Plan 7.
  - **Export** a theme (or all my themes) to a `.json` file with `foundry.utils.saveDataToFile`; **Import** with `readTextFromFile` into My themes (`normalizeTheme`, warnings listed; ids re-namespaced to `user.<me>.<slug>`, collisions get a suffix).
  - **Publish** (GM): copy a theme into `worldThemes` as `world.<slug>`; delete world themes (GM).
  - Pure helpers: `themeFromForm`, `formFromTheme`, `importThemes(json, userId) -> {themes, warnings}`, `assignTheme(looks, slot, themeId) -> looks`.
  - Unreadable stored themes are kept and listed as unreadable (not deleted on save).
- [ ] **Step 1: Failing tests:** assignment writes the right slot and Clear removes it; import of a file with two themes, one invalid → one imported, one warning; id collisions renamed; export JSON round-trips through import; a player can't publish; unreadable stored themes survive a save; the lang check covers every `DICER.Themes.*` key.
- [ ] **Step 2–4:** run, implement, pass; build; lazy list.
- [ ] **Step 5: Commit** `feat(ui): theme browser`.

---

### Task 11: Review pages, live checks and docs

**Files:**

- Create: `dev/themes.html`, `dev/themes.js`, `dev/areas.html`, `dev/areas.js`
- Modify: `docs/live-checks.md`, `README.md`, `tests/live/world.js`, `tests/live/compat.mjs` (or a new `tests/live/areas.mjs` with `test:live:areas`)
- Test: `node --check` on live files

**Interfaces:**

- `dev/themes.html`: every built-in theme as a thumbnail (through the real thumbnailer) and a "throw" button per theme with its celebration (owner sign-off on the 22 themes).
- `dev/areas.html`: the four presets and a custom area drawn over a fake usable region, with two simultaneous throws in different areas.
- Live test (owner-run): GM sets player B's area to `corner`; B rolls; on both clients the dice settle inside B's resolved rect (via a `_debug` read of the last roll's area); a GM blind roll with `gmPrivateCorner` on lands in the GM corner on the GM client.
- `docs/live-checks.md`: area editor drag/resize/reset on a real screen, sidebar collapse with an area set, a theme from the browser shows on another player's screen, import/export a theme file, a themed blind roll stays neutral for others.
- README: Themes and Roll areas sections (settings names, the two menus, the API with an example, the DSN #548/#287/#272 notes).
- [ ] **Step 1:** dev pages run with no console errors; screenshot `docs/signoff/plan-5/themes.png`.
- [ ] **Step 2:** live test written; `node --check`.
- [ ] **Step 3:** docs.
- [ ] **Step 4:** full suite, lint, build, build budget test.
- [ ] **Step 5: Commit** `docs: themes and areas review pages, live checks and README`.

---

## Not in this plan

- The full appearance editor with live preview, GM push/locks and preset import/export of appearances (Plan 7). Plan 5's theme form only picks existing looks.
- Hand rolling (Plan 6) will throw into the roller's area through the same `DiceBox.roll(specs, {area})`.
- Same throw on every screen (v2): areas are resolved per screen, so positions match proportionally, not exactly.
