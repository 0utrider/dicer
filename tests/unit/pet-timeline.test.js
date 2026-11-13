import {
  phaseAt,
  summarize,
  ENTER_MS,
  REACT_MS,
  EXIT_MS,
  QUICK_EXIT_MS,
} from '../../src/pet/chunk/timeline.js';

test('phases in order with exact boundaries', () => {
  const tr = { beganAt: 1000, landedAt: 2000 };
  expect(phaseAt(tr, 1000)).toEqual({ phase: 'enter', t: 0 });
  expect(phaseAt(tr, 1000 + ENTER_MS)).toEqual({ phase: 'throw', t: 0 });
  expect(phaseAt(tr, 1000 + 600)).toEqual({ phase: 'watch', t: 0 });
  expect(phaseAt(tr, 1999).phase).toBe('watch');
  expect(phaseAt(tr, 2000)).toEqual({ phase: 'react', t: 0 });
  expect(phaseAt(tr, 2000 + REACT_MS)).toEqual({ phase: 'exit', t: 0 });
  expect(phaseAt(tr, 2000 + REACT_MS + EXIT_MS)).toEqual({ phase: 'gone', t: 1 });
  expect(phaseAt({ beganAt: 0 }, 99999).phase).toBe('watch');
});

test('a landing before the throw ends reacts after the throw', () => {
  expect(phaseAt({ beganAt: 0, landedAt: 100 }, 599).phase).toBe('throw');
  expect(phaseAt({ beganAt: 0, landedAt: 100 }, 600).phase).toBe('react');
});

test('leave caps the exit before the fade ends', () => {
  const tr = { beganAt: 0, landedAt: 1000, leaveAt: 1500, leaveMs: 400 };
  const exitStart = 1500 + 400 - QUICK_EXIT_MS;
  expect(phaseAt(tr, exitStart - 1).phase).toBe('react');
  expect(phaseAt(tr, exitStart)).toEqual({ phase: 'exit', t: 0 });
  expect(phaseAt(tr, exitStart + QUICK_EXIT_MS).phase).toBe('gone');
});

test('leave after the natural exit changes nothing', () => {
  const tr = { beganAt: 0, landedAt: 1000, leaveAt: 9000, leaveMs: 400 };
  expect(phaseAt(tr, 2200).phase).toBe('exit');
  expect(phaseAt(tr, 2200 + EXIT_MS).phase).toBe('gone');
});

test('leave with 0 is instant', () => {
  const tr = { beganAt: 0, leaveAt: 700, leaveMs: 0 };
  expect(phaseAt(tr, 699).phase).toBe('watch');
  expect(phaseAt(tr, 700).phase).toBe('gone');
});

test('summarize', () => {
  const d = (type, value, ghost) => ({ type, value, ghost });
  expect(summarize([d('d20', 20)], false)).toBe('crit');
  expect(summarize([d('d20', 1)], false)).toBe('fumble');
  expect(summarize([d('d20', 20), d('d20', 1)], false)).toBe('mixed');
  expect(summarize([d('d6', 6)], false)).toBe('plain');
  expect(summarize([d('d20', 20, true)], false)).toBe('plain');
  expect(summarize([d('d20', 20)], true)).toBe('plain');
  expect(summarize([d('d20', 20), d('d6', 1)], false)).toBe('crit');
});
