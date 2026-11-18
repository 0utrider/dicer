/**
 * The Dice So Nice migration report window (lazy chunk; GM; settings menu): what the migration
 * copied, kept or skipped for the world and every user, rebuilt from current data on each
 * render (compat/migration-report.js). Read-only.
 */
import { buildReport } from '../compat/migration-report.js';
import { worldSettingsReader, storedWorldValue, migrateAll } from '../compat/migration.js';

const P = 'DICER.DsnReport';
const loc = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;
const fmt = (key, data) => globalThis.game?.i18n?.format?.(key, data) ?? key;

function h(tag, attrs = {}, kids = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === undefined || v === null) continue;
    if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids);
  return el;
}

const verdict = (status) => h('span', { class: `dicer-verdict is-${status}`, text: loc(`${P}.Status.${status}`) });
const section = (id, heading, kids) =>
  h('section', { 'data-section': id }, [h('h3', { text: loc(`${P}.Section.${heading}`) }), ...kids]);
const yesNo = (v) => loc(`${P}.${v ? 'Yes' : 'No'}`);
const show = (v) => (v === undefined ? '' : JSON.stringify(v));

function statusSection(r) {
  const pair = (field, value) => [h('dt', { text: loc(`${P}.Field.${field}`) }), h('dd', { text: value })];
  return section('status', 'Status', [
    h('dl', {}, [
      ...pair('Enabled', yesNo(r.enabled)),
      ...pair('WorldMigrated', yesNo(r.worldMigrated)),
      ...pair('Dsn', loc(`${P}.Dsn.${r.dsn}`)),
    ]),
  ]);
}

function worldSection(r) {
  const rows = r.world
    .filter((w) => w.status !== 'absent')
    .map((w) =>
      h('tr', { 'data-key': w.dsnKey }, [
        h('td', { text: w.dsnKey }),
        h('td', { text: w.key ?? '—' }),
        h('td', { text: show(w.value) }),
        h('td', {}, [verdict(w.status)]),
      ]),
    );
  return section('world', 'World', [
    rows.length ? h('table', {}, [h('tbody', {}, rows)]) : h('p', { class: 'dicer-hint', text: loc(`${P}.NoWorld`) }),
  ]);
}

function usersSection(r) {
  const shown = r.users.filter((u) => u.status !== 'none');
  const none = r.users.length - shown.length;
  const rows = shown.map((u) =>
    h('details', { 'data-user': u.id, open: u.status === 'pending' }, [
      h('summary', {}, [h('span', { class: 'dicer-report-name', text: u.name }), h('span', { class: `dicer-verdict is-${u.status}`, text: loc(`${P}.User.${u.status}`) })]),
      h('ul', {}, u.scopes.map((s) => h('li', { 'data-scope': s.scope }, [h('span', { text: s.scope }), verdict(s.status)]))),
    ]),
  );
  return section('users', 'Users', [
    ...rows,
    ...(none ? [h('p', { class: 'dicer-hint', text: `${loc(`${P}.NoneUsers`)}: ${none}` })] : []),
  ]);
}

function unmigratedSection(r) {
  const items = r.users
    .filter((u) => u.saves > 0 || u.otherKeys.length)
    .map((u) => {
      const parts = [];
      if (u.saves > 0) parts.push(fmt(`${P}.Saves`, { n: u.saves, m: u.savesImported ?? 0 }));
      if (u.otherKeys.length) parts.push(u.otherKeys.join(', '));
      return h('li', {}, [h('span', { class: 'dicer-report-name', text: u.name }), h('small', { text: parts.join(' · ') })]);
    });
  return items.length ? section('unmigrated', 'Unmigrated', [h('ul', {}, items)]) : null;
}

