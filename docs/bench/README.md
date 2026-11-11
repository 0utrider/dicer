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
- Nobody else playing in the world while it runs. The harness changes world settings and restores them afterwards (see Recovery).

## Running

```
npm run test:live:bench              # the full matrix
npm run test:live:bench -- --dry-run # print the matrix, launch nothing, change nothing
```

A full run goes through 8 runs, including a 500-roll soak, a context-loss check and a hidden-tab check. Expect tens of minutes; this is an estimate, not a measured time. The process exits 0 when every check passes and 1 when any check fails or a run errors. Rows marked n/a do not fail the run.

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

The head-to-head pairs two comparisons:

- Dicer defaults against DSN defaults.
- DSN with its effects turned off against Dicer quality `low`.

Reports are named `<product>-<profile>-<mode>[-<variant>]`, for example `dicer-pc-uncapped-low` or `dice-so-nice-pc-uncapped-effectsOff`.

## Output

Everything goes to `artifacts/bench/<date>/` (ignored by git):

- one `*.json` per run, with the raw measurements and, for the DSN effects-off run, the keys that were set (`dsnKeys`, `dsnFailed`);
- `summary.md`, the file to read.

### Reading summary.md

- **Runs**: the browser, GPU, tier and Dicer version of each run. Check the GPU column first: a software renderer means the numbers are not representative.
- **G2 target checks**: one row per run, scenario and check, with the target, the measured value and Pass or Fail. Each failing row is something to tune. The checks include frame p95 (16.7 ms), longest task (50 ms), first frame (50 ms), big pool visible (100 ms), heap growth (2 MiB or 5%), no failed rolls, and no renderer rebuild on resize.
- **Head-to-head**: the frame p95 of Dicer and DSN per scenario, their ratio, the limit, and the failed rolls of each. For the pc defaults pairing, Dicer must be clearly less than DSN (ratio at most 0.9).
- **DSN effects-off user flag**: the DSN settings the harness wrote, read back. If an effect setting is missing here, DSN ran with that effect on and the pairing is less fair.
- The last line counts failed rows, n/a rows and run errors.

The throttled numbers are **estimates** of a low-end machine, not measurements of one. CPU throttling slows JavaScript, not the GPU, so use them to spot a trend and not as a promise for a particular device.

## Recovery

Before it changes anything the harness saves the world state to `artifacts/bench/restore.json`:

- the enable state of the `dicer` and `dice-so-nice` modules;
- Dicer **Maximum dice per message** (`maxDice`, set to 30 during runs, so the 30-dice pool is not capped);
- DSN `maxDiceNumber` (set to 35 during runs);
- the GM's DSN user flag `dice-so-nice.settings` (rewritten for the effects-off run, unset for the DSN defaults runs).

The state is restored when the run ends, on the first Ctrl+C, and again at the next start if a run crashed and left `restore.json` behind. The file is deleted only after a successful restore. A second Ctrl+C exits at once and keeps `restore.json`; start the harness again to restore. If `restore.json` is damaged the harness stops and says so; check the module list in Foundry's setup screen and remove the file by hand.
