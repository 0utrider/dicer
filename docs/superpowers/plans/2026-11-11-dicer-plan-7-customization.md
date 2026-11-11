# Dicer Plan 7 — Customization (Appearance Editor) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> Roadmap row 6 (the order changed on 2026-11-11; plan files keep their own numbers).

**Goal:** Players and GMs design their own dice — body material, finish, colours, what's inside a clear die, number fill and font, edge sharpness and glow — in an editor with a live spinning 3D preview, save them as themes, assign them per user, die type, roll type, character and damage type, share them as files, and the GM can push a look to the whole table and lock it.

**Architecture:**

- **Appearances stay plain data inside themes.** The editor edits a theme's `appearance` and its per-die-type overrides; saving writes a user theme (or a world theme for the GM). Every existing assignment path (Plans 5–6 of the old order: the `dicer.appearance` slots, actor flags, damage map) already resolves themes, so the editor adds no new resolution path.
- **The editor is a lazy ApplicationV2 chunk** that reuses the theme browser's thumbnailer for its live preview (the rotating, draggable die built for the browser), re-rendering on every change with a short debounce.
- **Fonts become a layer.** Digits are drawn from an SDF atlas in the shader today (one bundled serif). A worker builds an atlas from any font — the bundled ones, a font installed on the computer, or a font file in the world — on demand, caches it, and the materials pick it up; the default atlas is used until it is ready, so no roll ever waits or stutters.
- **GM controls are world settings plus one GM action:** a world default theme, a "players can't change their dice" lock, and "push to players", which the GM's client writes into each player's look flag.

**Tech Stack:** Plain JS ES modules, three.js 0.184 (WebGL2), OffscreenCanvas + Web Worker, Foundry v14 ApplicationV2 / HandlebarsApplicationMixin, Vite 6, Vitest, Playwright (render harness from the editor redesign: `npm run test:visual:editors`).

**Spec:** `docs/superpowers/specs/2026-11-10-dicer-design.md` — G4 (customization), with §5 "Dice geometry and numbers" (font atlases, chamfer radius per appearance), G3 (the layers), G2 (no per-appearance texture generation on the main thread; size), G5 (themes are where appearances are saved).

## Design calls made in this plan (owner can overturn)

- **P7-D1 A custom look is always saved as a theme.** There is no separate "appearance preset" store: a theme already bundles a look, per-die-type looks, a sound and celebrations, and every assignment target accepts themes. Cost if wrong: a parallel preset list and a second picker everywhere.
- **P7-D2 Edge sharpness is five steps, not a free slider.** `edges.radius` takes 0, 0.25, 0.5, 0.75 or 1 (sharp → very rounded); each step is one cached geometry per die type, so custom looks can't multiply GPU geometries without bound (G2 500-roll stability). Cost if wrong: finer steps cost a geometry each.
- **P7-D3 Runtime fonts use a single-channel SDF** (stored in all three channels, so the existing MSDF shader's median gives the same value). Multi-channel generation needs a native tool; single-channel is slightly softer at very small sizes but builds anywhere in a worker. The bundled serif keeps its prebuilt MSDF atlas. Cost if wrong: slightly rounder corners on custom-font digits at low resolution.
- **P7-D4 "Push to players" writes each player's default** (GM client updating each player's look flag), keeping their per-type and per-roll choices unless the GM ticks "replace everything". The lock makes the world default win for players regardless of their own choices and hides the "use" actions for them. Cost if wrong: a different push semantic (e.g. a live override with no write).
- **P7-D5 Two bundled fonts ship:** the existing serif (DM Serif Display) plus one clear sans for readability, both OFL. Any other font comes from the computer or a file. Adding the sans needs the owner's OK to download it (Task 3). Cost if wrong: one more ~25 KB atlas loaded only when chosen.

## Global Constraints

