/**
 * The theme browser (lazy chunk, opened from the `dicer.themeBrowser` settings menu): a gallery
 * of built-in, world and the user's own themes with live thumbnails, "use" assignment (default,
 * die type, roll role, owned actor, damage type), duplicate + a simple edit form, export / import
 * files and the GM's publish. The pure logic is in ./theme-form.js; the data actions below
 * (assign, clear, save, import, export, publish) are exported so they can be tested without a DOM.
 */
import { LOOKS } from '../look/looks.js';
import { RESULT_SOUNDS } from '../audio/sound-names.js';
import { DIE_TYPES, SOUND_MATERIALS, KNOWN_EFFECTS } from '../themes/themes.js';
import { createThumbnailer } from '../themes/thumbnailer.js';
import { damageTypeList } from './damage-map-form.js';
import {
  ROLL_ROLES,
  KEEP,
  roleSlot,
  slotPatch,
  assignDamage,
  galleryEntries,
  upsertTheme,
  removeTheme,
  duplicateTheme,
  publishToWorld,
  exportJson,
  importThemes,
  slugify,
  formFromTheme,
  themeFromForm,
  mergeEdited,
} from './theme-form.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const MODULE = 'dicer';
const FLAG = 'appearance';
const loc = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;
const notify = (kind, message) => globalThis.ui?.notifications?.[kind]?.(message);
const escapeHtml = (v) =>
  String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const humanize = (id) => {
  const s = String(id).replace(/[-_]+/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const SOURCE_LABEL = {
  builtin: 'DICER.Themes.Source.builtin',
  world: 'DICER.Themes.Source.world',
  user: 'DICER.Themes.Source.user',
};
const FILTER_KEYS = { all: 'DICER.Themes.Filter_all', builtin: 'DICER.Themes.Source.builtin', world: 'DICER.Themes.Source.world', user: 'DICER.Themes.Source.user' };
const ROLE_LABEL = {
  attack: 'DICER.Themes.Role.attack',
  damage: 'DICER.Themes.Role.damage',
  save: 'DICER.Themes.Role.save',
  skill: 'DICER.Themes.Role.skill',
  initiative: 'DICER.Themes.Role.initiative',
  check: 'DICER.Themes.Role.check',
};

const me = () => globalThis.game?.user;
const settings = () => globalThis.game?.settings;

// --- data actions ---------------------------------------------------------------------------
/** 'default' | 'die:d20' | 'role:attack' | 'actor:<id>' | 'damage:fire' | 'worlddamage:fire' -> {kind, key}. */
export function parseTarget(value) {
  const s = String(value ?? '');
  if (s === 'default') return { kind: 'default', key: '' };
  const i = s.indexOf(':');
  if (i < 0) return null;
  const kind = s.slice(0, i);
  const key = s.slice(i + 1);
  return ['die', 'role', 'actor', 'damage', 'worlddamage'].includes(kind) && key ? { kind, key } : null;
}

/**
 * Sets (themeId) or clears (null) one place a theme is used. A player's choices go to their own
 * flag / settings; the world damage map needs a GM.
 * @returns {Promise<boolean>} false when the target is not allowed or not found
 */
export async function assignTarget(target, themeId) {
  const t = typeof target === 'string' ? parseTarget(target) : target;
  const user = me();
  if (!t || !user) return false;
  const id = typeof themeId === 'string' && themeId ? themeId : null;
  switch (t.kind) {
    case 'default':
      // The setting mirrors into the user flag (onLookChange); clearing means the default theme.
      await settings().set(MODULE, 'theme', id ?? 'default');
      return true;
    case 'die':
      if (!DIE_TYPES.includes(t.key)) return false;
      await user.setFlag(MODULE, FLAG, slotPatch(t.key, id));
      return true;
    case 'role':
      if (!ROLL_ROLES.includes(t.key)) return false;
      await user.setFlag(MODULE, FLAG, slotPatch(roleSlot(t.key), id));
      return true;
    case 'actor': {
      const actor = globalThis.game?.actors?.get?.(t.key);
      if (!actor || actor.isOwner !== true) return false;
      await actor.setFlag(MODULE, FLAG, slotPatch('global', id));
      return true;
    }
    case 'damage':
      return writeDamageMap('damageThemeOverrides', t.key, id);
    case 'worlddamage':
      if (!user.isGM) return false;
      return writeDamageMap('damageTypeMap', t.key, id);
    default:
      return false;
  }
}

export const clearTarget = (target) => assignTarget(target, null);

// Stored data of the wrong shape is never overwritten: the write is refused and warned once.
const warnedShapes = new Set();
const refuse = (what) => {
  if (!warnedShapes.has(what)) {
    warnedShapes.add(what);
    notify('warn', `${loc('DICER.Themes.StoredUnusable')} (${what})`);
  }
  return null;
};
/** The stored list; [] when never set; null (refused, warned once) when it is not an array. */
const listOf = (v, what) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : refuse(what));
const userList = () => listOf(me()?.getFlag?.(MODULE, 'themes'), 'themes');
const worldList = () => listOf(settings()?.get(MODULE, 'worldThemes'), 'worldThemes');
const saveUserList = (list) => me().setFlag(MODULE, 'themes', list);
const saveWorldList = (list) => settings().set(MODULE, 'worldThemes', list);

async function writeDamageMap(setting, type, id) {
  const next = assignDamage(settings().get(MODULE, setting), type, id);
  if (next === null) {
    refuse(setting);
    return false;
  }
  await settings().set(MODULE, setting, next);
  return true;
}

/** Saves one raw theme into My themes (replacing the entry of the same id); all other entries are kept. False when refused. */
export async function saveMine(raw) {
  const list = userList();
  if (!list) return false;
  await saveUserList(upsertTheme(list, raw));
  return true;
}

/** Removes one of My themes (only that entry; unreadable entries stay). False when refused. */
export async function deleteMine(id) {
  const list = userList();
  if (!list) return false;
  await saveUserList(removeTheme(list, id));
  return true;
}

/** GM only: removes a world theme. */
export async function deleteWorld(id) {
  if (!me()?.isGM) return false;
  const list = worldList();
  if (!list) return false;
  await saveWorldList(removeTheme(list, id));
  return true;
}

/** GM only: copies the theme into the world themes. */
export function publish(theme) {
  const isGM = Boolean(me()?.isGM);
  const list = isGM ? worldList() : [];
  if (!list) return Promise.resolve({ ok: false, reason: 'unreadable' });
  return publishToWorld(theme, { isGM, worldList: list, setWorld: saveWorldList });
}

/** A copy of the theme in My themes; returns the new raw theme (null when refused). */
export async function duplicate(theme) {
  const list = userList();
  if (!list) return null;
  const copy = duplicateTheme(theme, me().id, list, loc('DICER.Themes.Copy'));
  await saveMine(copy);
  return copy;
}

/** Writes one theme, or all of My themes, to a .json file. */
export function exportToFile(themes, filename) {
  foundry.utils.saveDataToFile(exportJson(themes), 'application/json', filename);
}

/**
 * Imports a theme file into My themes. Warnings (themes that did not validate, odd values) are
 * returned and shown in one notification.
 */
export async function importFromText(text) {
  const existing = userList();
  if (!existing) return { themes: [], warnings: [] };
  const { themes, warnings } = importThemes(text, me().id, {
    existingIds: existing.map((t) => t?.id).filter(Boolean),
  });
  let list = existing;
  for (const t of themes) list = upsertTheme(list, t);
  if (themes.length) await saveUserList(list);
  const summary = `${loc('DICER.Themes.Imported')} ${themes.length}`;
  if (warnings.length) notify('warn', `${summary}. ${warnings.join(' ')}`);
  else notify('info', summary);
  return { themes, warnings };
}

// --- view model -------------------------------------------------------------------------------
const label = (raw) => (raw && typeof raw === 'object' && (raw.name || raw.id)) || '?';

/** The target select's groups: default, die types, roll roles, owned actors, damage types. */
export function targetGroups({ actors = [], damageTypes = [], isGM = false } = {}) {
  const groups = [
    { label: loc('DICER.Themes.Group.default'), options: [{ value: 'default', label: loc('DICER.Themes.MyDefault') }] },
    { label: loc('DICER.Themes.Group.die'), options: DIE_TYPES.map((t) => ({ value: `die:${t}`, label: t })) },
    { label: loc('DICER.Themes.Group.role'), options: ROLL_ROLES.map((r) => ({ value: `role:${r}`, label: loc(ROLE_LABEL[r]) })) },
  ];
  if (actors.length)
    groups.push({ label: loc('DICER.Themes.Group.actor'), options: actors.map((a) => ({ value: `actor:${a.id}`, label: a.name })) });
  groups.push({
    label: loc('DICER.Themes.Group.damage'),
    options: damageTypes.map((t) => ({ value: `damage:${t}`, label: humanize(t) })),
  });
  if (isGM)
    groups.push({
      label: loc('DICER.Themes.Group.worldDamage'),
      options: damageTypes.map((t) => ({ value: `worlddamage:${t}`, label: humanize(t) })),
    });
  return groups;
}

const choiceMap = (ids, nameOf, none, keep) => ({
  ...(none === undefined ? {} : { '': none }),
  ...(keep ? { [KEEP]: keep } : {}),
  ...Object.fromEntries(ids.map((id) => [id, nameOf(id)])),
});

let instance = null;

export class ThemeBrowser extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: 'dicer-theme-browser',
    tag: 'div',
    classes: ['dicer-theme-browser'],
    window: { title: 'DICER.Themes.Title', icon: 'fa-solid fa-dice-d20', resizable: true },
    position: { width: 820, height: 640 },
    actions: {
      useDefault: ThemeBrowser.#onUseDefault,
      apply: ThemeBrowser.#onApply,
      clear: ThemeBrowser.#onClear,
      duplicate: ThemeBrowser.#onDuplicate,
      edit: ThemeBrowser.#onEdit,
      saveEdit: ThemeBrowser.#onSaveEdit,
      cancelEdit: ThemeBrowser.#onCancelEdit,
      exportOne: ThemeBrowser.#onExportOne,
      exportMine: ThemeBrowser.#onExportMine,
      importThemes: ThemeBrowser.#onImport,
      publish: ThemeBrowser.#onPublish,
      remove: ThemeBrowser.#onRemove,
    },
  };

  static PARTS = {
    body: { template: 'modules/dicer/templates/theme-browser.hbs', scrollable: ['.dicer-theme-grid'] },
  };

  #filter = 'all';
  #editing = null; // { base: theme (raw, stored), form }
  #thumbs = null;
  #token = 0;

  get #isGM() {
    return Boolean(me()?.isGM);
  }

  #entries() {
    return galleryEntries({ worldList: worldList(), userList: userList(), warn: () => {} });
  }

  #find(id) {
    return this.#entries().themes.find((t) => t.id === id) ?? null;
  }

  #actors() {
    const list = globalThis.game?.actors;
    const all = list ? [...list] : [];
    return all
      .filter((a) => a?.isOwner === true)
      .map((a) => ({ id: a.id, name: String(a.name ?? a.id) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async _prepareContext() {
    if (this.#editing) return this.#editContext();
    const { themes, unreadable } = this.#entries();
    const filter = Object.hasOwn(FILTER_KEYS, this.#filter) ? this.#filter : 'all';
    const isGM = this.#isGM;
    const groups = targetGroups({
      actors: this.#actors(),
      damageTypes: damageTypeList({ systemId: globalThis.game?.system?.id }),
      isGM,
    });
    return {
      editing: false,
      filter,
      filterChoices: Object.fromEntries(Object.entries(FILTER_KEYS).map(([k, v]) => [k, loc(v)])),
      targetGroups: groups,
      cards: themes
        .filter((t) => filter === 'all' || t.source === filter)
        .map((t) => ({
          id: t.id,
          name: t.name,
          source: t.source,
          sourceLabel: loc(SOURCE_LABEL[t.source] ?? SOURCE_LABEL.user),
          swatch: t.appearance?.body?.color ?? '#444',
          canEdit: t.source === 'user',
          canPublish: isGM && t.source !== 'world',
          canDelete: t.source === 'user' || (t.source === 'world' && isGM),
        })),
      unreadable: unreadable.map((u) => ({ label: label(u.raw), sourceLabel: loc(SOURCE_LABEL[u.source]) })),
    };
  }

  #editContext() {
    const { form } = this.#editing;
    const looks = Object.keys(LOOKS);
    const lookName = (id) => LOOKS[id].name;
    const keep = loc('DICER.Themes.KeepCustom');
    const needKeep = (v) => v === KEEP;
    const withKeep = (map, v) => (needKeep(v) && !(KEEP in map) ? { ...map, [KEEP]: keep } : map);
    return {
      editing: true,
      edit: form,
      lookChoices: withKeep(choiceMap(looks, lookName), form.base),
      materialChoices: choiceMap(SOUND_MATERIALS, humanize, loc('DICER.Themes.None')),
      perTypeChoices: choiceMap(looks, lookName, loc('DICER.Themes.SameAsBase'), keep),
      effectChoices: choiceMap(KNOWN_EFFECTS, humanize, loc('DICER.Themes.None'), keep),
      soundChoices: choiceMap(RESULT_SOUNDS, humanize, loc('DICER.Themes.None'), keep),
      dieRows: DIE_TYPES.map((type) => ({ type, label: type, value: form.perType[type] })),
      celebrations: [
        { key: 'nat20', label: loc('DICER.Themes.NatHigh'), ...form.nat20 },
        { key: 'nat1', label: loc('DICER.Themes.NatLow'), ...form.nat1 },
      ],
    };
  }

  /** Thumbnails: one theme at a time through the offscreen renderer; the swatch stays until one arrives. */
  _onRender() {
    this.element.querySelector('.dicer-theme-filter')?.addEventListener('change', (e) => {
      this.#filter = e.target.value;
      this.render();
    });
    const file = this.element.querySelector('.dicer-theme-file');
    file?.addEventListener('change', async () => {
      const f = file.files?.[0];
      file.value = '';
      if (!f) return;
      try {
        await importFromText(await foundry.utils.readTextFromFile(f));
      } catch (err) {
        notify('error', `${loc('DICER.Themes.ImportFailed')} ${err?.message ?? err}`);
      }
      this.render();
    });
    this.#loadThumbnails();
  }

  async #loadThumbnails() {
    const token = ++this.#token;
    const cards = [...this.element.querySelectorAll('.dicer-theme-card')];
    if (!cards.length) return;
    if (!this.#thumbs) {
      let atlas = null;
      try {
        atlas = globalThis.game?.dice3d?._themeContext?.()?.atlas ?? null;
      } catch {
        atlas = null;
      }
      if (!atlas) return;
      this.#thumbs = createThumbnailer({ atlas, size: 256 });
    }
    const thumbs = this.#thumbs;
    const themes = new Map(this.#entries().themes.map((t) => [t.id, t]));
    for (const card of cards) {
      const theme = themes.get(card.dataset.theme);
      if (!theme) continue;
      const url = await thumbs.thumbnail(theme, 'd20').catch(() => null);
      if (token !== this.#token || this.#thumbs !== thumbs) return;
      const img = card.querySelector('.dicer-thumb');
      if (url && img) {
        img.src = url;
        img.hidden = false;
      }
    }
  }

  static #themeOf(app, target) {
    return app.#find(target.dataset.theme);
  }

  static #targetOf(target) {
    return target.closest('.dicer-theme-card')?.querySelector('.dicer-target')?.value;
  }

  static async #onUseDefault(event, target) {
    if (await assignTarget('default', target.dataset.theme)) notify('info', loc('DICER.Themes.Applied'));
  }

  static async #onApply(event, target) {
    const ok = await assignTarget(ThemeBrowser.#targetOf(target), target.dataset.theme);
    notify(ok ? 'info' : 'warn', loc(ok ? 'DICER.Themes.Applied' : 'DICER.Themes.NotAllowed'));
  }

  static async #onClear(event, target) {
    const ok = await clearTarget(ThemeBrowser.#targetOf(target));
    notify(ok ? 'info' : 'warn', loc(ok ? 'DICER.Themes.Cleared' : 'DICER.Themes.NotAllowed'));
  }

  static async #onDuplicate(event, target) {
    const theme = ThemeBrowser.#themeOf(this, target);
    if (!theme) return;
    await duplicate(theme);
    this.#filter = 'user';
    await this.render();
  }

  static async #onEdit(event, target) {
    const theme = ThemeBrowser.#themeOf(this, target);
    if (!theme || theme.source !== 'user') return;
    this.#editing = { base: theme, form: formFromTheme(theme) };
    await this.render();
  }

  static async #onSaveEdit() {
    if (!this.#editing) return;
    const form = this.element.querySelector('.dicer-theme-edit');
    const data = foundry.utils.expandObject(new foundry.applications.ux.FormDataExtended(form).object);
    const stored = userList().find((t) => t && t.id === this.#editing.base.id);
    await saveMine(mergeEdited(stored, themeFromForm(data, this.#editing.base)));
    this.#editing = null;
    notify('info', loc('DICER.Themes.Saved'));
    await this.render();
  }

  static async #onCancelEdit() {
    this.#editing = null;
    await this.render();
  }

  static #onExportOne(event, target) {
    const theme = ThemeBrowser.#themeOf(this, target);
    if (theme) exportToFile([theme], `dicer-theme-${slugify(theme.name)}.json`);
  }

  static #onExportMine() {
    const mine = this.#entries().themes.filter((t) => t.source === 'user');
    if (!mine.length) return notify('warn', loc('DICER.Themes.NothingToExport'));
    exportToFile(mine, 'dicer-themes.json');
  }

  static #onImport() {
    this.element.querySelector('.dicer-theme-file')?.click();
  }

  static async #onPublish(event, target) {
    const theme = ThemeBrowser.#themeOf(this, target);
    if (!theme) return;
    const res = await publish(theme);
    notify(res.ok ? 'info' : 'warn', loc(res.ok ? 'DICER.Themes.Published' : 'DICER.Themes.NotAllowed'));
    if (res.ok) await this.render();
  }

  static async #onRemove(event, target) {
    const theme = ThemeBrowser.#themeOf(this, target);
    if (!theme) return;
    const sure = await foundry.applications.api.DialogV2.confirm({
      window: { title: loc('DICER.Themes.Delete') },
      content: `<p>${loc('DICER.Themes.ConfirmDelete')} ${escapeHtml(theme.name)}</p>`,
    });
    if (!sure) return;
    if (theme.source === 'user') await deleteMine(theme.id);
    else if (theme.source === 'world' && !(await deleteWorld(theme.id))) return notify('warn', loc('DICER.Themes.NotAllowed'));
    await this.render();
  }

  async close(options) {
    if (instance === this) instance = null;
    this.#token++;
    this.#thumbs?.dispose();
    this.#thumbs = null;
    return super.close(options);
  }
}

/** Opens (or brings to front) the browser: what the settings menu's proxy class calls. */
export function openThemeBrowser() {
  instance ??= new ThemeBrowser();
  return instance.render({ force: true });
}
