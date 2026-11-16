// Visual check of the dice pets: opens dev/pets.html in Playwright Chromium (GPU on) and saves
// docs/signoff/pets/pets-grid.png (3 kinds x enter, throw, watch, crit, fumble, mixed, plain; each a
// top-down game-view cell at 48 px/die beside a d20 over a 3/4 close-up), pets-colours.png (each kind
// in a very dark, a mid and a very light colour, on a dark and a light map) and pets-strips.png
// (every phase and reaction as 8 frames) and pets-splat.png (per kind: the wobble, the burst, the
// puddle settling and the reform as frames, game view over a close-up, and the resting puddle in a
// dark, a mid and a light colour on a dark and a light map) and rest-spots.png (three pets resting at
// each petRestSpot choice on a 1280 x 800 table with Foundry-like UI drawn over it) and reactions.png
// (each kind x scorch, shiver, bristle and startle at 3 moments, beside the elemental die that set it
// off, and the game view). Fails on any console error, page error or shader error.
// Env: DICER_VISUAL_PORT (default 5183), DICER_VISUAL_HEADED=1, DICER_VISUAL_ONLY (a substring of
// the file names to take, e.g. grid), DICER_PETS_OUT (default docs/signoff/pets).
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const PORT = Number(process.env.DICER_VISUAL_PORT || 5183);
const ORIGIN = `http://localhost:${PORT}`;
const OUT = process.env.DICER_PETS_OUT || 'docs/signoff/pets';
const GPU_ARGS = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'];

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
    {
      env: { ...process.env, BROWSER: 'none' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${ORIGIN}/dev/pets.html`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`vite did not start:\n${log}`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await startServer();
  const browser = await chromium.launch({
    headless: process.env.DICER_VISUAL_HEADED !== '1',
    args: GPU_ARGS,
  });
  const problems = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.on('console', (m) => {
      const text = m.text();
      // three logs a failed compile as "Shader Error" (console.error); D3D's X4122 precision notes
      // arrive as warnings in the program info log and are not failures.
      if (m.type() === 'error' || /shader error|program not valid/i.test(text)) problems.push(text);
    });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    await page.goto(`${ORIGIN}/dev/pets.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__pets?.ready, null, { timeout: 60000 });
    for (const [name, file] of [
      ['grid', 'pets-grid.png'],
      ['colours', 'pets-colours.png'],
      ['strips', 'pets-strips.png'],
      ['splat', 'pets-splat.png'],
      ['restSpots', 'rest-spots.png'],
      ['reactions', 'reactions.png'],
    ]) {
      if (process.env.DICER_VISUAL_ONLY && !file.includes(process.env.DICER_VISUAL_ONLY)) continue;
      const url = await page.evaluate((n) => window.__pets[n](), name);
      await writeFile(`${OUT}/${file}`, Buffer.from(url.split(',')[1], 'base64'));
      console.log(`pets: saved ${OUT}/${file}`);
    }
    problems.push(...(await page.evaluate(() => window.__pets.errors.slice())));
    await page.close();
  } finally {
    await browser.close();
  }
  if (problems.length) {
    console.error(`pets: FAILED\n${[...new Set(problems)].join('\n')}`);
    return 1;
  }
  return 0;
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
