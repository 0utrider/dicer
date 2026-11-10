import { viewFor } from '../../src/compat/privacy.js';

const base = {
  contentVisible: true,
  isGM: false,
  isAuthor: false,
  blind: false,
  whispered: false,
  rollGhost: false,
  rollSecret: false,
  showGhostDice: false,
};
const view = (o) => viewFor({ ...base, ...o });

describe('one test per row', () => {
  test('secret roll, not a GM -> none', () => {
    expect(view({ rollSecret: true })).toBe('none');
  });
  test('secret roll, GM who cannot see the content -> none', () => {
    expect(view({ rollSecret: true, isGM: true, contentVisible: false, showGhostDice: true, whispered: true })).toBe('none');
  });
  test('secret roll, GM who can see the content -> real', () => {
    expect(view({ rollSecret: true, isGM: true })).toBe('real');
  });
  test('hidden content, showGhostDice, whispered -> ghost', () => {
    expect(view({ contentVisible: false, showGhostDice: true, whispered: true })).toBe('ghost');
  });
  test('hidden content, showGhostDice, blind author -> ghost', () => {
    expect(view({ contentVisible: false, showGhostDice: true, blind: true, isAuthor: true })).toBe('ghost');
  });
  test('hidden content, showGhostDice, blind but not the author -> none', () => {
    expect(view({ contentVisible: false, showGhostDice: true, blind: true })).toBe('none');
  });
  test('hidden content, showGhostDice off -> none', () => {
    expect(view({ contentVisible: false, whispered: true, blind: true, isAuthor: true })).toBe('none');
  });
  test('hidden content, showGhostDice but neither whispered nor blind -> none', () => {
    expect(view({ contentVisible: false, showGhostDice: true })).toBe('none');
  });
  test('ghost-flagged roll -> ghost for a player and for a GM', () => {
    expect(view({ rollGhost: true })).toBe('ghost');
    expect(view({ rollGhost: true, isGM: true })).toBe('ghost');
  });
  test('ordinary visible roll -> real', () => {
    expect(view({})).toBe('real');
  });
});

test('cross product: real only if contentVisible and !rollGhost and (!rollSecret or isGM)', () => {
  const keys = Object.keys(base);
  let count = 0;
  for (let mask = 0; mask < 1 << keys.length; mask++) {
    const input = Object.fromEntries(keys.map((k, i) => [k, Boolean(mask & (1 << i))]));
    const result = viewFor(input);
    const mayBeReal = input.contentVisible && !input.rollGhost && (!input.rollSecret || input.isGM);
    expect(result === 'real').toBe(mayBeReal);
    expect(['real', 'ghost', 'none']).toContain(result);
    count++;
  }
  expect(count).toBe(256);
});
