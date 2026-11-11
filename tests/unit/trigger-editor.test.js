// @vitest-environment jsdom
import { DEFAULT_RULES, normalizeRule } from '../../src/effects/rules.js';

let mod;
beforeAll(async () => {
  class FakeApp {
    constructor(options = {}) {
      this.options = options;
    }
    static DEFAULT_OPTIONS = {};
  }
  vi.stubGlobal('foundry', {
    applications: {
      api: { ApplicationV2: FakeApp, HandlebarsApplicationMixin: (Base) => class extends Base {} },
    },
    utils: { randomID: () => 'abcd1234' },
  });
  mod = await import('../../src/ui/trigger-editor.js');
});
afterAll(() => vi.unstubAllGlobals());

const warn = () => {};
const modRule = (id, extra = {}) =>
  normalizeRule(
    {
      id,
      name: id,
      die: 'd20',
      result: { kind: 'value', value: 20 },
      effect: { id: 'dsn:Fx', color: '#ff0000' },
      ...extra,
    },
    'module',
    warn,
  );

describe('rulesFromForm / formFromRules', () => {
  it('round-trips the default rules', () => {
    const form = mod.formFromRules(DEFAULT_RULES);
    expect(mod.rulesFromForm(form, { source: 'world' })).toEqual(DEFAULT_RULES);
  });

  it('round-trips every field, including effect extras, a file sound and a label result', () => {
    const rules = [
      normalizeRule(
        {
          id: 'u1',
          name: 'Mine',
          enabled: false,
          die: 'mytrig',
          result: { kind: 'label', label: 'Hope' },
          context: { formula: '/1d20/i', role: 'attack', damageType: 'fire', actorId: 'A', userId: 'U' },
          outcome: 'critical-success',
          effect: { id: 'sparkles', color: '#112233', intensity: 1.5, duration: 900, slowMotion: true },
          sound: { src: 'sounds/x.ogg', volume: 0.4 },
          macro: 'Macro.abc',
        },
        'user',
        warn,
      ),
      normalizeRule(
        { id: 'u2', die: 'd6', result: { kind: 'range', from: 2, to: 5 }, sound: { builtin: 'zap' } },
        'user',
        warn,
      ),
      normalizeRule({ id: 'u3', result: { kind: 'max' }, effect: { id: 'shake' } }, 'user', warn),
    ];
    expect(mod.rulesFromForm(mod.formFromRules(rules), { source: 'user' })).toEqual(rules);
  });

  it('accepts string numbers and an index-keyed object, as a submitted form gives', () => {
    const base = mod.formFromRules(DEFAULT_RULES).rules;
    const form = { rules: { 1: { ...base[1] }, 0: { ...base[0], resultValue: '20' } } };
    expect(mod.rulesFromForm(form, { source: 'world' })).toEqual(DEFAULT_RULES);
  });

  it('reports an invalid regex and does not return the rule', () => {
    const form = mod.formFromRules(DEFAULT_RULES);
    form.rules[1].formula = '/(/';
    const { rules, errors } = mod.validateForm(form, { source: 'world' });
    expect(rules.map((r) => r.id)).toEqual(['dicer.nat20']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ index: 1, id: 'dicer.nat1' });
    expect(errors[0].message).toMatch(/regex/);
    expect(mod.rulesFromForm(form, { source: 'world' })).toHaveLength(1);
  });

  it('reports a rule with no effect, sound or macro, and a missing result value', () => {
    const form = mod.formFromRules(DEFAULT_RULES);
    form.rules[0].effectId = '';
    form.rules[0].soundKind = 'none';
    form.rules[1].resultValue = '';
    const { rules, errors } = mod.validateForm(form, { source: 'world' });
    expect(rules).toEqual([]);
    expect(errors.map((e) => e.index)).toEqual([0, 1]);
  });

  it('module entries keep source module and only enabled changes', () => {
    const moduleRules = [modRule('dsn:a'), modRule('dsn:b')];
    const form = mod.formFromRules([...DEFAULT_RULES, ...moduleRules]);
    form.rules[2].enabled = false;
    form.rules[3].name = 'hacked';
    form.rules[3].effectId = 'shake';
    const out = mod.rulesFromForm(form, { source: 'world', moduleRules });
    expect(out.slice(0, 2)).toEqual(DEFAULT_RULES);
    expect(out[2]).toEqual({ ...moduleRules[0], enabled: false });
    expect(out[3]).toEqual(moduleRules[1]);
    expect(out[2].source).toBe('module');
  });
});

