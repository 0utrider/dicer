/**
 * The JB2A animation picker (appearance editor, film button): an overlay over Sequencer's database
 * (`Sequencer.Database`). A sidebar lists the categories (`explosion`, `impact`, ...), the main area
 * shows one tile per animation with its colour variants folded into swatches, and each tile plays
 * its video on hover. A pick resolves to the variant's file path (what Dicer stores, so playback
 * never needs Sequencer); closing resolves null. Without Sequencer the caller uses Foundry's file
 * picker.
 */

/** Tiles drawn at first; "Show more" adds this many again. */
export const PAGE = 60;

const loc = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;
const FEET = /\.[0-9]+ft\.*/;
const INDEX = /\.[0-9]$/;

/** Colour words JB2A uses in its last path segment; the shades only count next to a colour. */
const COLORS = {
  blue: '#3f7cff',
  green: '#3fcf6a',
  purple: '#9a55ff',
  red: '#e8403a',
  yellow: '#f5d442',
  orange: '#ff8a2a',
  white: '#f2f2f2',
  pink: '#ff6fc1',
  grey: '#8c8c8c',
  gray: '#8c8c8c',
  teal: '#2bc4b4',
  black: '#262626',
  brown: '#8a5a32',
  rainbow: 'rainbow',
  multicolored: 'rainbow',
};
const SHADES = ['dark', 'bright', 'light'];
const WORDS = [...SHADES, ...Object.keys(COLORS)].sort((a, b) => b.length - a.length);

/** The colour words of a path segment (`dark_greenpurple` → ['dark', 'green', 'purple']), or null. */
export function colorWords(segment) {
  let rest = String(segment ?? '')
    .toLowerCase()
    .replace(/_/g, '');
  const out = [];
  while (rest) {
    const w = WORDS.find((x) => rest.startsWith(x));
    if (!w) return null;
    out.push(w);
    rest = rest.slice(w.length);
  }
  return out.some((w) => COLORS[w]) ? out : null;
}

/** A CSS background for a swatch: one colour, a split of several, darker or brighter with a shade. */
export function swatchCss(words) {
  const hues = words.filter((w) => COLORS[w]).map((w) => COLORS[w]);
  if (hues.includes('rainbow')) return 'conic-gradient(#e8403a, #f5d442, #3fcf6a, #3f7cff, #9a55ff, #e8403a)';
  const mix = words.includes('dark') ? 'black 40%' : words.includes('bright') || words.includes('light') ? 'white 25%' : null;
  const c = hues.map((h) => (mix ? `color-mix(in srgb, ${h}, ${mix})` : h));
  if (c.length === 1) return c[0];
  const step = 100 / c.length;
  return `linear-gradient(135deg, ${c.map((h, i) => `${h} ${i * step}% ${(i + 1) * step}%`).join(', ')})`;
}

/** Sequencer's database when Sequencer is active, else null. */
export function sequencerDatabase() {
  const active = globalThis.game?.modules?.get?.('sequencer')?.active === true;
  const db = active ? globalThis.Sequencer?.Database : null;
  return db && typeof db.getEntry === 'function' ? db : null;
}

/** The JB2A database paths (both JB2A modules register under `jb2a`), without sizes or indexes, sorted. */
export function jb2aEntries(db) {
  let all;
  try {
    all = db?.publicFlattenedEntries ?? db?.flattenedEntries ?? [];
  } catch {
    all = [];
  }
  const out = new Set();
  for (const e of Array.isArray(all) ? all : []) {
    if (typeof e !== 'string' || !e.startsWith('jb2a.')) continue;
    out.add(e.split(FEET)[0].replace(INDEX, ''));
  }
  return [...out].sort();
}

/**
 * Entries folded into animations: `jb2a.explosion.01.blue` and `.orange` become one group
 * { key: 'jb2a.explosion.01', category: 'explosion', label: '01', variants: [{ name, words, path }] }.
 * An entry without a colour segment is a group of its own with one unnamed variant.
 */
