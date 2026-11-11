import { isGmOnly } from '../../src/areas/gm-only.js';

const isGm = (id) => id === 'gm' || id === 'gm2';

test('blind and secret rolls are GM-only', () => {
  expect(isGmOnly({ blind: true, isGm })).toBe(true);
  expect(isGmOnly({ secret: true, isGm })).toBe(true);
});

test('a whisper counts only when every recipient is a GM', () => {
  expect(isGmOnly({ recipients: ['gm', { id: 'gm2' }], isGm })).toBe(true);
  expect(isGmOnly({ recipients: ['gm', 'p1'], isGm })).toBe(false);
  expect(isGmOnly({ recipients: [], isGm })).toBe(false);
  expect(isGmOnly({ recipients: null, isGm })).toBe(false);
  expect(isGmOnly({ isGm })).toBe(false);
});
