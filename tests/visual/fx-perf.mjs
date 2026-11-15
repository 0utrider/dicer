// Perf probe for the built-in effects: with the CPU throttled 4x (CDP Emulation.setCPUThrottlingRate)
// on dev/jb2a.html?jb2a=off, plays each id 7 times (after one warm-up) from the fixed ROLL seed and records
// the main-thread work of each requestAnimationFrame callback (the dice loop) from landing to
// landing + the effect's duration + 300 ms; Chromium runs without the vsync cap. Writes
// { [id]: { p95, p50, frames, mean, busy } } (ms of main-thread work per frame; busy is ms of work per second of wall time) to artifacts/builtin-fx/perf-<label>.json.
// Env: DICER_FX_PERF_LABEL (default "run"), DICER_FX_PERF_BASELINE=<file> (compare: pass when
// best run-mean <= max(1.05 x baseline mean, baseline mean + 0.05 ms); exit 1 on any fail), DICER_FX_IDS, DICER_VISUAL_*.
// The trail pool case (after the ids): a 30-die fire-inside pool thrown POOL_RUNS times with trails
// on (spec trail 2) and as many with trails off (trail 0), alternating, same page, seed and area,
// recording each rAF callback's main-thread work and the rAF frame interval from the throw to
// landing + 300 ms. Pass: best trails-on run-mean <= max(1.05 x, + 0.05 ms) the best trails-off one,
// and the trails-on frame-interval p95 <= 16.7 ms. Written as pool-30-fire-trails-{on,off} and
// pool-30-fire-trails (the verdict). DICER_FX_PERF_POOL=off skips it, =only runs it alone.
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
const POOL = process.env.DICER_FX_PERF_POOL || 'on';
const POOL_DICE = 30;
const POOL_RUNS = 7;
const FRAME_P95 = 16.7;
/** The pool's dice: d6s with a fire inside (the element comes from the inside, no damage type). */
const FIRE_LOOK = {
  body: { type: 'resin', color: '#3a0f06', color2: '#140402', roughness: 0.05 },
  interior: { type: 'fire', colors: ['#ff6a10', '#ffc24a'], density: 0.7 },
  numbers: { fill: 'gold', color: '#ffd9a0', depth: 0.5 },
};
/** A wider throw area than ROLL's (30 dice), centred right of the panel. */
const POOL_ROLL = { area: { left: 400, top: 140, width: 820, height: 520 }, seed: 20 };

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
const r2 = (n) => Math.round(n * 100) / 100;

/** The rAF wrapper (an init script) that records each callback's work and the frame interval. */
function installProbe() {
  window.__perfWork = [];
  window.__perfFrame = [];
  let last = null;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) =>
    raf((t) => {
      const t0 = performance.now();
      cb(t);
      if (window.__perfOn) {
        window.__perfWork.push(performance.now() - t0);
        if (last !== null && t > last) window.__perfFrame.push(t - last);
      }
      if (t !== last) last = t;
    });
}

/**
 * Throws the trail pool once (trail 2 or 0) and returns the per-frame work and frame intervals
 * from the throw to landing + 300 ms. Runs in the page.
 */
async function throwPool([trail, n, look, opts]) {
  window.__perfWork.length = 0;
  window.__perfFrame.length = 0;
  const box = window.__jb2a.box;
  const specs = Array.from({ length: n }, (_, i) => ({
    type: 'd6',
    value: 1 + (i % 6),
    trail,
    appearance: look,
  }));
  window.__perfOn = true;
  const r = box.roll(specs, opts);
  await r.landed;
  await new Promise((res) => setTimeout(res, 300));
  window.__perfOn = false;
  const out = { work: window.__perfWork.splice(0), frame: window.__perfFrame.splice(0) };
  const t = performance.now();
  while (box._rolls.size && performance.now() - t < 15000)
    await new Promise((res) => setTimeout(res, 100));
  return out;
}

/** The trail pool case: trails on vs off, alternating runs after one warm-up of each. */
async function poolCase(page) {
  const runs = { on: [], off: [] };
  const all = { on: { work: [], frame: [] }, off: { work: [], frame: [] } };
  for (let i = -1; i < POOL_RUNS; i++) {
    for (const mode of i % 2 ? ['on', 'off'] : ['off', 'on']) {
      const d = await page.evaluate(throwPool, [
        mode === 'on' ? 2 : 0,
        POOL_DICE,
        FIRE_LOOK,
        POOL_ROLL,
      ]);
      if (i < 0) continue; // warm-up: shader compile, first allocations, the pool's first growth
      runs[mode].push(d.work.reduce((a, b) => a + b, 0) / d.work.length);
      all[mode].work.push(...d.work);
      all[mode].frame.push(...d.frame);
    }
  }
  const out = {};
  for (const mode of ['on', 'off']) {
    const work = all[mode].work.slice().sort((a, b) => a - b);
    const frame = all[mode].frame.slice().sort((a, b) => a - b);
    out[mode] = {
      mean: r2(Math.min(...runs[mode])),
      runMeans: runs[mode].map(r2),
      p95: r2(pct(work, 0.95)),
      p50: r2(pct(work, 0.5)),
      frameP95: r2(pct(frame, 0.95)),
      frames: work.length,
    };
  }
  const limit = r2(Math.max(out.off.mean * TOLERANCE, out.off.mean + 0.05));
  const meanOk = out.on.mean <= limit;
  const frameOk = out.on.frameP95 <= FRAME_P95;
  const verdict = {
    limit,
    ratio: r2(out.on.mean / out.off.mean),
    deltaMs: r2(out.on.mean - out.off.mean),
    meanOk,
    frameOk,
    pass: meanOk && frameOk,
  };
  console.log(
    `fx-perf: pool ${POOL_DICE} fire dice: trails on mean=${out.on.mean} p95=${out.on.p95} frameP95=${out.on.frameP95} (runs ${out.on.runMeans.join(' ')}); off mean=${out.off.mean} p95=${out.off.p95} frameP95=${out.off.frameP95} (runs ${out.off.runMeans.join(' ')})`,
  );
  console.log(
    `fx-perf: ${verdict.pass ? 'PASS' : 'FAIL'} pool trails: mean ${out.on.mean} ms vs limit ${limit} (off ${out.off.mean}, ratio ${verdict.ratio}, +${verdict.deltaMs} ms); frame p95 ${out.on.frameP95} ms vs ${FRAME_P95}`,
  );
  return { on: out.on, off: out.off, verdict };
}

async function main() {
  const ids = POOL === 'only' ? [] : selectedIds();
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
    await page.addInitScript(installProbe);
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

    let poolFail = false;
    if (POOL !== 'off') {
      const pool = await poolCase(page);
      result['pool-30-fire-trails-on'] = pool.on;
      result['pool-30-fire-trails-off'] = pool.off;
      result['pool-30-fire-trails'] = pool.verdict;
      poolFail = !pool.verdict.pass;
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
    if (poolFail) code = 1;
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
