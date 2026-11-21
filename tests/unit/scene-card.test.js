// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { showCard, seeded, fitPx, freeArea } from '../../src/scenes/card.js';
import { runScene } from '../../src/scenes/kit.js';

const SPEC = {
  seed: 20,
  glow: '#ff9a3c',
  lines: [
    { text: 'Natural', size: 0.13, at: 0.3, enter: 'slam' },
    { text: '20!', size: 0.3, at: 0.62, enter: 'pop', delay: 230 },
  ],
  rays: { colors: ['#ffbe3c', '#ff6a1e'] },
  flash: '#fff2d0',
  confetti: { count: 20 },
  crack: '#000',
  shake: 0.8,
  hold: 1000,
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test('a card mounts in its host with each line, then removes itself after its duration', () => {
  const host = document.createElement('div');
  const c = showCard(SPEC, { host });
  expect(host.querySelectorAll('.dicer-crit-card')).toHaveLength(1);
  expect(c.root.textContent).toContain('Natural');
  expect(c.root.textContent).toContain('20!');
  expect(c.root.querySelector('canvas')).not.toBeNull(); // confetti
  expect(c.root.querySelector('polyline')).not.toBeNull(); // the crack
  expect(c.ms).toBeGreaterThan(1500);
  expect(c.ms).toBeLessThan(4000);
  vi.advanceTimersByTime(c.ms + 10);
  expect(host.children).toHaveLength(0);
});

test('stop() removes it at once; the reduced form has no rays, flash, crack or particles', () => {
  const host = document.createElement('div');
  showCard(SPEC, { host }).stop();
  expect(host.children).toHaveLength(0);
  const calm = showCard(SPEC, { host, reduced: true });
  expect(calm.root.querySelector('canvas')).toBeNull();
  expect(calm.root.querySelector('polyline')).toBeNull();
  expect(calm.root.textContent).toContain('20!');
  calm.stop();
});

test('a thud line is split into letters; no lines, no card', () => {
  const host = document.createElement('div');
  const c = showCard({ lines: [{ text: 'FAIL', enter: 'thud' }], exit: 'crumble' }, { host });
  expect(c.root.querySelectorAll('span')).toHaveLength(4);
  c.stop();
  expect(showCard({ lines: [] }, { host }).ms).toBe(0);
  expect(host.children).toHaveLength(0);
});

test('seeded: the same seed gives the same stream (every screen shows the same card)', () => {
  const a = seeded(5);
  const b = seeded(5);
  expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  expect(seeded(6)()).not.toBe(seeded(5)());
});

test("a scene's card shows once, plays on past the scene's own end, and goes when the scene is stopped early", () => {
  const host = document.createElement('div');
  const make = () =>
    runScene(
      { scene: new THREE.Scene(), anchor: new THREE.Vector3(), radius: 0.9, cardHost: host, borrow: { moving: true, pose() {}, hide() {} } },
      { duration: 200, full: (t, s) => t >= 50 && (s.card(SPEC), s.card(SPEC)) },
    );
  const h = make();
  for (let t = 0; t <= 300; t += 16) h.update(t);
  expect(host.children).toHaveLength(1); // once, and still on after the scene ended
  vi.advanceTimersByTime(5000);
  expect(host.children).toHaveLength(0);
  const early = make();
  early.update(0);
  early.update(60);
  expect(host.children).toHaveLength(1);
  early.stop();
  expect(host.children).toHaveLength(0);
});

test('a long word shrinks to fit a narrow screen; a short one keeps its size', () => {
  const long = { text: 'Spectacular!', size: 0.27 };
  const px = fitPx(long, {}, 661, 800);
  expect(px * 12 * 0.56).toBeLessThanOrEqual(800 * 0.9 + 1);
  expect(fitPx({ text: '20!', size: 0.3 }, {}, 661, 800)).toBe(Math.round(661 * 0.3));
  expect(fitPx(long, { font: 'tech' }, 661, 800)).toBeLessThan(px); // the wide font shrinks more
});

test('split letters (thud, crumble) each carry their own fill: a moving letter loses the word clip', () => {
  const host = document.createElement('div');
  const c = showCard({ lines: [{ text: 'Fail', enter: 'thud', fill: ['#ff7a6b', '#c81e1e'] }], exit: 'crumble' }, { host });
  const spans = [...c.root.querySelectorAll('span')];
  expect(spans).toHaveLength(4);
  for (const s of spans) {
    expect(s.style.backgroundImage).toContain('linear-gradient');
    expect(s.style.filter).toContain('drop-shadow');
  }
  expect(spans[0].parentElement.style.backgroundImage).toBe('none');
  c.stop();
});

test('a line laid out wider than the screen is scaled down to fit it', () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const spy = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(window.innerWidth * 1.5);
  try {
    const c = showCard({ lines: [{ text: 'Mastery', size: 0.27 }] }, { host });
    const zoom = Number(c.root.querySelector('[style*="zoom"]')?.style.zoom);
    expect(zoom).toBeCloseTo(0.92 / 1.5, 2);
    c.stop();
  } finally {
    spy.mockRestore();
    host.remove();
  }
});

test('the card fits the visible table: the window minus a docked sidebar and a side camera dock', () => {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const dock = (id, left, width) => {
    const el = document.createElement('div');
    el.id = id;
    el.getBoundingClientRect = () => ({ left, right: left + width, width, top: 0, height: H });
    document.body.appendChild(el);
    return el;
  };
  const cams = dock('camera-views', 0, 200);
  const side = dock('sidebar', W - 300, 300);
  try {
    expect(freeArea(document, window)).toEqual({ left: 200, top: 0, width: W - 500, height: H });
    const c = showCard({ lines: [{ text: '20!' }] }, { host: document.body });
    expect(c.root.style.left).toBe('200px');
    expect(c.root.style.width).toBe(`${W - 500}px`);
    c.stop();
  } finally {
    cams.remove();
    side.remove();
  }
  expect(freeArea(document, window)).toEqual({ left: 0, top: 0, width: W, height: H });
});

describe('the title card layer (issue: cards hidden behind the dice tray)', () => {
  const css = readFileSync('styles/dicer.css', 'utf8');
  /** The z-index of the first rule whose selector is exactly `sel`. */
  const zOf = (sel) => {
    const at = css.indexOf(`${sel} {`);
    if (at < 0) throw new Error(`no rule for ${sel}`);
    return Number(/z-index:\s*(\d+)/.exec(css.slice(at, css.indexOf('}', at)))?.[1]);
  };

  test('the card sits over the dice canvas and the dice tray, raised or not', () => {
    const card = zOf('.dicer-crit-card');
    const cardUp = zOf(':root:has(#dicer-canvas.dicer-above) .dicer-crit-card');
    expect(card).toBeGreaterThan(zOf('#dicer-canvas'));
    expect(card).toBeGreaterThan(zOf('.dicer-tt'));
    expect(cardUp).toBeGreaterThan(zOf('#dicer-canvas.dicer-above'));
    expect(cardUp).toBeGreaterThan(zOf('.dicer-tt.dicer-above'));
  });

  test('a card sets no inline z-index of its own (the stylesheet decides)', () => {
    const root = showCard(SPEC, { doc: document, area: { left: 0, top: 0, width: 400, height: 300 } }).root;
    expect(root?.className).toBe('dicer-crit-card');
    expect(root?.style.zIndex).toBe('');
  });
});
