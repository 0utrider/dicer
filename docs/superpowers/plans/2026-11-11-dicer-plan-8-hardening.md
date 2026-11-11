# Dicer Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure Dicer against every G2 performance target and against Dice So Nice 6.4.5, give users a benchmark they can run and share, and fix the known performance debts, including getting world start honestly under 4 MB.

**Architecture:**
- **Measurement core:** a self-contained measurement core in `src/bench/` (stats, recorder, scenarios, report) with no imports outside that folder.
  - The live harness imports it straight from the module folder, so it can measure DSN while Dicer is disabled.
  - Dicer bundles the same files into a lazy chunk for the in-game benchmark.
- **Core changes:** small and free while idle: a frame counter, resource counts, a first-frame mark and a `_debug.canvas` handle.
- **Live harness:** `tests/live/bench.mjs` drives Playwright against a running Foundry, switches the active dice module, and writes JSON reports plus a markdown comparison.

**Tech Stack:** Plain JS ES modules, three.js 0.184, Foundry v14, Vite 6, Vitest, Playwright with Chrome DevTools Protocol (CDP) for CPU throttling, GC and heap metrics.

**Spec:** `docs/superpowers/specs/2026-11-10-dicer-design.md`: G2 (targets table, "What matching means", browsers, reference machine), §7 Verification (benchmark harness), §4 anti-goals.

## Global Constraints

- G2 targets, verbatim:
  - No dice on screen: **Zero** GPU work: no render, no rAF/ticker callback, canvas hidden.
  - Typical roll (≤10 dice): steady 60 fps for the whole animation. No main-thread task longer than 50 ms.
  - Big pool (30 dice): dice visible within 100 ms of the message arriving. No main-thread task longer than 50 ms.
  - Time from chat message to first dice frame (≤10 dice): ≤ 50 ms on the reference machine.
  - First roll with a new appearance: no visible hitch.
  - 500 consecutive rolls: stable memory, with no growth in JS heap or GPU textures, geometries or programs.
  - Window resize: no renderer rebuild; just resize the drawing buffer.
  - WebGL context loss: recover automatically on restore. The chat reveal still happens.
  - Download size: loaded at world start ≤ 4 MB at default quality.
  - Head-to-head: Dicer is never slower than DSN 6.4.5 on any harness scenario.
- Head-to-head pairings, each with the same dice and the same scene:
  1. Each product's defaults at its own auto-picked tier.
  2. DSN with every effect off against Dicer at Low.
  - Dicer must win both.
  - On the gaming PC, Dicer must use clearly less frame time than DSN at defaults (p95).
- Throttled profile: Chromium CPU throttling at 4×, Dicer forced to Medium, a 1920×1080 window, pixel ratio 1. Low-end results are **estimates**, and the README says so.
- The benchmark must be runnable by any user from a macro or a settings button, and give a shareable summary.
- First-class browser for every target: Chromium. Firefox and Safari: the benchmark must run and the summary must say "best effort".
- Anti-goals:
  - No external account or service: reports stay local, and the summary is plain text the user copies.
  - No chat spam: the in-game benchmark creates no chat messages.
- The `src/bench/{stats,recorder,scenarios,report}.js` files import only each other: no three.js, no other `src/` file, no bare specifiers. Foundry globals (`Hooks`, `Roll`, `game`) are allowed only inside functions, never at module top level.
- New UI and bench code goes in lazy chunks listed in `tests/unit/build.test.js`.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tests: `rtk proxy npx vitest run`. Lint: `npm run -s lint`. Build: `node node_modules/vite/bin/vite.js build`.

## Design calls (this plan; override if wrong)

