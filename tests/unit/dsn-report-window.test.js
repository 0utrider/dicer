// @vitest-environment jsdom
/** The GM's Dice So Nice migration report window (src/ui/dsn-report.js). */
import { afterEach, expect, test } from 'vitest';
import { renderReport, openDsnReport } from '../../src/ui/dsn-report.js';

afterEach(() => {
  delete globalThis.game;
});

const user = (id, status, extra = {}) => ({ id, name: id, status, scopes: [], saves: 0, otherKeys: [], ...extra });

const full = (over = {}) => ({
  enabled: true,
  worldMigrated: false,
  dsn: 'installed',
  hasData: true,
  world: [
    { dsnKey: 'maxDiceNumber', key: 'maxDice', status: 'copied', value: 30 },
    { dsnKey: 'showGhostDice', key: 'showGhostDice', status: 'absent', value: undefined },
  ],
  users: [
    user('A', 'pending', { scopes: [{ scope: 'global', status: 'would-copy' }], saves: 2 }),
    user('B', 'migrated', { scopes: [{ scope: 'd20', status: 'copied' }] }),
    user('C', 'none'),
  ],
  ...over,
});

test('an empty world shows only the empty state', () => {
  const root = renderReport(full({ hasData: false }));
  expect(root.querySelector('.dicer-empty')).toBeTruthy();
  expect(root.querySelector('section')).toBeNull();
});

test('the sections come in order', () => {
  const sections = [...renderReport(full()).querySelectorAll('section')].map((s) => s.dataset.section);
  expect(sections).toEqual(['status', 'world', 'users', 'unmigrated']);
});

test('absent world rows are hidden; the verdict class carries the status', () => {
  const root = renderReport(full());
  expect(root.querySelectorAll('[data-section=world] tr[data-key]')).toHaveLength(1);
  expect(root.querySelector('tr[data-key=maxDiceNumber] .dicer-verdict.is-copied')).toBeTruthy();
});

test('pending users are open; users with nothing are only counted', () => {
  const root = renderReport(full());
  expect(root.querySelector('details[data-user=A]').open).toBe(true);
  expect(root.querySelector('details[data-user=B]').open).toBe(false);
  expect(root.querySelector('details[data-user=C]')).toBeNull();
  expect(root.querySelector('li[data-scope=global] .dicer-verdict.is-would-copy')).toBeTruthy();
  expect(root.textContent).toContain('DICER.DsnReport.NoneUsers');
});

test('the not-migrated section only when there is something to list', () => {
  expect(renderReport(full()).querySelector('[data-section=unmigrated] li')).toBeTruthy();
  const bare = full({ users: [user('B', 'migrated')] });
  expect(renderReport(bare).querySelector('[data-section=unmigrated]')).toBeNull();
});

test('the import-all button heads the report, with its hint; the saves line counts what was imported', () => {
  const root = renderReport(full({ users: [user('A', 'pending', { saves: 3, savesImported: 1 })] }));
  expect(root.firstElementChild.nextElementSibling.matches('.dicer-report-import')).toBe(true);
  expect(root.querySelector('[data-act="import-all"]').textContent).toContain('DICER.DsnReport.ImportAll');
  expect(root.querySelector('.dicer-report-import .dicer-hint')).toBeTruthy();
  expect(renderReport(full({ hasData: false })).querySelector('[data-act="import-all"]')).toBeNull();
});

test('every import string exists', async () => {
  const { readFileSync } = await import('node:fs');
  const en = JSON.parse(readFileSync('lang/en.json', 'utf8')).DICER;
  for (const k of ['ImportAll', 'ImportAllHint', 'ImportAllDone', 'ImportAllNothing', 'ImportAllFailed', 'Saves']) expect(en.DsnReport[k], k).toBeTruthy();
  expect(en.DsnReport.Saves).toContain('{m}');
  expect(en.Notice.Migrated).toBeTruthy();
  expect(en.Notice.SavesImported).toContain('{n}');
});

test('a non-GM gets nothing', () => {
  globalThis.game = { user: { isGM: false } };
  expect(openDsnReport()).toBeNull();
});

test('every verdict the report can give has a string', async () => {
  const { readFileSync } = await import('node:fs');
  const en = JSON.parse(readFileSync('lang/en.json', 'utf8')).DICER.DsnReport;
  for (const s of ['copied', 'dicer', 'would-copy', 'would-keep', 'invalid', 'no-counterpart', 'unusable', 'off'])
    expect(en.Status[s], s).toBeTruthy();
  for (const s of ['pending', 'migrated', 'off']) expect(en.User[s], s).toBeTruthy();
});

test('the world table has column heads; the import switched off is flagged in its tile', () => {
  const root = renderReport(full({ enabled: false }));
  expect(root.querySelectorAll('[data-section=world] thead th')).toHaveLength(4);
  expect(root.querySelector('.dicer-report-tile.is-warn')).toBeTruthy();
  expect(renderReport(full()).querySelector('.dicer-report-tile.is-warn')).toBeNull();
});

test('the window scrolls: a set height that fits the screen, and a scrolling body', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync('src/ui/dsn-report.js', 'utf8');
  expect(src).toContain('#dicer-dsn-report .window-content{overflow-y:auto}');
  expect(src).not.toMatch(/height: 'auto'/);
  expect(renderReport(full()).querySelector('style').textContent).toContain('overflow-y:auto');
});
