// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { duplicateKeys, usedKeys, resolve } from './lang-check.js';
import { MIN_AREA_PX, PRESETS, resolveArea } from '../../src/areas/area-model.js';
import { dragTo, resizeTo, openAreaEditor } from '../../src/ui/area-editor.js';

const usable = { left: 0, top: 0, width: 1000, height: 800 };
const rectOf = (def) => resolveArea(def, usable);
const HANDLES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
const inside = (r) =>
  r.left >= -1e-6 &&
  r.top >= -1e-6 &&
  r.left + r.width <= usable.width + 1e-6 &&
  r.top + r.height <= usable.height + 1e-6;

describe('dragTo', () => {
  const def = { preset: 'custom', x: 0.3, y: 0.3, w: 0.3, h: 0.4 };
  it('moves by pixels, keeping the size, in fractions', () => {
    const out = dragTo(def, 100, 80, usable);
    expect(out.preset).toBe('custom');
    expect(out.x).toBeCloseTo(0.4);
    expect(out.y).toBeCloseTo(0.4);
    expect(out.w).toBeCloseTo(0.3);
    expect(out.h).toBeCloseTo(0.4);
  });
  it('stays inside past every edge and keeps its size', () => {
    for (const [dx, dy] of [[-5000, 0], [5000, 0], [0, -5000], [0, 5000], [5000, 5000], [-5000, -5000]]) {
      const out = dragTo(def, dx, dy, usable);
      const r = rectOf(out);
      expect(inside(r)).toBe(true);
      expect(r.width).toBeCloseTo(300);
      expect(r.height).toBeCloseTo(320);
    }
  });
  it('drags a preset (turns it custom at its resolved place)', () => {
    const out = dragTo({ preset: 'centre' }, 50, 0, usable);
    expect(out.preset).toBe('custom');
    expect(out.x).toBeCloseTo(PRESETS.centre.x + 0.05);
  });
  it('a full-stage area cannot move', () => {
    const out = dragTo({ preset: 'full' }, 300, 300, usable);
    expect(out.x).toBeCloseTo(0);
    expect(out.y).toBeCloseTo(0);
  });
});

describe('resizeTo', () => {
  const def = { preset: 'custom', x: 0.3, y: 0.3, w: 0.4, h: 0.4 };
  it('moves only the named edges', () => {
    const e = resizeTo(def, 'e', 100, 50, usable);
    expect(e.x).toBeCloseTo(0.3);
    expect(e.w).toBeCloseTo(0.5);
    expect(e.h).toBeCloseTo(0.4);
    const nw = resizeTo(def, 'nw', -100, -80, usable);
    expect(nw.x).toBeCloseTo(0.2);
    expect(nw.y).toBeCloseTo(0.2);
    expect(nw.w).toBeCloseTo(0.5);
    expect(nw.h).toBeCloseTo(0.5);
    const s = resizeTo(def, 's', 999, 80, usable);
    expect(s.x).toBeCloseTo(0.3);
    expect(s.w).toBeCloseTo(0.4);
    expect(s.h).toBeCloseTo(0.5);
  });
  it('stops at the minimum size for every handle, the opposite edge stays put', () => {
    const base = rectOf(def);
    for (const h of HANDLES) {
      // push each handle towards (and past) the opposite edge
      const dx = h.includes('e') ? -9000 : h.includes('w') ? 9000 : 0;
      const dy = h.includes('s') ? -9000 : h.includes('n') ? 9000 : 0;
      const o = resizeTo(def, h, dx, dy, usable);
      const r = rectOf(o);
      expect(r.width).toBeGreaterThanOrEqual(MIN_AREA_PX.width - 1e-6);
      expect(r.height).toBeGreaterThanOrEqual(MIN_AREA_PX.height - 1e-6);
      if (dx) expect(r.width).toBeCloseTo(MIN_AREA_PX.width);
      if (dy) expect(r.height).toBeCloseTo(MIN_AREA_PX.height);
      if (h.includes('e')) expect(r.left).toBeCloseTo(base.left);
      if (h.includes('w')) expect(r.left + r.width).toBeCloseTo(base.left + base.width);
      if (h.includes('s')) expect(r.top).toBeCloseTo(base.top);
      if (h.includes('n')) expect(r.top + r.height).toBeCloseTo(base.top + base.height);
    }
  });
  it('never leaves the usable region', () => {
    for (const h of HANDLES) {
      for (const [dx, dy] of [[9000, 9000], [-9000, -9000], [9000, -9000], [-9000, 9000]]) {
        expect(inside(rectOf(resizeTo(def, h, dx, dy, usable)))).toBe(true);
      }
    }
  });
  it('the minimum is the whole usable region when that is smaller', () => {
    const tiny = { left: 0, top: 0, width: 200, height: 150 };
    const out = resizeTo({ preset: 'full' }, 'se', -100, -100, tiny);
    const r = resolveArea(out, tiny);
    expect(r.width).toBeCloseTo(200);
    expect(r.height).toBeCloseTo(150);
  });
  it('output is normalized custom fractions', () => {
    const out = resizeTo({ preset: 'centre' }, 'e', 10, 0, usable);
    expect(out.preset).toBe('custom');
    for (const k of ['x', 'y', 'w', 'h']) expect(out[k]).toBeGreaterThanOrEqual(0);
    expect(out.x + out.w).toBeLessThanOrEqual(1 + 1e-9);
  });
});

