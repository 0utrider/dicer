// Live benchmark harness: runs the bench scenarios against a running local Foundry, with Dicer
// and with Dice So Nice 6.4.5, and writes artifacts/bench/<ISO date>/{<run>.json, summary.md}.
// Every decision lives in bench-lib.mjs (unit-tested). `--dry-run` prints the matrix, no browser.
// Env: DICER_FOUNDRY_URL, DICER_GM_USER, DICER_GM_PASSWORD (as smoke.mjs); DICER_BENCH_HEADLESS=1
// runs headless (GPU may fall back to software: numbers are then not representative).
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import * as lib from './bench-lib.mjs';

const URL_BASE = (process.env.DICER_FOUNDRY_URL || 'http://localhost:30000').replace(/\/+$/, '');
/** A local Foundry over https usually has a self-signed (mkcert) certificate: trust it there only. */
const LOCAL_HTTPS = lib.isLocalHttps(URL_BASE);
const GM_USER = process.env.DICER_GM_USER;
const GM_PASSWORD = process.env.DICER_GM_PASSWORD;
const HEADLESS = process.env.DICER_BENCH_HEADLESS === '1';
const SETTLE_MS = 3000; // after login and settings, before the first roll
const READY = () => Boolean(globalThis.game?.ready && globalThis.game?.dice3d);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errText = (e) => String(e?.message ?? e).split('\n')[0];

function die(message) {
  console.error(`bench: ${message}`);
  process.exit(2);
}

