// Visual check: elemental trails. Throws a resin d20 with a fire, a frost, a storm and a lava inside
// and plain ones with damageType 'acid', 'void', 'vitality', 'poison', 'sonic', 'force', 'mental',
// 'spirit', 'bleed', 'slashing', 'piercing' and 'bludgeoning' (trail 2, no landing effects) on the
// dark and the light backdrop, with jb2a=off, and writes
// docs/signoff/elemental-trails/<round>/trails.png: rows are element x backdrop, columns are three
// in-flight shots and one 600 ms after landing. An in-flight shot is taken no earlier than 150, 400
// and 700 ms into the flight (from the frame the die is first placed) and 150 ms after the last one,
// and only once the die is actually moving (its speed over MOVING u/s for two frames running, so a
// die paused mid-throw is not caught trail-less) and on screen (it enters from above the view),
// else after MOVE_WAIT ms (the label says so). One unrecorded warm-up throw per element first (the
// first flight of a look stalls on its shader compile). Each frame is a crop centred on the die. Fails on any page error.
// Env: DICER_TRAILS_ROUND (folder label, default "round-1"), DICER_TRAILS_TIMES (flight shot times
// in ms, comma-separated, default 150,400,700), DICER_TRAILS_ONLY (element names, comma-separated,
// default all rows), plus the DICER_VISUAL_* variables of fx-common.mjs.
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import {
  PAGE,
  PANEL,
  VIEW,
  ROLL,
  ARGS,
  startServer,
  stopServer,
  gotoReady,
  watchProblems,
} from './fx-common.mjs';

const ROUND = process.env.DICER_TRAILS_ROUND || 'round-1';
const OUT = `docs/signoff/elemental-trails/${ROUND}`;
const CROP = { width: 520, height: 420 };
const SCALE = 0.6;
const FLIGHT = process.env.DICER_TRAILS_TIMES?.split(',')
  .map(Number)
  .filter((t) => t > 0) ?? [150, 400, 700];
const AFTER = 600;
/** A shot in flight waits for the die to move faster than this (world units/s; trails emit from 1.5). */
const MOVING = 5;
/** ... but no longer than this (ms) per shot. */
const MOVE_WAIT = 2500;
/** In-flight shots are at least this far apart (ms). */
const SHOT_GAP = 150;
const BACKDROPS = ['dark', 'light'];
const ONLY = process.env.DICER_TRAILS_ONLY?.split(',')
  .map((s) => s.trim())
  .filter(Boolean);
