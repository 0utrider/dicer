// World-start bundle report (Plan 8 Task 6, H-D1).
//   node scripts/bundle-report.mjs [--top N] [--out DIR]
// Builds with sourcemaps (BUNDLE_REPORT=1) into a scratch folder, then prints, for each world-start
// chunk, the minified bytes each source file contributes (largest first), and the raw and gzip
// size of every world-start file. No dependencies beyond Node: zlib does the gzip.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { BUDGET, worldStartFiles } from '../build/world-start.js';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const TOP = Number(arg('--top', 40));
const OUT = arg('--out', join(tmpdir(), 'dicer-bundle-report')).split('\\').join('/');

if (existsSync(OUT)) rmSync(OUT, { recursive: true });
execFileSync(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'build', '--outDir', OUT, '--emptyOutDir'],
  {
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, BUNDLE_REPORT: '1' },
  },
);

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = Object.fromEntries([...B64].map((c, i) => [c, i]));

/** Decodes one mappings line into [generatedColumn, sourceIndex|undefined] segments. */
function decodeLine(line, state) {
  const segs = [];
  for (const seg of line.split(',')) {
    if (!seg) continue;
    const values = [];
    let value = 0;
    let shift = 0;
    for (const ch of seg) {
      const digit = B64_INDEX[ch];
      value += (digit & 31) << shift;
      if (digit & 32) shift += 5;
      else {
        values.push(value & 1 ? -(value >>> 1) : value >>> 1);
        value = 0;
        shift = 0;
      }
    }
    state.col += values[0];
    if (values.length > 1) {
      state.src += values[1];
      segs.push([state.col, state.src]);
    } else segs.push([state.col, undefined]);
  }
  return segs;
}

/** Short, stable name for a sourcemap source path. */
function label(source) {
  const s = source.split('\\').join('/');
  const nm = s.lastIndexOf('node_modules/');
  if (nm >= 0) return s.slice(nm + 'node_modules/'.length);
  const src = s.lastIndexOf('src/');
  if (src >= 0) return s.slice(src);
  return s.replace(/^(\.\.\/)+/, '');
}

/** Minified bytes per source file in `file`, from its .map (UTF-16 columns ~ bytes for this code). */
function bytesBySource(file) {
  const map = JSON.parse(readFileSync(`${file}.map`, 'utf8'));
  const code = readFileSync(file, 'utf8').split('\n');
  const totals = new Map();
  const add = (key, n) => totals.set(key, (totals.get(key) ?? 0) + n);
  const state = { col: 0, src: 0 };
  // A segment runs to the next one, across line breaks: a multi-line template literal (GLSL
  // shader chunks, HTML) has one segment at its start and none on its continuation lines.
  let current = '(unmapped)';
  map.mappings.split(';').forEach((line, i) => {
    state.col = 0;
    const segs = decodeLine(line, state);
    const text = code[i] ?? '';
    const lineBreak = i + 1 < code.length ? 1 : 0;
    add(
      current,
      Buffer.byteLength(text.slice(0, segs.length ? segs[0][0] : text.length)) +
        (segs.length ? 0 : lineBreak),
    );
    segs.forEach(([col, src], k) => {
      current = src === undefined ? '(unmapped)' : label(map.sources[src]);
      const last = k + 1 === segs.length;
      add(
        current,
        Buffer.byteLength(text.slice(col, last ? text.length : segs[k + 1][0])) +
          (last ? lineBreak : 0),
      );
    });
  });
  return totals;
}

const kb = (n) => `${(n / 1000).toFixed(1).padStart(8)} kB`;
const files = worldStartFiles(OUT);
const rel = (p) => (p.startsWith(`${OUT}/`) ? `dist/${p.slice(OUT.length + 1)}` : p);

for (const file of files.filter((p) => p.endsWith('.js') && existsSync(`${p}.map`))) {
  const totals = [...bytesBySource(file)].sort((a, b) => b[1] - a[1]);
  const size = statSync(file).size;
  console.log(
    `\n${rel(file)}: ${size} B, top ${Math.min(TOP, totals.length)} of ${totals.length} sources`,
  );
  for (const [name, n] of totals.slice(0, TOP)) console.log(`${kb(n)}  ${name}`);
  const groups = new Map();
  for (const [name, n] of totals) {
    const g = name.startsWith('three/')
      ? 'three'
      : name.startsWith('@dimforge/')
        ? 'rapier glue'
        : name.startsWith('src/')
          ? 'src'
          : 'other';
    groups.set(g, (groups.get(g) ?? 0) + n);
  }
  console.log(`  by origin: ${[...groups].map(([g, n]) => `${g} ${n}`).join(', ')}`);
}

console.log('\nworld-start files (raw / gzip -9):');
let raw = 0;
let gz = 0;
for (const file of files) {
  const buf = readFileSync(file);
  const g = gzipSync(buf, { level: 9 }).length;
  raw += buf.length;
  gz += g;
  console.log(`${String(buf.length).padStart(9)}  ${String(g).padStart(9)}  ${rel(file)}`);
}
console.log(
  `${String(raw).padStart(9)}  ${String(gz).padStart(9)}  total (budget ${BUDGET}, headroom ${BUDGET - raw})`,
);
