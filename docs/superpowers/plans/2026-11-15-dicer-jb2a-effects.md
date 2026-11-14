# JB2A Effects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a JB2A module is active and the viewer's **Use JB2A animations** setting is on, mapped dice effects play JB2A webm animations at the die. Otherwise they play the built-in effect, exactly as today.

**Architecture:**
- A lazy `jb2a` chunk (`src/jb2a/jb2a.js`) holds the mapping (`catalogue.js`) and a video-plane player (`player.js`). The player turns an effect id plus its built-in module into a library-contract module (`{id, cost, defaults, start(ctx)}`). That module plays JB2A layers, and falls back to the built-in `start(ctx)` late when a file fails.
- The effect layer gets one injected dependency, `jb2a`. It asks the player before using `library[id]`.
- main.js detects the JB2A source (module id and location) and loads the chunk in the same idle prefetch as the effects library.

**Tech Stack:** Foundry VTT v14 module, three.js r184 (`VideoTexture`, `MeshBasicMaterial`), Vite lazy chunks, Vitest, Playwright for the local visual harness.

**Spec:** docs/superpowers/specs/2026-11-15-dicer-jb2a-effects-design.md

## Global Constraints

**Modules and paths**
- Modules: `jb2a_patreon` is preferred, then `JB2A_DnD5e`. A module must be active (`game.modules.get(id)?.active === true`).
- Path: `${location}/${moduleId}/Library/Generic/<dir>/<file>`. `location` is `game.settings.get(moduleId, 'jb2aLocation')` when it is a non-empty string (trailing `/` stripped), else `modules`.
- Mapping entries store full file names (size suffix and `.webm`). There is no directory listing at runtime.

**Setting**
- Client setting `jb2aEffects`, Boolean, default `true`, config true. Name "Use JB2A animations". Hint: "Play JB2A's animated effects (Jules & Ben's Animated Assets) at the dice instead of the built-in ones, when the JB2A module is installed and active. Does nothing without JB2A."
- Turning the setting off takes effect on the next effect, with no reload.

**Load failure and fallback**
- A failed file (video `error`, or no `canplay` within `CANPLAY_MS = 1500`) is marked missing for the session. Its effect falls back to the built-in `start(ctx)` on the same die, late.
- Pool: at most `MAX_PER_FILE = 4` video elements per file and `MAX_PLAYING = 8` playing at once. A play beyond either limit uses the built-in effect.

**Placement and drawing**
- `table` layers: plane at y = 0.02, `depthTest: true`, `renderOrder` 5.
- `over` layers: plane at y = 3, `depthTest: false`, `renderOrder` 999.
- All layers: `transparent: true`, `depthWrite: false`, `toneMapped: false`, plane rotated −π/2 about x, centred at the die's x and z plus `offsetZ`.
- Sizes and offsets are scene units, which are die units. A layer's size is multiplied by the effect's `intensity`.
- `playbackRate` stays 1.

**Behaviour rules**
- A JB2A module's `cost` equals its built-in module's cost.
- Ids with no mapping stay built-in: `glow-pulse`, `color-shift`, `number-flare`, `shake`, every `dsn:` id. Impact effects and damage themes are unchanged.
- In safe mode, an fx whose id has a JB2A module plays (as `dsn:` ids do). Its late fallback to built-in does not happen in safe mode.
- Recolouring: only layers that list colour `variants` are recoloured. The pick is the variant whose hue is nearest the effect colour's hue.

**Budget and process**
- World start: 1,199 B of headroom is left under the rolling-by-hand ratchet (4,103,020 + 12,288; measured 4,114,109 at aedbc48). This plan must fit inside it, with no re-base. The `jb2a-<hash>.js` chunk is added to the LAZY list.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Plan-level ruling

The spec says videos honour slow motion through `playbackRate`. Slow motion only slows a die's landing (`fx-resolver.js`), and effects start after the landing. So the honest equivalent is `playbackRate` 1, and this plan uses that.

