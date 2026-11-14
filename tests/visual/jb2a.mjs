// Visual check: JB2A animations on a die. Copies the catalogue's files from ../jb2a_patreon into
// the git-ignored jb2a-local/, opens dev/jb2a.html in Playwright Chromium, and for each mapped
// effect rolls a d20, capturing it mid-flight and at 120/350/700/1100/1700 ms after landing,
// cropped around the die. Saves docs/signoff/jb2a/sheet-N.png, one per 3 effects. Fails on any
// page error; exits 0 with a note when ../jb2a_patreon is absent. Same server and GPU-flag
// approach as effects.mjs, plus autoplay for the videos.
// Env: DICER_VISUAL_PORT (default 5189), DICER_VISUAL_HEADED=1, DICER_VISUAL_ARGS,
// DICER_JB2A_IDS (comma-separated subset of effect ids).
import { spawn, spawnSync } from 'node:child_process';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { JB2A_EFFECTS } from '../../src/jb2a/chunk/catalogue.js';

const PORT = Number(process.env.DICER_VISUAL_PORT || 5189);
const PAGE = `http://localhost:${PORT}/dev/jb2a.html`;
const SRC = '../jb2a_patreon/Library/Generic';
const DEST = 'jb2a-local/jb2a_patreon/Library/Generic';
const OUT = 'docs/signoff/jb2a';
const VIEW = { width: 1280, height: 800 };
const PANEL = 340; // the dev page's control panel: crops stay right of it
const CROP = { width: 600, height: 460 };
const SCALE = 0.62; // thumbnails on the sheet
const MID_FLIGHT_MS = 250;
// Every roll lands in a small area mid-stage, from one seed, so crops centre on the die and
// re-runs land alike while tuning.
const ROLL = {
  area: {
    left: PANEL + (VIEW.width - PANEL - 360) / 2,
    top: (VIEW.height - 280) / 2,
    width: 360,
    height: 280,
  },
  seed: 20,
};
const TIMES = [120, 350, 700, 1100, 1700];
const PER_SHEET = 3;
const GPU_ARGS = process.env.DICER_VISUAL_ARGS
  ? process.env.DICER_VISUAL_ARGS.split(/\s+/).filter(Boolean)
  : ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'];
const ARGS = [...GPU_ARGS, '--autoplay-policy=no-user-gesture-required'];

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

/** Every file the catalogue names (defaults and colour variants), as `dir/file`. */
function mappedFiles() {
  const files = new Set();
  for (const layers of Object.values(JB2A_EFFECTS))
    for (const l of layers) {
      files.add(`${l.dir}/${l.file}`);
      for (const v of l.variants ?? []) files.add(`${l.dir}/${v.file}`);
    }
  return [...files];
}

async function copyMapped() {
  let copied = 0;
  for (const rel of mappedFiles()) {
    const from = join(SRC, rel);
    const to = join(DEST, rel);
    const src = await stat(from); // throws on a file the catalogue names but JB2A lacks
    const dst = await stat(to).catch(() => null);
    if (dst?.size === src.size) continue;
    await mkdir(join(to, '..'), { recursive: true });
    await copyFile(from, to);
    copied++;
  }
  console.log(`jb2a: ${copied} file(s) copied to ${DEST}`);
}

