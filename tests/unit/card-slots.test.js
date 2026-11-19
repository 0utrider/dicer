// @vitest-environment jsdom
// Several crits at once: their title cards split the table (2 side by side, 3 in thirds, 4 in a
// 2 x 2 grid), the ones up are drawn again in their slices, a fifth waits; each names its roller.
import { showCard, slotRects, MAX_CARDS, _resetCards } from '../../src/scenes/card.js';

const BOX = { left: 100, top: 0, width: 1200, height: 900 };
const spec = (text) => ({ lines: [{ text }, { text: '20!' }], hold: 900 });

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  _resetCards();
  vi.useRealTimers();
});

test('slotRects: one fills the box; 2 and 3 side by side; 4 a 2 x 2 grid', () => {
  expect(slotRects(1, BOX)).toEqual([BOX]);
  expect(slotRects(2, BOX)).toEqual([
    { left: 100, top: 0, width: 600, height: 900 },
    { left: 700, top: 0, width: 600, height: 900 },
  ]);
  expect(slotRects(3, BOX).map((r) => r.left)).toEqual([100, 500, 900]);
  expect(slotRects(4, BOX)).toEqual([
    { left: 100, top: 0, width: 600, height: 450 },
    { left: 700, top: 0, width: 600, height: 450 },
    { left: 100, top: 450, width: 600, height: 450 },
    { left: 700, top: 450, width: 600, height: 450 },
  ]);
});

test('a second card takes the right half and the first is drawn again in the left; one ending leaves the other in place', () => {
  const host = document.createElement('div');
  const a = showCard(spec('Natural'), { host, area: BOX, who: 'Celdar' });
  expect(a.root.style.width).toBe('1200px');
  vi.advanceTimersByTime(500);
  const b = showCard(spec('Critical'), { host, area: BOX, who: 'Silva' });
  expect(b.root.style.left).toBe('700px');
  expect(b.root.style.width).toBe('600px');
  // the first is drawn again in the left half, laid out like the second (not shrunk)
  expect(host.children).toHaveLength(2);
  expect(a.root.style.left).toBe('100px');
  expect(a.root.style.width).toBe('600px');
  expect(a.root.style.transform).toBe('');
  expect(a.root.textContent).toContain('Natural');
  // both names sit at the same place in their slices
  const top = (h) => h.root.querySelector('.dicer-crit-who').style.top;
  expect(top(a)).toBe(top(b));
  b.stop();
  expect(host.children).toHaveLength(1);
  expect(a.root.style.width).toBe('600px'); // stays where it is
  a.stop();
  expect(host.children).toHaveLength(0); // the scene's handle stops the card drawn again
});

test('a card drawn again ends when it would have: its time is not restarted', () => {
  const host = document.createElement('div');
  const a = showCard(spec('Natural'), { host, area: BOX });
  vi.advanceTimersByTime(1000);
  showCard(spec('Critical'), { host, area: BOX });
  vi.advanceTimersByTime(a.ms - 1000 + 20);
  expect(host.textContent).not.toContain('Natural');
});

test(`more than ${MAX_CARDS} at once: the next waits for a free slice, then shows; a dropped one never does`, () => {
  const host = document.createElement('div');
  const up = Array.from({ length: MAX_CARDS }, (_, i) => showCard(spec(`P${i}`), { host, area: BOX }));
  const fifth = showCard(spec('Fifth'), { host, area: BOX });
  const sixth = showCard(spec('Sixth'), { host, area: BOX });
  expect(fifth.waiting).toBe(true);
  expect(host.children).toHaveLength(MAX_CARDS);
  sixth.stop(); // dropped while waiting
  up[0].stop();
  expect(host.textContent).toContain('Fifth');
  up[1].stop();
  expect(host.textContent).not.toContain('Sixth');
});

test('each card names its roller over it; none without a name', () => {
  const host = document.createElement('div');
  const named = showCard(spec('Natural'), { host, area: BOX, who: 'Celdar' });
  expect(named.root.querySelector('.dicer-crit-who').textContent).toBe('Celdar');
  named.stop();
  const plain = showCard(spec('Natural'), { host, area: BOX });
  expect(plain.root.querySelector('.dicer-crit-who')).toBeNull();
});