describe('the overlay', () => {
  let settings;
  let calls;
  let editor;
  let me;
  const ptr = (el, type, x, y) =>
    el.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1, bubbles: true }));
  const q = (sel) => document.querySelector(sel);
  const click = (sel) => q(sel).dispatchEvent(new MouseEvent('click', { bubbles: true }));

  function setup({ isGM = true, stored, gm, perPlayer = true, scale = 1 } = {}) {
    settings = {
      rollAreas: stored ?? { default: { preset: 'full' }, users: {} },
      gmPrivateArea: gm ?? { preset: 'corner' },
      perPlayerAreas: perPlayer,
      areaScale: scale,
    };
    calls = [];
    me = { id: isGM ? 'gm1' : 'p1', isGM, name: isGM ? 'GM' : 'Pia' };
    vi.stubGlobal('game', {
      user: me,
      users: [
        { id: 'gm1', name: 'GM', isGM: true },
        { id: 'p1', name: 'Pia', isGM: false },
        { id: 'p2', name: 'Pat', isGM: false },
      ],
      i18n: { localize: (k) => k },
      settings: { get: (_ns, key) => settings[key] },
      dice3d: {
        rollAreas: {
          get: (id) => settings.rollAreas.users?.[id] ?? settings.rollAreas.default ?? { preset: 'full' },
          set: vi.fn(async (id, def) => (calls.push(['set', id, def]), true)),
          setGmPrivateArea: vi.fn(async (def) => (calls.push(['gm', def]), true)),
        },
      },
    });
    vi.stubGlobal('ui', { notifications: { warn: vi.fn() } });
  }
  afterEach(() => {
    editor?.close?.();
    editor = null;
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('opens one overlay, closes it and removes everything on Esc', () => {
    setup();
    editor = openAreaEditor();
    expect(document.querySelectorAll('.dicer-area-editor').length).toBe(1);
    expect(openAreaEditor()).toBe(editor); // a second open reuses it
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelectorAll('.dicer-area-editor').length).toBe(0);
    expect(calls).toEqual([]);
    expect(q('.dicer-area-editor')).toBeNull();
  });

  it('removes every listener it added on close (no leak)', () => {
    setup();
    const add = vi.spyOn(EventTarget.prototype, 'addEventListener');
    const rem = vi.spyOn(EventTarget.prototype, 'removeEventListener');
    editor = openAreaEditor();
    const added = add.mock.calls.map(([t]) => t).sort();
    editor.close();
    const removed = rem.mock.calls.map(([t]) => t).sort();
    add.mockRestore();
    rem.mockRestore();
    expect(added.length).toBeGreaterThan(5);
    expect(removed).toEqual(added);
  });

  it('a lost pointerup does not leave a sticky drag', () => {
    setup({ stored: { default: { preset: 'centre' }, users: {} } });
    editor = openAreaEditor();
    ptr(q('.dicer-area-rect'), 'pointerdown', 500, 400);
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 600, clientY: 400, buttons: 0 }));
    expect(editor.currentDef()).toEqual({ preset: 'centre' });
  });

  it('shows what the dice use when per-player areas are off', () => {
    setup({ perPlayer: false, stored: { default: { preset: 'centre' }, users: { p1: { preset: 'bottom' } } } });
    editor = openAreaEditor();
    editor.select('user:p1');
    expect(editor.currentDef()).toEqual({ preset: 'centre' });
  });

  it('Esc and Cancel discard the draft: nothing is written, stored value untouched', () => {
    setup({ stored: { default: { preset: 'centre' }, users: {} } });
    editor = openAreaEditor();
    click('[data-preset="bottom"]');
    expect(editor.currentDef()).toEqual({ preset: 'bottom' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(calls).toEqual([]);
    expect(settings.rollAreas.default).toEqual({ preset: 'centre' });
  });

  it('Reset gives the full preset, or the corner for the GM corner', async () => {
    setup({ stored: { default: { preset: 'custom', x: 0.1, y: 0.1, w: 0.3, h: 0.3 }, users: {} } });
    editor = openAreaEditor();
    click('[data-action="reset"]');
    expect(editor.currentDef()).toEqual({ preset: 'full' });
    editor.select('gm');
    click('[data-preset="centre"]');
    expect(editor.currentDef()).toEqual({ preset: 'centre' });
    click('[data-action="reset"]');
    expect(editor.currentDef()).toEqual({ preset: 'corner' });
  });

  it('drags the rectangle with the pointer and saves custom fractions for the target', async () => {
    setup({ stored: { default: { preset: 'centre' }, users: {} } });
    editor = openAreaEditor();
    const body = q('.dicer-area-rect');
    ptr(body, 'pointerdown', 500, 400);
    ptr(document, 'pointermove', 600, 480);
    ptr(document, 'pointerup', 600, 480);
    const d = editor.currentDef();
    expect(d.preset).toBe('custom');
    expect(d.x).toBeCloseTo(0.2 + 100 / 1024);
    expect(d.y).toBeCloseTo(0.15 + 80 / 768);
    await editor.save();
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('set');
    expect(calls[0][1]).toBeNull();
    expect(document.querySelectorAll('.dicer-area-editor').length).toBe(0);
  });

  it('resizes with a handle and never below the minimum', () => {
    setup({ stored: { default: { preset: 'centre' }, users: {} } });
    editor = openAreaEditor();
    const h = q('[data-handle="se"]');
    ptr(h, 'pointerdown', 800, 650);
    ptr(document, 'pointermove', -5000, -5000);
    const r = resolveArea(editor.currentDef(), { left: 0, top: 0, width: 1024, height: 768 });
    expect(r.width).toBeGreaterThanOrEqual(MIN_AREA_PX.width - 1e-6);
    expect(r.height).toBeGreaterThanOrEqual(MIN_AREA_PX.height - 1e-6);
    ptr(document, 'pointerup', -5000, -5000);
    ptr(document, 'pointermove', 0, 0); // after pointerup nothing moves
    expect(editor.currentDef().w).toBeCloseTo(r.width / 1024);
  });

  it('has a target per player plus Default and the GM corner; each keeps its own draft', async () => {
    setup({
      stored: { default: { preset: 'full' }, users: { p1: { preset: 'bottom' } } },
    });
    editor = openAreaEditor();
    const ids = [...q('select.dicer-area-target').options].map((o) => o.value);
    expect(ids).toEqual(['default', 'user:gm1', 'user:p1', 'user:p2', 'gm']);
    editor.select('user:p1');
    expect(editor.currentDef()).toEqual({ preset: 'bottom' });
    editor.select('user:p2'); // no own entry: shows the default
    expect(editor.currentDef()).toEqual({ preset: 'full' });
    click('[data-preset="centre"]');
    await editor.save();
    expect(calls).toEqual([['set', 'p2', { preset: 'centre' }]]);
  });

  it('keeps an unreadable stored user area unless that user is edited', async () => {
    setup({
      stored: {
        default: { preset: 'full' },
        users: { p1: { preset: 'bogus' }, p2: { preset: 'bottom' } },
      },
    });
    editor = openAreaEditor();
    editor.select('user:p1');
    expect(editor.currentDef()).toEqual({ preset: 'full' }); // reads as the default
    editor.select('default');
    click('[data-preset="centre"]');
    await editor.save();
    expect(calls).toEqual([['set', null, { preset: 'centre' }]]); // p1 and p2 untouched

    setup({ stored: { default: { preset: 'full' }, users: { p1: { preset: 'bogus' } } } });
    editor = openAreaEditor();
    editor.select('user:p1');
    click('[data-preset="bottom"]');
    await editor.save();
    expect(calls).toEqual([['set', 'p1', { preset: 'bottom' }]]);
  });

  it('saves the GM corner through setGmPrivateArea and only the edited targets', async () => {
    setup();
    editor = openAreaEditor();
    editor.select('gm');
    expect(editor.currentDef()).toEqual({ preset: 'corner' });
    click('[data-preset="bottom"]');
    editor.select('default'); // visiting a target does not edit it
    await editor.save();
    expect(calls).toEqual([['gm', { preset: 'bottom' }]]);
  });

  it('stays open and warns when a write is refused', async () => {
    setup();
    game.dice3d.rollAreas.set = vi.fn(async () => false);
    editor = openAreaEditor();
    click('[data-preset="bottom"]');
    expect(await editor.save()).toBe(false);
    expect(ui.notifications.warn).toHaveBeenCalled();
    expect(document.querySelectorAll('.dicer-area-editor').length).toBe(1);
  });

  it('is read-only for a player: no Save, no handles, no presets; the save handler refuses', async () => {
    setup({ isGM: false, stored: { default: { preset: 'full' }, users: { p1: { preset: 'bottom' } } } });
    editor = openAreaEditor();
    expect(q('[data-action="save"]')).toBeNull();
    expect(q('[data-handle]')).toBeNull();
    expect(q('[data-preset]')).toBeNull();
    expect(q('select.dicer-area-target')).toBeNull();
    expect(editor.readOnly).toBe(true);
    expect(editor.currentDef()).toEqual({ preset: 'bottom' });
    ptr(q('.dicer-area-rect'), 'pointerdown', 500, 700);
    ptr(document, 'pointermove', 100, 100);
    expect(editor.currentDef()).toEqual({ preset: 'bottom' });
    expect(await editor.save()).toBe(false);
    expect(calls).toEqual([]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelectorAll('.dicer-area-editor').length).toBe(0);
  });

  it('a player sees their own area at their screen scale', () => {
    setup({ isGM: false, scale: 0.5, stored: { default: { preset: 'centre' }, users: {} } });
    editor = openAreaEditor();
    const rect = q('.dicer-area-rect');
    const full = resolveArea({ preset: 'centre' }, { left: 0, top: 0, width: 1024, height: 768 }, { scale: 0.5 });
    expect(parseFloat(rect.style.width)).toBeCloseTo(full.width);
  });

  it('follows window resizes while open', () => {
    vi.useFakeTimers();
    try {
      setup({ stored: { default: { preset: 'centre' }, users: {} } });
      editor = openAreaEditor();
      const before = parseFloat(q('.dicer-area-rect').style.width);
      window.innerWidth = 2048;
      window.dispatchEvent(new Event('resize'));
      vi.advanceTimersByTime(500);
      expect(parseFloat(q('.dicer-area-rect').style.width)).toBeCloseTo(before * 2);
    } finally {
      window.innerWidth = 1024;
      vi.useRealTimers();
    }
  });
});

describe('lang/en.json', () => {
  it('has no duplicate keys and resolves every DICER.AreaEditor key', () => {
    expect(duplicateKeys()).toEqual([]);
    const lang = JSON.parse(readFileSync('lang/en.json', 'utf8')).DICER.AreaEditor;
    const keys = usedKeys('AreaEditor', ['src/ui/area-editor.js'], {
      'Preset.': ['full', 'centre', 'bottom', 'corner'],
    });
    expect(keys.length).toBeGreaterThan(8);
    for (const k of keys) expect(typeof resolve(lang, k), `DICER.AreaEditor.${k}`).toBe('string');
  });
  it('has the rollAreaEditor menu keys', () => {
    const en = JSON.parse(readFileSync('lang/en.json', 'utf8')).DICER.Settings.rollAreaEditor;
    expect(Object.keys(en).sort()).toEqual(['Hint', 'Label', 'Name']);
  });
});