- **H-D1, the size unit:** the spec says "4 MB", and Plans 1–7 measured 4 MiB (P3-R7). From now on the budget is **4,000,000 bytes**. World start is 4,116,666 B today. Task 6 moves code to lazy chunks until it is ≤ 4,000,000 B, with a goal of ≤ 3,900,000 B to leave room for rolling by hand. Gzipped size is reported for information only.
- **H-D2, frame time in the head-to-head:** each product runs in an **uncapped** Chromium (`--disable-gpu-vsync --disable-frame-rate-limit`), so the rAF interval measures the whole cost of a frame, CPU plus GPU, for both products the same way. The 60 fps targets are checked in a normal vsync browser.
- **H-D3, "clearly less":** Dicer's p95 frame interval is at least 10% lower than DSN's.
- **H-D4, time to first frame (product-neutral):** measured from the `Roll#toMessage()` call to the first rAF after `diceSoNiceRollStart` for that message. Both products fire that hook. Dicer also reports its own exact `firstFrameMs`.
- **H-D5, back to back:** the next roll starts when the previous message's `diceSoNiceRollComplete` fires. A roll that hasn't completed after 16 s counts as a failure.
- **H-D6, the leak verdict:**
  - Garbage is collected (CDP `HeapProfiler.collectGarbage`) before roll 50 and roll 500, and memory is compared.
  - GPU geometries, textures and programs must be **equal**.
  - The JS heap may grow by at most 2 MiB **and** at most 5%.
  - The in-game benchmark can't force garbage collection, so it skips the soak.
- **H-D7, the in-game benchmark's rolls:** they go through `game.dice3d.showForRoll(roll, game.user, false)`. That means no chat message and nothing sent to other players. It doesn't time the chat path; the harness does that.

## Review Focus

