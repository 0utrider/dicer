// Render harness for the editor windows (theme browser, appearance editor, trigger rules, damage type map).
// The real application classes run against a small ApplicationV2 / game stand-in: their own
// _prepareContext builds the context, the real .hbs templates render it (Handlebars + the Foundry
// helpers they use), their action handlers answer clicks and the theme browser's _onRender makes
// real thumbnails through the thumbnailer. tests/visual/editors.mjs drives it and screenshots it.
// Query: ?app=themes|appearance|triggers|damage  &player=1 (a player instead of the GM)
//        &theme=<id> (appearance: the theme to edit), &locked=1 (with player=1: a world default with the lock on).
import { loadDigitAtlas } from '../src/render/sdf-atlas.js';
import { createFontAtlases, createFontWorker } from '../src/fonts/font-atlas.js';
import { BUILTIN_THEMES } from '../src/themes/themes.js';
import { DEFAULT_RULES, normalizeRule } from '../src/effects/rules.js';
import { resolveDamageTheme } from '../src/effects/damage-themes.js';

const params = new URLSearchParams(location.search);
const which = params.get('app') ?? 'themes';
const isGM = params.get('player') !== '1';
const errors = [];
window.addEventListener('error', (e) => errors.push(`page error: ${e.message}`));
window.addEventListener('unhandledrejection', (e) => errors.push(`unhandled: ${e.reason?.stack ?? e.reason}`));

const H = globalThis.Handlebars;
const lang = await (await fetch('/lang/en.json')).json();
const localize = (key) => {
  const v = String(key)
    .split('.')
    .reduce((o, p) => o?.[p], lang);
  return typeof v === 'string' ? v : key;
};
const esc = (v) => H.escapeExpression(v);
H.registerHelper('localize', (key) => localize(key));
H.registerHelper('selectOptions', (choices, options) => {
  const sel = options.hash.selected;
  const selected = (Array.isArray(sel) ? sel : [sel]).map((v) => String(v ?? ''));
  let html = '';
  for (const [value, label] of Object.entries(choices ?? {}))
    html += `<option value="${esc(value)}"${selected.includes(value) ? ' selected' : ''}>${esc(label)}</option>`;
  return new H.SafeString(html);
});

