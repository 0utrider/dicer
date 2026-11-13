// Live test of rolling by hand: a GM and a player (and, optionally, a second player) against a
// running local Foundry. Owner-run (needs the test world and its accounts). See README.md
// ("Rolling by hand") and docs/live-checks.md. Reads no secrets: roll values are compared inside
// this script only, and the second player's client is watched for socket payload kinds and counts.
//
// It checks that:
//  1. a player's public 1d20 thrown by hand (Roll#toMessage, "Throw for me" pressed by script)
//     reaches the GM as one `hand` payload, and the throw's final frame reads the card's value;
//  2. a hand roll whispered to the GM never reaches a second player's socket handler;
//  3. a thrower who does not throw falls back after the time limit and the card is marked;
//  4. a hand throw that splats the thrower's resting pet splats it on the GM's screen. That one
//     needs a pet and an aimed throw, so it stays manual: the test prints the steps (live-checks.md).
//
// Env: DICER_FOUNDRY_URL (default http://localhost:30000), DICER_GM_USER, DICER_GM_PASSWORD,
// DICER_PLAYER_USER, DICER_PLAYER_PASSWORD, and optionally DICER_PLAYER2_USER / DICER_PLAYER2_PASSWORD.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { decodeTrajectory } from '../../src/hand/chunk/trajectory.js';
import { readResult } from '../../src/core/physical-read.js';
import { getShape } from '../../src/core/dice-shapes.js';
import { FLOATS_PER_DIE } from '../../src/physics/protocol.js';

const URL_BASE = (process.env.DICER_FOUNDRY_URL || 'http://localhost:30000').replace(/\/+$/, '');
const env = (k) => process.env[`DICER_${k}`];
const OUT = 'artifacts/live/hand.json';
const THROW_WAIT_MS = 20000; // the overlay to open, the message to exist
const TIMEOUT_S = 10; // the world's handRollTimeout minimum, for the fallback check
const SETTLE_MS = 3000; // how long the second player is watched for a payload that must not come

function die(message) {
  console.error(`hand: ${message}`);
  process.exit(1);
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

/** Counts the module socket's hand payloads on this client (kind and message id only, plus the payload for `keep`). */
const watchHand = (page, keep) =>
  page.evaluate((keepPayload) => {
    globalThis.__handSeen = [];
    game.socket.on('module.dicer', (p) => {
      if (p?.kind !== 'hand') return;
      globalThis.__handSeen.push({
        messageId: p.messageId,
        none: p.none === true,
        ...(keepPayload && p.trajectory ? { trajectory: p.trajectory } : {}),
      });
    });
  }, Boolean(keep));

const seen = (page, id) =>
  page.evaluate((mid) => (globalThis.__handSeen ?? []).filter((s) => s.messageId === mid), id);

/**
 * The player rolls `formula` into chat as a hand roll and presses "Throw for me" when the overlay
 * opens (or not, `press: false`: the time limit then ends it). Resolves {id, pressed}.
 */
async function handRoll(page, { formula, rollMode, press = true, waitMs = THROW_WAIT_MS }) {
  await page.evaluate(
    ({ formula, rollMode }) => {
      globalThis.__handId = null;
      new globalThis.Roll(formula)
        .toMessage({}, { rollMode })
        .then((m) => (globalThis.__handId = m.id))
        .catch((e) => (globalThis.__handId = `error: ${e?.message ?? e}`));
    },
    { formula, rollMode },
  );
  let pressed = false;
  if (press) {
    await page.waitForSelector('.dicer-hand-overlay [data-action="auto"]', { timeout: waitMs });
    await page.click('.dicer-hand-overlay [data-action="auto"]');
    pressed = true;
  }
  await page.waitForFunction(() => globalThis.__handId, null, { timeout: waitMs + 15000 });
  const id = await page.evaluate(() => globalThis.__handId);
  if (String(id).startsWith('error:')) die(`the roll failed: ${id}`);
  return { id, pressed };
}

/** The message's first roll as the page sees it: dice results and the dicerHand flag. */
const cardOf = (page, id) =>
  page.evaluate((mid) => {
    const roll = game.messages.get(mid)?.rolls?.[0];
    return roll
      ? {
          results: roll.dice.map((d) => d.results.map((r) => r.result)),
          hand: roll.options?.dicerHand ?? null,
          view: game.dice3d._debug.lastRollViews?.[mid] ?? null,
          mark: document.querySelector(`[data-message-id="${mid}"] .dicer-card-mark`)?.dataset
            .tooltip ?? null,
        }
      : null;
  }, id);

/** The values a decoded throw's final frame reads, per recorded die, in recorded order. */
function finalValues(payload) {
  const d = decodeTrajectory(payload);
  if (!d) return null;
  const last = d.chunks[d.chunks.length - 1];
  const at = last.length - d.n * FLOATS_PER_DIE;
  return d.shapes.map((shape, i) => {
    const o = at + i * FLOATS_PER_DIE;
    return readResult(getShape(shape), { x: last[o + 3], y: last[o + 4], z: last[o + 5], w: last[o + 6] });
  });
}

const scenarios = [];
function scenario(name, checks, skipped) {
  const failures = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([what]) => what);
  scenarios.push({ name, passed: failures.length === 0, failures, ...(skipped ? { skipped } : {}) });
}