export function groupEntries(entries) {
  const groups = new Map();
  for (const path of entries) {
    const parts = path.split('.');
    const last = parts.at(-1);
    const words = parts.length > 2 ? colorWords(last) : null;
    const key = words ? parts.slice(0, -1).join('.') : path;
    let g = groups.get(key);
    if (!g) {
      const kp = key.split('.');
      groups.set(key, (g = { key, category: kp[1] ?? '', label: kp.slice(2).join('.') || kp[1] || key, variants: [] }));
    }
    g.variants.push({ name: words ? last : '', words: words ?? [], path });
  }
  return [...groups.values()];
}

/** Categories with their animation counts, in name order. */
export function categoriesOf(groups) {
  const counts = new Map();
  for (const g of groups) counts.set(g.category, (counts.get(g.category) ?? 0) + 1);
  return [...counts].sort((a, b) => a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count }));
}

/** Groups in a category ('' = all) whose path or colour names contain every word of `query`. */
export function filterGroups(groups, category, query) {
  const words = String(query ?? '')
    .toLowerCase()
    .split(/[\s.]+/)
    .filter(Boolean);
  return groups.filter((g) => {
    if (category && g.category !== category) return false;
    if (!words.length) return true;
    const text = `${g.key} ${g.variants.map((v) => v.name).join(' ')}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

const fileOf = (x) => (typeof x === 'string' ? x : typeof x?.file === 'string' ? x.file : null);

/**
 * The .webm file a database path plays, chosen as Sequencer's own "copy file path" does: the first
 * of several entries, the middle of a size range. Null when it has no .webm file.
 */
export function resolveFile(db, dbPath) {
  let entry;
  try {
    entry = db.getEntry(dbPath, { softFail: true });
  } catch {
    return null;
  }
  if (Array.isArray(entry)) entry = entry[0];
  if (!entry) return null;
  let file = null;
  try {
    const files = typeof entry.getAllFiles === 'function' ? entry.getAllFiles() : null;
    if (Array.isArray(files) && files.length) file = fileOf(files[Math.floor((files.length - 1) / 2)]);
  } catch {
    // a single file
  }
  file ??= fileOf(entry);
  if (!file && entry.file && typeof entry.file === 'object') {
    const values = Object.values(entry.file).map(fileOf).filter(Boolean);
    file = values[Math.floor((values.length - 1) / 2)] ?? null;
  }
  return file && /\.webm$/i.test(file) ? file : null;
}

function el(tag, props = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v);
  }
  for (const c of children) n.append(c);
  return n;
}

const humanize = (s) => String(s).replace(/_/g, ' ');

/**
 * Opens the picker over the page.
 * @param {object} db Sequencer's database
 * @param {{current?: string}} [opts] the stored file, shown as the current pick
 * @returns {Promise<string|null>} the chosen file path, or null when closed
 */
export function pickJb2a(db, { current = '' } = {}) {
  const groups = groupEntries(jb2aEntries(db));
  const files = new Map(); // path -> file | null, resolved once
  const fileFor = (path) => {
    if (!files.has(path)) files.set(path, resolveFile(db, path));
    return files.get(path);
  };

  return new Promise((resolve) => {
    let category = '';
    let shown = PAGE;
    let selected = null; // { path, file }

    const search = el('input', { type: 'search', class: 'dicer-jp-search', placeholder: loc('DICER.Jb2aPicker.Search'), 'aria-label': loc('DICER.Jb2aPicker.Search') });
    const cats = el('ul', { class: 'dicer-jp-cats', role: 'listbox', 'aria-label': loc('DICER.Jb2aPicker.Categories') });
    const grid = el('div', { class: 'dicer-jp-grid', role: 'listbox', 'aria-label': loc('DICER.Jb2aPicker.Title') });
    const more = el('button', { type: 'button', class: 'dicer-jp-more', 'data-jp': 'more' });
    const status = el('p', { class: 'dicer-jp-status' });
    const choose = el('button', { type: 'button', class: 'dicer-jp-choose', 'data-jp': 'choose' }, [el('i', { class: 'fa-solid fa-check' }), ` ${loc('DICER.Jb2aPicker.Choose')}`]);
    const close = el('button', { type: 'button', class: 'dicer-jp-close', 'data-jp': 'cancel', 'aria-label': loc('DICER.Jb2aPicker.Cancel') }, [el('i', { class: 'fa-solid fa-xmark' })]);
    const box = el('div', { class: 'dicer-jp-box', role: 'dialog', 'aria-modal': 'true', 'aria-label': loc('DICER.Jb2aPicker.Title') }, [
      el('header', { class: 'dicer-jp-head' }, [el('h2', { text: loc('DICER.Jb2aPicker.Title') }), search, close]),
      el('div', { class: 'dicer-jp-body' }, [cats, el('div', { class: 'dicer-jp-main' }, [grid, more])]),
      el('footer', { class: 'dicer-jp-foot' }, [status, el('button', { type: 'button', 'data-jp': 'cancel' }, [loc('DICER.Jb2aPicker.Cancel')]), choose]),
    ]);
    const root = el('div', { class: 'dicer-jp' }, [box]);

    // Tiles load their video only once scrolled into view (all at once without IntersectionObserver).
    const IO = globalThis.IntersectionObserver;
    const observer = IO
      ? new IO(
          (seen) => {
            for (const s of seen) {
              if (!s.isIntersecting) continue;
              observer.unobserve(s.target);
              load(s.target);
            }
          },
          { root: grid, rootMargin: '200px' },
        )
      : null;
    function load(tile) {
      const video = tile.querySelector('video');
      const file = fileFor(tile.dataset.path);
      // #t: the first frames of many JB2A files are empty; show a moment in as the still.
      if (file && video.dataset.file !== file) {
        video.dataset.file = file;
        video.src = `${file}#t=0.6`;
      }
    }

    const updateStatus = () => {
      choose.disabled = !selected;
      status.textContent = selected ? selected.path.replace(/^jb2a\./, '') : current ? `${loc('DICER.Jb2aPicker.Current')}: ${current.split('/').pop()}` : '';
    };
    const select = (path) => {
      const file = fileFor(path);
      if (!file) return false;
      selected = { path, file };
      for (const t of grid.querySelectorAll('.dicer-jp-tile')) {
        const on = t.dataset.key === path || [...t.querySelectorAll('[data-variant]')].some((s) => s.dataset.variant === path);
        t.setAttribute('aria-selected', String(on));
      }
      for (const s of grid.querySelectorAll('[data-variant]')) s.setAttribute('aria-pressed', String(s.dataset.variant === path));
      updateStatus();
      return true;
    };

    function tileOf(g) {
      const first = g.variants.find((v) => v.path === selected?.path) ?? g.variants[0];
      const video = el('video', { muted: '', loop: '', playsinline: '', preload: 'metadata' });
      video.muted = true;
      const swatches = g.variants.some((v) => v.name)
        ? el(
            'div',
            { class: 'dicer-jp-swatches' },
            g.variants.map((v) => {
              const s = el('button', { type: 'button', class: 'dicer-jp-swatch', 'data-variant': v.path, 'aria-pressed': String(selected?.path === v.path), 'aria-label': humanize(v.name), 'data-tooltip': humanize(v.name) });
              s.style.background = swatchCss(v.words);
              return s;
            }),
          )
        : null;
      const tile = el(
        'div',
        { class: 'dicer-jp-tile', role: 'option', tabindex: '0', 'data-key': g.key, 'data-path': first.path, 'aria-selected': String(g.variants.some((v) => v.path === selected?.path)) },
        [el('div', { class: 'dicer-jp-thumb' }, [video]), el('div', { class: 'dicer-jp-label', text: humanize(category ? g.label : `${g.category} · ${g.label}`), title: g.key }), ...(swatches ? [swatches] : [])],
      );
      return tile;
    }

    function drawCats() {
      const total = groups.length;
      const all = [{ name: '', count: total }, ...categoriesOf(filterGroups(groups, '', search.value))];
      cats.replaceChildren(
        ...all.map((c) =>
          el('li', { role: 'option', tabindex: '0', 'data-cat': c.name, 'aria-selected': String(c.name === category) }, [
            el('span', { text: c.name ? humanize(c.name) : loc('DICER.Jb2aPicker.All') }),
            el('em', { text: String(c.name ? c.count : filterGroups(groups, '', search.value).length) }),
          ]),
        ),
      );
    }
    function drawGrid() {
      const found = filterGroups(groups, category, search.value);
      observer?.disconnect();
      const tiles = found.slice(0, shown).map(tileOf);
      grid.replaceChildren(...tiles);
      if (!found.length) grid.append(el('p', { class: 'dicer-jp-none', text: loc('DICER.Jb2aPicker.None') }));
      for (const t of tiles) {
        if (observer) observer.observe(t);
        else load(t);
      }
      const left = found.length - Math.min(shown, found.length);
      more.hidden = left <= 0;
      more.textContent = loc('DICER.Jb2aPicker.More').replace('{count}', String(left));
    }
    const redraw = () => {
      shown = PAGE;
      drawCats();
      drawGrid();
      grid.scrollTop = 0;
    };

    const finish = (value) => {
      observer?.disconnect();
      for (const v of root.querySelectorAll('video')) {
        try {
          v.pause?.();
        } catch {
          // gone
        }
        v.removeAttribute('src');
      }
      root.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(value);
    };
    const onKey = (ev) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        finish(null);
      } else if (ev.key === 'Enter' && ev.target !== search) {
        const tile = ev.target.closest?.('.dicer-jp-tile');
        const cat = ev.target.closest?.('[data-cat]');
        if (tile) select(tile.dataset.path);
        else if (cat) {
          category = cat.dataset.cat;
          redraw();
        } else if (selected) finish(selected.file);
      }
    };

    search.addEventListener('input', redraw);
    cats.addEventListener('click', (ev) => {
      const li = ev.target.closest?.('[data-cat]');
      if (!li) return;
      category = li.dataset.cat;
      redraw();
    });
    grid.addEventListener('click', (ev) => {
      const sw = ev.target.closest?.('[data-variant]');
      const tile = ev.target.closest?.('.dicer-jp-tile');
      if (!tile) return;
      if (sw) {
        tile.dataset.path = sw.dataset.variant;
        load(tile);
        tile.querySelector('video')?.play?.()?.catch?.(() => {});
      }
      select(tile.dataset.path);
    });
    grid.addEventListener('dblclick', (ev) => {
      const tile = ev.target.closest?.('.dicer-jp-tile');
      if (tile && !ev.target.closest('[data-variant]') && select(tile.dataset.path)) finish(selected.file);
    });
    grid.addEventListener('mouseover', (ev) => {
      const tile = ev.target.closest?.('.dicer-jp-tile');
      if (!tile || tile.contains(ev.relatedTarget)) return;
      load(tile);
      Promise.resolve(tile.querySelector('video')?.play?.()).catch(() => {});
    });
    grid.addEventListener('mouseout', (ev) => {
      const tile = ev.target.closest?.('.dicer-jp-tile');
      if (!tile || tile.contains(ev.relatedTarget)) return;
      const v = tile.querySelector('video');
      try {
        v?.pause?.();
        if (v) v.currentTime = 0.6;
      } catch {
        // not seekable yet
      }
    });
    root.addEventListener('click', (ev) => {
      const act = ev.target.closest?.('[data-jp]')?.dataset.jp;
      if (act === 'cancel' || ev.target === root) finish(null);
      else if (act === 'choose' && selected) finish(selected.file);
      else if (act === 'more') {
        shown += PAGE;
        drawGrid();
      }
    });
    document.addEventListener('keydown', onKey, true);

    redraw();
    updateStatus();
    document.body.append(root);
    search.focus();
  });
}
