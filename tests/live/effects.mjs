// Live effects and sounds test: a GM and a player against a running local Foundry.
// Owner-run (needs Foundry), same environment variables as compat.mjs. Reads no roll values: it
// compares the debug counters in game.dice3d._debug (effect ids and result sound names).
//
// Scenarios, each with a forced natural 20 (the default celebrate rule plays the celebrate effect
// and the fanfare sound):
//   1. GM rolls publicly: the GM client counts a celebrate play and a fanfare sound.
//   2. GM rolls blind: the GM client counts both; the player client counts neither (view none).
//   2b. The player rolls blind with showGhostDice on: the GM counts both; the player draws a ghost die
//      (checked through view kinds) and counts neither.
//   3. GM rolls publicly with the player's showOthersEffects on: the player counts both.
//   4. The same with showOthersEffects off: the player counts neither (the viewer's filter).
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const URL_BASE = (process.env.DICER_FOUNDRY_URL || 'http://localhost:30000').replace(/\/+$/, '');
const GM_USER = process.env.DICER_GM_USER;
const GM_PASSWORD = process.env.DICER_GM_PASSWORD;
const PLAYER_USER = process.env.DICER_PLAYER_USER;
const PLAYER_PASSWORD = process.env.DICER_PLAYER_PASSWORD;
const OUT = 'artifacts/live/effects.json';
const POLL_TIMEOUT_MS = 20000; // how long the roller's counters get to rise
const GRACE_MS = 2500; // after they rise, how long the other client is watched for counts that must not come
const EFFECT = 'celebrate';
const SOUND = 'fanfare';

function die(message) {
  console.error(`effects: ${message}`);
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

/** How many times each counter rose between two snapshots. */
const rose = (before, after) => ({
  fx: (after.fxPlays[EFFECT] ?? 0) - (before.fxPlays[EFFECT] ?? 0),
  sound: (after.resultSounds[SOUND] ?? 0) - (before.resultSounds[SOUND] ?? 0),
});

/**
 * Rolls a nat 20 as `roller` ('gm' or 'player') and returns what each client counted. Polls until
 * the GM client's counters rise (the GM sees every roll), then waits a short grace so a count that
 * must not come has had time to. `id` is the chat message id.
 */
async function observe(gm, player, rollMode, roller = 'gm') {
  const [g0, p0] = await Promise.all([rpc(gm, 'fxCounts'), rpc(player, 'fxCounts')]);
  const id = await rpc(roller === 'gm' ? gm : player, 'rollNat20', { rollMode });
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let g1 = g0;
  while (Date.now() < deadline) {
    g1 = await rpc(gm, 'fxCounts');
    const r = rose(g0, g1);
    if (r.fx >= 1 && r.sound >= 1) break;
    await gm.waitForTimeout(250);
  }
  await gm.waitForTimeout(GRACE_MS);
  [g1] = await Promise.all([rpc(gm, 'fxCounts')]);
  const p1 = await rpc(player, 'fxCounts');
  return { id, gm: rose(g0, g1), player: rose(p0, p1) };
}

async function run(gm, player) {
  const gmOriginal = {};
  const playerOriginal = {};
  const keys = ['effects', 'sounds'];
  for (const key of keys) {
    gmOriginal[key] = await rpc(gm, 'getDicerSetting', key);
    playerOriginal[key] = await rpc(player, 'getDicerSetting', key);
  }
  playerOriginal.showOthersEffects = await rpc(player, 'getDicerSetting', 'showOthersEffects');
  try {
    for (const [page, key] of [
      [gm, 'effects'],
      [gm, 'sounds'],
      [player, 'effects'],
      [player, 'sounds'],
    ]) {
      await rpc(page, 'setDicerSetting', { key, value: true });
    }
    await rpc(player, 'setDicerSetting', { key: 'showOthersEffects', value: true });

    let seen = await observe(gm, player, 'publicroll');
    scenario('1 a public nat 20 plays celebrate and the fanfare on the GM client', {
      'GM: celebrate played': seen.gm.fx >= 1,
      'GM: fanfare requested': seen.gm.sound >= 1,
    });

    seen = await observe(gm, player, 'blindroll');
    scenario('2 a GM blind nat 20 gives the player no effect and no sound (view none)', {
      'GM: celebrate played': seen.gm.fx >= 1,
      'GM: fanfare requested': seen.gm.sound >= 1,
      'player: no celebrate': seen.player.fx === 0,
      'player: no fanfare': seen.player.sound === 0,
    });

    // The privacy gate proper: a player's own blind roll is drawn on the player's client as ghost dice
    // (showGhostDice on) and must still run no effect and no result sound there.
    const ghostOriginal = await rpc(gm, 'getGhostSetting');
    try {
      await rpc(gm, 'setGhostSetting', true);
      seen = await observe(gm, player, 'blindroll', 'player');
      const kinds = await rpc(player, 'viewKinds', seen.id);
      scenario('2b a player blind nat 20 with ghost dice: GM gets both, the ghost view gets neither', {
        'GM: celebrate played': seen.gm.fx >= 1,
        'GM: fanfare requested': seen.gm.sound >= 1,
        'player: a ghost die was drawn (view kind ghost, never real)':
          Array.isArray(kinds) && kinds.length > 0 && kinds.every((k) => k === 'ghost'),
        'player: no celebrate': seen.player.fx === 0,
        'player: no fanfare': seen.player.sound === 0,
      });
    } finally {
      await rpc(gm, 'setGhostSetting', Boolean(ghostOriginal)).catch(() => {});
    }

    seen = await observe(gm, player, 'publicroll');
    scenario('3 a public nat 20 gives the player both with showOthersEffects on', {
      'player: celebrate played': seen.player.fx >= 1,
      'player: fanfare requested': seen.player.sound >= 1,
    });

    await rpc(player, 'setDicerSetting', { key: 'showOthersEffects', value: false });
    seen = await observe(gm, player, 'publicroll');
    scenario('4 showOthersEffects off hides another player roll effects and sounds', {
      'GM: celebrate played': seen.gm.fx >= 1,
      'player: no celebrate': seen.player.fx === 0,
      'player: no fanfare': seen.player.sound === 0,
    });
  } finally {
    for (const key of keys) {
      await rpc(gm, 'setDicerSetting', { key, value: gmOriginal[key] }).catch(() => {});
      await rpc(player, 'setDicerSetting', { key, value: playerOriginal[key] }).catch(() => {});
    }
    await rpc(player, 'setDicerSetting', {
      key: 'showOthersEffects',
      value: playerOriginal.showOthersEffects,
    }).catch(() => {});
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
        counters: typeof game.dice3d?._debug?.fxPlays === 'object',
        dsn: Boolean(game.modules.get('dice-so-nice')?.active),
      }));
      if (state.isGM !== wantGM) die(`the ${label} user is ${wantGM ? 'not a GM' : 'a GM'}.`);
      if (state.dsn) die('Dice So Nice is active; disable it (Dicer stays dormant beside it).');
      if (!state.counters) {
        die('game.dice3d._debug.fxPlays is missing; enable Dicer and run "npm run build".');
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
    for (const s of scenarios) for (const f of s.failures) console.error(`effects: FAIL ${s.name}: ${f}`);
    for (const e of pageErrors) console.error(`effects: pageerror: ${e}`);
    console.log(`effects: ${passed}/${scenarios.length} passed`);
    process.exitCode = ok ? 0 : 1;
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`effects: ${String(err?.message ?? err).split('\n')[0]}`);
  process.exit(1);
});