1. **DSN active, Dicer disabled:** the harness's in-page runner must load from `/modules/dicer/src/bench/*.js` without Dicer's bundle. Pinned by Task 3's import-graph test.
2. **A roll that never animates** (an unsupported die, or animations turned off): the runner must time out after 16 s, record a failure, and carry on, never hang. Pinned in Task 3.
3. **The harness dies mid-run** (crash, Ctrl+C): the world's module configuration must be restored. The harness restores in `finally` and keeps a restore file. Pinned in Task 5.
4. **Browsers without `performance.memory`, the GPU timer or long-task support** (Firefox, Safari): the recorder returns `null` for those fields, and the summary prints "n/a", never NaN or a crash. Pinned in Tasks 1 and 3.
5. **A player runs the benchmark during a real roll or a combat:** the in-game benchmark waits until no roll is active, and refuses to start while one is in flight. Pinned in Task 4.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/bench/stats.js` | Percentiles, summaries, linear checks; pure. |
| `src/bench/report.js` | Checks results against G2 targets, the head-to-head verdicts, and the text/markdown summary; pure. |
| `src/bench/recorder.js` | In-page sampling: rAF intervals, long tasks, timing marks, heap; product-neutral. |
| `src/bench/scenarios.js` | Scenario definitions and `runScenario` / `runSuite`, which take a product adapter. |
| `src/bench/benchmark-app.js`, `templates/benchmark.hbs` | The in-game benchmark window (a lazy chunk). |
| `src/render/renderer.js`, `src/api/dice3d.js`, `src/foundry/message-gate.js`, `src/settings.js`, `src/main.js` | Core hooks: frame count, resource counts, first-frame mark, `_debug.canvas`, the `benchmark()` entry, the settings menu. |
| `tests/live/bench.mjs`, `tests/live/world.js` | The live harness and its in-page RPCs. |
| `scripts/bundle-report.mjs` | Source bytes per module in the world-start chunks, from the sourcemap. |
| `docs/bench/README.md`, `README.md`, `docs/live-checks.md` | How to run, what the numbers mean, the estimate caveat. |

---

### Task 1: Stats and report (pure)

**Files:**
- Create: `src/bench/stats.js`, `src/bench/report.js`
- Test: `tests/unit/bench-stats.test.js`, `tests/unit/bench-report.test.js`

**Interfaces:**
- Produces:
  - `summarize(samples: number[]) -> {n, mean, p50, p95, p99, max} | null`. Uses the nearest-rank percentile. An empty or non-finite input gives `null`, and non-finite samples are dropped.
  - `TARGETS`: a frozen object.
    ```js
    { frameP95Ms: 16.7, longTaskMs: 50, firstFrameMs: 50, bigPoolVisibleMs: 100,
      heapGrowthBytes: 2 * 1024 * 1024, heapGrowthRatio: 0.05, clearlyLessRatio: 0.9 }
    ```
  - `checkTargets(result: ScenarioResult) -> Check[]`, where `Check = {id, target, value, pass: boolean | null}`. `pass` is `null` when the value is null (n/a).
  - `compare(dicer: ScenarioResult, dsn: ScenarioResult, {requireClearlyLess}) -> {scenario, dicerP95, dsnP95, ratio, pass}`.
  - `summaryText(suite: SuiteResult) -> string`: plain text, at most 40 lines, starting with a header line (browser, GPU renderer string, tier, Dicer version, profile, "best effort" when not Chromium).
  - `comparisonMarkdown(rows) -> string`.
- `ScenarioResult` = `{scenario, product, profile, rolls, failures, frame: Summary|null, longTasks: {count, maxMs}|null, firstFrame: Summary|null, dicerFirstFrame: Summary|null, heap: {before, after}|null, resources: {before, after}|null, notes: string[]}`.

- [ ] **Step 1: Write the failing tests.**
  - `summarize([1..100])` gives p50 50, p95 95, p99 99 and max 100.
  - `summarize([])` and `summarize([NaN])` give `null`.
  - `checkTargets`:
    - frame p95 16.8 fails `frameP95Ms`, and 16.7 passes.
    - `longTasks.maxMs` 51 fails.
    - A `typical` scenario's `firstFrame.p95` of 50 passes `firstFrameMs`.
    - A `bigPool` scenario's `firstFrame.p95` of 101 fails `bigPoolVisibleMs`.
  - Leak check:
    - heap before 100 MB, after 102.1 MB → fail, because growth is over 2 MiB.
    - heap before 10 MB, after 10.6 MB → fail, because growth is over 5%.
    - resources `{geometries: 40}` → `{geometries: 41}` → fail.
    - Equal resources with small heap growth → pass.
  - `compare`:
    - dicer 9, dsn 10 with `requireClearlyLess` → pass (ratio 0.9).
    - dicer 9.5, dsn 10 with `requireClearlyLess` → fail.
    - dicer 10, dsn 10 without `requireClearlyLess` → pass.
  - `summaryText`:
    - A null `heap` prints `n/a`, and the output never contains "NaN" or "undefined".
    - Profile `firefox` adds "best effort".
- [ ] **Step 2:** Run the tests and see them fail.
- [ ] **Step 3:** Implement. `report.js` imports only `./stats.js`.
- [ ] **Step 4:** Run the tests and see them pass. Lint.
- [ ] **Step 5: Commit** with message `feat(bench): stats, G2 target checks and summaries`.

### Task 2: Core probes (free while idle)

**Files:**
- Modify: `src/render/renderer.js`, `src/api/dice3d.js`, `src/foundry/message-gate.js`
- Test: `tests/unit/renderer.test.js`, `tests/unit/dice3d.test.js`, `tests/unit/message-gate.test.js`

**Interfaces:**
- Produces:
  - `DiceRenderer#frameCount`: a number that increments once per rendered frame.
  - `DiceRenderer#generation`: increments only when the `THREE.WebGLRenderer` or the canvas is replaced. A resize must leave it unchanged.
  - `DiceRenderer#resourceCounts() -> {geometries, textures, programs}`, taken from `glRenderer.info.memory` and `info.programs.length`.
  - The message gate stamps `performance.now()` when it intercepts a message, and records `firstFrameMs = (first rendered frame of that message's throw) − intercept`. It keeps the last 50 entries in a ring keyed by message id.
  - `game.dice3d._debug`, new getters: `frameCount`, `generation`, `resources`, `tier` (the current tier name), `canvas` (the overlay canvas element), `firstFrames` (a copy of the ring as `{[messageId]: ms}`).
- [ ] **Step 1: Write the failing tests.**
  - Three rendered frames give `frameCount` 3.
  - `setArea` with a new size leaves `generation` unchanged.
  - `resourceCounts` reads a stub `info`.
  - Gate: intercept at t=100, first frame at t=130 → `firstFrames[id] === 30`. The ring keeps only the newest 50.
  - **Idle cost:**
    - Constructing the renderer and gate adds no rAF.
    - No `PerformanceObserver` is created: assert by spying on `globalThis.PerformanceObserver`.
    - Before any roll, `frameCount` stays 0 across 1 s of fake timers.
