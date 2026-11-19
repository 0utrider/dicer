/**
 * Dice So Nice add-ons run in full while they and Dice So Nice stay off (loadDsnAddons in
 * src/compat/installed-dice.js): their files load in order, listeners for start hooks that have
 * already fired are caught and run right after, and active modules are skipped.
 */
import { afterEach, expect, test, vi } from 'vitest';
import { loadDsnAddons, loadInstalledDice, isLoaded, resetLoaded } from '../../src/compat/installed-dice.js';

afterEach(() => resetLoaded());

/** A Hooks stand-in that records live registrations (as Foundry's does) and can fire them. */
function fakeHooks() {
  const events = {};
  const hooks = {
    on(hook, fn) {
      (events[hook] ??= []).push(fn);
      return events[hook].length;
    },
    once(hook, fn) {
      return this.on(hook, fn); // Foundry's once goes through on
    },
    callAll(hook, ...args) {
      for (const fn of events[hook] ?? []) fn(...args);
    },
  };
  return { hooks, events };
}

const mods = (...list) => new Map(list.map((m) => [m.id, { active: false, scripts: new Set(), esmodules: new Set(), ...m }]));

/** Loaders that "run" a file by calling the body registered for its route. */
function files(bodies, order = []) {
  const run = async (url) => {
    order.push(url);
    const body = bodies[url];
    if (!body) throw new Error(`404 ${url}`);
    await body();
  };
  return { script: vi.fn(run), esmodule: vi.fn(run) };
}

const route = (p) => `/${p}`;

test("each pick's scripts load as scripts, then its ES modules, in manifest order; only its own files", async () => {
  const { hooks } = fakeHooks();
  const order = [];
  const ran = [];
  const loaders = files(
    {
      '/modules/lordu/a.js': () => ran.push('a'),
      '/modules/lordu/b.js': () => ran.push('b'),
      '/modules/lordu/esm.mjs': () => ran.push('esm'),
    },
    order,
  );
  const modules = mods({
    id: 'lordu',
    scripts: new Set(['modules/lordu/a.js', 'modules/lordu/b.js', 'https://evil.example/x.js', 'modules/other/x.js']),
    esmodules: new Set(['modules/lordu/esm.mjs', 'modules/lordu/../x.js']),
  });
  expect(await loadDsnAddons(['lordu'], { hooks, modules, route, ...loaders })).toEqual(['lordu']);
  expect(order).toEqual(['/modules/lordu/a.js', '/modules/lordu/b.js', '/modules/lordu/esm.mjs']);
  expect(loaders.script).toHaveBeenCalledTimes(2);
  expect(loaders.esmodule).toHaveBeenCalledTimes(1);
  expect(ran).toEqual(['a', 'b', 'esm']);
  expect(isLoaded('lordu')).toBe(true);
});

test('start-hook listeners registered while loading are caught, then run in order once loading is done', async () => {
  const { hooks, events } = fakeHooks();
  const { on, once } = hooks;
  const calls = [];
  const loaders = files({
    '/modules/lordu/a.js': () => {
      hooks.once('init', () => calls.push('init'));
      hooks.on('diceSoNiceReady', (api) => calls.push(['dsnReady', api]));
      expect(calls).toEqual([]); // nothing runs while the files load
    },
    '/modules/handy/a.js': () => {
      hooks.on('setup', () => calls.push('setup'));
      hooks.once('ready', async () => {
        await Promise.resolve();
        calls.push('ready');
      });
      hooks.on('i18nInit', () => calls.push('i18n'));
      hooks.on('renderDiceConfig', () => calls.push('render'));
    },
  });
  const modules = mods({ id: 'lordu', scripts: new Set(['modules/lordu/a.js']) }, { id: 'handy', scripts: new Set(['modules/handy/a.js']) });
  await loadDsnAddons(['lordu', 'handy'], { hooks, modules, route, ...loaders });
  expect(calls).toEqual(['init', 'setup', 'ready', 'i18n']);
  // Hooks is itself again, and the other listeners were registered for real
  expect(hooks.on).toBe(on);
  expect(hooks.once).toBe(once);
  expect(events.init).toBeUndefined();
  expect(events.ready).toBeUndefined();
  expect(events.diceSoNiceReady).toHaveLength(1);
  expect(events.renderDiceConfig).toHaveLength(1);
  hooks.callAll('diceSoNiceReady', 'api');
  expect(calls.at(-1)).toEqual(['dsnReady', 'api']);
});

test('active modules, unknown ids, Dicer, Dice So Nice and repeats are skipped', async () => {
  const { hooks } = fakeHooks();
  const loaders = files({ '/modules/soup/a.js': () => {}, '/modules/live/a.js': () => {} });
  const modules = mods(
    { id: 'soup', scripts: new Set(['modules/soup/a.js']) },
    { id: 'live', active: true, scripts: new Set(['modules/live/a.js']) },
    { id: 'dice-so-nice', scripts: new Set(['modules/dice-so-nice/main.js']) },
    { id: 'dicer', scripts: new Set(['modules/dicer/dicer.js']) },
  );
  const ids = ['soup', 'live', 'gone', 'dice-so-nice', 'dicer', 'soup', 42];
  expect(await loadDsnAddons(ids, { hooks, modules, route, ...loaders })).toEqual(['soup']);
  expect(loaders.script).toHaveBeenCalledTimes(1);
  expect(await loadDsnAddons(ids, { hooks, modules, route, ...loaders })).toEqual([]); // once per page
  expect(loaders.script).toHaveBeenCalledTimes(1);
});

test('a file that fails or a listener that throws warns and the rest still load; Hooks is restored', async () => {
  const { hooks } = fakeHooks();
  const { on, once } = hooks;
  const warn = vi.fn();
  const calls = [];
  const loaders = files({
    '/modules/bad/b.js': () => hooks.once('init', () => calls.push('bad-init')),
    '/modules/good/a.js': () => {
      hooks.once('init', () => {
        throw new Error('boom');
      });
      hooks.once('setup', () => calls.push('good-setup'));
    },
  });
  const modules = mods(
    { id: 'bad', scripts: new Set(['modules/bad/missing.js', 'modules/bad/b.js']) },
    { id: 'good', scripts: new Set(['modules/good/a.js']) },
  );
  expect(await loadDsnAddons(['bad', 'good'], { hooks, modules, route, warn, ...loaders })).toEqual(['bad', 'good']);
  expect(calls).toEqual(['bad-init', 'good-setup']);
  expect(warn).toHaveBeenCalledTimes(2); // the missing file, the init that threw
  expect(String(warn.mock.calls[1][0])).toContain('good');
  expect(hooks.on).toBe(on);
  expect(hooks.once).toBe(once);
});

test('a dice-only pick loaded as an add-on is not run again by the sandboxed loader', async () => {
  const { hooks } = fakeHooks();
  const loaders = files({ '/modules/soup/a.js': () => {} });
  await loadDsnAddons(['soup'], { hooks, modules: mods({ id: 'soup', scripts: new Set(['modules/soup/a.js']) }), route, ...loaders });
  const fetchText = vi.fn();
  const picks = [{ id: 'soup', title: 'Soup', scripts: ['modules/soup/a.js'] }];
  expect(await loadInstalledDice(picks, { api: {}, fetchText, isActive: () => false })).toEqual([]);
  expect(fetchText).not.toHaveBeenCalled();
});
