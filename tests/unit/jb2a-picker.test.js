// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const EN = JSON.parse(readFileSync('lang/en.json', 'utf8'));
const localize = (key) => key.split('.').reduce((o, k) => o?.[k], EN) ?? key;
import { MAX_SHOWN, filterEntries, jb2aEntries, pickJb2a, resolveFile, sequencerDatabase } from '../../src/ui/jb2a-picker.js';

const BASE = 'modules/jb2a_patreon/Library/Generic';
const files = {
  'jb2a.explosion.01.blue': `${BASE}/Explosion/Explosion_01_Blue_400x400.webm`,
  'jb2a.explosion.01.orange': `${BASE}/Explosion/Explosion_01_Orange_400x400.webm`,
  'jb2a.impact.004.yellow': `${BASE}/Impact/Impact_04_Regular_Yellow_400x400.webm`,
};
/** A fake Sequencer database: plain files, a size range, several entries, an image. */
function fakeDb() {
  return {
    publicFlattenedEntries: [
      ...Object.keys(files),
      'jb2a.breath.cone.fire.15ft',
      'jb2a.breath.cone.fire.30ft',
      'jb2a.breath.cone.fire.60ft',
      'jb2a.twin.1',
      'jb2a.twin.2',
      'jb2a.icon.png',
      'other.thing',
    ],
    getEntry(path) {
      if (files[path]) return { file: files[path] };
      if (path === 'jb2a.breath.cone.fire') return { getAllFiles: () => ['a/15.webm', 'a/30.webm', 'a/60.webm'] };
      if (path === 'jb2a.twin') return [{ file: 'b/one.webm' }, { file: 'b/two.webm' }];
      if (path === 'jb2a.icon.png') return { file: 'c/icon.png' };
      return false;
    },
  };
}

describe('JB2A picker helpers', () => {
  afterEach(() => {
    delete globalThis.game;
    delete globalThis.Sequencer;
  });

  it('lists jb2a paths only, without sizes or indexes, sorted and unique', () => {
    expect(jb2aEntries(fakeDb())).toEqual([
      'jb2a.breath.cone.fire',
      'jb2a.explosion.01.blue',
      'jb2a.explosion.01.orange',
      'jb2a.icon.png',
      'jb2a.impact.004.yellow',
      'jb2a.twin',
    ]);
    expect(jb2aEntries(null)).toEqual([]);
  });

  it('filters on every word, dots or spaces', () => {
    const all = jb2aEntries(fakeDb());
    expect(filterEntries(all, 'Explosion BLUE')).toEqual(['jb2a.explosion.01.blue']);
    expect(filterEntries(all, 'explosion.orange')).toEqual(['jb2a.explosion.01.orange']);
    expect(filterEntries(all, '  ')).toBe(all);
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
  const items = () => [...document.querySelectorAll('.dicer-jp-list li[data-path]')].map((li) => li.dataset.path);
  const type = (text) => {
    const s = $('.dicer-jp-search');
    s.value = text;
    s.dispatchEvent(new Event('input'));
  };

  it('searches, previews on hover, picks with the button and resolves the file', async () => {
    const done = pickJb2a(fakeDb());
    expect(items()).toHaveLength(6);
    type('impact');
    expect(items()).toEqual(['jb2a.impact.004.yellow']);
    const li = $('li[data-path="jb2a.impact.004.yellow"]');
    li.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect($('.dicer-jp-video').getAttribute('src')).toBe(files['jb2a.impact.004.yellow']);
    expect($('.dicer-jp-choose').disabled).toBe(true);
    li.click();
    expect($('.dicer-jp-choose').disabled).toBe(false);
    $('.dicer-jp-choose').click();
    await expect(done).resolves.toBe(files['jb2a.impact.004.yellow']);
    expect($('.dicer-jp')).toBeNull();
  });

  it('a double click picks; an entry with no video cannot be chosen', async () => {
    const done = pickJb2a(fakeDb());
    $('li[data-path="jb2a.icon.png"]').click();
    expect($('.dicer-jp-choose').disabled).toBe(true);
    $('li[data-path="jb2a.twin"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await expect(done).resolves.toBe('b/one.webm');
  });

  it('Escape, Cancel and a click outside close with null', async () => {
    let done = pickJb2a(fakeDb());
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await expect(done).resolves.toBeNull();
    done = pickJb2a(fakeDb());
    $('[data-jp="cancel"]').click();
    await expect(done).resolves.toBeNull();
    done = pickJb2a(fakeDb());
    $('.dicer-jp').click();
    await expect(done).resolves.toBeNull();
    expect(document.querySelectorAll('.dicer-jp')).toHaveLength(0);
  });

  it('shows at most MAX_SHOWN entries with a note, and a message when nothing matches', async () => {
    const many = Array.from({ length: MAX_SHOWN + 5 }, (_, i) => `jb2a.fx.${String(i).padStart(4, '0')}a`);
    const done = pickJb2a({ publicFlattenedEntries: many, getEntry: () => ({ file: 'x.webm' }) });
    expect(items()).toHaveLength(MAX_SHOWN);
    expect($('.dicer-jp-count').textContent).toContain(String(MAX_SHOWN + 5));
    type('zzz');
    expect($('.dicer-jp-none')).not.toBeNull();
    $('[data-jp="cancel"]').click();
    await done;
  });

  it('previews the current file first', async () => {
    const done = pickJb2a(fakeDb(), { current: 'x/Current.webm' });
    expect($('.dicer-jp-video').getAttribute('src')).toBe('x/Current.webm');
    expect($('.dicer-jp-name').textContent).toBe('Current.webm');
    $('[data-jp="cancel"]').click();
    await done;
  });
});