// --- ApplicationV2 stand-in ---------------------------------------------------------------------
function expandObject(flat) {
  const out = {};
  for (const [k, v] of Object.entries(flat)) {
    const parts = k.split('.');
    let o = out;
    parts.slice(0, -1).forEach((p) => (o = o[p] ??= {}));
    o[parts.at(-1)] = v;
  }
  return out;
}
class FormDataExtended {
  constructor(form) {
    this.object = {};
    for (const el of form.elements) {
      if (!el.name || el.disabled) continue;
      this.object[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    }
  }
}
const templates = new Map();
async function template(path) {
  if (!templates.has(path)) {
    const src = await (await fetch(`/${path.replace(/^modules\/dicer\//, '')}`)).text();
    templates.set(path, H.compile(src));
  }
  return templates.get(path);
}

class FakeApp {
  static DEFAULT_OPTIONS = {};
  constructor() {
    this.options = this.constructor.DEFAULT_OPTIONS;
  }
  get element() {
    return this._frame;
  }
  async render() {
    const o = this.options;
    if (!this._frame) {
      const frame = document.createElement(o.tag ?? 'div');
      frame.id = o.id;
      frame.className = ['application', ...(o.classes ?? [])].join(' ');
      frame.innerHTML = `<header class="window-header">
        <i class="window-icon fa-fw ${o.window.icon}" inert></i>
        <h1 class="window-title">${esc(localize(o.window.title))}</h1>
        <button type="button" class="header-control icon fa-solid fa-ellipsis-vertical"></button>
        <button type="button" class="header-control icon fa-solid fa-xmark"></button>
      </header><section class="window-content"></section><div class="window-resize-handle"></div>`;
      const { width, height } = o.position;
      Object.assign(frame.style, {
        width: `${width}px`,
        height: `${height}px`,
        left: `${Math.round((innerWidth - width) / 2)}px`,
        top: `${Math.round((innerHeight - height) / 2)}px`,
      });
      frame.addEventListener('click', (event) => {
        const target = event.target.closest('[data-action]');
        const handler = target && o.actions?.[target.dataset.action];
        if (handler) handler.call(this, event, target);
      });
      if (o.tag === 'form')
        frame.addEventListener('submit', (event) => {
          event.preventDefault();
          o.form.handler.call(this, event, frame, new FormDataExtended(frame));
        });
      document.getElementById('stage').appendChild(frame);
      this._frame = frame;
    }
    const context = await this._prepareContext();
    const part = Object.values(this.constructor.PARTS)[0];
    // Like HandlebarsApplicationMixin, keep the scroll position of the part's scrollable elements.
    const content = this._frame.querySelector('.window-content');
    const scrolls = (part.scrollable ?? []).map((s) => content.querySelector(s)?.scrollTop ?? 0);
    content.innerHTML = (await template(part.template))(context);
    (part.scrollable ?? []).forEach((s, i) => {
      const el = content.querySelector(s);
      if (el) el.scrollTop = scrolls[i];
    });
    this._onRender?.(context, {});
    window.__renders = (window.__renders ?? 0) + 1;
    return this;
  }
  async close() {}
}

const notifications = { info: () => {}, warn: () => {}, error: (m) => console.warn(m) };
globalThis.ui = { notifications };
globalThis.foundry = {
  applications: {
    api: { ApplicationV2: FakeApp, HandlebarsApplicationMixin: (B) => class extends B {} },
    ux: { FormDataExtended },
  },
  utils: { expandObject, randomID: () => Math.random().toString(36).slice(2, 10) },
  data: { operators: { ForcedDeletion: { create: () => undefined } } },
};
// A minimal DialogV2.confirm: shows the dialog's own content (the push panel) and waits for a button.
globalThis.foundry.applications.api.DialogV2 = {
  confirm({ window: win, content, yes }) {
    return new Promise((resolve) => {
      const el = document.createElement('form');
      el.className = 'application dialog dialog-v2 themed theme-dark';
      el.style.cssText = 'position:absolute;left:300px;top:260px;width:400px;height:auto;z-index:100';
      el.innerHTML = `<header class="window-header"><h1 class="window-title">${esc(win.title)}</h1></header>
        <section class="window-content standard-form">${content}
          <footer class="form-footer"><button type="button" data-r="yes"><i class="fa-solid fa-check"></i> ${esc(localize('DICER.Themes.Push'))}</button>
          <button type="button" data-r="no"><i class="fa-solid fa-xmark"></i> ${esc(localize('Cancel'))}</button></footer></section>`;
      el.addEventListener('click', (event) => {
        const r = event.target.closest('[data-r]')?.dataset.r;
        if (!r) return;
        el.remove();
        resolve(r === 'yes' ? yes.callback(event, { form: el }) : null);
      });
      document.getElementById('stage').appendChild(el);
    });
  },
};

// --- sample world ---------------------------------------------------------------------------------
const quiet = () => {};
const theme = (id) => BUILTIN_THEMES.find((t) => t.id === id);
const store = {
  theme: 'galaxy-nebula',
  worldThemes: [{ id: 'world.table-gold', name: 'Table Gold', appearance: theme('gold-polished').appearance }],
  damageThemeOverrides: { fire: 'ember-core', cold: 'electricity', poison: 'none' },
  damageTypeMap: { fire: 'fire', cold: 'cold', acid: 'acid', sonic: 'thunder', void: 'void' },
  damageTypeSounds: {
    fire: { src: 'sounds/dicer/fire-whoosh.ogg', volume: 0.6 },
    electricity: { src: 'worlds/campaign/audio/zap-crackle-long-name.ogg' },
  },
  worldTriggers: [
    ...DEFAULT_RULES,
    {
      id: 'rule-crit-fire',
      name: 'Fiery crit',
      die: 'd20',
      result: { kind: 'range', from: 19, to: 20 },
      context: { damageType: 'fire' },
      effect: { id: 'embers', color: '#ff7a1a', intensity: 1.4 },
      sound: { src: 'sounds/dicer/fire-whoosh.ogg', volume: 0.8 },
      macro: 'Macro.a1b2c3d4e5f6',
    },
    {
      id: 'rule-max-damage',
      name: 'Max damage shake',
      die: 'd8',
      result: { kind: 'max' },
      effect: { id: 'shake' },
    },
    {
      id: 'rule-crit-fail',
      name: 'Critical failure gloom',
      enabled: false,
      die: 'any',
      outcome: 'critical-failure',
      effect: { id: 'smoke' },
      sound: { builtin: 'thud' },
    },
  ],
  disabledModuleTriggers: [],
};
// ?locked=1 (with &player=1): the GM has set everyone's dice to a world default and locked it.
if (params.get('locked') === '1') {
  store.worldDefaultTheme = 'dragon-hoard';
  store.theme = 'dragon-hoard';
  store.lockPlayerLooks = true;
}
const userFlags = {
  themes: [
    { id: 'user.u1.my-ember', name: 'My Ember', appearance: theme('ember-core').appearance },
    { id: 'user.u1.night-sky', name: 'Night Sky (copy)', appearance: theme('starlit-glitter').appearance },
    {
      id: 'user.u1.midnight-nebula',
      name: 'Midnight Nebula',
      appearance: {
        body: { type: 'resin', color: '#2b4fa8', color2: '#0b1440', finish: 'polished', roughness: 0.04 },
        interior: { type: 'nebula', colors: ['#b04dff', '#2fd8f0'], density: 0.72, shape: 'star' },
        numbers: { fill: 'gold', color: '#e2b04a', depth: 0.55, font: 'serif' },
        edges: { radius: 0.5 },
        glow: { color: '#7fb4ff', intensity: 0 },
      },
      perType: {},
      rules: [],
    },
    {
      id: 'user.u1.georgia-gold',
      name: 'Georgia Gold',
      appearance: {
        body: { type: 'opaque', color: '#5a1620', color2: '#2a0910', finish: 'polished', roughness: 0.2 },
        numbers: { fill: 'gold', color: '#e2b04a', depth: 0.55, font: 'css:Georgia' },
        edges: { radius: 0.25 },
        glow: { color: '#ffd166', intensity: 0 },
      },
      perType: {},
      rules: [],
    },
  ],
  appearance: { d20: { theme: 'galaxy-nebula' }, 'role:attack': { theme: 'dragon-hoard' }, d6: { theme: 'dragon-hoard' } },
  triggers: [
    { id: 'mine-1', name: 'My nat 20 cheer', die: 'd20', result: { kind: 'value', value: 20 }, effect: { id: 'sparkles' }, sound: { builtin: 'fanfare' } },
    { id: 'mine-2', name: 'Snake eyes', die: 'd6', result: { kind: 'min' }, effect: { id: 'frost' } },
  ],
};
const actors = Object.assign(
  [
    { id: 'a1', name: 'Valeros', isOwner: true, getFlag: () => ({ global: { theme: 'my-ember-not-here' } }) },
    { id: 'a2', name: 'Seelah', isOwner: true, getFlag: () => ({ global: { theme: 'dragon-hoard' } }) },
    { id: 'a3', name: 'Goblin', isOwner: false, getFlag: () => null },
  ],
  { get(id) { return this.find((a) => a.id === id); } },
);
const moduleRule = normalizeRule(
  { id: 'dsn:fireworks', name: 'Fireworks (Dice FX module)', die: 'd20', result: { kind: 'value', value: 20 }, effect: { id: 'dsn:Fireworks', color: '#ffd166' } },
  'module',
  quiet,
);
const atlas = which === 'themes' || which === 'appearance' ? await loadDigitAtlas('/assets/fonts') : null;
// The real font layer (sans atlas, computer fonts) for the appearance editor's preview.
const fonts =
  which === 'appearance'
    ? createFontAtlases({
        serif: atlas,
        loadBundled: (name) => loadDigitAtlas('/assets/fonts', `digits-${name}`),
        createWorker: createFontWorker,
        getRoute: (path) => `/${path}`,
      })
    : null;

globalThis.game = {
  user: {
    id: 'u1',
    isGM,
    getFlag: (scope, key) => userFlags[key],
    setFlag: async (scope, key, value) => {
      userFlags[key] = key === 'appearance' ? { ...userFlags[key], ...value } : value;
    },
  },
  actors,
  system: { id: 'pf2e', title: 'Pathfinder Second Edition' },
  i18n: { localize },
  settings: {
    get: (scope, key) => store[key],
    set: async (scope, key, value) => (store[key] = value),
  },
  dice3d: {
    _themeContext: () => ({ atlas, fonts }),
    _triggerContext: () => ({
      moduleRules: [moduleRule],
      triggers: [],
      modes: { Fireworks: 'Fireworks' },
      diceTypes: [],
    }),
    _damageContext: () => ({
      colorsets: ['thunder'],
      damageTypeDefaults: {},
      resolveTheme: (type, { userOverrides, worldMap }) => resolveDamageTheme(type, { userOverrides, worldMap, warn: quiet }),
    }),
    _preview: async () => {},
  },
};

// --- open the window --------------------------------------------------------------------------------
let app;
if (which === 'themes') {
  const { ThemeBrowser } = await import('../src/ui/theme-browser.js');
  app = new ThemeBrowser();
} else if (which === 'appearance') {
  const { AppearanceEditor } = await import('../src/ui/appearance-editor.js');
  app = new AppearanceEditor({ themeId: params.get('theme') ?? 'user.u1.midnight-nebula' });
} else if (which === 'triggers') {
  const { TriggerEditor } = await import('../src/ui/trigger-editor.js');
  app = new TriggerEditor();
} else {
  const { DamageMapEditor } = await import('../src/ui/damage-map-editor.js');
  app = new DamageMapEditor();
}
await app.render();

/** Resolves when every card thumbnail of the theme browser is showing (or after the timeout). */
async function thumbnailsReady(timeout = 60000) {
  const end = performance.now() + timeout;
  while (performance.now() < end) {
    const imgs = [...document.querySelectorAll('.dicer-theme-card img.dicer-thumb')];
    if (imgs.length && imgs.every((i) => !i.hidden && i.complete)) return imgs.length;
    await new Promise((r) => setTimeout(r, 100));
  }
  return [...document.querySelectorAll('.dicer-theme-card img.dicer-thumb')].filter((i) => !i.hidden).length;
}

/** Resolves once the appearance editor's live die has drawn (or after the timeout). */
async function previewReady(timeout = 30000) {
  const end = performance.now() + timeout;
  while (performance.now() < end) {
    if (document.querySelector('.dicer-ae-stage.has-live canvas.dicer-live:not([hidden])')) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

window.__editors = { app, errors, store, userFlags, thumbnailsReady, previewReady };
window.__ready = true;
