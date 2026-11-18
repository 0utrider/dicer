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
  h('section', { 'data-section': id }, [h('h3', { class: 'dicer-report-h', text: loc(`${P}.Section.${heading}`) }), ...kids]);
const yesNo = (v) => loc(`${P}.${v ? 'Yes' : 'No'}`);
const show = (v) => (v === undefined ? '' : JSON.stringify(v));

function statusSection(r) {
  // three tiles; the import switched off is flagged, since players then import nothing on their own
  const tile = (field, value, tone) =>
    h('div', { class: `dicer-report-tile${tone ? ` is-${tone}` : ''}` }, [
      h('span', { class: 'dicer-report-label', text: loc(`${P}.Field.${field}`) }),
      h('strong', { text: value }),
    ]);
  return section('status', 'Status', [
    h('div', { class: 'dicer-report-tiles' }, [
      tile('Enabled', yesNo(r.enabled), r.enabled ? 'ok' : 'warn'),
      tile('WorldMigrated', yesNo(r.worldMigrated), r.worldMigrated ? 'ok' : null),
      tile('Dsn', loc(`${P}.Dsn.${r.dsn}`), null),
    ]),
  ]);
}

function worldSection(r) {
  const rows = r.world
    .filter((w) => w.status !== 'absent')
    .map((w) =>
      h('tr', { 'data-key': w.dsnKey }, [
        h('td', {}, [h('code', { text: w.dsnKey })]),
        h('td', {}, w.key ? [h('code', { text: w.key })] : [h('span', { class: 'dicer-report-muted', text: '—' })]),
        h('td', { class: 'dicer-report-value', text: show(w.value) }),
        h('td', { class: 'dicer-report-result' }, [verdict(w.status)]),
      ]),
    );
  const head = h('thead', {}, [
    h('tr', {}, ['Dsn', 'Dicer', 'Value', 'Result'].map((c) => h('th', { scope: 'col', text: loc(`${P}.Col.${c}`) }))),
  ]);
  return section('world', 'World', [
    rows.length ? h('table', { class: 'dicer-report-table' }, [head, h('tbody', {}, rows)]) : h('p', { class: 'dicer-hint', text: loc(`${P}.NoWorld`) }),
  ]);
}

function usersSection(r) {
  const shown = r.users.filter((u) => u.status !== 'none');
  const none = r.users.length - shown.length;
  const rows = shown.map((u) =>
    h('details', { class: 'dicer-report-row', 'data-user': u.id, open: u.status === 'pending' }, [
      h('summary', {}, [h('span', { class: 'dicer-report-name', text: u.name }), h('span', { class: `dicer-verdict is-${u.status}`, text: loc(`${P}.User.${u.status}`) })]),
      h('ul', {}, u.scopes.map((s) => h('li', { 'data-scope': s.scope }, [h('code', { text: s.scope }), verdict(s.status)]))),
    ]),
  );
  return section('users', 'Users', [
    h('div', { class: 'dicer-report-list' }, rows),
    ...(none ? [h('p', { class: 'dicer-hint', text: `${loc(`${P}.NoneUsers`)}: ${none}` })] : []),
  ]);
}

