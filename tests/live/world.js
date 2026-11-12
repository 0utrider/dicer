/* global Roll, Combat */
/**
 * Browser-side RPC module for the live smoke test. Foundry serves it at
 * /modules/dicer/tests/live/world.js; smoke.mjs imports it inside the page.
 */

const ELEMENT_WAIT_MS = 500;
const ELEMENT_POLL_MS = 10;
const LOOP_SAMPLE_MS = 4000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The message's element in the sidebar chat log (not a notification card or popout). */
function logElement(id) {
  return ui.chat?.element?.querySelector(`.chat-log [data-message-id="${id}"]`) ?? null;
}

/** Polls for the message element for up to ELEMENT_WAIT_MS; null if it never appears. */
async function waitForElement(id) {
  const until = performance.now() + ELEMENT_WAIT_MS;
  for (;;) {
    const el = logElement(id) ?? document.querySelector(`[data-message-id="${id}"]`);
    if (el) return el;
    if (performance.now() >= until) return null;
    await sleep(ELEMENT_POLL_MS);
  }
}

/**
 * Whether the revealed element's bottom edge lies within the chat log's visible rect. null
 * when it cannot be judged (no element in the sidebar log, or the log is not displayed).
 */
function scrolledIntoView(id) {
  const el = logElement(id);
  const scroller = el?.closest('.chat-scroll') ?? el?.parentElement;
  if (!el || !scroller || el.offsetParent === null) return null;
  const view = scroller.getBoundingClientRect();
  const { bottom } = el.getBoundingClientRect();
  return bottom <= view.bottom + 1 && bottom >= view.top;
}

/**
 * Roll a formula into chat and track how Dicer handled the message.
 * @param {string} formula
 * @returns {Promise<{id: string, hiddenEarly: boolean | null, completeCount: number,
 *   msToComplete: number, scrolledIntoView: boolean | null, loopingAfter: boolean}>}
 *   hiddenEarly is null when the message element never appeared within 500 ms.
 */
export async function rollAndTrack(formula) {
  const completed = [];
  const start = performance.now();
  let messageId = null;
  let resolveFirst;
  const first = new Promise((r) => (resolveFirst = r));
  // Other messages (another user's roll) must not satisfy this one: filter by id.
  const hookId = Hooks.on('diceSoNiceRollComplete', (id) => {
    completed.push({ id, at: performance.now() });
    if (messageId !== null && id === messageId) resolveFirst();
  });
  try {
    const message = await new Roll(formula).toMessage();
    const id = message.id;
    messageId = id;
    if (completed.some((c) => c.id === id)) resolveFirst();
    const el = await waitForElement(id);
    const hiddenEarly = el ? el.classList.contains('dsn-hide') : null;
    // Rolls that Dicer does not animate (e.g. 1d7) never complete: stop waiting at the watchdog.
    await Promise.race([first, sleep(16000)]);
    const mine = completed.filter((c) => c.id === id);
    const msToComplete = mine.length ? Math.round(mine[0].at - start) : -1;
    // Foundry's scrollBottom is synchronous after the reveal; give layout one frame.
    await new Promise((r) => requestAnimationFrame(() => r()));
    const inView = mine.length ? scrolledIntoView(id) : null;
    await sleep(LOOP_SAMPLE_MS);
    return {
      id,
      hiddenEarly,
      completeCount: mine.length,
      msToComplete,
      scrolledIntoView: inView,
      loopingAfter: Boolean(game.dice3d?._debug?.isLooping),
    };
  } finally {
    Hooks.off('diceSoNiceRollComplete', hookId);
  }
}

/* ------------------------------------------------------------------------------------------ *
 * Privacy and compatibility RPCs (tests/live/compat.mjs). Everything recorded here is a view
 * kind, a count or a flag: never a roll value.
 * ------------------------------------------------------------------------------------------ */

const SAMPLE_MS = 40;

function freshWindow() {
  return {
    complete: {}, // message id -> diceSoNiceRollComplete count
    processed: {}, // message id -> willTrigger3DRoll
    elements: new Set(), // message ids that got a [data-message-id] element on this client
    maxActive: 0, // most dice rolls in flight (game.dice3d._debug.activeRolls)
    canvasShown: false, // the dice canvas was displayed at some sample
    looping: false,
  };
}