/** A plain resin die with no inside: its damage type gives the element. */
const plain = (name, color, color2, ink) => ({
  name,
  damageType: name,
  appearance: {
    body: { type: 'resin', color, color2, roughness: 0.05 },
    interior: { type: 'none' },
    numbers: { fill: 'silver', color: ink, depth: 0.5 },
  },
});
const ALL = [
  {
    name: 'fire',
    appearance: {
      body: { type: 'resin', color: '#3a0f06', color2: '#140402', roughness: 0.05 },
      interior: { type: 'fire', colors: ['#ff6a10', '#ffc24a'], density: 0.7 },
      numbers: { fill: 'gold', color: '#ffd9a0', depth: 0.5 },
    },
  },
  {
    name: 'frost',
    appearance: {
      body: { type: 'resin', color: '#bfe3f5', color2: '#6fb2d4', roughness: 0.04 },
      interior: { type: 'frost', colors: ['#ffffff', '#8fd3ff'], density: 0.6 },
      numbers: { fill: 'silver', color: '#2a4a60', depth: 0.5 },
    },
  },
  {
    name: 'storm',
    appearance: {
      body: { type: 'resin', color: '#1a1f3a', color2: '#0a0c1c', roughness: 0.05 },
      interior: { type: 'storm', colors: ['#8fb4ff', '#ffffff'], density: 0.6 },
      numbers: { fill: 'silver', color: '#e6eeff', depth: 0.5 },
    },
  },
  {
    name: 'lava',
    appearance: {
      body: { type: 'resin', color: '#2a0a04', color2: '#100302', roughness: 0.05 },
      interior: { type: 'lava', colors: ['#ff4a0a', '#ffb43a'], density: 0.7 },
      numbers: { fill: 'gold', color: '#ffd9a0', depth: 0.5 },
    },
  },
  {
    // Acid has no inside: a plain resin die whose damage type gives the element.
    name: 'acid',
    damageType: 'acid',
    appearance: {
      body: { type: 'resin', color: '#2f5a1a', color2: '#12240a', roughness: 0.05 },
      interior: { type: 'none' },
      numbers: { fill: 'silver', color: '#e8ffd0', depth: 0.5 },
    },
  },
  plain('void', '#2a1a3a', '#0c0612', '#e6d8ff'),
  plain('vitality', '#f2e2b0', '#c8a050', '#5a3a08'),
  plain('poison', '#4a5a1e', '#1c240a', '#eaffc0'),
  plain('sonic', '#f3e6b8', '#d9c27a', '#3a2d0a'),
  plain('force', '#2a0f5e', '#0d0524', '#efe6ff'),
  plain('mental', '#4a0f3e', '#1d0518', '#ffe6f4'),
  plain('spirit', '#0c3a4a', '#04141c', '#e6fbff'),
  plain('bleed', '#5a0c12', '#200406', '#ffe0e0'),
  plain('slashing', '#9aa3ae', '#5a626c', '#14181e'),
  plain('piercing', '#d6dbe2', '#9ca4ae', '#1a1e24'),
  plain('bludgeoning', '#6e5c48', '#3a2e22', '#f4ead8'),
];
const ELEMENTS = ONLY?.length ? ALL.filter((el) => ONLY.includes(el.name)) : ALL;

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
  const buf = await page.screenshot({ type: 'jpeg', quality: 88, clip: { x, y, ...CROP } });
  return buf.toString('base64');
}

/**
 * Throws one die straight through DiceBox.roll (the dev page's roll() would drop trail and
 * appearance) and returns the frames, the flight's length and the shot times actually hit.
 */
async function capture(page, appearance, damageType) {
  await page.evaluate(
    ([look, opts, dmg]) => {
      window.__trail = { placedAt: null, landedAt: null, speeds: [], speed: 0, last: 0 };
      const box = window.__jb2a.box;
      const r = box.roll(
        [
          {
            type: 'd20',
            value: 20,
            trail: 2,
            appearance: look,
            ...(dmg ? { damageType: dmg } : {}),
          },
        ],
        opts,
      );
      const watch = () => {
        const die = [...box._rolls].at(-1)?.dice?.[0];
        const now = performance.now();
        if (die?.outer?.visible) {
          const p = die.outer.position;
          const tr = window.__trail;
          // on screen: the die's centre projects inside the middle 80% of the view
          const v = die.outer.getWorldPosition(p.clone()).project(box._renderer.camera);
          tr.onScreen = Math.abs(v.x) < 0.8 && Math.abs(v.y) < 0.8;
          if (tr.placedAt === null) tr.placedAt = now;
          else if (now > tr.t) {
            const v = Math.hypot(p.x - tr.x, p.y - tr.y, p.z - tr.z) / ((now - tr.t) / 1000);
            tr.speeds.push([Math.round(now - tr.placedAt), v]);
            tr.speed = Math.min(v, tr.last); // two frames running: one jittery frame is not motion
            tr.last = v;
          }
          Object.assign(tr, { x: p.x, y: p.y, z: p.z, t: now });
        }
        if (window.__trail.landedAt === null) requestAnimationFrame(watch);
      };
      requestAnimationFrame(watch);
      r.landed.then(() => (window.__trail.landedAt = performance.now()));
    },
    [appearance, ROLL, damageType ?? null],
  );
  await page.waitForFunction(() => window.__trail.placedAt !== null, null, {
    timeout: 20000,
    polling: 'raf',
  });
  const t0 = Date.now();
  const shots = [];
  const hit = [];
  const moving = [];
  let prev = -Infinity;
  for (const t of FLIGHT) {
    const wait = t0 + Math.max(t, prev + SHOT_GAP) - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);
    // Shoot within the flight only while the die moves: a die paused mid-throw shows no trail.
    const ok = await page
      .waitForFunction((v) => window.__trail.speed > v && window.__trail.onScreen, MOVING, {
        timeout: MOVE_WAIT,
        polling: 'raf',
      })
      .then(() => true)
      .catch(() => false);
    prev = Date.now() - t0;
    hit.push(prev);
    moving.push(ok);
    shots.push(await shot(page));
  }
  await page.waitForFunction(() => window.__trail.landedAt !== null, null, {
    timeout: 20000,
    polling: 'raf',
  });
  const { flightMs, speedAt } = await page.evaluate((times) => {
    const tr = window.__trail;
    // the die's speed (world units/s) near each flight shot, for tuning the recipes' speed scale
    const near = (t) => tr.speeds.find(([at]) => at >= t)?.[1] ?? 0;
    return {
      flightMs: Math.round(tr.landedAt - tr.placedAt),
      speedAt: times.map((t) => Math.round(near(t))),
    };
  }, hit);
  const landed = Date.now();
  await page.waitForTimeout(AFTER);
  hit.push(Date.now() - landed);
  shots.push(await shot(page));
  await page
    .waitForFunction(() => window.__jb2a.box._rolls.size === 0, null, { timeout: 10000 })
    .catch(() => {});
  await page.waitForTimeout(400);
  return { shots, flightMs, hit, speedAt, moving };
}