## Review Focus

1. **Setting turned off mid-session.** The next effect is built-in, with no reload.
2. **JB2A installed but inactive** (or the setting registered with an empty location). It is not used, or uses `modules`. There are no console errors.
3. **A die released while its layers play** (`releaseDie(die)`, `dispose()`). The videos pause, the planes leave the scene, and textures and materials are disposed.
4. **Ten crits land at once.** Eight play JB2A and the rest play built-in. Nothing waits and nothing throws.
5. **`jb2aLocation` set to an external URL with a trailing slash** (`https://bucket.example/`). The URL is built without a double slash.

---

### Task 1: Catalogue and file resolution

**Files:**
- Create: `src/jb2a/chunk/catalogue.js`
- Test: `tests/unit/jb2a-catalogue.test.js`

**Interfaces:**
- Produces:
  - `JB2A_EFFECTS: Record<string, Layer[]>`
  - `Layer = { dir: string, file: string, place: 'table'|'over', size: number, offsetZ?: number, variants?: { color: string, file: string }[] }`
  - `pickFile(layer, color: THREE.Color|null) -> string`: the file name.
  - `urlFor(source: {moduleId: string, location: string}, layer, color) -> string`
  - `hueDistance(a: THREE.Color, b: THREE.Color) -> number`: circular distance in [0, 0.5].

