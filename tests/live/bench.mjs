// Live benchmark harness: runs the bench scenarios against a running local Foundry, with Dicer
// and with Dice So Nice 6.4.5, and writes artifacts/bench/<ISO date>/{<run>.json, summary.md}.
// Every decision lives in bench-lib.mjs (unit-tested). `--dry-run` prints the matrix, no browser.
// Env: DICER_FOUNDRY_URL, DICER_GM_USER, DICER_GM_PASSWORD (as smoke.mjs); DICER_BENCH_HEADLESS=1
// runs headless (GPU may fall back to software: numbers are then not representative).
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import * as lib from './bench-lib.mjs';

const URL_BASE = (process.env.DICER_FOUNDRY_URL || 'http://localhost:30000').replace(/\/+$/, '');
const GM_USER = process.env.DICER_GM_USER;
const GM_PASSWORD = process.env.DICER_GM_PASSWORD;
const HEADLESS = process.env.DICER_BENCH_HEADLESS === '1';
const SETTLE_MS = 3000; // after login and settings, before the first roll
const BIG_POOL = 30; // H-R7: G2's big pool is 30 dice; Dicer's maxDice default is 20

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errText = (e) => String(e?.message ?? e).split('\n')[0];

function die(message) {
  console.error(`bench: ${message}`);
  process.exit(2);
}

