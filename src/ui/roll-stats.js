/**
 * The Roll stats window (lazy chunk; Configure Settings, Dicer, Roll stats, or the theme browser's
 * Stats button): each player's d20 luck over Tonight, the last 30 days or all time, with the spread of
 * the picked player's d20s against a fair die, their longest run of 15+, latest 20 and 1, and what
 * their pet makes of it. Everyone sees the public rolls (user flags); the GM can add the blind and
 * private rolls their own client kept. A player clears their own stats; the GM clears anyone's, all,
 * or starts a new session (Tonight then counts from now).
 */
import { readStats } from '../stats/stats.js';
import { luckOf, mergeStats, sessionFrom, summarize } from '../stats/summary.js';
import { FLAG, HIDDEN } from '../stats/recorder.js';
import { createMoods } from '../pet/chunk/moods.js';
import { readPet } from '../pet/pet-for.js';

const MODULE = 'dicer';
const SCOPES = ['session', 'month', 'all'];
const PETS = {
  mimic: 'Mimic',
  slime: 'Slime',
  dragonling: 'Dragonling',
  owl: 'Owl',
  frog: 'Frog',
  ghost: 'Ghost',
  mushroom: 'Mushroom',
  eye: 'Eye',
  golem: 'Golem',
  cat: 'Cat',
  fox: 'Fox',
  lantern: 'Lantern',
  imp: 'Imp',
  robot: 'Robot',
  jester: 'Jester',
  raven: 'Raven',
  spider: 'Spider',
  skull: 'Skull',
  drone: 'Drone',
};
const loc = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;
const fmt = (key, data) => globalThis.game?.i18n?.format?.(key, data) ?? key;
const setting = (key) => {
  try {
    return globalThis.game.settings.get(MODULE, key);
  } catch {
    return undefined;
  }
};

function h(tag, attrs = {}, kids = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === undefined || v === null) continue;
    if (k === 'text') el.textContent = v;
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids);
  return el;
}

/**
 * One row per user with d20s in scope, the most rolled first: {user, sum, pet}. `hidden` (the GM's
 * private records by user id) is added when given.
 */
export function statRows(users, scope, { now, from, hidden = null }) {
  const rows = [];
  for (const user of users) {
    let rec = readStats(user.getFlag?.(MODULE, FLAG));
    if (hidden?.[user.id]) rec = mergeStats(rec, hidden[user.id]);
    const sum = summarize(rec, scope, { now, from });
    if (sum.n) rows.push({ user, sum, pet: readPet(user) });
  }
  return rows.sort((a, b) => b.sum.n - a.sum.n);
}

/** The player with the best average among non-GMs with enough d20s to judge, or null. */
export function luckiest(rows) {
  let best = null;
  for (const r of rows)
    if (!r.user.isGM && luckOf(r.sum) !== 'few' && (!best || r.sum.avg > best.sum.avg)) best = r;
  return best;
}

/** What a pet makes of its owner's latest five d20s: 'proud', 'sulk' or 'neutral' (as pet moods). */
export function moodFor(last) {
  const moods = createMoods();
  moods.record('x', last);
  return moods.moodOf('x');
}

const metric = (label, value) =>
  h('div', { class: 'dicer-stats-metric' }, [
    h('span', { text: label }),
    h('strong', { text: String(value) }),
  ]);
const moment = (value, label) =>
  label === null
    ? '—'
    : label
      ? fmt('DICER.Stats.MomentOn', { value, label })
      : fmt('DICER.Stats.MomentPlain', { value });

function luckPill(sum) {
  const luck = luckOf(sum);
  return h('span', {
    class: `dicer-stats-luck is-${luck}`,
    text: loc(`DICER.Stats.Luck.${luck}`),
    'data-tooltip': luck === 'few' ? loc('DICER.Stats.Luck.fewHint') : null,
  });
}

