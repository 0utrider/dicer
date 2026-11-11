// Live roll-area test: a GM and a player (B) against a running local Foundry. Owner-run (needs
// Foundry), same environment variables as compat.mjs. It reads no roll values. It reads each
// client's latest roll from game.dice3d._debug.lastRollArea: the settled die centres (die units
// from the stage centre, x right, z down), the area the throw used, and the stage.
//
// What is compared (this is the landing check, not just the area choice):
//   expected = the area the module should use, resolved independently on that client
//              (game.dice3d.rollAreas.rect(B), or resolveArea(gmPrivate def, stage) for the GM corner);
//   effective = lastRollArea.area in px: the expected rect grown around its centre to hold the dice
//              (CAPACITY_PER_DIE, so a throw's area can exceed the drawn rectangle), inside the stage.
//   Checks: effective contains expected; effective lies inside the stage; and EVERY settled die
//   centre lies inside effective.
//
// Scenarios:
//   1. The GM gives player B the `corner` area (game.dice3d.rollAreas.set). B rolls publicly. On
//      both clients the dice settle inside B's area as above, and B's rect is smaller than the stage.
//   2. With gmPrivateCorner on and a distinct GM private area, a GM blind roll settles in that area
//      on the GM client, and the player's client draws nothing (its latest roll is unchanged).
// Each client's areaScale is set to 1 for the run. Settings (rollAreas, gmPrivateArea,
// gmPrivateCorner, perPlayerAreas, areaScale) are restored in finally.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const URL_BASE = (process.env.DICER_FOUNDRY_URL || 'http://localhost:30000').replace(/\/+$/, '');
const GM_USER = process.env.DICER_GM_USER;
const GM_PASSWORD = process.env.DICER_GM_PASSWORD;
const PLAYER_USER = process.env.DICER_PLAYER_USER;
const PLAYER_PASSWORD = process.env.DICER_PLAYER_PASSWORD;
const OUT = 'artifacts/live/areas.json';
const POLL_TIMEOUT_MS = 20000; // how long a client gets to record the roll
const GRACE_MS = 2500; // how long a client that must not roll is watched
const TOL = 1; // px tolerance on rect containment
const GM_PRIVATE = { preset: 'custom', x: 0.02, y: 0.55, w: 0.3, h: 0.4 }; // bottom-left, not the corner preset

function die(message) {
  console.error(`areas: ${message}`);
  process.exit(1);
}

async function rpc(page, method, data) {
  return page.evaluate(
    async ({ method, data }) => {
      const api = await import('/modules/dicer/tests/live/world.js');
      if (typeof api[method] !== 'function') throw Error(`Unknown live-test RPC: ${method}`);
      return api[method](data);
    },
    { method, data },
  );
}

async function login(page, user, password) {
  await page.goto(`${URL_BASE}/join`);
  const select = page.locator('select[name="userid"], select[name="userId"]');
  await page
    .locator('select[name="userid"], select[name="userId"], input[name="username"]')
    .first()
    .waitFor();
  if (await select.count()) {
    const options = await select
      .locator('option')
      .evaluateAll((os) => os.map((o) => ({ label: o.textContent.trim(), value: o.value })));
    const match = options.find((o) => o.label.toLowerCase() === user.trim().toLowerCase());
    if (!match) die(`no user named "${user}" on the join screen (is the world launched?)`);
    await select.selectOption(match.value);
  } else {
    await page.locator('input[name="username"]').fill(user);
  }
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[name="join"]').click();
  await page.waitForFunction(() => globalThis.game?.ready, null, { timeout: 90000 });
}

const scenarios = [];
function scenario(name, checks) {
  const failures = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([what]) => what);
  scenarios.push({ name, passed: failures.length === 0, failures });
}

const inside = (inner, outer) =>
  Boolean(inner && outer) &&
  inner.left >= outer.left - TOL &&
  inner.top >= outer.top - TOL &&
  inner.left + inner.width <= outer.left + outer.width + TOL &&
  inner.top + inner.height <= outer.top + outer.height + TOL;
const sameRoll = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The area a roll actually used, in px: lastRollArea.area (die units from the stage centre). */
function effectiveRect(r) {
  if (!r) return null;
  const { area, stage, diePx } = r;
  const sx = stage.left + stage.width / 2;
  const sy = stage.top + stage.height / 2;
  return {
    left: sx + (area.cx - area.halfWidth) * diePx,
    top: sy + (area.cz - area.halfDepth) * diePx,
    width: area.halfWidth * 2 * diePx,
    height: area.halfDepth * 2 * diePx,
  };
}