**Mapping** (sizes are the spike's; Task 4 tunes the four "candidate" rows):

| id | layers |
|---|---|
| celebrate | `Particles/ParticleBurstCircle01_01_Regular_Yellow_600x600.webm` table 7; `Twinkling_Stars/TwinklingStars_04_100x100.webm` over 3.2; `UI/Critical_01_Yellow_200x200.webm` over 4.5 offsetZ −2 |
| fumble | `Impact/GroundCrackImpact_01_Dark_Red_600x600.webm` table 6; `UI/CriticalMiss_02_Red_200x200.webm` over 5 offsetZ −1.9 |
| frost | `Impact/FrostImpact_01_Regular_Blue_600x600.webm` table 6 |
| lightning | `Lightning/LightningStrike01_01_Regular_Blue_800x800.webm` over 16 offsetZ −1.6 |
| smoke | `Smoke/SmokePuff01_01_Dark_Black_400x400.webm` over 5 |
| sparkles | `Twinkling_Stars/TwinklingStars_04_100x100.webm` over 3.2; `Particles/ParticlesOutward01_01_Regular_<v>_400x400.webm` table 6, variants Blue `#4a8cff`, GreenYellow `#b8e04a`, Orange `#ff8a2a`, Purple `#a05aff`, Red `#ff3a3a`, White `#ffffff`, default Orange |
| shockwave (candidate) | `Impact/Impact_01_Regular_<v>_400x400.webm` table 6, variants Blue `#4a8cff`, Green `#4ae07a`, Orange `#ff8a2a`, PinkPurple `#d05aff`, Yellow `#ffe27a`, default Yellow |
| light-burst (candidate) | `Explosion/Explosion_01_<v>_400x400.webm` over 5, variants Blue `#4a8cff`, Green `#4ae07a`, Orange `#ff8a2a`, Purple `#a05aff`, Yellow `#ffe27a`, default Yellow |
| embers (candidate) | `Impact/ImpactFire01_01_Regular_Orange_600x600.webm` over 6 |
| shatter (candidate) | `Impact/ImpactIceShard01_01_Regular_Blue_400x400.webm` over 6 |

- [ ] **Step 1: Write the failing tests**

  - `JB2A_EFFECTS` has exactly these ids: `celebrate`, `fumble`, `frost`, `lightning`, `smoke`, `sparkles`, `shockwave`, `light-burst`, `embers`, `shatter`.
  - Every `file` and variant `file` ends in `.webm`.
  - Every `place` is `table` or `over`.
  - Every `size` is greater than 0.
  - `pickFile` of the shockwave layer:
    - `#4a8cff` gives `Impact_01_Regular_Blue_400x400.webm`;
    - `#ff9030` gives the Orange file;
    - `null` gives the Yellow file.
  - `pickFile` of the fumble crack ignores colour.
  - `hueDistance` of red against near-magenta (`#ff0010`) is under 0.05, because the distance wraps around the hue circle.
  - `urlFor`:
    - `{moduleId: 'jb2a_patreon', location: 'modules'}` with frost gives `modules/jb2a_patreon/Library/Generic/Impact/FrostImpact_01_Regular_Blue_600x600.webm`;
    - location `https://bucket.example/` gives `https://bucket.example/jb2a_patreon/Library/Generic/...`, with no `//` after the host (Review Focus 5).

- [ ] **Step 2:** Run `npx vitest run tests/unit/jb2a-catalogue.test.js`. Expect it to fail: no module.
- [ ] **Step 3:** Implement `catalogue.js`. Freeze the tables. A layer with `variants` and no colour uses the variant whose `file` equals `layer.file` (the default).
- [ ] **Step 4:** Run the test. Expect it to pass.
- [ ] **Step 5:** Commit `feat(jb2a): effect catalogue and file resolution`.

### Task 2: Video-plane player with pooling and late fallback

**Files:**
- Create: `src/jb2a/chunk/player.js`, `src/jb2a/jb2a.js` (chunk entry: `export * from './chunk/player.js'; export * from './chunk/catalogue.js';`)
- Test: `tests/unit/jb2a-player.test.js`

**Interfaces:**
- Consumes: Task 1's `JB2A_EFFECTS` and `urlFor`.
- Produces:
  - `createJb2aPlayer({ source: () => ({moduleId, location}) | null, createVideo = () => document.createElement('video'), now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout }) -> Player`
  - `Player.moduleFor(id: string, builtin: object|null, { safe?: boolean }) -> object|null`: a library-contract module `{ id, cost: costOf(builtin), defaults: builtin?.defaults, start(ctx) }`, or null. It is null when there is no mapping, no source, a layer file is known missing, or the pool is full.
  - `Player.preload(ids?: string[]) -> void`: makes one pooled element per mapped file, with `preload = 'auto'`.
  - `Player.missing: Set<string>`: URLs marked missing.
  - `Player.playing: number`
  - `Player.dispose() -> void`
  - Exported constants: `CANPLAY_MS = 1500`, `MAX_PER_FILE = 4`, `MAX_PLAYING = 8`.
- `start(ctx)` returns `{ update(nowMs) -> boolean, stop() }`:
  - `update` is true while any layer's video has not ended, or while the late fallback handle runs.
  - `stop()` pauses the videos, removes the planes from `ctx.scene`, disposes textures, materials and geometry, and returns the elements to the pool.
  - A layer whose video fires `error`, or misses `canplay` within `CANPLAY_MS`, triggers the fallback once per play: the URL is added to `missing`, every layer is stopped, and, unless `safe`, `builtin.start(ctx)` is called and its handle is then delegated to.

- [ ] **Step 1: Write the failing tests.** Use a fake video: an EventTarget with `play()` (resolves), `pause()`, `src`, `preload`, `muted`, `playsInline`, and helpers to fire `canplay`, `ended` and `error`. Stub THREE's `VideoTexture` only if jsdom lacks it.
  - `moduleFor('frost', builtinFrost)` returns a module with `cost` equal to `builtinFrost.cost` and `id` `frost`.
  - `moduleFor('glow-pulse', b)` is null.
  - `moduleFor` is null when `source()` is null.
  - Placement: `start(ctx)` with `ctx.position` (2, 0, −1) and `intensity` 1 adds one mesh for frost at x 2, y 0.02, z −1, with a 6×6 plane, `depthTest` true and `renderOrder` 5. Celebrate's banner is at y 3, z −3, with `depthTest` false and `renderOrder` 999.
  - `intensity` 1.5 makes frost's plane 9×9.
  - Lifetime: `update()` is true until every layer fires `ended`, then false.
  - Error fallback: firing `error` on frost's video marks its URL missing and calls `builtin.start(ctx)` once. `update` then returns the builtin handle's value. The next `moduleFor('frost', …)` is null.
  - Timeout fallback: no `canplay` within 1500 ms (fake timers) triggers the same fallback.
  - `{ safe: true }`: the fallback does not call `builtin.start`, and `update` returns false.
  - Pool (Review Focus 4): 10 `start` calls for celebrate (3 layers) leave `playing` at 8 or fewer. Any `moduleFor` call made while 8 are playing returns null. After `ended`, `playing` drops and `moduleFor` works again.
  - Release (Review Focus 3): `stop()` mid-play pauses every video, removes every mesh from the scene, and calls `dispose` on texture, material and geometry.
  - `preload(['frost'])` creates exactly one element with `preload === 'auto'` and the frost URL.

- [ ] **Step 2:** Run `npx vitest run tests/unit/jb2a-player.test.js`. Expect it to fail.
- [ ] **Step 3:** Implement `player.js` and `jb2a.js`. Element setup:
  - `muted = true`, `playsInline = true`, `crossOrigin = 'anonymous'` when the URL is absolute;
  - `VideoTexture` with `colorSpace = SRGBColorSpace`.

  A pooled element is reused only after `ended` or `stop()`, and its `currentTime` is reset to 0.
- [ ] **Step 4:** Run the test. Expect it to pass.
- [ ] **Step 5:** Commit `feat(jb2a): video-plane player with pooling and late fallback`.

### Task 3: Wire it in: setting, source detection, effect layer, chunk, docs

**Files:**
- Create: `src/jb2a/source.js` (`jb2aSource`, world start, tiny), `tests/unit/jb2a-source.test.js`
- Modify:
  - `src/effects/effect-layer.js`: new dep `jb2a`, plus `moduleFor`, `play`'s safe filter and `prefetch`;
  - `src/main.js`: source detection, passing `jb2a` to `createEffectLayer`;
  - `src/settings.js`: `jb2aEffects`, after `impactEffects`;
  - `lang/en.json`;
  - `build/world-start.js`: LAZY gets `jb2a-[A-Za-z0-9_-]{8}\.js$`;
  - `README.md`: Effects section.
- Test: `tests/unit/effect-layer.test.js`, `tests/unit/settings.test.js`, `tests/unit/build.test.js` (the ratchet runs unchanged).

**Interfaces:**
- Consumes: Task 2's `createJb2aPlayer` and `Player.moduleFor` / `preload`.
- Produces:
  - `createEffectLayer({ …, jb2a = null })`, where `jb2a = { source(): {moduleId, location}|null, load(): Promise<{createJb2aPlayer}> }`.
  - The layer keeps `player = null`, which `prefetch()` fills in.
  - `jb2aSource({ modules, settings }) -> {moduleId, location}|null` in `src/jb2a/source.js` (world start, tiny).

- [ ] **Step 1: Write the failing tests**
  - Effect layer with a fake `jb2a` whose player maps `frost`:
    - with the setting on, `play(die, [frost fx])` starts the JB2A module, not `library.frost`;
    - with `getSetting('jb2aEffects') === false`, the built-in plays (Review Focus 1: flip the setting between two plays, no reload);
    - with `source()` null, the built-in plays and `load` is never called.
  - Safe mode: `gate()` is `'safe'` and the player maps `frost`. Frost plays JB2A, and a non-mapped library id is still filtered out.
  - `prefetch()` calls `jb2a.load()` once, only when `source()` is non-null and the setting is not false. It then calls `player.preload()`.
  - `jb2aSource`:
    - an active `jb2a_patreon` with location `''` gives `{moduleId: 'jb2a_patreon', location: 'modules'}`;
    - an inactive patreon plus an active `JB2A_DnD5e` gives the free id;
    - neither active gives null (Review Focus 2);
    - a throwing `settings.get` gives location `modules`.
  - Settings: `jb2aEffects` is `{ scope: 'client', type: Boolean, default: true, config: true }`.
- [ ] **Step 2:** Run those test files. Expect them to fail.
- [ ] **Step 3:** Implement.
  - **Layer:** the JB2A module is tried first, then the library:
    ```js
    moduleFor(f) => player?.moduleFor(id, library?.[id] ?? null, { safe: gate() === 'safe' }) ?? libraryModule
    ```
    It is tried only when `setting('jb2aEffects') !== false`.
  - **main.js:**
    ```js
    jb2a: { source: () => jb2aSource({ modules: game.modules, settings: game.settings }), load: () => import('./jb2a/jb2a.js') }
    ```
  - **Lang:** `DICER.Settings.jb2aEffects.Name` and `.Hint`, with the exact copy from Global Constraints.
  - **README:** one paragraph in the Effects section listing the mapped effects, saying it uses the installed JB2A files only, and naming the setting.
- [ ] **Step 4:** Run `npm run build`, then `npm test` and `npm run lint`. Expect everything to pass, including the world-start ratchet (growth at most 12,288 over 4,103,020). Check that `dist/jb2a-*.js` exists and counts as lazy.
- [ ] **Step 5:** Commit `feat(jb2a): play JB2A animations for mapped effects when JB2A is active`.

### Task 4: Visual harness and tuning

**Files:**
- Create: `tests/visual/jb2a.mjs` (follow `tests/visual/effects.mjs`: same vite and GPU flags), `dev/jb2a.html`, `dev/jb2a.js` (a dev page like `dev/effects.html` whose effect layer gets a `jb2a` dep pointing at `/jb2a-local/`)
- Modify: `src/jb2a/chunk/catalogue.js`: sizes and offsets only.
- Output: `docs/signoff/jb2a/sheet-*.png`

**Interfaces:**
- Consumes: Task 3's layer wiring (the dev page passes `source: () => ({ moduleId: 'jb2a_patreon', location: '/jb2a-local' })`).
- Produces: tuned catalogue sizes and offsets.

- [ ] **Step 1:** Write the harness. It copies the mapped files from `../jb2a_patreon/Library/Generic/` into a git-ignored `jb2a-local/jb2a_patreon/Library/Generic/` (add it to `.gitignore`), and exits 0 with "jb2a: skipped (no ../jb2a_patreon)" when that folder is absent. For each mapped id it rolls a d20, then captures the frame mid-flight and at 120, 350, 700, 1100 and 1700 ms after landing, cropped around the die (project the die through `box._renderer.camera`). It saves a contact sheet per 3 ids, and fails on any page error.
- [ ] **Step 2:** Run `node tests/visual/jb2a.mjs`. Check every row against the die: centred, art fully in frame, the banner reading above the die, the lightning tip on the die. Retune the sizes and offsets of the candidate rows (shockwave, light-burst, embers, shatter) and any row that misfits. Re-run until each looks right.
- [ ] **Step 3:** Run `npm test`. The catalogue tests still pass (they check shape, not sizes).
- [ ] **Step 4:** Commit `test(jb2a): visual harness and tuned sizes`, including the sheets and the `.gitignore` line.

### Task 5: Owner live check (owner)

- [ ] In Foundry with JB2A active, run:
  ```js
  for (const id of ['celebrate','fumble','frost','lightning','smoke','sparkles','shockwave','light-burst','embers','shatter']) await game.dice3d.previewEffect(id);
  ```
  Then roll a natural 20 and a natural 1.
- [ ] The owner approves each look. A rejected look gets a new JB2A pick or new sizes. Repeat Task 4 step 2 for it.