/** The spread of d20s: neutral bars, the 20 green and the 1 red (a player colour could match either). */
function chart(sum) {
  const fair = sum.n / 20;
  const top = Math.max(...sum.counts, fair) * 1.15 || 1;
  const bars = sum.counts.map((c, i) => {
    const cls = i === 19 ? ' is-twenty' : i === 0 ? ' is-one' : '';
    return h('div', {
      class: `dicer-stats-bar${cls}`,
      style: `height:${Math.max((c / top) * 100, 1)}%`,
      'data-tooltip': `${i + 1}: ${c}`,
    });
  });
  const line = h('div', { class: 'dicer-stats-fair', style: `bottom:${(fair / top) * 100}%` });
  const labels = sum.counts.map((c, i) => h('span', { text: String(i + 1) }));
  return [
    h('div', { class: 'dicer-stats-chart' }, [...bars, line]),
    h('div', { class: 'dicer-stats-axis' }, labels),
  ];
}

/**
 * The window's content. `state`: {scope, selected, blind}; `view`: {rows, isGM, meId, canBlind}.
 */
export function buildStats(state, { rows, isGM, meId, canBlind }) {
  const scopes = h(
    'div',
    { class: 'dicer-stats-scopes', role: 'radiogroup' },
    SCOPES.map((s) =>
      h('button', {
        type: 'button',
        class: s === state.scope ? 'active' : null,
        role: 'radio',
        'aria-checked': String(s === state.scope),
        'data-scope': s,
        text: loc(`DICER.Stats.Scope.${s}`),
      }),
    ),
  );
  const gmTools = isGM
    ? [
        ...(canBlind
          ? [
              h(
                'label',
                { class: 'dicer-stats-blind', 'data-tooltip': loc('DICER.Stats.BlindHint') },
                [
                  h('input', { type: 'checkbox', 'data-blind': '', checked: state.blind }),
                  loc('DICER.Stats.Blind'),
                ],
              ),
            ]
          : []),
        h(
          'button',
          {
            type: 'button',
            'data-action-stats': 'session',
            'data-tooltip': loc('DICER.Stats.NewSessionHint'),
          },
          [h('i', { class: 'fa-solid fa-flag-checkered' }), ` ${loc('DICER.Stats.NewSession')}`],
        ),
        h(
          'button',
          {
            type: 'button',
            'data-action-stats': 'clearAll',
            'data-tooltip': loc('DICER.Stats.ClearAllHint'),
          },
          [h('i', { class: 'fa-solid fa-trash' }), ` ${loc('DICER.Stats.ClearAll')}`],
        ),
      ]
    : [];
  const bar = h('div', { class: 'dicer-stats-bar-row' }, [
    scopes,
    h('span', { class: 'dicer-stats-spacer' }),
    ...gmTools,
  ]);
  if (!rows.length)
    return h('div', { class: 'dicer-roll-stats' }, [
      bar,
      h('p', {
        class: 'dicer-stats-empty',
        text: loc(
          setting('rollStats') === false ? 'DICER.Stats.Off' : `DICER.Stats.Empty.${state.scope}`,
        ),
      }),
    ]);

  const total = rows.reduce((a, r) => a + r.sum.n, 0);
  const lucky = luckiest(rows);
  const metrics = h('div', { class: 'dicer-stats-metrics' }, [
    metric(loc('DICER.Stats.Rolled'), total),
    metric(
      loc('DICER.Stats.Twenties'),
      rows.reduce((a, r) => a + r.sum.twenties, 0),
    ),
    metric(
      loc('DICER.Stats.Ones'),
      rows.reduce((a, r) => a + r.sum.ones, 0),
    ),
    metric(loc('DICER.Stats.Luckiest'), lucky?.user.name ?? '—'),
  ]);
  const head = h(
    'div',
    { class: 'dicer-stats-row is-head' },
    ['Player', 'D20s', 'Average', 'Twenties', 'Ones', 'Luck']
      .map((k) => h('span', { text: loc(`DICER.Stats.Col.${k}`) }))
      .concat(h('span')),
  );
  const sel = rows.find((r) => r.user.id === state.selected) ?? rows[0];
  const list = rows.map((r) => {
    const canClear = isGM || r.user.id === meId;
    return h(
      'div',
      {
        class: `dicer-stats-row${r === sel ? ' active' : ''}`,
        'data-user': r.user.id,
        role: 'button',
        tabindex: '0',
      },
      [
        h('span', { class: 'dicer-stats-who' }, [
          h('span', {
            class: 'dicer-stats-dot',
            style: `background:${r.user.color?.css ?? r.user.color ?? '#888'}`,
          }),
          h('span', { class: 'dicer-stats-name', text: r.user.name }),
          ...(r.pet.kind !== 'none' && PETS[r.pet.kind]
            ? [
                h('span', {
                  class: 'dicer-stats-pet',
                  text: loc(`DICER.Appearance.Pet.${PETS[r.pet.kind]}`),
                }),
              ]
            : []),
        ]),
        h('span', { text: String(r.sum.n) }),
        h('span', { text: r.sum.avg.toFixed(1) }),
        h('span', { text: String(r.sum.twenties) }),
        h('span', { text: String(r.sum.ones) }),
        luckPill(r.sum),
        canClear
          ? h(
              'button',
              {
                type: 'button',
                class: 'dicer-stats-clear',
                'data-clear': r.user.id,
                'aria-label': fmt('DICER.Stats.ClearOne', { name: r.user.name }),
                'data-tooltip': fmt('DICER.Stats.ClearOne', { name: r.user.name }),
              },
              [h('i', { class: 'fa-solid fa-eraser' })],
            )
          : h('span'),
      ],
    );
  });

  const s = sel.sum;
  const facts = h(
    'div',
    { class: 'dicer-stats-facts' },
    [
      [loc('DICER.Stats.Run'), s.run ? fmt('DICER.Stats.RunValue', { n: s.run }) : '—'],
      [loc('DICER.Stats.Worst'), moment(1, s.worst)],
      [loc('DICER.Stats.Best'), moment(20, s.best)],
    ].map(([label, value]) =>
      h('div', {}, [h('span', { text: label }), h('div', { text: value })]),
    ),
  );
  const detail = [
    h('div', { class: 'dicer-stats-detail-head' }, [
      h('strong', { text: sel.user.name }),
      h('span', { text: loc('DICER.Stats.ChartHint') }),
    ]),
    ...chart(s),
    facts,
  ];
  if (sel.pet.kind !== 'none' && PETS[sel.pet.kind]) {
    const pet = loc(`DICER.Appearance.Pet.${PETS[sel.pet.kind]}`);
    detail.push(
      h('div', { class: 'dicer-stats-petline' }, [
        h('i', { class: 'fa-solid fa-paw' }),
        h('span', {
          text: fmt(`DICER.Stats.Mood.${moodFor(s.last)}`, { pet, name: sel.user.name }),
        }),
      ]),
    );
  }
  return h('div', { class: 'dicer-roll-stats' }, [
    bar,
    metrics,
    h('div', { class: 'dicer-stats-table' }, [head, ...list]),
    h('div', { class: 'dicer-stats-detail' }, detail),
  ]);
}

