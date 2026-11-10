// Performance measurements for the look sign-off (spec G2, Plan 2 Task 9):
// 1. full-screen per-pixel interior cost: one galaxy-nebula d20 filling ~70% of a 1920x1080
//    buffer, at ultra/high/medium (dev/looks.html fullscreenCost: GPU timer + wall clock);
// 2. a 10-die galaxy-nebula throw on dev/preview.html (real physics) at every tier, p95 of the
//    renderer's frame time (max of tick+render and the rAF interval) and of GPU render time;
// 3. the medium throw again under a 4x CPU throttle (CDP Emulation.setCPUThrottlingRate).
// Chromium runs with vsync and the frame-rate limit off, so rAF intervals show real frame
// cost instead of the 16.7 ms display interval. Writes artifacts/visual/measure.json.
// Usage: node tests/visual/measure.mjs   (DICER_VISUAL_PORT, default 5179; THROWS per tier, default 3)
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const PORT = Number(process.env.DICER_VISUAL_PORT || 5179);
const BASE = `http://localhost:${PORT}/dev`;
const THROWS = Number(process.env.THROWS || 3);
const DSF = Number(process.env.DSF || 1); // deviceScaleFactor for the throw pages (2: a HiDPI monitor)
const TIERS = ['low', 'medium', 'high', 'ultra'];
const ARGS = [
  '--use-angle=d3d11',
  '--enable-gpu',
  '--ignore-gpu-blocklist',
  '--disable-gpu-vsync',
  '--disable-frame-rate-limit',
];

const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'],
  { env: { ...process.env, BROWSER: 'none' }, stdio: 'ignore' },
);
const stop = () => {
  if (process.platform === 'win32')
    spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else server.kill();
};
const f = (x) => (x == null ? '   -  ' : x.toFixed(2).padStart(6));

async function waitServer() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${BASE}/looks.html`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('vite did not start');
}

async function fullscreen(browser) {
  const page = await browser.newPage({ viewport: { width: 1140, height: 1000 } });
  await page.goto(`${BASE}/looks.html`);
  await page.waitForFunction(() => window.__looks);
  await page.evaluate(() => window.__looks.ready);
  const info = await page.evaluate(() => window.__looks.info());
  const out = [];
  for (const pixelRatio of [1, 1.5]) {
    for (const tier of ['medium', 'high', 'ultra']) {
      const r = await page.evaluate((o) => window.__looks.fullscreenCost(o), {
        tier,
        pixelRatio,
        frames: 120,
      });
      out.push(r);
      console.log(
        `fullscreen ${tier.padEnd(6)} ${r.buffer.join('x').padEnd(9)} steps ${String(r.steps).padStart(2)}: ` +
          `GPU p50 ${f(r.gpuP50)} p95 ${f(r.gpuP95)} ms | wall p50 ${f(r.wallP50)} p95 ${f(r.wallP95)} ms` +
          (r.timer ? '' : ' (no timer query)'),
      );
    }
  }
  const errors = await page.evaluate(() => window.__looks.errors.slice());
  await page.close();
  return { gpu: info.gpu, results: out, errors };
}

async function throws(browser, tier, { throttle = 1 } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: DSF,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`${BASE}/preview.html?look=galaxy-nebula&tier=${tier}`);
  await page.waitForFunction(() => window.__preview, null, { timeout: 60000 });
  // warm-up throw: program compiles and first uploads are not part of the measurement
  await page.evaluate(() => window.__preview.measuredThrow(10));
  let cdp = null;
  if (throttle > 1) {
    cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  }
  const runs = [];
  for (let i = 0; i < THROWS; i++)
    runs.push(await page.evaluate(() => window.__preview.measuredThrow(10)));
  if (cdp) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await ctx.close();
  return { tier, throttle, runs, errors };
}

/** p95 over all frames of all runs is not available from the summaries; report the worst run's p95 and the mean. */
function summarize(t) {
  const p95s = t.runs.map((r) => r.p95);
  const gpu95 = t.runs.map((r) => r.gpuP95).filter((x) => x != null);
  return {
    tier: t.tier,
    throttle: t.throttle,
    frames: t.runs.reduce((a, r) => a + r.frames, 0),
    p50: Math.max(...t.runs.map((r) => r.p50)),
    p95: Math.max(...p95s),
    p95mean: p95s.reduce((a, b) => a + b, 0) / p95s.length,
    gpuP95: gpu95.length ? Math.max(...gpu95) : null,
    buffer: t.runs[0].buffer,
    pixelRatio: t.runs[0].pixelRatio,
    errors: t.errors,
  };
}

let code = 1;
try {
  await waitServer();
  const browser = await chromium.launch({ args: ARGS });
  try {
    const fs = await fullscreen(browser);
    console.log(`WebGL renderer: ${fs.gpu}`);
    const rows = [];
    for (const tier of TIERS) rows.push(summarize(await throws(browser, tier)));
    rows.push(summarize(await throws(browser, 'medium', { throttle: 4 })));
    for (const r of rows) {
      console.log(
        `throw 10x galaxy-nebula ${r.tier.padEnd(6)}${r.throttle > 1 ? ` (${r.throttle}x CPU)` : '         '} ` +
          `${r.buffer.join('x')} @${r.pixelRatio}: ${r.frames} frames, frame p50 ${f(r.p50)} p95 ${f(r.p95)} ` +
          `(mean of runs ${f(r.p95mean)}) | GPU p95 ${f(r.gpuP95)} ms` +
          (r.errors.length ? `  ERRORS: ${r.errors.join(' | ')}` : ''),
      );
    }
    await mkdir('artifacts/visual', { recursive: true });
    await writeFile(
      `artifacts/visual/measure${DSF === 1 ? '' : `-dsf${DSF}`}.json`,
      JSON.stringify({ gpu: fs.gpu, args: ARGS, fullscreen: fs.results, throws: rows }, null, 2),
    );
    code = fs.errors.length || rows.some((r) => r.errors.length) ? 1 : 0;
  } finally {
    await browser.close();
  }
} catch (err) {
  console.error(err?.stack ?? err);
} finally {
  stop();
}
process.exit(code);