- **G2 first roll with a new appearance:** "No visible hitch: no per-appearance canvas or texture generation on the main thread." Font atlases are built in a worker and cached; until ready, the default atlas renders.
- **G2 500 rolls:** stable memory — geometries per edge step and die type are shared and cached; atlas textures are cached by font id with an LRU (cap 6); editor previews dispose their materials.
- **Download size:** world start ≤ 4 MiB (headroom ~90 KiB). The editor, the font worker and any extra font atlas are lazy; the main bundle gains only the resolver-side font lookup, the GM settings and the actor-sheet button (target ≤ 6 KiB).
- **Privacy (G1):** unchanged — looks resolve only for real views; nothing here adds a path for ghost/none views.
- **Players can't write world data;** the GM-only actions are gated in the action handlers, not just hidden.
- **Defensive:** malformed appearances normalize (never throw); a font that fails to load falls back to the default atlas with one warning; unreadable stored themes are kept (Plan 5 precedent).
- **Settings (§5):** every new feature has its own setting.
- **UI:** follows the redesigned editors' visual language (Foundry v14 variables, `registerEditorMenu`, single root element per template, lang check), verified by screenshots in the render harness.
- **Tests:** `tests/unit/*.test.js`; `rtk proxy npx vitest run <file>`; build `node node_modules/vite/bin/vite.js build`; Windows: write scripts to files.

## Review Focus

1. **A look that changes while dice are rolling or effects are playing.** Expected: in-flight dice keep their material until they finish; the next roll uses the new look; nothing leaks (test in Task 2).
2. **A font that never loads, is huge, or lacks digits.** Expected: the default digits keep rendering, one warning, no main-thread stall; a font missing a glyph falls back to the default atlas for that glyph set (test in Task 3).
3. **The lock on, then a player's own per-actor or damage-type choice.** Expected: with the lock on, the world default wins for that player everywhere except explicit system/module colorsets (which outrank looks already); the player sees why the browser's "use" buttons are gone (test in Task 6).
4. **Editing a theme other players use.** Expected: the GM edits a world theme; every client re-resolves it on its next roll; players' own copies are unaffected (test in Task 4).
5. **Rapid slider dragging in the editor.** Expected: the preview updates within ~100 ms without piling up renders (debounced, one in flight), and no material/geometry leak after 200 edits (test in Task 4).

---

## File Structure

| File                                                                                                             | Responsibility                                                     |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `src/look/appearance.js`                                                                                         | `edges.radius`, `numbers.font` in the schema; normalization; keys. |
| `src/core/chamfer.js`, `src/throw/dice-box.js`, `src/render/dice-material.js`                                    | Geometry per edge step; atlas per font.                            |
| `src/fonts/font-atlas.js` (new), `src/fonts/font-worker.js` (new, lazy)                                          | Runtime SDF atlas generation, cache, loading.                      |
| `assets/fonts/`                                                                                                  | A second bundled font + its prebuilt atlas (Task 3).               |
| `src/ui/appearance-editor.js`, `src/ui/appearance-form.js` (new; editor lazy), `templates/appearance-editor.hbs` | The editor.                                                        |
| `src/ui/theme-browser.js`                                                                                        | "Edit" opens the appearance editor; GM push; lock-aware actions.   |
| `src/compat/resolve-looks.js`, `src/settings.js`, `src/main.js`                                                  | World default, lock, actor-sheet button.                           |
| `lang/en.json`, `styles/dicer.css`, `dev/editors.*`, `tests/visual/editors.mjs`                                  | Strings, styles, harness.                                          |

---

### Task 1: The schema — edge sharpness and font

**Files:**

- Modify: `src/look/appearance.js`
- Test: `tests/unit/appearance.test.js`

**Interfaces:**

