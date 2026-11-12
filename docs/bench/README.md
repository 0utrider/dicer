# Dicer live benchmark

`npm run test:live:bench` runs Dicer and Dice So Nice (DSN 6.4.5) through the same dice scenarios in a real browser against a running local Foundry. It checks Dicer against the G2 performance targets and against DSN. The pure decisions live in `tests/live/bench-lib.mjs` and are unit-tested; the browser driver is `tests/live/bench.mjs`.

## Prerequisites

- A running local Foundry v14 world with pf2e or dnd5e.
- Both modules installed: `dicer` and `dice-so-nice`. The harness switches between them by changing the module configuration, so you do not enable either by hand.
- A GM user with a password, and these environment variables (the same account the other live tests use):
  - `DICER_FOUNDRY_URL` (default `http://localhost:30000`)
  - `DICER_GM_USER`
  - `DICER_GM_PASSWORD`
- A headed browser on a real GPU. The hidden-tab scenario needs a visible window. `DICER_BENCH_HEADLESS=1` runs headless, but the GPU may fall back to software and the numbers are then not representative.
- Nobody else playing in the world while it runs, and the GM typing no chat messages. The harness changes world settings and restores them afterwards, and deletes the chat messages it rolls (see Recovery).
- A scene loaded in the world. G2 measures with a Foundry scene on screen; `summary.md` warns when a run had none.

## Running

```
npm run test:live:bench              # the full matrix
npm run test:live:bench -- --dry-run # print the matrix, launch nothing, change nothing
npm run test:live:bench -- --quick   # a shorter partial run, for checking a fix
npm run test:live:bench -- --only dice-so-nice   # only the runs whose name contains this
npm run test:live:bench -- --quick --profile --only throttled-uncapped   # where the frame time goes
```

`--quick` skips the throttled runs, unless an `--only` term containing "throttled" names them (`--quick --only throttled-uncapped` is the low-end head-to-head with the quick roll counts), and makes fewer rolls where the count only buys precision: the soak makes 200 rolls (heap and resources at roll 50 and roll 200, still enough to show a leak) and `burst100` makes 30. `--only` takes one or more comma-separated parts of run names (see Profiles and modes for the names); a whole run name selects only that run (`dicer-pc-uncapped` does not also pick `dicer-pc-uncapped-low`). For example `--only dicer-pc-vsync` or `--only dice-so-nice,dicer-pc-uncapped`. The two combine, and `--dry-run` shows what either one would run. `summary.md` of a partial run says so in its first line: the full run is the one that decides.

`--profile` records a CPU profile (CDP sampling profiler, 200 µs) of each run's `burst100` and writes it next to the report as `<run>.cpuprofile`, which opens in the Chrome DevTools Performance panel or speedscope. `summary.md` gets a "CPU profile (self time)" section: per run the sampled total split into dicer, dice-so-nice, foundry, system, other modules, gc and browser, then the hottest functions. The profiler adds some overhead, so a profiled `burst100` frame time is a little high; compare two profiled runs with each other, not with an unprofiled one. The same scenario also counts WebGL work per canvas (the dice canvas, Foundry's board, anything else): `summary.md` gets a "GPU work per frame" table with each canvas's size and, per animation frame, its draw calls, triangles, render-target binds (extra passes such as shadows or transmission) and clears.

A full run goes through 8 runs, including a 500-roll soak, a context-loss check and a hidden-tab check. Expect tens of minutes; this is an estimate, not a measured time. The terminal prints a timestamped line as each run's warm-up roll and each scenario starts and ends, so a long run visibly progresses. The module switch gets 60 s; a Foundry dialog that blocks it stops the run with a message instead of hanging it. The process exits 0 when every check passes and 1 when any check fails or a run errors. Rows marked n/a do not fail the run. It exits 2 before starting when the credentials are missing, Foundry cannot be reached or `restore.json` is damaged.

What each run covers:

- Dicer, `pc` `vsync`: every scenario, including the 500-roll soak, resize, context loss and hidden tab. Context loss rolls twice: the first roll loses the WebGL context mid-roll, and once the context is restored (at most 3 s) a second roll must draw.
- Dicer, `throttled` `vsync`: `d20`, `mixed10`, `pool30`.
- Each product in `pc` and `throttled` `uncapped`, and the effects-off pairing: `d20`, `mixed10`, `pool30`, `burst100`.

Before its scenarios each run makes one unrecorded warm-up roll of every die type (`1d4+1d6+1d8+1d10+1d12+1d20`), so neither product pays its first-roll setup inside a measured scenario. Every bench roll speaks as the alias "Dice benchmark", never a token or character: DSN skips an NPC speaker's roll when its hide-NPC-rolls setting is on. Before each scenario the harness forces a full garbage collection, so garbage left by page load is not collected inside the next measurement.

A chat roll that completes without `diceSoNiceRollStart` was not animated: it counts as a failed roll, and the scenario notes how many. So does a roll over less than 300 ms after the roll call: DSN on a hidden page fires its start hook, then completes at once. If the warm-up roll was not animated, `summary.md` warns and lists the settings that can cause it.

DSN runs turn DSN's world setting "immediately display chat messages" off and put it back afterwards, like `maxDiceNumber`. With it on, DSN fires `diceSoNiceRollComplete` before the dice land, so the next roll started at once and nothing was measured.

Each adaptive quality drop during a Dicer scenario is recorded in that result's `qualityDrops`: when it happened, the tiers, which check fired (the GPU timer's GPU p95 / CPU median, or the frame EMA), and the numbers behind it. `summary.md` lists each one as a note. A scenario whose tier changed reports its heap growth and resource counts as n/a, because the new tier rebuilds textures and materials.

