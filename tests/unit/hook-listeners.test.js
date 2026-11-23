/**
 * Foundry fires some hooks with Hooks.call (canvasReady among them): it stops at the first
 * listener that returns false, and the listeners other modules registered after it never run.
 * Dicer registers early, so a listener of its own returning false breaks those modules (issue #1,
 * fixed in 1.3.20). No listener in src may be able to return false: an arrow with an expression
 * body that can be false (`a && b()`, `a === b`, a ternary, `!x`) is refused here.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.js') ? [path] : [];
  });

/** Hook registrations whose listener is an arrow with an expression body: [file:line, hook, body]. */
function expressionListeners() {
  const out = [];
  const re = /[Hh]ooks\??\.(?:on|once)\??\.?\(\s*([^,]+),\s*(?:async\s*)?\([^)]*\)\s*=>\s*([^{\s][^\n]*)/g;
  for (const file of files('src')) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(re)) {
      const line = text.slice(0, m.index).split('\n').length;
      out.push([`${file.replace(/\\/g, '/')}:${line}`, m[1].trim(), m[2].trim()]);
    }
  }
  return out;
}

describe('hook listeners', () => {
  const found = expressionListeners();

  test('the scan sees the expression-bodied listeners there are', () => {
    expect(found.length).toBeGreaterThan(0);
  });

  test('no listener has an expression body that can be false', () => {
    const risky = found.filter(([, , body]) => !body.startsWith('void ') && /&&|\|\||===|!==| \? |^!/.test(body));
    expect(risky).toEqual([]);
  });

  test('canvasReady listeners have block bodies (Foundry fires it with Hooks.call)', () => {
    const named = found.filter(([, hook]) => /canvasReady/.test(hook));
    expect(named).toEqual([]);
    // and the listeners registered through a loop over hook names
    for (const file of ['src/main.js', 'src/render/actor-looks.js']) {
      const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
      const at = text.indexOf("of ['canvasReady'");
      expect(at, file).toBeGreaterThan(-1);
      expect(text.slice(at, at + 160), file).toMatch(/\(hook, \(\) => \{\n/);
    }
  });
});
