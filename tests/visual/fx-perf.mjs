// Perf probe for the built-in effects: with the CPU throttled 4x (CDP Emulation.setCPUThrottlingRate)
// on dev/jb2a.html?jb2a=off, plays each id 7 times (after one warm-up) from the fixed ROLL seed and records
// the main-thread work of each requestAnimationFrame callback (the dice loop) from landing to
// landing + the effect's duration + 300 ms; Chromium runs without the vsync cap. Writes
// { [id]: { p95, p50, frames, mean, busy } } (ms of main-thread work per frame; busy is ms of work per second of wall time) to artifacts/builtin-fx/perf-<label>.json.
// Env: DICER_FX_PERF_LABEL (default "run"), DICER_FX_PERF_BASELINE=<file> (compare: pass when
// best run-mean <= max(1.05 x baseline mean, baseline mean + 0.05 ms); exit 1 on any fail), DICER_FX_IDS, DICER_VISUAL_*.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import {
  PAGE,
  VIEW,
  ROLL,
  ARGS,
  startServer,
  stopServer,
  watchProblems,
  selectedIds,
  gotoReady,
} from './fx-common.mjs';

const LABEL = process.env.DICER_FX_PERF_LABEL || 'run';
const BASELINE = process.env.DICER_FX_PERF_BASELINE;
const RUNS = 7;
const THROTTLE = 4;
const TOLERANCE = 1.05;

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
const r2 = (n) => Math.round(n * 100) / 100;

async function main() {
  const ids = selectedIds();
  await mkdir('artifacts/builtin-fx', { recursive: true });
  await startServer();
  const browser = await chromium.launch({
    headless: process.env.DICER_VISUAL_HEADED !== '1',
    // no frame cap, so the deltas are real frame cost and not pinned at the 16.7 ms vsync
    args: [...ARGS, '--disable-gpu-vsync', '--disable-frame-rate-limit'],
  });
  try {
    const page = await browser.newPage({ viewport: VIEW });
    const problems = watchProblems(page);
    await gotoReady(page, `${PAGE}?jb2a=off`);
    const known = await page.evaluate(() => window.__jb2a.ids);
    const unknown = ids.filter((id) => !known.includes(id));
    if (unknown.length) throw new Error(`unknown effect id(s): ${unknown.join(', ')}`);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });

    const result = {};
    for (const id of ids) {
      const deltas = [];
      const runMeans = [];
      let windowMs = 0;
      // run -1 is a warm-up (shader compile, first allocations) and is not counted
      for (let i = -1; i < RUNS; i++) {
        const d = await page.evaluate(
          async ([fxId, opts]) => {
            if (!window.__perfWork) {
              window.__perfWork = [];
              const raf = window.requestAnimationFrame.bind(window);
              window.requestAnimationFrame = (cb) =>
                raf((t) => {
                  const t0 = performance.now();
                  cb(t);
                  if (window.__perfOn) window.__perfWork.push(performance.now() - t0);
                });
            }
            window.__perfWork.length = 0;
            const ms = window.__jb2a.durations[fxId] + 300;
            await window.__jb2a.playEffect(fxId, opts);
            // Main-thread work per frame: how long each requestAnimationFrame callback (the dice
            // loop: physics step, effect update, render submit) runs. Frame deltas are no use
            // here: capped they sit at vsync, uncapped they only measure how fast the GPU
            // accepts work.
            const out = [];
            window.__perfOn = true;
            await new Promise((r) => setTimeout(r, ms));
            window.__perfOn = false;
            out.push(...window.__perfWork.splice(0));
            // let the die hide and the effect end before the next play
            const t = performance.now();
            while (window.__jb2a.box._rolls.size && performance.now() - t < 10000)
              await new Promise((r) => setTimeout(r, 100));
            return { out, ms };
          },
          [id, ROLL],
        );
        if (i < 0) continue;
        deltas.push(...d.out);
        windowMs += d.ms;
        runMeans.push(d.out.reduce((a, b) => a + b, 0) / d.out.length);
      }
      const sorted = deltas.slice().sort((a, b) => a - b);
      // busy: ms of main-thread work per second of wall time. performance.now() is quantised to
      // 0.1 ms, so the per-frame percentiles are coarse; the summed busy figure averages that out.
      const total = sorted.reduce((a, b) => a + b, 0);
      const busy = (total / windowMs) * 1000;
      result[id] = {
        p95: r2(pct(sorted, 0.95)),
        p50: r2(pct(sorted, 0.5)),
        frames: sorted.length,
        busy: r2(busy),
        mean: r2(Math.min(...runMeans)),
      };
      console.log(
        `fx-perf: ${id} p95=${result[id].p95} p50=${result[id].p50} frames=${sorted.length} busy=${result[id].busy} mean=${result[id].mean}`,
      );
    }

    const file = `artifacts/builtin-fx/perf-${LABEL}.json`;
    await writeFile(file, JSON.stringify(result, null, 2));
    console.log(`fx-perf: saved ${file}`);

    problems.push(...(await page.evaluate(() => window.__jb2a.errors.slice())));
    let code = 0;
    if (problems.length) {
      console.error(`fx-perf: FAILED\n${problems.join('\n')}`);
      code = 1;
    }
    if (BASELINE) {
      const base = JSON.parse(await readFile(BASELINE, 'utf8'));
      for (const id of ids) {
        const b = base[id];
        if (!b) {
          console.log(`fx-perf: FAIL ${id}: no baseline entry`);
          code = 1;
          continue;
        }
        // The gate is the best (lowest) run of the mean work per frame (independent of the
        // uncapped frame rate; the best run shrugs off load from other processes on the machine): 1.05x the baseline, with
        // 0.05 ms of floor for timer and machine noise. p95 is reported, not gated: it is
        // quantised to 0.1 ms.
        const limit = r2(Math.max(b.mean * TOLERANCE, b.mean + 0.05));
        const ok = result[id].mean <= limit;
        console.log(
          `fx-perf: ${ok ? 'PASS' : 'FAIL'} ${id}: mean ${result[id].mean} ms vs limit ${limit} (baseline ${b.mean}); p95 ${result[id].p95} (baseline ${b.p95})`,
        );
        if (!ok) code = 1;
      }
    }
    return code;
  } finally {
    await browser.close();
  }
}

main()
  .then((code) => {
    stopServer();
    process.exit(code);
  })
  .catch((err) => {
    console.error(err);
    stopServer();
    process.exit(1);
  });
