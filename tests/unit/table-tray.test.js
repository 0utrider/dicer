// @vitest-environment jsdom
/**
 * Dice trays: the look and place rules (tray-model.js), the tray on screen (tray.js: drawn, routed
 * into, dragged, resized, slid in and out) and the editor's pure helpers (tray-editor.js).
 */
import {
  normalizeTray,
  trayLookFor,
  traySound,
  normalizeTrayRect,
  trayPixels,
  trayFractions,
  trayStyle,
  DEFAULT_TRAY,
} from '../../src/tray/tray-model.js';
import { createTray } from '../../src/tray/tray.js';
import { applyField, startingLook, designChoice, trayForm } from '../../src/ui/tray-editor.js';

const STAGE = { left: 0, top: 0, width: 1000, height: 800 };

describe('tray model', () => {
  test('a look is made safe: junk is the default, values clamped, bad pictures dropped', () => {
    expect(normalizeTray('x')).toEqual(normalizeTray(DEFAULT_TRAY));
    const t = normalizeTray({
      surface: 'stone',
      color: '#ABCDEF',
      rim: { style: 'leather', width: 99 },
      radius: -5,
      design: { src: 'skull', size: 9, opacity: 0.5 },
    });
    expect(t).toMatchObject({
      surface: 'stone',
      color: '#abcdef',
      rim: { style: 'leather', width: 40 },
      radius: 0,
      design: { src: 'skull', size: 1, opacity: 0.5 },
    });
    expect(normalizeTray({ surface: 'image', image: 'javascript:x.png' }).surface).toBe('felt'); // no usable picture
    expect(normalizeTray({ surface: 'image', image: 'worlds/w/felt.webp' }).image).toBe(
      'worlds/w/felt.webp',
    );
    expect(normalizeTray({ design: { src: 'a") ; x.png' } }).design.src).toBe('');
  });

  test('which tray a screen has: none, the table look, or your own (falling back to the table look)', () => {
    const table = { surface: 'wood' };
    expect(trayLookFor({ mode: 'none', table })).toBeNull();
    expect(trayLookFor({ mode: 'table', table: null })).toBeNull(); // no table tray set by the GM
    expect(trayLookFor({ mode: 'table', table }).surface).toBe('wood');
    expect(trayLookFor({ mode: 'mine', mine: { surface: 'stone' }, table }).surface).toBe('stone');
    expect(trayLookFor({ mode: 'mine', table }).surface).toBe('wood');
    expect(trayLookFor({ mode: 'mine' }).surface).toBe(DEFAULT_TRAY.surface);
    expect(
      ['felt', 'wood', 'stone', 'leather', 'metal'].map((surface) => traySound({ surface })),
    ).toEqual(['felt', 'wood', 'stone', 'felt', 'metal']);
  });

  test('a place stays inside the stage, never too small, and round-trips through pixels', () => {
    expect(normalizeTrayRect({ x: 0.9, w: 0.5 })).toMatchObject({ x: 0.5, w: 0.5 });
    const px = trayPixels({ x: 0.1, y: 0.1, w: 0.1, h: 0.1 }, STAGE);
    expect([px.width, px.height]).toEqual([240, 180]); // the minimum
    const back = trayPixels(
      trayFractions({ left: 100, top: 80, width: 400, height: 300 }, STAGE),
      STAGE,
    );
    expect(back).toEqual({ left: 100, top: 80, width: 400, height: 300 });
    expect(trayPixels({ x: 0.9, y: 0.9, w: 0.5, h: 0.5 }, STAGE).left).toBe(500); // pushed back inside
  });

  test('style: custom properties for the surface, rim, corners and design (a built-in one from assets)', () => {
    const s = trayStyle(
      {
        surface: 'image',
        image: 'worlds/w/t.webp',
        design: { src: 'moon', color: '#ff0000', size: 0.5 },
      },
      (p) => `/r/${p}`,
    );
    expect(s['--dicer-tt-image']).toBe('url("/r/worlds/w/t.webp")');
    expect(s['--dicer-tt-design']).toBe('url("/r/modules/dicer/assets/trays/moon.svg")');
    expect(s['--dicer-tt-design-size']).toBe('50%');
    expect(trayStyle({})['--dicer-tt-design']).toBe('none');
  });
});

