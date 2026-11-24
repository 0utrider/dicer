// Close-ups of the interior looks (dev/looks.html closeup()) at 300 px, for judging what the
// gallery cells are too small to show. Saves artifacts/visual/closeup-<look>-<type>-<tier>.png.
// Usage: node tests/visual/closeups.mjs [tier] (default high). Assumes nothing is running on
// DICER_VISUAL_PORT (default 5179): starts and stops its own Vite dev server.
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const PORT = Number(process.env.DICER_VISUAL_PORT || 5179);
const PAGE = `http://localhost:${PORT}/dev/looks.html`;
const TIER = process.argv[2] || 'high';
const SHOTS = [
  ['default', 'd20'],
  ['abyss-liquid', 'd12'],
  ['starlit-glitter', 'd20'],
  ['frost-crystal', 'd6'],
  ['galaxy-nebula', 'd10'],
  ['void-star', 'd20'],
  ['void-star', 'd6'],
  ['void-star', 'd12'],
  ['void-star', 'd2'],
  ['void-star', 'd8'],
  ['smoke-swirl', 'd12'],
  ['ember-core', 'd8'],
  ['default', 'd2'],
  // Dichroic glass with and without its layer lines (body.streaks)
  ['iridescent~dichroic', 'd6'],
  ['iridescent~dichroic-smooth', 'd6'],
  ['iridescent~dichroic', 'd20'],
  ['iridescent~dichroic-smooth', 'd20'],
];
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'],
  {
    env: { ...process.env, BROWSER: 'none' },
    stdio: 'ignore',
  },
);
const stop = () => {
  if (process.platform === 'win32')
    spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else server.kill();
};
let code = 1;
try {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(PAGE)).ok) break;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  const browser = await chromium.launch({
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1140, height: 1000 } });
  await page.goto(PAGE);
  await page.waitForFunction(() => window.__looks);
  await page.evaluate(() => window.__looks.ready);
  await page.evaluate((t) => window.__looks.setTier(t), TIER);
  await mkdir('artifacts/visual', { recursive: true });
  for (const [id, type] of SHOTS) {
    const url = await page.evaluate(([i, t]) => window.__looks.closeup(i, t, 300), [id, type]);
    const file = `artifacts/visual/closeup-${id}-${type}-${TIER}.png`;
    await writeFile(file, Buffer.from(url.split(',')[1], 'base64'));
    console.log(file);
  }
  const errors = await page.evaluate(() => window.__looks.errors.slice());
  if (errors.length) console.error(errors.join('\n'));
  await browser.close();
  code = errors.length ? 1 : 0;
} finally {
  stop();
}
process.exit(code);
