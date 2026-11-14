// Perf probe for the living insides: per inside, 20 resin d20s with the inside moving (motion
// stepping + render submit) vs the same 20 frozen (insideMotion off), main-thread ms per frame
// (the rAF callback), best of 7 runs, CPU throttled 4x. Bar: moving <= max(1.05 x frozen,
// frozen + 0.05 ms). Writes artifacts/insides/perf.json; exits 1 on any FAIL or page error.
// Env: DICER_INSIDES=a,b (subset), DICER_VISUAL_*.
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { PORT, ARGS, startServer, stopServer } from './fx-common.mjs';

const ALL = ['liquid', 'liquid-bubble', 'liquid-sand', 'glitter', 'swirl', 'nebula', 'smoke', 'eye', 'runes', 'dragon'];
const ids = process.env.DICER_INSIDES?.split(',').filter(Boolean) ?? ALL;
const RUNS = 7;
const THROTTLE = 4;
const r3 = (n) => Math.round(n * 1000) / 1000;

async function main() {
  await mkdir('artifacts/insides', { recursive: true });
  await startServer();
  const browser = await chromium.launch({
    headless: process.env.DICER_VISUAL_HEADED !== '1',
    args: [...ARGS, '--disable-gpu-vsync', '--disable-frame-rate-limit'],
  });
  const result = {};
  const problems = [];
  let code = 0;
  try {
    for (const id of ids) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      page.on('console', (m) => ['error', 'warning'].includes(m.type()) && problems.push(`[${id}] ${m.type()}: ${m.text()}`));
      page.on('pageerror', (e) => problems.push(`[${id}] pageerror: ${e.message}`));
      await page.goto(`http://localhost:${PORT}/dev/insides.html?inside=${id}&perf=1`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__insides, null, { timeout: 60000 });
      await page.evaluate(() => window.__insides.ready);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
      const best = {};
      const runs = { frozen: [], moving: [] };
      for (const mode of ['frozen', 'moving']) {
        await page.evaluate((m) => window.__insides.perfSetup({ motion: m === 'moving' }), mode);
        await page.evaluate((m) => window.__insides.perfRun({ motion: m === 'moving', frames: 30 }), mode); // compile + warm-up
        await page.evaluate(() => window.__insides.sync());
        best[mode] = null;
      }
      // alternate the modes run by run so machine drift hits both alike
      for (let i = 0; i < RUNS; i++) {
        for (const mode of ['frozen', 'moving']) {
          await page.evaluate((m) => window.__insides.perfSetup({ motion: m === 'moving' }), mode);
          await page.evaluate(() => window.__insides.sync());
          runs[mode].push(await page.evaluate((m) => window.__insides.perfRun({ motion: m === 'moving', frames: 120 }), mode));
        }
      }
      const frozen = Math.min(...runs.frozen);
      const moving = Math.min(...runs.moving);
      const limit = Math.max(frozen * 1.05, frozen + 0.05);
      const pass = moving <= limit;
      result[id] = { frozen: r3(frozen), moving: r3(moving), limit: r3(limit), pass, runs: { frozen: runs.frozen.map(r3), moving: runs.moving.map(r3) } };
      console.log(`insides-perf: ${pass ? 'PASS' : 'FAIL'} ${id}: frozen ${r3(frozen)} ms, moving ${r3(moving)} ms, limit ${r3(limit)} ms`);
      if (!pass) code = 1;
      problems.push(...(await page.evaluate(() => window.__insides.errors.slice())).map((e) => `[${id}] ${e}`));
      await page.close();
    }
    await writeFile('artifacts/insides/perf.json', JSON.stringify({ throttle: THROTTLE, runs: RUNS, result, problems }, null, 2));
    console.log('insides-perf: saved artifacts/insides/perf.json');
    if (problems.length) console.log(`insides-perf: console/page messages:\n${problems.join('\n')}`);
    if (problems.some((p) => /Shader Error|pageerror/.test(p))) code = 1;
  } finally {
    await browser.close();
  }
  return code;
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
