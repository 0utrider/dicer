// Visual check: runs every dice shader on real WebGL via the look gallery (dev/looks.html).
//
// Starts the Vite dev server, opens the gallery in Playwright Chromium (GPU flags; falls back
// to SwiftShader and says so), and for every quality tier: asserts zero shader errors,
// non-blank cells, a plausible mean colour in every cell's centre patch (a black or NaN render
// fails), and at most 2 x distinct programKeys + 2 programs (one program per programKey, never
// one per colour); saves artifacts/visual/looks-<tier>.png and prints ms/frame.
// The gallery builds its materials from the production flagsFor().
// Exits non-zero on any failure. The dev server is always stopped.
//
// Env: DICER_VISUAL_PORT (default 5179), DICER_VISUAL_HEADED=1 to watch, DICER_VISUAL_ARGS to
// replace the Chromium flags (e.g. "--use-angle=swiftshader" to force the software path).
//
// Stripped shaders (build/glsl-minify-plugin.js, Plan 8 Task 6) run only in builds; this check
// runs the dev server, so by default it sees the shaders as written. To run it on the stripped
// shaders, edit two lines for one run and then revert them:
//   1. build/glsl-minify-plugin.js: delete `apply: 'build',` (the pass then runs in dev too);
//   2. vite.config.js: add 'three' to optimizeDeps.exclude (else three is pre-bundled by esbuild
//      and skips the plugin), and delete node_modules/.vite.
// Then `node tests/visual/looks.mjs` (and tests/visual/themes.mjs). Expect 0 shader errors and the
// same centre-RGB ranges and program counts as an unstripped run.
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const PORT = Number(process.env.DICER_VISUAL_PORT || 5179);
const BASE = `http://localhost:${PORT}`;
const PAGE = `${BASE}/dev/looks.html`;
const OUT_DIR = 'artifacts/visual';
const TIERS = ['low', 'medium', 'high', 'ultra'];
const GPU_ARGS = process.env.DICER_VISUAL_ARGS
  ? process.env.DICER_VISUAL_ARGS.split(/\s+/).filter(Boolean)
  : ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'];
const SERVER_TIMEOUT_MS = 30000;
const READY_TIMEOUT_MS = 180000;
/**
 * Plausible mean RGB (0-255, averaged over channels) of a cell's centre patch. NaN shading
 * and a failed body come out black (about 0) or saturated white. The darkest legitimate cell
 * is Void Star (near-black resin) at low, where no interior lights it: 5.1 on the d8 (RTX
 * 5070 Ti, 2026-11-10), so the floor sits just under it.
 */
const MEAN_RGB_MIN = 3;
const MEAN_RGB_MAX = 250;

let server = null;

function stopServer() {
  if (!server || server.exitCode !== null || server.killed) return;
  try {
    if (process.platform === 'win32') {
      // Kill the whole tree (vite may spawn esbuild children).
      spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      server.kill('SIGTERM');
    }
  } catch {
    server.kill();
  }
}
process.on('exit', stopServer);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stopServer();
    process.exit(130);
  });
}