describe('saveTab', () => {
  const deps = (over = {}) => ({
    isGM: true,
    moduleRules: [],
    setWorld: vi.fn(async () => {}),
    setDisabled: vi.fn(async () => {}),
    setMine: vi.fn(async () => {}),
    ...over,
  });

  it('refuses the World tab for a player', async () => {
    const d = deps({ isGM: false });
    const res = await mod.saveTab('world', mod.formFromRules(DEFAULT_RULES), d);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('not-gm');
    expect(d.setWorld).not.toHaveBeenCalled();
    expect(d.setDisabled).not.toHaveBeenCalled();
  });

  it('lets a player save Mine', async () => {
    const d = deps({ isGM: false });
    const form = mod.formFromRules([normalizeRule({ id: 'm', effect: { id: 'shake' } }, 'user', warn)]);
    const res = await mod.saveTab('mine', form, d);
    expect(res.ok).toBe(true);
    expect(d.setMine).toHaveBeenCalledWith([expect.objectContaining({ id: 'm', source: 'user' })]);
  });

  it('saves normalized plain world rules and the disabled module ids', async () => {
    const moduleRules = [modRule('dsn:a'), modRule('dsn:b')];
    const form = mod.formFromRules([...DEFAULT_RULES, ...moduleRules]);
    form.rules[3].enabled = false;
    const d = deps({ moduleRules });
    const res = await mod.saveTab('world', form, d);
    expect(res.ok).toBe(true);
    expect(d.setWorld).toHaveBeenCalledWith(DEFAULT_RULES);
    expect(d.setDisabled).toHaveBeenCalledWith(['dsn:b']);
  });

  it('saves nothing and returns the errors when a rule is invalid', async () => {
    const form = mod.formFromRules(DEFAULT_RULES);
    form.rules[0].formula = '/(/';
    const d = deps();
    const res = await mod.saveTab('world', form, d);
    expect(res.ok).toBe(false);
    expect(res.errors).toHaveLength(1);
    expect(d.setWorld).not.toHaveBeenCalled();
  });
});

describe('TriggerEditor', () => {
  it('is the dicer-trigger-editor application', () => {
    expect(mod.TriggerEditor.DEFAULT_OPTIONS.id).toBe('dicer-trigger-editor');
  });
});

describe('stored rules that cannot be read are kept', () => {
  it('loadEntries turns them into raw entries and counts them', () => {
    const bad = { id: 'old', effect: { id: 'x' }, result: { kind: 'bogus' } };
    const { entries, unreadable } = mod.loadEntries([DEFAULT_RULES[0], bad, 'junk'], 'world');
    expect(unreadable).toBe(2);
    expect(entries.map((e) => e.source)).toEqual(['world', 'raw', 'raw']);
    expect(entries[1].id).toBe('old');
  });

  it('a save writes them back untouched next to the valid rules', async () => {
    const bad = { id: 'old', effect: { id: 'x' }, result: { kind: 'bogus' } };
    const { entries } = mod.loadEntries([DEFAULT_RULES[0], bad], 'world');
    const setMine = vi.fn(async () => {});
    const setWorld = vi.fn(async () => {});
    await mod.saveTab('world', { rules: entries }, { isGM: true, setWorld, setDisabled: async () => {}, setMine });
    expect(setWorld).toHaveBeenCalledWith([DEFAULT_RULES[0], bad]);
    await mod.saveTab('mine', { rules: mod.loadEntries([bad], 'user').entries }, { isGM: false, setWorld, setDisabled: async () => {}, setMine });
    expect(setMine).toHaveBeenCalledWith([bad]);
  });

  it('deleting the raw entry drops it', async () => {
    const { entries } = mod.loadEntries([{ id: 'old', result: { kind: 'bogus' } }], 'user');
    const setMine = vi.fn(async () => {});
    await mod.saveTab('mine', { rules: [] }, { isGM: true, setWorld: vi.fn(), setDisabled: vi.fn(), setMine });
    expect(entries).toHaveLength(1);
    expect(setMine).toHaveBeenCalledWith([]);
  });
});

describe('lang/en.json', () => {
  it('has no duplicate keys and resolves every DICER.Triggers key the editor and template use', async () => {
    const { readFileSync } = await import('node:fs');
    const { duplicateKeys, usedKeys, resolve } = await import('./lang-check.js');
    expect(duplicateKeys()).toEqual([]);
    const lang = JSON.parse(readFileSync('lang/en.json', 'utf8')).DICER.Triggers;
    const keys = usedKeys('Triggers', ['src/ui/trigger-editor.js', 'templates/trigger-editor.hbs'], {
      'ResultKinds.': ['any', 'value', 'range', 'max', 'min', 'label'],
      'Outcomes.': ['any', 'critical-success', 'success', 'failure', 'critical-failure'],
      'Sound.': ['none', 'builtin', 'file'],
    });
    expect(keys.length).toBeGreaterThan(30);
    for (const k of keys) expect(typeof resolve(lang, k), `DICER.Triggers.${k}`).toBe('string');
  });
});
