// Visual check: the built-in effects, per id, on both backdrops in five colours. Plays each of the
// ten JB2A-mapped ids on a d20 with jb2a=off and writes docs/signoff/builtin-fx/<round>/<id>.png:
// rows are the five colours x dark/light backdrop, columns are 120/350/700/1100/1700 ms after
// landing. When jb2a-local/ exists (populated from ../jb2a_patreon), it also writes the git-ignored
// artifacts/builtin-fx/<round>/<id>-vs-jb2a.png: Dicer above JB2A, default colour, dark backdrop.
// Fails on any page error. Env: DICER_FX_IDS (comma-separated), DICER_FX_ROUND (folder label,
// default "round-1"), plus the DICER_VISUAL_* variables of fx-common.mjs.
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import {
  PAGE,
  PANEL,
  VIEW,
  ROLL,
  ARGS,
  startServer,
  stopServer,
  copyJb2a,
  gotoReady,
  selectedIds,
} from './fx-common.mjs';

const ROUND = process.env.DICER_FX_ROUND || 'round-1';
const OUT = `docs/signoff/builtin-fx/${ROUND}`;
const REF_OUT = `artifacts/builtin-fx/${ROUND}`;
const CROP = { width: 480, height: 380 };
const SCALE = 0.5;
const TIMES = [120, 350, 700, 1100, 1700];
const COLORS = [
  { name: 'default', value: null },
  { name: '#f4f4f4', value: '#f4f4f4' },
  { name: '#141418', value: '#141418' },
  { name: '#e02020', value: '#e02020' },
  { name: '#2050ff', value: '#2050ff' },
];
const BACKDROPS = ['dark', 'light'];

/** A crop of the viewport centred on the last roll's die, as base64 jpeg. */
async function shot(page) {
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
}

/** Rolls `id` once and returns the frames at TIMES ms after landing; waits for the die to go. */
async function capture(page, id) {
  await page.evaluate(() => (window.__jb2aLanded = false));
  const rolled = page.evaluate(
    ([i, opts]) => window.__jb2a.playEffect(i, opts).then(() => (window.__jb2aLanded = true)),
    [id, ROLL],
  );
  await page.waitForFunction(() => window.__jb2aLanded, null, { timeout: 20000, polling: 'raf' });
  const t0 = Date.now();
  const shots = [];
  for (const t of TIMES) {
    const wait = t0 + t - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);
    shots.push(await shot(page));
  }
  await rolled;
  // the die hides and the effect ends before the next roll
  await page
    .waitForFunction(() => window.__jb2a.box._rolls.size === 0, null, { timeout: 10000 })
    .catch(() => {});
  await page.waitForTimeout(400);
  return shots;
}

const tw = Math.round(CROP.width * SCALE);
const th = Math.round(CROP.height * SCALE);
const LABEL_W = 150;

/** Renders rows ({label, shots}) to a PNG: a header of times, then one row per entry. */
async function writeSheet(browser, file, title, rows) {
  const head = `<div style="display:flex;margin-left:${LABEL_W}px">${TIMES.map(
    (t) => `<div style="width:${tw + 4}px;text-align:center">+${t} ms</div>`,
  ).join('')}</div>`;
  const body = rows
    .map(
      (r) =>
        `<div style="display:flex;align-items:center"><div style="width:${LABEL_W}px;padding:6px;box-sizing:border-box;font-size:13px">${r.label}</div>${r.shots
          .map(
            (b) =>
              `<img src="data:image/jpeg;base64,${b}" style="width:${tw}px;height:${th}px;margin:2px">`,
          )
          .join('')}</div>`,
    )
    .join('');
  const sheet = await browser.newPage({
    viewport: { width: LABEL_W + TIMES.length * (tw + 4), height: 56 + rows.length * (th + 4) },
  });
  await sheet.setContent(
    `<body style="margin:0;background:#1d1f23;color:#fff;font:16px sans-serif"><div style="padding:4px 8px;font-weight:600">${title}</div>${head}${body}</body>`,
  );
  await sheet.screenshot({ path: file });
  await sheet.close();
  console.log(`builtin-fx: saved ${file}`);
}

async function openPage(browser, query, problems) {
  const page = await browser.newPage({ viewport: VIEW });
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => r.status() >= 400 && problems.push(`${r.status()} ${r.url()}`));
  await gotoReady(page, `${PAGE}?${query}`);
  return page;
}

async function main() {
  const ids = selectedIds();
  await mkdir(OUT, { recursive: true });
  await startServer();
  const browser = await chromium.launch({
    headless: process.env.DICER_VISUAL_HEADED !== '1',
    args: ARGS,
  });
  const problems = [];
  try {
    const page = await openPage(browser, 'jb2a=off', problems);
    const known = await page.evaluate(() => window.__jb2a.ids);
    const unknown = ids.filter((id) => !known.includes(id));
    if (unknown.length) throw new Error(`unknown effect id(s): ${unknown.join(', ')}`);

    for (const id of ids) {
      const rows = [];
      for (const bg of BACKDROPS) {
        for (const c of COLORS) {
          await page.evaluate(
            ([b, v]) => {
              window.__jb2a.setBg(b);
              window.__jb2a.setColor(v);
            },
            [bg, c.value],
          );
          rows.push({ label: `${bg} ${c.name}`, shots: await capture(page, id) });
        }
      }
      await writeSheet(browser, `${OUT}/${id}.png`, `${id} (built-in, jb2a=off)`, rows);
    }
    await page.evaluate(() => window.__jb2a.setColor(null));
    problems.push(...(await page.evaluate(() => window.__jb2a.errors.slice())));
    await page.close();

    if (existsSync('../jb2a_patreon') && !existsSync('jb2a-local')) await copyJb2a();
    if (!existsSync('jb2a-local')) {
      console.log('builtin-fx: jb2a-local missing, reference skipped');
    } else {
      await copyJb2a();
      await mkdir(REF_OUT, { recursive: true });
      const ours = await openPage(browser, 'jb2a=off&bg=dark', problems);
      const ref = await openPage(browser, 'jb2a=on&bg=dark', problems);
      for (const id of ids) {
        const rows = [
          { label: 'Dicer', shots: await capture(ours, id) },
          { label: 'JB2A', shots: await capture(ref, id) },
        ];
        await writeSheet(browser, `${REF_OUT}/${id}-vs-jb2a.png`, `${id}: Dicer vs JB2A`, rows);
      }
      for (const p of [ours, ref])
        problems.push(...(await p.evaluate(() => window.__jb2a.errors.slice())));
    }

    if (problems.length) {
      console.error(`builtin-fx: FAILED\n${problems.join('\n')}`);
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