- Produces:
  - `edges.radius ∈ {0, 0.25, 0.5, 0.75, 1}` (default 0.5); legacy `edges.style: 'sharp'` maps to `radius: 0`, `'rounded'` to 0.5; `style` is kept and derived (`radius === 0 ? 'sharp' : 'rounded'`) so existing readers keep working. Out-of-range values snap to the nearest step.
  - `numbers.font`: `'serif'` (default, the bundled DM Serif atlas) | `'sans'` (Task 3's bundled sans) | `'css:<family>'` (a font installed on the computer, family name ≤ 64 chars, letters/digits/space/-) | `'file:<path>'` (a world/data path ending .woff/.woff2/.ttf/.otf). Anything else → `'serif'`.
  - `appearanceKey` and `programKey` include both (programKey only where the shader differs; radius changes geometry, not the program).
  - Exported constants `EDGE_STEPS`, `FONT_IDS_BUILTIN`.
- [ ] **Step 1: Failing tests:** defaults; snapping; legacy style mapping; font validation (good/bad family names, paths, unknown → serif); keys differ when radius/font differ; DEFAULT_APPEARANCE still deep-frozen; every existing LOOKS/BUILTIN_THEMES appearance normalizes to itself plus the new defaults.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(look): edge sharpness and font in the appearance schema`.

---

### Task 2: Geometry per edge step

**Files:**

- Modify: `src/core/chamfer.js` (if the radius isn't already a parameter), `src/throw/dice-box.js`, `src/themes/thumbnailer.js`
- Test: `tests/unit/chamfer.test.js`, `tests/unit/dice-box.test.js`

**Interfaces:**

- Produces: `buildDieGeometry(shape, {radius})` for the five steps (0 = sharp with the crisp edge highlight the "sharp" style has today); DiceBox and the thumbnailer cache geometry by `type|radius` (shared, refcounted like materials); physics colliders are unchanged (the collider is the rounded hull for every step — Plan 2 already reuses it for sharp; fairness unaffected).
- [ ] **Step 1: Failing tests:** each step builds a valid geometry with the same face count/ids; radius 0 matches today's sharp geometry and 0.5 today's rounded one (vertex counts/bounds); DiceBox reuses one geometry for two dice of the same type and step; Review Focus 1 — changing a look mid-roll leaves in-flight dice on their geometry and frees nothing early; 200 rolls cycling all steps keep the geometry count ≤ 5 × types.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(look): five edge sharpness steps`.

---

### Task 3: Fonts — bundled sans, runtime atlases

**Files:**

- Create: `src/fonts/font-atlas.js`, `src/fonts/font-worker.js` (lazy chunk), `assets/fonts/<sans>.woff2` + `assets/fonts/digits-sans.png/json` + licence
- Modify: `src/render/dice-material.js`, `src/throw/dice-box.js`, `src/main.js`, `scripts/build-sdf.mjs` (output name argument), `tests/unit/build.test.js`
- Test: `tests/unit/font-atlas.test.js`

**Interfaces:**

- **Owner step first:** pick and download one OFL sans font with clear digits (suggested: Inter or Atkinson Hyperlegible — the implementer asks the controller, who asks the owner, before downloading). Build its MSDF atlas with `npm run build:sdf -- <font> assets/fonts digits-sans`.
- `createFontAtlases({loadBundled, createWorker, warn, cacheSize = 6}) -> {get(fontId) -> atlas | null, request(fontId) -> Promise<atlas | null>, onReady(cb)}`:
  - `serif` is the existing atlas (always ready); `sans` loads its prebuilt atlas lazily.
  - `css:` and `file:` ids are built in the worker: draw `0-9` and the `_` underline glyph large on an OffscreenCanvas with the font (FontFace for files), compute a signed distance field (two-pass Euclidean distance transform), downsample to the atlas size, write the same value to R, G, B, and return the same `{chars, common, distanceField}` JSON shape `parseAtlas` reads plus the pixels (P7-D3). Results cached in memory (LRU) and in IndexedDB keyed by font id + generator version.
  - `get` returns null until ready; materials created while not ready use the serif atlas and are refreshed (`invalidateMaterials`) when `onReady` fires.
  - A font that fails, times out (`FONT_TIMEOUT_MS = 8000`) or lacks digits → `null` forever for that id, one warning (Review Focus 2). Worker unavailable (no OffscreenCanvas) → generation on the main thread in idle slices of ≤ 8 ms.
- DiceBox/material: the atlas is chosen per appearance `numbers.font`; material cache keys include the font id.
- [ ] **Step 1: Failing tests:** the SDF builder (pure function, run in node with a stub glyph raster) produces a field where inside > 0.5 > outside and the JSON parses with `parseAtlas`; `get` null until ready, then the atlas; LRU eviction disposes textures; failures/timeouts → null + one warning, no retry; materials fall back then refresh on ready; the worker chunk is lazy (build.test).
- [ ] **Step 2–4:** run, implement, pass; build.
- [ ] **Step 5: Commit** `feat(look): font layer with runtime digit atlases`.

---

### Task 4: The appearance editor

**Files:**

- Create: `src/ui/appearance-editor.js` (lazy chunk), `src/ui/appearance-form.js`, `templates/appearance-editor.hbs`
- Modify: `src/ui/theme-browser.js` (Edit / Create opens it), `src/settings.js` (menu `appearanceEditor`), `src/main.js` (`preloadEditors`), `lang/en.json`, `styles/dicer.css`, `tests/unit/build.test.js`, `dev/editors.js`, `tests/visual/editors.mjs`
- Test: `tests/unit/appearance-editor.test.js` (jsdom)

**Interfaces:**

- Produces `openAppearanceEditor({themeId?, base?})`: edits a copy of a theme (new from a base look or theme, or an existing user/world theme the user may edit).
- Layout (redesign language): left, the live preview (the thumbnailer's rotating, draggable die; a die-type strip d4 d6 d8 d10 d12 d20 d100 to switch the previewed type); right, the layer stack as collapsible sections:
  - **Body:** type (opaque / clear resin / metal / marble / pearl, as visual chips), colour, second colour (marble/pearl/resin tint), finish (polished / brushed / antique, metal only), roughness slider.
  - **Inside** (clear resin only; hidden otherwise with a one-line note): type (none / liquid / glitter / swirl / nebula / shape), two colours, density slider, shape (star / heart / skull / sphere) for "shape".
  - **Numbers:** fill (paint / gold / silver / enamel), colour (paint/enamel), engraving depth slider, font (Serif, Sans, a font on this computer — a text field with a few suggestions such as "Georgia", "Impact" —, or a font file via FilePicker).
  - **Edges:** sharpness (five-step segmented control).
  - **Glow:** colour, intensity slider.
  - **Per die type** (optional): "Use a different look for…" a die type; switches the whole stack to edit that type's override, with "Same as default" to remove it.
  - Footer: name, Save as my theme / Save as world theme (GM) / Update (when editing your own), Cancel; Export look (JSON file) / Import look (JSON) / Copy / Paste (clipboard JSON of one appearance).
- Pure helpers: `formFromAppearance`, `appearanceFromForm` (via `normalizeAppearance`), `visibleSections(appearance)`.
- Preview updates debounced to 80 ms, one render in flight, latest wins (Review Focus 5); the editor disposes the preview on close.
- Saving writes through the theme lists (upsert by id; unreadable entries kept); a world theme edit re-resolves on every client's next roll (Review Focus 4).
- The theme browser's old simple edit form is removed; "Duplicate" opens the editor on the copy.
- [ ] **Step 1: Failing tests:** form round trip for every layer; the inside section hidden for non-resin; finish only for metal; per-type override add/remove; save/update/world-save gating (players can't world-save); import/export/copy/paste round trip with malformed input rejected (one warning); debounced preview (fake timers: 20 rapid changes → ≤ 3 renders, final state rendered); 200 edits leave no undisposed materials (spy); lang check covers `DICER.Appearance.*`; single root element.
- [ ] **Step 2–4:** run, implement, pass; build; lazy list; harness screenshots `docs/signoff/ui/appearance-editor.png` (resin with nebula), `appearance-editor-metal.png` — look at them and iterate until clean.
- [ ] **Step 5: Commit** `feat(ui): appearance editor with live preview`.

---

### Task 5: Assignment shortcuts — actor sheets and die types

**Files:**

- Modify: `src/main.js`, `src/ui/theme-browser.js`, `lang/en.json`
- Test: `tests/unit/main-hooks.test.js`, `tests/unit/theme-browser.test.js`

**Interfaces:**

- An actor sheet header control "Dice look" (v14 `getHeaderControlsApplicationV2` for sheets of actors the user owns) opens the theme browser pre-targeted to that actor (the "Use for" select starts on that actor; the detail panel shows that actor's current theme).
- The browser's target list also offers "This die type for all my characters" etc. as today; no new resolution.
- [ ] **Step 1: Failing tests:** the control appears only for owned actors and opens the browser with the actor target selected; unowned → no control.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(ui): dice look button on actor sheets`.

---

### Task 6: GM push and locks

**Files:**

- Modify: `src/settings.js`, `src/compat/resolve-looks.js`, `src/ui/theme-browser.js`, `src/main.js`, `lang/en.json`
- Test: `tests/unit/resolve-looks.test.js`, `tests/unit/theme-browser.test.js`, `tests/unit/settings.test.js`

**Interfaces:**

- Settings: `worldDefaultTheme` (world, String, '' = none; choices = built-in + world themes, kept live like the `theme` setting), `lockPlayerLooks` (world, Boolean, false).
- Resolver: for a roller who is not a GM, when `lockPlayerLooks` is on and `worldDefaultTheme` is set, the roller's own refs and actor flags are skipped and the world default theme applies (explicit roll colorsets/appearances and damage themes keep their current precedence). Without the lock, `worldDefaultTheme` is the fallback for players with no choice of their own (before DEFAULT_APPEARANCE).
- `pushThemeToPlayers(themeId, {replaceAll = false}) -> Promise<{updated: number}>` (GM only; refuses otherwise): for every non-GM user, writes `global = themeRef(themeId)` into their `dicer.appearance` flag; with `replaceAll`, also clears their per-type and per-role slots. Offered in the browser's detail panel for the GM ("Push to players…" with the replace checkbox and a confirm dialog).
- Players under the lock: the browser hides "use" actions and shows a one-line notice ("Your GM has set everyone's dice"); the appearance editor still lets them design and save themes (for when the lock is lifted).
- Existing world caps (`qualityCap`, `maxDice`) are listed together with the lock in a "GM controls" section of the README; no new caps.
- [ ] **Step 1: Failing tests:** fallback order without the lock; lock overrides own refs and actor flags for players, never for GMs; colorset/damage precedence unchanged; Review Focus 3; push writes every player (not GMs), `replaceAll` clears slots; a player's push refused; lock hides actions and shows the notice.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(themes): GM default, push to players and lock`.

---

### Task 7: Review, live checks and docs

**Files:**

- Modify: `docs/live-checks.md`, `README.md`, `dev/editors.js`, `tests/visual/editors.mjs`

**Interfaces:**

- Harness: screenshots of the editor for each body type and with a custom font; the browser's GM push panel and the locked-player notice.
- `docs/live-checks.md`: design a theme, save, use as default, see it on another player's screen; a computer font and a font file; edge steps on all dice; GM push with and without "replace everything"; the lock; the actor-sheet button.
- README: "Designing your own dice", fonts (where they come from, fallback), GM controls.
- [ ] **Step 1:** screenshots reviewed; **Step 2:** docs; **Step 3:** full suite, lint, build, budget; **Step 4: Commit** `docs: customization review shots, live checks and README`.

---

## Not in this plan

- Editing celebrations and sounds inside the appearance editor (the theme browser and trigger rules already cover them).
- Custom 3D models for dice (DSN GLB presets keep working; authoring new ones is out of scope).
- Rolling by hand and the dice pet (roadmap rows 8 and 8b).
