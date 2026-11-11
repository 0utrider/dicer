import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const FILES = ['stats', 'recorder', 'scenarios', 'report'];
const EXPECTED_COUNT = { stats: 0, recorder: 0, scenarios: 2, report: 1 };
const read = (n) => readFileSync(new URL(`../../src/bench/${n}.js`, import.meta.url), 'utf8');

/** Blank comments and string/template contents so only code remains. */
function scrub(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && n === '*') {
      const e = src.indexOf('*/', i + 2);
      i = e < 0 ? src.length : e + 2;
    } else if (c === '"' || c === "'" || c === '`') {
      const q = c;
      out += q;
      i++;
      while (i < src.length && src[i] !== q) i += src[i] === '\\' ? 2 : 1;
      out += q;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Specifiers of static, side-effect, re-export and dynamic imports (from the raw source). */
function importSpecs(src) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const out = [];
  for (const re of [
    /(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /^\s*import\s*['"]([^'"]+)['"]/gm,
    /\bimport\s*\(\s*['"]([^'"]+)['"]/g,
  ]) {
    for (const m of code.matchAll(re)) out.push(m[1]);
  }
  return out;
}

const badSpecs = (specs) => specs.filter((s) => {
  const m = /^\.\/(\w+)\.js$/.exec(s);
  return !(m && FILES.includes(m[1]));
});

/** Identifiers found at brace depth 0 (top level), for Hooks/game/Roll. */
function topLevelGlobals(src) {
  const code = scrub(src);
  let depth = 0;
  let top = '';
  for (const ch of code) {
    if (ch === '{') depth++;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0) top += ch;
  }
  return [...top.matchAll(/\b(Hooks|game|Roll)\b/g)].map((m) => m[1]);
}

for (const name of FILES) {
  test(`${name}.js imports only sibling bench files`, () => {
    const specs = importSpecs(read(name));
    expect(specs).toHaveLength(EXPECTED_COUNT[name]);
    expect(badSpecs(specs)).toEqual([]);
    expect(/\brequire\s*\(/.test(read(name))).toBe(false);
  });

  test(`${name}.js has no top-level Hooks/game/Roll reference`, () => {
    expect(topLevelGlobals(read(name))).toEqual([]);
  });
}

test('the checker detects bad imports', () => {
  expect(badSpecs(importSpecs("import 'three';\n"))).toEqual(['three']);
  expect(badSpecs(importSpecs("import x from '../y.js';\n"))).toEqual(['../y.js']);
  expect(badSpecs(importSpecs("const m = await import('x');\n"))).toEqual(['x']);
  expect(badSpecs(importSpecs("export { a } from 'three';\n"))).toEqual(['three']);
  expect(badSpecs(importSpecs("import { a } from './stats.js';\n"))).toEqual([]);
});

test('the checker detects top-level globals, including continuation lines', () => {
  expect(topLevelGlobals('const u =\n  game.user;\n')).toEqual(['game']);
  expect(topLevelGlobals('const r = new Roll(\n  "1d20");\n')).toEqual(['Roll']);
  expect(topLevelGlobals('export function f(h = globalThis.Hooks) {\n  return 1;\n}\n')).toEqual(['Hooks']);
  expect(topLevelGlobals('function f() {\n  return game.user;\n}\n')).toEqual([]);
  expect(topLevelGlobals('// Hooks in a comment\nconst s = "game";\n')).toEqual([]);
});