describe('the tray on screen', () => {
  let settings;
  let set;
  let rolls;
  const make = () =>
    createTray({
      getSetting: (k) => settings[k],
      setSetting: (set = vi.fn(async (k, v) => (settings[k] = v))),
      measure: () => STAGE,
      activeRolls: () => rolls,
    });
  beforeEach(() => {
    document.body.innerHTML = '<div id="board"></div>';
    settings = {
      trayMode: 'table',
      tableTray: { surface: 'wood', rim: { width: 10 } },
      trayRect: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
      trayShow: 'always',
    };
    rolls = 0;
  });
  afterEach(() => vi.useRealTimers());

  test('drawn after the board from the look; dice land inside its rim; no tray: no area', () => {
    const t = make();
    t.refresh();
    const el = document.querySelector('.dicer-tt');
    expect(document.getElementById('board').nextElementSibling).toBe(el);
    expect(el.dataset.surface).toBe('wood');
    expect(el.style.left).toBe('100px');
    expect(t.area()).toEqual({ left: 116, top: 96, width: 468, height: 368 }); // rim 10 + 6 inset
    expect(t.sound()).toBe('wood');
    settings.trayMode = 'none';
    t.refresh();
    expect(document.querySelector('.dicer-tt')).toBeNull();
    expect(t.area()).toBeNull();
    expect(t.sound()).toBeNull();
  });

  test('dragging the rim moves it, the grip resizes it; the place is saved on release', () => {
    const t = make();
    t.refresh();
    const el = t.element;
    const fire = (target, type, x, y) =>
      target.dispatchEvent(
        new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }),
      );
    fire(el.querySelector('.dicer-tt-edge-top'), 'pointerdown', 200, 100);
    fire(document, 'pointermove', 250, 160);
    fire(document, 'pointerup', 250, 160);
    expect(el.style.left).toBe('150px');
    expect(set).toHaveBeenCalledWith('trayRect', expect.objectContaining({ x: 0.15, y: 0.175 }));
    fire(el.querySelector('.dicer-tt-grip'), 'pointerdown', 650, 560);
    fire(document, 'pointermove', 750, 600);
    fire(document, 'pointerup', 750, 600);
    expect(el.style.width).toBe('600px');
  });

  test('shown only while rolling: slides in for a roll and out once the dice clear', () => {
    vi.useFakeTimers();
    settings.trayShow = 'rolls';
    const t = make();
    t.refresh();
    const el = t.element;
    expect(el.classList.contains('is-hidden')).toBe(true);
    rolls = 1;
    t.rolling();
    expect(el.classList.contains('is-hidden')).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(el.classList.contains('is-hidden')).toBe(false);
    rolls = 0;
    vi.advanceTimersByTime(500);
    expect(el.classList.contains('is-hidden')).toBe(true);
    t.raise(true);
    expect(el.classList.contains('dicer-above')).toBe(true);
    t.dispose();
    expect(document.querySelector('.dicer-tt')).toBeNull();
  });
});

describe('the tray editor', () => {
  test('starts from the stored look (the table look, then the default); fields change one value', () => {
    expect(startingLook('mine', { table: { surface: 'stone' } }).surface).toBe('stone');
    expect(startingLook('table', { mine: { surface: 'wood' } }).surface).toBe(DEFAULT_TRAY.surface);
    let look = startingLook('mine', {});
    look = applyField(look, 'rim.width', '22');
    look = applyField(look, 'design.choice', 'compass');
    expect(look.rim.width).toBe(22);
    expect(designChoice(look)).toBe('compass');
    look = applyField(look, 'design.choice', 'none');
    expect(look.design.src).toBe('');
    look = applyField(look, 'design.src', 'worlds/w/emblem.png');
    expect(designChoice(look)).toBe('custom');
  });

  test('the form: target switch for a GM only; the design controls only with a design', () => {
    globalThis.game = { i18n: { localize: (k) => k } };
    const look = startingLook('mine', {});
    expect(trayForm(look, 'mine').querySelector('[data-target]')).toBeNull();
    expect(trayForm(look, 'table', { gm: true }).querySelectorAll('[data-target]')).toHaveLength(2);
    expect(trayForm(look, 'mine').querySelector('[data-field="design.color"]')).toBeNull();
    expect(
      trayForm(applyField(look, 'design.choice', 'sigil'), 'mine').querySelector(
        '[data-field="design.color"]',
      ),
    ).toBeTruthy();
    expect(
      trayForm(look, 'mine', { pickingImage: true }).querySelector('[data-field="image"]'),
    ).toBeTruthy();
    delete globalThis.game;
  });
});