const setWorld = (gm, key, value) =>
  gm.evaluate(({ key, value }) => game.settings.set('dicer', key, value), { key, value });
const getSetting = (page, key) => page.evaluate((k) => game.settings.get('dicer', k), key);

async function run(gm, player, player2) {
  const keep = {
    allowed: await getSetting(gm, 'handRollsAllowed'),
    required: await getSetting(gm, 'handRollsRequired'),
    timeout: await getSetting(gm, 'handRollTimeout'),
    mode: await getSetting(player, 'handRolls'),
  };
  const created = [];
  try {
    await setWorld(gm, 'handRollsAllowed', 'all');
    await setWorld(gm, 'handRollsRequired', false);
    await player.evaluate(() => game.settings.set('dicer', 'handRolls', 'always'));
    await watchHand(gm, true);
    if (player2) await watchHand(player2, false);

    // 1. A public 1d20 thrown by hand reaches the GM as a hand payload; the throw reads the card.
    let { id } = await handRoll(player, { formula: '1d20', rollMode: 'publicroll' });
    created.push(id);
    await gm.waitForFunction((mid) => globalThis.__handSeen.some((s) => s.messageId === mid), id, {
      timeout: 15000,
    }).catch(() => {});
    let got = await seen(gm, id);
    const full = await gm.evaluate(
      (mid) => globalThis.__handSeen.find((s) => s.messageId === mid && s.trajectory)?.trajectory ?? null,
      id,
    );
    const card = await cardOf(gm, id);
    const values = full ? finalValues(full) : null;
    scenario('1 a public hand roll replays on the GM with the card value', {
      'GM: exactly one hand payload with a trajectory': got.length === 1 && Boolean(full),
      'the card is a hand roll (no fallback)': Boolean(card?.hand) && !card.hand.fallback,
      "the replay's final face reads the card's value": Boolean(
        values && card && values.length === 1 && values[0] === card.results[0][0],
      ),
      'GM: real view': card?.view === 'real',
    });

    // 2. A roll whispered to the GM never reaches a second player's socket handler.
    ({ id } = await handRoll(player, { formula: '1d20', rollMode: 'gmroll' }));
    created.push(id);
    await gm.waitForFunction((mid) => globalThis.__handSeen.some((s) => s.messageId === mid), id, {
      timeout: 15000,
    }).catch(() => {});
    got = await seen(gm, id);
    if (!player2) {
      scenario(
        '2 a whispered hand roll stays off a second player',
        {},
        'set DICER_PLAYER2_USER and DICER_PLAYER2_PASSWORD',
      );
    } else {
      await player2.waitForTimeout(SETTLE_MS);
      const other = await seen(player2, id);
      scenario('2 a whispered hand roll stays off a second player', {
        'GM: gets the hand payload': got.some((s) => !s.none),
        'second player: no hand payload at all (trajectory or notice)': other.length === 0,
      });
    }

    // 3. A thrower who never throws: Foundry rolls after the time limit and the card is marked.
    await setWorld(gm, 'handRollTimeout', TIMEOUT_S);
    ({ id } = await handRoll(player, {
      formula: '1d20',
      rollMode: 'publicroll',
      press: false,
      waitMs: (TIMEOUT_S + 20) * 1000,
    }));
    created.push(id);
    const late = await cardOf(gm, id);
    const mark = await player.evaluate(
      (mid) =>
        document.querySelector(`[data-message-id="${mid}"] .dicer-card-mark`)?.dataset.tooltip ?? null,
      id,
    );
    scenario('3 a timeout falls back and marks the card', {
      "the roll's dicerHand says timeout": late?.hand?.fallback === 'timeout',
      'the card has a result': Number.isInteger(late?.results?.[0]?.[0]),
      'the thrower sees the fallback mark': typeof mark === 'string' && mark.length > 0,
    });

    // 4. Pet splats are manual: nothing exposes a pet's state to a script.
    scenario(
      '4 a hand throw splats the resting pet on the GM screen',
      {},
      'manual: see docs/live-checks.md, "Pets in a hand throw"',
    );
  } finally {
    await setWorld(gm, 'handRollsAllowed', keep.allowed).catch(() => {});
    await setWorld(gm, 'handRollsRequired', keep.required).catch(() => {});
    await setWorld(gm, 'handRollTimeout', keep.timeout).catch(() => {});
    await player.evaluate((m) => game.settings.set('dicer', 'handRolls', m), keep.mode).catch(() => {});
    await gm
      .evaluate(
        (ids) => ChatMessage.deleteDocuments(ids.filter((i) => game.messages.has(i))),
        created,
      )
      .catch(() => {});
  }
}

