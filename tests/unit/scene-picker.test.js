import { formFromTheme, themeFromForm, scenesFor } from '../../src/ui/theme-form.js';
import { entryFromRule, rawRuleFromEntry, blankEntry } from '../../src/ui/trigger-form.js';
import { expandScenes, sceneOf } from '../../src/effects/library/scene-stubs.js';
import { normalizeRule } from '../../src/effects/rules.js';
import { normalizeTheme } from '../../src/themes/themes.js';

// A crit scene has its own picker beside the effect: stored inside the rule's effect
// ({id: effect, scene}) or as the effect itself when there is none ({id: scene}).
const bare = { id: 'user.u1.t', name: 'T', appearance: {}, perType: {}, rules: [] };
const nat20 = (t) => t.rules.find((r) => r.id === 'dicer.nat20');

describe('the theme editor', () => {
  it('offers the natural 20 scenes on the 20 row and the natural 1 scenes on the 1 row', () => {
    expect(scenesFor('critical-success')).toContain('scene-meteor');
    expect(scenesFor('critical-success')).not.toContain('scene-anvil');
    expect(scenesFor('critical-failure')).toContain('scene-anvil');
    expect(scenesFor('critical-success')).toHaveLength(10);
  });

  it('an effect and a scene: one rule with both; read back as the two pickers', () => {
    const t = themeFromForm({ nat20: { effect: 'sparkles', scene: 'scene-meteor', sound: '' } }, bare);
    expect(nat20(t).effect).toEqual({ id: 'sparkles', scene: 'scene-meteor' });
    expect(formFromTheme(t).nat20).toMatchObject({ effect: 'sparkles', scene: 'scene-meteor' });
    expect(normalizeTheme(t, 'user', () => {})).not.toBeNull(); // the theme stays valid
  });

  it('a scene alone is the effect; clearing the scene drops it, keeping the effect', () => {
    const only = themeFromForm({ nat20: { effect: '', scene: 'scene-portal-hop', sound: '' } }, bare);
    expect(nat20(only).effect).toEqual({ id: 'scene-portal-hop' });
    expect(formFromTheme(only).nat20).toMatchObject({ effect: '', scene: 'scene-portal-hop' });
    const both = themeFromForm({ nat20: { effect: 'glint', scene: 'scene-meteor', sound: '' } }, bare);
    const cleared = themeFromForm({ nat20: { effect: 'glint', scene: '', sound: '' } }, both);
    expect(nat20(cleared).effect).toEqual({ id: 'glint' });
    const none = themeFromForm({ nat20: { effect: '', scene: '', sound: '' } }, only);
    expect(nat20(none)).toBeUndefined(); // nothing left: no rule
  });
});

describe('the trigger editor', () => {
  it('reads a rule into Effect + Scene and writes it back the same way', () => {
    for (const effect of [{ id: 'sparkles', scene: 'scene-anvil', color: '#ff0000' }, { id: 'scene-anvil' }]) {
      const rule = normalizeRule({ id: 'r', outcome: 'critical-failure', effect }, 'user', () => {});
      const e = entryFromRule(rule);
      expect(e.sceneId).toBe('scene-anvil');
      expect(e.effectId).toBe(effect.id === 'scene-anvil' ? '' : 'sparkles');
      expect(rawRuleFromEntry(e).effect).toEqual(effect);
    }
    const e = { ...blankEntry('n'), outcome: 'critical-success', sceneId: 'scene-fireworks' };
    expect(rawRuleFromEntry(e).effect).toEqual({ id: 'scene-fireworks' });
  });
});

describe('playing a rule with both', () => {
  it('sceneOf finds the scene either way; expandScenes plays it beside the effect, once per die', () => {
    expect(sceneOf({ effect: { id: 'scene-meteor' } })).toBe('scene-meteor');
    expect(sceneOf({ effect: { id: 'sparkles', scene: 'scene-meteor' } })).toBe('scene-meteor');
    expect(sceneOf({ effect: { id: 'sparkles' } })).toBeNull();
    const plain = [{ ruleId: 'a', effect: { id: 'glint' } }];
    expect(expandScenes(plain)).toBe(plain);
    const list = [
      { ruleId: 'a', effect: { id: 'sparkles', scene: 'scene-meteor' }, value: 20, type: 'd20' },
      { ruleId: 'b', effect: { id: 'glint', scene: 'scene-fireworks' } },
    ];
    const out = expandScenes(list);
    expect(out.map((f) => f.effect.id)).toEqual(['sparkles', 'scene-meteor', 'glint']); // the first rule's scene only
    // a rule whose effect is a scene already: no second scene
    expect(expandScenes([{ effect: { id: 'scene-anvil' } }, { effect: { id: 'glint', scene: 'scene-crows' } }]).map((f) => f.effect.id)).toEqual(['scene-anvil', 'glint']);
  });
});
