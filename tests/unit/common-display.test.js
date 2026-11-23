/**
 * Monk's Common Display, "Hide UI": the shared screen hides every child of <body> not on its own
 * list, with `display: none !important`. Dicer's layer (the dice canvas, the crit cards) is kept
 * on screen by an !important rule in a cascade layer: the only kind that wins over it (checked in
 * a browser; jsdom does not resolve cascade layers, so this pins the rule and where the layer is).
 */
import { readFileSync } from 'node:fs';

const css = readFileSync('styles/dicer.css', 'utf8').replace(/\r\n/g, '\n');

describe("Monk's Common Display Hide UI", () => {
  test('the stylesheet keeps #dicer-layer shown, from a cascade layer, with !important', () => {
    const layered = css.match(/@layer dicer-shown \{\n([\s\S]*?)\n\}\n/);
    expect(layered).not.toBeNull();
    expect(layered[1].replace(/\s+/g, ' ').trim()).toBe('body.hide-ui > #dicer-layer { display: block !important; }');
  });

  test('it is the only layered rule: the rest of the stylesheet keeps its place in the cascade', () => {
    expect(css.match(/@layer/g)).toHaveLength(1);
  });

  test('the layer it names is the one main.js mounts next to the board', () => {
    const main = readFileSync('src/main.js', 'utf8');
    expect(main).toContain("layer.id = 'dicer-layer'");
    expect(main).toContain('board.after(layer)');
  });
});