async function main() {
  if (!existsSync(SRC)) {
    console.log('jb2a: skipped (no ../jb2a_patreon)');
    return 0;
  }
  await copyMapped();
  await mkdir(OUT, { recursive: true });
  await startServer();
  const browser = await chromium.launch({
    headless: process.env.DICER_VISUAL_HEADED !== '1',
    args: ARGS,
  });
  try {
    const page = await browser.newPage({ viewport: VIEW });
    const problems = [];
    page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('response', (r) => r.status() >= 400 && problems.push(`${r.status()} ${r.url()}`));
    await page.goto(PAGE, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__jb2a, null, { timeout: 60000 });

    /** A crop of the viewport centred on the last roll's die. */
    const shot = async () => {
      const at = await page.evaluate(() => {
        const box = window.__jb2a.box;
        const o = [...box._rolls].at(-1)?.dice?.[0]?.outer;
        if (!o) return null;
        const v = o.getWorldPosition(o.position.clone()).project(box._renderer.camera);
        const c = box._renderer.canvas.getBoundingClientRect();
        return { x: c.left + ((v.x + 1) / 2) * c.width, y: c.top + ((1 - v.y) / 2) * c.height };
      });
      const cx = at?.x ?? (PANEL + VIEW.width) / 2;
      const cy = at?.y ?? VIEW.height / 2;
      const x = Math.round(Math.max(PANEL, Math.min(VIEW.width - CROP.width, cx - CROP.width / 2)));
      const y = Math.round(Math.max(0, Math.min(VIEW.height - CROP.height, cy - CROP.height / 2)));
      const buf = await page.screenshot({ type: 'jpeg', quality: 85, clip: { x, y, ...CROP } });
      return buf.toString('base64');
    };

    const wanted = process.env.DICER_JB2A_IDS?.split(',').filter(Boolean);
    const ids = (await page.evaluate(() => window.__jb2a.ids)).filter(
      (id) => !wanted || wanted.includes(id),
    );
    const rows = [];
    for (const id of ids) {
      await page.evaluate(() => (window.__jb2aLanded = false));
      const rolled = page.evaluate(
        ([i, opts]) => window.__jb2a.playEffect(i, opts).then(() => (window.__jb2aLanded = true)),
        [id, ROLL],
      );
      await page.waitForTimeout(MID_FLIGHT_MS);
      const shots = [await shot()];
      await page.waitForFunction(() => window.__jb2aLanded, null, {
        timeout: 20000,
        polling: 'raf',
      });
      const t0 = Date.now();
      for (const t of TIMES) {
        const wait = t0 + t - Date.now();
        if (wait > 0) await page.waitForTimeout(wait);
        shots.push(await shot());
      }
      await rolled;
      await page.waitForTimeout(5000); // the die hides and the effect ends before the next roll
      rows.push({ id, shots });
      console.log(`jb2a: captured ${id}`);
    }

    const tw = Math.round(CROP.width * SCALE);
    const th = Math.round(CROP.height * SCALE);
    const labels = ['mid-flight', ...TIMES.map((t) => `+${t} ms`)];
    for (let s = 0; s < rows.length; s += PER_SHEET) {
      const group = rows.slice(s, s + PER_SHEET);
      const head = `<div style="display:flex;margin-left:130px">${labels
        .map((l) => `<div style="width:${tw + 4}px;text-align:center">${l}</div>`)
        .join('')}</div>`;
      const body = group
        .map(
          (r) =>
            `<div style="display:flex;align-items:center"><div style="width:130px;padding:6px;box-sizing:border-box">${r.id}</div>${r.shots
              .map(
                (b) =>
                  `<img src="data:image/jpeg;base64,${b}" style="width:${tw}px;height:${th}px;margin:2px">`,
              )
              .join('')}</div>`,
        )
        .join('');
      const sheet = await browser.newPage({
        viewport: { width: 130 + labels.length * (tw + 4), height: 24 + group.length * (th + 4) },
      });
      await sheet.setContent(
        `<body style="margin:0;background:#1d1f23;color:#fff;font:16px sans-serif">${head}${body}</body>`,
      );
      const file = `${OUT}/sheet-${s / PER_SHEET + 1}.png`;
      await sheet.screenshot({ path: file });
      await sheet.close();
      console.log(`jb2a: saved ${file}`);
    }

    problems.push(...(await page.evaluate(() => window.__jb2a.errors.slice())));
    if (problems.length) {
      console.error(`jb2a: FAILED\n${problems.join('\n')}`);
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
