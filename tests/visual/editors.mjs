// Visual check of the editor windows: opens dev/editors.html in Playwright Chromium with
// Foundry's real stylesheet (served from the local Foundry install under /__foundry/), renders
// the real apps with sample data and saves docs/signoff/ui/*.png at 1000x800 in the dark theme:
// theme-browser.png, theme-browser-selected.png (a card clicked; also checks that the live die rotates),
// appearance-editor.png (clear resin with a nebula inside, gold numbers), appearance-editor-metal.png
// (edited in the window to antique metal, sharp edges, sans font; also checks the live preview follows
// an edit), trigger-rules.png,
// trigger-rules-selected.png (a rule clicked), damage-map.png, damage-map-player.png, benchmark.png (a finished run),
// dice-tray.png (dice picked, a blind roll; chat cards with the hand mark beside it).
// Fails on any page error. Env: DICER_VISUAL_PORT (default 5182), DICER_VISUAL_HEADED=1,
// DICER_VISUAL_ONLY (a substring of the screenshot names to take, e.g. appearance),
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

async function shoot(browser, query, file, act, { reducedMotion = 'no-preference' } = {}) {
  if (process.env.DICER_VISUAL_ONLY && !file.includes(process.env.DICER_VISUAL_ONLY)) return [];
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  await page.emulateMedia({ reducedMotion });
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

const livePreview = async (page) => {
  if (!(await page.evaluate(() => window.__editors.previewReady()))) throw new Error('appearance: the live preview never drew');
};

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
      ...(await shoot(browser, 'app=appearance', 'appearance-editor.png', async (page) => {
        await livePreview(page);
        await page.waitForTimeout(1500); // a quarter turn: the nebula and the gold 20 both show
      })),
    );
    problems.push(
      // The d100 preview is its tens die: 10, 20 … 90 and 00, as in a roll.
      ...(await shoot(
        browser,
        'app=appearance',
        'appearance-editor-d100.png',
        async (page) => {
          await livePreview(page);
          await page.click('[data-action="previewDie"][data-type="d100"]');
          await page.waitForTimeout(600);
          await page.mouse.move(5, 5);
        },
        { reducedMotion: 'reduce' },
      )),
    );
    problems.push(
      ...(await shoot(
        browser,
        'app=appearance',
        'appearance-editor-metal.png',
        async (page) => {
          // Reduced motion: the die stands still, so only an edit can change the stage.
          await livePreview(page);
          const stage = page.locator('.dicer-ae-stage');
          await page.waitForTimeout(300);
          const a = await stage.screenshot();
          await page.waitForTimeout(400);
          if (!a.equals(await stage.screenshot())) throw new Error('appearance: the still preview changed without an edit');
          await page.click('[data-field="body.type"][data-value="metal"]');
          await page.waitForTimeout(400); // debounce (80 ms) + a frame
          if (a.equals(await stage.screenshot())) throw new Error('appearance: the preview did not follow the body type change');
          console.log('editors: the live preview follows edits');
          await page.click('[data-field="body.finish"][data-value="antique"]');
          await page.fill('input[name="body.color"]', '#b08a4e');
          await page.click('[data-field="edges.radius"][data-value="0"]');
          await page.click('[data-field="numbers.fill"][data-value="paint"]');
          await page.fill('input[name="numbers.color"]', '#1c140b');
          await page.click('[data-field="numbers.fontKind"][data-value="sans"]');
          await page.fill('input[name="name"]', 'Antique Brass');
          await page.click('[data-section="inside"] > summary'); // a metal die has no inside: fold it away
          await page.evaluate(() => (document.querySelector('.dicer-ae-layers').scrollTop = 0));
          await page.mouse.move(5, 5);
          await page.waitForTimeout(1500); // the sans atlas loads, then the die is rebuilt with it
        },
        { reducedMotion: 'reduce' },
      )),
    );
    // One shot per remaining body type (the clear resin and the metal ones are above).
    const bodyShots = {};
    for (const type of ['opaque', 'marble', 'pearl'])
      problems.push(
        ...(await shoot(browser, 'app=appearance', `appearance-body-${type}.png`, async (page) => {
          await livePreview(page);
          await page.click(`[data-field="body.type"][data-value="${type}"]`);
          await page.waitForTimeout(600);
          await page.mouse.move(5, 5);
          bodyShots[type] = (await page.locator('.dicer-ae-stage').screenshot()).toString('base64');
        }, { reducedMotion: 'reduce' })),
      );
    if (Object.keys(bodyShots).length === 3 && new Set(Object.values(bodyShots)).size !== 3)
      problems.push('appearance-body: two body types drew the same stage');
    // The new insides: the chips and options each shows, and the live preview follows each pick.
    const insideShots = {};
    for (const [type, expected] of [['eye', { inclusion: 0, bubble: 0 }], ['botanical', { inclusion: 3, bubble: 0 }], ['liquid', { inclusion: 0, bubble: 1 }]])
      problems.push(
        ...(await shoot(browser, 'app=appearance', `appearance-inside-${type}.png`, async (page) => {
          await livePreview(page);
          await page.click('[data-section="inside"]:not([open]) > summary').catch(() => {});
          await page.click(`[data-field="interior.type"][data-value="${type}"]`);
          if (type === 'liquid') await page.check('input[name="interior.bubble"]');
          await page.waitForTimeout(1200); // debounce + the chunk-built program
          await page.mouse.move(5, 5);
          const got = await page.evaluate(() => ({
            inclusion: document.querySelectorAll('[data-field="interior.inclusion"]').length,
            bubble: document.querySelectorAll('input[name="interior.bubble"]:checked').length,
          }));
          if (got.inclusion !== expected.inclusion || got.bubble !== expected.bubble)
            throw new Error(`appearance-inside-${type}: unexpected options ${JSON.stringify(got)}`);
          insideShots[type] = (await page.locator('.dicer-ae-stage').screenshot()).toString('base64');
          await page.locator('[data-section="inside"]').scrollIntoViewIfNeeded();
        }, { reducedMotion: 'reduce' })),
      );
    if (Object.keys(insideShots).length === 3 && new Set(Object.values(insideShots)).size !== 3)
      problems.push('appearance-inside: two insides drew the same stage');
    // The floating-shape chips: nine shapes (the fantasy five included), and the preview follows each pick.
    const shapeShots = {};
    problems.push(
      ...(await shoot(browser, 'app=appearance', 'appearance-inside-shape.png', async (page) => {
        await livePreview(page);
        await page.click('[data-section="inside"]:not([open]) > summary').catch(() => {});
        await page.click('[data-field="interior.type"][data-value="shape"]');
        const chips = await page.locator('[data-field="interior.shape"]').count();
        if (chips !== 9) throw new Error(`appearance-inside-shape: ${chips} shape chips, expected 9`);
        for (const shape of ['star', 'sword', 'axe', 'shield', 'dragon', 'runes']) {
          await page.click(`[data-field="interior.shape"][data-value="${shape}"]`);
          await page.waitForTimeout(1200); // debounce + the chunk-built program
          await page.mouse.move(5, 5);
          shapeShots[shape] = (await page.locator('.dicer-ae-stage').screenshot()).toString('base64');
        }
        await page.locator('[data-field="interior.shape"][data-value="runes"]').scrollIntoViewIfNeeded();
      }, { reducedMotion: 'reduce' })),
    );
    if (Object.keys(shapeShots).length === 6 && new Set(Object.values(shapeShots)).size !== 6)
      problems.push('appearance-inside-shape: two shapes drew the same stage');
    // The crystal d4, pips on the d6 and the coin faces: the controls show, take a pick and keep it.
    problems.push(
      ...(await shoot(browser, 'app=appearance', 'appearance-numbers-edges.png', async (page) => {
        await livePreview(page);
        await page.click('[data-field="numbers.coin"][data-value="sun-moon"]');
        await page.check('input[name="numbers.pips"]');
        await page.click('[data-field="shapes.d4"][data-value="crystal"]');
        const got = await page.evaluate(() => ({
          coin: document.querySelectorAll('[data-field="numbers.coin"]').length,
          coinOn: document.querySelector('[data-field="numbers.coin"][data-value="sun-moon"]')?.getAttribute('aria-checked'),
          pips: document.querySelector('input[name="numbers.pips"]')?.checked,
          d4: document.querySelector('[data-field="shapes.d4"][data-value="crystal"]')?.getAttribute('aria-pressed'),
          d4Count: document.querySelectorAll('[data-field="shapes.d4"]').length,
        }));
        if (got.coin !== 3 || got.coinOn !== 'true' || got.pips !== true || got.d4 !== 'true' || got.d4Count !== 2)
          throw new Error(`appearance-numbers-edges: unexpected controls ${JSON.stringify(got)}`);
        await page.waitForTimeout(600);
        await page.mouse.move(5, 5);
        await page.locator('[data-field="shapes.d4"][data-value="crystal"]').scrollIntoViewIfNeeded();
      }, { reducedMotion: 'reduce' })),
    );
    // The Pet section: open, Slime picked (saved straight to the user's flag, not the look).
    problems.push(
      ...(await shoot(browser, 'app=appearance', 'appearance-pet.png', async (page) => {
        await livePreview(page);
        await page.click('[data-section="pet"]:not([open]) > summary');
        await page.click('[data-action="setPet"][data-value="slime"]');
        await page.fill('input[name="pet.color"]', '#4fbf6a');
        await page.dispatchEvent('input[name="pet.color"]', 'change');
        const got = await page.evaluate(() => ({
          chips: document.querySelectorAll('[data-action="setPet"]').length,
          on: document.querySelector('[data-action="setPet"][aria-checked="true"]')?.dataset.value,
          flag: window.__editors.userFlags.pet,
          open: document.querySelector('[data-section="pet"]')?.open,
        }));
        if (got.chips !== 4 || got.on !== 'slime' || got.flag?.kind !== 'slime' || got.flag?.color !== '#4fbf6a' || !got.open)
          throw new Error(`appearance-pet: unexpected state ${JSON.stringify(got)}`);
        await page.waitForTimeout(600);
        await page.mouse.move(5, 5);
        await page.locator('[data-section="pet"]').scrollIntoViewIfNeeded();
      }, { reducedMotion: 'reduce' })),
    );
    // A font from the computer (Georgia) drawn on the die.
    problems.push(
      ...(await shoot(browser, 'app=appearance&theme=user.u1.georgia-gold', 'appearance-editor-font.png', async (page) => {
        await livePreview(page);
        await page.waitForTimeout(2500); // the worker builds the atlas, then the die is rebuilt
        await page.evaluate(() => (document.querySelector('.dicer-ae-layers').scrollTop = 300));
      }, { reducedMotion: 'reduce' })),
    );
    // The GM's "Push to players..." panel, and a player's view of a locked world default.
    problems.push(
      ...(await shoot(browser, 'app=themes', 'theme-browser-push.png', async (page) => {
        await thumbs(page);
        await page.click('.dicer-theme-card[data-theme="dragon-hoard"]');
        await page.waitForFunction(() => document.querySelector('.dicer-theme-detail')?.dataset.theme === 'dragon-hoard');
        await page.click('[data-action="push"]');
        await page.waitForSelector('.dialog-v2 input[name="replaceAll"]');
      })),
    );
    problems.push(
      ...(await shoot(browser, 'app=themes&player=1&locked=1', 'theme-browser-locked.png', async (page) => {
        await thumbs(page);
        await page.waitForSelector('.dicer-locked');
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
    problems.push(...(await shoot(browser, 'app=benchmark', 'benchmark.png')));
    // The dice tray (dice picked, a modifier, a blind roll) beside chat cards with the hand mark.
    problems.push(
      ...(await shoot(browser, 'app=tray', 'dice-tray.png', async (page) => {
        await page.fill('input[name="d6"]', '2');
        await page.fill('input[name="d20"]', '1');
        await page.fill('input[name="modifier"]', '3');
        await page.selectOption('select[name="mode"]', 'blind');
        const formula = await page.textContent('.dicer-tray-formula');
        if (formula !== '2d6 + 1d20 + 3') throw new Error(`tray: formula line shows "${formula}"`);
        const lit = await page.$$eval('.dicer-tray-die.has-dice', (els) => els.map((e) => e.dataset.die));
        if (lit.join() !== 'd6,d20') throw new Error(`tray: highlighted dice ${lit.join()}`);
        const marks = await page.evaluate(() => window.__marks);
        const want = ['Rolled by hand', 'Rolled by hand (3 dice rolled automatically)', 'Rolled automatically (no throw)', null];
        if (JSON.stringify(marks) !== JSON.stringify(want)) throw new Error(`tray: card marks ${JSON.stringify(marks)}`);
      })),
    );
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