async function confirm(title, content) {
  const Dialog = globalThis.foundry?.applications?.api?.DialogV2;
  if (!Dialog) return globalThis.confirm?.(content) ?? false;
  return Dialog.confirm({
    window: { title },
    content: `<p>${content}</p>`,
    rejectClose: false,
    modal: true,
  });
}

/** Deletes a user's public stats (their flag) and, on the GM's client, their private record. */
export async function clearUser(user, { isGM = false, getSetting = setting, setSetting } = {}) {
  await user.unsetFlag(MODULE, FLAG);
  if (!isGM) return;
  const all = { ...(getSetting(HIDDEN) ?? {}) };
  if (user.id in all) {
    delete all[user.id];
    await setSetting(HIDDEN, all);
  }
}

let app = null;

/** Opens (or brings forward) the Roll stats window. */
export function openRollStats() {
  const { ApplicationV2 } = globalThis.foundry.applications.api;
  const game = globalThis.game;
  const set = (k, v) => game.settings.set(MODULE, k, v);
  class RollStats extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: 'dicer-roll-stats',
      classes: ['dicer-roll-stats-app'],
      window: { title: 'DICER.Stats.Title', icon: 'fa-solid fa-chart-column', resizable: true },
      position: { width: 600, height: 'auto' },
    };
    #state = { scope: 'session', selected: null, blind: false };
    #hooks = [];
    #timer = null;

    async _renderHTML() {
      const isGM = !!game.user.isGM;
      const hidden = isGM ? (setting(HIDDEN) ?? {}) : {};
      const canBlind = isGM && Object.keys(hidden).length > 0;
      const now = Date.now();
      const rows = statRows(game.users, this.#state.scope, {
        now,
        from: sessionFrom(now, setting('rollStatsSession')),
        hidden: canBlind && this.#state.blind ? hidden : null,
      });
      return buildStats(this.#state, { rows, isGM, meId: game.user.id, canBlind });
    }
    _replaceHTML(result, content) {
      content.replaceChildren(result);
      result.addEventListener('click', (event) => this.#onClick(event));
      result.addEventListener('keydown', (event) => {
        if (
          (event.key === 'Enter' || event.key === ' ') &&
          event.target.matches?.('.dicer-stats-row[data-user]')
        ) {
          event.preventDefault();
          this.#pick(event.target.dataset.user);
        }
      });
      result.addEventListener('change', (event) => {
        if (!event.target.matches?.('[data-blind]')) return;
        this.#state.blind = event.target.checked;
        this.render();
      });
    }
    _onFirstRender(...args) {
      super._onFirstRender?.(...args);
      // another client's roll or Clear lands in a user flag or a world setting: redraw, coalesced
      const soon = () => {
        clearTimeout(this.#timer);
        this.#timer = setTimeout(() => this.rendered && this.render(), 300);
      };
      this.#hooks = [
        [
          'updateUser',
          Hooks.on(
            'updateUser',
            // a block body, as every listener here: one that returns false can stop the others
            (user, changes) => {
              if (changes?.flags?.dicer && (FLAG in changes.flags.dicer || `-=${FLAG}` in changes.flags.dicer)) soon();
            },
          ),
        ],
        [
          'updateSetting',
          Hooks.on('updateSetting', (s) => void (s?.key === 'dicer.rollStatsSession' && soon())), // never false
        ],
        [
          'clientSettingChanged',
          Hooks.on('clientSettingChanged', (key) => void (key === `dicer.${HIDDEN}` && soon())),
        ],
      ];
    }
    _onClose(...args) {
      super._onClose?.(...args);
      for (const [name, id] of this.#hooks) Hooks.off(name, id);
      this.#hooks = [];
      clearTimeout(this.#timer);
    }
    #pick(id) {
      this.#state.selected = id;
      this.render();
    }
    async #onClick(event) {
      const t = event.target;
      const scope = t.closest?.('[data-scope]')?.dataset.scope;
      if (scope) {
        this.#state.scope = scope;
        return this.render();
      }
      const clear = t.closest?.('[data-clear]')?.dataset.clear;
      if (clear) return this.#clearOne(clear);
      const action = t.closest?.('[data-action-stats]')?.dataset.actionStats;
      if (action === 'session') return this.#newSession();
      if (action === 'clearAll') return this.#clearAll();
      const row = t.closest?.('.dicer-stats-row[data-user]');
      if (row) this.#pick(row.dataset.user);
    }
    async #clearOne(id) {
      const user = game.users.get(id);
      if (!user || !(game.user.isGM || user.id === game.user.id)) return;
      const ok = await confirm(
        loc('DICER.Stats.ClearTitle'),
        fmt(
          user.id === game.user.id ? 'DICER.Stats.ClearMineConfirm' : 'DICER.Stats.ClearOneConfirm',
          { name: user.name },
        ),
      );
      if (!ok) return;
      try {
        await clearUser(user, { isGM: game.user.isGM, setSetting: set });
      } catch (err) {
        console.warn('dicer: cannot clear roll stats', err);
        globalThis.ui?.notifications?.warn(loc('DICER.Stats.ClearFailed'));
      }
      this.render();
    }
    async #clearAll() {
      if (
        !game.user.isGM ||
        !(await confirm(loc('DICER.Stats.ClearTitle'), loc('DICER.Stats.ClearAllConfirm')))
      )
        return;
      try {
        for (const user of game.users)
          if (user.getFlag(MODULE, FLAG)) await user.unsetFlag(MODULE, FLAG);
        await set(HIDDEN, {});
      } catch (err) {
        console.warn('dicer: cannot clear roll stats', err);
        globalThis.ui?.notifications?.warn(loc('DICER.Stats.ClearFailed'));
      }
      this.render();
    }
    async #newSession() {
      if (!game.user.isGM) return;
      await set('rollStatsSession', Date.now());
      this.#state.scope = 'session';
      globalThis.ui?.notifications?.info(loc('DICER.Stats.NewSessionDone'));
      this.render();
    }
  }
  if (!app?.rendered) app = new RollStats();
  return app.render({ force: true });
}
