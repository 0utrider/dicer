/**
 * The appearance editor (lazy chunk, opened from the `dicer.appearanceEditor` settings menu and
 * from the theme browser's Create / Duplicate / Edit): a live turning die on the left, the look's
 * layer stack on the right (body, inside, numbers, edges, glow, per die type, sound), saved as a
 * theme (P7-D1). The pure logic is in ./appearance-form.js.
 *
 * Inputs (sliders, colours, text) change the working form in place and only schedule a preview
 * (debounced 80 ms, one render in flight, latest wins); chips and segmented buttons re-render the
 * stack, keeping the same preview canvas so the die keeps turning. The editor owns one thumbnailer
 * (one WebGL context) and disposes it on close.
 */
import { DIE_TYPES, SOUND_MATERIALS, KNOWN_EFFECTS, BUILTIN_THEMES, normalizeTheme } from '../themes/themes.js';
import { USER_SOUNDS } from '../audio/sound-names.js';
import { LOOKS } from '../look/looks.js';
import { stripActive } from '../look/appearance.js';
import { getShape, labelFor } from '../core/dice-shapes.js';
import { createThumbnailer } from '../themes/thumbnailer.js';
import { KEEP, SOUND_FILE, celebrationPreview, formFromTheme, themeFromForm, scenesFor } from './theme-form.js';
import { SCENE_CATALOG, SCENE_TEXT_MAX, RANDOM_SCENE } from '../effects/library/scene-catalog.js';
import { DAMAGE_THEMES } from '../effects/damage-themes.js';
import { BUILTIN_COLORSETS } from '../compat/colorset-map.js';
import { damageTypeList, previewSpec } from './damage-map-form.js';

/**
 * The theme's damage dice rows: the active system's types first (damage-map-form.js order), each
 * with what it may wear: the world's choice (''), the theme's own look ('none'), a damage theme or a colorset.
 */
function damageRows(chosen = {}) {
  const ctx = (() => {
    try {
      return globalThis.game?.dice3d?._damageContext?.() ?? {};
    } catch {
      return {};
    }
  })();
  const choices = { '': loc('DICER.Appearance.Damage.World'), none: loc('DICER.Appearance.Damage.Keep') };
  for (const id of Object.keys(DAMAGE_THEMES)) choices[id] = `${loc('DICER.DamageMap.Theme')}: ${humanize(id)}`;
  for (const name of [...Object.keys(BUILTIN_COLORSETS), ...(ctx.colorsets ?? [])])
    if (!(name in choices)) choices[name] = `${loc('DICER.DamageMap.Colorset')}: ${name}`;
  const types = damageTypeList({ systemId: globalThis.game?.system?.id, extra: Object.keys(chosen) });
  return types.map((type) => {
    const value = typeof chosen[type] === 'string' ? chosen[type] : '';
    return { type, label: humanize(type), value, choices: value && !(value in choices) ? { ...choices, [value]: value } : choices };
  });
}

