// Shared by builtin-fx.mjs and fx-perf.mjs: the vite dev server, GPU flags, the fixed ROLL seed
// and area (same as jb2a.mjs), and the JB2A copy into the git-ignored jb2a-local/.
// Env: DICER_VISUAL_PORT (default 5189), DICER_VISUAL_HEADED=1, DICER_VISUAL_ARGS.
import { spawn, spawnSync } from 'node:child_process';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { JB2A_EFFECTS } from '../../src/jb2a/chunk/catalogue.js';

export const PORT = Number(process.env.DICER_VISUAL_PORT || 5189);
export const PAGE = `http://localhost:${PORT}/dev/jb2a.html`;
export const VIEW = { width: 1280, height: 800 };
export const PANEL = 340; // the dev page's control panel: crops stay right of it
export const ROLL = {
  area: {
    left: PANEL + (VIEW.width - PANEL - 360) / 2,
    top: (VIEW.height - 280) / 2,
    width: 360,
    height: 280,
  },
  seed: 20,
};
export const GPU_ARGS = process.env.DICER_VISUAL_ARGS
  ? process.env.DICER_VISUAL_ARGS.split(/\s+/).filter(Boolean)
  : ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'];
export const ARGS = [...GPU_ARGS, '--autoplay-policy=no-user-gesture-required'];
export const ALL_IDS = Object.keys(JB2A_EFFECTS);

const JB2A_SRC = '../jb2a_patreon/Library/Generic';
const JB2A_DEST = 'jb2a-local/jb2a_patreon/Library/Generic';

let server = null;
export function stopServer() {
  if (!server || server.exitCode !== null) return;
  if (process.platform === 'win32')
    spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else server.kill('SIGTERM');
}
process.on('exit', stopServer);

export async function startServer() {
  server = spawn(
    process.execPath,
    [
      'node_modules/vite/bin/vite.js',
      '--config',
      'tests/visual/fx-vite.config.mjs',
      '--port',
      String(PORT),
      '--strictPort',
    ],
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

/** Copies the catalogue's JB2A files into jb2a-local/ (when ../jb2a_patreon exists). */
export async function copyJb2a() {
  let copied = 0;
  for (const rel of mappedFiles()) {
    const from = join(JB2A_SRC, rel);
    const to = join(JB2A_DEST, rel);
    const src = await stat(from);
    const dst = await stat(to).catch(() => null);
    if (dst?.size === src.size) continue;
    await mkdir(join(to, '..'), { recursive: true });
    await copyFile(from, to);
    copied++;
  }
  return copied;
}

/** Collects page problems (console errors, page errors, failed responses). */
export function watchProblems(page) {
  const problems = [];
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => r.status() >= 400 && problems.push(`${r.status()} ${r.url()}`));
  return problems;
}

export const selectedIds = () => {
  const wanted = process.env.DICER_FX_IDS?.split(',').filter(Boolean);
  return wanted?.length ? wanted : ALL_IDS;
};

/**
 * Opens a dev-page url and waits for window.__jb2a. A cold vite run re-optimises dependencies
 * mid-load (504 "Outdated Optimize Dep"), so a page that never becomes ready is reloaded.
 */
export async function gotoReady(page, url) {
  for (let attempt = 0; ; attempt++) {
    await page.goto(url, { waitUntil: 'load' });
    try {
      await page.waitForFunction(() => window.__jb2a, null, {
        timeout: attempt < 3 ? 20000 : 60000,
      });
      return;
    } catch (err) {
      if (attempt >= 3) throw err;
    }
  }
}