async function startServer() {
  server = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'],
    // BROWSER=none: vite.config.js opens /dev/preview.html on start otherwise.
    { env: { ...process.env, BROWSER: 'none' }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  const exited = new Promise((_, reject) =>
    server.once('exit', (code) => reject(new Error(`vite exited (${code}):\n${log}`))),
  );
  const deadline = Date.now() + SERVER_TIMEOUT_MS;
  const poll = (async () => {
    while (Date.now() < deadline) {
      try {
        const res = await fetch(PAGE);
        if (res.ok) return;
      } catch {
        // not up yet
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`vite did not serve ${PAGE} within ${SERVER_TIMEOUT_MS} ms:\n${log}`);
  })();
  await Promise.race([poll, exited]);
  exited.catch(() => {}); // later exits are handled by stopServer / the browser failing
}

const isSoftware = (gpu) => /swiftshader|llvmpipe|software|basic render/i.test(gpu ?? '');

async function main() {
  const failures = [];
  await mkdir(OUT_DIR, { recursive: true });
  await startServer();
  const browser = await chromium.launch({
    headless: process.env.DICER_VISUAL_HEADED !== '1',
    args: GPU_ARGS,
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1140, height: 1000 } });
    const consoleErrors = [];
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
    await page.goto(PAGE, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__looks, null, { timeout: 30000 });
    await page.evaluate(
      (ms) =>
        Promise.race([
          window.__looks.ready,
          new Promise((_, rej) => setTimeout(() => rej(new Error('__looks.ready timeout')), ms)),
        ]),
      READY_TIMEOUT_MS,
    );

    const first = await page.evaluate(() => window.__looks.info());
    const path = isSoftware(first.gpu) ? 'SwiftShader/software' : 'GPU';
    console.log(`visual: WebGL renderer: ${first.gpu} (${first.vendor}) -> ${path}`);
    console.log(
      `visual: grid ${first.rows} looks x ${first.cols} die types = ${first.cells} cells`,
    );

    const summary = { renderer: first.gpu, vendor: first.vendor, path, tiers: {} };
    let nonBlankTotal = 0;
    for (const tier of TIERS) {
      await page.evaluate(
        (t) =>
          Promise.race([
            window.__looks.setTier(t),
            new Promise((_, rej) => setTimeout(() => rej(new Error('setTier timeout')), 170000)),
          ]),
        tier,
      );
      const errors = await page.evaluate(() => window.__looks.errors.slice());
      if (errors.length)
        failures.push(`${tier}: ${errors.length} error(s):\n  ${errors.join('\n  ')}`);
      const alphas = await page.evaluate(() => window.__looks.cellAlphas());
      const blank = alphas.filter((c) => !(c.alpha > 0));
      if (blank.length) {
        failures.push(
          `${tier}: ${blank.length} blank cell(s): ${blank.map((c) => `${c.id}/${c.type}`).join(', ')}`,
        );
      }
      nonBlankTotal += alphas.length - blank.length;
      const implausible = alphas.filter(
        (c) => c.alpha > 0 && !(c.meanRgb >= MEAN_RGB_MIN && c.meanRgb <= MEAN_RGB_MAX),
      );
      if (implausible.length) {
        failures.push(
          `${tier}: ${implausible.length} cell(s) with an implausible centre colour: ` +
            implausible.map((c) => `${c.id}/${c.type}=${c.meanRgb}`).join(', '),
        );
      }
      const means = alphas.map((c) => c.meanRgb);
      const ms = await page.evaluate(() => window.__looks.msPerFrame(10));
      const tierInfo = await page.evaluate(() => window.__looks.info());
      const maxPrograms = 2 * tierInfo.programKeys + 2;
      if (tierInfo.programs > maxPrograms) {
        failures.push(
          `${tier}: ${tierInfo.programs} programs > 2 x ${tierInfo.programKeys} programKeys + 2`,
        );
      }
      const file = `${OUT_DIR}/looks-${tier}.png`;
      await page.screenshot({ path: file, fullPage: true });
      summary.tiers[tier] = {
        msPerFrame: Number(ms.toFixed(2)),
        cells: alphas.length,
        nonBlank: alphas.length - blank.length,
        errors: errors.length,
        programs: tierInfo.programs,
        programKeys: tierInfo.programKeys,
        maxPrograms,
        meanRgbMin: Math.min(...means),
        meanRgbMax: Math.max(...means),
        pixelRatio: tierInfo.pixelRatio,
        screenshot: file,
      };
      console.log(
        `visual: ${tier.padEnd(6)} ${ms.toFixed(2).padStart(8)} ms/frame (${first.cells} cells)  ` +
          `programs ${tierInfo.programs}/${maxPrograms} (programKeys ${tierInfo.programKeys})  ` +
          `centre RGB ${Math.min(...means)}-${Math.max(...means)}  ` +
          `non-blank ${alphas.length - blank.length}/${alphas.length}  -> ${file}`,
      );
    }
    if (consoleErrors.length) {
      failures.push(`console errors:\n  ${consoleErrors.join('\n  ')}`);
    }
    summary.consoleErrors = consoleErrors;
    summary.failures = failures;
    await writeFile(`${OUT_DIR}/looks.json`, JSON.stringify(summary, null, 2));
    if (failures.length) {
      console.error(`visual: FAILED\n${failures.join('\n')}`);
      return 1;
    }
    console.log(`visual: OK (0 shader errors, ${nonBlankTotal} cells non-blank)`);
    return 0;
  } finally {
    await browser.close();
  }
}

let code = 1;
try {
  code = await main();
} catch (err) {
  console.error(`visual: FAILED: ${err?.stack ?? err}`);
  code = 1;
} finally {
  stopServer();
}
process.exit(code);
