/**
 * GLSL whitespace and comment stripping for `/* glsl *\/` template literals (Plan 8 Task 6).
 *
 * esbuild minifies JS but leaves template literal text alone, so three's shader chunks (we build
 * three from its sources, see vite.config.js, which skips three's own build step that strips
 * them) and Dicer's src/render/shaders ship with their comments and indentation: about 35 kB of
 * the world-start bundle. This pass removes, inside each template marked `/* glsl *\/` only:
 * comments, leading and trailing blanks on each line, and blank lines. Every line break between
 * two code lines stays, so preprocessor lines (#include, #define, #if) keep their own lines, and
 * `${...}` interpolations are left as they are. The shader each template yields is the same
 * token stream (tests/unit/glsl-minify.test.js checks every shader in the build).
 */

/** Marks an interpolation inside the joined template text while it is stripped (private-use chars). */
const HOLE = (i) => `${i}`;
const HOLE_RE = /(\d+)/g;

/** The interpolation marks inside `text`, joined. */
const holesIn = (text) => (text.match(HOLE_RE) ?? []).join('');

/**
 * Removes // and /* *\/ comments in one left-to-right scan (a // inside /* ... *\/ and vice versa
 * are handled). A comment holding an interpolation keeps just that, still commented (`//${x}`),
 * so the template keeps every expression and the shader still sees only a comment there.
 */
function dropComments(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      const end = nl < 0 ? text.length : nl; // keep the newline
      const holes = holesIn(text.slice(i, end));
      if (holes) out += `//${holes}`;
      i = end;
    } else if (text[i] === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      if (close < 0) return null; // unterminated: leave the template alone
      const holes = holesIn(text.slice(i, close));
      // A block comment between two tokens on one line still separates them.
      const gap = text.slice(i, close).includes('\n') ? '\n' : ' ';
      out += holes ? `/*${holes}*/${gap}` : gap;
      i = close + 2;
    } else {
      out += text[i];
      i += 1;
    }
  }
  return out;
}

/**
 * The stripped raw text of one template, given its raw parts (the text between interpolations),
 * or null when it cannot be stripped safely (a line ending in a backslash, an unterminated
 * comment).
 */
export function stripGlslParts(parts) {
  const joined = parts.map((p, i) => (i === 0 ? p : HOLE(i - 1) + p)).join('');
  // A raw backslash before a line break is a JS line continuation; trimming could create one.
  if (/\\[ \t]*\r?\n/.test(joined)) return null;
  const noComments = dropComments(joined.replace(/\r\n/g, '\n'));
  if (noComments === null) return null;
  const lines = noComments
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  // Keep the template's leading/trailing line break so concatenated chunks stay on own lines.
  const lead = /^[ \t]*\r?\n/.test(joined) ? '\n' : '';
  const trail = /\r?\n[ \t]*$/.test(joined) ? '\n' : '';
  const stripped = lead + lines.join('\n') + trail;
  const holes = [...stripped.matchAll(HOLE_RE)].map((m) => Number(m[1]));
  if (holes.length !== parts.length - 1 || holes.some((h, i) => h !== i)) return null;
  return stripped.split(HOLE_RE).filter((_, i) => i % 2 === 0);
}

const GLSL_MARK = /\/\*\s*glsl\s*\*\/\s*$/;

/** Every TemplateLiteral node in an ESTree AST. */
function templates(node, out = []) {
  if (!node || typeof node.type !== 'string') return out;
  if (node.type === 'TemplateLiteral') out.push(node);
  for (const key of Object.keys(node)) {
    const v = node[key];
    if (Array.isArray(v)) v.forEach((c) => templates(c, out));
    else if (v && typeof v === 'object' && typeof v.type === 'string') templates(v, out);
  }
  return out;
}

/** `code` with every `/* glsl *\/` template stripped (null if nothing changed). `parse` gives an ESTree AST. */
export function minifyGlslTemplates(code, parse) {
  if (!code.includes('glsl')) return null;
  const edits = [];
  for (const t of templates(parse(code))) {
    if (!GLSL_MARK.test(code.slice(Math.max(0, t.start - 40), t.start))) continue;
    if (t.quasis.some((q) => code.slice(q.start, q.end) !== q.value.raw)) continue; // positions not as expected
    const parts = stripGlslParts(t.quasis.map((q) => q.value.raw));
    if (!parts) continue;
    t.quasis.forEach((q, i) => edits.push([q.start, q.end, parts[i]]));
  }
  if (edits.length === 0) return null;
  let out = code;
  for (const [start, end, text] of edits.sort((a, b) => b[0] - a[0])) {
    out = out.slice(0, start) + text + out.slice(end);
  }
  return out;
}

/** Build only: the dev server and Vitest see the shaders as written. */
export function glslMinifyPlugin() {
  return {
    name: 'dicer:glsl-minify',
    apply: 'build',
    transform(code, id) {
      if (!/\.js$/.test(id.split('?')[0])) return null;
      const out = minifyGlslTemplates(code, (c) => this.parse(c));
      return out === null ? null : { code: out, map: null };
    },
  };
}
