// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { duplicateKeys, usedKeys, resolve } from './lang-check.js';
import {
  openThrowOverlay,
  velocityFromSamples,
  liftFromSpeed,
  spinFromShake,
  SAMPLE_WINDOW_MS,
  MAX_FLICK_SPEED,
  GENTLE_THROW,
} from '../../src/hand/chunk/overlay.js';
import { MAX_RELEASE_SPIN, MAX_RELEASE_SPEED } from '../../src/physics/protocol.js';
import { mulberry32 } from '../../src/core/rng.js';

const STAGE = { left: 0, top: 0, width: 1000, height: 800 };
const PX = 50;
// toDieArea: cx -5, cz -4, halfWidth 3, halfDepth 2
const RECT = { left: 100, top: 100, width: 300, height: 200 };

/** A DiceBox stand-in: hold() and roll() record their calls; a throw lands with `values`. */
function fakeBox(values = [4]) {
  const poses = [];
  const result = (opts) => {
    opts?.record?.({ rec: true, launch: opts.launch ?? null });
    return {
      landed: Promise.resolve(),
      finished: Promise.resolve(),
      values: Promise.resolve(values),
      handle: { id: 'h' },
    };
  };
  const held = {
    ready: Promise.resolve(),
    setPose: vi.fn((i, p, q) => poses.push({ i, p: { ...p }, q: { ...q } })),
    release: vi.fn(result),
    drop: vi.fn(),
  };
  return {
    poses,
    held,
    hold: vi.fn(() => held),
    roll: vi.fn((specs, opts) => result(opts)),
    wake: vi.fn(),
  };
}

const SPECS = [{ type: 'd20', value: 1, free: true, key: '0:0:0' }];
const open = (over = {}) => {
  const box = over.diceBox ?? fakeBox();
  const p = openThrowOverlay({
    specs: SPECS,
    rect: RECT,
    stage: STAGE,
    diePx: PX,
    diceBox: box,
    timeoutMs: 60000,
    label: 'Attack',
    rng: mulberry32(7),
    ...over,
  });
  const el = document.querySelector('.dicer-hand-overlay');
  return { box, p, el };
};
const ptr = (el, type, x, y, id = 1, buttons = type === 'pointerup' ? 0 : 1) =>
  el.dispatchEvent(
    new PointerEvent(type, {
      clientX: x,
      clientY: y,
      pointerId: id,
      bubbles: true,
      button: 0,
      buttons,
      pointerType: 'mouse',
    }),
  );
/** A "throw for me" launch: one entry per die, from the hand, within the caps. */
const expectAutoLaunch = (opts, n) => {
  expect(opts.free).toBe(true);
  expect(opts.launch).toHaveLength(n);
  for (const l of opts.launch) {
    expect([...l.pos, ...l.quat, ...l.linvel, ...l.angvel].every(Number.isFinite)).toBe(true);
    const h = Math.hypot(l.linvel[0], l.linvel[2]);
    expect(h).toBeGreaterThanOrEqual(8 * (1 - 0.12 * 2) - 1e-9);
    expect(h).toBeLessThanOrEqual(16 * (1 + 0.12 * 2) + 1e-9);
    expect(l.linvel[1]).toBeGreaterThan(0);
    expect(Math.hypot(...l.linvel)).toBeLessThanOrEqual(MAX_RELEASE_SPEED);
    expect(Math.hypot(...l.angvel)).toBeLessThanOrEqual(MAX_RELEASE_SPIN + 1e-9);
    expect(Math.hypot(...l.angvel)).toBeGreaterThan(4); // at least a medium shake's tumble
  }
  expect([0, 1, 2, 3]).toContain(opts.edge);
};
const key = (k, code = k) =>
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: k, code, bubbles: true, cancelable: true }),
  );
const last = (box) => box.poses[box.poses.length - 1];

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