/** True when every settled die centre of the roll lies inside its effective area. */
function diceInside(r) {
  const eff = effectiveRect(r);
  if (!eff || !Array.isArray(r.dice) || r.dice.length === 0) return false;
  const sx = r.stage.left + r.stage.width / 2;
  const sy = r.stage.top + r.stage.height / 2;
  return r.dice.every((d) => {
    const x = sx + d.x * r.diePx;
    const y = sy + d.z * r.diePx;
    return (
      x >= eff.left - TOL &&
      x <= eff.left + eff.width + TOL &&
      y >= eff.top - TOL &&
      y <= eff.top + eff.height + TOL
    );
  });
}

/** The landing check for one client: the dice settled inside the area grown from `expected`. */
function landedIn(r, expected) {
  const eff = effectiveRect(r);
  return {
    'the dice settled': Array.isArray(r?.dice) && r.dice.length > 0,
    'the effective area contains the expected area': inside(expected, eff),
    'the effective area is inside the stage': inside(eff, r?.stage),
    'every die centre is inside the effective area': diceInside(r),
  };
}

/** Polls until the client has a roll that differs from `before` and has settled; null if never. */
async function changed(page, before) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const now = await rpc(page, 'lastRollArea');
    if (now?.dice && !sameRoll(now, before)) return now;
    await page.waitForTimeout(250);
  }
  return null;
}

async function run(gm, player) {
  const playerId = await rpc(player, 'myUserId');
  const original = {
    rollAreas: await rpc(gm, 'getDicerSetting', 'rollAreas'),
    gmPrivateArea: await rpc(gm, 'getDicerSetting', 'gmPrivateArea'),
    gmPrivateCorner: await rpc(gm, 'getDicerSetting', 'gmPrivateCorner'),
    perPlayerAreas: await rpc(gm, 'getDicerSetting', 'perPlayerAreas'),
    gmScale: await rpc(gm, 'getDicerSetting', 'areaScale'),
    playerScale: await rpc(player, 'getDicerSetting', 'areaScale'),
  };
  try {
    await rpc(gm, 'setDicerSetting', { key: 'areaScale', value: 1 });
    await rpc(player, 'setDicerSetting', { key: 'areaScale', value: 1 });
    await rpc(gm, 'setDicerSetting', { key: 'perPlayerAreas', value: true });
    await rpc(gm, 'setDicerSetting', { key: 'gmPrivateCorner', value: false });
    if (!(await rpc(gm, 'setRollArea', { userId: null, def: { preset: 'full' } })))
      throw new Error('the GM could not set the default area.');
    if (!(await rpc(gm, 'setRollArea', { userId: playerId, def: { preset: 'corner' } })))
      throw new Error('the GM could not set the player area.');
    await gm.waitForTimeout(500); // the world setting reaches the player client

    const [g0, p0] = await Promise.all([rpc(gm, 'lastRollArea'), rpc(player, 'lastRollArea')]);
    await rpc(player, 'rollNat20', { rollMode: 'publicroll' });
    const [g1, p1] = await Promise.all([changed(gm, g0), changed(player, p0)]);
    const [gStage, pStage] = await Promise.all([
      rpc(gm, 'rollAreaRect', null),
      rpc(player, 'rollAreaRect', null),
    ]);
    const [gB, pB] = await Promise.all([
      rpc(gm, 'rollAreaRect', playerId),
      rpc(player, 'rollAreaRect', playerId),
    ]);
    const prefix = (who, checks) =>
      Object.fromEntries(Object.entries(checks).map(([k, v]) => [`${who}: ${k}`, v]));
    scenario('1 a roll by player B with the corner area settles inside B area on both clients', {
      'GM: the roll was recorded': g1 !== null,
      'player: the roll was recorded': p1 !== null,
      ...prefix('GM', landedIn(g1, gB)),
      ...prefix('player', landedIn(p1, pB)),
      'GM: B resolved rect is smaller than the stage': Boolean(
        gB && gStage && gB.width < gStage.width,
      ),
      'player: B resolved rect is smaller than the stage': Boolean(
        pB && pStage && pB.width < pStage.width,
      ),
    });

    await rpc(gm, 'setGmPrivateArea', GM_PRIVATE);
    await rpc(gm, 'setDicerSetting', { key: 'gmPrivateCorner', value: true });
    await gm.waitForTimeout(500);
    const [g2, p2] = await Promise.all([rpc(gm, 'lastRollArea'), rpc(player, 'lastRollArea')]);
    await rpc(gm, 'rollNat20', { rollMode: 'blindroll' });
    const g3 = await changed(gm, g2);
    await player.waitForTimeout(GRACE_MS);
    const p3 = await rpc(player, 'lastRollArea');
    const corner = await rpc(gm, 'resolveHere', GM_PRIVATE);
    scenario(
      '2 a GM blind roll with gmPrivateCorner on settles in the GM corner on the GM client only',
      {
        'GM: the roll was recorded': g3 !== null,
        ...prefix('GM', landedIn(g3, corner)),
        'GM: the GM corner is not the whole stage': Boolean(
          corner && gStage && corner.width < gStage.width,
        ),
        'player: nothing was thrown (view none)': sameRoll(p3, p2),
      },
    );
  } finally {
    await rpc(gm, 'setDicerSetting', { key: 'rollAreas', value: original.rollAreas }).catch(
      () => {},
    );
    await rpc(gm, 'setDicerSetting', { key: 'gmPrivateArea', value: original.gmPrivateArea }).catch(
      () => {},
    );
    await rpc(gm, 'setDicerSetting', {
      key: 'gmPrivateCorner',
      value: original.gmPrivateCorner,
    }).catch(() => {});
    await rpc(gm, 'setDicerSetting', {
      key: 'perPlayerAreas',
      value: original.perPlayerAreas,
    }).catch(() => {});
    await rpc(gm, 'setDicerSetting', { key: 'areaScale', value: original.gmScale }).catch(() => {});
    await rpc(player, 'setDicerSetting', { key: 'areaScale', value: original.playerScale }).catch(
      () => {},
    );
  }
}

