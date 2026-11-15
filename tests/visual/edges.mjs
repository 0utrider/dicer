// Close-ups of the edge-strip rows (dev/looks.js EDGE_ROWS: paint, metal, glow on opaque, resin
// and metal bodies at radius 0.25 and 1, plus a metal strip on gem and wood) on the d6, d20 and
// the d2 rim, at 360 px. Saves artifacts/visual/edge-<row>-<type>-<tier>.png and exits 1 on any
// page or GL compile/link error (the gallery compiles every row's program first).
// Usage: node tests/visual/edges.mjs [tier] (default high). Starts and stops its own Vite dev
// server on DICER_VISUAL_PORT (default 5179).
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const PORT = Number(process.env.DICER_VISUAL_PORT || 5179);
const PAGE = `http://localhost:${PORT}/dev/looks.html`;
const TIER = process.argv[2] || 'high';
const TYPES = ['d6', 'd20', 'd2'];
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
  // three logs compile/link failures with console.error (and onShaderError reports them into
  // __looks.errors); ANGLE's HLSL warnings arrive as console.warn and are only counted
  const consoleErrors = [];
  let warnings = 0;
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
    else if (m.type() === 'warning' && /THREE\.WebGLProgram/.test(m.text())) warnings++;
  });
  await page.goto(PAGE);
  await page.waitForFunction(() => window.__looks);
  await page.evaluate(() => window.__looks.ready);
  await page.evaluate((t) => window.__looks.setTier(t), TIER);
  const info = await page.evaluate(() => window.__looks.info?.());
  if (info) console.log(JSON.stringify(info));
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('#grid .row small:first-of-type')].map((s) => s.textContent).filter((id) => id.startsWith('edge~')),
  );
  await mkdir('artifacts/visual', { recursive: true });
  for (const id of rows) {
    for (const type of TYPES) {
      const url = await page.evaluate(([i, t]) => window.__looks.closeup(i, t, 360), [id, type]);
      const file = `artifacts/visual/${id.replace('~', '-')}-${type}-${TIER}.png`;
      await writeFile(file, Buffer.from(url.split(',')[1], 'base64'));
      console.log(file);
    }
  }
  const errors = [...(await page.evaluate(() => window.__looks.errors.slice())), ...consoleErrors];
  if (errors.length) console.error(errors.join('\n'));
  else console.log(`${rows.length} edge rows x ${TYPES.length} types, no page or GL errors (${warnings} program info-log warnings)`);
  await browser.close();
  code = errors.length || !rows.length ? 1 : 0;
} finally {
  stop();
}
process.exit(code);