/** Starts recording on this client (idempotent). */
export function arm() {
  if (globalThis.__dicerCompat) return true;
  const state = { cur: freshWindow() };
  state.hookComplete = Hooks.on('diceSoNiceRollComplete', (id) => {
    state.cur.complete[id] = (state.cur.complete[id] ?? 0) + 1;
  });
  state.hookProcessed = Hooks.on('diceSoNiceMessageProcessed', (id, info) => {
    state.cur.processed[id] = Boolean(info?.willTrigger3DRoll);
  });
  const note = (node) => {
    if (node.nodeType !== 1) return;
    const own = node.dataset?.messageId;
    if (own) state.cur.elements.add(own);
    for (const el of node.querySelectorAll?.('[data-message-id]') ?? []) {
      state.cur.elements.add(el.dataset.messageId);
    }
  };
  state.observer = new MutationObserver((records) => {
    for (const r of records) r.addedNodes.forEach(note);
  });
  state.observer.observe(document.body, { childList: true, subtree: true });
  state.timer = setInterval(() => {
    const debug = game.dice3d?._debug;
    state.cur.maxActive = Math.max(state.cur.maxActive, debug?.activeRolls ?? 0);
    state.cur.looping ||= Boolean(debug?.isLooping);
    const canvas = document.querySelector('#dicer-layer canvas');
    if (canvas && canvas.style.display !== 'none') state.cur.canvasShown = true;
  }, SAMPLE_MS);
  globalThis.__dicerCompat = state;
  return true;
}

/** Forgets everything recorded so far; the next scenario starts clean. */
export function mark() {
  globalThis.__dicerCompat.cur = freshWindow();
  return true;
}

/**
 * Whether the rendered message shows any roll result: a total other than Foundry's private "?"
 * placeholder, or tooltip dice. A boolean only: no value ever leaves the page.
 */