/** Resolves when the URL answers at all (any status); a local https certificate is not checked. */
async function reachable(url) {
  if (!LOCAL_HTTPS) {
    await fetch(url, { signal: AbortSignal.timeout(5000) });
    return;
  }
  const { request } = await import('node:https');
  await new Promise((resolve, reject) => {
    const req = request(url, { method: 'GET', rejectUnauthorized: false, timeout: 5000 }, (res) => {
      res.resume();
      resolve();
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
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
    const flag = lib.dsnFlagFor(e);
    const extra = [
      `cpu ${p[e.profile].cpuThrottle}x`,
      `${p[e.profile].viewport.width}x${p[e.profile].viewport.height}@${p[e.profile].deviceScaleFactor}`,
      e.dicerQuality ? `dicer quality ${e.dicerQuality}` : null,
      e.product === 'dicer' ? `maxDice ${lib.DICER_MAX_DICE}` : null,
      e.product === 'dice-so-nice' ? `maxDiceNumber ${lib.DSN_MAX_DICE}` : null,
      flag ? (flag.exists ? 'dsn user flag = effects off' : 'dsn user flag unset') : null,
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
  let restoring = false;
  let knownProduct = null; // verified active product; runEntry re-checks it on every run
  let onMessage = null; // H-R11: node-side tracker for every chat message id a page creates

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
      ignoreHTTPSErrors: LOCAL_HTTPS,
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
      await page.exposeFunction('__benchTrackMessage', (id) => onMessage?.(id));
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
      await page.waitForFunction(READY, null, { timeout: 60000, polling: 250 });
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

  /**
   * Raises a product's world dice cap for the run, saving the original in restore.json (under
   * `field`) before the first change.
   */
  async function raiseCap(page, restore, field, namespace, key, value) {
    if (restore[field] === undefined) {
      restore[field] = await rpc(page, 'getSetting', { namespace, key });
      await writeRestore(restore);
    }
    if ((await rpc(page, 'getSetting', { namespace, key })) !== value) {
      await rpc(page, 'setSetting', { namespace, key, value });
    }
  }

  /** Reloads /game in the same context (the session cookie survives; log in again if not). */
  async function reloadGame(page) {
    await page.reload();
    if (/\/join/.test(page.url())) await login(page);
    await page.waitForFunction(READY, null, { timeout: 90000, polling: 250 });
  }

  /**
   * H-R8: writes the run's DSN user flag (effects-off overrides, or unset for defaults), saving
   * the original first, then reloads so DSN reads it at init. Throws when it did not stick.
   */
  async function applyDsnFlag(page, restore, want) {
    if (restore.dsnUserFlag === undefined) {
      restore.dsnUserFlag = await rpc(page, 'getDsnUserFlag');
      await writeRestore(restore);
    }
    const back = await rpc(page, 'setDsnUserFlag', want);
    if (!lib.flagApplied(back, want)) {
      throw Error(
        `DSN user flag could not be written: wanted ${JSON.stringify(want)}, read back ${JSON.stringify(back)}`,
      );
    }
    await reloadGame(page);
    const after = await rpc(page, 'getDsnUserFlag');
    if (!lib.flagApplied(after, want)) {
      throw Error(`DSN user flag changed across the reload: read back ${JSON.stringify(after)}`);
    }
    return after;
  }

  async function runEntry(entry, restore) {
    const p = lib.profiles()[entry.profile];
    const s = await openSession(entry.profile, entry.mode);
    try {
      const active = await rpc(s.page, 'benchProduct');
      if (active !== entry.product)
        throw Error(`expected ${entry.product} active, found ${active ?? 'none or both'}`);
      let dsnFlag = null;
      if (entry.product === 'dicer') {
        await raiseCap(s.page, restore, 'maxDice', 'dicer', 'maxDice', lib.DICER_MAX_DICE);
      } else {
        const cap = lib.DSN_MAX_DICE;
        await raiseCap(s.page, restore, 'dsnMaxDiceNumber', 'dice-so-nice', 'maxDiceNumber', cap);
        dsnFlag = await applyDsnFlag(s.page, restore, lib.dsnFlagFor(entry));
      }
      if (entry.dicerQuality)
        await rpc(s.page, 'setDicerSetting', { key: 'quality', value: entry.dicerQuality });
      const settings = await rpc(s.page, 'benchSettings');
      await s.cdp.send('Emulation.setCPUThrottlingRate', { rate: p.cpuThrottle });
      await sleep(SETTLE_MS);
      const suite = await rpc(s.page, 'benchRun', { ids: entry.ids, profile: lib.runName(entry) });
      return {
        at: new Date().toISOString(),
        entry,
        settings,
        dsnFlag,
        pageErrors: s.pageErrors,
        suite,
      };
    } finally {
      await s.cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => {});
      await s.close();
    }
  }

  /**
   * Puts the world back (bench-lib restorePlan), then deletes restore.json. `crashed`: the file was
   * found at startup, so the time sweep of the GM's messages may run (H-R11); never otherwise.
   */
  async function performRestore(restore, { crashed = false } = {}) {
    knownProduct = null;
    restoring = true;
    try {
      let s = await openSession('pc', 'vsync');
      try {
        const active = await rpc(s.page, 'benchProduct');
        for (const step of lib.restorePlan(restore, active, { crashed })) {
          if (step.op === 'switch') {
            await rpc(s.page, 'setDiceModule', step.product);
            await s.close();
            s = await openSession('pc', 'vsync');
            const now = await rpc(s.page, 'benchProduct');
            if (now !== step.product) throw Error(`restore: could not activate ${step.product}`);
          } else if (step.op === 'setMaxDice') {
            await rpc(s.page, 'setSetting', {
              namespace: 'dicer',
              key: 'maxDice',
              value: step.value,
            });
          } else if (step.op === 'setDsnMaxDiceNumber') {
            const set = { namespace: 'dice-so-nice', key: 'maxDiceNumber', value: step.value };
            await rpc(s.page, 'setSetting', set);
          } else if (step.op === 'setDsnUserFlag') {
            const back = await rpc(s.page, 'setDsnUserFlag', step.value);
            if (!lib.flagApplied(back, step.value))
              throw Error('restore: DSN user flag not restored');
          } else if (step.op === 'deleteMessages') {
            const n = await rpc(s.page, 'deleteMessageIds', { ids: step.ids });
            if (n) console.log(`bench: deleted ${n} chat messages the run created`);
          } else if (step.op === 'deleteMessagesSince') {
            // H-R11, crash restore only: the GM's chat messages since the run started.
            const n = await rpc(s.page, 'deleteMessagesSince', { since: step.since });
            if (n) console.log(`bench: deleted ${n} chat messages left by the run`);
          } else if (step.op === 'setModuleConfiguration') {
            await rpc(s.page, 'mergeModuleConfiguration', step.value);
          }
        }
      } finally {
        await s.close();
      }
      await deleteRestore();
    } finally {
      restoring = false;
    }
  }

  return {
    /** Sets the callback for each chat message id a bench page creates. */
    trackMessages(fn) {
      onMessage = fn;
    },
    openSession,
    ensureProduct,
    runEntry,
    performRestore,
    closeBrowsers,
    get interrupted() {
      return interrupted;
    },
    get restoring() {
      return restoring;
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
    await reachable(`${URL_BASE}/join`);
  } catch {
    die(
      `cannot reach Foundry at ${URL_BASE}. Start Foundry, launch the world, or set DICER_FOUNDRY_URL.`,
    );
  }

  const { chromium } = await import('playwright');
  const h = createHarness(chromium);
  let sigintDuringRestore = false;
  process.on('SIGINT', () => {
    // Once the restore has started, the first Ctrl+C is ignored so it can finish.
    if (h.restoring && !sigintDuringRestore) {
      sigintDuringRestore = true;
      console.error(
        `bench: restore in progress, Ctrl+C ignored (again to abandon it; ${lib.RESTORE_FILE} is kept)`,
      );
      return;
    }
    if (h.interrupted || h.restoring) {
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
  let dsnFlag = null;
  let restore = null;
  let writes = Promise.resolve(); // pending restore.json writes from the message tracker
  try {
    if (decision.action === 'restore') {
      console.log(`bench: ${lib.RESTORE_FILE} found from an earlier run, restoring it first`);
      await h.performRestore(decision.restore, { crashed: true });
    }
    const s = await h.openSession('pc', 'vsync');
    try {
      const at = new Date().toISOString();
      restore = {
        at,
        // H-R11: before the first roll. Only a crash restore sweeps the GM's messages from here on.
        runStartedAt: at,
        // H-R11: every chat message id the run creates, persisted as it grows.
        messageIds: [],
        moduleConfiguration: await rpc(s.page, 'getModuleConfiguration'),
      };
      await writeRestore(restore);
      const saved = restore;
      h.trackMessages((id) => {
        if (!lib.trackMessageId(saved, id)) return;
        // Serialized: one restore.json write at a time, each with the whole list so far.
        writes = writes.then(() => writeRestore(saved)).catch(() => {});
      });
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
        if (lib.dsnFlagFor(entry)?.exists) dsnFlag = rep.dsnFlag;
        reports.push(rep);
        await writeFile(`${outDir}/${name}.json`, JSON.stringify(rep, null, 2));
      } catch (e) {
        errors.push({ run: name, error: h.interrupted ? 'interrupted' : errText(e) });
        console.error(`bench: ${name} failed: ${errText(e)}`);
      }
    }
  } finally {
    if (restore) {
      // No tracker write may land after the restore deletes restore.json.
      h.trackMessages(null);
      await writes;
      try {
        // Normal end or Ctrl+C in this process: only the tracked ids, never the time sweep (H-R11).
        await h.performRestore(restore, { crashed: false });
        console.log(
          'bench: world restored (module configuration, maxDice, maxDiceNumber, DSN user flag, run chat messages)',
        );
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
  const md = lib.summaryMarkdown({ date: outDir.split('/').pop(), reports, rows, errors, dsnFlag });
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
