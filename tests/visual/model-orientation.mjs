// Research driver for docs/research/dsn-model-orientation.md (dev/models.html).
// For each model: prints its flat-face normals and saves a sheet of renders looking down each
// one, tagged with the face index (artifacts/models/<file>-faces.png); with a rotations JSON,
// also a sheet of DiceBox-style forced renders tagged v<value> (artifacts/models/<file>-verify.png).
// Usage: node tests/visual/model-orientation.mjs <modelsDir> <file.glb|gltf>:<faceCount>[:<type>] ...
//   [--rotations rotations.json]   ({ "<file.glb>": [x, y, z, w] })   [--each] (one PNG per face too)
// Starts and stops its own Vite dev server on DICER_VISUAL_PORT (default 5179). GLBs are
// served from <modelsDir> through a Playwright route, never copied into the repo.
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const PORT = Number(process.env.DICER_VISUAL_PORT || 5179);
const PAGE = `http://localhost:${PORT}/dev/models.html`;
const args = process.argv.slice(2);
const ri = args.indexOf('--rotations');
const rotations = ri >= 0 ? JSON.parse(await readFile(args.splice(ri, 2)[1], 'utf8')) : {};
const ei = args.indexOf('--each');
const each = ei >= 0 && args.splice(ei, 1).length > 0;
const [dir, ...items] = args;

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
const save = (file, url) => writeFile(file, Buffer.from(url.split(',')[1], 'base64'));
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
  const page = await browser.newPage({ viewport: { width: 400, height: 500 } });
  await page.route('**/models/**', async (route) => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^.*?\/models\//, ''));
    route.fulfill({ body: await readFile(join(dir, rel)) });
  });
  await page.goto(PAGE);
  await page.waitForFunction(() => window.__models);
  await mkdir('artifacts/models', { recursive: true });
  const report = {};
  for (const item of items) {
    const [file, count, type] = item.split(':');
    await page.evaluate((u) => window.__models.load(u), `/models/${file}`);
    const faces = await page.evaluate((n) => window.__models.clusters(n), Number(count));
    report[file] = faces;
    const shots = [];
    for (const f of faces) shots.push(await page.evaluate((n) => window.__models.shot(n), f.normal));
    if (each) for (const [i, u] of shots.entries()) await save(`artifacts/models/${file}-face${i}.png`, u);
    await save(`artifacts/models/${file}-faces.png`, await page.evaluate((u) => window.__models.sheet(u), shots));
    const q = rotations[file];
    if (q && type) {
      const values = await page.evaluate(
        async (t) => (await import('/src/core/dice-shapes.js')).getShape(t).values,
        type,
      );
      const forced = [];
      for (const v of values) {
        forced.push(await page.evaluate(([t, qq, vv]) => window.__models.verify(t, qq, vv), [type, q, v]));
      }
      const tags = values.map((v) => `v${v}`);
      const url = await page.evaluate(([u, t]) => window.__models.sheet(u, 160, t), [forced, tags]);
      await save(`artifacts/models/${file}-verify.png`, url);
    }
  }
  for (const [f, faces] of Object.entries(report)) {
    console.log(f);
    faces.forEach((x, i) => console.log(`  face${i} ${JSON.stringify(x.normal)} area ${x.area}`));
  }
  const errors = await page.evaluate(() => window.__models.errors.slice());
  if (errors.length) console.error(errors.join('\n'));
  await browser.close();
  code = errors.length ? 1 : 0;
} finally {
  stop();
}
process.exit(code);