function resultShownIn(id) {
  const safe = String(id).replace(/["\\]/g, '\\$&');
  const els = document.querySelectorAll(`[data-message-id="${safe}"]`);
  for (const el of els) {
    for (const total of el.querySelectorAll('.dice-total')) {
      const text = total.textContent.trim();
      if (text !== '' && text !== '?') return true;
    }
    if (el.querySelector('.dice-tooltip .roll.die, .dice-rolls .roll')) return true;
  }
  return false;
}

/** What this client saw for message `id` (null: only the window-wide facts). */
export function report(id) {
  const cur = globalThis.__dicerCompat.cur;
  return {
    completeCount: id ? (cur.complete[id] ?? 0) : null,
    processed: id ? (cur.processed[id] ?? null) : null,
    hasElement: id ? cur.elements.has(id) : null,
    resultShown: id ? resultShownIn(id) : null,
    views: id ? (game.dice3d._debug.lastRollViews[id] ?? null) : null,
    maxActive: cur.maxActive,
    canvasShown: cur.canvasShown,
    looping: cur.looping,
  };
}

export function getGhostSetting() {
  return game.settings.get('dicer', 'showGhostDice');
}

export function setGhostSetting(value) {
  return game.settings.set('dicer', 'showGhostDice', Boolean(value));
}

/** Rolls into chat with a roll mode ('publicroll' | 'gmroll' | 'blindroll' | 'selfroll'). */
export async function rollInChat({ formula, rollMode }) {
  const message = await new Roll(formula).toMessage({}, { rollMode });
  return message.id;
}

/** game.dice3d.showForRoll(roll, game.user, synchronize); resolves when the local show ends. */
export async function showForRollSynced(formula) {
  const roll = await new Roll(formula).evaluate();
  const shown = await game.dice3d.showForRoll(roll, game.user, true);
  return { shown };
}

/**
 * Rolls initiative for a throwaway combatant and samples the tracker row: was the value hidden
 * (dicer-hide-initiative) while the dice flew, and shown again afterwards. Cleans up after
 * itself. Returns { skipped } when there is no scene to hold a combat.
 */
export async function initiativeTrack() {
  if (!canvas?.scene) return { skipped: 'no active scene to hold a combat' };
  const combat = await Combat.create({ scene: canvas.scene.id, active: true });
  try {
    const [combatant] = await combat.createEmbeddedDocuments('Combatant', [
      { name: 'Dicer compat test' },
    ]);
    await ui.combat?.render?.({ force: true });
    ui.combat?.activate?.();
    const row = () =>
      ui.combat?.element?.querySelector(`[data-combatant-id="${combatant.id}"]`) ?? null;
    const valueEl = () => row()?.querySelector('.token-initiative, .initiative') ?? null;
    let hiddenWhileFlying = false;
    let sawValueEl = false;
    const sampler = setInterval(() => {
      const el = valueEl();
      if (!el) return;
      sawValueEl = true;
      if (el.classList.contains('dicer-hide-initiative')) hiddenWhileFlying = true;
    }, 10);
    const done = new Promise((resolve) => {
      const hookId = Hooks.on('diceSoNiceRollComplete', () => {
        Hooks.off('diceSoNiceRollComplete', hookId);
        resolve(true);
      });
      setTimeout(() => resolve(false), 16000);
    });
    await combat.rollInitiative([combatant.id]);
    const completed = await done;
    clearInterval(sampler);
    await sleep(600); // the reveal re-renders the tracker
    const el = valueEl();
    return {
      completed,
      sawValueEl,
      hiddenWhileFlying,
      shownAfter: Boolean(el) && !el.classList.contains('dicer-hide-initiative'),
    };
  } finally {
    await combat.delete();
  }
}

/* ------------------------------------------------------------------------------------------ *
 * Effects and sounds RPCs (tests/live/effects.mjs). Names and counts only: the counters in
 * game.dice3d._debug hold effect ids and result sound names, never roll values.
 * ------------------------------------------------------------------------------------------ */

/** This client's effect play and result sound counters (copies). */
export function fxCounts() {
  const d = game.dice3d._debug;
  return { fxPlays: { ...d.fxPlays }, resultSounds: { ...d.resultSounds } };
}

export function getDicerSetting(key) {
  return game.settings.get('dicer', key);
}

export function setDicerSetting({ key, value }) {
  return game.settings.set('dicer', key, value);
}

/** Rolls a 1d20 forced to a natural 20 into chat with the roll mode; returns the message id. */
export async function rollNat20({ rollMode }) {
  const roll = await new Roll('1d20').evaluate();
  roll.dice[0].results[0].result = 20;
  roll._total = 20;
  const message = await roll.toMessage({}, { rollMode });
  return message.id;
}

/** View kinds ('real' | 'ghost' | 'none') this client used for message `id`; null if none recorded. */
export function viewKinds(id) {
  return game.dice3d._debug.lastRollViews[id] ?? null;
}

// --- roll areas (tests/live/areas.mjs) ---------------------------------------------------------

/** This client's user id. */
export function myUserId() {
  return game.user.id;
}

/** game.dice3d._debug.lastRollArea as plain data: {area, rect} of the latest roll here, or null. */
export function lastRollArea() {
  return game.dice3d._debug.lastRollArea;
}

/** game.dice3d.rollAreas.set(userId, def); userId null sets the default area. Resolves true on success. */
export function setRollArea({ userId, def }) {
  return game.dice3d.rollAreas.set(userId ?? null, def);
}

export function setGmPrivateArea(def) {
  return game.dice3d.rollAreas.setGmPrivateArea(def);
}

/** The px rect the area of `userId` (null: the default) resolves to on this screen. */
export function rollAreaRect(userId) {
  return game.dice3d.rollAreas.rect(userId ?? null);
}

/**
 * The px rect `def` resolves to on this screen: an independent check of the GM private corner.
 * It assumes the default area is the full stage and this client's areaScale is 1 (areas.mjs sets
 * both), so rollAreas.rect(null) is the stage itself and no scale is applied again here.
 */
export async function resolveHere(def) {
  const { resolveArea } = await import('/modules/dicer/src/areas/area-model.js');
  return resolveArea(def, game.dice3d.rollAreas.rect(null));
}

/* ------------------------------------------------------------------------------------------ *
 * Benchmark harness RPCs (tests/live/bench.mjs). The runner and the Dicer adapter load from
 * /modules/dicer/src/bench/*.js, which works with Dicer disabled (DSN active).
 * ------------------------------------------------------------------------------------------ */

const BENCH = '/modules/dicer/src/bench/';
const SCENARIO_SETTLE_MS = 4000;
const IDLE_WAIT_MS = 16000;
const RESTORE_WAIT_MS = 3000;
/**
 * P9-R2: every bench roll speaks as a plain alias, never a token or character. DSN skips an
 * NPC speaker's roll when hideNpcRolls is on, and resolves a player owner's appearance;
 * neither belongs in a frame measurement, and both products get the same speaker.
 */
const BENCH_SPEAKER = Object.freeze({ alias: 'Dice benchmark' });
/** Progress lines for the Node side (bench.mjs relays console lines with this prefix). */
const progress = (text) => console.info(`[dicer-bench] ${text}`);

const finiteNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Pure (unit-tested): ids of the messages `userId` authored at or after `sinceMs` (H-R11: what a
 * crashed bench run left in the GM's world).
 */
export function messageIdsSince(messages, userId, sinceMs) {
  if (!finiteNum(sinceMs)) return [];
  const out = [];
  for (const m of messages ?? []) {
    const author = m?.author?.id ?? m?._source?.author ?? null;
    if (author === userId && Number(m?.timestamp) >= sinceMs) out.push(m.id);
  }
  return out;
}

/**
 * Pure (unit-tested), I3: the roll after a context restore recovered when the context is live and
 * that roll drew (a gate first frame, or the frame counter moved while its dice were up). null
 * when the context or every draw signal is unknown.
 */
export function recoveryVerdict({ lost, firstFrame, framesBefore, framesAfter }) {
  if (typeof lost !== 'boolean') return null;
  if (lost) return false;
  if (finiteNum(firstFrame)) return true;
  if (!finiteNum(framesBefore) || !finiteNum(framesAfter)) return null;
  return framesAfter > framesBefore;
}

/** Deletes the chat messages `ids` that still exist; resolves how many. */
async function deleteMessages(ids) {
  const live = [...new Set(ids)].filter((id) => game.messages?.has(id));
  if (live.length) await (ChatMessage.implementation ?? ChatMessage).deleteDocuments(live);
  return live.length;
}

/** H-R11 restore step: deletes the tracked message ids that still exist. */
export function deleteMessageIds({ ids }) {
  return deleteMessages(Array.isArray(ids) ? ids : []);
}

/**
 * Records a created message: in `created` (benchRun deletes it after the scenario) and node-side
 * through the bench.mjs binding, which persists it into restore.json (fire and forget).
 */
function track(created, id) {
  created.push(id);
  try {
    Promise.resolve(globalThis.__benchTrackMessage?.(id)).catch(() => {});
  } catch {
    /* no binding: nothing persisted */
  }
}

/** H-R11 crash-restore fallback only: deletes this user's chat messages from `since` (ISO) on. */
export async function deleteMessagesSince({ since }) {
  const ids = messageIdsSince(game.messages?.contents ?? [], game.user.id, Date.parse(since));
  return deleteMessages(ids);
}

/** The active dice product: exactly one of Dicer / DSN active, else null. */
export function benchProduct() {
  const dicer = Boolean(game.modules.get('dicer')?.active);
  const dsn = Boolean(game.modules.get('dice-so-nice')?.active);
  if (dicer && !dsn) return 'dicer';
  if (dsn && !dicer) return 'dice-so-nice';
  return null;
}

/** Ready to roll: the world is up and the active product's game.dice3d exists. */
export function benchReady() {
  return Boolean(game.ready && game.dice3d);
}

export function isGM() {
  return Boolean(game.user?.isGM);
}

const plain = (v) => {
  try {
    return v === undefined ? null : JSON.parse(JSON.stringify(v));
  } catch {
    return String(v);
  }
};

/** Snapshot of the active product's world (and client) settings, for the report. */
export function benchSettings() {
  const product = benchProduct();
  const world = {};
  const client = {};
  if (product) {
    for (const s of game.settings.settings.values()) {
      if (s.namespace !== product) continue;
      const bucket = s.scope === 'world' ? world : s.scope === 'client' ? client : null;
      if (!bucket) continue;
      try {
        bucket[s.key] = plain(game.settings.get(s.namespace, s.key));
      } catch {
        bucket[s.key] = null;
      }
    }
  }
  // M6: G2 measures with a Foundry scene loaded; summary.md warns when there is none.
  return { product, world, client, sceneLoaded: Boolean(globalThis.canvas?.scene) };
}

export function getModuleConfiguration() {
  return plain(game.settings.get('core', 'moduleConfiguration'));
}

/**
 * Merges `partial` into core.moduleConfiguration (other modules untouched). The restore passes
 * only the dicer / dice-so-nice keys of the original snapshot. The caller reloads.
 */
export async function mergeModuleConfiguration(partial) {
  const cfg = { ...(game.settings.get('core', 'moduleConfiguration') ?? {}), ...(partial ?? {}) };
  await game.settings.set('core', 'moduleConfiguration', cfg);
  return true;
}

/** core.moduleConfiguration with exactly one of dicer / dice-so-nice enabled. The caller reloads. */
export function setDiceModule(id) {
  if (id !== 'dicer' && id !== 'dice-so-nice') throw Error(`unknown dice module: ${id}`);
  return mergeModuleConfiguration({ dicer: id === 'dicer', 'dice-so-nice': id === 'dice-so-nice' });
}

/** A registered setting's value (the namespace's module must be active). */
export function getSetting({ namespace, key }) {
  return plain(game.settings.get(namespace, key));
}

export async function setSetting({ namespace, key, value }) {
  await game.settings.set(namespace, key, value);
  return true;
}

/**
 * H-R8: DSN 6.4.5's graphics options live in the user flag flags['dice-so-nice'].settings.
 * Returns `{exists, value?}` (read raw, so it works whatever module is active).
 */
export function getDsnUserFlag() {
  const v = game.user.flags?.['dice-so-nice']?.settings;
  return v === undefined || v === null ? { exists: false } : { exists: true, value: plain(v) };
}

/** Writes `{exists, value?}`: unset, or replace with exactly `value` (DSN must be active). */
export async function setDsnUserFlag(flag) {
  await game.user.unsetFlag('dice-so-nice', 'settings');
  if (flag?.exists) await game.user.setFlag('dice-so-nice', 'settings', flag.value);
  return getDsnUserFlag();
}

function benchBrowser() {
  const ua = navigator.userAgent;
  for (const [re, name] of [
    [/Edg\/(\d+)/, 'Edge'],
    [/Firefox\/(\d+)/, 'Firefox'],
    [/Chrome\/(\d+)/, 'Chrome'],
  ]) {
    const m = re.exec(ua);
    if (m) return `${name} ${m[1]}`;
  }
  return ua.slice(0, 60);
}

function benchGpu() {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER);
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return name ? String(name) : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** The product's dice canvas (Dicer _debug.canvas, DSN box.renderer.domElement). */
function productCanvas(product) {
  if (product === 'dicer') return game.dice3d?._debug?.canvas ?? null;
  return game.dice3d?.box?.renderer?.domElement ?? null;
}

const productGl = (c) => (c ? (c.getContext('webgl2') ?? c.getContext('webgl')) : null);

/** The product's frame counter: Dicer's renderer frames, DSN's three.js render.frame. */
function productFrames(product) {
  const v =
    product === 'dicer'
      ? game.dice3d?._debug?.frameCount
      : game.dice3d?.box?.renderer?.info?.render?.frame;
  return finiteNum(v) ? v : null;
}

/**
 * WEBGL_lose_context on the product's canvas, restored after `ms`. Settles once the canvas fires
 * webglcontextrestored (the runner rolls again only then); throws when it does not within 3 s.
 */
async function loseContext(product, ms) {
  const c = productCanvas(product);
  if (!c) throw Error('no dice canvas');
  const ext = productGl(c)?.getExtension('WEBGL_lose_context');
  if (!ext) throw Error('WEBGL_lose_context unavailable');
  ext.loseContext();
  await sleep(ms);
  let timer = null;
  const restored = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), RESTORE_WAIT_MS);
    c.addEventListener('webglcontextrestored', () => resolve(true), { once: true });
  });
  ext.restoreContext();
  const ok = await restored;
  clearTimeout(timer);
  if (!ok) throw Error(`context not restored within ${RESTORE_WAIT_MS} ms`);
}

