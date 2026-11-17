// Owner review page for the Roll stats window: the REAL window content (buildStats, statRows) and
// styles, with lang/en.json's strings, over made-up players. Click scopes and rows as in Foundry.
import lang from '../lang/en.json';
import { addRolls, emptyStats } from '../src/stats/stats.js';
import { sessionFrom } from '../src/stats/summary.js';
import { buildStats, statRows } from '../src/ui/roll-stats.js';

const get = (key) => key.split('.').reduce((o, k) => o?.[k], lang);
globalThis.game = {
  i18n: {
    localize: (k) => get(k) ?? k,
    format: (k, data) => String(get(k) ?? k).replace(/\{(\w+)\}/g, (m, n) => data?.[n] ?? m),
  },
};

const NOW = Date.now();
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
// a seeded random, so the page looks the same each load
let seed = 7;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const biased = (lean) =>
  Math.min(20, Math.max(1, Math.round(1 + rand() * 19 + lean * (rand() - 0.3))));

function history(lean, perNight, extras = []) {
  let r = emptyStats();
  for (let night = 42; night >= 0; night -= 7)
    for (let i = 0; i < perNight; i++)
      r = addRolls(r, [biased(lean)], {
        ts: NOW - night * DAY - (perNight - i) * MIN,
        label: ['Strike', 'Fortitude save', 'Perception', 'Initiative', 'Athletics'][i % 5],
      });
  for (const [v, label] of extras) r = addRolls(r, [v], { ts: NOW - 30 * 1000, label });
  return r;
}

const user = (id, name, color, rec, pet, isGM = false) => ({
  id,
  name,
  color,
  isGM,
  getFlag: (m, k) => (k === 'stats' ? rec : k === 'pet' ? { kind: pet } : undefined),
});
const users = [
  user(
    'maya',
    'Maya',
    '#D85A30',
    history(3, 24, [
      [20, 'Strike vs the dragon'],
      [20, 'Strike vs the dragon'],
      [20, 'Initiative'],
    ]),
    'dragonling',
  ),
  user(
    'theo',
    'Theo',
    '#1D9E75',
    history(-3, 30, [
      [1, 'Death save'],
      [1, 'Reflex save'],
      [4, 'Stealth'],
    ]),
    'mimic',
  ),
  user('ari', 'Ari', '#7F77DD', history(0, 18), 'slime'),
  user('gm', 'Gamemaster', '#888780', history(1, 40), 'none', true),
];
const hidden = { theo: history(-1, 6) };

const state = { scope: 'session', selected: null, blind: false };
const content = document.getElementById('content');
const gm = document.getElementById('gm');

function draw() {
  const isGM = gm.checked;
  const from = sessionFrom(NOW, 0);
  const rows = statRows(users, state.scope, {
    now: NOW,
    from,
    hidden: isGM && state.blind ? hidden : null,
  });
  content.replaceChildren(
    buildStats(state, { rows, isGM, meId: isGM ? 'gm' : 'theo', canBlind: isGM }),
  );
}

content.addEventListener('click', (e) => {
  const scope = e.target.closest('[data-scope]')?.dataset.scope;
  const clear = e.target.closest('[data-clear]')?.dataset.clear;
  const action = e.target.closest('[data-action-stats]')?.dataset.actionStats;
  const row = e.target.closest('.dicer-stats-row[data-user]');
  if (scope) state.scope = scope;
  else if (clear || action)
    return void (document.getElementById('status').textContent =
      `clicked: ${clear ? `clear ${clear}` : action}`);
  else if (row) state.selected = row.dataset.user;
  else return;
  draw();
});
content.addEventListener('change', (e) => {
  if (e.target.matches('[data-blind]')) state.blind = e.target.checked;
  draw();
});
gm.addEventListener('change', draw);
draw();
document.getElementById('status').textContent = 'ready';
