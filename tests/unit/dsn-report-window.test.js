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

test('a non-GM gets nothing', () => {
  globalThis.game = { user: { isGM: false } };
  expect(openDsnReport()).toBeNull();
});
