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

/** A module's script paths Dicer will fetch: its own files only (`modules/<id>/…`), never another host. */
export function scriptsOf(mod) {
  const id = mod?.id;
  const all = [...(mod?.esmodules ?? []), ...(mod?.scripts ?? [])].map((p) => String(p).replace(/^\/+/, ''));
  return all.filter((p) => SAFE_PATH.test(p) && p.startsWith(`modules/${id}/`) && !p.includes('..'));
}

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

/** Whether a module may hold dice: it names Dice So Nice as needed or recommended, or "dice" is in its name. */
function mayHoldDice(mod) {
  const rel = mod.relationships ?? {};
  const ids = ['requires', 'recommends'].flatMap((k) => {
    const v = rel[k];
    return v && typeof v[Symbol.iterator] === 'function' ? [...v].map((r) => r?.id) : [];
  });
  return ids.includes('dice-so-nice') || /dice/i.test(`${mod.id} ${mod.title ?? ''}`);
}

/**
 * The inactive installed modules that register dice, each `{id, title, scripts, status}` (status
 * as classify), sorted by title. `fetchText(path)` reads a script (a failed one skips the module).
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
        return status === 'none' ? null : { id: m.id, title: m.title || m.id, scripts, status };
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

/** Whether a module's dice were loaded on this page (the picker marks them). */
export const isLoaded = (id) => loaded.has(id);

/** Forgets what was loaded (tests). */
export const resetLoaded = () => loaded.clear();