- [ ] **Step 2:** Run the tests and see them fail.
- [ ] **Step 3:** Implement. No new per-frame allocation: the ring is a fixed-size array.
- [ ] **Step 4:** Run the tests and see them pass. Build. Check that the world-start size grows by less than 2 KB.
- [ ] **Step 5: Commit** with message `feat(bench): frame count, resource counts and first-frame marks`.

### Task 3: Recorder and scenarios (product-neutral)

**Files:**
- Create: `src/bench/recorder.js`, `src/bench/scenarios.js`
- Test: `tests/unit/bench-scenarios.test.js`, `tests/unit/bench-imports.test.js`

**Interfaces:**
- Consumes: Task 1's `summarize`.
- Produces:
  - `createRecorder({win = globalThis}) -> {start(), stop() -> {intervals: number[], longTasks: number[], marks}, mark(name)}`.
    - It samples rAF intervals only between `start` and `stop`.
    - Long tasks come from a `PerformanceObserver` of type `longtask` when it is supported; otherwise `longTasks` is `null`.
    - It removes every observer and rAF on `stop`.
  - `SCENARIOS`: a frozen list of `{id, kind, formula, rolls}`:
    - `d20`: `typical`, `1d20`, 1 roll
    - `mixed10`: `typical`, `1d4+2d6+2d8+2d10+2d12+1d20`, 1 roll
    - `pool30`: `bigPool`, `30d6`, 1 roll
    - `burst100`: `burst`, `1d20+2d6`, 100 rolls
    - `soak500`: `soak`, `1d20+2d6`, 500 rolls
    - `resize`: `typical`, `mixed10`'s formula, 1 roll. The window is resized mid-roll.
    - `contextLoss`: `typical`, same, 1 roll. Context lost mid-roll, restored after 500 ms.
    - `hidden`: `typical`, same, 1 roll. The tab is hidden mid-roll for 3 s.
  - The adapter interface, `ProductAdapter`:
    ```js
    {
      product: 'dicer' | 'dice-so-nice',
      roll(formula) -> Promise<{messageId?}>,
      isBusy() -> boolean,
      resources() -> {geometries, textures, programs} | null,
      heap() -> Promise<number | null>,
      dicerFirstFrame(messageId) -> number | null,
      perturb(kind, ms) -> Promise<void>,
    }
    ```
    `perturb` takes `kind` ∈ `resize`, `contextLoss`, `hidden`.
  - `runScenario(scenario, adapter, {hooks = globalThis.Hooks, recorder, timeoutMs = 16000, now}) -> Promise<ScenarioResult>`, following H-D4 and H-D5.
    - On soak, it reads `heap` and `resources` at roll 50 and roll 500.
    - A timeout adds to `failures`, and the run moves on.
  - `runSuite(ids, adapter, opts) -> Promise<SuiteResult>`.
- [ ] **Step 1: Write the failing tests.** Use a fake adapter, a fake `Hooks` event emitter, a fake rAF and a fake clock.
  - `d20`: `firstFrame` is the time from the `roll` call to the first rAF after `diceSoNiceRollStart`.
  - `burst100` starts roll k+1 only after roll k's `diceSoNiceRollComplete`.
  - An adapter whose roll never completes → after `timeoutMs` the result has `failures: 1`, and the suite finishes.
  - `soak500` reads `heap` and `resources` exactly at roll 50 and roll 500.
  - Without `PerformanceObserver`, `longTasks` is `null`.
  - The recorder leaves no rAF pending and no observer connected after `stop`.
  - **Import graph:** parse every `import` in `src/bench/{stats,recorder,scenarios,report}.js`. Each one must be a relative `./` path to one of those four files. Fail on any other specifier, and on any top-level `Hooks`, `game` or `Roll` reference (regex on the top-level lines).
- [ ] **Step 2:** Run the tests and see them fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests and see them pass. Lint.
- [ ] **Step 5: Commit** with message `feat(bench): product-neutral recorder and scenarios`.

### Task 4: In-game benchmark (macro and settings button)

**Files:**
- Create: `src/bench/dicer-adapter.js`, `src/bench/benchmark-app.js`, `templates/benchmark.hbs`
- Modify: `src/api/dice3d.js`, `src/settings.js`, `lang/en.json`, `styles/dicer.css`, `tests/unit/build.test.js` (lazy list)
- Test: `tests/unit/benchmark-app.test.js`, `tests/unit/templates.test.js` (it already checks single roots)

