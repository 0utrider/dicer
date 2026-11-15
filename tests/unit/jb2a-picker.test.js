// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  PAGE,
  categoriesOf,
  colorWords,
  filterGroups,
  groupEntries,
  jb2aEntries,
  pickJb2a,
  resolveFile,
  sequencerDatabase,
  swatchCss,
} from '../../src/ui/jb2a-picker.js';

const EN = JSON.parse(readFileSync('lang/en.json', 'utf8'));
const localize = (key) => key.split('.').reduce((o, k) => o?.[k], EN) ?? key;

const BASE = 'modules/jb2a_patreon/Library/Generic';
const files = {
  'jb2a.explosion.01.blue': `${BASE}/Explosion/Explosion_01_Blue_400x400.webm`,
  'jb2a.explosion.01.orange': `${BASE}/Explosion/Explosion_01_Orange_400x400.webm`,
  'jb2a.explosion.01.dark_red': `${BASE}/Explosion/Explosion_01_DarkRed_400x400.webm`,
  'jb2a.impact.004.yellow': `${BASE}/Impact/Impact_04_Regular_Yellow_400x400.webm`,
};
/** A fake Sequencer database: colour variants, a size range, several entries, an image. */
function fakeDb(extra = []) {
  return {
    publicFlattenedEntries: [
      ...Object.keys(files),
      'jb2a.breath.cone.fire.15ft',
      'jb2a.breath.cone.fire.30ft',
      'jb2a.twin.1',
      'jb2a.twin.2',
      'jb2a.icon.png',
      'other.thing',
      ...extra,
    ],
    getEntry(path) {
      if (files[path]) return { file: files[path] };
      if (path === 'jb2a.breath.cone.fire') return { getAllFiles: () => ['a/15.webm', 'a/30.webm', 'a/60.webm'] };
      if (path === 'jb2a.twin') return [{ file: 'b/one.webm' }, { file: 'b/two.webm' }];
      if (path === 'jb2a.icon.png') return { file: 'c/icon.png' };
      if (path.startsWith('jb2a.fx.')) return { file: `f/${path}.webm` };
      return false;
    },
  };
}

describe('JB2A picker data', () => {
  afterEach(() => {
    delete globalThis.game;
    delete globalThis.Sequencer;
  });

  it('lists jb2a paths only, without sizes or indexes, sorted and unique', () => {
    expect(jb2aEntries(fakeDb())).toEqual([
      'jb2a.breath.cone.fire',
      'jb2a.explosion.01.blue',
      'jb2a.explosion.01.dark_red',
      'jb2a.explosion.01.orange',
      'jb2a.icon.png',
      'jb2a.impact.004.yellow',
      'jb2a.twin',
    ]);
    expect(jb2aEntries(null)).toEqual([]);
  });

  it('reads JB2A colour names, shades and blends; other words are not colours', () => {
    expect(colorWords('blue')).toEqual(['blue']);
    expect(colorWords('bluepurple')).toEqual(['blue', 'purple']);
    expect(colorWords('dark_greenpurple')).toEqual(['dark', 'green', 'purple']);
    expect(colorWords('bright_orange')).toEqual(['bright', 'orange']);
    expect(colorWords('lightblue')).toEqual(['light', 'blue']);
    for (const w of ['fire', 'complete', 'large', 'dark', '01', 'regular']) expect(colorWords(w)).toBeNull();
    expect(swatchCss(['blue'])).toBe('#3f7cff');
    expect(swatchCss(['blue', 'purple'])).toMatch(/^linear-gradient/);
    expect(swatchCss(['dark', 'red'])).toContain('black');
    expect(swatchCss(['rainbow'])).toMatch(/^conic-gradient/);
  });

  it('folds colour variants into one animation per category', () => {
    const groups = groupEntries(jb2aEntries(fakeDb()));
    const boom = groups.find((g) => g.key === 'jb2a.explosion.01');
    expect(boom).toMatchObject({ category: 'explosion', label: '01' });
    expect(boom.variants.map((v) => v.name)).toEqual(['blue', 'dark_red', 'orange']);
    expect(groups.find((g) => g.key === 'jb2a.breath.cone.fire').variants).toEqual([{ name: '', words: [], path: 'jb2a.breath.cone.fire' }]);
    expect(categoriesOf(groups)).toEqual([
      { name: 'breath', count: 1 },
      { name: 'explosion', count: 1 },
      { name: 'icon', count: 1 },
      { name: 'impact', count: 1 },
      { name: 'twin', count: 1 },
    ]);
    expect(filterGroups(groups, 'explosion', '').map((g) => g.key)).toEqual(['jb2a.explosion.01']);
    expect(filterGroups(groups, '', 'dark red').map((g) => g.key)).toEqual(['jb2a.explosion.01']);
    expect(filterGroups(groups, 'impact', 'explosion')).toEqual([]);
  });

  it('resolves a file like Sequencer does: middle size, first of several; non-webm is null', () => {
    const db = fakeDb();
    expect(resolveFile(db, 'jb2a.explosion.01.blue')).toBe(files['jb2a.explosion.01.blue']);
    expect(resolveFile(db, 'jb2a.breath.cone.fire')).toBe('a/30.webm');
    expect(resolveFile(db, 'jb2a.twin')).toBe('b/one.webm');
    expect(resolveFile(db, 'jb2a.icon.png')).toBeNull();
    expect(resolveFile(db, 'jb2a.nope')).toBeNull();
    expect(resolveFile({ getEntry: () => { throw new Error('x'); } }, 'a')).toBeNull();
  });

  it('uses Sequencer only when its module is active', () => {
    globalThis.Sequencer = { Database: fakeDb() };
    globalThis.game = { modules: new Map([['sequencer', { active: false }]]) };
    expect(sequencerDatabase()).toBeNull();
    globalThis.game.modules.set('sequencer', { active: true });
    expect(sequencerDatabase()).toBe(globalThis.Sequencer.Database);
  });
});

