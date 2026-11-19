/**
 * What Dice So Nice add-ons need beyond Dicer's own stand-in, for add-ons the GM runs in full
 * (src/compat/installed-dice.js): Dice So Nice reads as active inside the add-on's own listeners
 * (withDsnActive), game.dice3d gets DSN's shader clock, presets reach a DiceSystem instance's own
 * dice map, and an instance's program key never replaces Dicer's (shimDsn). Shaped after
 * irl-dice-packs, which checks game.modules.get('dice-so-nice').active in its diceSoNiceReady
 * listener, imports Dice So Nice's own api.js and binds dice3d.uniforms.time in its shaders.
 */
import { afterEach, expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { baseColourFirst, dsnAppearance, faceUvs, loadDsnAddons, resetLoaded, scanInstalled, shimDsn, withDsnActive } from '../../src/compat/installed-dice.js';
import { createRegistry } from '../../src/compat/registry.js';

afterEach(() => resetLoaded());

const dsnModule = () => ({ id: 'dice-so-nice', active: false, version: '6.4.5' });

/** A game.modules stand-in: a Map whose `get` lives on the prototype, as Foundry's Collection's does. */
const modulesWith = (...list) => new Map(list.map((m) => [m.id, m]));

test('withDsnActive: an installed, inactive Dice So Nice reads as active only while fn runs', () => {
  const real = dsnModule();
  const modules = modulesWith(real, { id: 'other', active: false });
  const seen = withDsnActive(modules, () => {
    const m = modules.get('dice-so-nice');
    return { active: m.active, version: m.version, other: modules.get('other').active };
  });
  expect(seen).toEqual({ active: true, version: '6.4.5', other: false });
  expect(modules.get('dice-so-nice')).toBe(real);
  expect(real.active).toBe(false);
  expect(Object.hasOwn(modules, 'get')).toBe(false); // the prototype's get again
});

test('withDsnActive: nothing changes when Dice So Nice is missing or already active, and a throw still restores', () => {
  const none = modulesWith();
  expect(withDsnActive(none, () => none.get('dice-so-nice'))).toBeUndefined();
  const on = { ...dsnModule(), active: true };
  const live = modulesWith(on);
  expect(withDsnActive(live, () => live.get('dice-so-nice'))).toBe(on);
  const modules = modulesWith(dsnModule());
  expect(() =>
    withDsnActive(modules, () => {
      expect(withDsnActive(modules, () => modules.get('dice-so-nice').active)).toBe(true); // nested
      throw new Error('boom');
    }),
  ).toThrow('boom');
  expect(modules.get('dice-so-nice').active).toBe(false);
  expect(withDsnActive(undefined, () => 7)).toBe(7);
});

/** A Hooks stand-in that records live registrations and can fire them. */
function fakeHooks() {
  const events = {};
  return {
    events,
    on(hook, fn) {
      (events[hook] ??= []).push(fn);
      return events[hook].length;
    },
    once(hook, fn) {
      return this.on(hook, fn);
    },
    callAll(hook, ...args) {
      for (const fn of events[hook] ?? []) fn(...args);
    },
  };
}

test("an add-on's Dice So Nice and start-hook listeners see Dice So Nice as active; other code does not", async () => {
  const hooks = fakeHooks();
  const modules = modulesWith(dsnModule(), { id: 'irl', active: false, scripts: new Set(), esmodules: new Set(['modules/irl/scripts/module.js']) });
  const seen = [];
  const dsnActive = () => modules.get('dice-so-nice')?.active === true;
  const esmodule = vi.fn(async () => {
    // irl-dice-packs: `if (!game.modules.get('dice-so-nice')?.active || !dice3d) return false`
    hooks.once('diceSoNiceReady', (dice3d) => seen.push(['ready', dsnActive(), dice3d]));
    hooks.once('init', () => seen.push(['init', dsnActive()]));
  });
  hooks.on('diceSoNiceReady', () => seen.push(['someone else', dsnActive()])); // not the add-on's
  const dice3d = { uniforms: {} };
  expect(await loadDsnAddons(['irl'], { hooks, modules, route: (p) => `/${p}`, esmodule, dice3d })).toEqual(['irl']);
  expect(seen).toEqual([['init', true]]);
  hooks.callAll('diceSoNiceReady', dice3d);
  expect(seen.slice(1)).toEqual([
    ['someone else', false],
    ['ready', true, dice3d],
  ]);
  expect(dsnActive()).toBe(false);
});

test('the loader shims game.dice3d once an add-on loaded, and leaves it alone when none did', async () => {
  const hooks = fakeHooks();
  const untouched = { uniforms: { moonPhase: 0 } };
  await loadDsnAddons(['gone'], { hooks, modules: modulesWith(), dice3d: untouched });
  expect(untouched.uniforms).toEqual({ moonPhase: 0 });
  const dice3d = { uniforms: { moonPhase: 0 } };
  const modules = modulesWith({ id: 'irl', active: false, scripts: new Set(['modules/irl/a.js']), esmodules: new Set() });
  await loadDsnAddons(['irl'], { hooks, modules, route: (p) => p, script: async () => {}, dice3d });
  expect(typeof dice3d.uniforms.time.value).toBe('number');
});

test("shimDsn: uniforms.time is Dice So Nice's clock (seconds), ignores writes and keeps an existing one", () => {
  const dice3d = { uniforms: { moonPhase: 0 } };
  shimDsn(dice3d);
  const { time } = dice3d.uniforms;
  expect(Math.abs(time.value - performance.now() / 1000)).toBeLessThan(1);
  time.value = -5; // Dice So Nice writes it each frame; a write must not throw or stick
  expect(time.value).toBeGreaterThan(0);
  expect(dice3d.uniforms.moonPhase).toBe(0);
  const own = { value: 3 };
  const other = { uniforms: { time: own } };
  shimDsn(other);
  expect(other.uniforms.time).toBe(own);
  const bare = {};
  shimDsn(bare);
  expect(typeof bare.uniforms.time.value).toBe('number');
  expect(() => shimDsn(null)).not.toThrow();
});

/** Dice So Nice's DiceSystem as irl-dice-packs gets it (from DSN's own api.js): callbacks only for die types it holds. */
class DsnSystem {
  constructor(id, name) {
    this.id = id;
    this.name = name;
    this.dice = new Map();
    this.callbacks = [];
  }
  registerProcessMaterialCallback(fn) {
    this.callbacks.push(fn);
  }
  getCacheString(appearance) {
    return this.id + JSON.stringify(Object.values(appearance));
  }
  processMaterial(type, material, appearance) {
    if (this.dice.has(type)) for (const fn of this.callbacks) fn(type, material, appearance);
    return material;
  }
  registerBeforeShaderCompileCallback(fn) {
    (this.shaderCallbacks ??= []).push(fn);
  }
  beforeShaderCompile(shader, material, type, appearance) {
    for (const fn of this.shaderCallbacks ?? []) fn(shader, material, type, appearance);
  }
}

function dicerStandIn() {
  const registry = createRegistry({ warn: () => {} });
  return {
    registry,
    dice3d: {
      uniforms: { moonPhase: 0 },
      addSystem: (s, m) => registry.addSystem(s, m),
      addDicePreset: (p, s) => registry.addDicePreset(p, s),
      get DiceFactory() {
        return registry.diceFactory;
      },
    },
  };
}

const labels = (n) => Array.from({ length: n }, (_, i) => String(i + 1));

test("shimDsn: a preset for a DiceSystem instance's system also lands in the instance's dice, so its material callbacks run", async () => {
  const { registry, dice3d } = dicerStandIn();
  shimDsn(dice3d);
  const system = new DsnSystem('cliff-relic', 'Pathfinder — Relic');
  const ran = [];
  system.registerProcessMaterialCallback((type) => ran.push(type));
  dice3d.addSystem(system);
  const preset = { type: 'd20', labels: labels(20), system: 'cliff-relic' };
  await dice3d.addDicePreset(preset);
  expect(registry.systems.get('cliff-relic').dice.get('d20').labels).toHaveLength(20); // Dicer has it
  expect(system.dice.get('d20')).toEqual(preset); // a copy: the caller's object is left as it was
  expect(system.dice.get('d20')).not.toBe(preset);
  // what DiceBox does with a die of this system
  const material = { customProgramCacheKey: () => 'dicer-k' };
  registry.diceFactory.systems.get('cliff-relic').instance.processMaterial('d20', material, {});
  expect(ran).toEqual(['d20']);
});

test('shimDsn: a type the instance already holds is kept, and presets of plain systems or the standard set are untouched', async () => {
  const { registry, dice3d } = dicerStandIn();
  shimDsn(dice3d);
  const system = new DsnSystem('irl', 'IRL');
  const own = { type: 'd6', labels: labels(6), mine: true };
  system.dice.set('d6', own);
  dice3d.addSystem(system);
  await dice3d.addDicePreset({ type: 'd6', labels: labels(6), system: 'irl' });
  expect(system.dice.get('d6')).toBe(own);
  dice3d.addSystem({ id: 'plain', name: 'Plain' });
  await dice3d.addDicePreset({ type: 'd8', labels: labels(8), system: 'plain' });
  await dice3d.addDicePreset({ type: 'd4', labels: labels(4) });
  expect(registry.systems.get('plain').dice.has('d8')).toBe(true);
  const frozen = new DsnSystem('frozen', 'Frozen');
  frozen.dice.set = () => {
    throw new Error('no');
  };
  dice3d.addSystem(frozen);
  await expect(dice3d.addDicePreset({ type: 'd4', labels: labels(4), system: 'frozen' })).resolves.toBeUndefined();
});

test("shimDsn: an instance's processMaterial that replaces the program key keeps Dicer's key in front", () => {
  const { registry, dice3d } = dicerStandIn();
  shimDsn(dice3d);
  shimDsn(dice3d); // once per stand-in
  const system = new DsnSystem('cliff-reactor', 'Reactor');
  system.dice.set('d20', {});
  // irl-dice-packs' finishCliffMaterial: material.customProgramCacheKey = () => 'irl-cliff-v2'
  system.registerProcessMaterialCallback((_t, m) => {
    m.customProgramCacheKey = () => 'irl-cliff-v2';
  });
  dice3d.addSystem(system);
  const instance = registry.diceFactory.systems.get('cliff-reactor').instance;
  const a = { customProgramCacheKey: () => 'sys:cliff-reactor|dicer-resin' };
  const b = { customProgramCacheKey: () => 'sys:cliff-reactor|dicer-plain' };
  expect(instance.processMaterial('d20', a, {})).toBe(a);
  instance.processMaterial('d20', b, {});
  expect(a.customProgramCacheKey()).toBe('sys:cliff-reactor|dicer-resin|irl-cliff-v2');
  expect(b.customProgramCacheKey()).toBe('sys:cliff-reactor|dicer-plain|irl-cliff-v2');
  // a callback that leaves the key alone keeps it as it was
  const quiet = new DsnSystem('quiet', 'Quiet');
  dice3d.addSystem(quiet);
  const key = () => 'dicer-x';
  const c = { customProgramCacheKey: key };
  registry.diceFactory.systems.get('quiet').instance.processMaterial('d20', c, {});
  expect(c.customProgramCacheKey).toBe(key);
});

test('the scan offers a Dice So Nice add-on whose ES entry only names the hooks and imports the files that add its dice', async () => {
  // irl-dice-packs' scripts/module.js: imports ./registration.js etc. and listens for diceSoNiceReady
  const entry = `import { registerPacks } from './registration.js';
import { THEMES } from "../scripts/systems.js";
Hooks.once('diceSoNiceReady', dice3d => { void initialize(dice3d); });`;
  const files = {
    'modules/irl-dice-packs/scripts/module.js': entry,
    'modules/loose/module.js': entry,
    'modules/notes/main.js': `import { x } from './x.js';\nHooks.once('ready', () => x());`, // no Dice So Nice hook
    'modules/lib/main.js': `import { x } from 'https://cdn.example/x.js';\nHooks.on('diceSoNiceReady', x);`, // imports no own file
  };
  const dsn = { requires: new Set([{ id: 'dice-so-nice' }]) };
  const modules = modulesWith(
    { id: 'irl-dice-packs', title: 'IRL Dice packs', active: false, relationships: dsn, esmodules: new Set(['scripts/module.js'].map((p) => `modules/irl-dice-packs/${p}`)) },
    { id: 'notes', title: 'Dice notes', active: false, relationships: dsn, esmodules: new Set(['modules/notes/main.js']) },
    { id: 'lib', title: 'Dice lib', active: false, relationships: dsn, esmodules: new Set(['modules/lib/main.js']) },
    // without Dice So Nice as a requirement it is not an add-on Dicer can run
    { id: 'loose', title: 'Loose dice', active: false, esmodules: new Set(['modules/loose/module.js']) },
  );
  const found = await scanInstalled({ modules, fetchText: async (p) => files[p] ?? '' });
  expect(found).toEqual([
    { id: 'irl-dice-packs', title: 'IRL Dice packs', scripts: ['modules/irl-dice-packs/scripts/module.js'], status: 'bundle', addon: true },
  ]);
});

test('dsnAppearance: a Dicer look reads as a Dice So Nice appearance (colours, material, settings); a DSN one is kept', () => {
  const look = { body: { type: 'marble', color: '#3b0d19', color2: '#140405' }, numbers: { fill: 'paint', color: '#e8dfca', font: 'serif' }, edges: { radius: 0.5, strip: { style: 'body', color: '#aaaaaa', strength: 1 } } };
  expect(dsnAppearance(look)).toMatchObject({ body: look.body, background: '#3b0d19', foreground: '#e8dfca', outline: '#3b0d19', edge: '#140405', material: 'stone', systemSettings: {} });
  expect(dsnAppearance({ ...look, edges: { strip: { style: 'metal', color: '#a9a6a0' } } }).edge).toBe('#a9a6a0');
  const dsn = { background: '#000000', foreground: '#ffffff' };
  expect(dsnAppearance(dsn)).toBe(dsn);
  expect(dsnAppearance(undefined)).toMatchObject({ background: '#000000', foreground: '#ffffff', systemSettings: {} });
});

test('baseColourFirst: Dicer\'s colour pass moves before map_fragment, where add-ons recolour the die; nothing else changes', () => {
  const fs = 'void main() {\n\tvec4 diffuseColor = vec4( diffuse, opacity );\n\t#include <map_fragment>\n\t#include <color_fragment>\nDICER_BODY;\nDICER_NUMBERS;\n\t#include <alphamap_fragment>\n}';
  const out = baseColourFirst(fs);
  expect(out.indexOf('DICER_NUMBERS')).toBeLessThan(out.indexOf('#include <map_fragment>'));
  expect(out.indexOf('DICER_BODY')).toBeGreaterThan(out.indexOf('vec4 diffuseColor'));
  expect(out).toContain('#include <color_fragment>\n\t#include <alphamap_fragment>');
  expect(out.match(/DICER_BODY/g)).toHaveLength(1);
  const plain = 'void main() {\n\t#include <map_fragment>\n\t#include <color_fragment>\n\t#include <alphamap_fragment>\n}';
  expect(baseColourFirst(plain)).toBe(plain);
});

test('shimDsn: shader callbacks get the die type and the Dice So Nice appearance, as Dice So Nice calls them', () => {
  const { registry, dice3d } = dicerStandIn();
  shimDsn(dice3d);
  const system = new DsnSystem('irl-unbroken-vow', 'Vow');
  system.dice.set('d20', {});
  const seen = {};
  // irl-dice-packs' GM themes: (shader, material, type, appearance) => applyGmShader(... appearance.systemSettings ...)
  system.registerProcessMaterialCallback((type, _m, appearance) => (seen.process = { type, bg: appearance.background }));
  system.registerBeforeShaderCompileCallback((shader, _m, type, appearance) => {
    seen.shader = { type, bg: appearance.background, settings: appearance.systemSettings };
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\nGM;');
  });
  dice3d.addSystem(system);
  const instance = registry.diceFactory.systems.get('irl-unbroken-vow').instance;
  const material = { userData: {}, customProgramCacheKey: () => 'dicer-k' };
  const look = { body: { type: 'opaque', color: '#3b0d19' }, numbers: { color: '#e8dfca' } };
  instance.processMaterial('d20', material, look);
  // what DiceBox's chained hook does at compile time: only the shader and the material
  const shader = { fragmentShader: '\t#include <map_fragment>\n\t#include <color_fragment>\nDICER;\n\t#include <alphamap_fragment>' };
  instance.beforeShaderCompile(shader, material);
  expect(seen.process).toEqual({ type: 'd20', bg: '#3b0d19' });
  expect(seen.shader).toEqual({ type: 'd20', bg: '#3b0d19', settings: {} });
  expect(shader.fragmentShader.indexOf('DICER')).toBeLessThan(shader.fragmentShader.indexOf('GM;')); // their recolour wins
});

test('faceUvs: a uv-less die gets one tile per flat face (5 wide, 1/8 cells), as add-ons read Dice So Nice dice', () => {
  const g = new THREE.IcosahedronGeometry(1); // non-indexed, 20 flat faces
  expect(g.attributes.uv).toBeDefined(); // three's own has uvs: drop them, as Dicer's dice have none
  g.deleteAttribute('uv');
  faceUvs(g);
  const uv = g.attributes.uv;
  const tiles = new Set();
  for (let i = 0; i < uv.count; i += 3) {
    const t = Math.floor(uv.getX(i) * 8) + Math.floor(uv.getY(i) * 8) * 5;
    expect(Math.floor(uv.getX(i + 1) * 8) + Math.floor(uv.getY(i + 1) * 8) * 5).toBe(t); // one tile per triangle
    tiles.add(t);
  }
  expect([...tiles].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i)); // tile 15 exists
  const kept = g.attributes.uv;
  faceUvs(g); // already has one: left alone
  expect(g.attributes.uv).toBe(kept);
  expect(() => faceUvs(null)).not.toThrow();
});

test('shimDsn: an add-on per-frame hook on its material sees texture coordinates on the die geometry', () => {
  const { registry, dice3d } = dicerStandIn();
  shimDsn(dice3d);
  const system = new DsnSystem('irl-unbroken-vow-2', 'Vow');
  system.dice.set('d20', {});
  let read = null;
  // irl-dice-packs' finishGmMaterial: onBeforeRender -> attachGmIdle -> geometry.attributes.uv.getX(...)
  system.registerProcessMaterialCallback((_t, m) => {
    m.onBeforeRender = (_r, _s, _c, geometry) => (read = geometry.attributes.uv.getX(0));
  });
  dice3d.addSystem(system);
  const material = { userData: {}, customProgramCacheKey: () => 'k' };
  registry.diceFactory.systems.get('irl-unbroken-vow-2').instance.processMaterial('d20', material, {});
  const g = new THREE.IcosahedronGeometry(1);
  g.deleteAttribute('uv');
  material.onBeforeRender({}, {}, {}, g, {}, null);
  expect(read).toBeGreaterThan(0);
});
