/**
 * The Dice tray window (lazy chunk; Configure Settings, Dicer, Dice tray): the look of this
 * player's own tray or, for a GM, the table tray everyone on "Table tray" sees. Every change is
 * saved (debounced) and the tray on screen follows at once; where it sits is set by dragging its
 * rim on the table. Pure helpers (trayForm, applyField) are exported for the tests.
 */
import {
  normalizeTray,
  DEFAULT_TRAY,
  TRAY_SURFACES,
  TRAY_RIMS,
  TRAY_DESIGNS,
  TRAY_SHAPES,
  trayStyle,
  normalizeTrayPresets,
  STITCH_SVG,
} from '../tray/tray-model.js';

const MODULE = 'dicer';
const SAVE_MS = 250;
const loc = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;
const setting = (key) => {
  try {
    return globalThis.game.settings.get(MODULE, key);
  } catch {
    return undefined;
  }
};
const isGM = () => globalThis.game?.user?.isGM === true;
const routeOf = (url) =>
  /^([a-z][a-z0-9+.-]*:|\/)/i.test(url) ? url : (globalThis.foundry?.utils?.getRoute?.(url) ?? url);

/** Paints `el` (a .dicer-tt) as `look`: the live preview at the top of the window. */
export function paintPreview(el, look) {
  if (!el.querySelector('.dicer-tt-skin')) {
    const skin = document.createElement('div');
    skin.className = 'dicer-tt-skin';
    const stitch = document.createElement('div'); // a leather rim's stitches along the shape
    stitch.className = 'dicer-tt-stitch';
    stitch.innerHTML = STITCH_SVG;
    skin.append(stitch);
    el.prepend(skin);
  }
  el.dataset.surface = look.surface;
  el.dataset.rim = look.rim.style;
  el.dataset.shape = look.shape;
  for (const [k, v] of Object.entries(trayStyle(look, routeOf))) el.style.setProperty(k, v);
}
/** A slider's readout: percent for fractions, px otherwise. */
export const rangeText = (field, value) =>
  ['design.size', 'design.opacity'].includes(field)
    ? `${Math.round(Number(value) * 100)}%`
    : `${Math.round(Number(value))} px`;

const SURFACE_ICONS = {
  felt: 'fa-square',
  wood: 'fa-tree',
  stone: 'fa-mountain',
  leather: 'fa-briefcase',
  metal: 'fa-shield-halved',
  image: 'fa-image',
};
const SHAPE_ICONS = {
  rect: 'fa-square',
  round: 'fa-circle',
  hex: 'fa-hexagon',
  octagon: 'fa-octagon',
};
const SHAPE_LABELS = {
  rect: 'DICER.DiceTray.Shape.rect',
  round: 'DICER.DiceTray.Shape.round',
  hex: 'DICER.DiceTray.Shape.hex',
  octagon: 'DICER.DiceTray.Shape.octagon',
};
const DESIGN_ICONS = {
  none: 'fa-ban',
  sigil: 'fa-star-of-david',
  moon: 'fa-moon',
  compass: 'fa-compass',
  skull: 'fa-skull',
  custom: 'fa-image',
};
// Literal keys (the lang test scans them).
const SURFACE_LABELS = {
  felt: 'DICER.DiceTray.Surface.felt',
  wood: 'DICER.DiceTray.Surface.wood',
  stone: 'DICER.DiceTray.Surface.stone',
  leather: 'DICER.DiceTray.Surface.leather',
  metal: 'DICER.DiceTray.Surface.metal',
  image: 'DICER.DiceTray.Surface.image',
};
const RIM_LABELS = {
  plain: 'DICER.DiceTray.Rim.plain',
  wood: 'DICER.DiceTray.Rim.wood',
  leather: 'DICER.DiceTray.Rim.leather',
  stone: 'DICER.DiceTray.Rim.stone',
  metal: 'DICER.DiceTray.Rim.metal',
};
const DESIGN_LABELS = {
  none: 'DICER.DiceTray.Design.none',
  sigil: 'DICER.DiceTray.Design.sigil',
  moon: 'DICER.DiceTray.Design.moon',
  compass: 'DICER.DiceTray.Design.compass',
  skull: 'DICER.DiceTray.Design.skull',
  custom: 'DICER.DiceTray.Design.custom',
};

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