describe('pickJb2a overlay', () => {
  beforeEach(() => {
    globalThis.game = { i18n: { localize } };
  });
  afterEach(() => {
    document.querySelectorAll('.dicer-jp').forEach((n) => n.remove());
    delete globalThis.game;
  });
  const $ = (s) => document.querySelector(s);
  const keys = () => [...document.querySelectorAll('.dicer-jp-tile')].map((t) => t.dataset.key);
  const type = (text) => {
    const s = $('.dicer-jp-search');
    s.value = text;
    s.dispatchEvent(new Event('input'));
  };

  it('shows categories with counts, filters by category and search, and loads tile videos', async () => {
    const done = pickJb2a(fakeDb());
    const cats = [...document.querySelectorAll('[data-cat]')].map((li) => [li.dataset.cat, li.querySelector('em').textContent]);
    expect(cats[0]).toEqual(['', '5']);
    expect(cats).toContainEqual(['explosion', '1']);
    expect(keys()).toHaveLength(5);
    $('[data-cat="impact"]').click();
    expect(keys()).toEqual(['jb2a.impact.004']);
    expect($('.dicer-jp-tile video').getAttribute('src')).toBe(`${files['jb2a.impact.004.yellow']}#t=0.6`);
    $('[data-cat=""]').click();
    type('breath');
    expect(keys()).toEqual(['jb2a.breath.cone.fire']);
    type('zzz');
    expect($('.dicer-jp-none')).not.toBeNull();
    $('[data-jp="cancel"]').click();
    await expect(done).resolves.toBeNull();
  });

  it('a swatch picks that colour and swaps the tile video; Choose resolves its file', async () => {
    const done = pickJb2a(fakeDb());
    expect($('.dicer-jp-choose').disabled).toBe(true);
    const tile = $('.dicer-jp-tile[data-key="jb2a.explosion.01"]');
    expect(tile.querySelectorAll('.dicer-jp-swatch')).toHaveLength(3);
    tile.querySelector('[data-variant="jb2a.explosion.01.orange"]').click();
    expect(tile.querySelector('video').getAttribute('src')).toBe(`${files['jb2a.explosion.01.orange']}#t=0.6`);
    expect(tile.getAttribute('aria-selected')).toBe('true');
    expect($('.dicer-jp-status').textContent).toBe('explosion.01.orange');
    $('.dicer-jp-choose').click();
    await expect(done).resolves.toBe(files['jb2a.explosion.01.orange']);
    expect($('.dicer-jp')).toBeNull();
  });

  it('a click on the tile picks its shown colour; a double click chooses; no video cannot be chosen', async () => {
    let done = pickJb2a(fakeDb());
    $('.dicer-jp-tile[data-key="jb2a.icon.png"]').click();
    expect($('.dicer-jp-choose').disabled).toBe(true);
    $('.dicer-jp-tile[data-key="jb2a.explosion.01"] .dicer-jp-label').click();
    expect($('[data-variant="jb2a.explosion.01.blue"]').getAttribute('aria-pressed')).toBe('true');
    $('[data-jp="cancel"]').click();
    await done;
    done = pickJb2a(fakeDb());
    $('.dicer-jp-tile[data-key="jb2a.twin"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await expect(done).resolves.toBe('b/one.webm');
  });

  it('keeps the chosen colour when the grid is redrawn', async () => {
    const done = pickJb2a(fakeDb());
    $('[data-variant="jb2a.explosion.01.dark_red"]').click();
    type('explosion');
    const tile = $('.dicer-jp-tile[data-key="jb2a.explosion.01"]');
    expect(tile.dataset.path).toBe('jb2a.explosion.01.dark_red');
    expect(tile.querySelector('[data-variant="jb2a.explosion.01.dark_red"]').getAttribute('aria-pressed')).toBe('true');
    $('[data-jp="cancel"]').click();
    await done;
  });

  it('Escape, Cancel and a click outside close with null', async () => {
    let done = pickJb2a(fakeDb());
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await expect(done).resolves.toBeNull();
    done = pickJb2a(fakeDb());
    $('.dicer-jp').click();
    await expect(done).resolves.toBeNull();
    expect(document.querySelectorAll('.dicer-jp')).toHaveLength(0);
  });

  it(`draws ${PAGE} tiles at a time with a Show more button`, async () => {
    const many = Array.from({ length: PAGE + 5 }, (_, i) => `jb2a.fx.n${String(i).padStart(4, '0')}`);
    const done = pickJb2a(fakeDb(many));
    $('[data-cat="fx"]').click();
    expect(keys()).toHaveLength(PAGE);
    expect($('.dicer-jp-more').hidden).toBe(false);
    expect($('.dicer-jp-more').textContent).toContain('5');
    $('.dicer-jp-more').click();
    expect(keys()).toHaveLength(PAGE + 5);
    expect($('.dicer-jp-more').hidden).toBe(true);
    $('[data-jp="cancel"]').click();
    await done;
  });

  it('names the stored file until something is picked', async () => {
    const done = pickJb2a(fakeDb(), { current: 'x/Current.webm' });
    expect($('.dicer-jp-status').textContent).toBe('Now using: Current.webm');
    $('[data-jp="cancel"]').click();
    await done;
  });
});