const tw = Math.round(CROP.width * SCALE);
const th = Math.round(CROP.height * SCALE);
const LABEL_W = 170;

async function writeSheet(browser, file, title, rows) {
  const cols = [
    ...FLIGHT.map((t) => `in flight, >= ${t} ms, moving, on screen`),
    `landed +${AFTER} ms`,
  ];
  const head = `<div style="display:flex;margin-left:${LABEL_W}px">${cols
    .map((c) => `<div style="width:${tw + 4}px;text-align:center">${c}</div>`)
    .join('')}</div>`;
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
    viewport: { width: LABEL_W + cols.length * (tw + 4), height: 56 + rows.length * (th + 4) },
  });
  await sheet.setContent(
    `<body style="margin:0;background:#1d1f23;color:#fff;font:16px sans-serif"><div style="padding:4px 8px;font-weight:600">${title}</div>${head}${body}</body>`,
  );
  await sheet.screenshot({ path: file });
  await sheet.close();
  console.log(`trails: saved ${file}`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await startServer();
  const browser = await chromium.launch({
    headless: process.env.DICER_VISUAL_HEADED !== '1',
    args: ARGS,
  });
  try {
    const page = await browser.newPage({ viewport: VIEW });
    const problems = watchProblems(page);
    await gotoReady(page, `${PAGE}?jb2a=off`);
    const rows = [];
    for (const el of ELEMENTS) {
      await capture(page, el.appearance, el.damageType); // warm-up (compiles its look), not recorded
      for (const bg of BACKDROPS) {
        await page.evaluate((b) => window.__jb2a.setBg(b), bg);
        const { shots, flightMs, hit, speedAt, moving } = await capture(
          page,
          el.appearance,
          el.damageType,
        );
        const still = moving.filter((m) => !m).length;
        console.log(
          `trails: ${el.name} ${bg}: flight ${flightMs} ms, shots at ${hit.join(', ')} ms, speed ${speedAt.join(', ')} u/s${still ? `, ${still} shot(s) never saw it move` : ''}`,
        );
        const at = hit.slice(0, -1).join(' / ');
        const warn = still
          ? `<br><small style="color:#ff8080">${still} shot(s) not moving</small>`
          : '';
        rows.push({
          label: `${el.name} / ${bg}<br><small>flight ${flightMs} ms<br>shots ${at} ms</small>${warn}`,
          shots,
        });
      }
    }
    await writeSheet(browser, `${OUT}/trails.png`, `Elemental trails (${ROUND}, jb2a=off)`, rows);
    problems.push(...(await page.evaluate(() => window.__jb2a.errors.slice())));
    if (problems.length) {
      console.error(`trails: FAILED\n${problems.join('\n')}`);
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