test('velocityFromSamples direction, scale, cap, gentle default', () => {
  // 100 px to the right and 50 px down in 100 ms: 1000, 500 px/s = 20, 10 die units/s at 50 px
  const s = [0, 25, 50, 75, 100].map((t) => ({ t, x: t, y: t / 2 }));
  const [vx, vz] = velocityFromSamples(s, PX);
  expect(vx).toBeCloseTo(20, 6);
  expect(vz).toBeCloseTo(10, 6);
  // only the last SAMPLE_WINDOW_MS count: an old drag the other way is ignored
  const late = [{ t: -500, x: 2000, y: 0 }, { t: -400, x: 1000, y: 0 }, ...s];
  expect(velocityFromSamples(late, PX)[0]).toBeCloseTo(20, 6);
  expect(SAMPLE_WINDOW_MS).toBe(120);
  // a very fast flick is capped, keeping its direction
  const fast = [0, 10, 20].map((t) => ({ t, x: t * 100, y: -t * 100 }));
  const [fx, fz] = velocityFromSamples(fast, PX);
  expect(Math.hypot(fx, fz)).toBeCloseTo(MAX_FLICK_SPEED, 6);
  expect(fx).toBeCloseTo(-fz, 6);
  expect(MAX_FLICK_SPEED).toBeLessThanOrEqual(MAX_RELEASE_SPEED);
  // too few samples (in the window): a gentle default toss
  expect(velocityFromSamples([], PX)).toEqual(GENTLE_THROW);
  expect(velocityFromSamples([{ t: 0, x: 5, y: 5 }], PX)).toEqual(GENTLE_THROW);
  expect(
    velocityFromSamples(
      [
        { t: -300, x: 0, y: 0 },
        { t: 0, x: 900, y: 0 },
      ],
      PX,
    ),
  ).toEqual(GENTLE_THROW);
  const g = Math.hypot(...GENTLE_THROW);
  expect(g).toBeGreaterThan(0);
  expect(g).toBeLessThan(6);
  // lift grows with speed and stays bounded
  expect(liftFromSpeed(0)).toBeGreaterThan(0);
  expect(liftFromSpeed(20)).toBeGreaterThan(liftFromSpeed(5));
  expect(Math.hypot(MAX_FLICK_SPEED, liftFromSpeed(1000))).toBeLessThanOrEqual(MAX_RELEASE_SPEED);
});

test('spinFromShake bounded and seeded', () => {
  for (const e of [0, 0.3, 1, 5, -1, NaN]) {
    const rng = mulberry32(3);
    for (let i = 0; i < 50; i++) {
      const w = spinFromShake(e, rng);
      expect(w).toHaveLength(3);
      expect(w.every(Number.isFinite)).toBe(true);
      expect(Math.hypot(...w)).toBeLessThanOrEqual(MAX_RELEASE_SPIN + 1e-9);
    }
  }
  expect(spinFromShake(0.5, mulberry32(9))).toEqual(spinFromShake(0.5, mulberry32(9)));
  expect(spinFromShake(0.5, mulberry32(9))).not.toEqual(spinFromShake(0.5, mulberry32(10)));
  // more shake, more spin
  const mean = (e) => {
    const rng = mulberry32(1);
    let s = 0;
    for (let i = 0; i < 200; i++) s += Math.hypot(...spinFromShake(e, rng));
    return s / 200;
  };
  expect(mean(1)).toBeGreaterThan(mean(0) * 2);
});

test('held dice stop at the rect border', async () => {
  const { box, el, p } = open();
  ptr(el, 'pointerdown', 250, 200); // the area's centre
  const c = last(box).p;
  expect(c.x).toBeLessThan(-4);
  expect(c.x).toBeGreaterThan(-6);
  for (const [x, y] of [
    [600, 200],
    [990, 210],
    [990, 790],
    [-300, -300],
  ]) {
    ptr(el, 'pointermove', x, y);
    const q = last(box).p;
    // a die's centre stays 1 (its radius) inside the area: -5 +- (3 - 1), -4 +- (2 - 1)
    expect(q.x).toBeGreaterThanOrEqual(-7 - 1e-9);
    expect(q.x).toBeLessThanOrEqual(-3 + 1e-9);
    expect(q.z).toBeGreaterThanOrEqual(-5 - 1e-9);
    expect(q.z).toBeLessThanOrEqual(-3 + 1e-9);
  }
  ptr(el, 'pointermove', 990, 200);
  expect(last(box).p.x).toBeCloseTo(-3, 6); // at the border, not beyond it
  ptr(el, 'pointerup', 990, 200);
  await p;
  // the release starts where the die was drawn: inside the area, at the border
  const { launch } = box.held.release.mock.calls[0][0];
  expect(launch[0].pos[0]).toBeCloseTo(-3, 6);
});

