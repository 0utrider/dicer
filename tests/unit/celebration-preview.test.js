import { describe, it, expect } from 'vitest';
import { celebrationPreview, formFromTheme, themeFromForm } from '../../src/ui/theme-form.js';
import { BUILTIN_THEMES } from '../../src/themes/themes.js';

const base = BUILTIN_THEMES.find((t) => t.rules?.some((r) => r.id === 'dicer.nat20')) ?? BUILTIN_THEMES[0];
const d20Look = { body: { type: 'gem' } };
const theme = (extras) => ({
  ...themeFromForm({ base: '', ...extras }, base),
  appearance: { body: { type: 'solid' } },
  perType: { d20: d20Look },
});

describe('custom sound file and JB2A animation in the simple form', () => {
  const bare = { id: 't', name: 'T', appearance: {}, perType: {}, rules: [] };
  const rule = (t, id) => t.rules.find((r) => r.id === id);

  it('a sound file and a JB2A file become the rule; reading it back gives the same form values', () => {
    const t = themeFromForm(
      { nat20: { effect: 'shockwave', sound: 'file', soundSrc: 'sounds/yay.ogg', jb2a: 'modules/jb2a_patreon/Library/Generic/Impact/A.webm' } },
      bare,
    );
    expect(rule(t, 'dicer.nat20')).toMatchObject({
      effect: { id: 'shockwave', jb2a: 'modules/jb2a_patreon/Library/Generic/Impact/A.webm' },
      sound: { src: 'sounds/yay.ogg' },
    });
    expect(formFromTheme(t).nat20).toEqual({
      effect: 'shockwave',
      scene: '',
      sceneLine1: '',
      sceneLine2: '',
      sound: 'file',
      soundSrc: 'sounds/yay.ogg',
      jb2a: 'modules/jb2a_patreon/Library/Generic/Impact/A.webm',
    });
  });

  it('a JB2A file with no effect stands on light burst; clearing it drops the field but keeps the effect', () => {
    const t = themeFromForm({ nat1: { effect: '', sound: '', jb2a: 'x/B.webm' } }, bare);
    expect(rule(t, 'dicer.nat1').effect).toEqual({ id: 'light-burst', jb2a: 'x/B.webm' });
    const cleared = themeFromForm({ nat1: { ...formFromTheme(t).nat1, jb2a: '' } }, t);
    expect(rule(cleared, 'dicer.nat1').effect).toEqual({ id: 'light-burst' });
  });

  it('switching a file sound back to a built-in one, or "file" with no path, drops the file', () => {
    const t = themeFromForm({ nat20: { effect: '', sound: 'file', soundSrc: 'a.ogg' } }, bare);
    expect(rule(themeFromForm({ nat20: { effect: '', sound: 'chime', soundSrc: 'a.ogg' } }, t), 'dicer.nat20').sound).toEqual({ builtin: 'chime' });
    expect(rule(themeFromForm({ nat20: { effect: '', sound: 'file', soundSrc: ' ' } }, t), 'dicer.nat20')).toBeUndefined();
  });

  it('keeps an existing file sound volume when the path is unchanged', () => {
    const t = { ...bare, rules: [{ id: 'dicer.nat20', name: 'N', die: 'd20', result: { kind: 'value', value: 20 }, sound: { src: 'a.ogg', volume: 0.4 } }] };
    expect(rule(themeFromForm({ nat20: formFromTheme(t).nat20 }, t), 'dicer.nat20').sound).toEqual({ src: 'a.ogg', volume: 0.4 });
  });
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