async function main() {
  const missing = [
    ['DICER_GM_USER', GM_USER],
    ['DICER_GM_PASSWORD', GM_PASSWORD],
    ['DICER_PLAYER_USER', PLAYER_USER],
    ['DICER_PLAYER_PASSWORD', PLAYER_PASSWORD],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) die(`set ${missing.join(', ')} (and optionally DICER_FOUNDRY_URL).`);
  try {
    await fetch(`${URL_BASE}/join`, { signal: AbortSignal.timeout(5000) });
  } catch {
    die(
      `cannot reach Foundry at ${URL_BASE}. Start Foundry, launch the world, or set DICER_FOUNDRY_URL.`,
    );
  }

  let browser;
  try {
    browser = await chromium.launch();
  } catch (err) {
    die(
      `cannot start Chromium (${String(err.message).split('\n')[0]}). Run "npx playwright install chromium".`,
    );
  }
  const pageErrors = [];
  try {
    const open = async (user, password) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      page.on('pageerror', (e) => pageErrors.push(`${user}: ${String(e.message ?? e)}`));
      await login(page, user, password);
      return page;
    };
    const gm = await open(GM_USER, GM_PASSWORD);
    const player = await open(PLAYER_USER, PLAYER_PASSWORD);
    for (const [label, page, wantGM] of [
      ['GM', gm, true],
      ['player', player, false],
    ]) {
      const state = await page.evaluate(() => ({
        isGM: game.user.isGM,
        areas: typeof game.dice3d?.rollAreas?.rect === 'function',
        debug: game.dice3d?._debug && 'lastRollArea' in game.dice3d._debug,
        dsn: Boolean(game.modules.get('dice-so-nice')?.active),
      }));
      if (state.isGM !== wantGM) die(`the ${label} user is ${wantGM ? 'not a GM' : 'a GM'}.`);
      if (state.dsn) die('Dice So Nice is active; disable it (Dicer stays dormant beside it).');
      if (!state.areas || !state.debug) {
        die(
          'game.dice3d.rollAreas or _debug.lastRollArea is missing; enable Dicer and run "npm run build".',
        );
      }
    }
    await run(gm, player);

    const passed = scenarios.filter((s) => s.passed).length;
    const ok = passed === scenarios.length && pageErrors.length === 0;
    await mkdir('artifacts/live', { recursive: true });
    await writeFile(
      OUT,
      JSON.stringify({ at: new Date().toISOString(), scenarios, pageErrors }, null, 2),
    );
    for (const s of scenarios)
      for (const f of s.failures) console.error(`areas: FAIL ${s.name}: ${f}`);
    for (const e of pageErrors) console.error(`areas: pageerror: ${e}`);
    console.log(`areas: ${passed}/${scenarios.length} passed`);
    process.exitCode = ok ? 0 : 1;
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`areas: ${String(err?.message ?? err).split('\n')[0]}`);
  process.exit(1);
});