test('the pointer maps through the stage rect even when the canvas is translated (shake)', async () => {
  const canvas = document.createElement('canvas');
  canvas.id = 'dicer-canvas';
  canvas.style.transform = 'translate(37px, -21px)';
  canvas.getBoundingClientRect = () => ({
    left: 37,
    top: -21,
    width: 1000,
    height: 800,
    right: 1037,
    bottom: 779,
  });
  document.body.appendChild(canvas);
  const box = fakeBox();
  box._renderer = { canvas };
  const { el, p } = open({ diceBox: box, rect: STAGE });
  ptr(el, 'pointerdown', 500, 400); // the stage centre
  expect(last(box).p.x).toBeCloseTo(0, 6);
  expect(last(box).p.z).toBeCloseTo(0, 6);
  ptr(el, 'pointermove', 600, 450);
  const q = last(box).p;
  // 100, 50 px from the centre = 2, 1 die units on the ground; drawn at its height, it is a
  // little nearer the centre so it shows under the pointer (the camera looks down)
  expect(q.x).toBeGreaterThan(1.8);
  expect(q.x).toBeLessThanOrEqual(2);
  expect(q.z / q.x).toBeCloseTo(0.5, 6);
  key('Escape');
  await p;
});

test('Space throws for me: a generated flick from the hand', async () => {
  const { box, p } = open();
  key(' ', 'Space');
  const out = await p;
  expect(box.held.release).toHaveBeenCalledTimes(1);
  const opts = box.held.release.mock.calls[0][0];
  expectAutoLaunch(opts, 1);
  // from where the die is held (the area centre, drawn a little nearer the stage centre)
  expect(opts.launch[0].pos[0]).toBeCloseTo(last(box).p.x, 9);
  expect(typeof opts.record).toBe('function');
  expect(out.values).toEqual([4]);
  expect(out.handle).toEqual({ id: 'h' });
  expect(out.recording).toEqual({ rec: true, launch: opts.launch }); // the replay has the launch
  expect(document.querySelector('.dicer-hand-overlay')).toBeNull();
});

test('a generated flick heads towards the area centre from near a wall', async () => {
  for (let seed = 1; seed <= 8; seed++) {
    const o = open({ rng: mulberry32(seed) });
    ptr(o.el, 'pointerdown', 990, 200); // the hand at the area's +x border
    ptr(o.el, 'pointercancel', 990, 200); // let go without a throw: it stays there
    key(' ', 'Space');
    await o.p;
    const opts = o.box.held.release.mock.calls[0][0];
    expectAutoLaunch(opts, 1);
    expect(opts.launch[0].linvel[0]).toBeLessThan(0); // back into the area, not into the wall
  }
});

test('the Throw for me button flicks from the hand, a pointer flick throws with launch', async () => {
  const a = open({
    specs: [
      { type: 'd6', value: 1, free: true, key: '0:0:0' },
      { type: 'd6', value: 1, free: true, key: '1:0:0' },
      { type: 'd8', value: 1, free: true, key: '2:0:0' },
    ],
  });
  a.el.querySelector('[data-action="auto"]').click();
  await a.p;
  expectAutoLaunch(a.box.held.release.mock.calls[0][0], 3);
  const b = open();
  ptr(b.el, 'pointerdown', 200, 200);
  for (let i = 1; i <= 5; i++) ptr(b.el, 'pointermove', 200 + i * 20, 200);
  ptr(b.el, 'pointerup', 300, 200);
  const out = await b.p;
  const opts = b.box.held.release.mock.calls[0][0];
  expect(opts.free).toBe(true);
  expect(opts.launch).toHaveLength(1);
  const l = opts.launch[0];
  expect(l.pos).toHaveLength(3);
  expect(l.quat).toHaveLength(4);
  expect(l.linvel[1]).toBeGreaterThan(0); // tossed up a little
  expect(Math.hypot(...l.angvel)).toBeLessThanOrEqual(MAX_RELEASE_SPIN + 1e-9);
  expect([0, 1, 2, 3]).toContain(opts.edge);
  expect(out.recording.launch).toBe(opts.launch);
});

test('Esc -> {cancelled: true}', async () => {
  const { box, p } = open();
  key('Escape');
  expect(await p).toEqual({ cancelled: true });
  expect(box.held.drop).toHaveBeenCalled();
  expect(box.held.release).not.toHaveBeenCalled();
  expect(document.querySelector('.dicer-hand-overlay')).toBeNull();
  const b = open();
  b.el.querySelector('[data-action="cancel"]').click();
  expect(await b.p).toEqual({ cancelled: true });
});

