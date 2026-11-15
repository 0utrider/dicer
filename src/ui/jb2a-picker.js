/**
 * The JB2A animation picker (appearance editor, film button): a small overlay over Sequencer's
 * database (`Sequencer.Database`), with a search box, the matching `jb2a.*` entries and a video
 * preview. A pick resolves to the entry's file path (what Dicer stores, so playback never needs
 * Sequencer); closing resolves null. Without Sequencer the caller uses Foundry's file picker.
 */

/** Entries shown at once; the search narrows the rest. */
export const MAX_SHOWN = 300;

const loc = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;
const FEET = /\.[0-9]+ft\.*/;
const INDEX = /\.[0-9]$/;

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

/** Entries containing every word of `query` (case-insensitive; dots and spaces separate words). */
export function filterEntries(entries, query) {
  const words = String(query ?? '')
    .toLowerCase()
    .split(/[\s.]+/)
    .filter(Boolean);
  if (!words.length) return entries;
  return entries.filter((e) => {
    const l = e.toLowerCase();
    return words.every((w) => l.includes(w));
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

/**
 * Opens the picker over the page.
 * @param {object} db Sequencer's database
 * @param {{current?: string}} [opts] the stored file, to preview first
 * @returns {Promise<string|null>} the chosen file path, or null when closed
 */
export function pickJb2a(db, { current = '' } = {}) {
  const entries = jb2aEntries(db);
  return new Promise((resolve) => {
    const search = el('input', { type: 'search', class: 'dicer-jp-search', placeholder: loc('DICER.Jb2aPicker.Search'), 'aria-label': loc('DICER.Jb2aPicker.Search') });
    const list = el('ul', { class: 'dicer-jp-list', role: 'listbox', 'aria-label': loc('DICER.Jb2aPicker.Title') });
    const count = el('p', { class: 'dicer-jp-count' });
    const video = el('video', { class: 'dicer-jp-video', muted: '', loop: '', autoplay: '', playsinline: '' });
    video.muted = true;
    const name = el('p', { class: 'dicer-jp-name' });
    const choose = el('button', { type: 'button', class: 'dicer-jp-choose', 'data-jp': 'choose' }, [el('i', { class: 'fa-solid fa-check' }), ` ${loc('DICER.Jb2aPicker.Choose')}`]);
    choose.disabled = true;
    const cancel = el('button', { type: 'button', 'data-jp': 'cancel' }, [loc('DICER.Jb2aPicker.Cancel')]);
    const close = el('button', { type: 'button', class: 'dicer-jp-close', 'data-jp': 'cancel', 'aria-label': loc('DICER.Jb2aPicker.Cancel') }, [el('i', { class: 'fa-solid fa-xmark' })]);
    const box = el('div', { class: 'dicer-jp-box', role: 'dialog', 'aria-modal': 'true', 'aria-label': loc('DICER.Jb2aPicker.Title') }, [
      el('header', { class: 'dicer-jp-head' }, [el('h2', { text: loc('DICER.Jb2aPicker.Title') }), close]),
      el('div', { class: 'dicer-jp-body' }, [
        el('div', { class: 'dicer-jp-left' }, [search, list, count]),
        el('div', { class: 'dicer-jp-right' }, [video, name]),
      ]),
      el('footer', { class: 'dicer-jp-foot' }, [cancel, choose]),
    ]);
    const root = el('div', { class: 'dicer-jp' }, [box]);

    let selected = null; // { path, file }
    const show = (file, label) => {
      if (file && video.getAttribute('src') !== file) {
        video.src = file;
        Promise.resolve(video.play?.()).catch(() => {});
      }
      name.textContent = label ?? '';
    };
    const select = (li) => {
      const file = resolveFile(db, li.dataset.path);
      if (!file) return;
      for (const s of list.querySelectorAll('[aria-selected="true"]')) s.setAttribute('aria-selected', 'false');
      li.setAttribute('aria-selected', 'true');
      selected = { path: li.dataset.path, file };
      choose.disabled = false;
      show(file, li.dataset.path);
    };
    const draw = () => {
      const found = filterEntries(entries, search.value);
      list.replaceChildren(
        ...found.slice(0, MAX_SHOWN).map((path) =>
          el('li', { role: 'option', tabindex: '-1', 'data-path': path, 'aria-selected': String(selected?.path === path), text: path.slice(5) }),
        ),
      );
      count.textContent = found.length > MAX_SHOWN ? loc('DICER.Jb2aPicker.More').replace('{shown}', MAX_SHOWN).replace('{total}', found.length) : '';
      if (!found.length) list.append(el('li', { class: 'dicer-jp-none', text: loc('DICER.Jb2aPicker.None') }));
    };
    const finish = (value) => {
      root.remove();
      document.removeEventListener('keydown', onKey, true);
      try {
        video.pause?.();
      } catch {
        // gone
      }
      video.removeAttribute('src');
      resolve(value);
    };
    const onKey = (ev) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        finish(null);
      } else if (ev.key === 'Enter' && selected && ev.target !== search) finish(selected.file);
    };

    search.addEventListener('input', draw);
    list.addEventListener('click', (ev) => {
      const li = ev.target.closest?.('li[data-path]');
      if (li) select(li);
    });
    list.addEventListener('dblclick', (ev) => {
      const li = ev.target.closest?.('li[data-path]');
      if (!li) return;
      select(li);
      if (selected) finish(selected.file);
    });
    list.addEventListener('mouseover', (ev) => {
      const li = ev.target.closest?.('li[data-path]');
      if (li) show(resolveFile(db, li.dataset.path), li.dataset.path);
    });
    list.addEventListener('mouseleave', () => {
      if (selected) show(selected.file, selected.path);
    });
    root.addEventListener('click', (ev) => {
      const act = ev.target.closest?.('[data-jp]')?.dataset.jp;
      if (act === 'cancel' || ev.target === root) finish(null);
      else if (act === 'choose' && selected) finish(selected.file);
    });
    document.addEventListener('keydown', onKey, true);

    draw();
    if (current) show(current, current.split('/').pop());
    document.body.append(root);
    search.focus();
  });
}