/** A scene's own title card lines (['', ''] for none). */
const sceneCardOf = (id) => SCENE_CATALOG.find((s) => s.id === id)?.card ?? ['', ''];
import { jb2aSource } from '../jb2a/source.js';
import { pickJb2a, sequencerDatabase } from './jb2a-picker.js';
import {
  BODY_TYPES,
  FINISHES,
  BODY_PRESET_LISTS,
  INTERIOR_TYPES,
  INCLUSION_LIST,
  EXTRA_LIST,
  SHAPES,
  FILLS,
  RELIEFS,
  ICON_CHOICES,
  DIE_SHAPES,
  COIN_CHOICES,
  FONT_KINDS,
  EDGE_STEPS,
  STRIP_STYLES,
  FONT_SUGGESTIONS,
  formFromAppearance,
  appearanceFromForm,
  visibleSections,
  fontInvalid,
  setField,
  setFaceImage,
  addOverride,
  removeOverride,
  looksFromForms,
  formsFromTheme,
  exportLook,
  parseLook,
  planSave,
  canUpdate,
  createPreviewScheduler,
} from './appearance-form.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** The preview dice: the per-type looks plus the coin, which only previews (it wears the default look). */
const PREVIEW_DICE = [...DIE_TYPES, 'd2', 'dc', 'df'];
/** Die types a look can give face images (d100: its tens die; dc: the coin; df: the Fate die). */
const FACE_DICE = ['d2', 'd4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100', 'dc', 'df'];
/** A die type's face slots, {value: the faces key, label}; a relabelled die by what it shows. */
function faceSlotsOf(type) {
  if (type === 'd100') return Array.from({ length: 10 }, (_, i) => ({ value: (i + 1) * 10, label: i === 9 ? '00' : String((i + 1) * 10) }));
  if (type === 'dc') return [{ value: 1, label: loc('DICER.Appearance.Faces.Heads') }, { value: 0, label: loc('DICER.Appearance.Faces.Tails') }];
  if (type === 'df') return [{ value: 1, label: '+' }, { value: 0, label: loc('DICER.Appearance.Faces.Blank') }, { value: -1, label: '−' }];
  return [...getShape(type).values].sort((x, y) => x - y).map((value) => ({ value, label: labelFor(type, value) }));
}
const MODULE = 'dicer';
const loc = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;
const fmt = (key, data) => globalThis.game?.i18n?.format?.(key, data) ?? key;
const notify = (kind, message) => globalThis.ui?.notifications?.[kind]?.(message);
const me = () => globalThis.game?.user;
const settings = () => globalThis.game?.settings;
const humanize = (id) => {
  const s = String(id).replace(/[-_]+/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const pct = (v, scale = 1) => `${Math.round((Number(v) || 0) * 100 * scale) / scale}%`;

const INSIDE_ICONS = { none: 'fa-ban', liquid: 'fa-droplet', glitter: 'fa-wand-sparkles', swirl: 'fa-hurricane', nebula: 'fa-cloud', shape: 'fa-shapes', foil: 'fa-certificate', eye: 'fa-eye', botanical: 'fa-seedling', smoke: 'fa-smog', fire: 'fa-fire', lava: 'fa-volcano', storm: 'fa-cloud-bolt', frost: 'fa-snowflake' };
const INCLUSION_ICONS = { flower: 'fa-fan', moss: 'fa-leaf', butterfly: 'fa-bugs' };
const EXTRA_ICONS = { none: 'fa-ban', foil: 'fa-certificate', glitter: 'fa-wand-sparkles', sand: 'fa-braille', bubbles: 'fa-circle-dot' };
const SHAPE_ICONS = { star: 'fa-star', heart: 'fa-heart', skull: 'fa-skull', sphere: 'fa-circle', sword: 'fa-sword', axe: 'fa-axe', shield: 'fa-shield', dragon: 'fa-dragon', runes: 'fa-wand-magic-sparkles' };
const EDGE_NAMES = ['sharp', 'crisp', 'soft', 'round', 'veryRound'];
/** px radius of the one rounded corner each edge-step icon draws (22 px box): clearly apart. */
const EDGE_ICON_RADIUS = [0, 5, 10, 15, 22];
// (the pet has its own window: ui/pet-window.js)
const SECTIONS = ['body', 'inside', 'numbers', 'edges', 'glow', 'perType', 'extras', 'damage'];

// Stored data of the wrong shape is never written: refused and warned once per kind.
const warned = new Set();
const listOf = (v, what) => {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v;
  if (!warned.has(what)) {
    warned.add(what);
    notify('warn', `${loc('DICER.Appearance.StoredUnusable')} (${what})`);
  }
  return null;
};
const userList = () => listOf(me()?.getFlag?.(MODULE, 'themes'), 'themes');
const worldList = () => listOf(settings()?.get(MODULE, 'worldThemes'), 'worldThemes');

/** A theme by id among the built-ins, the world's and the user's own (stored raw, validated here). */
function findAny(id) {
  if (typeof id !== 'string') return null;
  const quiet = () => {};
  const builtin = BUILTIN_THEMES.find((t) => t.id === id);
  if (builtin) return builtin;
  for (const [list, source] of [
    [worldList(), 'world'],
    [userList(), 'user'],
  ]) {
    const raw = (list ?? []).find((t) => t && typeof t === 'object' && t.id === id);
    if (raw) return normalizeTheme(raw, source, quiet);
  }
  return null;
}

/** The starting theme of a new look: a theme object, a theme id or a look id (LOOKS); else the default. */
function baseTheme(base) {
  if (base && typeof base === 'object' && base.appearance) return base;
  const theme = findAny(base);
  if (theme) return theme;
  if (typeof base === 'string' && Object.hasOwn(LOOKS, base))
    return normalizeTheme({ id: 'new', name: LOOKS[base].name, appearance: LOOKS[base].appearance }, 'user', () => {});
  return BUILTIN_THEMES.find((t) => t.id === 'default') ?? BUILTIN_THEMES[0];
}

const basename = (path) => decodeURIComponent(String(path ?? '').split(/[\\/]/).pop() || '');

const choiceMap = (ids, nameOf, none, keep) => ({
  ...(none === undefined ? {} : { '': none }),
  ...(keep ? { [KEEP]: keep } : {}),
  ...Object.fromEntries(ids.map((id) => [id, nameOf(id)])),
});

let instance = null;

export class AppearanceEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: 'dicer-appearance-editor',
    tag: 'div',
    classes: ['dicer-appearance-editor'],
    window: { title: 'DICER.Appearance.Title', icon: 'fa-solid fa-palette', resizable: true },
    position: { width: 940, height: 720 },
    actions: {
      setField: AppearanceEditor.#onSetField,
      previewDie: AppearanceEditor.#onPreviewDie,
      throwLook: AppearanceEditor.#onThrowLook,
      previewExtra: AppearanceEditor.#onPreviewExtra,
      previewDamage: AppearanceEditor.#onPreviewDamage,
      pickSoundFile: AppearanceEditor.#onPickSoundFile,
      pickJb2a: AppearanceEditor.#onPickJb2a,
      clearJb2a: AppearanceEditor.#onClearJb2a,
      editType: AppearanceEditor.#onEditType,
      sameAsDefault: AppearanceEditor.#onSameAsDefault,
      pickFont: AppearanceEditor.#onPickFont,
      pickFace: AppearanceEditor.#onPickFace,
      pickBodyImage: AppearanceEditor.#onPickBodyImage,
      clearBodyImage: AppearanceEditor.#onClearBodyImage,
      clearFace: AppearanceEditor.#onClearFace,
      clearFaces: AppearanceEditor.#onClearFaces,
      copyLook: AppearanceEditor.#onCopyLook,
      pasteLook: AppearanceEditor.#onPasteLook,
      exportLook: AppearanceEditor.#onExportLook,
      importLook: AppearanceEditor.#onImportLook,
      saveMine: AppearanceEditor.#onSaveMine,
      saveWorld: AppearanceEditor.#onSaveWorld,
      update: AppearanceEditor.#onUpdate,
      cancel: AppearanceEditor.#onCancel,
    },
  };

  static PARTS = {
    body: { template: 'modules/dicer/templates/appearance-editor.hbs', scrollable: ['.dicer-ae-layers'] },
  };

  #base; // the theme the edit started from (normalized): rules, sound and unknown fields carry over
  #originalId = null; // the theme being updated in place, when the user may write it
  #name = '';
  #forms; // { default: form, d20?: form, ... }
  #editing = 'default'; // the look being edited: 'default' or a die type with its own look
  #dieType = 'd20'; // the previewed die type
  #extras; // the sound / celebration part of the old simple form
  #open = new Set(['body', 'inside', 'numbers', 'edges', 'glow']);
  #fontFailed = null; // the font id whose atlas could not be made
  #onSave = null;
  #thumbs = null;
  #preview = null; // the thumbnailer preview handle
  #canvas = null; // the preview's canvas, moved into every re-render
  #scheduler;

  /**
   * @param {object} [o]
   * @param {string} [o.themeId] edit this theme (in place when it is the user's own, or a world theme for the GM)
   * @param {object|string} [o.base] start a new theme from this theme / theme id / look id
   * @param {Function} [o.onSave] called after a save (the theme browser re-renders)
   */
  constructor({ themeId, base, onSave, ...options } = {}) {
    super(options);
    const user = me();
    const ctx = { isGM: Boolean(user?.isGM), userId: user?.id };
    const editing = themeId ? findAny(themeId) : null;
    const start = editing ?? baseTheme(base);
    this.#base = start;
    if (editing && canUpdate(editing.id, ctx)) {
      this.#originalId = editing.id;
      this.#name = editing.name;
    } else if (themeId || base) {
      this.#name = `${start.name} (${loc('DICER.Appearance.Copy')})`;
    } else {
      this.#name = loc('DICER.Appearance.NewName');
    }
    this.#forms = formsFromTheme(start);
    const simple = formFromTheme(start);
    this.#extras = { soundMaterial: simple.soundMaterial, nat20: simple.nat20, nat1: simple.nat1, damage: simple.damage ?? {} };
    this.#onSave = typeof onSave === 'function' ? onSave : null;
    this.#scheduler = createPreviewScheduler((theme) => this.#renderPreview(theme), { delay: 80 });
    this.#clean = this.#snapshot();
  }

  #clean = '';

  #snapshot() {
    return JSON.stringify([this.#name, this.#forms, this.#extras]);
  }

  /** True when the window holds edits that are not saved. */
  get dirty() {
    this.#syncName();
    return this.#snapshot() !== this.#clean;
  }

  get #isGM() {
    return Boolean(me()?.isGM);
  }

  get #form() {
    return this.#forms[this.#editing] ?? this.#forms.default;
  }

  set #form(next) {
    this.#forms = { ...this.#forms, [this.#forms[this.#editing] ? this.#editing : 'default']: next };
  }

  /** The working theme (raw, plain data) as it would be saved. */
  theme() {
    const keepAll = Object.fromEntries(DIE_TYPES.map((t) => [t, '']));
    const raw = themeFromForm({ name: this.#name, base: KEEP, perType: keepAll, ...this.#extras }, this.#base);
    const { appearance, perType } = looksFromForms(this.#forms, this.#base);
    // An empty name stays empty, so the save refuses it (NeedName) instead of reusing the base's.
    return { ...raw, name: this.#name.trim(), appearance, perType };
  }

  /** The theme the preview draws (normalized looks; no id rules needed). */
  #previewTheme() {
    const { appearance, perType } = looksFromForms(this.#forms);
    return { id: 'preview', name: this.#name, appearance, perType };
  }

  async _prepareContext() {
    const form = this.#form;
    const look = appearanceFromForm(form);
    const show = visibleSections(form);
    const active = (list, value, prefix, icons) =>
      list.map((id) => ({ id, label: loc(prefix + id), active: id === value, icon: icons?.[id] }));
    const edgeIndex = EDGE_STEPS.indexOf(look.edges.radius);
    const fontId = look.numbers.font;
    const fontMessage = fontInvalid(form)
      ? loc('DICER.Appearance.Numbers.FontInvalid')
      : this.#fontFailed && this.#fontFailed === fontId
        ? loc('DICER.Appearance.Numbers.FontFailed')
        : '';
    const overridden = (t) => Boolean(this.#forms[t]);
    const keep = loc('DICER.Appearance.Extras.Keep');
    const withKeep = (map, v) => (v === KEEP ? { ...map, [KEEP]: keep } : map);
    const extras = this.#extras;
    const fontLabel = form.numbers.fontKind === 'css' && form.numbers.fontFamily ? form.numbers.fontFamily : loc(`DICER.Appearance.FontKind.${form.numbers.fontKind}`);
    const overrideCount = DIE_TYPES.filter(overridden).length;
    return {
      form,
      show,
      name: this.#name,
      editing: this.#editing,
      isOverride: this.#editing !== 'default',
      editingType: this.#editing,
      editingLabel: loc('DICER.Appearance.PerType.Editing').replace('{type}', this.#editing),
      hasPreview: Boolean(this.#context().atlas),
      dice: PREVIEW_DICE.map((type) => ({ type, active: type === this.#dieType, overridden: overridden(type) })),
      bodyTypes: active(BODY_TYPES, form.body.type, 'DICER.Appearance.BodyType.'),
      bodyPresets: active(BODY_PRESET_LISTS[form.body.type] ?? [], form.body.preset, 'DICER.Appearance.Preset.'),
      finishes: active(FINISHES, form.body.finish, 'DICER.Appearance.Finish.'),
      insideTypes: active(INTERIOR_TYPES, form.interior.type, 'DICER.Appearance.InsideType.', INSIDE_ICONS),
      inclusions: active(INCLUSION_LIST, form.interior.inclusion, 'DICER.Appearance.Inclusion.', INCLUSION_ICONS),
      extraKinds: active(EXTRA_LIST, form.interior.extra, 'DICER.Appearance.Extra.', EXTRA_ICONS),
      shapes: active(SHAPES, form.interior.shape, 'DICER.Appearance.Shape.', SHAPE_ICONS),
      dieShapes: Object.entries(DIE_SHAPES).map(([type, list]) => ({ type, label: fmt('DICER.Appearance.Shapes.Of', { die: type }), choices: active(list, form.shapes[type] ?? 'classic', 'DICER.Appearance.Shapes.') })),
      coins: active(COIN_CHOICES, form.numbers.coin, 'DICER.Appearance.Coin.'),
      fills: active(FILLS, form.numbers.fill, 'DICER.Appearance.Fill.'),
      reliefs: active(RELIEFS, form.numbers.relief, 'DICER.Appearance.Relief.'),
      critIcons: active(ICON_CHOICES, form.numbers.critIcon, 'DICER.Appearance.Icon.'),
      fumbleIcons: active(ICON_CHOICES, form.numbers.fumbleIcon, 'DICER.Appearance.Icon.'),
      strips: active(STRIP_STYLES, form.edges.strip, 'DICER.Appearance.Strip.'),
      fontKinds: active(FONT_KINDS, form.numbers.fontKind, 'DICER.Appearance.FontKind.'),
      fontSuggestions: FONT_SUGGESTIONS,
      fontMessage,
      canBrowse: Boolean(globalThis.foundry?.applications?.apps?.FilePicker),
      ...this.#faceContext(form),
      edgeSteps: EDGE_STEPS.map((value, i) => ({
        value,
        label: loc(`DICER.Appearance.Edge.${EDGE_NAMES[i]}`),
        active: i === edgeIndex,
        radius: EDGE_ICON_RADIUS[i],
      })),
      pct: {
        roughness: pct(form.body.roughness),
        density: pct(form.interior.density),
        extraDensity: pct(form.interior.extraDensity),
        depth: pct(form.numbers.depth),
        size: pct(form.numbers.size),
        weight: pct(form.numbers.weight),
        intensity: pct(form.glow.intensity),
        inkGlow: pct(form.numbers.inkGlow ?? 1),
        stripStrength: pct(form.edges.stripStrength),
        bodyBlend: pct(form.bodyImage?.blend ?? 1),
      },
      bodyImageModes: active(['wrap', 'face'], form.bodyImage?.mode ?? 'wrap', 'DICER.Appearance.BodyImage.Mode.'),
      summary: {
        body: loc(`DICER.Appearance.BodyType.${look.body.type}`),
        inside: show.inside ? loc(`DICER.Appearance.InsideType.${form.interior.type}`) + (show.extraDetails ? ` + ${loc(`DICER.Appearance.Extra.${form.interior.extra}`)}` : '') : '—',
        numbers: `${loc(`DICER.Appearance.Fill.${look.numbers.fill}`)} · ${fontLabel}`,
        edges: loc(`DICER.Appearance.Edge.${EDGE_NAMES[Math.max(0, edgeIndex)]}`) + (stripActive(look) ? ` · ${loc(`DICER.Appearance.Strip.${look.edges.strip.style}`)}` : ''),
        glow: look.glow.intensity > 0 ? pct(look.glow.intensity) : loc('DICER.Appearance.Glow.Off'),
        perType: overrideCount ? String(overrideCount) : '',
        extras: '',
        damage: (() => {
          const n = Object.values(extras.damage ?? {}).filter(Boolean).length;
          return n ? loc('DICER.Appearance.Damage.Count').replace('{n}', n) : '';
        })(),
      },
      overrides: DIE_TYPES.filter(overridden).map((type) => ({ type, editing: type === this.#editing })),
      available: DIE_TYPES.filter((t) => !overridden(t)),
      open: Object.fromEntries(SECTIONS.map((s) => [s, this.#open.has(s)])),
      extras,
      materialChoices: withKeep(choiceMap(SOUND_MATERIALS, humanize, loc('DICER.Appearance.Extras.None')), extras.soundMaterial),
      effectChoices: choiceMap(KNOWN_EFFECTS, humanize, loc('DICER.Appearance.Extras.None'), keep),
      celebrations: [
        ['nat20', 'DICER.Appearance.Extras.NatHigh', 'DICER.Appearance.Extras.PreviewNatHigh', 'critical-success'],
        ['nat1', 'DICER.Appearance.Extras.NatLow', 'DICER.Appearance.Extras.PreviewNatLow', 'critical-failure'],
      ].map(([key, label, preview, outcome]) => {
        const row = extras[key] ?? {};
        const file = row.sound === SOUND_FILE && row.soundSrc ? { [SOUND_FILE]: basename(row.soundSrc) } : {};
        return {
          key,
          label: loc(label),
          preview: loc(preview),
          ...row,
          soundChoices: { ...choiceMap(USER_SOUNDS, humanize, loc('DICER.Appearance.Extras.None'), keep), ...file },
          jb2aName: row.jb2a ? basename(row.jb2a) : '',
          // its crit scenes (natural 20s on the 20 row, natural 1s on the 1 row)
          sceneChoices: choiceMap(scenesFor(outcome), (id) => (id === RANDOM_SCENE ? loc('DICER.Triggers.SceneRandom') : humanize(id.slice(6))), loc('DICER.Appearance.Extras.None')),
          // the chosen scene's own card lines: the placeholders of the theme's own words
          sceneCard: sceneCardOf(row.scene),
          sceneTextMax: SCENE_TEXT_MAX,
        };
      }),
      damageRows: damageRows(extras.damage),
      jb2aActive: Boolean(jb2aSource({ modules: globalThis.game?.modules, settings: settings() })),
      isGM: this.#isGM,
      canUpdate: Boolean(this.#originalId),
    };
  }

  #context() {
    try {
      return globalThis.game?.dice3d?._themeContext?.() ?? {};
    } catch {
      return {};
    }
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element?.querySelector?.('.dicer-ae-body');
    if (!root) return;
    root.addEventListener('input', (event) => this.#onInput(event));
    root.addEventListener('change', (event) => this.#onInput(event, true));
    for (const d of root.querySelectorAll('details[data-section]'))
      d.addEventListener('toggle', () => (d.open ? this.#open.add(d.dataset.section) : this.#open.delete(d.dataset.section)));
    const file = root.querySelector('.dicer-ae-file');
    file?.addEventListener('change', async () => {
      const f = file.files?.[0];
      file.value = '';
      if (!f) return;
      try {
        this.#applyLook(await foundry.utils.readTextFromFile(f), 'DICER.Appearance.Imported');
      } catch {
        notify('warn', loc('DICER.Appearance.BadLook'));
      }
    });
    this.#attachPreview(root);
  }

  /** Keeps one preview across renders: the turning canvas is moved into the new stage. */
  #attachPreview(root) {
    const fresh = root.querySelector('canvas.dicer-live');
    if (!fresh) return;
    const stage = fresh.closest('.dicer-stage');
    if (this.#preview?.active && this.#canvas) {
      fresh.replaceWith(this.#canvas);
      stage?.classList.toggle('has-live', !this.#canvas.hidden);
      this.#scheduler.schedule(this.#previewTheme());
      return;
    }
    this.#startPreview(fresh, stage);
  }

  #thumbnailer() {
    if (this.#thumbs) return this.#thumbs;
    const { atlas = null, fonts = null } = this.#context();
    if (atlas) this.#thumbs = createThumbnailer({ atlas, fonts, size: 256 });
    return this.#thumbs;
  }

  #startPreview(canvas, stage) {
    this.#stopPreview();
    const thumbs = this.#thumbnailer();
    if (!thumbs) return;
    const css = Math.round(stage?.clientWidth || 300);
    canvas.width = canvas.height = Math.max(1, Math.round(css * Math.min(globalThis.devicePixelRatio || 1, 2)));
    const live = (on) => {
      canvas.hidden = !on;
      canvas.closest('.dicer-stage')?.classList.toggle('has-live', on);
    };
    this.#canvas = canvas;
    this.#preview = thumbs.preview(canvas, this.#previewTheme(), this.#dieType, {
      onFrame: () => canvas.hidden && live(true),
      onLost: () => {
        live(false);
        this.#preview = null;
        this.#canvas = null;
      },
    });
    this.#checkFont(this.#previewTheme());
  }

  #stopPreview() {
    this.#preview?.stop();
    this.#preview = null;
    this.#canvas = null;
  }

  /** One debounced preview pass: the die shows the working theme. */
  #renderPreview(theme) {
    this.#preview?.update?.(theme, this.#dieType);
    // Fire and forget: a slow or failing font (up to the layer's timeout) must not hold the
    // scheduler's one in-flight slot, or the preview would freeze meanwhile.
    void this.#checkFont(theme);
  }

  /** A computer / file font that cannot be made shows a message in the font field (the serif stands in). */
  async #checkFont(theme) {
    const look = theme.perType?.[this.#editing] ?? theme.appearance;
    const id = look?.numbers?.font;
    const fonts = this.#context().fonts;
    if (!id || id === 'serif' || !fonts?.request) return this.#showFontFailed(null);
    let atlas = null;
    try {
      atlas = await fonts.request(id);
    } catch {
      atlas = null;
    }
    const now = appearanceFromForm(this.#form).numbers.font;
    if (now !== id) return; // changed meanwhile: the next pass decides
    this.#showFontFailed(atlas ? null : id);
  }

  #showFontFailed(id) {
    if (this.#fontFailed === id) return;
    this.#fontFailed = id;
    this.#paintFontMessage();
  }

  #paintFontMessage() {
    const msg = this.element?.querySelector?.('.dicer-ae-font-msg');
    if (!msg) return;
    const text = fontInvalid(this.#form) ? loc('DICER.Appearance.Numbers.FontInvalid') : this.#fontFailed ? loc('DICER.Appearance.Numbers.FontFailed') : '';
    msg.hidden = !text;
    const span = msg.querySelector('span');
    if (span) span.textContent = text;
  }

  /** A typed / dragged value: the form changes in place (no re-render, focus stays), then the preview. */
  #onInput(event, committed = false) {
    const el = event.target;
    if (!el || el.type === 'file') return;
    if (el.name === 'name') {
      this.#name = el.value;
      return;
    }
    if (el.name?.startsWith('extras.')) {
      const path = el.name.slice(7).split('.');
      const extras = structuredClone(this.#extras);
      if (path.length === 1) extras[path[0]] = el.value;
      else extras[path[0]] = { ...extras[path[0]], [path[1]]: el.value };
      this.#extras = extras;
      return;
    }
    let path = el.name;
    let value = el.type === 'checkbox' ? el.checked : el.value;
    if (el.dataset.colorFor) {
      path = el.dataset.colorFor;
      const text = this.element.querySelector(`input[name="${path}"]`);
      if (text) text.value = value;
    } else if (el.type === 'text' && el.closest('.dicer-ae-color')) {
      const v = value.trim().toLowerCase();
      if (!/^#[0-9a-f]{6}$/.test(v)) return; // half typed: wait
      value = v;
      const swatch = el.closest('.dicer-ae-color').querySelector('input[type="color"]');
      if (swatch) swatch.value = v;
    }
    if (!path) return;
    this.#form = setField(this.#form, path, value);
    // a colour picked by hand turns its readability toggle off (setField): the box follows
    const keep = path === 'numbers.color' && this.element.querySelector('input[name="numbers.contrast"]');
    if (keep) keep.checked = false;
    const out = this.element.querySelector(`output[data-for="${path}"]`);
    if (out) out.textContent = pct(value);
    if (path.startsWith('numbers.font')) this.#paintFontMessage();
    if (committed || el.type !== 'text' || !path.startsWith('numbers.font')) this.#scheduler.schedule(this.#previewTheme());
  }

  /** Replaces the edited look with one from JSON text (file / clipboard); a malformed one warns once. */
  #applyLook(text, okKey) {
    const res = parseLook(text);
    if (res.error) {
      notify('warn', loc('DICER.Appearance.BadLook'));
      return false;
    }
    this.#form = formFromAppearance(res.appearance);
    notify('info', loc(okKey));
    this.render();
    return true;
  }

  static async #onSetField(event, target) {
    const { field, value } = target.dataset;
    if (!field) return;
    this.#form = setField(this.#form, field, value);
    this.#scheduler.schedule(this.#previewTheme());
    await this.render();
  }

  /** Rolls one of each die with the working look on the table (local only). */
  static async #onThrowLook() {
    const api = globalThis.game?.dice3d;
    if (typeof api?._throwLook !== 'function') {
      globalThis.ui?.notifications?.warn(loc('DICER.Appearance.PreviewUnavailable'));
      return;
    }
    await api._throwLook(this.#previewTheme());
  }

  /** Throws one local d20 with the working impact sound, or landing a nat 20 / nat 1 with its celebration. */
  static async #onPreviewExtra(event, target) {
    const api = globalThis.game?.dice3d;
    if (typeof api?._preview !== 'function') {
      globalThis.ui?.notifications?.warn(loc('DICER.Appearance.PreviewUnavailable'));
      return;
    }
    const { fx, options } = celebrationPreview(this.theme(), target.dataset.key);
    await api._preview(fx, options);
  }

  /**
   * Throws a d6 as a damage die of the row's type would look with this theme: its choice (a damage
   * theme or colorset, with the theme's landing effect and sound), the theme's own look ('none'),
   * or the world's choice ('') as the stored world map gives it (damage-map-form.js previewSpec).
   */
  static async #onPreviewDamage(event, target) {
    const api = globalThis.game?.dice3d;
    const resolve = api?._damageContext?.()?.resolveTheme;
    if (typeof api?._preview !== 'function' || typeof resolve !== 'function') {
      globalThis.ui?.notifications?.warn(loc('DICER.Appearance.PreviewUnavailable'));
      return;
    }
    const type = target.dataset.type;
    const value = this.#extras.damage?.[type] ?? '';
    const theme = this.theme();
    const own = { appearance: theme.perType?.d6 ?? theme.appearance, soundMaterial: theme.soundMaterial };
    let worldMap = { [type]: value };
    if (!value) {
      try {
        worldMap = globalThis.game.settings.get('dicer', 'damageTypeMap') ?? {};
      } catch {
        worldMap = {};
      }
    }
    const look = value === 'none' ? own : (resolve(type, { worldMap }) ?? own);
    const { fx, options } = previewSpec(type, look, null);
    await api._preview(fx, options);
  }

  /** Sets fields of one celebration row (nat20 / nat1) and redraws the form. */
  async #setCelebration(key, patch) {
    if (key !== 'nat20' && key !== 'nat1') return;
    this.#extras = { ...this.#extras, [key]: { ...this.#extras[key], ...patch } };
    await this.render();
  }

  /** Opens Foundry's file picker; resolves the chosen path, or null when closed. */
  #pickFile(type, current) {
    const FilePicker = globalThis.foundry?.applications?.apps?.FilePicker?.implementation;
    if (!FilePicker) return Promise.resolve(null);
    return new Promise((resolve) => {
      const picker = new FilePicker({ type, current, callback: (path) => resolve(path) });
      picker.render(true);
    });
  }

  /** A row's sound becomes an audio file picked from the server. */
  static async #onPickSoundFile(event, target) {
    const key = target.dataset.key;
    const path = await this.#pickFile('audio', this.#extras[key]?.soundSrc ?? '');
    if (typeof path === 'string' && path) await this.#setCelebration(key, { sound: SOUND_FILE, soundSrc: path });
  }

  /** A row's effect plays a JB2A animation file picked from the JB2A folders. */
  static async #onPickJb2a(event, target) {
    const key = target.dataset.key;
    const src = jb2aSource({ modules: globalThis.game?.modules, settings: settings() });
    const current = this.#extras[key]?.jb2a || '';
    // Sequencer's JB2A database when Sequencer is active; Foundry's file picker otherwise.
    const db = sequencerDatabase();
    const path = db
      ? await pickJb2a(db, { current })
      : await this.#pickFile('imagevideo', current || (src ? `${src.location}/${src.moduleId}/Library/` : ''));
    if (typeof path !== 'string' || !path) return;
    if (!/\.webm$/i.test(path)) {
      globalThis.ui?.notifications?.warn(loc('DICER.Appearance.Extras.NeedWebm'));
      return;
    }
    // With no effect chosen, light burst becomes the stand-in that plays when JB2A cannot.
    await this.#setCelebration(key, { jb2a: path, ...(this.#extras[key]?.effect ? {} : { effect: 'light-burst' }) });
  }

  static async #onClearJb2a(event, target) {
    await this.#setCelebration(target.dataset.key, { jb2a: '' });
  }

  static async #onPreviewDie(event, target) {
    const type = target.dataset.type;
    if (!PREVIEW_DICE.includes(type) || type === this.#dieType) return;
    this.#dieType = type;
    for (const b of this.element.querySelectorAll('.dicer-ae-dice button')) {
      const on = b.dataset.type === type;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
    this.#scheduler.schedule(this.#previewTheme());
    await this.#scheduler.flush();
    if (this.element?.querySelector('.dicer-ae-faces')) await this.render(); // its face slots
  }

  static async #onEditType(event, target) {
    const type = target.dataset.type;
    if (type === 'default') {
      this.#editing = 'default';
      // Show a die that wears the default look (d20 unless it has its own).
      if (this.#forms[this.#dieType]) this.#dieType = this.#forms.d20 ? (DIE_TYPES.find((t) => !this.#forms[t]) ?? 'd20') : 'd20';
    } else if (DIE_TYPES.includes(type)) {
      this.#forms = addOverride(this.#forms, type);
      this.#editing = type;
      this.#dieType = type; // the preview shows the look being edited
    } else return;
    this.#scheduler.schedule(this.#previewTheme());
    await this.render();
  }

  static async #onSameAsDefault(event, target) {
    const type = target.dataset.type;
    if (!DIE_TYPES.includes(type)) return;
    this.#forms = removeOverride(this.#forms, type);
    if (this.#editing === type) this.#editing = 'default';
    this.#scheduler.schedule(this.#previewTheme());
    await this.render();
  }

  /** The face images of the previewed die type: one slot per face (faceSlotsOf). */
  #faceContext(form) {
    const type = FACE_DICE.includes(this.#dieType) ? this.#dieType : null;
    const map = (type && form.faces?.[type]) || {};
    return {
      faceType: type,
      faceSlots: type ? faceSlotsOf(type).map((s) => ({ ...s, url: map[s.value] ?? '' })) : [],
      faceAny: Object.keys(map).length > 0,
    };
  }

  /** Face images are edited for the previewed die; the form changes, then the preview and the slots. */
  async #setFace(value, url) {
    const type = this.#dieType;
    if (!FACE_DICE.includes(type)) return;
    if (value === null) {
      const faces = { ...this.#form.faces };
      delete faces[type];
      this.#form = { ...this.#form, faces };
    } else this.#form = setFaceImage(this.#form, type, value, url);
    this.#scheduler.schedule(this.#previewTheme());
    await this.render();
  }

  /** The body image: picked with Foundry's file picker, or cleared (its other settings are kept). */
  async #setBodyImage(src) {
    this.#form = setField(this.#form, 'bodyImage.src', src);
    this.#scheduler.schedule(this.#previewTheme());
    await this.render();
  }

  static async #onPickBodyImage() {
    const path = await this.#pickFile('image', this.#form.bodyImage?.src ?? '');
    if (path) await this.#setBodyImage(String(path));
  }

  static async #onClearBodyImage() {
    await this.#setBodyImage('');
  }

  static async #onPickFace(event, target) {
    const value = Number(target.dataset.value);
    const path = await this.#pickFile('image', this.#form.faces?.[this.#dieType]?.[value] ?? '');
    if (path) await this.#setFace(value, String(path));
  }

  static async #onClearFace(event, target) {
    await this.#setFace(Number(target.dataset.value), '');
  }

  static async #onClearFaces() {
    await this.#setFace(null);
  }

  static #onPickFont() {
    const FilePicker = globalThis.foundry?.applications?.apps?.FilePicker?.implementation;
    if (!FilePicker) return;
    new FilePicker({
      type: 'font',
      current: this.#form.numbers.fontFile,
      callback: (path) => {
        this.#form = setField(this.#form, 'numbers.fontFile', String(path ?? ''));
        this.#scheduler.schedule(this.#previewTheme());
        this.render();
      },
    }).render({ force: true });
  }

  static async #onCopyLook() {
    const text = exportLook(appearanceFromForm(this.#form));
    try {
      await globalThis.navigator.clipboard.writeText(text);
      notify('info', loc('DICER.Appearance.Copied'));
    } catch {
      notify('warn', loc('DICER.Appearance.ClipboardUnavailable'));
    }
  }

  static async #onPasteLook() {
    let text;
    try {
      text = await globalThis.navigator.clipboard.readText();
    } catch {
      return notify('warn', loc('DICER.Appearance.ClipboardUnavailable'));
    }
    this.#applyLook(text, 'DICER.Appearance.Pasted');
  }

  static #onExportLook() {
    const name = (this.#name || 'look').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'look';
    foundry.utils.saveDataToFile(exportLook(appearanceFromForm(this.#form)), 'application/json', `dicer-look-${name}.json`);
  }

  static #onImportLook() {
    this.element.querySelector('.dicer-ae-file')?.click();
  }

  /** Writes the working theme: 'mine' (new user theme), 'world' (new world theme, GM), 'update' (in place). */
  async save(mode) {
    this.#syncName();
    const user = me();
    const isGM = Boolean(user?.isGM);
    // GM-only writes are refused here too, not only hidden in the template.
    if (mode === 'world' && !isGM) {
      notify('warn', loc('DICER.Appearance.NotAllowed'));
      return null;
    }
    const plan = planSave({
      mode,
      theme: this.theme(),
      originalId: this.#originalId,
      isGM,
      userId: user?.id,
      userList: mode === 'world' ? [] : userList(),
      worldList: mode === 'mine' ? [] : worldList(),
    });
    if (!plan.ok) {
      const key = {
        name: 'DICER.Appearance.NeedName',
        'gm-only': 'DICER.Appearance.NotAllowed',
        'not-yours': 'DICER.Appearance.NotAllowed',
      }[plan.reason];
      if (key) notify('warn', loc(key));
      return null;
    }
    if (plan.scope === 'world') await settings().set(MODULE, 'worldThemes', plan.list);
    else await user.setFlag(MODULE, 'themes', plan.list);
    this.#originalId = plan.id;
    this.#base = normalizeTheme(plan.list.find((t) => t && t.id === plan.id), plan.scope, () => {}) ?? this.#base;
    this.#clean = this.#snapshot();
    notify('info', loc(mode === 'update' ? 'DICER.Appearance.Updated' : 'DICER.Appearance.Saved'));
    try {
      this.#onSave?.(plan.id);
    } catch {
      /* the caller's refresh failed: the theme is saved */
    }
    await this.render();
    return plan.id;
  }

  #syncName() {
    const input = this.element?.querySelector?.('input[name="name"]');
    if (input) this.#name = input.value;
  }

  static #onSaveMine() {
    return this.save('mine');
  }

  static #onSaveWorld() {
    return this.save('world');
  }

  static #onUpdate() {
    return this.save('update');
  }

  static #onCancel() {
    return this.close();
  }

  /**
   * Every way of closing (the window's X, Escape, Cancel) runs through close(): with unsaved
   * edits it asks the same question openAppearanceEditor does, and "no" keeps the window open.
   * `{ discard: true }` skips the question (the caller already asked).
   */
  async close(options = {}) {
    if (!options?.discard && this.rendered !== false && this.dirty) {
      const discard = await confirmDiscard();
      if (!discard) return this;
    }
    if (instance === this) instance = null;
    this.#scheduler.cancel();
    this.#stopPreview(); // nothing keeps drawing once the editor is closed
    this.#thumbs?.dispose();
    this.#thumbs = null;
    return super.close(options);
  }
}

/** "Discard the unsaved changes?" -> true to discard. */
function confirmDiscard() {
  return foundry.applications.api.DialogV2.confirm({
    window: { title: loc('DICER.Appearance.Title') },
    content: `<p>${loc('DICER.Appearance.DiscardChanges')}</p>`,
  });
}

/** Opens the editor (one at a time): on a theme ({themeId}) or new from a base theme / look ({base}). */
export async function openAppearanceEditor(options = {}) {
  if (instance?.dirty) {
    const discard = await confirmDiscard();
    if (!discard) return instance.render({ force: true }); // keep editing the current look
  }
  if (instance) await instance.close({ discard: true });
  instance = new AppearanceEditor(options);
  return instance.render({ force: true });
}
