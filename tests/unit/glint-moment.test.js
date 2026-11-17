/**
 * The glint die effect and the Animater moment a trigger rule may carry: validation, the trigger
 * form round trip and the effect's shell lifecycle.
 */
import * as THREE from 'three';
import { normalizeRule, MOMENT_KINDS } from '../../src/effects/rules.js';
import { entryFromRule, blankEntry } from '../../src/ui/trigger-form.js';
import { glint, DIE_EFFECTS } from '../../src/effects/library/die-effects.js';
import { EFFECT_IDS } from '../../src/effects/effect-ids.js';

test('a rule may carry only a moment; unknown kinds and bad colours are dropped', () => {
  const warn = vi.fn();
  const r = normalizeRule(
    { id: 'm', moment: { kind: 'pulse', colour: '#ffcf4a', strength: 3 } },
    'user',
    warn,
  );
  expect(r.moment).toEqual({ kind: 'pulse', colour: '#ffcf4a', strength: 1 });
  expect(normalizeRule({ id: 'x', moment: { kind: 'explode' } }, 'user', warn)).toBeNull();
  expect(
    normalizeRule(
      { id: 'y', moment: { kind: 'shake', colour: 'red;' }, macro: 'Macro.a' },
      'user',
      warn,
    ).moment,
  ).toEqual({ kind: 'shake' });
  expect('moment' in normalizeRule({ id: 'z', macro: 'Macro.a' }, 'user', warn)).toBe(false);
  expect(MOMENT_KINDS).toContain('shake');
});

test('the trigger form keeps a moment both ways', async () => {
  const { rulesFromForm } = await import('../../src/ui/trigger-form.js');
  const rule = normalizeRule(
    { id: 'm', name: 'Crit', moment: { kind: 'pulse', colour: '#ffcf4a' } },
    'user',
  );
  const e = entryFromRule(rule);
  expect([e.momentKind, e.momentColour]).toEqual(['pulse', '#ffcf4a']);
  expect(blankEntry('n').momentKind).toBe('');
  const rules = rulesFromForm({ rules: { 0: e } }, { source: 'user' });
  expect(rules[0].moment).toEqual({ kind: 'pulse', colour: '#ffcf4a' });
});

test('glint: a shell over the die whose band sweeps once, then is removed and freed', () => {
  expect(DIE_EFFECTS.glint).toBe(glint);
  expect(EFFECT_IDS).toContain('glint');
  const inner = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  const run = glint.start({
    die: { inner },
    color: new THREE.Color('#ffffff'),
    intensity: 1,
    duration: 600,
  });
  const shell = inner.children[0];
  expect(shell.geometry).toBe(inner.geometry);
  const dispose = vi.spyOn(shell.material, 'dispose');
  expect(run.update(0)).toBe(true);
  run.update(300);
  expect(shell.material.uniforms.uSweep.value).toBeCloseTo(0, 5);
  expect(shell.material.uniforms.uStrength.value).toBeCloseTo(1, 5);
  expect(run.update(700)).toBe(false);
  expect(inner.children).toHaveLength(0);
  expect(dispose).toHaveBeenCalled();
  expect(glint.start({ die: {} }).update(0)).toBe(false); // no die mesh: nothing
});