**Interfaces:**
- Consumes: Tasks 1–3, plus Task 2's `_debug` getters.
- Produces:
  - `createDicerAdapter(api) -> ProductAdapter`.
    - `roll` uses `api.showForRoll(new Roll(formula), game.user, false)` (H-D7).
    - `heap` uses `performance.memory?.usedJSHeapSize ?? null`.
    - `resources` uses `api._debug.resources`.
    - `perturb` supports only `resize`: a window `resize` event. It returns without doing anything for the others.
  - `game.dice3d.benchmark({scenarios = ['d20','mixed10','pool30','burst20']} = {}) -> Promise<{suite, text}>`. It is non-enumerable, like the other Dicer extras. `burst20` is `burst100`'s definition with 20 rolls; add it to `SCENARIOS`.
  - A settings menu `benchmark`, label "Run the dice benchmark". It opens `BenchmarkApp` (ApplicationV2 with HandlebarsApplicationMixin). The window has:
    - a Run button,
    - a progress line,
    - the result table,
    - a "Copy summary" button, which copies `summaryText` to the clipboard,
    - a note that nothing is sent anywhere.
  - Everything loads by dynamic `import()` from the menu and from `benchmark()`.
- [ ] **Step 1: Write the failing tests.**
  - `benchmark()` refuses with a localized notice while `api._debug.activeRolls > 0`, and runs nothing.
  - `benchmark()` calls `showForRoll` with `synchronize === false` and never calls `ChatMessage.create`.
  - The result's `text` contains the GPU renderer string and the tier.
  - The template has a single root, and every lang key exists.
  - `build.test.js`: the bench chunk is lazy and the world-start size is unchanged by more than 2 KB.
- [ ] **Step 2:** Run the tests and see them fail.
- [ ] **Step 3:** Implement, following the existing editor visual language and `registerEditorMenu`.
- [ ] **Step 4:** Run the tests and see them pass.
  - Build.
  - Harness screenshot `docs/signoff/ui/benchmark.png`: add a `?app=benchmark` state with a fake finished suite to `dev/editors.js` / `tests/visual/editors.mjs`. Look at the shot and iterate until it's clean.
- [ ] **Step 5: Commit** with message `feat(bench): in-game benchmark window and game.dice3d.benchmark()`.

### Task 5: Live harness and head-to-head

**Files:**
- Create: `tests/live/bench.mjs`
- Modify: `tests/live/world.js`, `package.json` (script `test:live:bench`), `.gitignore` (`artifacts/bench/`)
- Test: `tests/unit/bench-harness.test.js` (the pure helpers exported from `tests/live/bench-lib.mjs`)