/** The look a target ('mine' | 'table') starts from: its stored look, else the table's, else the default. */
export function startingLook(target, { mine, table } = {}) {
  const own = target === 'table' ? table : mine;
  return normalizeTray(own ?? table ?? DEFAULT_TRAY);
}

/** The design choice a look shows: none, a built-in one, or custom (a picture path). */
export const designChoice = (look) =>
  !look.design.src ? 'none' : TRAY_DESIGNS.includes(look.design.src) ? look.design.src : 'custom';

/** A look with one form field changed (`field` a dotted path, `value` as the control gives it). */
export function applyField(look, field, value) {
  const next = structuredClone(look);
  const numeric = ['rim.width', 'radius', 'design.size', 'design.opacity'];
  const v = numeric.includes(field) ? Number(value) : value;
  if (field === 'design.choice')
    next.design.src =
      v === 'none'
        ? ''
        : v === 'custom'
          ? next.design.src && !TRAY_DESIGNS.includes(next.design.src)
            ? next.design.src
            : ''
          : v;
  else {
    const [a, b] = field.split('.');
    if (b) next[a] = { ...next[a], [b]: v };
    else next[a] = v;
  }
  return normalizeTray(next);
}

/**
 * The window's content for `look`, edited for `target`. `pickingImage` / `pickingDesign`: the Image
 * surface or a custom design was chosen and its picture is still to come.
 */