/** The report as DOM: the empty state, or the four sections (the last only when it lists something). */
export function renderReport(report) {
  const root = h('div', { class: 'dicer-dsn-report' }, [h('style', { text: CSS })]);
  if (!report.hasData) {
    root.append(h('p', { class: 'dicer-empty', text: loc(`${P}.None`) }));
    return root;
  }
  // the GM imports every player at once, rather than waiting for each to log in
  const all = h('div', { class: 'dicer-report-import' }, [
    h('button', { type: 'button', 'data-act': 'import-all' }, [h('i', { class: 'fa-solid fa-file-import', 'aria-hidden': 'true' }), ` ${loc(`${P}.ImportAll`)}`]),
    h('p', { class: 'dicer-hint', text: loc(`${P}.ImportAllHint`) }),
  ]);
  root.append(all, statusSection(report), worldSection(report), usersSection(report));
  const rest = unmigratedSection(report);
  if (rest) root.append(rest);
  return root;
}

// its own look, here in the lazy chunk (not in dicer.css, which every world start loads)
const CSS =
  '.dicer-dsn-report section{margin-bottom:.8em}' +
  '.dicer-report-import{margin-bottom:.8em}' +
  '.dicer-report-import button{width:100%}' +
  '.dicer-dsn-report h3{margin:.4em 0}' +
  '.dicer-dsn-report dl{display:grid;grid-template-columns:auto 1fr;gap:.2em .8em;margin:0}' +
  '.dicer-dsn-report dd{margin:0}' +
  '.dicer-dsn-report table{width:100%;border-collapse:collapse}' +
  '.dicer-dsn-report td{padding:.2em .4em;border-bottom:1px solid var(--color-border-light-tertiary,rgba(127,127,127,.25))}' +
  '.dicer-dsn-report ul{list-style:none;margin:.3em 0;padding:0 0 0 1em}' +
  '.dicer-dsn-report li,.dicer-dsn-report summary{display:flex;gap:.6em;align-items:baseline}' +
  '.dicer-dsn-report summary{cursor:pointer}' +
  '.dicer-dsn-report li small{opacity:.8}' +
  '.dicer-dsn-report .dicer-report-name{flex:1}' +
  '.dicer-verdict{font-size:.85em;padding:0 .4em;border-radius:3px;background:rgba(127,127,127,.18)}' +
  '.dicer-verdict.is-copied,.dicer-verdict.is-migrated{background:rgba(60,160,80,.25)}' +
  '.dicer-verdict.is-pending,.dicer-verdict.is-would-copy{background:rgba(220,170,40,.25)}' +
  '.dicer-verdict.is-invalid,.dicer-verdict.is-unusable,.dicer-verdict.is-no-counterpart{background:rgba(200,60,60,.22)}';

let app = null;

/** Opens (or refreshes) the window; GM only. */
export function openDsnReport() {
  const game = globalThis.game;
  if (!game?.user?.isGM) return null;
  const { ApplicationV2 } = globalThis.foundry.applications.api;
  class DsnReport extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: 'dicer-dsn-report',
      classes: ['dicer-dsn-report-app'],
      window: { title: `${P}.Title`, icon: 'fa-solid fa-clipboard-list', resizable: true },
      position: { width: 560, height: 'auto' },
    };
    async _renderHTML() {
      return renderReport(
        buildReport({
          users: game.users ?? [],
          world: worldSettingsReader(game.settings.storage?.get('world') ?? null),
          getSetting: (key) => game.settings.get('dicer', key),
          isCustomized: storedWorldValue,
          dsnModule: game.modules?.get('dice-so-nice'),
        }),
      );
    }
    _replaceHTML(result, content) {
      content.replaceChildren(result);
      result.querySelector('[data-act="import-all"]')?.addEventListener('click', (event) => this.#importAll(event.currentTarget));
    }
    /** Every player's Dice So Nice data at once (GM): then the report shows what it did. */
    async #importAll(button) {
      button.disabled = true;
      try {
        const out = await migrateAll({
          users: [...(game.users ?? [])],
          registry: game.dice3d?._registry,
          worldSettings: worldSettingsReader(game.settings.storage?.get('world') ?? null),
          settings: game.settings,
        });
        globalThis.ui?.notifications?.info(fmt(`${P}.ImportAllDone`, { users: out.users, themes: out.themes }));
      } catch (err) {
        console.warn('dicer: the Dice So Nice import failed', err);
        globalThis.ui?.notifications?.warn(loc(`${P}.ImportAllFailed`));
      }
      this.render();
    }
  }
  if (!app?.rendered) app = new DsnReport();
  return app.render({ force: true });
}
