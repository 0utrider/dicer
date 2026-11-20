import { describe, expect, test } from 'vitest';
import { workbenchCancels } from '../../src/compat/workbench.js';

const gameWith = ({ active = true, mode = 'mustTarget' } = {}) => ({
  modules: { get: (id) => (id === 'xdy-pf2e-workbench' ? { active } : undefined) },
  settings: {
    get: (ns, k) => {
      if (ns !== 'xdy-pf2e-workbench' || k !== 'reminderTargeting') throw new Error('not registered');
      return mode;
    },
  },
});
const attack = { options: { type: 'attack-roll' } };
const untargeted = { targets: new Set() };
const targeted = { targets: new Set(['t1']) };

describe('workbenchCancels', () => {
  test('an untargeted attack or spell attack under mustTarget is cancelled', () => {
    expect(workbenchCancels(attack, untargeted, gameWith())).toBe(true);
    expect(workbenchCancels({ options: { type: 'spell-attack-roll' } }, untargeted, gameWith())).toBe(true);
    expect(workbenchCancels(attack, {}, gameWith())).toBe(true);
  });

  test('a target, another check type, a reminder only or Workbench off cancels nothing', () => {
    expect(workbenchCancels(attack, targeted, gameWith())).toBe(false);
    expect(workbenchCancels({ options: { type: 'skill-check' } }, untargeted, gameWith())).toBe(false);
    expect(workbenchCancels({}, untargeted, gameWith())).toBe(false);
    expect(workbenchCancels(attack, untargeted, gameWith({ mode: 'reminder' }))).toBe(false);
    expect(workbenchCancels(attack, untargeted, gameWith({ active: false }))).toBe(false);
    expect(workbenchCancels(attack, untargeted, undefined)).toBe(false);
  });

  test('a setting that throws cancels nothing', () => {
    const game = { modules: { get: () => ({ active: true }) }, settings: { get: () => { throw new Error('x'); } } };
    expect(workbenchCancels(attack, untargeted, game)).toBe(false);
  });
});
