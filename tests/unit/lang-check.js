import { readFileSync } from 'node:fs';

/** Keys that appear twice in one object of lang/en.json (JSON.parse would silently drop one). */
export function duplicateKeys(text = readFileSync('lang/en.json', 'utf8')) {
  const stack = [];
  const dups = [];
  for (const m of text.matchAll(/"((?:[^"\\]|\\.)*)"\s*(:)?|([{}])/g)) {
    if (m[3] === '{') stack.push(new Set());
    else if (m[3] === '}') stack.pop();
    else if (m[2]) {
      const set = stack[stack.length - 1];
      if (set.has(m[1])) dups.push(m[1]);
      set.add(m[1]);
    }
  }
  return dups;
}

/**
 * The DICER.<ns>.* keys the given files use. `expand` maps a dynamic prefix (e.g. 'Sound.') to the
 * concrete suffixes it stands for.
 */
export function usedKeys(ns, files, expand = {}) {
  const used = new Set();
  const re = new RegExp(`DICER\\.${ns}\\.([A-Za-z.$_-]+)`, 'g');
  for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(re)) used.add(m[1]);
  return [...used].flatMap((k) => {
    for (const [prefix, list] of Object.entries(expand))
      if (k.startsWith(prefix)) return list.map((x) => `${prefix}${x}`);
    return [k];
  });
}

export const resolve = (lang, key) => key.split('.').reduce((o, p) => o?.[p], lang);
