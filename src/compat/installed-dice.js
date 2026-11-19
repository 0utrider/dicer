/**
 * Dice from installed modules that are not active in this world (lazy chunk). A dice-set module
 * registers its dice in a `diceSoNiceReady` hook, which only runs when the module is active; this
 * runs such a module's scripts with a stand-in `Hooks` that keeps only the Dice So Nice hooks, then
 * calls those with game.dice3d. Only modules whose scripts do nothing else are offered (a module that
 * also registers settings, other hooks, wrappers or globals is not run: its other work would happen
 * while it is off). The GM picks them (ui/installed-dice.js); the world setting `installedDice`
 * holds each pick's id, title and script paths, so every client loads the same scripts.
 */

const DSN_HOOKS = ['diceSoNiceInit', 'diceSoNiceReady'];
const MENTIONS = /diceSoNice(?:Init|Ready)/;
const REGISTERS = /\.\s*add(?:System|DicePreset|Colorset|Texture|DiceShape)\s*\(/;
// a hook other than Dice So Nice's
const OTHER_HOOK = /Hooks\s*\.\s*(?:on|once)\s*\(\s*(['"`])(?!diceSoNice(?:Init|Ready)\1)/;
// work beyond registering dice: settings, keybindings, wrappers, CONFIG writes, globals, more code
const OTHER_WORK =
  /game\s*\.\s*(?:settings|keybindings)\s*\.\s*register|libWrapper|\bCONFIG\s*(?:\.\s*[\w$]+|\[[^\]]*\])+\s*=(?!=)|\bimport\s*\(|\bglobalThis\b|\bwindow\s*\.|\bdocument\s*\.|\bfetch\s*\(|\beval\s*\(/;
const SKIP = new Set(['dicer', 'dice-so-nice']);
const SAFE_PATH = /^modules\/[\w.-]+\/[^:?#]+\.m?js$/i;

const loaded = new Set(); // module ids whose dice this page has loaded

/** A script's text (a failed fetch throws). */
export async function fetchText(path) {
  const res = await fetch(globalThis.foundry?.utils?.getRoute?.(path) ?? path);
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.text();
}
const activeNow = (id) => globalThis.game?.modules?.get?.(id)?.active === true;

/** A module's own files from one manifest list (`modules/<id>/…` scripts only, never another host). */
const ownFiles = (id, list) =>
  [...(list ?? [])]
    .map((p) => String(p).replace(/^\/+/, ''))
    .filter((p) => SAFE_PATH.test(p) && p.startsWith(`modules/${id}/`) && !p.includes('..'));

/** A module's script paths Dicer will fetch: its own files only (`modules/<id>/…`), never another host. */
export const scriptsOf = (mod) => [...ownFiles(mod?.id, mod?.esmodules), ...ownFiles(mod?.id, mod?.scripts)];

/** Whether `source` runs as a plain script (an ES module's import/export, or top-level await, does not). */
function compiles(source) {
  try {
    new Function('Hooks', 'libWrapper', source);
    return true;
  } catch {
    return false;
  }
}

/**
 * What a module's scripts are: 'ok' (only registers dice), 'none' (no dice), 'other' (does more
 * than register dice) or 'bundle' (an ES module or bundle Dicer cannot run apart from it).
 */
export function classify(texts) {
  const all = texts.join('\n;\n');
  if (!MENTIONS.test(all) || !REGISTERS.test(all)) return 'none';
  if (!texts.every(compiles)) return 'bundle';
  if (OTHER_HOOK.test(all) || OTHER_WORK.test(all)) return 'other';
  return 'ok';
}

/** The module ids a module names in one of its relationships ('requires', 'recommends'). */
function related(mod, kind) {
  const v = mod.relationships?.[kind];
  return v && typeof v[Symbol.iterator] === 'function' ? [...v].map((r) => r?.id) : [];
}

/** Whether a module needs Dice So Nice (a Dice So Nice add-on: Foundry will not activate it while Dice So Nice is off). */
export const needsDsn = (mod) => related(mod, 'requires').includes('dice-so-nice');

/** Whether a module may hold dice: it names Dice So Nice as needed or recommended, or "dice" is in its name. */
function mayHoldDice(mod) {
  return needsDsn(mod) || related(mod, 'recommends').includes('dice-so-nice') || /dice/i.test(`${mod.id} ${mod.title ?? ''}`);
}

/**
 * The inactive installed modules that register dice, each `{id, title, scripts, status}` (status
 * as classify; `addon: true` when it needs Dice So Nice, so loadDsnAddons can run it), sorted by title. `fetchText(path)` reads a script (a failed one skips the module).
 */
export async function scanInstalled({ modules, fetchText }) {
  const mods = [...(modules?.values?.() ?? modules ?? [])].filter(
    (m) => m && !m.active && !SKIP.has(m.id) && mayHoldDice(m),
  );
  const found = await Promise.all(
    mods.map(async (m) => {
      const scripts = scriptsOf(m);
      if (!scripts.length) return null;
      try {
        const texts = await Promise.all(scripts.map(fetchText));
        const status = classify(texts);
        if (status === 'none') return null;
        const found = { id: m.id, title: m.title || m.id, scripts, status };
        return needsDsn(m) ? { ...found, addon: true } : found;
      } catch {
        return null;
      }
    }),
  );
  return found.filter(Boolean).sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Runs scripts with a stand-in Hooks and calls their Dice So Nice hooks (init, then ready) with
 * `api`. Returns how many hooks ran; throws what the scripts throw.
 */
export async function runDice(texts, api, name = 'module') {
  const caught = Object.fromEntries(DSN_HOOKS.map((h) => [h, []]));
  const keep = (hook, fn) => {
    if (caught[hook] && typeof fn === 'function') caught[hook].push(fn);
    return 0;
  };
  const hooks = { on: keep, once: keep, off() {}, callAll() {}, call: () => true };
  for (const [i, text] of texts.entries())
    new Function('Hooks', 'libWrapper', `${text}\n//# sourceURL=dicer-installed-dice/${name}/${i}.js`)(hooks, undefined);
  const fns = DSN_HOOKS.flatMap((h) => caught[h]);
  for (const fn of fns) await fn(api);
  return fns.length;
}

/**
 * Loads the dice of the picked modules (the `installedDice` setting) not loaded on this page yet,
 * and not active (`isActive(id)`). Each is re-read and re-checked (it may have been updated since
 * it was picked). Returns the ids loaded now.
 */
export async function loadInstalledDice(list, { api, fetchText: read = fetchText, isActive = activeNow, warn = (...a) => console.warn(...a) }) {
  const done = [];
  for (const pick of Array.isArray(list) ? list : []) {
    const id = pick?.id;
    // an active module registers its dice itself
    if (typeof id !== 'string' || loaded.has(id) || !Array.isArray(pick.scripts) || isActive(id)) continue;
    const scripts = pick.scripts.filter((p) => typeof p === 'string' && SAFE_PATH.test(p) && p.startsWith(`modules/${id}/`) && !p.includes('..'));
    if (!scripts.length) continue;
    loaded.add(id);
    try {
      const texts = await Promise.all(scripts.map(read));
      if (classify(texts) !== 'ok') {
        warn(`dicer: the dice of "${pick.title ?? id}" were not loaded (the module now does more than add dice)`);
        continue;
      }
      await runDice(texts, api, id);
      done.push(id);
    } catch (err) {
      warn(`dicer: cannot load the dice of "${pick.title ?? id}"`, err);
    }
  }
  return done;
}

// Foundry's start hooks: all have fired by the time Dicer loads add-ons (in its ready hook)
const STARTED = new Set(['init', 'i18nInit', 'setup', 'ready']);

/** Runs a plain (non-module) script the way Foundry loads a module's `scripts`; resolves once it ran. */
export function addScript(url) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = url;
    el.async = false;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`cannot load ${url}`));
    document.head.append(el);
  });
}

const importModule = (url) => import(/* @vite-ignore */ url);

/**
 * Runs the picked Dice So Nice add-ons (the `dsnAddons` setting: module ids) in full while they
 * stay inactive: such a module needs Dice So Nice, which must stay off, so Foundry will not
 * activate it; nothing else in it checks. Each pick's `scripts` then `esmodules` load from its
 * manifest (its own files only). Dicer runs this in its ready hook before announcing game.dice3d,
 * so the add-ons' diceSoNiceInit/diceSoNiceReady listeners are live for that; listeners for start
 * hooks that have already fired (init, i18nInit, setup, ready) are caught while the files load and
 * run right after. Active modules (they load themselves), Dicer and Dice So Nice are skipped, and
 * each module loads once per page. Returns the ids loaded now.
 */
export async function loadDsnAddons(
  ids,
  {
    hooks = globalThis.Hooks,
    modules = globalThis.game?.modules,
    route = (p) => globalThis.foundry?.utils?.getRoute?.(p) ?? `/${p}`,
    script = addScript,
    esmodule = importModule,
    warn = (...a) => console.warn(...a),
  } = {},
) {
  const caught = [];
  const done = [];
  let current = null;
  const { on, once } = hooks;
  const wrap = (orig) =>
    function (hook, fn, ...rest) {
      if (!STARTED.has(hook) || typeof fn !== 'function') return orig.call(this, hook, fn, ...rest);
      caught.push({ id: current, hook, fn });
      return 0;
    };
  hooks.on = wrap(on);
  hooks.once = wrap(once);
  try {
    for (const id of new Set(Array.isArray(ids) ? ids : [])) {
      const mod = typeof id === 'string' && !SKIP.has(id) && !loaded.has(id) ? modules?.get?.(id) : null;
      if (!mod || mod.active) continue;
      const files = [...ownFiles(id, mod.scripts).map((p) => [script, p]), ...ownFiles(id, mod.esmodules).map((p) => [esmodule, p])];
      if (!files.length) continue;
      loaded.add(id);
      current = id;
      for (const [load, path] of files) {
        try {
          await load(route(path));
        } catch (err) {
          warn(`dicer: the Dice So Nice add-on "${id}" could not load ${path}`, err);
        }
      }
      done.push(id);
    }
  } finally {
    hooks.on = on;
    hooks.once = once;
  }
  for (const { id, hook, fn } of caught) {
    try {
      await fn();
    } catch (err) {
      warn(`dicer: the ${hook} hook of the Dice So Nice add-on "${id ?? '?'}" failed`, err);
    }
  }
  return done;
}

/** Whether a module's dice were loaded on this page (the picker marks them). */
export const isLoaded = (id) => loaded.has(id);

/** Forgets what was loaded (tests). */
export const resetLoaded = () => loaded.clear();
