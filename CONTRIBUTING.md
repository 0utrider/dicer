# Contributing to Dicer

This guide covers building Dicer, the review pages, the test suites (unit, visual and live), performance checks and the conventions the repository enforces. User documentation lives in the wiki.

## Setup

You need Node.js (CI uses Node 22) and a local Foundry VTT v14 install for the live tests.

```bash
npm i
```

`npm i` also runs the `prepare` script, which installs the git hooks (see [Git hooks](#git-hooks)).

## Build

```bash
npm run build
```

Vite builds `src/main.js` into `dist/dicer.js`, which `module.json` loads. The physics worker, the Rapier wasm and the lazy chunks are emitted next to it. `api.js` is not bundled: it ships beside `module.json` and is imported at runtime.

To try the build, put the repository (or a link to it) in Foundry's `Data/modules/dicer` folder and enable the module in a world. **Dice So Nice must be disabled.** If it is active, Dicer registers nothing and shows the GM a one-time notice.

`dist/` is git-ignored; the release workflow builds it.

## Git hooks

Husky installs a pre-commit hook (`.husky/pre-commit`) that runs:

```bash
npm run lint && npm test
```

A commit fails when lint or any unit test fails. The unit tests include the build test (below), which runs a full Vite build, so a commit takes a little while.

## Tests and checks

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests (Vitest, `tests/**/*.test.js`). |
| `npm run test:watch` | Vitest in watch mode. |
| `npm run lint` | ESLint. `npm run lint:fix` fixes what it can. |
| `npm run format:check` | Prettier check. `npm run format` rewrites files. |
| `npm run test:fairness` | Throws 100,000 dice per shape through the real physics and runs a chi-square test on the face counts (see below). |

CI (`.github/workflows/main.yml`) runs on every push and pull request to `main`: it validates `module.json`, lints, runs the unit tests and builds.

### The build and size test

`tests/unit/build.test.js` builds the module and checks the output. Contributors hit it most often when a change moves code into the world-start bundle:

- **Lazy chunks.** Editors, the theme browser, the effects library, pets, rolling by hand, the JB2A player, the chat tray, the benchmark, the model loader, the DSN migration and similar code must stay in their own chunks, out of `dist/dicer.js`. The test checks each expected chunk exists. The list of lazy chunk names is in `build/world-start.js` (`LAZY`); a new lazy chunk must be added there and to the test.
- **World-start budget.** The world-start download (non-lazy `dist/` files plus `assets/fonts/digits.png`, `assets/fonts/digits.json` and `api.js`) must stay under 4 MiB (`BUDGET` in `build/world-start.js`). Most of it is the physics wasm, which has no smaller build.
- **Growth ratchet.** A second test caps world-start growth over a recorded base. The comment above it records each approved increase. If your change trips it, prefer moving code into a lazy chunk; raising the cap is a maintainer decision.
- It also checks that `api.js` stays out of the bundle, that no sourcemaps ship and that shaders are stripped in the build.

To see which source files take up the world-start bytes:

```bash
node scripts/bundle-report.mjs [--top N] [--out DIR]
```

It builds with sourcemaps into a scratch folder and prints the minified bytes each source file contributes, plus the raw and gzip size of every world-start file.

## Dev preview pages

```bash
npm run dev
```

Starts the Vite dev server and opens `/dev/preview.html`. No Foundry is needed. On the preview page, pick a body (opaque, metal, resin) and press **Throw** to throw one of each die type at a random target; the value each die actually shows is printed under the canvas next to its target.

Other review pages on the same server:

| Page | What it shows |
| --- | --- |
| `/dev/effects.html` | Every effect, damage theme and sound, with buttons to audition the recorded dice hits by material, surface and loudness. |
| `/dev/themes.html` | All built-in themes; throw each one with its celebration. |
| `/dev/areas.html` | The roll area presets and two throws into different areas at once. |
| `/dev/hand.html` | Rolling by hand: the throw overlay, **Throw for me**, a cocked die, a d16 read with its glow, a throw at a resting pet, and the last throw replayed from its encoded form at half the area size. |
| `/dev/looks.html` | The look gallery (every dice shader). |
| `/dev/insides.html` | The living insides. |
| `/dev/pets.html` | The dice pets. |
| `/dev/jb2a.html` | The built-in and JB2A effects. |
| `/dev/models.html` | GLB model orientation. |
| `/dev/editors.html` | The editor windows with sample data (needs Foundry's stylesheet from a local install). |

## Visual tests

These drive the review pages in Playwright Chromium on real WebGL and save screenshots. Install the browser once with `npx playwright install chromium`. They start their own dev server.

| Command | Checks |
| --- | --- |
| `npm run test:visual` | Every dice shader on every quality tier (`dev/looks.html`): no shader errors, no blank cells, bounded program count. |
| `npm run test:visual:themes` | Every built-in theme thumbnail renders. |
| `npm run test:visual:editors` | The editor windows. |
| `npm run test:visual:fx` | The built-in effects per id, on dark and light backdrops. |
| `npm run test:visual:fx-perf` | Main-thread cost of each built-in effect, CPU throttled. |
| `npm run test:visual:pets` | The dice pets. |
| `npm run test:visual:insides` | Each living inside. |
| `npm run test:visual:insides-perf` | Cost of moving insides against frozen ones. |
| `npm run test:visual:edges` | Edge-strip close-ups. |
| `npm run test:visual:trails` | Elemental trails. |

`node tests/visual/hand.mjs` drives `dev/hand.html` with a real mouse and saves screenshots.

Common variables: `DICER_VISUAL_PORT` (dev server port), `DICER_VISUAL_HEADED=1` (watch the browser), `DICER_VISUAL_ARGS` (replace the Chromium flags, for example `--use-angle=swiftshader` to force software rendering). Each script's header comment lists its own options and output paths.

## Live tests

The live tests run Playwright (Chromium) against your local Foundry. Prerequisites:

1. `npm run build`
2. Foundry running, a world launched with Dicer enabled and Dice So Nice disabled.
3. A GM account in that world (and a player account for every test except the smoke test). Install the browser once with `npx playwright install chromium`.

Credentials come only from the environment; nothing is stored in the repository.

| Variable | Meaning |
| --- | --- |
| `DICER_FOUNDRY_URL` | Foundry URL, default `http://localhost:30000` |
| `DICER_GM_USER` | GM user name (required) |
| `DICER_GM_PASSWORD` | GM password (required) |
| `DICER_PLAYER_USER` | Player user name (compat, effects, areas, hand) |
| `DICER_PLAYER_PASSWORD` | Player password (compat, effects, areas, hand) |
| `DICER_PLAYER2_USER`, `DICER_PLAYER2_PASSWORD` | Optional second player (hand) |

```bash
DICER_GM_USER=Gamemaster DICER_GM_PASSWORD=secret npm run test:live
```

PowerShell:

```powershell
$env:DICER_GM_USER='Gamemaster'; $env:DICER_GM_PASSWORD='secret'; npm run test:live
```

Each test writes a JSON report under `artifacts/live/` (git-ignored). Missing variables or an unreachable Foundry exit non-zero with a one-line message.

### Smoke test

`npm run test:live` rolls `1d20`, `3d6+2`, `1d100` and `1d7`, prints `smoke: 4/4 passed`, exits 0 on success and writes `artifacts/live/smoke.json`.

### Compatibility test

`npm run test:live:compat` logs a GM and a player in (two browser contexts) and checks that:

1. a public roll animates on both clients and fires `diceSoNiceRollComplete` once on each;
2. a GM whisper roll reaches the player as a card with its content hidden (Foundry delivers whispered roll messages to everyone): the card shows no result and the player draws no dice (ghost dice off; with them on, only ghost dice), while the GM sees dice;
3. a blind player roll shows the player ghost dice or none, never real ones (read through `game.dice3d._debug.lastRollViews`, which holds view kinds and never values);
4. `showForRoll(roll, game.user, true)` from the GM animates on the player's client;
5. an initiative roll hides the tracker value until the reveal.

Scenario 5 needs an active scene. It prints `compat: N/N passed` and writes `artifacts/live/compat.json`. It changes `showGhostDice` while it runs and restores it at the end. It creates and deletes one temporary combat; creating it may change which combat is active. It leaves its chat messages in the world.

### Effects test

`npm run test:live:effects` rolls a forced natural 20 as the GM and reads the counters in `game.dice3d._debug` (`fxPlays` and `resultSounds`: names and counts only). It checks that:

1. a public roll plays `celebrate` and the `fanfare` sound on the GM client;
2. a GM blind roll plays both for the GM and neither for the player (who sees nothing); a player blind roll with ghost dice on plays both for the GM and neither on the player, whose client draws a ghost die;
3. a public roll plays both for the player when **Show other players' effects** is on;
4. with that setting off, the player gets neither.

It prints `effects: N/N passed`, writes `artifacts/live/effects.json` and restores the settings it changed. It leaves its chat messages in the world.

### Areas test

`npm run test:live:areas` has the GM give the player the `corner` area, then the player rolls. It reads `game.dice3d._debug.lastRollArea` on both clients: the settled die centres, the area the throw used and the stage. The area a throw uses is the player's resolved rectangle (`game.dice3d.rollAreas.rect`) grown to hold the dice (`CAPACITY_PER_DIE` in `src/areas/area-model.js`), so the test checks that this grown area contains the resolved rectangle and lies inside the stage, and that every settled die centre lies inside it. It then turns **GM private corner** on, runs the same check for a GM blind roll against the GM corner on the GM client, and checks that the player's client threw nothing.

It sets each client's **Roll area size** to 1 while it runs, prints `areas: N/N passed`, writes `artifacts/live/areas.json` and restores the settings it changed.

### Hand test

`npm run test:live:hand` turns the player's **Roll by hand** to **Always**, makes the player roll a public `1d20` through `Roll#toMessage` and presses **Throw for me** by script. It checks that:

1. the GM receives one `hand` payload and the throw's final frame reads the same value as the card;
2. a hand roll whispered to the GM never reaches the second player's socket handler (a counter on that client), when there is a second player;
3. a thrower who does not throw falls back after **Hand roll time limit** (set to 10 seconds while it runs) and the card is marked.

It prints `hand: N/N passed`, writes `artifacts/live/hand.json`, restores the settings it changed and deletes the messages it made.

### Checks done by hand

Some behaviour cannot be scripted and is checked by hand in a real world. For example, a hand throw at the player's resting pet should splat it on the GM's screen too.

## Fairness

```bash
npm run test:fairness
```

Throws 100,000 free one-die throws per shape through the real Rapier simulation, reads each settled face and runs a chi-square test on the face counts. It exits non-zero when any shape has p <= 0.01. A fast regression version runs in the unit tests (`tests/unit/fairness.test.js`).

## Performance and benchmark

Dicer must stay cheap: no render loop while no dice are on screen, and heavy code loads lazily (see [The build and size test](#the-build-and-size-test)).

### In-game benchmark

Press **Run the dice benchmark** in Dicer's settings, or run `game.dice3d.benchmark()` in the console. It throws four scenarios on your screen only: `d20`, `mixed10`, `pool30` and `burst20`. `pool30` is capped by the world **Maximum dice per message** setting (`maxDice`), and the summary notes when it was.

- **What it reports:** per scenario, the 95th percentile frame time, the longest task, the first-frame time, heap growth and failed rolls, with a pass or fail against the targets, plus the browser and GPU. On a display that refreshes below 60 Hz the frame checks show n/a and the summary says so. When Dicer lowers its quality tier during a scenario, the summary notes it. **Copy summary** puts it on the clipboard as plain text.
- **Privacy:** it creates no chat messages and uploads nothing.
- **Limits:** it refuses while dice are rolling or another run is going, and shows a notice when 3D dice are disabled. Firefox and Safari are best effort.

### Live benchmark against Dice So Nice

```bash
npm run test:live:bench
```

Runs the benchmark scenarios against your local Foundry, with Dicer and with Dice So Nice, and writes `artifacts/bench/<date>/` (one JSON per run and a `summary.md`). It uses `DICER_FOUNDRY_URL`, `DICER_GM_USER` and `DICER_GM_PASSWORD`. `DICER_BENCH_HEADLESS=1` runs headless (the GPU may fall back to software, so numbers are then not representative). `--dry-run` prints the matrix without opening a browser.

Two hand scenarios, `handReplay10` and `handSoak100`, replay a recorded throw (`tests/fixtures/trajectory-mixed10.json`, recorded with `node scripts/hand-fixture.mjs`). They are judged on the same targets but only Dicer runs them.

## Other scripts

- `npm run build:sdf [-- <font file> <out dir> <name>]` regenerates an MSDF digit atlas (by default `assets/fonts/digits.png` and `digits.json`). The outputs are committed, so a normal build never needs it.

## Code style

- Prettier: 100 columns, two-space indent, single quotes, trailing commas (`.prettierrc.json`).
- ESLint config: `eslint.config.mjs`.
- Third-party input (other modules' calls into `game.dice3d`, presets, colorsets) is untrusted: a malformed call warns once and returns normally, never throwing into the caller.
- Keep new heavy code in lazy chunks so world start does not grow.

## Releases

Releases are made by the maintainer. Publishing a GitHub release runs the workflow, which injects the release URLs into `module.json`, builds `dist/`, zips the files Foundry loads and attaches `module.json` and `module.zip` to the release. The tag must match the `module.json` version.
