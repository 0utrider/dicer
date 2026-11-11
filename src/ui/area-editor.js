/**
 * The roll-area editor (lazy chunk, opened from the `dicer.rollAreaEditor` settings menu): a
 * full-screen DOM overlay over the usable region with one draggable, resizable rectangle (8
 * handles), a target selector (Default, each player, GM private corner), presets, Reset, Save,
 * Cancel and Esc. Only the GM edits (P5-D3); a player gets a read-only "show my area".
 *
 * Everything works in fractions: each move goes through normalizeAreaDef and is shown resolved
 * with resolveArea, so the rectangle cannot leave the stage or shrink below MIN_AREA_PX.
 * Edits are a draft per target; Save writes only the targets that were edited, so an unreadable
 * stored entry is kept unless that user's area is edited (Plan 4 precedent).
 */
import { MIN_AREA_PX, PRESETS, normalizeAreaDef, resolveArea } from '../areas/area-model.js';
import { isPlainObject, isValidDef } from '../areas/area-store.js';
import { measureUsable, watchArea } from '../foundry/area.js';

const MODULE = 'dicer';
const HANDLES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
const GM_RESET = { preset: 'corner' };
const FULL = { preset: 'full' };

const loc = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** A pixel rect (inside usable) as a normalized custom def in fractions of usable. */
function defFromRect(rect, usable) {
  return normalizeAreaDef({
    preset: 'custom',
    x: (rect.left - usable.left) / usable.width,
    y: (rect.top - usable.top) / usable.height,
    w: rect.width / usable.width,
    h: rect.height / usable.height,
  });
}

/** Moves the area by (dx, dy) px. Keeps its size and stays inside `usable`. */
export function dragTo(def, dx, dy, usable) {
  const r = resolveArea(def, usable);
  const left = clamp(r.left + dx, usable.left, usable.left + usable.width - r.width);
  const top = clamp(r.top + dy, usable.top, usable.top + usable.height - r.height);
  return defFromRect({ ...r, left, top }, usable);
}

/**
 * Moves the edges `handle` names (n, s, e, w, ne, nw, se, sw) by (dx, dy) px. An edge stops at
 * the minimum size (MIN_AREA_PX, or the whole usable region when that is smaller) and at the
 * usable region's border; the opposite edge never moves.
 */
export function resizeTo(def, handle, dx, dy, usable) {
  const r = resolveArea(def, usable);
  const minW = Math.min(MIN_AREA_PX.width, usable.width);
  const minH = Math.min(MIN_AREA_PX.height, usable.height);
  let L = r.left;
  let T = r.top;
  let R = r.left + r.width;
  let B = r.top + r.height;
  const h = String(handle);
  if (h.includes('e')) R = clamp(R + dx, L + minW, usable.left + usable.width);
  if (h.includes('w')) L = clamp(L + dx, usable.left, R - minW);
  if (h.includes('s')) B = clamp(B + dy, T + minH, usable.top + usable.height);
  if (h.includes('n')) T = clamp(T + dy, usable.top, B - minH);
  return defFromRect({ left: L, top: T, width: R - L, height: B - T }, usable);
}

const readSetting = (key) => {
  try {
    return globalThis.game?.settings?.get?.(MODULE, key);
  } catch {
    return undefined;
  }
};

/** What the editor shows for a target before it is edited: the raw stored entry, else the default's. */
function storedDefFor(target) {
  const stored = readSetting('rollAreas');
  const base = isPlainObject(stored) && isValidDef(stored.default) ? stored.default : FULL;
  if (target === 'gm') {
    const raw = readSetting('gmPrivateArea');
    return normalizeAreaDef(isValidDef(raw) ? raw : GM_RESET);
  }
  if (target.startsWith('user:') && readSetting('perPlayerAreas') !== false) {
    const id = target.slice(5);
    const users = isPlainObject(stored) ? stored.users : undefined;
    if (isPlainObject(users) && Object.hasOwn(users, id) && isValidDef(users[id]))
      return normalizeAreaDef(users[id]);
  }
  return normalizeAreaDef(base);
}

let current = null;

