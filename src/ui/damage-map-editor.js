/**
 * The damage map editor (lazy chunk, opened from the `dicer.damageMap` settings menu).
 * One row per damage type: the GM's world choice (built-in theme / DSN colorset / default) and
 * the user's own override (default / theme / colorset / none), a custom landing sound (world) and
 * a Preview button. All form <-> settings logic is in ./damage-map-form.js.
 */
import { DAMAGE_THEMES } from '../effects/damage-themes.js';
import { BUILTIN_COLORSETS } from '../compat/colorset-map.js';
import { ADDON_THEMES } from '../themes/themes.js';
import { STUBS } from '../api/addon-registry.js';
import { DND5E_TYPES, PF2E_TYPES } from '../effects/roll-context.js';
import { isLanding } from '../effects/rules.js';
import {
  DEFAULT_CHOICE,
  damageTypeList,
  formFromMap,
  mapFromForm,
  previewSpec,
  saveMaps,
} from './damage-map-form.js';

export { formFromMap, mapFromForm, saveMaps, damageTypeList, previewSpec };

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const MODULE = 'dicer';
const loc = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;
const humanize = (id) => {
  const s = String(id).replace(/[-_]+/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** What the registry offers (DSN colorsets and damage defaults, a theme resolver), if the engine runs. */
function registryContext() {
  const none = { colorsets: [], damageTypeDefaults: {}, resolveTheme: null };
  try {
    return globalThis.game?.dice3d?._damageContext?.() ?? none;
  } catch {
    return none;
  }
}

/**
 * Choice maps ({value: label}) for the selects. A colorset sharing a theme's id is left out:
 * the resolver gives the theme precedence, so choosing it would be ambiguous.
 */
export function buildChoices(ctx) {
  const themes = Object.fromEntries(
    Object.keys(DAMAGE_THEMES).map((id) => [id, `${loc('DICER.DamageMap.Theme')}: ${humanize(id)}`]),
  );
  const colorsets = {};
  for (const name of [...Object.keys(BUILTIN_COLORSETS), ...(ctx.colorsets ?? [])])
    if (!(name in themes) && !(name in colorsets))
      colorsets[name] = `${loc('DICER.DamageMap.Colorset')}: ${name}`;
  const base = { [DEFAULT_CHOICE]: loc('DICER.DamageMap.Default') };
  return {
    world: { ...base, ...themes, ...colorsets },
    user: { ...base, none: loc('DICER.DamageMap.None'), ...themes, ...colorsets },
  };
}

/**
 * The dropdown's options as groups: `choices` ({value: label}) with the add-on themes
 * (api.registerTheme) added. Themes with category "damage" form a group right after the base
 * entries (Default, None), the built-in themes and colorsets follow, then one group per module
 * (labelled with its title). A `current` value that no group holds is kept, shown as its id.
 * Group `label: null` renders without an <optgroup>.
 */
export function choiceGroups(choices, current, { themes = [...ADDON_THEMES.values(), ...STUBS.values()], titleOf = (id) => id } = {}) {
  const taken = new Set(Object.keys(choices));
  const own = themes.filter((t) => t && typeof t.id === 'string' && !taken.has(t.id));
  const opt = (value, label) => ({ value, label, selected: value === current });
  const entries = Object.entries(choices);
  const baseKeys = new Set([DEFAULT_CHOICE, 'none']);
  const groups = [{ label: null, options: entries.filter(([k]) => baseKeys.has(k)).map(([k, l]) => opt(k, l)) }];
  const damage = own.filter((t) => t.category === 'damage');
  if (damage.length) groups.push({ label: loc('DICER.DamageMap.GroupDamageThemes'), options: damage.map((t) => opt(t.id, t.name)) });
  groups.push({ label: null, options: entries.filter(([k]) => !baseKeys.has(k)).map(([k, l]) => opt(k, l)) });
  const byModule = new Map();
  for (const t of own) if (t.category !== 'damage') (byModule.get(t.moduleId) ?? byModule.set(t.moduleId, []).get(t.moduleId)).push(t);
  for (const [id, list] of byModule) groups.push({ label: titleOf(id), options: list.map((t) => opt(t.id, t.name)) });
  const shown = groups.filter((g) => g.options.length);
  if (current && !shown.some((g) => g.options.some((o) => o.selected))) (shown[0] ?? groups[0]).options.push(opt(current, String(current)));
  return shown;
}

const moduleTitle = (id) => globalThis.game?.modules?.get?.(id)?.title ?? id;

const basename = (path) => String(path ?? '').split(/[\\/]/).pop();

/** The active system's own damage types (listed first, under their own heading), or none. */
export function systemTypes(systemId) {
  if (systemId === 'pf2e') return PF2E_TYPES;
  if (systemId === 'dnd5e') return DND5E_TYPES;
  return [];
}

let instance = null;

export class DamageMapEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: 'dicer-damage-map-editor',
    tag: 'form',
    classes: ['dicer-damage-map-editor'],
    window: { title: 'DICER.DamageMap.Title', icon: 'fa-solid fa-fire', resizable: true },
    position: { width: 860, height: 640 },
    form: {
      handler: DamageMapEditor.#onSubmit,
      submitOnChange: false,
      closeOnSubmit: false,
    },
    actions: {
      preview: DamageMapEditor.#onPreview,
      pickFile: DamageMapEditor.#onPickFile,
      clearFile: DamageMapEditor.#onClearFile,
    },
  };

  static PARTS = {
    form: {
      template: 'modules/dicer/templates/damage-map-editor.hbs',
      scrollable: ['.dicer-dm-scroll'],
    },
  };

  #draft = null; // Row[]
  #rest = null; // stored entries the form cannot represent, written back untouched
  #ctx = null;

  get #isGM() {
    return Boolean(globalThis.game?.user?.isGM);
  }

  #load() {
    if (this.#draft) return;
    this.#ctx = registryContext();
    const settings = globalThis.game.settings;
    const types = damageTypeList({
      systemId: globalThis.game.system?.id,
      extra: Object.keys(this.#ctx.damageTypeDefaults ?? {}),
    });
    const form = formFromMap(
      {
        worldMap: settings.get(MODULE, 'damageTypeMap'),
        overrides: settings.get(MODULE, 'damageThemeOverrides'),
        sounds: settings.get(MODULE, 'damageTypeSounds'),
      },
      types,
    );
    this.#draft = form.rows;
    this.#rest = form.rest;
    if (form.unreadable.length)
      globalThis.ui?.notifications?.warn(`${loc('DICER.DamageMap.Unreadable')} ${form.unreadable.join(', ')}`);
  }

  /** Reads the visible form into the draft; a player changes only their own override column. */
  #collect(object) {
    if (!this.#draft) return;
    const data = object ?? new foundry.applications.ux.FormDataExtended(this.element).object;
    const rows = foundry.utils.expandObject(data).rows ?? {};
    for (const r of Object.values(rows)) {
      const row = this.#draft.find((d) => d.type === r?.type);
      if (!row) continue;
      if (typeof r.user === 'string') row.user = r.user;
      if (!this.#isGM) continue;
      if (typeof r.world === 'string') row.world = r.world;
      if (typeof r.soundSrc === 'string') row.soundSrc = r.soundSrc;
      if (r.soundVolume !== undefined) row.soundVolume = String(r.soundVolume);
    }
  }

  /** The resolved theme colour per type (a small swatch), from the draft; null when nothing resolves. */
  #swatches() {
    const resolve = this.#ctx.resolveTheme;
    if (typeof resolve !== 'function') return () => null;
    const { worldMap, overrides } = mapFromForm({ rows: this.#draft, rest: this.#rest });
    const world = this.#isGM ? worldMap : (globalThis.game.settings.get(MODULE, 'damageTypeMap') ?? {});
    return (type) => {
      try {
        const color = resolve(type, { userOverrides: overrides, worldMap: world })?.appearance?.body?.color;
        return typeof color === 'string' ? color : null;
      } catch {
        return null;
      }
    };
  }

  async _prepareContext() {
    this.#load();
    const choices = buildChoices(this.#ctx);
    const options = (map, current) =>
      current && !(current in map) ? { ...map, [current]: String(current) } : map;
    const isGM = this.#isGM;
    const swatch = this.#swatches();
    const system = globalThis.game.system;
    const own = new Set(systemTypes(system?.id));
    const ownLabel = system?.title ?? loc('DICER.DamageMap.GroupSystem');
    return {
      isGM,
      note: isGM ? loc('DICER.DamageMap.GMHint') : loc('DICER.DamageMap.PlayerHint'),
      rows: this.#draft.map((row, index, all) => {
        const mine = own.has(row.type);
        const prevMine = index > 0 && own.has(all[index - 1].type);
        let group = null;
        if (own.size && index === 0 && mine) group = ownLabel;
        else if (own.size && !mine && (index === 0 || prevMine)) group = loc('DICER.DamageMap.GroupOther');
        const worldChoices = options(choices.world, row.world);
        const label = (map, value) => map[value] ?? ADDON_THEMES.get(value)?.name ?? STUBS.get(value)?.name ?? value;
        const groupOpts = { titleOf: moduleTitle };
        return {
          ...row,
          index,
          group,
          label: humanize(row.type),
          swatch: swatch(row.type),
          worldChoices,
          worldLabel: label(worldChoices, row.world),
          worldGroups: choiceGroups(choices.world, row.world, groupOpts),
          userGroups: choiceGroups(choices.user, row.user, groupOpts),
          soundName: basename(row.soundSrc),
          canEditWorld: isGM,
          // The volume belongs to a custom sound: shown (and editable by the GM) only with one.
          canEditVolume: isGM && Boolean(row.soundSrc),
        };
      }),
    };
  }

  async #save(object) {
    this.#collect(object);
    const g = globalThis.game;
    await saveMaps(
      { rows: this.#draft, rest: this.#rest },
      {
        isGM: this.#isGM,
        setWorld: (map) => g.settings.set(MODULE, 'damageTypeMap', map),
        setSounds: (map) => g.settings.set(MODULE, 'damageTypeSounds', map),
        setOverrides: (map) => g.settings.set(MODULE, 'damageThemeOverrides', map),
      },
    );
    globalThis.ui?.notifications?.info(loc('DICER.DamageMap.Saved'));
    await this.render();
  }

  static async #onSubmit(event, form, formData) {
    event.preventDefault?.();
    await this.#save(formData?.object);
  }

  /** Throws one local die in the type's theme (the draft's choices, saved or not). Nothing is broadcast. */
  static async #onPreview(event, target) {
    this.#collect();
    const row = this.#draft[Number(target.dataset.index)];
    if (!row) return;
    const api = globalThis.game?.dice3d;
    if (typeof api?._preview !== 'function' || typeof this.#ctx.resolveTheme !== 'function') {
      globalThis.ui?.notifications?.warn(loc('DICER.DamageMap.PreviewUnavailable'));
      return;
    }
    const settings = globalThis.game.settings;
    const { worldMap, overrides, sounds } = mapFromForm({ rows: this.#draft, rest: this.#rest });
    // A player previews with the stored world map and sounds, whatever their disabled columns showed.
    const world = this.#isGM ? worldMap : (settings.get(MODULE, 'damageTypeMap') ?? {});
    const theme = this.#ctx.resolveTheme(row.type, { userOverrides: overrides, worldMap: world });
    if (!theme) {
      globalThis.ui?.notifications?.info(loc('DICER.DamageMap.NoTheme'));
      return;
    }
    const custom = this.#isGM ? sounds[row.type] : settings.get(MODULE, 'damageTypeSounds')?.[row.type];
    // A registered theme lands by its rules; the viewer's own override brings none (as at a roll).
    const rules = theme.themeSource === 'viewer' ? [] : (ADDON_THEMES.get(theme.themeId)?.rules ?? []).filter(isLanding);
    const { fx, options } = previewSpec(row.type, theme, custom, undefined, rules);
    await api._preview(fx, options);
  }

  static #onPickFile(event, target) {
    if (!this.#isGM) return;
    const input = this.element.querySelector(`input[name="rows.${target.dataset.index}.soundSrc"]`);
    if (!input) return;
    const FilePicker = foundry.applications.apps.FilePicker.implementation;
    new FilePicker({
      type: 'audio',
      current: input.value,
      callback: (path) => {
        input.value = path;
        this.#collect();
        this.render();
      },
    }).render({ force: true });
  }

  static async #onClearFile(event, target) {
    if (!this.#isGM) return;
    const input = this.element.querySelector(`input[name="rows.${target.dataset.index}.soundSrc"]`);
    if (!input) return;
    input.value = '';
    this.#collect();
    await this.render();
  }

  async close(options) {
    if (instance === this) instance = null;
    return super.close(options);
  }
}

/** Opens (or brings to front) the editor: what the settings menu's proxy class calls. */
export function openDamageMapEditor() {
  instance ??= new DamageMapEditor();
  return instance.render({ force: true });
}