/** Renderer identity: a resize or context restore that swaps either one rebuilt the renderer. */
function rendererIdentity(product) {
  return {
    canvas: productCanvas(product),
    generation: product === 'dicer' ? (game.dice3d?._debug?.generation ?? null) : null,
  };
}

/**
 * @param {string[]} created every chat message id the adapter creates (benchRun deletes them, H-R11)
 * @param {string} gpu the GPU name, read once per benchRun (M4)
 */
function benchAdapter(product, createDicerAdapter, { created, gpu }) {
  // I3: the frame counter when the latest roll was called, for verifyRecovered.
  let framesAtRoll = null;
  // H-R3/H-R6: the chat path ({messageId}) for both products.
  const roll = async (f) => {
    framesAtRoll = productFrames(product);
    const m = await new Roll(f).toMessage({ speaker: { ...BENCH_SPEAKER } });
    track(created, m.id);
    return { messageId: m.id };
  };
  const firstFrameOf = (id) => {
    if (product !== 'dicer' || id == null) return null;
    const v = game.dice3d?._debug?.firstFrames?.[id];
    return finiteNum(v) ? v : null;
  };
  // I3: after the contextLoss recovery roll: a live context, and that roll drew.
  const verifyRecovered = ({ messageId } = {}) => {
    const gl = productGl(productCanvas(product));
    return recoveryVerdict({
      lost: gl ? gl.isContextLost() : null,
      firstFrame: firstFrameOf(messageId),
      framesBefore: framesAtRoll,
      framesAfter: productFrames(product),
    });
  };
  // Node-side CDP: HeapProfiler.collectGarbage, then Runtime.getHeapUsage (bench.mjs binding).
  const heap = async () =>
    typeof globalThis.__benchHeap === 'function' ? globalThis.__benchHeap() : null;
  const perturb = async (kind, ms) => {
    if (kind === 'contextLoss') return loseContext(product, ms);
    // resize: Playwright setViewportSize; hidden: another page in front for ms (bench.mjs binding).
    if (typeof globalThis.__benchPerturb === 'function') return globalThis.__benchPerturb(kind, ms);
    if (kind === 'resize') globalThis.dispatchEvent(new Event('resize'));
  };
  // H-D5: back to back, the next roll starts when the previous message completes (no idle wait).
  const isBusy = () => false;
  // P9-R3: the soak deletes its messages every 50 rolls, so 500 chat cards are not in the heap.
  const cleanup = () => deleteMessages(created.splice(0));
  if (product === 'dicer') {
    const api = game.dice3d;
    const base = createDicerAdapter(api, {
      roll,
      gpu,
      version: game.modules.get('dicer')?.version ?? null,
    });
    return {
      ...base,
      isBusy,
      heap,
      cleanup,
      perturb,
      verifyRecovered,
      idle: () => !base.isBusy(),
      dicerFirstFrame: firstFrameOf,
    };
  }
  return {
    product: 'dice-so-nice',
    roll,
    isBusy,
    heap,
    cleanup,
    perturb,
    verifyRecovered,
    idle: () => true,
    resources() {
      const info = game.dice3d?.box?.renderer?.info;
      if (!info) return null;
      return {
        geometries: info.memory?.geometries ?? 0,
        textures: info.memory?.textures ?? 0,
        programs: Array.isArray(info.programs) ? info.programs.length : 0,
      };
    },
    dicerFirstFrame: () => null,
    info: () => ({
      browser: benchBrowser(),
      gpu,
      tier: null,
      version: game.modules.get('dice-so-nice')?.version ?? null,
    }),
  };
}