function unmigratedSection(r) {
  const items = r.users
    .filter((u) => u.saves > 0 || u.otherKeys.length)
    .map((u) =>
      h('li', { class: 'dicer-report-row' }, [
        h('span', { class: 'dicer-report-name', text: u.name }),
        h('span', { class: 'dicer-report-data' }, [
          ...(u.saves > 0 ? [h('span', { class: 'dicer-verdict is-copied', text: fmt(`${P}.Saves`, { n: u.saves, m: u.savesImported ?? 0 }) })] : []),
          ...u.otherKeys.map((k) => h('code', { text: k })),
        ]),
      ]),
    );
  return items.length
    ? section('unmigrated', 'Unmigrated', [h('p', { class: 'dicer-hint', text: loc(`${P}.UnmigratedHint`) }), h('ul', { class: 'dicer-report-list' }, items)])
    : null;
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

// its own look, here in the lazy chunk (not in dicer.css, which every world start loads); sizes are
// set here, so a system's big headings and body text (PF2e) do not blow the report up
const CSS = `
#dicer-dsn-report .window-content{overflow-y:auto}
.dicer-dsn-report{font-size:var(--font-size-13,13px);line-height:1.4;display:flex;flex-direction:column;gap:14px}
.dicer-dsn-report section{margin:0}
.dicer-dsn-report .dicer-report-h{margin:0 0 6px;padding:0 0 4px;border:0;border-bottom:1px solid var(--color-border-light-tertiary,rgba(127,127,127,.3));font-family:inherit;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.75}
.dicer-dsn-report .dicer-hint{margin:6px 0 0;font-size:12px;opacity:.7}
.dicer-dsn-report code{font-size:11.5px;padding:0 4px;border-radius:3px;background:rgba(127,127,127,.15);border:0;white-space:nowrap}
.dicer-report-import{padding:10px;border-radius:6px;background:rgba(127,127,127,.1);border:1px solid var(--color-border-light-tertiary,rgba(127,127,127,.25))}
.dicer-report-import button{width:100%;height:auto;min-height:32px;font-size:13px;font-weight:600;line-height:1.2}
.dicer-report-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:6px}
.dicer-report-tile{display:flex;flex-direction:column;gap:2px;padding:6px 8px;border-radius:5px;background:rgba(127,127,127,.1);border-left:3px solid rgba(127,127,127,.35)}
.dicer-report-tile.is-ok{border-left-color:rgba(70,170,90,.8)}
.dicer-report-tile.is-warn{border-left-color:rgba(225,160,40,.9);background:rgba(225,160,40,.12)}
.dicer-report-label{font-size:11px;opacity:.7}
.dicer-report-tile strong{font-size:13px}
.dicer-report-table{width:100%;margin:0;border-collapse:collapse;font-size:12px;background:none;border:0}
.dicer-report-table th{padding:2px 6px;text-align:left;font-size:11px;font-weight:600;opacity:.65;background:none;border:0;border-bottom:1px solid var(--color-border-light-tertiary,rgba(127,127,127,.3))}
.dicer-report-table td{padding:4px 6px;border:0;border-bottom:1px solid var(--color-border-light-tertiary,rgba(127,127,127,.18));vertical-align:middle}
.dicer-report-table tr:nth-child(even) td{background:none}
.dicer-report-table code{white-space:normal;overflow-wrap:anywhere}
.dicer-report-value{font-family:var(--font-mono,monospace);font-size:11.5px}
.dicer-report-result{text-align:right}
.dicer-report-muted{opacity:.5}
.dicer-report-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:3px}
.dicer-report-row{padding:4px 8px;border-radius:4px;background:rgba(127,127,127,.08)}
li.dicer-report-row,.dicer-report-row>summary{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center}
.dicer-report-row>summary{cursor:pointer;list-style:none}
.dicer-report-row>summary::-webkit-details-marker{display:none}
.dicer-report-row>summary::before{content:'\\25B8';font-size:10px;opacity:.6;transition:transform .15s}
.dicer-report-row[open]>summary::before{transform:rotate(90deg)}
.dicer-report-row ul{list-style:none;margin:4px 0 2px 16px;padding:0;display:flex;flex-direction:column;gap:2px}
.dicer-report-row li{display:flex;gap:8px;align-items:center;justify-content:space-between;font-size:12px}
.dicer-report-name{flex:1;font-weight:600}
.dicer-report-data{display:flex;flex-wrap:wrap;gap:4px;justify-content:flex-end}
.dicer-verdict{display:inline-block;font-size:11px;font-weight:600;line-height:1.5;padding:0 7px;border-radius:999px;white-space:nowrap;background:rgba(127,127,127,.2)}
.dicer-verdict.is-copied,.dicer-verdict.is-migrated{background:rgba(70,170,90,.28)}
.dicer-verdict.is-pending,.dicer-verdict.is-would-copy{background:rgba(225,170,40,.3)}
.dicer-verdict.is-dicer,.dicer-verdict.is-would-keep{background:rgba(90,140,220,.28)}
.dicer-verdict.is-invalid,.dicer-verdict.is-unusable,.dicer-verdict.is-no-counterpart,.dicer-verdict.is-off{background:rgba(200,70,70,.26)}
`;

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
      // a set height (it fits the screen, and resizes): the report scrolls inside it
      position: { width: 560, height: Math.min(720, Math.round((globalThis.innerHeight || 800) * 0.85)) },
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
        const nothing = !out.users && !out.themes && !out.world; // everyone already up to date
        globalThis.ui?.notifications?.info(nothing ? loc(`${P}.ImportAllNothing`) : fmt(`${P}.ImportAllDone`, { users: out.users, themes: out.themes }));
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
