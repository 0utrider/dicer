import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const FILES = ['stats', 'recorder', 'scenarios', 'report'];
const read = (n) => readFileSync(new URL(`../../src/bench/${n}.js`, import.meta.url), 'utf8');

for (const name of FILES) {
  test(`${name}.js imports only sibling bench files`, () => {
    const src = read(name);
    const specs = [...src.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    const dyn = [...src.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const s of [...specs, ...dyn]) {
      const m = /^\.\/(\w+)\.js$/.exec(s);
      expect(m && FILES.includes(m[1]), `bad import ${s} in ${name}.js`).toBeTruthy();
    }
    expect(/\brequire\s*\(/.test(src)).toBe(false);
  });

  test(`${name}.js has no top-level Hooks/game/Roll reference`, () => {
    const top = read(name)
      .split('\n')
      .filter((l) => /^\S/.test(l) && !/^(\/\/|\/\*|\*)/.test(l));
    for (const l of top) expect(l, l).not.toMatch(/\b(Hooks|game|Roll)\b/);
  });
}