test('timeout -> {timedOut: true}', async () => {
  vi.useFakeTimers();
  const { box, el, p } = open({ timeoutMs: 10000 });
  expect(el.querySelector('.dicer-hand-count').textContent).toContain('10');
  vi.advanceTimersByTime(3000);
  expect(el.querySelector('.dicer-hand-count').textContent).toContain('7');
  window.dispatchEvent(new Event('blur')); // the timeout does not pause
  vi.advanceTimersByTime(7000);
  expect(await p).toEqual({ timedOut: true });
  expect(box.held.drop).toHaveBeenCalled();
  expect(document.querySelector('.dicer-hand-overlay')).toBeNull();
});

test('ghostOnRelease swaps to ghost specs at release and still returns values', async () => {
  const box = fakeBox([17]);
  const specs = [
    { type: 'd20', value: 1, free: true, key: '0:0:0' },
    { type: 'd6', value: 1, free: true, key: '1:0:0' },
  ];
  const { el, p } = open({ diceBox: box, specs, ghostOnRelease: true });
  expect(box.hold.mock.calls[0][0]).toBe(specs); // held with their looks
  ptr(el, 'pointerdown', 250, 200);
  ptr(el, 'pointermove', 260, 205);
  ptr(el, 'pointerup', 270, 210);
  const out = await p;
  expect(box.held.drop).toHaveBeenCalled();
  expect(box.held.release).not.toHaveBeenCalled();
  const [ghosts, opts] = box.roll.mock.calls[0];
  expect(ghosts.map((s) => s.ghost)).toEqual([true, true]);
  expect(ghosts.map((s) => s.key)).toEqual(['0:0:0', '1:0:0']);
  expect(opts.free).toBe(true);
  expect(opts.launch).toHaveLength(2);
  expect(opts.area).toEqual(RECT);
  expect(out.values).toEqual([17]);
  expect(out.recording).toBeTruthy();
});

test('add/removeEventListener counts match; no DOM left', async () => {
  const add = vi.spyOn(EventTarget.prototype, 'addEventListener');
  const remove = vi.spyOn(EventTarget.prototype, 'removeEventListener');
  const raf = vi.spyOn(window, 'requestAnimationFrame');
  const caf = vi.spyOn(window, 'cancelAnimationFrame');
  const ends = [
    (o) => key('Escape'),
    (o) => key(' ', 'Space'),
    (o) => {
      ptr(o.el, 'pointerdown', 250, 200);
      ptr(o.el, 'pointermove', 280, 220);
      ptr(o.el, 'pointerup', 290, 230);
    },
  ];
  for (const end of ends) {
    const before = document.body.children.length;
    add.mockClear();
    remove.mockClear();
    const o = open();
    expect(add.mock.calls.length).toBeGreaterThan(0);
    end(o);
    await o.p;
    expect(remove.mock.calls.length).toBe(add.mock.calls.length);
    for (const [type, fn] of add.mock.calls)
      expect(remove.mock.calls.some(([t, f]) => t === type && f === fn)).toBe(true);
    expect(document.body.children.length).toBe(before);
    expect(document.querySelector('.dicer-hand-overlay')).toBeNull();
    // no frame loop left: nothing poses the dice any more
    const n = o.box.poses.length;
    await new Promise((r) => setTimeout(r, 60));
    expect(o.box.poses.length).toBe(n);
  }
  expect(raf).toHaveBeenCalled(); // the jiggle runs per frame while the overlay is open
  expect(caf).toHaveBeenCalled();
});

test('lang: every DICER.Hand key the overlay uses exists, no duplicates', () => {
  const lang = JSON.parse(readFileSync('lang/en.json', 'utf8'));
  expect(duplicateKeys()).toEqual([]);
  const keys = usedKeys('Hand', ['src/hand/chunk/overlay.js']);
  expect(keys.length).toBeGreaterThan(0);
  for (const k of keys) expect(typeof resolve(lang, `DICER.Hand.${k}`)).toBe('string');
});

test('one overlay at a time: a second open resolves cancelled at once, the first holds on', async () => {
  const a = open();
  const box2 = fakeBox();
  const second = openThrowOverlay({
    specs: SPECS,
    rect: RECT,
    stage: STAGE,
    diePx: PX,
    diceBox: box2,
  });
  expect(await second).toEqual({ cancelled: true });
  expect(box2.hold).not.toHaveBeenCalled();
  expect(document.querySelectorAll('.dicer-hand-overlay')).toHaveLength(1);
  expect(a.box.held.drop).not.toHaveBeenCalled();
  key('Escape');
  expect(await a.p).toEqual({ cancelled: true });
  const c = open(); // free again once the first closed
  expect(c.box.hold).toHaveBeenCalled();
  key('Escape');
  await c.p;
});