async function main() {
  const missing = [
    ['DICER_GM_USER', env('GM_USER')],
    ['DICER_GM_PASSWORD', env('GM_PASSWORD')],
    ['DICER_PLAYER_USER', env('PLAYER_USER')],
    ['DICER_PLAYER_PASSWORD', env('PLAYER_PASSWORD')],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) die(`set ${missing.join(', ')} (and optionally DICER_FOUNDRY_URL).`);
  try {
    await fetch(`${URL_BASE}/join`, { signal: AbortSignal.timeout(5000) });
  } catch {
    die(`cannot reach Foundry at ${URL_BASE}. Start Foundry, launch the world, or set DICER_FOUNDRY_URL.`);
  }
  let browser;
  try {
    browser = await chromium.launch();
  } catch (err) {
    die(`cannot start Chromium (${String(err.message).split('\n')[0]}). Run "npx playwright install chromium".`);
  }
  const pageErrors = [];
  try {
    const open = async (user, password) => {
      const context = await browser.newContext(); // own cookies: separate sessions
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      page.on('pageerror', (e) => pageErrors.push(`${user}: ${String(e.message ?? e)}`));
      await login(page, user, password);
      return page;
    };
    const gm = await open(env('GM_USER'), env('GM_PASSWORD'));
    const player = await open(env('PLAYER_USER'), env('PLAYER_PASSWORD'));
    const player2 = env('PLAYER2_USER') ? await open(env('PLAYER2_USER'), env('PLAYER2_PASSWORD') ?? '') : null;
    for (const [label, page, wantGM] of [
      ['GM', gm, true],
      ['player', player, false],
      ...(player2 ? [['second player', player2, false]] : []),
    ]) {
      const state = await page.evaluate(() => ({
        isGM: game.user.isGM,
        dicer: Boolean(game.dice3d),
        dsn: Boolean(game.modules.get('dice-so-nice')?.active),
        method: Boolean(CONFIG.Dice.fulfillment?.methods?.dicer),
      }));
      if (state.isGM !== wantGM) die(`the ${label} user is ${wantGM ? 'not a GM' : 'a GM'}.`);
      if (state.dsn) die('Dice So Nice is active; disable it (Dicer stays dormant beside it).');
      if (!state.dicer) die('game.dice3d is missing; enable Dicer in this world and run "npm run build".');
      if (!state.method) die('the "dicer" fulfillment method is not registered (Dicer needs Foundry v14).');
    }
    await run(gm, player, player2);

    const passed = scenarios.filter((s) => s.passed).length;
    const ok = passed === scenarios.length && pageErrors.length === 0;
    await mkdir('artifacts/live', { recursive: true });
    await writeFile(OUT, JSON.stringify({ at: new Date().toISOString(), scenarios, pageErrors }, null, 2));
    for (const s of scenarios) {
      if (s.skipped) console.log(`hand: SKIP ${s.name}: ${s.skipped}`);
      for (const f of s.failures) console.error(`hand: FAIL ${s.name}: ${f}`);
    }
    for (const e of pageErrors) console.error(`hand: pageerror: ${e}`);
    console.log(`hand: ${passed}/${scenarios.length} passed`);
    process.exitCode = ok ? 0 : 1;
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`hand: ${String(err?.message ?? err).split('\n')[0]}`);
  process.exit(1);
});
