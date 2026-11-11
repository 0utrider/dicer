// Visual check: opens the effects review page (dev/effects.html) in Playwright Chromium, rolls
// a d20 carrying the `celebrate` effect and saves docs/signoff/plan-4/effects.png a moment after
// it lands. Fails on any page error. Same server and GPU-flag approach as looks.mjs.
// Env: DICER_VISUAL_PORT (default 5181), DICER_VISUAL_HEADED=1, DICER_VISUAL_ARGS,
// DICER_EFFECT (effect id, default celebrate), DICER_SHOT_DELAY_MS (default 450).
import { spawn, spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const PORT = Number(process.env.DICER_VISUAL_PORT || 5181);
const PAGE = `http://localhost:${PORT}/dev/effects.html`;
const OUT = 'docs/signoff/plan-4/effects.png';
const EFFECT = process.env.DICER_EFFECT || 'celebrate';
const DELAY = Number(process.env.DICER_SHOT_DELAY_MS || 450);
const GPU_ARGS = process.env.DICER_VISUAL_ARGS
  ? process.env.DICER_VISUAL_ARGS.split(/\s+/).filter(Boolean)
  : ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'];

let server = null;
function stopServer() {
  if (!server || server.exitCode !== null) return;
  if (process.platform === 'win32')
    spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else server.kill('SIGTERM');
}
process.on('exit', stopServer);

async function startServer() {
  server = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'],
    { env: { ...process.env, BROWSER: 'none' }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(PAGE)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`vite did not serve ${PAGE}:\n${log}`);
}

async function main() {
  await mkdir('docs/signoff/plan-4', { recursive: true });
  await startServer();
  const browser = await chromium.launch({
    headless: process.env.DICER_VISUAL_HEADED !== '1',
    args: GPU_ARGS,
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const problems = [];
    page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    await page.goto(PAGE, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__effects, null, { timeout: 60000 });
    await page.evaluate((id) => window.__effects.playEffect(id), EFFECT);
    await page.waitForTimeout(DELAY);
    await page.screenshot({ path: OUT });
    console.log(`effects: saved ${OUT} (${EFFECT}, ${DELAY} ms after landing)`);
    problems.push(...(await page.evaluate(() => window.__effects.errors.slice())));
    if (problems.length) {
      console.error(`effects: FAILED\n${problems.join('\n')}`);
      return 1;
    }
    return 0;
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
