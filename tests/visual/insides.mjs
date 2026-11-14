// Visual check: the living insides, per inside, on real WebGL (dev/insides.html). Writes
// docs/signoff/insides/<round>/<type>.png: rows dark / light table x steps 16 / 48 (plus a
// reduced-motion row), columns motion off, 400 ms into a scripted tumble, 1 s after landing.
// Records every console error / warning and page error per inside (shader compile errors and
// program info logs included) in artifacts/insides/console.json and prints them verbatim.
// Exits 1 on a page error or a shader compile error; D3D info-log warnings are listed, not fatal.
// Args / env: --round <name> (default round-1), DICER_INSIDES=a,b (subset), DICER_VISUAL_*.
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { PORT, ARGS, startServer, stopServer } from './fx-common.mjs';

const ALL = ['liquid', 'liquid-bubble', 'liquid-sand', 'glitter', 'swirl', 'nebula', 'smoke', 'eye', 'runes', 'dragon', 'fire', 'lava'];
const roundAt = process.argv.indexOf('--round');
const ROUND = roundAt > 0 ? process.argv[roundAt + 1] : process.env.DICER_FX_ROUND || 'round-1';
const OUT = `docs/signoff/insides/${ROUND}`;
const ids = process.env.DICER_INSIDES?.split(',').filter(Boolean) ?? ALL;

async function main() {
  await mkdir(OUT, { recursive: true });
  await mkdir('artifacts/insides', { recursive: true });
  await startServer();
  const browser = await chromium.launch({ headless: process.env.DICER_VISUAL_HEADED !== '1', args: ARGS });
  const log = {};
  let code = 0;
  try {
    for (const id of ids) {
      const page = await browser.newPage({ viewport: { width: 1200, height: 1700 } });
      const msgs = [];
      page.on('console', (m) => ['error', 'warning'].includes(m.type()) && msgs.push(`${m.type()}: ${m.text()}`));
      page.on('pageerror', (e) => msgs.push(`pageerror: ${e.message}`));
      page.on('response', (r) => r.status() >= 400 && msgs.push(`http ${r.status()} ${r.url()}`));
      const url = `http://localhost:${PORT}/dev/insides.html?inside=${id}`;
      for (let attempt = 0; ; attempt++) {
        await page.goto(url, { waitUntil: 'load' });
        try {
          await page.waitForFunction(() => window.__insides, null, { timeout: attempt < 3 ? 20000 : 60000 });
          break;
        } catch (err) {
          if (attempt >= 3) throw err;
        }
      }
      await page.evaluate(() => window.__insides.ready);
      await page.evaluate(() => window.__insides.sync());
      const pageErrors = await page.evaluate(() => window.__insides.errors.slice());
      await page.locator('#sheet').screenshot({ path: `${OUT}/${id}.png` });
      log[id] = { pageErrors, console: msgs };
      const fatal = pageErrors.length || msgs.some((m) => /Shader Error|^pageerror|^http /.test(m));
      if (fatal) code = 1;
      console.log(`insides: ${id} -> ${OUT}/${id}.png (${msgs.length} console message(s), ${pageErrors.length} page error(s))${fatal ? ' FAILED' : ''}`);
      for (const m of [...pageErrors, ...msgs]) console.log(`  [${id}] ${m.replace(/\n/g, '\n    ')}`);
      await page.close();
    }
    await writeFile('artifacts/insides/console.json', JSON.stringify(log, null, 2));
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
