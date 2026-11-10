// Live smoke test against a running local Foundry. See README.md ("Live smoke test").
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const URL_BASE = (process.env.DICER_FOUNDRY_URL || 'http://localhost:30000').replace(/\/+$/, '');
const GM_USER = process.env.DICER_GM_USER;
const GM_PASSWORD = process.env.DICER_GM_PASSWORD;
const OUT = 'artifacts/live/smoke.json';

function die(message) {
  console.error(`smoke: ${message}`);
  process.exit(2);
}

const CASES = [
  { formula: '1d20', animated: true },
  { formula: '3d6+2', animated: true },
  { formula: '1d100', animated: true },
  { formula: '1d7', animated: false },
];

function check({ formula, animated }, r) {
  const failures = [];
  if (animated) {
    if (r.hiddenEarly !== true) failures.push('message was not hidden (dsn-hide) at 100 ms');
    if (r.completeCount !== 1) failures.push(`diceSoNiceRollComplete fired ${r.completeCount}x`);
    if (!(r.msToComplete >= 0 && r.msToComplete < 15000)) {
      failures.push(`msToComplete ${r.msToComplete} is not under 15000`);
    }
    if (r.loopingAfter !== false) failures.push('render loop still running 4 s after landing');
  } else if (r.hiddenEarly !== false) {
    failures.push('an unsupported die was hidden');
  }
  return { formula, ...r, passed: failures.length === 0, failures };
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

async function login(page) {
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
    const match = options.find((o) => o.label.toLowerCase() === GM_USER.trim().toLowerCase());
    if (!match) die(`no user named "${GM_USER}" on the join screen (is the world launched?)`);
    await select.selectOption(match.value);
  } else {
    await page.locator('input[name="username"]').fill(GM_USER);
  }
  await page.locator('input[name="password"]').fill(GM_PASSWORD);
  await page.locator('button[name="join"]').click();
  await page.waitForFunction(() => globalThis.game?.ready, null, { timeout: 90000 });
}

async function main() {
  if (!GM_USER || !GM_PASSWORD) {
    die('set DICER_GM_USER and DICER_GM_PASSWORD (and optionally DICER_FOUNDRY_URL).');
  }
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
    const page = await browser.newPage();
    page.setDefaultTimeout(30000);
    page.on('pageerror', (e) => pageErrors.push(String(e.message ?? e)));
    await login(page);
    const state = await page.evaluate(() => ({
      isGM: game.user.isGM,
      dicer: Boolean(game.dice3d),
      dsn: Boolean(game.modules.get('dice-so-nice')?.active),
    }));
    if (!state.isGM) die(`"${GM_USER}" is not a GM.`);
    if (state.dsn) die('Dice So Nice is active; disable it (Dicer stays dormant beside it).');
    if (!state.dicer)
      die('game.dice3d is missing; enable Dicer in this world and run "npm run build".');

    const results = [];
    for (const c of CASES) {
      results.push(check(c, await rpc(page, 'rollAndTrack', c.formula)));
    }
    const passed = results.filter((r) => r.passed).length;
    const ok = passed === results.length && pageErrors.length === 0;
    await mkdir('artifacts/live', { recursive: true });
    await writeFile(
      OUT,
      JSON.stringify({ at: new Date().toISOString(), results, pageErrors }, null, 2),
    );
    for (const r of results.filter((x) => !x.passed)) {
      console.error(`smoke: FAIL ${r.formula}: ${r.failures.join('; ')}`);
    }
    for (const e of pageErrors) console.error(`smoke: pageerror: ${e}`);
    console.log(`smoke: ${passed}/${results.length} passed`);
    process.exitCode = ok ? 0 : 1;
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`smoke: ${String(err?.message ?? err).split('\n')[0]}`);
  process.exit(1);
});