/** Between scenarios: a fixed settle, then Dicer waits until no dice and no loop (bounded). */
async function settle(adapter) {
  await sleep(SCENARIO_SETTLE_MS);
  // P9-R4: a full GC now, so garbage left by page load or the last scenario is not collected
  // as a long task inside the next one (a 500 MB Foundry heap collects in hundreds of ms).
  try {
    await adapter.heap?.();
  } catch {
    // best effort: without the binding the scenario runs as before
  }
  const until = performance.now() + IDLE_WAIT_MS;
  while (!adapter.idle() && performance.now() < until) await sleep(100);
}

/**
 * Runs scenarios `ids` against the active product with chat rolls; resolves a SuiteResult.
 * resize/contextLoss results carry `rebuilt` (canvas or generation changed) and a note. Every
 * chat message a scenario (or the warm-up) created is deleted when it ends (H-R11).
 */
export async function benchRun({ ids, profile, rolls = null }) {
  const product = benchProduct();
  if (!product) throw Error('exactly one of dicer / dice-so-nice must be active');
  const { runSuite } = await import(`${BENCH}scenarios.js`);
  const { createDicerAdapter } = await import(`${BENCH}dicer-adapter.js`);
  const created = [];
  const adapter = benchAdapter(product, createDicerAdapter, { created, gpu: benchGpu() });
  const results = [];
  let meta = null;
  let warmup;
  try {
    progress(`${profile}: warm-up roll`);
    warmup = await warmupRoll(created);
    if (!warmup.started) progress(`${profile}: warning: the warm-up roll did not animate (${JSON.stringify(warmup.why)})`);
    await deleteMessages(created.splice(0));
    for (const [n, id] of ids.entries()) {
      await settle(adapter);
      const before = rendererIdentity(product);
      try {
        progress(`${profile}: scenario ${n + 1}/${ids.length} ${id}`);
        const t0 = performance.now();
        const part = await runSuite([id], adapter, { profile, hooks: Hooks, rolls });
        const r = part.results[0];
        progress(`${profile}: ${id} done in ${((performance.now() - t0) / 1000).toFixed(0)} s, failures ${r?.failures ?? 'n/a'}`);
        if (id === 'resize' || id === 'contextLoss') {
          await sleep(1000); // a context restore lands asynchronously
          const after = rendererIdentity(product);
          const rebuilt = before.canvas !== after.canvas || before.generation !== after.generation;
          for (const r of part.results) {
            r.rebuilt = rebuilt;
            r.notes.push(rebuilt ? 'renderer rebuilt' : 'renderer kept');
          }
        }
        results.push(...part.results);
        meta = part;
      } finally {
        await deleteMessages(created.splice(0));
      }
    }
  } finally {
    // Whatever a throw left behind; a killed page leaves it to the restore (deleteMessagesSince).
    await deleteMessages(created.splice(0)).catch(() => {});
  }
  return {
    browser: meta?.browser ?? null,
    gpu: meta?.gpu ?? null,
    tier: meta?.tier ?? null,
    version: meta?.version ?? null,
    profile,
    warmup,
    results,
  };
}