export function trayForm(
  look,
  target,
  { gm = false, pickingImage = false, pickingDesign = false, presets = [] } = {},
) {
  const chips = (field, list, current, labels, icons) =>
    h(
      'div',
      { class: 'dicer-tt-chips', role: 'radiogroup' },
      list.map((id) =>
        h(
          'button',
          {
            type: 'button',
            class: `dicer-tt-chip${id === current ? ' active' : ''}`,
            role: 'radio',
            'aria-checked': String(id === current),
            'data-field': field,
            'data-value': id,
          },
          [
            ...(icons?.[id]
              ? [h('i', { class: `fa-solid ${icons[id]}`, 'aria-hidden': 'true' })]
              : []),
            h('span', { text: loc(labels[id]) }),
          ],
        ),
      ),
    );
  const row = (label, control) =>
    h('label', { class: 'dicer-tt-row' }, [h('span', { text: loc(label) }), control]);
  const range = (field, min, max, step, value) =>
    h('span', { class: 'dicer-tt-range' }, [
      h('input', {
        type: 'range',
        'data-field': field,
        min: String(min),
        max: String(max),
        step: String(step),
        value: String(value),
      }),
      h('output', { 'data-for': field, text: rangeText(field, value) }),
    ]);
  const section = (title, kids) =>
    h('section', { class: 'dicer-tt-section' }, [h('h3', { text: loc(title) }), ...kids]);
  const colour = (field, value) => h('input', { type: 'color', 'data-field': field, value });
  const path = (field, value, kind) =>
    h('span', { class: 'dicer-tt-path' }, [
      h('input', { type: 'text', 'data-field': field, value, placeholder: 'worlds/…/tray.webp' }),
      h(
        'button',
        {
          type: 'button',
          'data-browse': field,
          'data-kind': kind,
          'aria-label': loc('DICER.DiceTray.Browse'),
        },
        [h('i', { class: 'fa-solid fa-folder-open' })],
      ),
    ]);
  // a saved tray's little picture: the tray itself, small
  const swatch = (l) => {
    const el = h('span', { class: 'dicer-tt dicer-tt-swatch', 'aria-hidden': 'true' });
    paintPreview(el, l);
    return el;
  };
  const design = pickingDesign ? 'custom' : designChoice(look);
  const surface = pickingImage ? 'image' : look.surface;
  const preview = h('div', { class: 'dicer-tt dicer-tt-preview', 'aria-hidden': 'true' });
  paintPreview(preview, look);
  return h('form', { class: 'dicer-tt-editor' }, [
    h('div', { class: 'dicer-tt-stage' }, [preview]),
    h('p', { class: 'dicer-hint', text: loc('DICER.DiceTray.Hint') }),
    ...(gm
      ? [
          h('div', { class: 'dicer-segmented dicer-tt-target' }, [
            h('button', {
              type: 'button',
              class: target === 'mine' ? 'active' : '',
              'data-target': 'mine',
              text: loc('DICER.DiceTray.EditMine'),
            }),
            h('button', {
              type: 'button',
              class: target === 'table' ? 'active' : '',
              'data-target': 'table',
              text: loc('DICER.DiceTray.EditTable'),
            }),
          ]),
        ]
      : []),
    // the GM's saved trays: a player takes one as their own; the GM saves the look shown, or drops one
    ...(presets.length || gm
      ? [
          section('DICER.DiceTray.PresetsTitle', [
            ...(presets.length
              ? [
                  h(
                    'div',
                    { class: 'dicer-tt-presets' },
                    presets.map((p) =>
                      h('span', { class: 'dicer-tt-preset' }, [
                        h('button', { type: 'button', 'data-preset': p.id }, [
                          swatch(p.look),
                          h('span', { text: p.name }),
                        ]),
                        ...(gm
                          ? [
                              h(
                                'button',
                                {
                                  type: 'button',
                                  class: 'dicer-tt-preset-del',
                                  'data-preset-del': p.id,
                                  'aria-label': loc('DICER.DiceTray.PresetDelete'),
                                },
                                [h('i', { class: 'fa-solid fa-xmark', 'aria-hidden': 'true' })],
                              ),
                            ]
                          : []),
                      ]),
                    ),
                  ),
                ]
              : []),
            h('p', {
              class: 'dicer-hint',
              text: loc(gm ? 'DICER.DiceTray.PresetsHintGM' : 'DICER.DiceTray.PresetsHint'),
            }),
            ...(gm
              ? [
                  h('span', { class: 'dicer-tt-path' }, [
                    h('input', {
                      type: 'text',
                      class: 'dicer-tt-preset-name',
                      maxlength: '40',
                      placeholder: loc('DICER.DiceTray.PresetName'),
                    }),
                    h('button', { type: 'button', 'data-act': 'save-preset' }, [
                      h('i', { class: 'fa-solid fa-floppy-disk', 'aria-hidden': 'true' }),
                      ` ${loc('DICER.DiceTray.PresetSave')}`,
                    ]),
                  ]),
                ]
              : []),
          ]),
        ]
      : []),
    section('DICER.DiceTray.ShapeTitle', [
      chips('shape', TRAY_SHAPES, look.shape, SHAPE_LABELS, SHAPE_ICONS),
    ]),
    section('DICER.DiceTray.SurfaceTitle', [
      chips('surface', TRAY_SURFACES, surface, SURFACE_LABELS, SURFACE_ICONS),
      surface === 'image'
        ? row('DICER.DiceTray.Image', path('image', look.image, 'image'))
        : row('DICER.DiceTray.Color', colour('color', look.color)),
    ]),
    section('DICER.DiceTray.RimTitle', [
      chips('rim.style', TRAY_RIMS, look.rim.style, RIM_LABELS),
      row('DICER.DiceTray.RimColor', colour('rim.color', look.rim.color)),
      row('DICER.DiceTray.RimWidth', range('rim.width', 0, 40, 1, look.rim.width)),
      ...(look.shape === 'rect'
        ? [row('DICER.DiceTray.Corners', range('radius', 0, 80, 1, look.radius))]
        : []),
    ]),
    section('DICER.DiceTray.DesignTitle', [
      chips(
        'design.choice',
        ['none', ...TRAY_DESIGNS, 'custom'],
        design,
        DESIGN_LABELS,
        DESIGN_ICONS,
      ),
      ...(design === 'custom'
        ? [row('DICER.DiceTray.DesignImage', path('design.src', look.design.src, 'image'))]
        : []),
      ...(design !== 'none'
        ? [
            row('DICER.DiceTray.DesignColor', colour('design.color', look.design.color)),
            row('DICER.DiceTray.DesignSize', range('design.size', 0.15, 1, 0.05, look.design.size)),
            row(
              'DICER.DiceTray.DesignOpacity',
              range('design.opacity', 0, 1, 0.05, look.design.opacity),
            ),
          ]
        : []),
    ]),
    h('p', {
      class: 'dicer-hint',
      text: loc(target === 'table' ? 'DICER.DiceTray.TableNote' : 'DICER.DiceTray.MineNote'),
    }),
    h('div', { class: 'dicer-tt-actions' }, [
      // the tray, with the dice, in a window of its own (to drag onto another screen)
      h('button', { type: 'button', 'data-act': 'popout' }, [
        h('i', { class: 'fa-solid fa-up-right-from-square' }),
        ` ${loc('DICER.DiceTray.PopOut')}`,
      ]),
      h('button', { type: 'button', 'data-act': 'reset-place' }, [
        h('i', { class: 'fa-solid fa-arrows-to-dot' }),
        ` ${loc('DICER.DiceTray.ResetPlace')}`,
      ]),
      ...(target === 'table'
        ? [
            h('button', { type: 'button', 'data-act': 'remove-table' }, [
              h('i', { class: 'fa-solid fa-trash' }),
              ` ${loc('DICER.DiceTray.RemoveTable')}`,
            ]),
          ]
        : []),
    ]),
  ]);
}

