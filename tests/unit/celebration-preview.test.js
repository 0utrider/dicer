import { describe, it, expect } from 'vitest';
import { celebrationPreview, themeFromForm } from '../../src/ui/theme-form.js';
import { BUILTIN_THEMES } from '../../src/themes/themes.js';

const base = BUILTIN_THEMES.find((t) => t.rules?.some((r) => r.id === 'dicer.nat20')) ?? BUILTIN_THEMES[0];
const d20Look = { body: { type: 'gem' } };
const theme = (extras) => ({
  ...themeFromForm({ base: '', ...extras }, base),
  appearance: { body: { type: 'solid' } },
  perType: { d20: d20Look },
});

describe('celebrationPreview', () => {
  it('impact: a plain d20 in the d20 look with the chosen impact sound, no fx', () => {
    const { fx, options } = celebrationPreview(theme({ soundMaterial: 'metal' }), 'impact');
    expect(fx).toBeNull();
    expect(options).toEqual({ type: 'd20', appearance: d20Look, soundMaterial: 'metal' });
  });

  it('nat 20: lands a 20 with the chosen effect and sound', () => {
    const { fx, options } = celebrationPreview(
      theme({ soundMaterial: 'glass', nat20: { effect: 'shockwave', sound: 'fanfare' } }),
      'nat20',
    );
    expect(fx).toMatchObject({
      ruleId: 'dicer.nat20',
      effect: { id: 'shockwave' },
      sound: { builtin: 'fanfare' },
      macro: null,
      slowMotion: false,
      value: 20,
      type: 'd20',
    });
    expect(options).toEqual({ type: 'd20', value: 20, appearance: d20Look, soundMaterial: 'glass' });
  });

  it('nat 1: lands a 1; "keep" uses the theme rule as saved', () => {
    const old = base.rules.find((r) => r.id === 'dicer.nat1');
    const { fx, options } = celebrationPreview(theme({ nat1: { effect: 'keep', sound: 'keep' } }), 'nat1');
    expect(options.value).toBe(1);
    if (old) expect(fx).toMatchObject({ ruleId: 'dicer.nat1', effect: old.effect ?? null, sound: old.sound ?? null, value: 1 });
  });

  it('none / none still throws the die, without fx; no sound material leaves it out', () => {
    const { fx, options } = celebrationPreview(theme({ soundMaterial: '', nat20: { effect: '', sound: '' } }), 'nat20');
    expect(fx).toBeNull();
    expect(options).toEqual({ type: 'd20', value: 20, appearance: d20Look });
  });

  it('falls back to the default look without a d20 look', () => {
    const t = { ...theme({}), perType: {} };
    expect(celebrationPreview(t, 'impact').options.appearance).toEqual({ body: { type: 'solid' } });
  });
});