test('Space on a focused button is that button, not a throw', async () => {
  const other = document.createElement('button');
  document.body.appendChild(other);
  const { box, p } = open();
  other.dispatchEvent(
    new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }),
  );
  expect(box.held.release).not.toHaveBeenCalled();
  expect(document.querySelector('.dicer-hand-overlay')).not.toBeNull();
  key('Escape');
  await p;
});

test('a move with no button down, or a lost capture, is the release', async () => {
  const a = open();
  ptr(a.el, 'pointerdown', 250, 200);
  ptr(a.el, 'pointermove', 270, 200);
  ptr(a.el, 'pointermove', 290, 200, 1, 0); // the button came up while the window had no focus
  await a.p;
  expect(a.box.held.release).toHaveBeenCalledTimes(1);
  expect(a.box.held.release.mock.calls[0][0].launch).toHaveLength(1);
  const b = open();
  ptr(b.el, 'pointerdown', 250, 200);
  ptr(b.el, 'lostpointercapture', 250, 200);
  await b.p;
  expect(b.box.held.release).toHaveBeenCalledTimes(1);
  // another pointer's lost capture changes nothing
  const c = open();
  ptr(c.el, 'pointerdown', 250, 200);
  ptr(c.el, 'lostpointercapture', 250, 200, 2);
  expect(c.box.held.release).not.toHaveBeenCalled();
  key('Escape');
  await c.p;
});

test('a window resize re-measures the stage, the area and the overlay', async () => {
  const box = fakeBox();
  box._stageRect = { ...STAGE };
  box._diePx = PX;
  const o = open({ diceBox: box, stage: undefined, diePx: undefined });
  expect(o.el.style.width).toBe('1000px');
  box._stageRect = { left: 0, top: 0, width: 2000, height: 1600 }; // DiceBox heard of the resize
  window.dispatchEvent(new Event('resize'));
  await new Promise((r) => setTimeout(r, 80)); // a few frames
  expect(o.el.style.width).toBe('2000px');
  const outline = o.el.querySelector('.dicer-hand-area').style;
  expect([outline.left, outline.top, outline.width, outline.height]).toEqual([
    '200px',
    '200px',
    '600px',
    '400px',
  ]);
  // the new area confines the dice: rect (200, 200, 600, 400) is cx -10, cz -8, half 6 x 4
  ptr(o.el, 'pointerdown', 1990, 400);
  expect(last(box).p.x).toBeCloseTo(-10 + 6 - 1, 6);
  key('Escape');
  await o.p;
});

test('a11y: a labelled dialog takes focus and gives it back; the countdown is live', async () => {
  const before = document.createElement('button');
  document.body.appendChild(before);
  before.focus();
  const { el, p } = open();
  expect(el.getAttribute('role')).toBe('dialog');
  expect(el.getAttribute('aria-label')).toBe('Attack');
  expect(document.activeElement).toBe(el);
  expect(el.querySelector('.dicer-hand-count').getAttribute('aria-live')).toBe('polite');
  key('Escape');
  await p;
  expect(document.activeElement).toBe(before);
});

test('reduced motion: the held dice do not bob or tumble before the grab', async () => {
  const mm = vi.fn(() => ({ matches: true }));
  window.matchMedia = mm;
  try {
    const { box, p } = open();
    await new Promise((r) => setTimeout(r, 80));
    const first = box.poses[0];
    const now = last(box);
    expect(box.poses.length).toBeGreaterThan(1);
    expect(now.p).toEqual(first.p);
    expect(now.q).toEqual(first.q);
    expect(mm).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
    key('Escape');
    await p;
  } finally {
    delete window.matchMedia;
  }
});

test('the styles come with the chunk: one <style> injected on first open, none in dicer.css', async () => {
  const a = open();
  key('Escape');
  await a.p;
  const b = open();
  key('Escape');
  await b.p;
  const styles = document.querySelectorAll('style#dicer-hand-style');
  expect(styles).toHaveLength(1);
  expect(styles[0].textContent).toContain('.dicer-hand-overlay');
  expect(readFileSync('styles/dicer.css', 'utf8')).not.toContain('dicer-hand');
});
