// Perf probe for the built-in effects: with the CPU throttled 4x (CDP Emulation.setCPUThrottlingRate)
// on dev/jb2a.html?jb2a=off, plays each id 5 times from the fixed ROLL seed and records
// requestAnimationFrame deltas from landing to landing + the effect's duration + 300 ms. Writes
// { [id]: { p95, p50, frames } } (ms) to artifacts/builtin-fx/perf-<label>.json.
// Env: DICER_FX_PERF_LABEL (default "run"), DICER_FX_PERF_BASELINE=<file> (compare: pass when
// p95 <= 1.05 x the baseline p95, exit 1 on any fail), DICER_FX_IDS, DICER_VISUAL_*.
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
const RUNS = 5;
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
    args: ARGS,
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
      for (let i = 0; i < RUNS; i++) {
        const d = await page.evaluate(
          async ([fxId, opts]) => {
            const ms = window.__jb2a.durations[fxId] + 300;
            await window.__jb2a.playEffect(fxId, opts);
            const out = [];
            let last = performance.now();
            const end = last + ms;
            await new Promise((resolve) => {
              const tick = (now) => {
                out.push(now - last);
                last = now;
                if (now >= end) resolve();
                else requestAnimationFrame(tick);
              };
              requestAnimationFrame(tick);
            });
            // let the die hide and the effect end before the next play
            const t = performance.now();
            while (window.__jb2a.box._rolls.size && performance.now() - t < 10000)
              await new Promise((r) => setTimeout(r, 100));
            return out;
          },
          [id, ROLL],
        );
        d.shift(); // the first delta spans the gap since landing
        deltas.push(...d);
      }
      const sorted = deltas.slice().sort((a, b) => a - b);
      result[id] = { p95: r2(pct(sorted, 0.95)), p50: r2(pct(sorted, 0.5)), frames: sorted.length };
      console.log(
        `fx-perf: ${id} p95=${result[id].p95} p50=${result[id].p50} frames=${sorted.length}`,
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
        const limit = r2(b.p95 * TOLERANCE);
        const ok = result[id].p95 <= limit;
        console.log(
          `fx-perf: ${ok ? 'PASS' : 'FAIL'} ${id}: p95 ${result[id].p95} ms vs limit ${limit} ms (baseline ${b.p95})`,
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