**Interfaces:**
- Consumes: Tasks 1 and 3, imported in the page from `/modules/dicer/src/bench/*.js`. Uses the existing `login()` pattern and the env vars `DICER_FOUNDRY_URL`, `DICER_GM_USER`, `DICER_GM_PASSWORD` from `tests/live/smoke.mjs`.
- Produces:
  - `world.js` RPCs:
    - `benchProduct() -> 'dicer' | 'dice-so-nice' | null`
    - `benchSettings() -> {product, world: {...}}`: the snapshot of that product's world settings, recorded in the report.
    - `setDiceModule(id)`: writes `core.moduleConfiguration` with exactly one of `dicer` / `dice-so-nice` enabled. The caller reloads.
    - `benchRun({ids, profile})`: builds the page adapter for the active product and returns a `SuiteResult`.
  - In-page adapters:
    - **Dicer:** the Task 4 adapter, but `roll` uses `new Roll(f).toMessage()`.
    - **DSN:** `roll` is the same. `resources` reads `game.dice3d.box?.renderer?.info` when present, else `null`. `dicerFirstFrame` gives `null`.
    - **`perturb`:** `resize` uses Playwright `page.setViewportSize` through a node-side callback. `contextLoss` uses `WEBGL_lose_context` on the product's canvas (Dicer `_debug.canvas`, DSN `game.dice3d.box.renderer.domElement`). `hidden` opens and focuses a second page for 3 s.
    - **Heap:** comes from node-side CDP: `HeapProfiler.collectGarbage`, then `Runtime.getHeapUsage`.
  - `bench-lib.mjs` (pure):
    - `profiles()`: returns `pc` and `throttled` (CPU 4×, viewport 1920×1080, `deviceScaleFactor` 1, Dicer `quality` = `medium`), each in a `vsync` and an `uncapped` mode (H-D2).
    - `matrix()`, the run order:
      - Dicer pc-vsync: every scenario, including `soak500`, `resize`, `contextLoss` and `hidden`.
      - Dicer throttled-vsync: `d20`, `mixed10`, `pool30`.
      - For each product, at its defaults, in pc-uncapped and throttled-uncapped: `d20`, `mixed10`, `pool30`, `burst100`.
      - DSN effects-off vs Dicer `quality` = `low`, in pc-uncapped: the same four.
    - `dsnEffectsOff(settingsList) -> {[key]: value}`: picks DSN's client settings by key pattern from the runtime `game.settings.settings` list. It turns off shadows, glow, bump maps, antialiasing, sounds, and anything matching `/shadow|glow|bump|antialias|sound|effect|immersive/i` that is Boolean. It records the chosen keys in the report.
    - `verdicts(reports) -> rows` uses Task 1's `checkTargets` and `compare`, with `requireClearlyLess` only for pc defaults.
    - `restoreFile`: `artifacts/bench/restore.json` holds the original `core.moduleConfiguration`.
  - Output:
    - `artifacts/bench/<ISO date>/<product>-<profile>-<mode>.json`
    - `artifacts/bench/<ISO date>/summary.md`: target checks, then the head-to-head table.
    - Exit code 1 when any check fails.
- [ ] **Step 1: Write the failing tests** (for `bench-lib.mjs`):
  - `matrix()` contains every pairing listed above, and nothing else.
  - `dsnEffectsOff` on a fake list picks `shadowQuality`-like and `glow` Boolean keys and leaves unrelated keys alone.
  - `verdicts` marks a pc-defaults row with dicer 9.5 / dsn 10 as a failure, and a throttled row with the same numbers as a pass.
  - Restore: when `restore.json` exists at startup, the harness restores it first (the restore decision is a pure helper).
- [ ] **Step 2:** Run the tests and see them fail.
- [ ] **Step 3:** Implement.
  - Every run starts in a fresh browser context, so client settings are at their defaults.
  - The module configuration is restored in `finally`, and `restore.json` is deleted after a successful restore.
- [ ] **Step 4:** Run the unit tests, lint, and `node tests/live/bench.mjs --dry-run`. The dry run prints the matrix and exits 0 without a browser.
- [ ] **Step 5: Commit** with message `test(bench): live harness and DSN head-to-head`.

### Task 6: World start under 4,000,000 bytes (H-D1)

**Files:**
- Create: `scripts/bundle-report.mjs`
- Modify: `vite.config.js` (sourcemaps only when `BUNDLE_REPORT=1`), `tests/unit/build.test.js`, plus the `src/` entry points whose code moves to lazy chunks
- Test: `tests/unit/build.test.js`

**Interfaces:**
- Produces:
  - `node scripts/bundle-report.mjs`: builds with sourcemaps and prints the source bytes per `src/` file in each world-start chunk, largest first, plus the gzip size of each world-start file. It uses no new dependencies; Node's `zlib` handles gzip.
  - The `build.test.js` budget: `BUDGET = 4_000_000` (it was `4 * 1024 * 1024`). The test also logs the gzip total.
- [ ] **Step 1:** Change `BUDGET` to `4_000_000` and run `build.test.js`. Expected: FAIL at about 4,116,666 B.
- [ ] **Step 2:** Run the bundle report. Move code that world start doesn't need behind dynamic `import()`, largest first. Candidates to check: DSN compatibility classes only used by `api.js` importers, settings migration, the trigger rule engine's editor-only parts, damage presets for systems not in use, and roll-area editing. Each move needs a test that the feature still loads on first use; reuse the existing feature tests and add one per moved module where none exists.
- [ ] **Step 3:** Repeat until world start is ≤ 4,000,000 B. Stop moving code at ≤ 3,900,000 B. If 4,000,000 B can't be reached without moving code the first roll needs, stop and report the numbers. Don't lazy-load anything on the first-roll path: that breaks the 50 ms first-frame target.
- [ ] **Step 4:** Full suite, lint, build.
- [ ] **Step 5: Commit** with message `perf(build): world start under 4,000,000 bytes`.

