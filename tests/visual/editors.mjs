// Visual check of the three editor windows: opens dev/editors.html in Playwright Chromium with
// Foundry's real stylesheet (served from the local Foundry install under /__foundry/), renders
// the real apps with sample data and saves docs/signoff/ui/*.png at 1000x800 in the dark theme:
// theme-browser.png, theme-browser-selected.png (a card clicked; also checks that the live die rotates), theme-edit.png, trigger-rules.png,
// trigger-rules-selected.png (a rule clicked), damage-map.png, damage-map-player.png.
// Fails on any page error. Env: DICER_VISUAL_PORT (default 5182), DICER_VISUAL_HEADED=1,
// DICER_FOUNDRY_APP (default C:/Program Files/Foundry Virtual Tabletop/resources/app).
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const PORT = Number(process.env.DICER_VISUAL_PORT || 5182);
const ORIGIN = `http://localhost:${PORT}`;
const FOUNDRY = process.env.DICER_FOUNDRY_APP || 'C:/Program Files/Foundry Virtual Tabletop/resources/app';
const OUT = 'docs/signoff/ui';
const GPU_ARGS = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'];
const TYPES = {
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

let server = null;
function stopServer() {
  if (!server || server.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else server.kill('SIGTERM');
}
process.on('exit', stopServer);

async function startServer() {
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], {
    env: { ...process.env, BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${ORIGIN}/dev/editors.html`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`vite did not start:\n${log}`);
}

async function shoot(browser, query, file, act) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const problems = [];
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await page.route('**/__foundry/**', async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname.replace('/__foundry/', ''));
    try {
      const body = await readFile(join(FOUNDRY, 'public', path));
      await route.fulfill({ body, contentType: TYPES[extname(path)] ?? 'application/octet-stream' });
    } catch {
      await route.fulfill({ status: 404, body: '' });
    }
  });
  await page.goto(`${ORIGIN}/dev/editors.html?${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  if (act) await act(page);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/${file}` });
  problems.push(...(await page.evaluate(() => window.__editors.errors.slice())));
  await page.close();
  console.log(`editors: saved ${OUT}/${file}${problems.length ? ` with ${problems.length} problem(s)` : ''}`);
  return problems.map((p) => `${file}: ${p}`);
}

const thumbs = async (page) => {
  const n = await page.evaluate(() => window.__editors.thumbnailsReady());
  console.log(`editors: ${n} thumbnails`);
};

async function main() {
  await mkdir(OUT, { recursive: true });
  await startServer();
  const browser = await chromium.launch({ headless: process.env.DICER_VISUAL_HEADED !== '1', args: GPU_ARGS });
  const problems = [];
  try {
    problems.push(...(await shoot(browser, 'app=themes', 'theme-browser.png', thumbs)));
    problems.push(
      ...(await shoot(browser, 'app=themes', 'theme-browser-selected.png', async (page) => {
        await thumbs(page);
        await page.click('.dicer-theme-card[data-theme="dragon-hoard"]');
        await page.waitForFunction(() => document.querySelector('.dicer-theme-detail')?.dataset.theme === 'dragon-hoard');
        await thumbs(page);
        // the detail die turns live: two shots of its stage ~1 s apart must differ
        await page.waitForSelector('.dicer-theme-detail .dicer-stage.has-live canvas.dicer-live', { timeout: 30000 });
        const stage = page.locator('.dicer-theme-detail .dicer-stage');
        const a = await stage.screenshot();
        await page.waitForTimeout(1000);
        const b = await stage.screenshot();
        if (a.equals(b)) throw new Error('theme-browser-selected: the live preview did not change in 1 s (not rotating)');
        console.log('editors: live preview is rotating');
      })),
    );
    problems.push(
      ...(await shoot(browser, 'app=themes', 'theme-edit.png', async (page) => {
        await page.click('.dicer-segmented [data-filter="user"]');
        await page.click('.dicer-theme-card[data-theme="user.u1.my-ember"]');
        await page.click('.dicer-theme-detail [data-action="edit"]');
        await page.waitForSelector('.dicer-theme-edit');
      })),
    );
    problems.push(...(await shoot(browser, 'app=triggers', 'trigger-rules.png')));
    problems.push(
      ...(await shoot(browser, 'app=triggers', 'trigger-rules-selected.png', async (page) => {
        await page.click('.dicer-rule-item[data-index="2"]');
        await page.waitForSelector('.dicer-rule-item[data-index="2"].is-selected');
      })),
    );
    problems.push(...(await shoot(browser, 'app=damage', 'damage-map.png')));
    problems.push(...(await shoot(browser, 'app=damage&player=1', 'damage-map-player.png')));
  } finally {
    await browser.close();
  }
  if (problems.length) {
    console.error(`editors: FAILED\n${[...new Set(problems)].join('\n')}`);
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
