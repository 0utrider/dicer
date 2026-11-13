// Feel check of the throw overlay: opens dev/hand.html in Playwright Chromium (GPU on), and for each
// scenario drives the real mouse: hover (the dice float in the area), grab, shake (back and forth),
// flick, and the throw in flight until it lands. Saves a strip of screenshots per scenario to
// DICER_HAND_OUT (default docs/signoff/hand) and prints the read values. Fails on any console
// error, page error or shader error, or when a throw does not resolve with values.
// Env: DICER_VISUAL_PORT (default 5184), DICER_VISUAL_HEADED=1, DICER_HAND_OUT.
import { spawn, spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const PORT = Number(process.env.DICER_VISUAL_PORT || 5184);
const ORIGIN = `http://localhost:${PORT}`;
const OUT = process.env.DICER_HAND_OUT || 'docs/signoff/hand';
const GPU_ARGS = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'];

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
    {
      env: { ...process.env, BROWSER: 'none' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${ORIGIN}/dev/hand.html`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`vite did not start:\n${log}`);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** One scenario: open the overlay, then `gesture(page, centre)`; screenshots along the way. */
async function scenario(page, name, opts, gesture) {
  await page.evaluate((o) => {
    window.__done = null;
    window.__hand.hold(o).then((r) => (window.__done = r));
  }, opts);
  await wait(400); // the dice are in and hovering
  const area = await page.evaluate(
    (w) => (w === 'stage' ? window.__hand.stage() : window.__hand.playerArea()),
    opts.where,
  );
  const c = { x: area.left + area.width / 2, y: area.top + area.height / 2 };
  const shots = [];
  const shot = async (label) => {
    const file = `${OUT}/${name}-${String(shots.length).padStart(2, '0')}-${label}.png`;
    await page.screenshot({ path: file });
    shots.push(file);
  };
  await shot('hover');
  await gesture(page, c, area, shot);
  const deadline = Date.now() + 20000;
  let done = null;
  while (!done && Date.now() < deadline) {
    await wait(100);
    done = await page.evaluate(() => window.__done);
  }
  await shot('landed');
  const holding = await page.evaluate(() => window.__hand.holding());
  const overlays = await page.evaluate(
    () => document.querySelectorAll('.dicer-hand-overlay').length,
  );
  return { name, done, holding, overlays, shots };
}

/** Grab at the centre, shake left-right `shakes` times, then flick by (dx, dy) over `ms`. */
const shakeAndFlick =
  ({ shakes = 6, amp = 70, dx = 260, dy = -160, ms = 70 } = {}) =>
  async (page, c, area, shot) => {
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await wait(120);
    await shot('grabbed');
    // a hand shaking at ~4 Hz: pointer moves 8 ms apart, as a mouse reports them
    let x = c.x;
    const to = async (tx, ty, n) => {
      for (let k = 1; k <= n; k++) {
        await page.mouse.move(x + ((tx - x) * k) / n, c.y + ((ty - c.y) * k) / n);
        await wait(8);
      }
      x = tx;
    };
    let peak = 0;
    for (let i = 0; i < shakes; i++) {
      await to(c.x + amp, c.y + 10, 8);
      await to(c.x - amp, c.y - 10, 8);
      peak = Math.max(
        peak,
        await page.evaluate(
          () =>
            Number(
              getComputedStyle(document.querySelector('.dicer-hand-overlay')).getPropertyValue(
                '--dicer-shake',
              ),
            ) || 0,
        ),
      );
      if (i === Math.floor(shakes / 2)) await shot('shaking');
    }
    console.log(`  shake energy peak ${peak.toFixed(2)}`);
    await page.mouse.move(c.x, c.y, { steps: 2 });
    // the flick: a fast move, then release while still moving
    const steps = Math.max(2, Math.round(ms / 16));
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(c.x + (dx * i) / steps, c.y + (dy * i) / steps);
      await wait(16);
    }
    await page.mouse.up();
    await wait(90);
    await shot('flight-90ms');
    await wait(300);
    await shot('flight-400ms');
  };

async function main() {
  await mkdir(OUT, { recursive: true });
  await startServer();
  const browser = await chromium.launch({
    headless: process.env.DICER_VISUAL_HEADED !== '1',
    args: GPU_ARGS,
  });
  const problems = [];
  const results = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
    page.on('console', (m) => {
      const text = m.text();
      if (m.type() === 'error' || /shader error|program not valid/i.test(text)) problems.push(text);
    });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    await page.goto(`${ORIGIN}/dev/hand.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__hand, null, { timeout: 60000 });

    results.push(
      await scenario(page, 'd20-flick', { dice: ['d20'], where: 'area' }, shakeAndFlick()),
    );
    results.push(
      await scenario(
        page,
        'd20-gentle',
        { dice: ['d20'], where: 'area' },
        shakeAndFlick({ shakes: 3, amp: 20, dx: 60, dy: 30, ms: 120 }),
      ),
    );
    results.push(
      await scenario(
        page,
        'mixed-shake',
        { dice: ['d20', 'd6', 'd8', 'd4'], where: 'area' },
        shakeAndFlick({ shakes: 10, dx: 200, dy: 40 }),
      ),
    );
    // the border: drag far outside the area; the dice stop at its edge, then a gentle drop
    results.push(
      await scenario(
        page,
        'border',
        { dice: ['d6', 'd6'], where: 'area' },
        async (p, c, area, shot) => {
          await p.mouse.move(c.x, c.y);
          await p.mouse.down();
          await p.mouse.move(area.left + area.width + 400, area.top - 300, { steps: 12 });
          await wait(150);
          await shot('dragged-out');
          await wait(300);
          await p.mouse.up();
          await wait(500);
          await shot('dropped');
        },
      ),
    );
    results.push(
      await scenario(
        page,
        'space',
        { dice: ['d6', 'd6', 'd6'], where: 'stage' },
        async (p, c, area, shot) => {
          await p.keyboard.press('Space');
          await wait(400);
          await shot('auto-400ms');
        },
      ),
    );
    results.push(
      await scenario(
        page,
        'ghost',
        { dice: ['d20'], where: 'area', ghost: true },
        shakeAndFlick({ dx: -220, dy: -120 }),
      ),
    );
    results.push(
      await scenario(
        page,
        'tenD6',
        { dice: Array(10).fill('d6'), where: 'area' },
        shakeAndFlick({ shakes: 8, dx: 240, dy: -60 }),
      ),
    );
    results.push(
      await scenario(page, 'escape', { dice: ['d20'], where: 'area' }, async (p, c, area, shot) => {
        await p.keyboard.press('Escape');
        await wait(100);
        await shot('cancelled');
      }),
    );
    // The review page's demos (dev/hand.html): the real DiceBox, hand chunk and pet layer.
    const snap = async (name) => page.screenshot({ path: `${OUT}/demo-${name}.png` });
    const demo = (name) => page.evaluate((n) => window.__hand.demo(n), name);
    for (const name of ['cocked-d20', 'cocked-coin']) {
      const r = await demo(name);
      await snap(name);
      if (!r?.nudges?.[0]) problems.push(`demo ${name}: expected a nudge, got ${JSON.stringify(r)}`);
      if (!Number.isInteger(r?.values?.[0])) problems.push(`demo ${name}: no read value`);
      await wait(4500);
    }
    // the d16: a shot just after landing, while the counted face glows
    {
      const pending = page.evaluate(() => window.__hand.demo('d16-read'));
      await wait(1800);
      await snap('d16-flight');
      const r = await pending;
      await snap('d16-landed');
      if (!(r?.values?.[0] >= 1 && r.values[0] <= 16)) problems.push(`demo d16: bad value ${JSON.stringify(r)}`);
    }
    await wait(500);
    const replayed = await page.evaluate(() => window.__hand.replayLast());
    await snap('replay-half-area');
    if (!replayed?.bytes || replayed.bytes > 262144) problems.push(`demo replay: ${JSON.stringify(replayed)}`);
    await wait(4500);
    const placed = await demo('pet-place');
    await snap('pet-rest');
    if (!placed?.pet) problems.push('demo pet: the pet did not rest');
    const splat = await demo('pet-splat');
    await wait(500);
    await snap('pet-splat');
    console.log(`  pet after the throw: ${JSON.stringify(splat?.pet)}`);
    if (!Array.isArray(splat?.values)) problems.push('demo pet splat: no values');
  } finally {
    await browser.close();
    stopServer();
  }
  for (const r of results)
    console.log(
      JSON.stringify({ name: r.name, done: r.done, holding: r.holding, overlays: r.overlays }),
    );
  const bad = results.filter(
    (r) =>
      (r.name === 'escape' ? !r.done?.cancelled : !Array.isArray(r.done?.values)) ||
      r.holding ||
      r.overlays,
  );
  if (problems.length || bad.length) {
    console.error(
      'hand: problems',
      problems,
      bad.map((r) => r.name),
    );
    process.exit(1);
  }
  console.log(`hand: ok, screenshots in ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  stopServer();
  process.exit(1);
});
