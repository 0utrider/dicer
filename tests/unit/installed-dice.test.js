/**
 * Dice from installed modules that are not active (src/compat/installed-dice.js): which modules
 * are offered, and running only their Dice So Nice hooks.
 */
import { afterEach, expect, test, vi } from 'vitest';
import {
  scriptsOf,
  classify,
  scanInstalled,
  runDice,
  loadInstalledDice,
  isLoaded,
  resetLoaded,
} from '../../src/compat/installed-dice.js';

afterEach(() => resetLoaded());

const DICE_SET = `Hooks.once('diceSoNiceReady', (dice3d) => {
  dice3d.addSystem({ id: "marble", name: "Marble" }, false);
  dice3d.addDicePreset({ type: "d20", labels: "", modelFile: "modules/marble/d20.gltf", system: "marble" });
});`;

test('a module whose scripts only add dice is offered; more work, ES modules and no dice are not', () => {
  expect(classify([DICE_SET])).toBe('ok');
  expect(classify(['console.log(1)'])).toBe('none');
  expect(classify([`${DICE_SET}\nHooks.on('renderChatMessage', () => {});`])).toBe('other');
  expect(classify([`${DICE_SET}\ngame.settings.register('marble', 'x', {});`])).toBe('other');
  expect(classify([`${DICE_SET}\nCONFIG.Dice.terms.x = 1;`])).toBe('other');
  expect(classify([`${DICE_SET}\nwindow.marble = 1;`])).toBe('other');
  expect(classify([`import x from './x.js';\n${DICE_SET}`])).toBe('bundle');
  expect(classify([`${DICE_SET}\nif (CONFIG.x === 1) {}`])).toBe('ok'); // reading CONFIG is fine
});

test("only the module's own script files are fetched", () => {
  const mod = {
    id: 'marble',
    scripts: new Set(['modules/marble/diceset.js', 'https://evil.example/x.js', 'modules/other/x.js', 'modules/marble/../x.js']),
    esmodules: new Set(['/modules/marble/esm.mjs']),
  };
  expect(scriptsOf(mod)).toEqual(['modules/marble/esm.mjs', 'modules/marble/diceset.js']);
});

test('the scan offers inactive modules that may hold dice, with what each one is', async () => {
  const files = {
    'modules/marble/diceset.js': DICE_SET,
    'modules/adventure/index.js': `${DICE_SET}\nHooks.once('ready', () => {});`,
    'modules/flavor/main.js': `Hooks.on('diceSoNiceReady', () => {});`, // patches, adds no dice
  };
  const dsn = { requires: new Set([{ id: 'dice-so-nice' }]) };
  const modules = new Map(
    [
      { id: 'marble', title: 'Marble Dice', active: false, scripts: new Set(['modules/marble/diceset.js']) },
      { id: 'adventure', title: 'An Adventure', active: false, relationships: dsn, esmodules: new Set(['modules/adventure/index.js']) },
      { id: 'flavor', title: 'Flavor', active: false, relationships: dsn, scripts: new Set(['modules/flavor/main.js']) },
      { id: 'on-dice', title: 'On Dice', active: true, scripts: new Set(['modules/on-dice/x.js']) },
      { id: 'maps', title: 'Maps', active: false, scripts: new Set(['modules/maps/x.js']) }, // never fetched
    ].map((m) => [m.id, m]),
  );
  const fetchText = vi.fn(async (p) => files[p] ?? '');
  const found = await scanInstalled({ modules, fetchText });
  expect(found).toEqual([
    { id: 'adventure', title: 'An Adventure', scripts: ['modules/adventure/index.js'], status: 'other' },
    { id: 'marble', title: 'Marble Dice', scripts: ['modules/marble/diceset.js'], status: 'ok' },
  ]);
  expect(fetchText).not.toHaveBeenCalledWith('modules/maps/x.js');
  expect(fetchText).not.toHaveBeenCalledWith('modules/on-dice/x.js');
});

test('running a dice set calls only its Dice So Nice hooks, init first, with the api', async () => {
  const calls = [];
  const api = { addSystem: (s) => calls.push(['system', s.id]), addDicePreset: (p) => calls.push(['preset', p.type]) };
  const text = `Hooks.once('diceSoNiceReady', (d) => d.addDicePreset({ type: 'd6' }));
Hooks.once('diceSoNiceInit', (d) => d.addSystem({ id: 'x', name: 'X' }));
Hooks.once('ready', () => { throw new Error('never runs'); });`;
  expect(await runDice([text], api)).toBe(2);
  expect(calls).toEqual([
    ['system', 'x'],
    ['preset', 'd6'],
  ]);
});

test('loading the picks runs each once, skips active modules and ones that changed, and warns on errors', async () => {
  const api = { addSystem: vi.fn(), addDicePreset: vi.fn() };
  const files = {
    'modules/marble/diceset.js': DICE_SET,
    'modules/grown/x.js': `${DICE_SET}\nHooks.on('ready', () => {});`,
    'modules/broken/x.js': `Hooks.once('diceSoNiceReady', (d) => { d.addSystem({ id: 'b', name: 'B' }); throw new Error('boom'); });`,
    'modules/live/x.js': DICE_SET,
  };
  const warn = vi.fn();
  const list = [
    { id: 'marble', title: 'Marble', scripts: ['modules/marble/diceset.js'] },
    { id: 'grown', title: 'Grown', scripts: ['modules/grown/x.js'] },
    { id: 'broken', title: 'Broken', scripts: ['modules/broken/x.js'] },
    { id: 'live', title: 'Live', scripts: ['modules/live/x.js'] },
    { id: 'sneaky', title: 'Sneaky', scripts: ['modules/marble/diceset.js'] }, // not its own files
  ];
  const deps = { api, fetchText: async (p) => files[p], isActive: (id) => id === 'live', warn };
  expect(await loadInstalledDice(list, deps)).toEqual(['marble']);
  expect(api.addSystem).toHaveBeenCalledTimes(2); // marble's and broken's (before it threw)
  expect(api.addDicePreset).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledTimes(2); // grown (does more now), broken (threw)
  expect(isLoaded('marble')).toBe(true);
  expect(await loadInstalledDice(list, deps)).toEqual([]); // once per page
  expect(api.addSystem).toHaveBeenCalledTimes(2);
});