**Keep the benchmark window visible for the whole run.** A minimized or hidden page gets about one frame a second, and DSN skips its animations there. A scenario during which the page was hidden at any point counts one failure, has `pageHidden: true`, and `summary.md` warns about it. The `hidden` scenario hides the page on purpose and is exempt.

## Profiles and modes

| Profile     | What it simulates                                                           |
| ----------- | --------------------------------------------------------------------------- |
| `pc`        | The machine as it is: no CPU throttle, 1920x1080, device pixel ratio 1.     |
| `throttled` | A low-end machine: CPU 4x slower, 1920x1080, DPR 1, Dicer quality `medium`. |

| Mode       | What it measures                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------ |
| `vsync`    | The browser at its normal refresh rate. The frame, long-task and first-frame targets are checked here.       |
| `uncapped` | The browser with the frame cap removed. Used for the head-to-head: how much work each module does per frame. |

Uncapped intervals are not a 60 fps measure, so the G2 targets are not applied to them.

The head-to-head makes three comparisons:

- Dicer defaults against DSN defaults on `pc`: Dicer must be clearly faster (frame p95 ratio at most 0.9).
- Dicer defaults against DSN defaults on `throttled`: Dicer must not be slower.
- DSN with its effects turned off against Dicer quality `low`, on `pc`: Dicer must not be slower.

Reports are named `<product>-<profile>-<mode>[-<variant>]`, for example `dicer-pc-uncapped-low` or `dice-so-nice-pc-uncapped-effectsOff`.

## Output

Everything goes to `artifacts/bench/<timestamp>/`, for example `artifacts/bench/2026-11-11T12-00-00Z/` (ignored by git):

- one `*.json` per run, with the raw measurements (`suite`), the product's settings, page errors and, for DSN runs, `dsnFlag`: the DSN user flag read back after the harness wrote it;
- `summary.md`, the file to read.

### Reading summary.md

- **Runs**: the browser, GPU, tier and Dicer version of each run. Check the GPU column first: a software renderer means the numbers are not representative. The tier is the one the run started at, shown as `ultra -> low` when an adaptive drop changed it during the run.
- **G2 target checks**: one row per run, scenario and check, with the target, the measured value, Pass or Fail, and a note. Each failing row is something to tune. The checks include frame p95 (16.7 ms), longest task (50 ms), first frame (50 ms), big pool visible (100 ms), heap growth (at most 2 MiB and at most 5%), GPU geometries, textures and programs unchanged over the soak, and no failed rolls.
  - First frame and big pool visible are judged on `dicerFirstFrame`: from Dicer's message gate catching the chat message to the first drawn frame (G2's "message arriving"). The note names that measure and shows the other one, `firstFrame` (from the roll call to the first frame), which is the measure the head-to-head with DSN can share. When a run has no gate timing, `firstFrame` is judged and the note says so.
  - The soak deletes its chat messages every 50 rolls, so the chat log does not count as heap growth. Heap and GPU resources are read at roll 50 and roll 500. When the tier changed during the soak, the resources check is n/a: a tier change swaps programs and textures.
  - Each result's `longTasks.top` in the JSON lists the three longest tasks with `at`, their start in ms after recording began, and `firstRollAt`, when roll 1 was made. Use them to tell a stall inside a roll from one before it.
  - Resize, context loss and hidden tab are disturbances, not frame measurements: they are checked for failed rolls only, plus no renderer rebuild (resize and context loss) and `recovered` (context loss: after the restore the second roll drew on a live context).
- **Head-to-head**: the frame p95 of Dicer and DSN per scenario, their ratio, the limit, and the failed rolls of each. For the pc defaults pairing, Dicer must be clearly less than DSN (ratio at most 0.9). When either side has a failed roll the ratio is still shown, but the result is n/a: the two sides did not measure the same work.
- **DSN effects-off user flag**: the DSN settings the harness wrote, read back. If an effect setting is missing here, DSN ran with that effect on and the pairing is less fair.
- The last line counts failed rows, n/a rows and run errors.

The throttled numbers are **estimates** of a low-end machine, not measurements of one. CPU throttling slows JavaScript, not the GPU, so use them to spot a trend and not as a promise for a particular device.

## Recovery

Before it changes anything the harness saves the world state to `artifacts/bench/restore.json`:

- the enable state of the `dicer` and `dice-so-nice` modules;
- Dicer **Maximum dice per message** (`maxDice`, set to 30 during runs, so the 30-dice pool is not capped);
- DSN `maxDiceNumber` (set to 35 during runs);
- the GM's DSN user flag `dice-so-nice.settings` (rewritten for the effects-off run, unset for the DSN defaults runs);
- `runStartedAt`, the time the run started, before its first roll;
- `messageIds`, the id of every chat message the run creates, written to the file as each roll is made.

Each scenario, and the warm-up roll, deletes the chat messages it created when it ends. When the run ends normally, or on the first Ctrl+C, the restore deletes the tracked `messageIds` that are still there, and nothing else: chat the GM types during a normal run is safe.

Only when a crashed run left `restore.json` behind does the restore at the next start go further. It deletes the saved `messageIds` first. Then, as a fallback for ids the crash kept from being saved, it deletes every chat message the GM wrote since `runStartedAt`. That fallback also deletes a message the GM typed in that world during the crashed run, which is one more reason nobody should play during a run.

The state is restored when the run ends, on the first Ctrl+C, and again at the next start if a run crashed and left `restore.json` behind. The file is deleted only after a successful restore. A second Ctrl+C exits at once and keeps `restore.json`; start the harness again to restore. If `restore.json` is damaged the harness stops and says so; check the module list in Foundry's setup screen and remove the file by hand.
