import { readdirSync, readFileSync } from 'node:fs';
import { parseAst } from 'vite';
import { minifyGlslTemplates, stripGlslParts } from '../../build/glsl-minify-plugin.js';

/** Every .js file under `dir` holding a `/* glsl *\/` template (forward-slash paths). */
const glslFiles = (dir) =>
  readdirSync(dir, { recursive: true })
    .map((f) => `${dir}/${String(f).split('\\').join('/')}`)
    .filter((p) => p.endsWith('.js') && /\/\*\s*glsl\s*\*\//.test(readFileSync(p, 'utf8')));

const THREE_FILES = glslFiles('node_modules/three/src/renderers/shaders');
const OWN_FILES = glslFiles('src');

/** The marked templates of a file, as their raw parts. */
function markedTemplates(code) {
  const found = [];
  const walk = (node) => {
    if (!node || typeof node.type !== 'string') return;
    if (
      node.type === 'TemplateLiteral' &&
      /\/\*\s*glsl\s*\*\/\s*$/.test(code.slice(0, node.start))
    ) {
      found.push(node.quasis.map((q) => q.value.raw));
    }
    for (const v of Object.values(node)) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') walk(v);
    }
  };
  walk(parseAst(code));
  return found;
}

/** What the GLSL compiler sees, independent of the plugin: cooked text, comments out, one space between tokens, no blank lines. */
function glslTokens(parts) {
  // Cook each raw part exactly as JS would.
  const cooked = parts.map((raw) => new Function(`return \`${raw}\`;`)()).join(' @HOLE@ ');
  return cooked
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, '')
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
}

describe('GLSL minify (Plan 8 Task 6: world start under 4,000,000 bytes)', () => {
  it('finds the shader sources it is meant for', () => {
    expect(THREE_FILES.length).toBeGreaterThan(100);
    expect(OWN_FILES).toEqual(
      expect.arrayContaining(['src/render/shaders/bodies.js', 'src/render/shaders/interior.js']),
    );
  });

  it.each([...THREE_FILES, ...OWN_FILES])(
    '%s: every marked template strips to the same GLSL',
    (file) => {
      const code = readFileSync(file, 'utf8');
      const found = markedTemplates(code);
      expect(found.length).toBeGreaterThan(0);
      for (const parts of found) {
        const stripped = stripGlslParts(parts);
        expect(stripped, 'template left unstripped').not.toBeNull();
        expect(stripped).toHaveLength(parts.length);
        expect(glslTokens(stripped)).toEqual(glslTokens(parts));
        // Smaller, and no comment text survives: a comment holding an interpolation keeps only
        // that, as `//${x}` (the | below is where the interpolation sits).
        expect(stripped.join('').length).toBeLessThanOrEqual(parts.join('').length);
        expect(stripped.join('|')).not.toMatch(/\/\/(?!\|)|\/\*(?!\|)/);
      }
      // The whole module still parses after the rewrite.
      const out = minifyGlslTemplates(code, parseAst);
      expect(() => parseAst(out ?? code)).not.toThrow();
    },
  );

  it('keeps preprocessor lines on their own lines and interpolations in place', () => {
    const parts = [
      '\n\t// head\n\t#include <common>\n\tfloat x = ',
      '; /* note */\n\n\t#ifdef A\n',
      '\n#endif\n',
    ];
    expect(stripGlslParts(parts)).toEqual([
      '\n#include <common>\nfloat x = ',
      ';\n#ifdef A\n',
      '\n#endif\n',
    ]);
  });

  it('keeps an interpolation that sits in a comment, still commented', () => {
    const parts = ['\n  // size ', ' of it\n  float a; /* at ', ' */ float b;\n'];
    expect(stripGlslParts(parts)).toEqual(['\n//', '\nfloat a; /*', '*/  float b;\n']);
  });

  it('leaves a template alone when stripping could change it', () => {
    expect(stripGlslParts(['#define A 1 \\\n  + 2'])).toBeNull(); // a raw backslash-newline
    expect(stripGlslParts(['float a; /* open'])).toBeNull(); // unterminated comment
  });

  it('only rewrites templates marked /* glsl */', () => {
    const code =
      'export const a = /* glsl */ `\n  // c\n  float a;\n`;\nexport const b = `\n  // keep\n`;\n';
    expect(minifyGlslTemplates(code, parseAst)).toBe(
      'export const a = /* glsl */ `\nfloat a;\n`;\nexport const b = `\n  // keep\n`;\n',
    );
  });
});
