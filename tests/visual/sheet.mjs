// Close-up contact sheet (dev/looks.html closeup()): one PNG holding several looks at 3x the
// gallery cell (384 px each), labelled. The sign-off sheet is the default: the 6 hero looks.
// Usage: node tests/visual/sheet.mjs [tier] [out] [look:type,look:type,...]
//   defaults: high, artifacts/visual/closeups.png, the hero set below.
// Starts and stops its own Vite dev server on DICER_VISUAL_PORT (default 5179).
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { chromium } from 'playwright';

const PORT = Number(process.env.DICER_VISUAL_PORT || 5179);
const PAGE = `http://localhost:${PORT}/dev/looks.html`;
const TIER = process.argv[2] || 'high';
const OUT = process.argv[3] || 'artifacts/visual/closeups.png';
const HERO = [
  ['default', 'd20'],
  ['abyss-liquid', 'd12'],
  ['galaxy-nebula', 'd10'],
  ['dwarven-brass', 'd20'],
  ['marble-white', 'd12'],
  ['pearl-moon', 'd8'],
];
const SHOTS = process.argv[4] ? process.argv[4].split(',').map((s) => s.split(':')) : HERO;
const SIZE = 384; // 3 x the 128 px gallery cell

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
  try {
    const page = await browser.newPage({ viewport: { width: 1140, height: 1000 } });
    await page.goto(PAGE);
    await page.waitForFunction(() => window.__looks);
    await page.evaluate(() => window.__looks.ready);
    await page.evaluate((t) => window.__looks.setTier(t), TIER);
    const url = await page.evaluate(
      async ([shots, size, tier]) => {
        const cols = Math.min(3, shots.length);
        const rows = Math.ceil(shots.length / cols);
        const label = 28;
        const sheet = document.createElement('canvas');
        sheet.width = cols * size;
        sheet.height = rows * (size + label);
        const g = sheet.getContext('2d');
        g.fillStyle = '#2b2f36'; // the preview page's table colour
        g.fillRect(0, 0, sheet.width, sheet.height);
        g.font = '15px system-ui, sans-serif';
        for (let i = 0; i < shots.length; i++) {
          const [id, type] = shots[i];
          const img = new Image();
          img.src = window.__looks.closeup(id, type, size);
          await img.decode();
          const x = (i % cols) * size;
          const y = Math.floor(i / cols) * (size + label);
          g.drawImage(img, x, y + label, size, size);
          g.fillStyle = '#e8e8e8';
          g.fillText(`${id} · ${type} · ${tier}`, x + 10, y + 19);
        }
        return sheet.toDataURL('image/png');
      },
      [SHOTS, SIZE, TIER],
    );
    await mkdir(dirname(OUT), { recursive: true });
    await writeFile(OUT, Buffer.from(url.split(',')[1], 'base64'));
    const errors = await page.evaluate(() => window.__looks.errors.slice());
    if (errors.length) console.error(errors.join('\n'));
    console.log(`sheet: ${SHOTS.length} close-ups at ${SIZE} px (${TIER}) -> ${OUT}`);
    code = errors.length ? 1 : 0;
  } finally {
    await browser.close();
  }
} finally {
  stop();
}
process.exit(code);