/** Opens the overlay (one at a time; a second call returns the open one). */
export function openAreaEditor() {
  if (current) return current;
  const doc = globalThis.document;
  const game = globalThis.game;
  const readOnly = game?.user?.isGM !== true;

  const drafts = new Map(); // target -> edited def (only edited targets are saved)
  let target = readOnly ? `user:${game?.user?.id}` : 'default';
  let usable = measureUsable();
  let drag = null; // { kind: 'move' | handle, x, y, def }
  const cleanups = [];
  const listen = (el, type, fn, opts) => {
    el.addEventListener(type, fn, opts);
    cleanups.push(() => el.removeEventListener(type, fn, opts));
  };

  const defOf = (t) => drafts.get(t) ?? storedDefFor(t);
  const currentDef = () => defOf(target);

  // --- DOM -------------------------------------------------------------------------------
  const el = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const root = el('div', 'dicer-area-editor');
  const stage = el('div', 'dicer-area-stage');
  const rectEl = el('div', 'dicer-area-rect');
  const label = el('div', 'dicer-area-label');
  rectEl.append(label);
  if (!readOnly)
    for (const h of HANDLES) {
      const n = el('div', `dicer-area-handle dicer-area-handle-${h}`);
      n.dataset.handle = h;
      rectEl.append(n);
    }
  stage.append(rectEl);

  const panel = el('div', 'dicer-area-panel');
  panel.append(el('h3', '', loc('DICER.AreaEditor.Title')));
  panel.append(el('p', 'dicer-area-hint', loc(readOnly ? 'DICER.AreaEditor.PlayerHint' : 'DICER.AreaEditor.GMHint')));
  let select = null;
  const button = (cls, text, attrs = {}) => {
    const b = el('button', cls, text);
    b.type = 'button';
    Object.assign(b.dataset, attrs);
    return b;
  };
  if (!readOnly) {
    select = el('select', 'dicer-area-target');
    select.setAttribute('aria-label', loc('DICER.AreaEditor.Target'));
    const add = (value, text) => {
      const o = el('option', '', text);
      o.value = value;
      select.append(o);
    };
    add('default', loc('DICER.AreaEditor.Default'));
    for (const u of game?.users ?? []) add(`user:${u.id}`, u.name ?? u.id);
    add('gm', loc('DICER.AreaEditor.GmCorner'));
    listen(select, 'change', () => api.select(select.value));
    panel.append(select);

    const presets = el('div', 'dicer-area-presets');
    for (const p of Object.keys(PRESETS))
      presets.append(button('', loc(`DICER.AreaEditor.Preset.${p}`), { preset: p }));
    panel.append(presets);
  }
  const actions = el('div', 'dicer-area-actions');
  if (!readOnly) {
    actions.append(button('', loc('DICER.AreaEditor.Reset'), { action: 'reset' }));
    actions.append(button('dicer-primary', loc('DICER.AreaEditor.Save'), { action: 'save' }));
  }
  actions.append(
    button('', loc(readOnly ? 'DICER.AreaEditor.Close' : 'DICER.AreaEditor.Cancel'), { action: 'cancel' }),
  );
  panel.append(actions);
  root.append(stage, panel);

  // --- layout / render -------------------------------------------------------------------
  const scale = () => {
    const s = Number(readSetting('areaScale'));
    return Number.isFinite(s) ? s : 1;
  };
  function layout() {
    Object.assign(root.style, {
      left: `${usable.left}px`,
      top: `${usable.top}px`,
      width: `${usable.width}px`,
      height: `${usable.height}px`,
    });
  }
  function render() {
    // A player's preview is what their screen really uses (their scale); the GM edits the raw fractions.
    const r = resolveArea(currentDef(), usable, { scale: readOnly ? scale() : 1 });
    Object.assign(rectEl.style, {
      left: `${r.left - usable.left}px`,
      top: `${r.top - usable.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
    label.textContent = `${Math.round(r.width)} x ${Math.round(r.height)}`;
    if (select) select.value = target;
  }

  // --- pointer handling ------------------------------------------------------------------
  const point = (e) => ({ x: e.clientX, y: e.clientY });
  function onDown(e) {
    if (readOnly) return;
    const handle = e.target?.dataset?.handle;
    const onRect = e.target === rectEl || e.target === label;
    if (!handle && !onRect) return;
    e.preventDefault?.();
    drag = { kind: handle ?? 'move', ...point(e), def: currentDef() };
  }
  function onMove(e) {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drafts.set(
      target,
      drag.kind === 'move'
        ? dragTo(drag.def, dx, dy, usable)
        : resizeTo(drag.def, drag.kind, dx, dy, usable),
    );
    render();
  }
  const onUp = () => {
    drag = null;
  };
  listen(rectEl, 'pointerdown', onDown);
  listen(doc, 'pointermove', onMove);
  listen(doc, 'pointerup', onUp);
  listen(doc, 'pointercancel', onUp);
  listen(
    doc,
    'keydown',
    (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault?.();
      e.stopPropagation?.();
      api.close();
    },
    true,
  );
  listen(panel, 'click', (e) => {
    const b = e.target?.closest?.('button');
    if (!b) return;
    if (b.dataset.preset) api.setDef({ preset: b.dataset.preset });
    else if (b.dataset.action === 'reset') api.setDef(target === 'gm' ? GM_RESET : FULL);
    else if (b.dataset.action === 'save') api.save();
    else if (b.dataset.action === 'cancel') api.close();
  });
  const stopWatch = watchArea(() => {
    usable = measureUsable();
    layout();
    render();
  });
  cleanups.push(stopWatch);

  // --- API -------------------------------------------------------------------------------
  const api = {
    readOnly,
    el: root,
    currentDef: () => ({ ...currentDef() }),
    select(t) {
      target = t;
      render();
    },
    setDef(def) {
      if (readOnly) return;
      drafts.set(target, normalizeAreaDef(def));
      render();
    },
    /** Writes each edited target through game.dice3d.rollAreas. Resolves true when all were saved. */
    async save() {
      if (readOnly || globalThis.game?.user?.isGM !== true) return false;
      const areas = globalThis.game?.dice3d?.rollAreas;
      let ok = Boolean(areas);
      for (const [t, def] of drafts) {
        if (!ok) break;
        if (t === 'gm') ok = (await areas.setGmPrivateArea(def)) === true;
        else if (t === 'default') ok = (await areas.set(null, def)) === true;
        else if (t.startsWith('user:')) ok = (await areas.set(t.slice(5), def)) === true;
      }
      if (!ok) {
        globalThis.ui?.notifications?.warn?.(loc('DICER.AreaEditor.SaveFailed'));
        return false;
      }
      api.close();
      return true;
    },
    close() {
      if (current !== api) return;
      current = null;
      for (const fn of cleanups.splice(0)) fn();
      root.remove();
    },
  };

  doc.body.append(root);
  layout();
  render();
  current = api;
  return api;
}