### Task 7: Known performance debts

**Files:**
- Modify: `src/render/quality-controller.js`, `src/main.js`, `tests/unit/sim.test.js` (where the deflaked d20/d6 sim guard lives)
- Test: `tests/unit/quality-controller.test.js`, `tests/unit/warmup.test.js`

**Interfaces:**
- Consumes: the existing quality controller, warm-up (`acquireWarmup`) and `getAppearance` in `main.js`.
- **Adaptive drop (Plan 2, parked P2-R13):** when a GPU timer exists, a roll whose GPU p95 is over the tier's frame budget drops a tier on its own. This no longer depends on the interval baseline, so a machine that is GPU-bound from its first roll still drops.
- **Warm-up after a GM push (Plan 7, parked M-2):**
  - `main.js` re-runs warm-up when the current user's `dicer.appearance` flag changes (`updateUser` hook, own user only) or when `worldDefaultTheme` / `lockPlayerLooks` change.
  - Re-runs are debounced to 500 ms.
- **Absolute physics budget (Plan 2 note: "Plan 8's benchmark harness must own the absolute physics budget"):**
  - Add a unit guard: simulating `30d6` to rest takes ≤ 250 ms in node.
  - Keep the relative d20/d6 guard.
- [ ] **Step 1: Write the failing tests.**
  - A GPU p95 of 20 ms on a 16.7 ms budget from the first roll → a drop, with the notice shown once.
  - Without a timer → the existing behaviour is unchanged.
  - Two flag updates within 500 ms → one warm-up.
  - An update to another user's flag → no warm-up.
  - The `30d6` guard.
- [ ] **Step 2:** Run the tests and see them fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Full suite, lint, build.
- [ ] **Step 5: Commit** with message `perf: GPU-bound tier drop, warm-up after push, physics budget`.

### Task 8: Docs and owner run

**Files:**
- Create: `docs/bench/README.md`
- Modify: `README.md` (a "Performance and benchmark" section), `docs/live-checks.md`

**Interfaces:**
- `docs/bench/README.md` covers:
  - the prerequisites: a world with pf2e or dnd5e, both modules installed, a GM user, and the env vars;
  - `npm run test:live:bench`, and how long a full run takes;
  - what each profile and mode means;
  - how to read `summary.md`;
  - a statement that the throttled numbers are **estimates** (spec G2);
  - how to recover with `restore.json`.
- README section:
  - the in-game benchmark (the settings button and `game.dice3d.benchmark()`);
  - what the summary contains;
  - that nothing is uploaded;
  - the "best effort" note for Firefox and Safari;
  - the 4 MB world-start figure, with the gzip size alongside;
  - a request for Iris Xe and iPad testers to paste their summary.
- `docs/live-checks.md`, new checks:
  - run the in-game benchmark as a player;
  - Copy summary works;
  - the benchmark refuses during a roll;
  - `npm run test:live:bench` restores the module configuration when stopped with Ctrl+C.
- [ ] **Step 1:** Write the docs. Every setting, label and command they name must exist in `lang/en.json`, `package.json` or `src/`.
- [ ] **Step 2:** Full suite, lint, build, and the budget check.
- [ ] **Step 3: Commit** with message `docs: benchmark, performance and hardening live checks`.

---

## After this plan (owner)

Run `npm run test:live:bench` on the gaming PC. Each failing row in `summary.md` becomes a tuning fix, planned as one small follow-up round with its own review. Hardening finishes only when every G2 row passes in both profiles.

## Not in this plan

- Real Iris Xe and iPad numbers: testers run the in-game benchmark before a public 1.0.
- Cross-browser determinism (a v2 item).
- Atlas mipmaps and the linger re-render, deferred from Plan 2: these are visual polish, picked up only if the harness shows a cost.
- Rolling by hand and the dice pet (roadmap rows 8 and 8b).