/** Every die type the scenarios roll, so the warm-up loads each one's assets once. */
const WARMUP_FORMULA = '1d4+1d6+1d8+1d10+1d12+1d20';

/**
 * One unrecorded chat roll of every die type before the scenarios (both products), so neither
 * pays its first-roll setup inside a measured scenario. Waits for its diceSoNiceRollComplete
 * (16 s cap). Its message id goes into `created` (the caller deletes it). `started`: the product
 * fired diceSoNiceRollStart for it, i.e. it animated (P9-R2); `why` is what may explain a skip.
 */
async function warmupRoll(created) {
  let id = null;
  let resolveDone;
  const done = new Promise((r) => (resolveDone = r));
  const seen = new Set();
  const starts = new Set();
  const startId = Hooks.on('diceSoNiceRollStart', (mid) => starts.add(mid));
  const hookId = Hooks.on('diceSoNiceRollComplete', (mid) => {
    seen.add(mid);
    if (mid === id) resolveDone(true);
  });
  try {
    const t0 = performance.now();
    id = (await new Roll(WARMUP_FORMULA).toMessage({ speaker: { ...BENCH_SPEAKER } })).id;
    track(created, id);
    if (seen.has(id)) resolveDone(true);
    const completed = await Promise.race([done, sleep(IDLE_WAIT_MS).then(() => false)]);
    const started = starts.has(id);
    return {
      completed,
      started,
      ms: Math.round(performance.now() - t0),
      ...(started ? {} : { why: skipReasons() }),
    };
  } finally {
    Hooks.off('diceSoNiceRollStart', startId);
    Hooks.off('diceSoNiceRollComplete', hookId);
  }
}

/** Settings that make a product skip an animation, read for the report when the warm-up did not animate. */
function skipReasons() {
  const get = (scope, key) => {
    try {
      return game.settings.get(scope, key);
    } catch {
      return undefined;
    }
  };
  const dsnUser = game.user?.getFlag?.('dice-so-nice', 'settings') ?? null;
  return {
    documentHidden: document.hidden,
    combatStarted: Boolean(game.combat?.started),
    dsnVisibility: dsnUser?.visibility ?? null,
    dsnHideNpcRolls: get('dice-so-nice', 'hideNpcRolls'),
    dsnDisabledDuringCombat: get('dice-so-nice', 'disabledDuringCombat'),
    dsnImmediatelyDisplay: get('dice-so-nice', 'immediatelyDisplayChatMessages'),
    dsnMessageHookDisabled: game.dice3d?.messageHookDisabled ?? null,
  };
}