async function readRestore() {
  try {
    return await readFile(lib.RESTORE_FILE, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

async function writeRestore(obj) {
  await mkdir(dirname(lib.RESTORE_FILE), { recursive: true });
  await writeFile(lib.RESTORE_FILE, JSON.stringify(obj, null, 2));
}

async function deleteRestore() {
  try {
    await unlink(lib.RESTORE_FILE);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}

function printPlan(plan, decision) {
  const p = lib.profiles();
  console.log(`bench: dry run, ${plan.length} runs (nothing launched, nothing changed)`);
  for (const [i, e] of plan.entries()) {
    const extra = [
      `cpu ${p[e.profile].cpuThrottle}x`,
      `${p[e.profile].viewport.width}x${p[e.profile].viewport.height}@${p[e.profile].deviceScaleFactor}`,
      e.dicerQuality ? `dicer quality ${e.dicerQuality}` : null,
      e.dsnEffectsOff ? 'dsn effects off' : null,
      e.product === 'dicer' ? `maxDice ${BIG_POOL}` : null,
    ].filter(Boolean);
    console.log(`  ${i + 1}. ${lib.runName(e)}: ${e.ids.join(', ')} (${extra.join(', ')})`);
  }
  if (decision.action === 'restore')
    console.log(`bench: ${lib.RESTORE_FILE} exists: a live run restores it first`);
  if (decision.action === 'abort') console.log(`bench: ${decision.reason}`);
  console.log(`bench: reports go to ${lib.outDirName(new Date())}/`);
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
    if (!match)
      throw Error(`no user named "${GM_USER}" on the join screen (is the world launched?)`);
    await select.selectOption(match.value);
  } else {
    await page.locator('input[name="username"]').fill(GM_USER);
  }
  await page.locator('input[name="password"]').fill(GM_PASSWORD);
  await page.locator('button[name="join"]').click();
  await page.waitForFunction(() => globalThis.game?.ready, null, { timeout: 90000 });
}

function createHarness(chromium) {
  const browsers = {};
  let interrupted = false;
  let knownProduct = null; // verified active product; runEntry re-checks it on every run

  async function browserFor(mode) {
    if (!browsers[mode]) {
      try {
        browsers[mode] = await chromium.launch({
          headless: HEADLESS,
          args: lib.modes()[mode].args,
        });
      } catch (err) {
        throw Error(
          `cannot start Chromium (${errText(err)}). Run "npx playwright install chromium".`,
        );
      }
    }
    return browsers[mode];
  }

  async function closeBrowsers() {
    for (const k of Object.keys(browsers)) {
      const b = browsers[k];
      delete browsers[k];
      await b.close().catch(() => {});
    }
  }

  /** A fresh browser context (client settings at their defaults), logged in as the GM. */
  async function openSession(profileName, mode) {
    const p = lib.profiles()[profileName];
    const browser = await browserFor(mode);
    const context = await browser.newContext({
      viewport: p.viewport,
      deviceScaleFactor: p.deviceScaleFactor,
    });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(60000);
      const pageErrors = [];
      page.on('pageerror', (e) => pageErrors.push(errText(e)));
      const cdp = await context.newCDPSession(page);
      await page.exposeFunction('__benchHeap', async () => {
        await cdp.send('HeapProfiler.collectGarbage');
        const { usedSize } = await cdp.send('Runtime.getHeapUsage');
        return usedSize;
      });
      await page.exposeFunction('__benchPerturb', async (kind, ms) => {
        if (kind === 'resize') {
          const v = page.viewportSize() ?? p.viewport;
          await page.setViewportSize({
            width: Math.round(v.width * 0.75),
            height: Math.round(v.height * 0.75),
          });
          await sleep(ms);
          await page.setViewportSize(v);
        } else if (kind === 'hidden') {
          const other = await context.newPage();
          try {
            await other.bringToFront();
            await sleep(ms);
          } finally {
            await other.close().catch(() => {});
            await page.bringToFront();
          }
        }
      });
      await login(page);
      if (!(await rpc(page, 'isGM'))) throw Error(`"${GM_USER}" is not a GM.`);
      await page.waitForFunction(
        () => Boolean(globalThis.game?.ready && globalThis.game?.dice3d),
        null,
        {
          timeout: 60000,
          polling: 250,
        },
      );
      return { context, page, cdp, pageErrors, close: () => context.close().catch(() => {}) };
    } catch (e) {
      await context.close().catch(() => {});
      throw e;
    }
  }

  /** The active product, switching core.moduleConfiguration (and so reloading) when needed. */
  async function ensureProduct(product) {
    if (knownProduct === product) return;
    knownProduct = null;
    const s = await openSession('pc', 'vsync');
    try {
      if ((await rpc(s.page, 'benchProduct')) === product) {
        knownProduct = product;
        return;
      }
      console.log(`bench: switching the world to ${product} (reload)`);
      await rpc(s.page, 'setDiceModule', product);
    } finally {
      await s.close();
    }
    const v = await openSession('pc', 'vsync');
    try {
      const now = await rpc(v.page, 'benchProduct');
      if (now !== product)
        throw Error(
          `after the module switch ${now ?? 'no single product'} is active, not ${product}`,
        );
      knownProduct = product;
    } finally {
      await v.close();
    }
  }

  async function raiseMaxDice(page, restore) {
    if (restore.maxDice === undefined) {
      restore.maxDice = await rpc(page, 'getDicerSetting', 'maxDice');
      await writeRestore(restore);
    }
    if ((await rpc(page, 'getDicerSetting', 'maxDice')) !== BIG_POOL) {
      await rpc(page, 'setDicerSetting', { key: 'maxDice', value: BIG_POOL });
    }
  }

  async function runEntry(entry, restore) {
    const p = lib.profiles()[entry.profile];
    const s = await openSession(entry.profile, entry.mode);
    try {
      const active = await rpc(s.page, 'benchProduct');
      if (active !== entry.product)
        throw Error(`expected ${entry.product} active, found ${active ?? 'none or both'}`);
      if (entry.product === 'dicer') await raiseMaxDice(s.page, restore);
      if (entry.dicerQuality)
        await rpc(s.page, 'setDicerSetting', { key: 'quality', value: entry.dicerQuality });
      let dsnKeys = null;
      let dsnFailed = [];
      if (entry.dsnEffectsOff) {
        dsnKeys = lib.dsnEffectsOff(await rpc(s.page, 'dsnSettingsList'));
        dsnFailed = await rpc(s.page, 'setDsnSettings', dsnKeys);
      }
      const settings = await rpc(s.page, 'benchSettings');
      if (p.cpuThrottle > 1)
        await s.cdp.send('Emulation.setCPUThrottlingRate', { rate: p.cpuThrottle });
      await sleep(SETTLE_MS);
      const suite = await rpc(s.page, 'benchRun', { ids: entry.ids, profile: lib.runName(entry) });
      return {
        at: new Date().toISOString(),
        entry,
        settings,
        dsnKeys,
        dsnFailed,
        pageErrors: s.pageErrors,
        suite,
      };
    } finally {
      await s.close();
    }
  }

  /** Puts the world back (bench-lib restorePlan), then deletes restore.json. */
  async function performRestore(restore) {
    knownProduct = null;
    let s = await openSession('pc', 'vsync');
    try {
      const active = await rpc(s.page, 'benchProduct');
      for (const step of lib.restorePlan(restore, active)) {
        if (step.op === 'switch') {
          await rpc(s.page, 'setDiceModule', step.product);
          await s.close();
          s = await openSession('pc', 'vsync');
          const now = await rpc(s.page, 'benchProduct');
          if (now !== step.product) throw Error(`restore: could not activate ${step.product}`);
        } else if (step.op === 'setMaxDice') {
          await rpc(s.page, 'setDicerSetting', { key: 'maxDice', value: step.value });
        } else if (step.op === 'setModuleConfiguration') {
          await rpc(s.page, 'setModuleConfiguration', step.value);
        }
      }
    } finally {
      await s.close();
    }
    await deleteRestore();
  }

  return {
    openSession,
    ensureProduct,
    runEntry,
    performRestore,
    closeBrowsers,
    get interrupted() {
      return interrupted;
    },
    interrupt() {
      interrupted = true;
      return closeBrowsers(); // unblocks a running page.evaluate; finally then restores
    },
  };
}

async function main() {
  const args = lib.parseArgs(process.argv.slice(2));
  const plan = lib.matrix();
  const decision = lib.startupDecision(await readRestore());
  if (args.dryRun) {
    printPlan(plan, decision);
    return 0;
  }
  if (decision.action === 'abort') die(decision.reason);
  if (!GM_USER || !GM_PASSWORD)
    die('set DICER_GM_USER and DICER_GM_PASSWORD (and optionally DICER_FOUNDRY_URL).');
  try {
    await fetch(`${URL_BASE}/join`, { signal: AbortSignal.timeout(5000) });
  } catch {
    die(
      `cannot reach Foundry at ${URL_BASE}. Start Foundry, launch the world, or set DICER_FOUNDRY_URL.`,
    );
  }

  const { chromium } = await import('playwright');
  const h = createHarness(chromium);
  process.on('SIGINT', () => {
    if (h.interrupted) {
      console.error(
        `bench: second Ctrl+C, exiting; ${lib.RESTORE_FILE} is kept and the next run restores it`,
      );
      process.exit(130);
    }
    console.error('bench: interrupted, restoring the world (Ctrl+C again to skip)');
    h.interrupt();
  });

  const outDir = lib.outDirName(new Date());
  const reports = [];
  const errors = [];
  let dsnKeys = null;
  let restore = null;
  try {
    if (decision.action === 'restore') {
      console.log(`bench: ${lib.RESTORE_FILE} found from an earlier run, restoring it first`);
      await h.performRestore(decision.restore);
    }
    const s = await h.openSession('pc', 'vsync');
    try {
      restore = {
        at: new Date().toISOString(),
        moduleConfiguration: await rpc(s.page, 'getModuleConfiguration'),
      };
      await writeRestore(restore);
    } finally {
      await s.close();
    }
    await mkdir(outDir, { recursive: true });
    for (const entry of plan) {
      if (h.interrupted) break;
      const name = lib.runName(entry);
      console.log(`bench: ${name}: ${entry.ids.join(', ')}`);
      try {
        await h.ensureProduct(entry.product);
        const rep = await h.runEntry(entry, restore);
        if (rep.dsnKeys) dsnKeys = rep.dsnKeys;
        reports.push(rep);
        await writeFile(`${outDir}/${name}.json`, JSON.stringify(rep, null, 2));
      } catch (e) {
        errors.push({ run: name, error: h.interrupted ? 'interrupted' : errText(e) });
        console.error(`bench: ${name} failed: ${errText(e)}`);
      }
    }
  } finally {
    if (restore) {
      try {
        await h.performRestore(restore);
        console.log('bench: world module configuration and maxDice restored');
      } catch (e) {
        errors.push({ run: 'restore', error: errText(e) });
        console.error(
          `bench: RESTORE FAILED (${errText(e)}); ${lib.RESTORE_FILE} is kept, run again to restore`,
        );
      }
    }
    await h.closeBrowsers();
  }

  const rows = lib.verdicts(reports);
  const md = lib.summaryMarkdown({ date: outDir.split('/').pop(), reports, rows, errors, dsnKeys });
  await mkdir(outDir, { recursive: true });
  await writeFile(`${outDir}/summary.md`, md);
  console.log(md);
  console.log(`bench: wrote ${outDir}/summary.md`);
  return lib.exitCode(rows, errors);
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(`bench: ${errText(err)}`);
    process.exit(1);
  },
);