let app = null;

/** Opens (or brings forward) the Dice tray window. */
export function openTrayEditor() {
  const { ApplicationV2 } = globalThis.foundry.applications.api;
  class TrayEditor extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: 'dicer-tt-editor',
      classes: ['dicer-tt-editor-app'],
      window: { title: 'DICER.DiceTray.Title', icon: 'fa-solid fa-chess-board', resizable: true },
      position: { width: 460, height: 'auto' },
    };
    #target = 'mine';
    #look = null;
    #timer = null;
    #pickingImage = false;
    #pickingDesign = false;
    #lookFor(target) {
      return startingLook(target, { mine: setting('myTray'), table: setting('tableTray') });
    }
    async _renderHTML() {
      this.#look ??= this.#lookFor(this.#target);
      const presets = normalizeTrayPresets(setting('trayPresets'));
      const form = trayForm(this.#look, this.#target, {
        presets,
        gm: isGM(),
        pickingImage: this.#pickingImage && this.#look.surface !== 'image',
        pickingDesign: this.#pickingDesign && designChoice(this.#look) !== 'custom',
      });
      return form;
    }
    _onRender(context, options) {
      super._onRender?.(context, options);
      globalThis.Hooks?.callAll('dicerTrayEditing', true); // the tray shows while this is open
    }
    _onClose(options) {
      super._onClose?.(options);
      globalThis.Hooks?.callAll('dicerTrayEditing', false);
    }
    _replaceHTML(result, content) {
      content.replaceChildren(result);
      result.addEventListener('click', (e) => this.#onClick(e));
      result.addEventListener('input', (e) => this.#onField(e.target, false));
      result.addEventListener('change', (e) => this.#onField(e.target, true));
    }
    #save() {
      clearTimeout(this.#timer);
      const look = this.#look;
      const target = this.#target;
      this.#timer = setTimeout(async () => {
        const s = globalThis.game.settings;
        try {
          if (target === 'table') await s.set(MODULE, 'tableTray', look);
          else {
            await s.set(MODULE, 'myTray', look);
            // editing your own tray means using it
            if (setting('trayMode') !== 'mine') await s.set(MODULE, 'trayMode', 'mine');
          }
        } catch {
          globalThis.ui?.notifications?.warn(loc('DICER.DiceTray.SaveFailed'));
        }
      }, SAVE_MS);
    }
    #onField(el, committed) {
      const field = el?.dataset?.field;
      if (!field || el.type === 'button') return;
      if (el.type === 'text' && !committed) return; // a path saves once typed out
      this.#look = applyField(this.#look, field, el.value);
      // a typed picture path for the Image surface: the surface becomes the picture
      if (field === 'image' && this.#look.image)
        this.#look = applyField(this.#look, 'surface', 'image');
      const root = el.closest('form');
      const out = root?.querySelector(`output[data-for="${field}"]`);
      if (out) out.textContent = rangeText(field, el.value);
      const preview = root?.querySelector('.dicer-tt-preview');
      if (preview) paintPreview(preview, this.#look);
      this.#save();
    }
    async #onClick(event) {
      const b = event.target.closest?.('button');
      if (!b) return;
      if (b.dataset.target && isGM()) {
        this.#target = b.dataset.target;
        this.#look = this.#lookFor(this.#target);
        return void this.render();
      }
      if (b.dataset.field) {
        if (b.dataset.field === 'surface') this.#pickingImage = b.dataset.value === 'image';
        if (b.dataset.field === 'design.choice') this.#pickingDesign = b.dataset.value === 'custom';
        this.#look = applyField(this.#look, b.dataset.field, b.dataset.value);
        this.#save();
        return void this.render();
      }
      if (b.dataset.browse) {
        const FP =
          globalThis.foundry?.applications?.apps?.FilePicker?.implementation ??
          globalThis.FilePicker;
        if (!FP) return;
        const field = b.dataset.browse;
        new FP({
          type: 'image',
          callback: (picked) => {
            this.#look = applyField(this.#look, field === 'image' ? 'image' : 'design.src', picked);
            if (field === 'image') this.#look = applyField(this.#look, 'surface', 'image');
            this.#save();
            this.render();
          },
        }).render(true);
        return;
      }
      const s = globalThis.game.settings;
      const presets = normalizeTrayPresets(setting('trayPresets'));
      if (b.dataset.preset) {
        // take a saved tray as the look edited (yours, or the table's for a GM on that tab)
        const p = presets.find((x) => x.id === b.dataset.preset);
        if (!p) return;
        this.#look = normalizeTray(p.look);
        this.#save();
        return void this.render();
      }
      if (b.dataset.presetDel && isGM()) {
        await s.set(
          MODULE,
          'trayPresets',
          presets.filter((x) => x.id !== b.dataset.presetDel),
        );
        return void this.render();
      }
      if (b.dataset.act === 'save-preset' && isGM()) {
        const input = b.closest('form')?.querySelector('.dicer-tt-preset-name');
        const name =
          input?.value?.trim() || `${loc('DICER.DiceTray.PresetDefault')} ${presets.length + 1}`;
        const id = globalThis.foundry?.utils?.randomID?.() ?? `tray-${Date.now()}`;
        const next = normalizeTrayPresets([...presets, { id, name, look: this.#look }]);
        await s.set(MODULE, 'trayPresets', next);
        return void this.render();
      }
      if (b.dataset.act === 'popout') return void globalThis.Hooks?.callAll('dicerTrayPopOut');
      if (b.dataset.act === 'reset-place') await s.set(MODULE, 'trayRect', null);
      if (b.dataset.act === 'remove-table' && isGM()) {
        await s.set(MODULE, 'tableTray', null);
        this.#look = this.#lookFor('table');
        this.render();
      }
    }
  }
  if (!app) app = new TrayEditor();
  app.render({ force: true });
  return app;
}
