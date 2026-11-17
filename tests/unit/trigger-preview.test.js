import { beforeAll, expect, test } from 'vitest';

// The trigger editor's Preview: what it plays on its test die (previewFx). The module reads
// foundry.applications.api at load, so a stub stands in for Foundry.
let previewFx;
let normalizeRule;
beforeAll(async () => {
  globalThis.foundry ??= {
    applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (B) => class extends B {} } },
  };
  ({ previewFx } = await import('../../src/ui/trigger-editor.js'));
  ({ normalizeRule } = await import('../../src/effects/rules.js'));
});

test("Preview plays the rule's Animater moment too (it was left out, so moments never previewed)", () => {
  const rule = normalizeRule(
    { id: 'r', die: 'd20', result: { kind: 'value', value: 20 }, effect: { id: 'glow-pulse' }, sound: { builtin: 'fanfare' }, moment: { kind: 'shake' } },
    'world',
  );
  const fx = previewFx(rule, { type: 'd20', value: 20 });
  expect(fx).toMatchObject({ ruleId: 'r', effect: { id: 'glow-pulse' }, sound: { builtin: 'fanfare' }, moment: { kind: 'shake' }, macro: null, value: 20, type: 'd20' });
  expect(fx.preview).toBe(true); // its moment plays on the GM who clicked, active GM or not
  // a moment-only rule previews its moment
  const only = normalizeRule({ id: 'm', die: 'd20', moment: { kind: 'pulse', colour: '#ffcf4a' } }, 'world');
  expect(previewFx(only, { type: 'd20', value: 7 }).moment).toEqual({ kind: 'pulse', colour: '#ffcf4a' });
  // the effect-only preview: no sound, no moment
  expect(previewFx(rule, { type: 'd20', value: 20 }, true)).toMatchObject({ sound: null, moment: null, effect: { id: 'glow-pulse' } });
});
